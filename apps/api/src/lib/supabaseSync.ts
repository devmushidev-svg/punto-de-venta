import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

type SupabaseConfig = {
  configured: boolean;
  url: string;
  serviceRoleKey: string;
  anonKey: string;
  bucket: string;
  syncTable: string;
};

type SyncRow = {
  id?: string;
  organization_id: string;
  branch_id?: string | null;
  device_id?: string | null;
  origin_device_id?: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  sync_status: string;
  version: number;
  payload_json: Record<string, unknown>;
  error?: string | null;
  created_at?: string;
  last_synced_at?: string | null;
};

export function getSupabaseConfig(): SupabaseConfig {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return {
    configured: Boolean(url && serviceRoleKey),
    url,
    serviceRoleKey,
    anonKey: process.env.SUPABASE_ANON_KEY || "",
    bucket: process.env.SUPABASE_STORAGE_BUCKET || "punto-flow",
    syncTable: process.env.SUPABASE_SYNC_TABLE || "punto_sync_events",
  };
}

function assertConfigured(config = getSupabaseConfig()) {
  if (!config.configured) {
    throw new Error("SUPABASE_NOT_CONFIGURED");
  }
}

async function supabaseFetch<T>(path: string, init: RequestInit = {}, config = getSupabaseConfig()): Promise<T> {
  assertConfigured(config);
  const headers = new Headers(init.headers);
  headers.set("apikey", config.serviceRoleKey);
  headers.set("Authorization", `Bearer ${config.serviceRoleKey}`);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`${config.url}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SUPABASE_${res.status}: ${body || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function testSupabaseConnection() {
  const config = getSupabaseConfig();
  if (!config.configured) {
    return { ok: false, configured: false, message: "Supabase no configurado" };
  }
  try {
    await supabaseFetch<unknown[]>(`/rest/v1/${config.syncTable}?select=id&limit=1`, {}, config);
    return { ok: true, configured: true, message: "Conectado a Supabase", table: config.syncTable };
  } catch (e) {
    return {
      ok: false,
      configured: true,
      message: e instanceof Error ? e.message : "No se pudo conectar a Supabase",
      table: config.syncTable,
    };
  }
}

async function entitySnapshot(db: Db, organizationId: string, entityType: string, entityId: string) {
  if (entityType === "Product") {
    return db.product.findFirst({ where: { id: entityId, organizationId } });
  }
  if (entityType === "Customer") {
    return db.customer.findFirst({ where: { id: entityId, organizationId } });
  }
  if (entityType === "Supplier") {
    return db.supplier.findFirst({ where: { id: entityId, organizationId } });
  }
  if (entityType === "Sale") {
    return db.sale.findFirst({
      where: { id: entityId, organizationId },
      include: {
        customer: true,
        user: { select: { id: true, username: true, displayName: true } },
        lines: true,
      },
    });
  }
  return null;
}

function rowFromEvent(event: {
  id: string;
  organizationId: string;
  branchId: string | null;
  deviceId: string | null;
  originDeviceId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  syncStatus: string;
  version: number;
  payloadJson: string;
  error: string | null;
  createdAt: Date;
  lastSyncedAt: Date | null;
}, snapshot: unknown): SyncRow {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(event.payloadJson || "{}") as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return {
    organization_id: event.organizationId,
    branch_id: event.branchId,
    device_id: event.deviceId,
    origin_device_id: event.originDeviceId,
    entity_type: event.entityType,
    entity_id: event.entityId,
    action: event.action,
    sync_status: event.syncStatus,
    version: event.version,
    payload_json: { ...payload, snapshot, localSyncEventId: event.id },
    error: event.error,
    created_at: event.createdAt.toISOString(),
    last_synced_at: event.lastSyncedAt?.toISOString() ?? null,
  };
}

export async function pushPendingEvents(db: PrismaClient, organizationId: string, limit = 100) {
  const config = getSupabaseConfig();
  assertConfigured(config);
  const events = await db.syncEvent.findMany({
    where: { organizationId, syncStatus: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  if (!events.length) return { pushed: 0 };
  const rows: SyncRow[] = [];
  for (const event of events) {
    const snapshot = await entitySnapshot(db, organizationId, event.entityType, event.entityId);
    rows.push(rowFromEvent(event, snapshot));
  }
  await supabaseFetch<unknown[]>(`/rest/v1/${config.syncTable}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(rows),
  }, config);
  const now = new Date();
  await db.syncEvent.updateMany({
    where: { id: { in: events.map((e) => e.id) }, organizationId },
    data: { syncStatus: "SYNCED", lastSyncedAt: now },
  });
  return { pushed: events.length };
}

