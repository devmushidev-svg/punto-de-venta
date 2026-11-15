import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Concurrencia: Postgres corre las transacciones en READ COMMITTED. Leer una
 * fila, decidir y despues escribir deja una ventana en la que otra transaccion
 * lee el mismo valor. Asi salian dos ventas con el mismo numero de factura,
 * cinco abonos del mismo saldo y stock negativo con ventas simultaneas.
 *
 * La regla en este archivo: antes de decidir sobre una fila que otra peticion
 * puede estar cambiando, se toma `SELECT ... FOR UPDATE` y se vuelve a leer.
 * Los ids se bloquean siempre ordenados para que dos ventas con los mismos
 * productos no se esperen en cruz (deadlock).
 */
const LOCKABLE = new Set(["Product", "Sale", "Purchase", "Quote", "OrganizationSettings", "DocumentSeries"]);

export async function lockRows(tx: Tx, table: string, ids: string[]): Promise<void> {
  if (!LOCKABLE.has(table)) throw new Error(`lockRows: tabla no permitida ${table}`);
  const unique = [...new Set(ids.filter(Boolean))].sort();
  if (unique.length === 0) return;
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id IN (${Prisma.join(unique)}) ORDER BY id FOR UPDATE`,
  );
}

export async function lockOrganizationSettings(tx: Tx, organizationId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "OrganizationSettings" WHERE "organizationId" = ${organizationId} FOR UPDATE`;
}

export type SaleLineInput = { productId: string; qty: number };
type LockedProduct = Prisma.ProductGetPayload<object>;

/**
 * Bloquea los productos de la venta (y los componentes de los kits) y valida
 * el stock con la cantidad SUMADA por producto. Antes cada linea se comparaba
 * contra el stock original: dos lineas de 4 con stock 5 pasaban.
 *
 * Devuelve los productos ya releidos despues del bloqueo.
 */
export async function lockAndAssertSaleStock(
  tx: Tx,
  orgId: string,
  lines: SaleLineInput[],
  allowOversell: boolean,
): Promise<Map<string, LockedProduct>> {
  const ids = [...new Set(lines.map((l) => l.productId))];
  const kitLines = await tx.productKitLine.findMany({
    where: { kitProductId: { in: ids }, kitProduct: { organizationId: orgId } },
  });
  const componentIds = kitLines.map((k) => k.componentProductId);
  await lockRows(tx, "Product", [...ids, ...componentIds]);

  const products = await tx.product.findMany({
    where: { id: { in: [...ids, ...componentIds] }, organizationId: orgId },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const need = new Map<string, number>();
  const add = (id: string, q: number) => need.set(id, (need.get(id) ?? 0) + q);
  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product) throw new Error("PRODUCT_NOT_FOUND");
    if (product.productType === "INSUMO") throw new Error("INSUMO_NOT_SALEABLE");
    if (product.productType === "SERVICIO") continue;
    if (product.productType === "KIT") {
      const comps = kitLines.filter((k) => k.kitProductId === product.id);
      if (comps.length === 0) throw new Error("KIT_EMPTY");
      for (const k of comps) {
        const comp = byId.get(k.componentProductId);
        if (!comp || comp.productType !== "PRODUCTO") throw new Error("KIT_BAD_COMPONENT");
        add(comp.id, line.qty * k.qty);
      }
      continue;
    }
    add(product.id, line.qty);
  }

  if (!allowOversell) {
    for (const [id, q] of need) {
      const p = byId.get(id)!;
      if (p.stock + 1e-9 < q) throw new Error("INSUFFICIENT_STOCK");
    }
  }
  return byId;
}

type InvoiceContext = {
  branch: { id: string };
  device: { id: string; invoiceSeries: string };
};

/**
 * Asigna el siguiente numero de factura de forma atomica. El vencimiento de la
 * autorizacion SAR lo valida quien llama (`assertSarRangeValidUntil`).
 * - Rango SAR (invoiceJson.sar.autoNumber): se bloquea la fila de
 *   configuracion, se relee el JSON y se avanza `nextNum`.
 * - Serie por dispositivo: `UPDATE ... nextNumber = nextNumber + 1 RETURNING`
 *   es atomico; el numero asignado es el valor previo.
 */
export async function allocateSaleInvoiceNumber(
  tx: Tx,
  orgId: string,
  ctx: InvoiceContext,
): Promise<string> {
  await lockOrganizationSettings(tx, orgId);
  const settings = await tx.organizationSettings.findUnique({ where: { organizationId: orgId } });
  const invParsed = JSON.parse(settings?.invoiceJson || "{}") as Record<string, unknown>;
  const sar = invParsed.sar as Record<string, unknown> | undefined;

  if (sar && sar.autoNumber === true) {
    const next = Number(sar.nextNum ?? 1);
    const end = Number(sar.rangeEnd ?? 99999999);
    if (next > end) throw new Error("SAR_RANGE_EXHAUSTED");
    const ser = String(sar.series ?? "").trim();
    const invoiceNumber = ser ? `${ser}-${String(next).padStart(8, "0")}` : String(next).padStart(8, "0");
    const json = JSON.stringify({ ...invParsed, sar: { ...sar, nextNum: next + 1 } });
    await tx.organizationSettings.upsert({
      where: { organizationId: orgId },
      update: { invoiceJson: json },
      create: { organizationId: orgId, invoiceJson: json },
    });
    return invoiceNumber;
  }

  let series = await tx.documentSeries.findFirst({
    where: { organizationId: orgId, documentType: "SALE", deviceId: ctx.device.id, active: true },
  });
  if (!series) {
    const prefix = `${ctx.device.invoiceSeries}-`;
    series = await tx.documentSeries.upsert({
      where: { organizationId_documentType_prefix: { organizationId: orgId, documentType: "SALE", prefix } },
      update: {},
      create: {
        organizationId: orgId,
        branchId: ctx.branch.id,
        deviceId: ctx.device.id,
        documentType: "SALE",
        prefix,
        nextNumber: 1,
        padding: 6,
      },
    });
  }
  const bumped = await tx.documentSeries.update({
    where: { id: series.id },
    data: { nextNumber: { increment: 1 } },
  });
  const assigned = bumped.nextNumber - 1;
  return `${bumped.prefix}${String(assigned).padStart(bumped.padding, "0")}`;
}

/** Fecha de venta enviada por el cliente: nunca en el futuro; los no-admin solo hasta 7 dias atras (ventas offline). */
export const MAX_BACKDATE_NON_ADMIN_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export function resolveSaleDate(requested: Date | null, isAdmin: boolean, now = new Date()): Date {
  if (!requested) return now;
  if (requested.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) throw new Error("SALE_DATE_FUTURE");
  if (!isAdmin && now.getTime() - requested.getTime() > MAX_BACKDATE_NON_ADMIN_MS) {
    throw new Error("SALE_DATE_TOO_OLD");
  }
  return requested;
}

/** Precio unitario resultante: nunca negativo ni no-numerico. */
export function assertValidUnitPrice(unitPrice: number): void {
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("INVALID_PRICE");
}