async function applyPulledRow(db: PrismaClient, row: SyncRow) {
  const snapshot = row.payload_json?.snapshot as Record<string, unknown> | null | undefined;
  if (!snapshot) return { applied: false, reason: "NO_SNAPSHOT" };

  if (row.entity_type === "Product") {
    const data = {
      organizationId: String(snapshot.organizationId ?? row.organization_id),
      branchId: (snapshot.branchId as string | null | undefined) ?? null,
      sku: String(snapshot.sku ?? ""),
      name: String(snapshot.name ?? ""),
      description: (snapshot.description as string | null | undefined) ?? null,
      unit: String(snapshot.unit ?? "UND"),
      price: Number(snapshot.price ?? 0),
      price2: snapshot.price2 == null ? null : Number(snapshot.price2),
      price3: snapshot.price3 == null ? null : Number(snapshot.price3),
      price4: snapshot.price4 == null ? null : Number(snapshot.price4),
      volumePricesJson: String(snapshot.volumePricesJson ?? "[]"),
      cost: Number(snapshot.cost ?? 0),
      taxPercent: Number(snapshot.taxPercent ?? 0),
      taxName: String(snapshot.taxName ?? "ISV"),
      stock: Number(snapshot.stock ?? 0),
      minStock: Number(snapshot.minStock ?? 0),
      category: (snapshot.category as string | null | undefined) ?? null,
      barcode: (snapshot.barcode as string | null | undefined) ?? null,
      quickCode: (snapshot.quickCode as string | null | undefined) ?? null,
      location: (snapshot.location as string | null | undefined) ?? null,
      brand: (snapshot.brand as string | null | undefined) ?? null,
      imageUrl: (snapshot.imageUrl as string | null | undefined) ?? null,
      productType: String(snapshot.productType ?? "PRODUCTO"),
      esGranel: Boolean(snapshot.esGranel ?? false),
      printOnKitchenOrder: snapshot.printOnKitchenOrder !== false,
      supplierId: (snapshot.supplierId as string | null | undefined) ?? null,
      active: snapshot.active !== false,
      syncStatus: "SYNCED",
      lastSyncedAt: new Date(),
      originDeviceId: row.origin_device_id ?? null,
      version: Number(snapshot.version ?? row.version ?? 1),
      deletedAt: snapshot.deletedAt ? new Date(String(snapshot.deletedAt)) : null,
    };
    if (!data.sku || !data.name) return { applied: false, reason: "PRODUCT_INCOMPLETE" };
    await db.product.upsert({
      where: { id: row.entity_id },
      create: { id: row.entity_id, ...data },
      update: data,
    });
    return { applied: true };
  }

  if (row.entity_type === "Sale") {
    const exists = await db.sale.findFirst({ where: { id: row.entity_id, organizationId: row.organization_id } });
    return { applied: false, reason: exists ? "SALE_EXISTS_NOT_OVERWRITTEN" : "SALE_PULL_REQUIRES_REVIEW" };
  }

  return { applied: false, reason: "ENTITY_NOT_SUPPORTED_YET" };
}

export async function pullCloudEvents(db: PrismaClient, organizationId: string, originDeviceId: string, limit = 100) {
  const config = getSupabaseConfig();
  assertConfigured(config);
  const qs = new URLSearchParams();
  qs.set("organization_id", `eq.${organizationId}`);
  qs.set("origin_device_id", `neq.${originDeviceId}`);
  qs.set("order", "created_at.asc");
  qs.set("limit", String(limit));
  const rows = await supabaseFetch<SyncRow[]>(`/rest/v1/${config.syncTable}?${qs.toString()}`, {}, config);
  let pulled = 0;
  let applied = 0;
  for (const row of rows) {
    if (!row.id) continue;
    const exists = await db.syncEvent.findFirst({ where: { cloudEventId: row.id } });
    if (exists) continue;
    const result = await applyPulledRow(db, row);
    await db.syncEvent.create({
      data: {
        cloudEventId: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id ?? null,
        deviceId: row.device_id ?? null,
        originDeviceId: row.origin_device_id ?? null,
        entityType: row.entity_type,
        entityId: row.entity_id,
        action: `PULL_${row.action}`,
        syncStatus: result.applied ? "SYNCED" : "REVIEW",
        version: row.version ?? 1,
        payloadJson: JSON.stringify({ ...row.payload_json, pullResult: result }),
        createdAt: row.created_at ? new Date(row.created_at) : new Date(),
        lastSyncedAt: new Date(),
      },
    });
    pulled += 1;
    if (result.applied) applied += 1;
  }
  return { pulled, applied };
}
