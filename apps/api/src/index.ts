import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { prisma } from "./lib/prisma.js";
import { signToken, verifyToken, verifyPassword, hashPassword } from "./lib/auth.js";
import {
  clearLoginFailures,
  clientIpFromHeaders,
  isLoginBlocked,
  registerLoginFailure,
} from "./lib/loginRateLimit.js";
import type { JwtPayload } from "./lib/auth.js";
import {
  isCreditSaleTerm,
  isImmediateSaleTerm,
  normalizeSaleTerms,
  resolveSalePaid,
} from "./lib/saleTerms.js";
import {
  assertKitSaleStock,
  decrementStockForKitSale,
  replaceProductKitLines,
  type KitLineInput,
} from "./lib/kit.js";
import { cashMovementDelta, isCashMovementCategory } from "./lib/cashMovementMath.js";
import { adjustProductStock, migrateOrgProductStocks } from "./lib/productStockLocation.js";
import { normalizeVolumePricesPayload, resolveProductUnitPrice } from "./lib/volumePrice.js";
import { getProductMovements } from "./lib/productMovements.js";
import { buildSaleComprobantePdf } from "./lib/saleComprobantePdf.js";
import {
  effectivePermissionList,
  parsePermissionsJson,
  PERMISSION_KEYS,
  sanitizePermissionsPayload,
  serializePermissionsPayload,
  userHasPermission,
  type PermissionKey,
} from "./lib/permissions.js";
import {
  applyTransferReceiveStock,
  applyTransferSendStock,
  applyTransferUndoSendStock,
  assertStockForTransferSend,
  validateTransferLineProducts,
} from "./lib/stockTransfer.js";
import {
  buildImportTemplateBuffer,
  importCustomersFromExcel,
  importProductsFromExcel,
  importSuppliersFromExcel,
  type ImportTemplateKind,
} from "./lib/excelImport.js";
import { mergeMasterFromBackup } from "./lib/backupImportMaster.js";
import {
  getSupabaseConfig,
  pullCloudEvents,
  pushPendingEvents,
  testSupabaseConnection,
} from "./lib/supabaseSync.js";
import { replaceFullOrganizationFromBackup } from "./lib/backupReplaceFull.js";
import { buildCashCloseReportHtml } from "./lib/cashCloseReportHtml.js";
import { createSmtpTransport } from "./lib/smtpSend.js";
import { buildStockTransferPrintHtml } from "./lib/stockTransferPrintHtml.js";

const PRODUCT_TYPES = ["PRODUCTO", "SERVICIO", "INSUMO", "KIT"] as const;

const LOGO_UPLOAD_DIR = join(process.cwd(), "uploads", "logos");

function isValidProductType(pt: string): pt is (typeof PRODUCT_TYPES)[number] {
  return (PRODUCT_TYPES as readonly string[]).includes(pt);
}

const productIncludeKit = {
  supplier: { select: { id: true, name: true } },
  kitLines: {
    include: {
      component: { select: { id: true, sku: true, name: true, stock: true, unit: true } },
    },
  },
} as const;

type PageMeta = { page: number; pageSize: number; skip: number; take: number };

function parsePageParams(query: (name: string) => string | undefined, fallbackPageSize = 50): PageMeta {
  const rawPage = Number(query("page"));
  const rawPageSize = Number(query("pageSize") ?? query("limit"));
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.trunc(rawPage)) : 1;
  const pageSize = Number.isFinite(rawPageSize) ? Math.min(200, Math.max(1, Math.trunc(rawPageSize))) : fallbackPageSize;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function wantsPaginated(query: (name: string) => string | undefined): boolean {
  return query("paginated") === "1" || query("page") !== undefined || query("pageSize") !== undefined;
}

async function ensureDefaultBranchDevice(organizationId: string) {
  const branchCode = (process.env.BRANCH_CODE || "PRIN").trim().toUpperCase();
  const deviceCode = (process.env.DEVICE_CODE || "CAJA-01").trim().toUpperCase();
  const deviceName = (process.env.DEVICE_NAME || "Caja principal").trim();

  let branch = await prisma.branch.findFirst({ where: { organizationId, code: branchCode } });
  if (!branch) {
    branch = await prisma.branch.create({
      data: { organizationId, code: branchCode, name: "Tienda principal", isDefault: true },
    });
  }

  let device = await prisma.device.findFirst({ where: { organizationId, code: deviceCode } });
  if (!device) {
    device = await prisma.device.create({
      data: {
        organizationId,
        branchId: branch.id,
        code: deviceCode,
        name: deviceName,
        deviceType: "POS",
        mode: "LOCAL",
        invoiceSeries: deviceCode.replace(/[^A-Z0-9]/g, "").slice(-4) || "A",
        lastSeenAt: new Date(),
      },
    });
  } else {
    device = await prisma.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date(), branchId: device.branchId ?? branch.id },
    });
  }

  return { branch, device };
}

type Variables = { jwt: JwtPayload };

const app = new Hono<{ Variables: Variables }>();

const DEFAULT_CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) return DEFAULT_CORS_ORIGINS;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_CORS_ORIGINS;
}

app.use(
  "*",
  cors({
    origin: parseCorsOrigins(),
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
    credentials: true,
  })
);

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
});

app.get("/health", (c) => c.json({ ok: true }));

app.get("/uploads/logos/:file", async (c) => {
  const file = c.req.param("file");
  if (!/^[a-zA-Z0-9._-]+$/.test(file)) return c.json({ error: "Nombre inválido" }, 400);
  const path = join(LOGO_UPLOAD_DIR, file);
  try {
    const buf = await readFile(path);
    const ext = file.split(".").pop()?.toLowerCase();
    const ct =
      ext === "png"
        ? "image/png"
        : ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "webp"
            ? "image/webp"
            : "application/octet-stream";
    return new Response(buf, { headers: { "Content-Type": ct, "Cache-Control": "public, max-age=86400" } });
  } catch {
    return c.json({ error: "No encontrado" }, 404);
  }
});

function slugifyOrgName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base.slice(0, 48) || "org").replace(/^-+|-+$/g, "") || "org";
}

/** Primera organización sin JWT. Requiere `BOOTSTRAP_SECRET` y cabecera `X-Bootstrap-Secret`. */
app.post("/admin/bootstrap-org", async (c) => {
  const secret = process.env.BOOTSTRAP_SECRET?.trim();
  if (!secret) {
    return c.json({ error: "Bootstrap deshabilitado (defina BOOTSTRAP_SECRET en el servidor)." }, 503);
  }
  if ((c.req.header("X-Bootstrap-Secret") || "").trim() !== secret) {
    return c.json({ error: "Secreto inválido" }, 401);
  }
  const body = await c.req.json<{ name?: string; slug?: string; adminUsername?: string; adminPassword?: string }>();
  const name = body.name?.trim();
  const adminUsername = body.adminUsername?.trim().toUpperCase();
  const adminPassword = body.adminPassword ?? "";
  if (!name || !adminUsername || adminPassword.length < 6) {
    return c.json({ error: "name, adminUsername y adminPassword (mín. 6 caracteres) requeridos" }, 400);
  }
  const slug = (body.slug?.trim().toLowerCase() || slugifyOrgName(name)).slice(0, 48) || "org";
  const taken = await prisma.organization.findUnique({ where: { slug } });
  if (taken) return c.json({ error: "El slug ya existe" }, 409);
  const passwordHash = await hashPassword(adminPassword);
  const org = await prisma.organization.create({
    data: {
      slug,
      name,
      taxIdType: "RTN",
      country: "HN",
      currency: "HNL",
      currencySymbol: "L",
      language: "es",
    },
  });
  await prisma.organizationSettings.create({ data: { organizationId: org.id } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      username: adminUsername,
      passwordHash,
      displayName: "Administrador",
      role: "admin",
    },
  });
  return c.json({ ok: true, organizationId: org.id, slug: org.slug, userId: user.id });
});

app.post("/auth/forgot-password", async (c) => {
  const body = await c.req.json<{ username?: string; organizationId?: string }>();
  const username = body.username?.trim().toUpperCase();
  const organizationId = body.organizationId?.trim();
  if (!username || !organizationId) {
    return c.json({ error: "Usuario y empresa requeridos" }, 400);
  }
  const user = await prisma.user.findFirst({
    where: { organizationId, username, active: true },
    include: { organization: true },
  });
  if (!user) {
    return c.json({ ok: true, message: "Si los datos coinciden, se enviará un enlace al correo de recuperación de la empresa." });
  }
  const recovery = user.organization.recoveryEmail?.trim();
  if (!recovery) {
    return c.json(
      { error: "La empresa no tiene correo de recuperación. Configúrelo en Empresa → información (recovery email)." },
      400
    );
  }
  const transport = createSmtpTransport();
  if (!transport) {
    return c.json({ error: "Servidor de correo no configurado (SMTP_URL o SMTP_HOST)." }, 503);
  }
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || "noreply@localhost";
  const webOrigin = (process.env.WEB_APP_ORIGIN || "http://localhost:5173").replace(/\/$/, "");
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });
  const url = `${webOrigin}/restablecer-contrasena?token=${encodeURIComponent(token)}`;
  try {
    await transport.sendMail({
      from,
      to: recovery,
      subject: `Recuperación de contraseña — ${user.organization.name}`,
      text: `Usuario: ${user.username}\n\nRestablezca su contraseña en:\n${url}\n\nSi no solicitó esto, ignore el mensaje.`,
      html: `<p>Usuario: <strong>${user.username}</strong></p><p><a href="${url}">Restablecer contraseña</a></p><p>El enlace expira en 1 hora.</p>`,
    });
  } catch {
    return c.json({ error: "No se pudo enviar el correo. Revise SMTP." }, 500);
  }
  return c.json({ ok: true, message: "Revise el correo de recuperación configurado en la empresa." });
});

app.post("/auth/reset-password", async (c) => {
  const body = await c.req.json<{ token?: string; newPassword?: string }>();
  const token = body.token?.trim();
  const newPassword = body.newPassword ?? "";
  if (!token || newPassword.length < 6) {
    return c.json({ error: "Token y nueva contraseña (mín. 6 caracteres) requeridos" }, 400);
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = await prisma.passwordResetToken.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
    include: { user: true },
  });
  if (!row) return c.json({ error: "Enlace inválido o expirado" }, 400);
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash, permissionsRev: { increment: 1 } },
    });
    await tx.passwordResetToken.delete({ where: { id: row.id } });
  });
  return c.json({ ok: true });
});

app.get("/auth/organizations", async (c) => {
  const orgs = await prisma.organization.findMany({
    select: { id: true, slug: true, name: true },
    orderBy: { name: "asc" },
  });
  return c.json(orgs);
});

app.post("/auth/login", async (c) => {
  const loginIp = clientIpFromHeaders((name) => c.req.header(name));
  if (isLoginBlocked(loginIp)) {
    return c.json({ error: "Demasiados intentos fallidos. Intente de nuevo más tarde." }, 429);
  }

  const body = await c.req.json<{
    organizationSlug?: string;
    organizationId?: string;
    username: string;
    password: string;
  }>();
  const username = body.username?.trim().toUpperCase();
  const password = body.password ?? "";
  if (!username || !password) {
    return c.json({ error: "Usuario y contraseña requeridos" }, 400);
  }

  let orgId = body.organizationId;
  if (!orgId && body.organizationSlug) {
    const org = await prisma.organization.findUnique({
      where: { slug: body.organizationSlug.trim().toLowerCase() },
    });
    orgId = org?.id;
  }
  if (!orgId) {
    const first = await prisma.organization.findFirst();
    if (!first) return c.json({ error: "No hay empresas registradas" }, 400);
    orgId = first.id;
  }

  const user = await prisma.user.findFirst({
    where: { organizationId: orgId, username, active: true },
    include: { organization: true },
  });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    const nowLocked = registerLoginFailure(loginIp);
    if (nowLocked) {
      return c.json({ error: "Demasiados intentos fallidos. Intente de nuevo más tarde." }, 429);
    }
    return c.json({ error: "Credenciales inválidas" }, 401);
  }

  clearLoginFailures(loginIp);

  const localContext = await ensureDefaultBranchDevice(user.organizationId);
  const effectivePermissions = effectivePermissionList(user.role, user.permissionsJson);
  const token = signToken({
    sub: user.id,
    orgId: user.organizationId,
    role: user.role,
    permRev: user.permissionsRev,
    perms: effectivePermissions,
  });
  return c.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      effectivePermissions,
    },
    organization: {
      id: user.organization.id,
      slug: user.organization.slug,
      name: user.organization.name,
      currencySymbol: user.organization.currencySymbol,
    },
    branch: {
      id: localContext.branch.id,
      code: localContext.branch.code,
      name: localContext.branch.name,
    },
    device: {
      id: localContext.device.id,
      code: localContext.device.code,
      name: localContext.device.name,
      mode: localContext.device.mode,
      invoiceSeries: localContext.device.invoiceSeries,
    },
  });
});

const requireAuth = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const h = c.req.header("Authorization");
  const m = h?.match(/^Bearer\s+(.+)$/i);
  if (!m) return c.json({ error: "No autorizado" }, 401);
  try {
    const jwt = verifyToken(m[1]);
    c.set("jwt", jwt);
    await next();
  } catch {
    return c.json({ error: "Token inválido" }, 401);
  }
});

const PERM_STALE_BODY = {
  error: "Permisos o rol actualizados. Inicie sesión de nuevo.",
  code: "PERM_STALE" as const,
};

const requireAdmin = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const jwt = c.get("jwt");
  const row = await prisma.user.findFirst({
    where: { id: jwt.sub, organizationId: jwt.orgId },
    select: { role: true },
  });
  if (!row || row.role !== "admin") return c.json({ error: "Solo administradores" }, 403);
  await next();
});

function requirePermission(...required: PermissionKey[]) {
  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const jwt = c.get("jwt");
    const row = await prisma.user.findFirst({
      where: { id: jwt.sub, organizationId: jwt.orgId },
      select: { role: true, permissionsJson: true, permissionsRev: true },
    });
    if (!row) return c.json({ error: "No autorizado" }, 401);
    if (row.role === "admin") {
      await next();
      return;
    }
    if (jwt.permRev !== undefined && jwt.perms !== undefined) {
      if (row.permissionsRev !== jwt.permRev) {
        return c.json(PERM_STALE_BODY, 401);
      }
      for (const key of required) {
        if (!jwt.perms.includes(key)) {
          return c.json({ error: "Sin permiso para esta operación" }, 403);
        }
      }
      await next();
      return;
    }
    for (const key of required) {
      if (!userHasPermission(row.role, row.permissionsJson, key)) {
        return c.json({ error: "Sin permiso para esta operación" }, 403);
      }
    }
    await next();
  });
}

function parseClientSaleDate(raw: unknown): Date | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Al menos uno de los permisos (JWT `perms` o BD). */
function requireAnyPermission(...required: PermissionKey[]) {
  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const jwt = c.get("jwt");
    const row = await prisma.user.findFirst({
      where: { id: jwt.sub, organizationId: jwt.orgId },
      select: { role: true, permissionsJson: true, permissionsRev: true },
    });
    if (!row) return c.json({ error: "No autorizado" }, 401);
    if (row.role === "admin") {
      await next();
      return;
    }
    if (jwt.permRev !== undefined && jwt.perms !== undefined) {
      if (row.permissionsRev !== jwt.permRev) {
        return c.json(PERM_STALE_BODY, 401);
      }
      const ok = required.some((key) => jwt.perms!.includes(key));
      if (!ok) return c.json({ error: "Sin permiso para esta operación" }, 403);
      await next();
      return;
    }
    const ok = required.some((key) => userHasPermission(row.role, row.permissionsJson, key));
    if (!ok) return c.json({ error: "Sin permiso para esta operación" }, 403);
    await next();
  });
}

const api = new Hono<{ Variables: Variables }>();
api.use("*", requireAuth);

api.get("/auth/me", async (c) => {
  const jwt = c.get("jwt");
  const user = await prisma.user.findUnique({
    where: { id: jwt.sub },
    include: { organization: true },
  });
  if (!user) return c.json({ error: "Usuario no encontrado" }, 404);
  if (user.organizationId !== jwt.orgId) return c.json({ error: "No autorizado" }, 401);
  if (jwt.permRev !== undefined && user.permissionsRev !== jwt.permRev) {
    return c.json(PERM_STALE_BODY, 401);
  }
  const localContext = await ensureDefaultBranchDevice(user.organizationId);
  const effectivePermissions = effectivePermissionList(user.role, user.permissionsJson);
  return c.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      effectivePermissions,
    },
    organization: {
      id: user.organization.id,
      slug: user.organization.slug,
      name: user.organization.name,
      currencySymbol: user.organization.currencySymbol,
      country: user.organization.country,
    },
    branch: {
      id: localContext.branch.id,
      code: localContext.branch.code,
      name: localContext.branch.name,
    },
    device: {
      id: localContext.device.id,
      code: localContext.device.code,
      name: localContext.device.name,
      mode: localContext.device.mode,
      invoiceSeries: localContext.device.invoiceSeries,
    },
  });
});

api.get("/organizations", async (c) => {
  const jwt = c.get("jwt");
  const orgs = await prisma.organization.findMany({
    where: { id: jwt.orgId },
    select: { id: true, slug: true, name: true },
  });
  return c.json(orgs);
});

api.get("/organizations/current", async (c) => {
  const jwt = c.get("jwt");
  const org = await prisma.organization.findUnique({ where: { id: jwt.orgId } });
  if (!org) return c.json({ error: "No encontrado" }, 404);
  return c.json(org);
});

api.get("/branches", async (c) => {
  const jwt = c.get("jwt");
  await ensureDefaultBranchDevice(jwt.orgId);
  const rows = await prisma.branch.findMany({
    where: { organizationId: jwt.orgId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return c.json(rows);
});

api.get("/devices", async (c) => {
  const jwt = c.get("jwt");
  await ensureDefaultBranchDevice(jwt.orgId);
  const rows = await prisma.device.findMany({
    where: { organizationId: jwt.orgId },
    include: { branch: { select: { id: true, code: true, name: true } } },
    orderBy: { name: "asc" },
  });
  return c.json(rows);
});

api.post("/devices/register", async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    code?: string;
    name?: string;
    branchId?: string | null;
    mode?: string;
    invoiceSeries?: string;
  }>();
  const fallback = await ensureDefaultBranchDevice(jwt.orgId);
  const code = (body.code || process.env.DEVICE_CODE || "CAJA-01").trim().toUpperCase();
  const name = (body.name || body.code || process.env.DEVICE_NAME || "Caja principal").trim();
  if (!code || !name) return c.json({ error: "code y name requeridos" }, 400);
  const branchId = body.branchId || fallback.branch.id;
  const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId: jwt.orgId } });
  if (!branch) return c.json({ error: "Sucursal no encontrada" }, 404);

  const existing = await prisma.device.findFirst({ where: { organizationId: jwt.orgId, code } });
  const data = {
    branchId: branch.id,
    name,
    mode: body.mode?.trim().toUpperCase() || "LOCAL",
    invoiceSeries: (body.invoiceSeries || code.replace(/[^A-Z0-9]/g, "").slice(-4) || "A").trim().toUpperCase(),
    active: true,
    lastSeenAt: new Date(),
  };
  const device = existing
    ? await prisma.device.update({ where: { id: existing.id }, data })
    : await prisma.device.create({ data: { organizationId: jwt.orgId, code, ...data } });
  return c.json(device);
});

api.get("/sync/status", async (c) => {
  const jwt = c.get("jwt");
  const localContext = await ensureDefaultBranchDevice(jwt.orgId);
  const supabase = getSupabaseConfig();
  const [pendingEvents, failedEvents, reviewEvents, lastBatch, supabaseTest] = await Promise.all([
    prisma.syncEvent.count({ where: { organizationId: jwt.orgId, syncStatus: "PENDING" } }),
    prisma.syncEvent.count({ where: { organizationId: jwt.orgId, syncStatus: "FAILED" } }),
    prisma.syncEvent.count({ where: { organizationId: jwt.orgId, syncStatus: "REVIEW" } }),
    prisma.syncBatch.findFirst({ where: { organizationId: jwt.orgId }, orderBy: { startedAt: "desc" } }),
    testSupabaseConnection(),
  ]);
  return c.json({
    mode: localContext.device.mode,
    branch: { id: localContext.branch.id, code: localContext.branch.code, name: localContext.branch.name },
    device: {
      id: localContext.device.id,
      code: localContext.device.code,
      name: localContext.device.name,
      invoiceSeries: localContext.device.invoiceSeries,
    },
    pendingEvents,
    failedEvents,
    reviewEvents,
    lastBatch,
    cloudConfigured: supabase.configured,
    cloudConnected: supabaseTest.ok,
    cloudMessage: supabaseTest.message,
    storageBucket: supabase.bucket,
    syncTable: supabase.syncTable,
  });
});

api.get("/sync/test", async (c) => {
  return c.json(await testSupabaseConnection());
});

api.post("/sync/push", async (c) => {
  const jwt = c.get("jwt");
  const localContext = await ensureDefaultBranchDevice(jwt.orgId);
  const batch = await prisma.syncBatch.create({
    data: {
      organizationId: jwt.orgId,
      direction: "PUSH",
      status: "RUNNING",
      source: localContext.device.code,
      target: process.env.SUPABASE_URL || "SUPABASE_PENDING",
    },
  });
  try {
    const result = await pushPendingEvents(prisma, jwt.orgId);
    const done = await prisma.syncBatch.update({
      where: { id: batch.id },
      data: { status: "DONE", finishedAt: new Date() },
    });
    return c.json({ batch: done, ...result, message: "Cambios locales subidos a Supabase." });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error de sincronizacion";
    const failed = await prisma.syncBatch.update({
      where: { id: batch.id },
      data: { status: "FAILED", finishedAt: new Date(), error: msg },
    });
    return c.json({ batch: failed, error: msg }, msg === "SUPABASE_NOT_CONFIGURED" ? 400 : 502);
  }
});

api.post("/sync/pull", async (c) => {
  const jwt = c.get("jwt");
  const localContext = await ensureDefaultBranchDevice(jwt.orgId);
  const batch = await prisma.syncBatch.create({
    data: {
      organizationId: jwt.orgId,
      direction: "PULL",
      status: "RUNNING",
      source: process.env.SUPABASE_URL || "SUPABASE_PENDING",
      target: localContext.device.code,
    },
  });
  try {
    const result = await pullCloudEvents(prisma, jwt.orgId, localContext.device.id);
    const done = await prisma.syncBatch.update({
      where: { id: batch.id },
      data: { status: "DONE", finishedAt: new Date() },
    });
    return c.json({ batch: done, ...result, message: "Cambios de Supabase revisados." });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error de sincronizacion";
    const failed = await prisma.syncBatch.update({
      where: { id: batch.id },
      data: { status: "FAILED", finishedAt: new Date(), error: msg },
    });
    return c.json({ batch: failed, error: msg }, msg === "SUPABASE_NOT_CONFIGURED" ? 400 : 502);
  }
});

api.patch("/organizations/current", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<Record<string, unknown>>();
  const allowed = [
    "name",
    "slogan",
    "taxId",
    "taxIdType",
    "phone",
    "email",
    "website",
    "address",
    "city",
    "department",
    "zip",
    "recoveryEmail",
    "country",
    "currency",
    "currencySymbol",
    "language",
    "logoUrl",
  ] as const;
  const data: Record<string, string> = {};
  for (const k of allowed) {
    if (body[k] !== undefined) data[k] = String(body[k]);
  }
  const org = await prisma.organization.update({ where: { id: jwt.orgId }, data });
  return c.json(org);
});

api.post("/org/logo", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const b = await c.req.parseBody();
  const file = b.file;
  if (!file || typeof file !== "object" || typeof (file as Blob).arrayBuffer !== "function") {
    return c.json({ error: "Archivo requerido (campo file)" }, 400);
  }
  const blob = file as Blob;
  const type = blob.type || "";
  const ext =
    type === "image/png" ? "png" : type === "image/jpeg" || type === "image/jpg" ? "jpg" : type === "image/webp" ? "webp" : null;
  if (!ext) return c.json({ error: "Use imagen PNG, JPEG o WebP" }, 400);
  await mkdir(LOGO_UPLOAD_DIR, { recursive: true });
  const buf = Buffer.from(await blob.arrayBuffer());
  const filename = `${jwt.orgId}.${ext}`;
  await writeFile(join(LOGO_UPLOAD_DIR, filename), buf);
  const base = process.env.API_PUBLIC_URL?.replace(/\/$/, "") ?? "";
  const logoUrl = base ? `${base}/uploads/logos/${filename}` : `/uploads/logos/${filename}`;
  const org = await prisma.organization.update({ where: { id: jwt.orgId }, data: { logoUrl } });
  return c.json({ logoUrl: org.logoUrl });
});

const userListSelect = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  active: true,
  createdAt: true,
  permissionsJson: true,
} as const;

api.get("/users", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const users = await prisma.user.findMany({
    where: { organizationId: jwt.orgId },
    select: userListSelect,
  });
  return c.json(users);
});

api.post("/users", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    username?: string;
    password?: string;
    displayName?: string;
    role?: string;
    active?: boolean;
    permissionsJson?: string | Record<string, unknown>;
  }>();
  const username = body.username?.trim().toUpperCase();
  const password = body.password ?? "";
  const displayName = body.displayName?.trim();
  if (!username || !password || !displayName) {
    return c.json({ error: "Usuario, contraseña y nombre requeridos" }, 400);
  }
  const role = (body.role ?? "cajero").toLowerCase();
  if (!["admin", "cajero", "vendedor"].includes(role)) {
    return c.json({ error: "Rol inválido" }, 400);
  }
  let permJson = "{}";
  if (body.permissionsJson !== undefined) {
    const raw =
      typeof body.permissionsJson === "string"
        ? parsePermissionsJson(body.permissionsJson)
        : (body.permissionsJson as { allow?: string[]; deny?: string[] });
    permJson = serializePermissionsPayload(raw);
  }
  try {
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        organizationId: jwt.orgId,
        username,
        passwordHash,
        displayName,
        role,
        active: body.active !== false,
        permissionsJson: permJson,
      },
      select: userListSelect,
    });
    return c.json(user, 201);
  } catch {
    return c.json({ error: "Usuario duplicado" }, 409);
  }
});

api.patch("/users/:id", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const body = await c.req.json<{
    displayName?: string;
    role?: string;
    active?: boolean;
    password?: string;
    permissionsJson?: string | Record<string, unknown>;
  }>();
  const existing = await prisma.user.findFirst({ where: { id, organizationId: jwt.orgId } });
  if (!existing) return c.json({ error: "No encontrado" }, 404);
  const data: {
    displayName?: string;
    role?: string;
    active?: boolean;
    passwordHash?: string;
    permissionsJson?: string;
  } = {};
  if (body.displayName !== undefined) data.displayName = String(body.displayName).trim();
  if (body.role !== undefined) {
    const role = String(body.role).toLowerCase();
    if (!["admin", "cajero", "vendedor"].includes(role)) return c.json({ error: "Rol inválido" }, 400);
    data.role = role;
  }
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.password && String(body.password).length > 0) {
    data.passwordHash = await hashPassword(String(body.password));
  }
  if (body.permissionsJson !== undefined) {
    const raw =
      typeof body.permissionsJson === "string"
        ? parsePermissionsJson(body.permissionsJson)
        : (body.permissionsJson as { allow?: string[]; deny?: string[] });
    data.permissionsJson = serializePermissionsPayload(raw);
  }
  const bumpPermRev =
    (data.role !== undefined && data.role !== existing.role) ||
    (data.permissionsJson !== undefined && data.permissionsJson !== existing.permissionsJson);
  await prisma.user.update({
    where: { id },
    data: {
      ...data,
      ...(bumpPermRev ? { permissionsRev: { increment: 1 } } : {}),
    },
  });
  const user = await prisma.user.findUnique({
    where: { id },
    select: userListSelect,
  });
  return c.json(user);
});

api.get("/products", async (c) => {
  const jwt = c.get("jwt");
  const q = c.req.query("q")?.trim();
  const stock = c.req.query("stock")?.trim();
  const supplierId = c.req.query("supplierId")?.trim();
  const touch = c.req.query("touch")?.trim();
  const forPos = c.req.query("forPos")?.trim();
  const expiresBefore = c.req.query("expiresBefore")?.trim();
  const expiresAfter = c.req.query("expiresAfter")?.trim();

  const where: {
    organizationId: string;
    OR?: { name?: { contains: string }; sku?: { contains: string }; barcode?: { contains: string }; quickCode?: { contains: string } }[];
    stock?: { gt?: number; lte?: number };
    supplierId?: string;
    active?: boolean;
    productType?: { not: string };
    id?: { in: string[] };
    expiresAt?: { gte?: Date; lte?: Date };
  } = { organizationId: jwt.orgId };

  if (touch === "1" || forPos === "1") {
    where.active = true;
    where.productType = { not: "INSUMO" };
  }

  if (q) {
    const tokens = q
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length > 1) {
      where.OR = tokens.flatMap((token) => [
        { name: { contains: token } },
        { sku: { contains: token } },
        { barcode: { contains: token } },
        { quickCode: { contains: token } },
      ]);
    } else {
      const term = tokens[0] ?? q;
      where.OR = [
        { name: { contains: term } },
        { sku: { contains: term } },
        { barcode: { contains: term } },
        { quickCode: { contains: term } },
      ];
    }
  }
  if (stock === "with") where.stock = { gt: 0 };
  if (stock === "without") where.stock = { lte: 0 };
  if (stock === "low") {
    const cand = await prisma.product.findMany({
      where: { organizationId: jwt.orgId, active: true },
      select: { id: true, stock: true, minStock: true },
      take: 12000,
    });
    const ids = cand.filter((p) => p.stock <= p.minStock).map((p) => p.id);
    where.id = { in: ids.length ? ids : ["__none__"] };
  }
  if (supplierId) where.supplierId = supplierId;
  if (expiresBefore || expiresAfter) {
    const range: { gte?: Date; lte?: Date } = {};
    if (expiresAfter) range.gte = new Date(expiresAfter + "T00:00:00");
    if (expiresBefore) range.lte = new Date(expiresBefore + "T23:59:59.999");
    where.expiresAt = range;
  }

  const paginated = wantsPaginated((name) => c.req.query(name));
  if (paginated) {
    const page = parsePageParams((name) => c.req.query(name), 50);
    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { name: "asc" },
        skip: page.skip,
        take: page.take,
        include: { supplier: { select: { id: true, name: true } } },
      }),
      prisma.product.count({ where }),
    ]);
    return c.json({
      items,
      total,
      page: page.page,
      pageSize: page.pageSize,
      filters: { q: q ?? "", stock: stock ?? "", supplierId: supplierId ?? "", touch: touch ?? "", forPos: forPos ?? "" },
    });
  }

  const rawLimit = Number(c.req.query("limit"));
  const parsedLimit = Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 5000;
  const limit = Math.min(8000, Math.max(1, parsedLimit));
  const take = touch === "1" || forPos === "1" ? 500 : limit;

  const products = await prisma.product.findMany({
    where,
    orderBy: { name: "asc" },
    take,
    include: { supplier: { select: { id: true, name: true } } },
  });
  return c.json(products);
});

api.get("/products/stock-by-location", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const productId = c.req.query("productId")?.trim();
  if (!productId) return c.json({ error: "productId requerido" }, 400);
  const rows = await prisma.productStock.findMany({
    where: { organizationId: jwt.orgId, productId },
    include: { location: { select: { id: true, code: true, name: true } } },
  });
  return c.json(rows);
});

api.get("/products/labels/preview", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) return c.json({ error: "ids requerido" }, 400);
  const products = await prisma.product.findMany({
    where: { organizationId: jwt.orgId, id: { in: ids.slice(0, 200) } },
    select: { sku: true, name: true, barcode: true, price: true },
  });
  const rows = products
    .map(
      (p) =>
 `<div class="lbl"><div class="bc">${p.barcode ?? p.sku}</div><strong>${escapeHtml(p.name)}</strong><div>${p.sku}</div><div>L ${p.price.toFixed(2)}</div></div>`
    )
    .join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    body{font-family:system-ui,sans-serif;margin:12px}.lbl{border:1px solid #ccc;padding:8px;margin:8px;width:200px;display:inline-block;vertical-align:top}
    .bc{font-family:monospace;font-size:11px}</style></head><body>${rows}<script>window.onload=function(){window.print()}</script></body></html>`;
  c.header("Content-Type", "text/html; charset=utf-8");
  return c.body(html);
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

api.get("/products/:id/movements", async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const raw = Number(c.req.query("limit"));
  const limit = Number.isFinite(raw) ? Math.trunc(raw) : 80;
  const rows = await getProductMovements(prisma, jwt.orgId, id, limit);
  if (rows === null) return c.json({ error: "No encontrado" }, 404);
  return c.json({ movements: rows });
});

api.get("/products/:id", async (c) => {
  const jwt = c.get("jwt");
  const p = await prisma.product.findFirst({
    where: { id: c.req.param("id"), organizationId: jwt.orgId },
    include: productIncludeKit,
  });
  if (!p) return c.json({ error: "No encontrado" }, 404);
  return c.json(p);
});

api.post("/products", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    sku: string;
    name: string;
    description?: string;
    unit?: string;
    price: number;
    price2?: number;
    price3?: number;
    price4?: number;
    cost?: number;
    taxPercent?: number;
    taxName?: string;
    stock?: number;
    minStock?: number;
    category?: string;
    barcode?: string | null;
    quickCode?: string | null;
    location?: string | null;
    brand?: string | null;
    imageUrl?: string | null;
    productType?: string;
    supplierId?: string | null;
    esGranel?: boolean;
    volumePricesJson?: unknown;
    kitLines?: KitLineInput[];
    printOnKitchenOrder?: boolean;
    lotCode?: string | null;
    expiresAt?: string | null;
  }>();
  const sku = body.sku?.trim();
  if (!sku || !body.name?.trim()) return c.json({ error: "SKU y nombre requeridos" }, 400);
  const productType = (body.productType ?? "PRODUCTO").toUpperCase();
  if (!isValidProductType(productType)) {
    return c.json({ error: "Tipo de producto inválido" }, 400);
  }
  if (productType === "KIT" && (!body.kitLines || body.kitLines.length === 0)) {
    return c.json({ error: "Un kit debe incluir al menos un producto (tipo PRODUCTO)" }, 400);
  }
  const localContext = await ensureDefaultBranchDevice(jwt.orgId);
  try {
    const p = await prisma.$transaction(async (tx) => {
      const row = await tx.product.create({
        data: {
          organizationId: jwt.orgId,
          branchId: localContext.branch.id,
          sku,
          name: body.name.trim(),
          description: body.description,
          unit: body.unit ?? "UND",
          price: Number(body.price) || 0,
          price2: body.price2,
          price3: body.price3,
          price4: body.price4,
          cost: body.cost ?? 0,
          taxPercent: body.taxPercent ?? 0,
          taxName: body.taxName ?? "ISV",
          stock: productType === "KIT" ? 0 : body.stock ?? 0,
          minStock: body.minStock ?? 0,
          category: body.category,
          barcode: body.barcode ?? undefined,
          quickCode: body.quickCode ?? undefined,
          location: body.location ?? undefined,
          brand: body.brand ?? undefined,
          imageUrl: body.imageUrl ?? undefined,
          productType,
          supplierId: body.supplierId || null,
          esGranel: Boolean(body.esGranel),
          printOnKitchenOrder: body.printOnKitchenOrder !== false,
          volumePricesJson: normalizeVolumePricesPayload(body.volumePricesJson ?? []),
          syncStatus: "PENDING",
          originDeviceId: localContext.device.id,
          lotCode: body.lotCode?.trim() ? String(body.lotCode).trim() : null,
          expiresAt:
            body.expiresAt && String(body.expiresAt).trim()
              ? new Date(String(body.expiresAt).trim() + "T12:00:00")
              : null,
        },
      });
      if (productType === "KIT") {
        await replaceProductKitLines(tx, row.id, jwt.orgId, body.kitLines, "KIT");
      }
      await tx.syncEvent.create({
        data: {
          organizationId: jwt.orgId,
          branchId: localContext.branch.id,
          deviceId: localContext.device.id,
          originDeviceId: localContext.device.id,
          entityType: "Product",
          entityId: row.id,
          action: "CREATE",
          syncStatus: "PENDING",
          payloadJson: JSON.stringify({ id: row.id }),
        },
      });
      return tx.product.findUnique({
        where: { id: row.id },
        include: productIncludeKit,
      });
    });
    return c.json(p, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "KIT_EMPTY" || msg === "KIT_BAD_LINE") {
      return c.json({ error: "El kit debe incluir al menos un producto con cantidad válida" }, 400);
    }
    if (msg === "KIT_BAD_COMPONENT") {
      return c.json({ error: "Solo productos tipo PRODUCTO pueden ser componentes de un kit" }, 400);
    }
    if (msg === "KIT_COMPONENT_NOT_FOUND") return c.json({ error: "Componente no encontrado" }, 400);
    if (msg === "KIT_SELF_REF") return c.json({ error: "Un kit no puede incluirse a sí mismo" }, 400);
    if (msg === "KIT_DUP_COMPONENT") return c.json({ error: "No repita el mismo producto en el kit" }, 400);
    return c.json({ error: "SKU duplicado" }, 409);
  }
});

api.patch("/products/:id", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();
  const data: Record<string, unknown> = {};
  const num = ["price", "price2", "price3", "price4", "cost", "taxPercent", "stock", "minStock"];
  const str = [
    "sku",
    "name",
    "description",
    "unit",
    "taxName",
    "category",
    "active",
    "barcode",
    "quickCode",
    "location",
    "brand",
    "imageUrl",
    "productType",
    "lotCode",
  ];
  for (const k of num) if (body[k] !== undefined) data[k] = Number(body[k]);
  for (const k of str) if (body[k] !== undefined) data[k] = body[k];
  if (body.expiresAt !== undefined) {
    const raw = body.expiresAt;
    data.expiresAt =
      raw === null || raw === ""
        ? null
        : new Date(String(raw).trim() + "T12:00:00");
  }
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.esGranel !== undefined) data.esGranel = Boolean(body.esGranel);
  if (body.printOnKitchenOrder !== undefined) data.printOnKitchenOrder = Boolean(body.printOnKitchenOrder);
  if (body.supplierId !== undefined) data.supplierId = body.supplierId === "" ? null : body.supplierId;
  if (body.volumePricesJson !== undefined) {
    data.volumePricesJson = normalizeVolumePricesPayload(body.volumePricesJson);
  }
  if (data.productType) {
    const pt = String(data.productType).toUpperCase();
    if (!isValidProductType(pt)) return c.json({ error: "Tipo inválido" }, 400);
    data.productType = pt;
    if (pt === "KIT") data.stock = 0;
  }
  const localContext = await ensureDefaultBranchDevice(jwt.orgId);
  data.branchId = data.branchId ?? localContext.branch.id;
  data.originDeviceId = localContext.device.id;
  data.syncStatus = "PENDING";
  data.version = { increment: 1 };
  const kitLinesBody = body.kitLines as KitLineInput[] | undefined;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.product.updateMany({ where: { id, organizationId: jwt.orgId }, data });
      if (u.count === 0) return null;
      const fresh = await tx.product.findUnique({ where: { id } });
      if (!fresh) return null;
      if (fresh.productType !== "KIT") {
        await tx.productKitLine.deleteMany({ where: { kitProductId: id } });
      } else if (kitLinesBody !== undefined) {
        await replaceProductKitLines(tx, id, jwt.orgId, kitLinesBody, "KIT");
      }
      if (fresh.productType === "KIT") {
        const n = await tx.productKitLine.count({ where: { kitProductId: id } });
        if (n === 0) throw new Error("KIT_EMPTY");
      }
      await tx.syncEvent.create({
        data: {
          organizationId: jwt.orgId,
          branchId: localContext.branch.id,
          deviceId: localContext.device.id,
          originDeviceId: localContext.device.id,
          entityType: "Product",
          entityId: id,
          action: "UPDATE",
          syncStatus: "PENDING",
          payloadJson: JSON.stringify({ id }),
        },
      });
      return tx.product.findUnique({
        where: { id },
        include: productIncludeKit,
      });
    });
    if (!updated) return c.json({ error: "No encontrado" }, 404);
    return c.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "KIT_EMPTY" || msg === "KIT_BAD_LINE") {
      return c.json({ error: "El kit debe incluir al menos un producto con cantidad válida" }, 400);
    }
    if (msg === "KIT_BAD_COMPONENT") {
      return c.json({ error: "Solo productos tipo PRODUCTO pueden ser componentes de un kit" }, 400);
    }
    if (msg === "KIT_COMPONENT_NOT_FOUND") return c.json({ error: "Componente no encontrado" }, 400);
    if (msg === "KIT_SELF_REF") return c.json({ error: "Un kit no puede incluirse a sí mismo" }, 400);
    if (msg === "KIT_DUP_COMPONENT") return c.json({ error: "No repita el mismo producto en el kit" }, 400);
    throw e;
  }
});

api.delete("/products/:id", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  await prisma.product.deleteMany({ where: { id, organizationId: jwt.orgId } });
  return c.json({ ok: true });
});

api.get("/customers", async (c) => {
  const jwt = c.get("jwt");
  const list = await prisma.customer.findMany({
    where: { organizationId: jwt.orgId },
    orderBy: { name: "asc" },
    take: 5000,
  });
  return c.json(list);
});

api.get("/customers/:id", async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const cust = await prisma.customer.findFirst({
    where: { id, organizationId: jwt.orgId },
  });
  if (!cust) return c.json({ error: "No encontrado" }, 404);
  return c.json(cust);
});

api.post("/customers", async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    code?: string;
    name: string;
    address?: string;
    phone?: string;
    taxId?: string;
    notes?: string;
    defaultPriceTier?: number | null;
  }>();
  if (!body.name?.trim()) return c.json({ error: "Nombre requerido" }, 400);
  const tier =
    body.defaultPriceTier == null
      ? null
      : Math.min(4, Math.max(1, Math.trunc(Number(body.defaultPriceTier))));
  const cust = await prisma.customer.create({
    data: {
      organizationId: jwt.orgId,
      code: body.code ?? "0",
      name: body.name.trim(),
      address: body.address,
      phone: body.phone,
      taxId: body.taxId,
      notes: body.notes,
      defaultPriceTier: tier,
    },
  });
  return c.json(cust, 201);
});

async function restoreStockForSaleLine(
  tx: Prisma.TransactionClient,
  orgId: string,
  line: { productId: string; qty: number }
) {
  const prod = await tx.product.findUnique({ where: { id: line.productId } });
  if (!prod) throw new Error("PRODUCT_NOT_FOUND");
  if (prod.productType === "SERVICIO") return;
  if (prod.productType === "KIT") {
    const kitLines = await tx.productKitLine.findMany({ where: { kitProductId: prod.id } });
    for (const kl of kitLines) {
      await adjustProductStock(tx, orgId, kl.componentProductId, line.qty * kl.qty);
    }
    return;
  }
  await adjustProductStock(tx, orgId, line.productId, line.qty);
}

api.patch("/customers/:id", async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();
  const data: Record<string, unknown> = {};
  for (const k of ["code", "name", "address", "phone", "taxId", "notes"]) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  if (body.defaultPriceTier !== undefined) {
    const t = body.defaultPriceTier;
    data.defaultPriceTier =
      t === null ? null : Math.min(4, Math.max(1, Math.trunc(Number(t))));
  }
  const r = await prisma.customer.updateMany({ where: { id, organizationId: jwt.orgId }, data });
  if (r.count === 0) return c.json({ error: "No encontrado" }, 404);
  return c.json(await prisma.customer.findUnique({ where: { id } }));
});

api.get("/suppliers", async (c) => {
  const jwt = c.get("jwt");
  return c.json(
    await prisma.supplier.findMany({
      where: { organizationId: jwt.orgId },
      orderBy: { name: "asc" },
      take: 2000,
    })
  );
});

api.post("/suppliers", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    name: string;
    phone?: string;
    email?: string;
    taxId?: string;
    address?: string;
  }>();
  if (!body.name?.trim()) return c.json({ error: "Nombre requerido" }, 400);
  const s = await prisma.supplier.create({
    data: {
      organizationId: jwt.orgId,
      name: body.name.trim(),
      phone: body.phone,
      email: body.email,
      taxId: body.taxId,
      address: body.address,
    },
  });
  return c.json(s, 201);
});

api.patch("/suppliers/:id", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();
  const data: Record<string, unknown> = {};
  for (const k of ["name", "phone", "email", "taxId", "address"]) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  const r = await prisma.supplier.updateMany({ where: { id, organizationId: jwt.orgId }, data });
  if (r.count === 0) return c.json({ error: "No encontrado" }, 404);
  return c.json(await prisma.supplier.findUnique({ where: { id } }));
});

/** Fecha límite de autorización SAR (solo fecha YYYY-MM-DD, fin de día local). */
function endOfYmdDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const end = new Date(y, mo - 1, d, 23, 59, 59, 999);
  return Number.isNaN(end.getTime()) ? null : end;
}

function assertSarRangeValidUntil(invParsed: Record<string, unknown>, saleDate: Date) {
  const sar = invParsed.sar as Record<string, unknown> | undefined;
  if (!sar || typeof sar !== "object") return;
  const raw = sar.rangeValidUntil;
  if (typeof raw !== "string" || !raw.trim()) return;
  const limit = endOfYmdDate(raw);
  if (!limit) return;
  if (saleDate.getTime() > limit.getTime()) throw new Error("SAR_AUTH_EXPIRED");
}

api.post("/sales", async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    customerId?: string | null;
    terms?: string;
    notes?: string;
    sellerName?: string;
    priceTier?: number;
    paid?: number;
    /** ISO 8601; si se omite se usa la fecha/hora del servidor. */
    saleDate?: string;
    lines: { productId: string; qty: number; unitPrice?: number; discountPercent?: number }[];
  }>();
  if (!body.lines?.length) return c.json({ error: "Agregue líneas" }, 400);

  const terms = normalizeSaleTerms(body.terms ?? "CONTADO");
  const priceTier = Math.min(4, Math.max(1, body.priceTier ?? 1));
  const localContext = await ensureDefaultBranchDevice(jwt.orgId);

  if (isCreditSaleTerm(terms)) {
    const cid = typeof body.customerId === "string" ? body.customerId.trim() : "";
    if (!cid) {
      return c.json({ error: "Las ventas a crédito requieren un cliente registrado" }, 400);
    }
    const cust = await prisma.customer.findFirst({
      where: { id: cid, organizationId: jwt.orgId },
    });
    if (!cust) return c.json({ error: "Cliente no encontrado" }, 400);
  }

  try {
  const result = await prisma.$transaction(async (tx) => {
    let subtotal = 0;
    let tax = 0;
    const saleLines: { productId: string; qty: number; unitPrice: number; discountPercent: number; taxPercent: number; lineTotal: number }[] = [];

    const stPos = await tx.organizationSettings.findUnique({ where: { organizationId: jwt.orgId } });
    const genPos = JSON.parse(stPos?.generalJson || "{}") as Record<string, unknown>;
    const posBeh = genPos.posBehavior as Record<string, unknown> | undefined;
    const allowOversell = posBeh?.warnOutOfStock === true;

    for (const line of body.lines) {
      const product = await tx.product.findFirst({
        where: { id: line.productId, organizationId: jwt.orgId },
      });
      if (!product) throw new Error("PRODUCT_NOT_FOUND");
      if (product.productType === "INSUMO") throw new Error("INSUMO_NOT_SALEABLE");
      const isService = product.productType === "SERVICIO";
      const isKit = product.productType === "KIT";
      if (isKit) {
        if (!allowOversell) await assertKitSaleStock(tx, product.id, line.qty);
      } else if (!isService && product.stock < line.qty && !allowOversell) {
        throw new Error("INSUFFICIENT_STOCK");
      }
      const unitPrice =
        line.unitPrice ?? resolveProductUnitPrice(product, line.qty, priceTier);
      const discountPercent = line.discountPercent ?? 0;
      const base = unitPrice * line.qty * (1 - discountPercent / 100);
      const taxPercent = product.taxPercent;
      const lineTax = base * (taxPercent / 100);
      const lineTotal = base + lineTax;
      subtotal += base;
      tax += lineTax;
      saleLines.push({
        productId: product.id,
        qty: line.qty,
        unitPrice,
        discountPercent,
        taxPercent,
        lineTotal,
      });
    }

    const total = subtotal + tax;
    const paid = resolveSalePaid(total, terms, body.paid);

    const stSet = await tx.organizationSettings.findUnique({ where: { organizationId: jwt.orgId } });
    const invParsed = JSON.parse(stSet?.invoiceJson || "{}") as Record<string, unknown>;
    const saleDateResolved = parseClientSaleDate(body.saleDate) ?? new Date();
    assertSarRangeValidUntil(invParsed, saleDateResolved);

    let invoiceNumber: string;
    const sar = invParsed.sar as Record<string, unknown> | undefined;
    if (sar && sar.autoNumber === true) {
      const next = Number(sar.nextNum ?? 1);
      const end = Number(sar.rangeEnd ?? 99999999);
      if (next > end) throw new Error("SAR_RANGE_EXHAUSTED");
      const ser = String(sar.series ?? "").trim();
      invoiceNumber = ser ? `${ser}-${String(next).padStart(8, "0")}` : String(next).padStart(8, "0");
      sar.nextNum = next + 1;
      if (stSet) {
        await tx.organizationSettings.update({
          where: { organizationId: jwt.orgId },
          data: { invoiceJson: JSON.stringify({ ...invParsed, sar }) },
        });
      } else {
        await tx.organizationSettings.create({
          data: {
            organizationId: jwt.orgId,
            invoiceJson: JSON.stringify({ ...invParsed, sar }),
          },
        });
      }
    } else {
      let series = await tx.documentSeries.findFirst({
        where: {
          organizationId: jwt.orgId,
          documentType: "SALE",
          deviceId: localContext.device.id,
          active: true,
        },
      });
      if (!series) {
        series = await tx.documentSeries.create({
          data: {
            organizationId: jwt.orgId,
            branchId: localContext.branch.id,
            deviceId: localContext.device.id,
            documentType: "SALE",
            prefix: `${localContext.device.invoiceSeries}-`,
            nextNumber: 1,
            padding: 6,
          },
        });
      }
      invoiceNumber = `${series.prefix}${String(series.nextNumber).padStart(series.padding, "0")}`;
      await tx.documentSeries.update({
        where: { id: series.id },
        data: { nextNumber: { increment: 1 } },
      });
    }

    const sale = await tx.sale.create({
      data: {
        organizationId: jwt.orgId,
        branchId: localContext.branch.id,
        deviceId: localContext.device.id,
        originDeviceId: localContext.device.id,
        userId: jwt.sub,
        customerId: body.customerId || null,
        invoiceNumber,
        terms,
        notes: body.notes,
        sellerName: body.sellerName,
        priceTier,
        subtotal,
        tax,
        total,
        paid,
        saleDate: saleDateResolved,
        syncStatus: "PENDING",
        lines: { create: saleLines },
      },
      include: {
        lines: { include: { product: true } },
        customer: true,
        user: { select: { id: true, displayName: true, username: true } },
      },
    });

    for (const line of saleLines) {
      const prod = await tx.product.findUnique({ where: { id: line.productId } });
      if (prod?.productType === "SERVICIO") continue;
      if (prod?.productType === "KIT") {
        await decrementStockForKitSale(tx, jwt.orgId, prod.id, line.qty);
        continue;
      }
      await adjustProductStock(tx, jwt.orgId, line.productId, -line.qty);
    }

    await tx.syncEvent.create({
      data: {
        organizationId: jwt.orgId,
        branchId: localContext.branch.id,
        deviceId: localContext.device.id,
        originDeviceId: localContext.device.id,
        entityType: "Sale",
        entityId: sale.id,
        action: "CREATE",
        syncStatus: "PENDING",
        payloadJson: JSON.stringify({ id: sale.id, invoiceNumber }),
      },
    });

    return sale;
  });

  return c.json(result, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "PRODUCT_NOT_FOUND") return c.json({ error: "Producto no encontrado" }, 400);
    if (msg === "INSUFFICIENT_STOCK") return c.json({ error: "Stock insuficiente" }, 400);
    if (msg === "KIT_EMPTY") return c.json({ error: "El kit no tiene componentes configurados" }, 400);
    if (msg === "KIT_BAD_COMPONENT") return c.json({ error: "Error en componentes del kit" }, 400);
    if (msg === "INSUMO_NOT_SALEABLE") return c.json({ error: "Los insumos no se venden en POS" }, 400);
    if (msg === "SAR_RANGE_EXHAUSTED") {
      return c.json({ error: "Rango de facturación SAR agotado; actualice configuración" }, 400);
    }
    if (msg === "SAR_AUTH_EXPIRED") {
      return c.json(
        { error: "Fecha de venta posterior al límite de autorización SAR; revise configuración o la fecha del documento" },
        400
      );
    }
    throw e;
  }
});

api.get("/sales", async (c) => {
  const jwt = c.get("jwt");
  const from = c.req.query("from")?.trim();
  const to = c.req.query("to")?.trim();
  const q = c.req.query("q")?.trim();
  const customerId = c.req.query("customerId")?.trim();
  const terms = c.req.query("terms")?.trim();
  const termsGroup = c.req.query("termsGroup")?.trim();

  const immediateTerms = ["CONTADO", "TARJETA", "EFECTIVO"] as const;

  const where: {
    organizationId: string;
    saleDate?: { gte?: Date; lte?: Date };
    OR?: ({ invoiceNumber?: { contains: string } } | { customer?: { name: { contains: string } } })[];
    customerId?: string;
    terms?: string | { in: string[] };
    NOT?: { terms: { in: string[] } };
  } = { organizationId: jwt.orgId };

  if (from || to) {
    where.saleDate = {};
    if (from) where.saleDate.gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      where.saleDate.lte = end;
    }
  }
  if (q) {
    where.OR = [{ invoiceNumber: { contains: q } }, { customer: { name: { contains: q } } }];
  }
  if (customerId) where.customerId = customerId;
  if (termsGroup === "credit") {
    // Incluye CREDITO, plazos fijos y cualquier "N DIAS" (no es contado/tarjeta/efectivo).
    where.NOT = { terms: { in: [...immediateTerms] } };
  } else if (termsGroup === "cash" || termsGroup === "immediate") {
    where.terms = { in: [...immediateTerms] };
  } else if (terms) {
    where.terms = terms;
  }

  const paginated = wantsPaginated((name) => c.req.query(name));
  if (paginated) {
    const page = parsePageParams((name) => c.req.query(name), 50);
    const [items, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
        include: {
          customer: true,
          user: { select: { id: true, displayName: true, username: true } },
          lines: { include: { product: true } },
        },
      }),
      prisma.sale.count({ where }),
    ]);
    return c.json({
      items,
      total,
      page: page.page,
      pageSize: page.pageSize,
      filters: {
        from: from ?? "",
        to: to ?? "",
        q: q ?? "",
        customerId: customerId ?? "",
        terms: terms ?? "",
        termsGroup: termsGroup ?? "",
      },
    });
  }

  const sales = await prisma.sale.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      customer: true,
      user: { select: { id: true, displayName: true, username: true } },
      lines: { include: { product: true } },
    },
  });
  return c.json(sales);
});

api.get("/sales/:id", async (c) => {
  const jwt = c.get("jwt");
  const s = await prisma.sale.findFirst({
    where: { id: c.req.param("id"), organizationId: jwt.orgId },
    include: {
      customer: true,
      user: { select: { id: true, displayName: true, username: true } },
      lines: { include: { product: true } },
    },
  });
  if (!s) return c.json({ error: "No encontrado" }, 404);
  return c.json(s);
});

api.patch("/sales/:id", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const saleId = c.req.param("id");
  const body = await c.req.json<{
    customerId?: string | null;
    terms?: string;
    notes?: string;
    sellerName?: string | null;
    priceTier?: number;
    paid?: number;
    saleDate?: string;
    lines: { productId: string; qty: number; unitPrice?: number; discountPercent?: number }[];
  }>();
  if (!body.lines?.length) return c.json({ error: "Agregue líneas" }, 400);

  const terms = normalizeSaleTerms(body.terms ?? "CONTADO");
  const priceTier = Math.min(4, Math.max(1, body.priceTier ?? 1));
  const saleDatePatch = parseClientSaleDate(body.saleDate);

  if (isCreditSaleTerm(terms)) {
    const cid = typeof body.customerId === "string" ? body.customerId.trim() : "";
    if (!cid) {
      return c.json({ error: "Las ventas a crédito requieren un cliente registrado" }, 400);
    }
    const cust = await prisma.customer.findFirst({
      where: { id: cid, organizationId: jwt.orgId },
    });
    if (!cust) return c.json({ error: "Cliente no encontrado" }, 400);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findFirst({
        where: { id: saleId, organizationId: jwt.orgId },
        include: { lines: true, receivableSurcharges: true },
      });
      if (!existing) throw new Error("SALE_NOT_FOUND");
      if (existing.receivableSurcharges.length > 0) throw new Error("SALE_HAS_SURCHARGES");

      const stRetainSet = await tx.organizationSettings.findUnique({ where: { organizationId: jwt.orgId } });
      const genRetain = JSON.parse(stRetainSet?.generalJson || "{}") as Record<string, unknown>;
      const posRetain = genRetain.posBehavior as Record<string, unknown> | undefined;
      const retainInventoryOnSaleEdit = posRetain?.retainInventoryOnSaleEdit === true;

      if (!retainInventoryOnSaleEdit) {
        for (const oldLine of existing.lines) {
          await restoreStockForSaleLine(tx, jwt.orgId, { productId: oldLine.productId, qty: oldLine.qty });
        }
      }

      let subtotal = 0;
      let tax = 0;
      const saleLines: {
        productId: string;
        qty: number;
        unitPrice: number;
        discountPercent: number;
        taxPercent: number;
        lineTotal: number;
      }[] = [];

      for (const line of body.lines) {
        const product = await tx.product.findFirst({
          where: { id: line.productId, organizationId: jwt.orgId },
        });
        if (!product) throw new Error("PRODUCT_NOT_FOUND");
        if (product.productType === "INSUMO") throw new Error("INSUMO_NOT_SALEABLE");
        const isService = product.productType === "SERVICIO";
        const isKit = product.productType === "KIT";
        if (isKit) {
          await assertKitSaleStock(tx, product.id, line.qty);
        } else if (!isService && product.stock < line.qty) {
          throw new Error("INSUFFICIENT_STOCK");
        }
        const unitPrice = line.unitPrice ?? resolveProductUnitPrice(product, line.qty, priceTier);
        const discountPercent = line.discountPercent ?? 0;
        const base = unitPrice * line.qty * (1 - discountPercent / 100);
        const taxPercent = product.taxPercent;
        const lineTax = base * (taxPercent / 100);
        const lineTotal = base + lineTax;
        subtotal += base;
        tax += lineTax;
        saleLines.push({
          productId: product.id,
          qty: line.qty,
          unitPrice,
          discountPercent,
          taxPercent,
          lineTotal,
        });
      }

      const total = subtotal + tax;
      const paidSeed = body.paid ?? existing.paid;
      const paid = resolveSalePaid(total, terms, paidSeed);

      const stSetPatch = await tx.organizationSettings.findUnique({ where: { organizationId: jwt.orgId } });
      const invParsedPatch = JSON.parse(stSetPatch?.invoiceJson || "{}") as Record<string, unknown>;
      const finalSaleDate = saleDatePatch ?? existing.saleDate;
      assertSarRangeValidUntil(invParsedPatch, finalSaleDate);

      const sellerPatch =
        body.sellerName === undefined
          ? undefined
          : body.sellerName === null || body.sellerName === ""
            ? null
            : String(body.sellerName).trim().slice(0, 120) || null;

      await tx.saleLine.deleteMany({ where: { saleId: existing.id } });
      await tx.sale.update({
        where: { id: existing.id },
        data: {
          customerId: body.customerId || null,
          terms,
          notes: body.notes,
          ...(sellerPatch !== undefined ? { sellerName: sellerPatch } : {}),
          priceTier,
          subtotal,
          tax,
          total,
          paid,
          ...(saleDatePatch ? { saleDate: saleDatePatch } : {}),
          lines: { create: saleLines },
        },
      });

      if (!retainInventoryOnSaleEdit) {
        for (const line of saleLines) {
          const prod = await tx.product.findUnique({ where: { id: line.productId } });
          if (prod?.productType === "SERVICIO") continue;
          if (prod?.productType === "KIT") {
            await decrementStockForKitSale(tx, jwt.orgId, prod.id, line.qty);
            continue;
          }
          await adjustProductStock(tx, jwt.orgId, line.productId, -line.qty);
        }
      }

      return tx.sale.findUnique({
        where: { id: existing.id },
        include: {
          lines: { include: { product: true } },
          customer: true,
          user: { select: { id: true, displayName: true, username: true } },
        },
      });
    });

    return c.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "SALE_NOT_FOUND") return c.json({ error: "Venta no encontrada" }, 404);
    if (msg === "SALE_HAS_SURCHARGES") {
      return c.json({ error: "No se puede editar una venta con recargos en cuentas por cobrar" }, 400);
    }
    if (msg === "PRODUCT_NOT_FOUND") return c.json({ error: "Producto no encontrado" }, 400);
    if (msg === "INSUFFICIENT_STOCK") return c.json({ error: "Stock insuficiente" }, 400);
    if (msg === "KIT_EMPTY") return c.json({ error: "El kit no tiene componentes configurados" }, 400);
    if (msg === "KIT_BAD_COMPONENT") return c.json({ error: "Error en componentes del kit" }, 400);
    if (msg === "INSUMO_NOT_SALEABLE") return c.json({ error: "Los insumos no se venden en POS" }, 400);
    if (msg === "SAR_AUTH_EXPIRED") {
      return c.json(
        { error: "Fecha de venta posterior al límite de autorización SAR; revise configuración o la fecha del documento" },
        400
      );
    }
    throw e;
  }
});

api.get("/sales/:saleId/comprobante.pdf", async (c) => {
  const jwt = c.get("jwt");
  const saleId = c.req.param("saleId");
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, organizationId: jwt.orgId },
    include: {
      customer: true,
      user: { select: { id: true, displayName: true, username: true } },
      lines: { include: { product: true } },
    },
  });
  if (!sale) return c.json({ error: "No encontrado" }, 404);
  const org = await prisma.organization.findUnique({ where: { id: jwt.orgId } });
  if (!org) return c.json({ error: "Organización no encontrada" }, 404);
  let settings = await prisma.organizationSettings.findUnique({ where: { organizationId: jwt.orgId } });
  if (!settings) {
    settings = await prisma.organizationSettings.create({ data: { organizationId: jwt.orgId } });
  }
  const invoice = JSON.parse(settings.invoiceJson || "{}") as Record<string, unknown>;
  const buf = await buildSaleComprobantePdf(org, sale, invoice);
  const raw = (sale.invoiceNumber ?? sale.id.slice(0, 8)).replace(/[^\w.\-]+/g, "_");
  const fname = `comprobante-${raw}.pdf`;
  c.header("Content-Type", "application/pdf");
  c.header("Content-Disposition", `attachment; filename="${fname}"`);
  return c.body(new Uint8Array(buf));
});

api.post("/purchases", requirePermission(PERMISSION_KEYS.PURCHASES_RECORD), async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    supplierId?: string | null;
    reference?: string;
    terms?: string;
    paid?: number;
    lines: { productId: string; qty: number; unitCost: number; taxPercent?: number }[];
  }>();
  if (!body.lines?.length) return c.json({ error: "Agregue líneas" }, 400);

  const terms = (body.terms ?? "CONTADO").toUpperCase();

  try {
  const purchase = await prisma.$transaction(async (tx) => {
    let subtotal = 0;
    let tax = 0;
    const linesData: { productId: string; qty: number; unitCost: number; taxPercent: number; lineTotal: number }[] = [];

    for (const line of body.lines) {
      const product = await tx.product.findFirst({
        where: { id: line.productId, organizationId: jwt.orgId },
      });
      if (!product) throw new Error("PRODUCT_NOT_FOUND");
      if (product.productType === "KIT") throw new Error("KIT_NOT_PURCHASABLE");
      const unitCost = Number(line.unitCost);
      const taxPercent = line.taxPercent ?? product.taxPercent;
      const base = unitCost * line.qty;
      const lineTax = base * (taxPercent / 100);
      const lineTotal = base + lineTax;
      subtotal += base;
      tax += lineTax;
      linesData.push({ productId: product.id, qty: line.qty, unitCost, taxPercent, lineTotal });
    }

    const total = subtotal + tax;
    let paid = body.paid ?? (terms === "CONTADO" ? total : 0);
    if (paid > total) paid = total;
    if (terms === "CONTADO" && paid < total) paid = total;

    const p = await tx.purchase.create({
      data: {
        organizationId: jwt.orgId,
        userId: jwt.sub,
        supplierId: body.supplierId || null,
        reference: body.reference,
        terms,
        subtotal,
        tax,
        total,
        paid,
        lines: { create: linesData },
      },
      include: { lines: { include: { product: true } }, supplier: true },
    });

    for (const line of linesData) {
      await adjustProductStock(tx, jwt.orgId, line.productId, line.qty);
      await tx.product.update({
        where: { id: line.productId },
        data: { cost: line.unitCost },
      });
    }

    return p;
  });

  return c.json(purchase, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "PRODUCT_NOT_FOUND") return c.json({ error: "Producto no encontrado" }, 400);
    if (msg === "KIT_NOT_PURCHASABLE") {
      return c.json({ error: "Un combo (KIT) no se ingresa por compra; use los productos componentes." }, 400);
    }
    throw e;
  }
});

api.get(
  "/purchases",
  requireAnyPermission(PERMISSION_KEYS.PURCHASES_RECORD, PERMISSION_KEYS.PURCHASES_VIEW),
  async (c) => {
    const jwt = c.get("jwt");
    return c.json(
      await prisma.purchase.findMany({
        where: { organizationId: jwt.orgId },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: { supplier: true, lines: { include: { product: true } } },
      })
    );
  }
);

api.post("/cash-sessions/open", async (c) => {
  const jwt = c.get("jwt");
  const open = await prisma.cashSession.findFirst({
    where: { organizationId: jwt.orgId, userId: jwt.sub, closedAt: null },
  });
  if (open) return c.json({ error: "Ya tiene caja abierta", session: open }, 400);
  const body = await c.req.json<{ openingCash?: number }>();
  const session = await prisma.cashSession.create({
    data: {
      organizationId: jwt.orgId,
      userId: jwt.sub,
      openingCash: body.openingCash ?? 0,
    },
  });
  return c.json(session, 201);
});

api.get("/cash-sessions/current", async (c) => {
  const jwt = c.get("jwt");
  const session = await prisma.cashSession.findFirst({
    where: { organizationId: jwt.orgId, userId: jwt.sub, closedAt: null },
  });
  return c.json(session);
});

api.post("/cash-sessions/:id/close", async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const body = await c.req.json<{ closingCash?: number; notes?: string }>();
  const session = await prisma.cashSession.findFirst({
    where: { id, organizationId: jwt.orgId, userId: jwt.sub, closedAt: null },
  });
  if (!session) return c.json({ error: "Sesión no encontrada o ya cerrada" }, 404);
  if (typeof body.closingCash !== "number" || !Number.isFinite(body.closingCash)) {
    return c.json({ error: "Debe indicar el efectivo contado al cierre" }, 400);
  }
  const closedAt = new Date();
  const diary = await buildCashDiaryForSession(jwt.orgId, jwt.sub, session, closedAt);
  const updated = await prisma.cashSession.update({
    where: { id },
    data: {
      closedAt,
      closingCash: body.closingCash,
      expectedCash: diary.efectivoCajaSugerido,
      notes: body.notes,
    },
  });
  return c.json({
    ...updated,
    cashDifference: updated.closingCash !== null && updated.expectedCash !== null ? updated.closingCash - updated.expectedCash : null,
  });
});

const emptyCashDiary = () => ({
  session: null as null,
  saleCount: 0,
  contadoTotal: 0,
  tarjetaTotal: 0,
  efectivoVentasTotal: 0,
  creditoTotal: 0,
  creditoCobrado: 0,
  creditoPendiente: 0,
  ventasTotal: 0,
  gastosSesion: 0,
  movementNet: 0,
  movements: [] as {
    id: string;
    category: string;
    amount: number;
    hasVoucher: boolean;
    note: string | null;
    createdAt: Date;
  }[],
  efectivoCajaSugerido: 0,
  cashDifference: null as number | null,
  sales: [] as {
    id: string;
    total: number;
    paid: number;
    terms: string;
    saleDate: Date;
    invoiceNumber: string | null;
  }[],
});

async function buildCashDiaryForSession(
  orgId: string,
  userId: string,
  session: {
    id: string;
    openedAt: Date;
    closedAt: Date | null;
    openingCash: number;
    closingCash: number | null;
    expectedCash?: number | null;
  },
  end: Date
) {
  const sales = await prisma.sale.findMany({
    where: {
      organizationId: orgId,
      userId,
      saleDate: { gte: session.openedAt, lte: end },
    },
    select: { id: true, total: true, paid: true, terms: true, saleDate: true, invoiceNumber: true },
    orderBy: { saleDate: "asc" },
  });

  let contadoTotal = 0;
  let tarjetaTotal = 0;
  let efectivoVentasTotal = 0;
  let creditoTotal = 0;
  let creditoCobrado = 0;

  for (const s of sales) {
    if (isImmediateSaleTerm(s.terms)) {
      contadoTotal += s.total;
      const t = normalizeSaleTerms(s.terms);
      if (t === "TARJETA") tarjetaTotal += s.total;
      else efectivoVentasTotal += s.total;
    } else if (isCreditSaleTerm(s.terms)) {
      creditoTotal += s.total;
      creditoCobrado += s.paid;
    } else {
      contadoTotal += s.total;
      efectivoVentasTotal += s.total;
    }
  }

  const ventasTotal = sales.reduce((acc, s) => acc + s.total, 0);

  const gastosAgg = await prisma.expense.aggregate({
    where: {
      organizationId: orgId,
      userId,
      expenseDate: { gte: session.openedAt, lte: end },
    },
    _sum: { amount: true },
  });
  const gastosSesion = gastosAgg._sum.amount ?? 0;

  const cobradoEfectivoCredito = sales
    .filter((s) => isCreditSaleTerm(s.terms))
    .reduce((acc, s) => acc + s.paid, 0);

  const movements = await prisma.cashMovement.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      category: true,
      amount: true,
      hasVoucher: true,
      note: true,
      createdAt: true,
    },
  });
  const movementNet = movements.reduce((acc, m) => acc + cashMovementDelta(m.category, m.amount), 0);

  const efectivoCajaSugerido =
    session.openingCash + efectivoVentasTotal + cobradoEfectivoCredito - gastosSesion + movementNet;

  return {
    session: {
      id: session.id,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      openingCash: session.openingCash,
      closingCash: session.closingCash,
      expectedCash: session.expectedCash ?? null,
    },
    saleCount: sales.length,
    contadoTotal,
    tarjetaTotal,
    efectivoVentasTotal,
    creditoTotal,
    creditoCobrado,
    creditoPendiente: creditoTotal - creditoCobrado,
    ventasTotal,
    gastosSesion,
    movementNet,
    movements,
    efectivoCajaSugerido,
    cashDifference:
      session.closingCash !== null
        ? session.closingCash - (session.expectedCash ?? efectivoCajaSugerido)
        : null,
    sales,
  };
}

api.get("/cash-sessions/current/diary", async (c) => {
  const jwt = c.get("jwt");
  const session = await prisma.cashSession.findFirst({
    where: { organizationId: jwt.orgId, userId: jwt.sub, closedAt: null },
  });
  if (!session) {
    return c.json(emptyCashDiary());
  }
  const payload = await buildCashDiaryForSession(jwt.orgId, jwt.sub, session, new Date());
  return c.json(payload);
});

api.get("/cash-sessions/:id/diary", async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const session = await prisma.cashSession.findFirst({
    where: { id, organizationId: jwt.orgId, userId: jwt.sub },
  });
  if (!session) return c.json({ error: "No encontrado" }, 404);
  const end = session.closedAt ?? new Date();
  const payload = await buildCashDiaryForSession(jwt.orgId, jwt.sub, session, end);
  return c.json(payload);
});

function dayBounds(d: Date): { start: Date; end: Date } {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

api.get("/cash-diary", async (c) => {
  const jwt = c.get("jwt");
  const targetUserId = c.req.query("userId")?.trim() || jwt.sub;
  if (targetUserId !== jwt.sub) {
    const me = await prisma.user.findFirst({
      where: { id: jwt.sub, organizationId: jwt.orgId },
      select: { role: true },
    });
    if (me?.role !== "admin") return c.json({ error: "Solo administradores" }, 403);
  }
  const dateStr = c.req.query("date")?.trim();
  const day = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  const { start, end } = dayBounds(day);
  const session = await prisma.cashSession.findFirst({
    where: {
      organizationId: jwt.orgId,
      userId: targetUserId,
      openedAt: { lte: end },
      OR: [{ closedAt: null }, { closedAt: { gte: start } }],
    },
    orderBy: { openedAt: "desc" },
  });
  if (!session) return c.json(emptyCashDiary());
  const endTime =
    session.closedAt && session.closedAt <= end && session.closedAt >= session.openedAt
      ? session.closedAt
      : new Date(Math.min(end.getTime(), Date.now()));
  const payload = await buildCashDiaryForSession(jwt.orgId, targetUserId, session, endTime);
  return c.json(payload);
});

api.get("/cash-diary/admin-summary", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const dateStr = c.req.query("date")?.trim() ?? new Date().toISOString().slice(0, 10);
  const { start, end } = dayBounds(new Date(dateStr + "T12:00:00"));
  const sessions = await prisma.cashSession.findMany({
    where: {
      organizationId: jwt.orgId,
      openedAt: { gte: start, lte: end },
    },
    include: { user: { select: { id: true, displayName: true, username: true } } },
    orderBy: { openedAt: "asc" },
  });
  const rows: unknown[] = [];
  let sumVentas = 0;
  let sumEfectivo = 0;
  for (const s of sessions) {
    const endT = s.closedAt ?? new Date();
    const d = await buildCashDiaryForSession(jwt.orgId, s.userId, s, endT);
    sumVentas += d.ventasTotal;
    sumEfectivo += d.efectivoCajaSugerido;
    rows.push({
      sessionId: s.id,
      user: s.user,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      ventasTotal: d.ventasTotal,
      efectivoCajaSugerido: d.efectivoCajaSugerido,
      saleCount: d.saleCount,
    });
  }
  return c.json({ date: dateStr, sessions: rows, totals: { ventasTotal: sumVentas, efectivoCajaSugerido: sumEfectivo } });
});

api.get("/cash-diary/close-report.html", async (c) => {
  const jwt = c.get("jwt");
  const targetUserId = c.req.query("userId")?.trim() || jwt.sub;
  if (targetUserId !== jwt.sub) {
    const me = await prisma.user.findFirst({
      where: { id: jwt.sub, organizationId: jwt.orgId },
      select: { role: true },
    });
    if (me?.role !== "admin") return c.json({ error: "Solo administradores" }, 403);
  }
  const dateStr = c.req.query("date")?.trim() ?? new Date().toISOString().slice(0, 10);
  const day = new Date(dateStr + "T12:00:00");
  const { start, end } = dayBounds(day);
  const session = await prisma.cashSession.findFirst({
    where: {
      organizationId: jwt.orgId,
      userId: targetUserId,
      openedAt: { lte: end },
      OR: [{ closedAt: null }, { closedAt: { gte: start } }],
    },
    orderBy: { openedAt: "desc" },
  });
  const diary = session
    ? await buildCashDiaryForSession(
        jwt.orgId,
        targetUserId,
        session,
        session.closedAt && session.closedAt <= end && session.closedAt >= session.openedAt
          ? session.closedAt
          : new Date(Math.min(end.getTime(), Date.now()))
      )
    : emptyCashDiary();

  const [org, targetUser] = await Promise.all([
    prisma.organization.findUnique({ where: { id: jwt.orgId }, select: { name: true, currencySymbol: true } }),
    prisma.user.findFirst({
      where: { id: targetUserId, organizationId: jwt.orgId },
      select: { displayName: true, username: true },
    }),
  ]);
  const userLabel = targetUser ? `${targetUser.displayName} (${targetUser.username})` : targetUserId;
  const autoPrint = c.req.query("print") === "1";
  const html = buildCashCloseReportHtml({
    orgName: org?.name ?? "Organización",
    dateStr,
    userDisplay: userLabel,
    currencySymbol: org?.currencySymbol?.trim() || "L",
    diary,
    autoPrint,
  });
  return c.html(html);
});

api.post("/cash-movements", async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    sessionId: string;
    category: string;
    amount: number;
    hasVoucher?: boolean;
    note?: string;
  }>();
  if (!body.sessionId || !isCashMovementCategory(body.category)) {
    return c.json({ error: "Sesión y categoría válida requeridas" }, 400);
  }
  const amt = Number(body.amount);
  if (!Number.isFinite(amt) || amt <= 0) return c.json({ error: "Monto inválido" }, 400);
  const sess = await prisma.cashSession.findFirst({
    where: { id: body.sessionId, organizationId: jwt.orgId, userId: jwt.sub, closedAt: null },
  });
  if (!sess) return c.json({ error: "Sesión no encontrada o cerrada" }, 404);
  const row = await prisma.cashMovement.create({
    data: {
      organizationId: jwt.orgId,
      sessionId: sess.id,
      userId: jwt.sub,
      category: body.category,
      amount: amt,
      hasVoucher: !!body.hasVoucher,
      note: typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null,
    },
  });
  return c.json(row, 201);
});

api.patch("/cash-movements/:id", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const body = await c.req.json<{ category?: string; note?: string | null }>();
  const row = await prisma.cashMovement.findFirst({ where: { id, organizationId: jwt.orgId } });
  if (!row) return c.json({ error: "No encontrado" }, 404);
  const data: { category?: string; note?: string | null } = {};
  if (body.category !== undefined) {
    if (!isCashMovementCategory(body.category)) return c.json({ error: "Categoría inválida" }, 400);
    data.category = body.category;
  }
  if (body.note !== undefined) {
    data.note = body.note === null || body.note === "" ? null : String(body.note).trim().slice(0, 500) || null;
  }
  if (data.category === undefined && data.note === undefined) {
    return c.json({ error: "Sin cambios" }, 400);
  }
  const updated = await prisma.cashMovement.update({ where: { id }, data });
  return c.json(updated);
});

api.post("/admin/migrate-product-stock", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const r = await prisma.$transaction((tx) => migrateOrgProductStocks(tx, jwt.orgId));
  return c.json({ ok: true, ...r });
});

api.post("/auth/verify-password", async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{ password: string }>();
  const pw = body.password ?? "";
  if (!pw) return c.json({ ok: false }, 400);
  const user = await prisma.user.findFirst({
    where: { id: jwt.sub, organizationId: jwt.orgId },
  });
  if (!user || !(await verifyPassword(pw, user.passwordHash))) return c.json({ ok: false }, 401);
  return c.json({ ok: true });
});

api.get("/reports/sales-summary", requirePermission(PERMISSION_KEYS.REPORTS_VIEW), async (c) => {
  const jwt = c.get("jwt");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const where: { organizationId: string; saleDate?: { gte?: Date; lte?: Date } } = { organizationId: jwt.orgId };
  if (from || to) {
    where.saleDate = {};
    if (from) where.saleDate.gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      where.saleDate.lte = end;
    }
  }
  const agg = await prisma.sale.aggregate({
    where,
    _sum: { total: true, tax: true, subtotal: true },
    _count: true,
  });
  return c.json({
    count: agg._count,
    subtotal: agg._sum.subtotal ?? 0,
    tax: agg._sum.tax ?? 0,
    total: agg._sum.total ?? 0,
  });
});

api.get("/reports/inventory", requirePermission(PERMISSION_KEYS.REPORTS_VIEW), async (c) => {
  const jwt = c.get("jwt");
  const products = await prisma.product.findMany({
    where: { organizationId: jwt.orgId, active: true },
    select: { id: true, sku: true, name: true, stock: true, cost: true, price: true, minStock: true },
  });
  const value = products.reduce((s, p) => s + p.stock * p.cost, 0);
  const low = products.filter((p) => p.stock <= p.minStock);
  return c.json({ products, stockValueAtCost: value, lowStock: low });
});

api.get("/reports/top-products", requirePermission(PERMISSION_KEYS.REPORTS_VIEW), async (c) => {
  const jwt = c.get("jwt");
  const from = c.req.query("from")?.trim();
  const to = c.req.query("to")?.trim();
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 20));
  const saleWhere: { organizationId: string; saleDate?: { gte?: Date; lte?: Date } } = { organizationId: jwt.orgId };
  if (from || to) {
    saleWhere.saleDate = {};
    if (from) saleWhere.saleDate.gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      saleWhere.saleDate.lte = end;
    }
  }
  const grouped = await prisma.saleLine.groupBy({
    by: ["productId"],
    where: { sale: saleWhere },
    _sum: { qty: true, lineTotal: true },
    orderBy: { _sum: { lineTotal: "desc" } },
    take: limit,
  });
  const ids = grouped.map((g) => g.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, organizationId: jwt.orgId },
    select: { id: true, sku: true, name: true },
  });
  const nameById = new Map(products.map((p) => [p.id, p]));
  const rows = grouped.map((g) => {
    const p = nameById.get(g.productId);
    return {
      productId: g.productId,
      sku: p?.sku ?? "",
      name: p?.name ?? "—",
      qty: g._sum.qty ?? 0,
      lineTotal: g._sum.lineTotal ?? 0,
    };
  });
  return c.json({ rows });
});

api.get("/reports/expenses-summary", requirePermission(PERMISSION_KEYS.EXPENSES_VIEW), async (c) => {
  const jwt = c.get("jwt");
  const from = c.req.query("from")?.trim();
  const to = c.req.query("to")?.trim();
  const where: { organizationId: string; expenseDate?: { gte?: Date; lte?: Date } } = { organizationId: jwt.orgId };
  if (from || to) {
    where.expenseDate = {};
    if (from) where.expenseDate.gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      where.expenseDate.lte = end;
    }
  }
  const [agg, byCategory] = await Promise.all([
    prisma.expense.aggregate({
      where,
      _sum: { amount: true },
      _count: true,
    }),
    prisma.expense.groupBy({
      by: ["category"],
      where,
      _sum: { amount: true },
      _count: true,
    }),
  ]);
  const categories = byCategory
    .map((r) => ({
      category: r.category,
      total: r._sum.amount ?? 0,
      count: r._count,
    }))
    .sort((a, b) => b.total - a.total);
  return c.json({
    count: agg._count,
    total: agg._sum.amount ?? 0,
    byCategory: categories,
  });
});

api.get("/reports/payroll-summary", requirePermission(PERMISSION_KEYS.PAYROLL_VIEW), async (c) => {
  const jwt = c.get("jwt");
  const periods = await prisma.payrollPeriod.findMany({
    where: { organizationId: jwt.orgId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take: 48,
    include: { lines: true },
  });
  const rows = periods.map((p) => ({
    id: p.id,
    year: p.year,
    month: p.month,
    status: p.status,
    lineCount: p.lines.length,
    totalGross: p.lines.reduce((s, l) => s + l.gross, 0),
    totalDeductions: p.lines.reduce((s, l) => s + l.deductions, 0),
    totalNet: p.lines.reduce((s, l) => s + l.net, 0),
  }));
  return c.json({ periods: rows });
});

api.get("/accounts/receivable", requirePermission(PERMISSION_KEYS.ACCOUNTS_RECEIVABLE), async (c) => {
  const jwt = c.get("jwt");
  const sales = await prisma.sale.findMany({
    where: { organizationId: jwt.orgId },
    include: { customer: true, receivableSurcharges: true },
    orderBy: { saleDate: "desc" },
    take: 800,
  });
  const rows = sales
    .filter((s) => isCreditSaleTerm(s.terms))
    .map((s) => {
      const surchargesTotal = s.receivableSurcharges.reduce((a, x) => a + x.amount, 0);
      return {
        saleId: s.id,
        invoiceNumber: s.invoiceNumber,
        customer: s.customer,
        total: s.total,
        surchargesTotal,
        paid: s.paid,
        balance: s.total + surchargesTotal - s.paid,
        dueDate: s.dueDate,
        saleDate: s.saleDate,
      };
    })
    .filter((r) => r.balance > 0.009);
  return c.json(rows);
});

api.post("/accounts/receivable/:saleId/surcharge", requirePermission(PERMISSION_KEYS.ACCOUNTS_RECEIVABLE), async (c) => {
  const jwt = c.get("jwt");
  const saleId = c.req.param("saleId");
  const body = await c.req.json<{ amount: number; note?: string | null }>();
  const amount = Number(body.amount);
  if (!amount || amount <= 0 || !Number.isFinite(amount)) return c.json({ error: "Monto inválido" }, 400);
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, organizationId: jwt.orgId },
  });
  if (!sale || !isCreditSaleTerm(sale.terms)) return c.json({ error: "Venta no encontrada" }, 404);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;
  const row = await prisma.receivableSurcharge.create({
    data: { saleId, amount, note: note || null, userId: jwt.sub },
  });
  return c.json(row);
});

api.post("/accounts/receivable/:saleId/pay", requirePermission(PERMISSION_KEYS.ACCOUNTS_RECEIVABLE), async (c) => {
  const jwt = c.get("jwt");
  const saleId = c.req.param("saleId");
  const body = await c.req.json<{ amount: number; registerCashMovement?: boolean }>();
  const amount = Number(body.amount);
  if (!amount || amount <= 0) return c.json({ error: "Monto inválido" }, 400);
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, organizationId: jwt.orgId },
    include: { receivableSurcharges: true },
  });
  if (!sale || !isCreditSaleTerm(sale.terms)) return c.json({ error: "Venta no encontrada" }, 404);
  const surchargesTotal = sale.receivableSurcharges.reduce((a, x) => a + x.amount, 0);
  const balance = sale.total + surchargesTotal - sale.paid;
  if (amount > balance) return c.json({ error: "Excede saldo" }, 400);
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.sale.update({
      where: { id: saleId },
      data: { paid: { increment: amount } },
    });
    if (body.registerCashMovement) {
      const sess = await tx.cashSession.findFirst({
        where: { organizationId: jwt.orgId, userId: jwt.sub, closedAt: null },
      });
      if (sess) {
        await tx.cashMovement.create({
          data: {
            organizationId: jwt.orgId,
            sessionId: sess.id,
            userId: jwt.sub,
            category: "PAGO_ABONO",
            amount,
            note: `Abono CxC ${sale.invoiceNumber ?? saleId}`,
          },
        });
      }
    }
    return u;
  });
  return c.json(updated);
});

api.get("/accounts/payable", requirePermission(PERMISSION_KEYS.ACCOUNTS_PAYABLE), async (c) => {
  const jwt = c.get("jwt");
  const purchases = await prisma.purchase.findMany({
    where: { organizationId: jwt.orgId, terms: "CREDITO" },
    include: { supplier: true, payableSurcharges: true },
    orderBy: { purchaseDate: "desc" },
  });
  const rows = purchases
    .map((p) => {
      const surchargesTotal = p.payableSurcharges.reduce((a, x) => a + x.amount, 0);
      return {
        purchaseId: p.id,
        reference: p.reference,
        supplier: p.supplier,
        total: p.total,
        surchargesTotal,
        paid: p.paid,
        balance: p.total + surchargesTotal - p.paid,
        purchaseDate: p.purchaseDate,
      };
    })
    .filter((r) => r.balance > 0.009);
  return c.json(rows);
});

api.post("/accounts/payable/:purchaseId/surcharge", requirePermission(PERMISSION_KEYS.ACCOUNTS_PAYABLE), async (c) => {
  const jwt = c.get("jwt");
  const purchaseId = c.req.param("purchaseId");
  const body = await c.req.json<{ amount: number; note?: string | null }>();
  const amount = Number(body.amount);
  if (!amount || amount <= 0 || !Number.isFinite(amount)) return c.json({ error: "Monto inválido" }, 400);
  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: jwt.orgId, terms: "CREDITO" },
  });
  if (!purchase) return c.json({ error: "Compra no encontrada" }, 404);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;
  const row = await prisma.payableSurcharge.create({
    data: { purchaseId, amount, note: note || null, userId: jwt.sub },
  });
  return c.json(row);
});

api.post("/accounts/payable/:purchaseId/pay", requirePermission(PERMISSION_KEYS.ACCOUNTS_PAYABLE), async (c) => {
  const jwt = c.get("jwt");
  const purchaseId = c.req.param("purchaseId");
  const body = await c.req.json<{ amount: number; registerCashMovement?: boolean }>();
  const amount = Number(body.amount);
  if (!amount || amount <= 0) return c.json({ error: "Monto inválido" }, 400);
  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: jwt.orgId, terms: "CREDITO" },
    include: { payableSurcharges: true },
  });
  if (!purchase) return c.json({ error: "Compra no encontrada" }, 404);
  const surchargesTotal = purchase.payableSurcharges.reduce((a, x) => a + x.amount, 0);
  const balance = purchase.total + surchargesTotal - purchase.paid;
  if (amount > balance) return c.json({ error: "Excede saldo" }, 400);
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.purchase.update({
      where: { id: purchaseId },
      data: { paid: { increment: amount } },
    });
    if (body.registerCashMovement) {
      const sess = await tx.cashSession.findFirst({
        where: { organizationId: jwt.orgId, userId: jwt.sub, closedAt: null },
      });
      if (sess) {
        await tx.cashMovement.create({
          data: {
            organizationId: jwt.orgId,
            sessionId: sess.id,
            userId: jwt.sub,
            category: "GASTO",
            amount,
            note: `Pago CxP compra ${purchase.reference ?? purchaseId}`,
          },
        });
      }
    }
    return u;
  });
  return c.json(updated);
});

api.get("/quotes", async (c) => {
  const jwt = c.get("jwt");
  return c.json(
    await prisma.quote.findMany({
      where: { organizationId: jwt.orgId },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { customer: true, lines: { include: { product: true } } },
    })
  );
});

api.get("/quotes/:id", async (c) => {
  const jwt = c.get("jwt");
  const q = await prisma.quote.findFirst({
    where: { id: c.req.param("id"), organizationId: jwt.orgId },
    include: { customer: true, lines: { include: { product: true } } },
  });
  if (!q) return c.json({ error: "No encontrado" }, 404);
  return c.json(q);
});

api.post("/quotes", async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    customerId?: string | null;
    notes?: string;
    validUntil?: string | null;
    serviceLabel?: string | null;
    lines: { productId: string; qty: number; unitPrice?: number }[];
  }>();
  if (!body.lines?.length) return c.json({ error: "Agregue líneas" }, 400);
  const serviceLabel =
    body.serviceLabel === undefined || body.serviceLabel === null
      ? null
      : String(body.serviceLabel).trim().slice(0, 120) || null;

  let quote;
  try {
  quote = await prisma.$transaction(async (tx) => {
    let subtotal = 0;
    let tax = 0;
    const linesData: { productId: string; qty: number; unitPrice: number; taxPercent: number; lineTotal: number }[] = [];

    for (const line of body.lines) {
      const product = await tx.product.findFirst({
        where: { id: line.productId, organizationId: jwt.orgId },
      });
      if (!product) throw new Error("PRODUCT_NOT_FOUND");
      if (product.productType === "INSUMO") throw new Error("INSUMO_NOT_SALEABLE");
      const unitPrice = line.unitPrice ?? resolveProductUnitPrice(product, line.qty, 1);
      const base = unitPrice * line.qty;
      const taxPercent = product.taxPercent;
      const lineTax = base * (taxPercent / 100);
      const lineTotal = base + lineTax;
      subtotal += base;
      tax += lineTax;
      linesData.push({ productId: product.id, qty: line.qty, unitPrice, taxPercent, lineTotal });
    }

    const total = subtotal + tax;
    const n = await tx.quote.count({ where: { organizationId: jwt.orgId } });
    return tx.quote.create({
      data: {
        organizationId: jwt.orgId,
        userId: jwt.sub,
        customerId: body.customerId || null,
        quoteNumber: `COT-${String(n + 1).padStart(5, "0")}`,
        subtotal,
        tax,
        total,
        notes: body.notes,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        serviceLabel,
        lines: { create: linesData },
      },
      include: { lines: { include: { product: true } }, customer: true },
    });
  });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "PRODUCT_NOT_FOUND") return c.json({ error: "Producto no encontrado" }, 400);
    if (msg === "INSUMO_NOT_SALEABLE") return c.json({ error: "Los insumos no se incluyen en cotizaciones" }, 400);
    throw e;
  }

  return c.json(quote, 201);
});

api.patch("/quotes/:id", async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const body = await c.req.json<{
    customerId?: string | null;
    notes?: string | null;
    validUntil?: string | null;
    serviceLabel?: string | null;
    lines: { productId: string; qty: number; unitPrice?: number }[];
  }>();
  if (!body.lines?.length) return c.json({ error: "Agregue líneas" }, 400);
  const serviceLabelPatch =
    body.serviceLabel === undefined
      ? undefined
      : body.serviceLabel === null || body.serviceLabel === ""
        ? null
        : String(body.serviceLabel).trim().slice(0, 120) || null;

  const existing = await prisma.quote.findFirst({
    where: { id, organizationId: jwt.orgId },
  });
  if (!existing) return c.json({ error: "No encontrado" }, 404);
  if (existing.status === "CONVERTIDA") return c.json({ error: "No se puede editar una cotización ya convertida" }, 400);

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      let subtotal = 0;
      let tax = 0;
      const linesData: { productId: string; qty: number; unitPrice: number; taxPercent: number; lineTotal: number }[] =
        [];

      for (const line of body.lines) {
        const product = await tx.product.findFirst({
          where: { id: line.productId, organizationId: jwt.orgId },
        });
        if (!product) throw new Error("PRODUCT_NOT_FOUND");
        if (product.productType === "INSUMO") throw new Error("INSUMO_NOT_SALEABLE");
        const unitPrice = line.unitPrice ?? resolveProductUnitPrice(product, line.qty, 1);
        const base = unitPrice * line.qty;
        const taxPercent = product.taxPercent;
        const lineTax = base * (taxPercent / 100);
        const lineTotal = base + lineTax;
        subtotal += base;
        tax += lineTax;
        linesData.push({ productId: product.id, qty: line.qty, unitPrice, taxPercent, lineTotal });
      }

      const total = subtotal + tax;
      await tx.quoteLine.deleteMany({ where: { quoteId: id } });

      const data: {
        subtotal: number;
        tax: number;
        total: number;
        notes?: string | null;
        validUntil?: Date | null;
        customerId?: string | null;
        serviceLabel?: string | null;
      } = {
        subtotal,
        tax,
        total,
      };
      if (body.notes !== undefined) {
        data.notes = body.notes === null || body.notes === "" ? null : body.notes;
      }
      if (body.validUntil !== undefined) {
        data.validUntil = body.validUntil ? new Date(body.validUntil) : null;
      }
      if (body.customerId !== undefined) {
        data.customerId = body.customerId?.trim() ? body.customerId.trim() : null;
      }
      if (serviceLabelPatch !== undefined) {
        data.serviceLabel = serviceLabelPatch;
      }

      await tx.quote.update({
        where: { id },
        data: {
          ...data,
          lines: { create: linesData },
        },
      });

      return tx.quote.findFirst({
        where: { id },
        include: { customer: true, lines: { include: { product: true } } },
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "PRODUCT_NOT_FOUND") return c.json({ error: "Producto no encontrado" }, 400);
    if (msg === "INSUMO_NOT_SALEABLE") return c.json({ error: "Los insumos no se incluyen en cotizaciones" }, 400);
    throw e;
  }

  return c.json(updated);
});

api.post("/quotes/:id/convert-to-sale", async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const convertBody = (await c.req.json().catch(() => ({}))) as {
    terms?: string;
    paid?: number;
    customerId?: string | null;
  };
  const terms = normalizeSaleTerms(convertBody.terms ?? "CONTADO");
  const quote = await prisma.quote.findFirst({
    where: { id, organizationId: jwt.orgId },
    include: { lines: true },
  });
  if (!quote) return c.json({ error: "No encontrado" }, 404);
  if (quote.status === "CONVERTIDA") return c.json({ error: "Ya convertida" }, 400);

  const bodyCust =
    typeof convertBody.customerId === "string" && convertBody.customerId.trim()
      ? convertBody.customerId.trim()
      : null;
  const resolvedCustomerId = bodyCust ?? quote.customerId;
  if (isCreditSaleTerm(terms)) {
    if (!resolvedCustomerId) {
      return c.json(
        { error: "Las ventas a crédito requieren un cliente (asígnelo a la cotización o envíe customerId)" },
        400
      );
    }
    const cust = await prisma.customer.findFirst({
      where: { id: resolvedCustomerId, organizationId: jwt.orgId },
    });
    if (!cust) return c.json({ error: "Cliente no encontrado" }, 400);
  }

  const sale = await prisma.$transaction(async (tx) => {
    let subtotal = 0;
    let tax = 0;
    const saleLines: { productId: string; qty: number; unitPrice: number; discountPercent: number; taxPercent: number; lineTotal: number }[] = [];

    for (const l of quote.lines) {
      const product = await tx.product.findFirst({
        where: { id: l.productId, organizationId: jwt.orgId },
      });
      if (!product) throw new Error("STOCK");
      if (product.productType === "INSUMO") throw new Error("STOCK");
      const isService = product.productType === "SERVICIO";
      const isKit = product.productType === "KIT";
      if (isKit) {
        await assertKitSaleStock(tx, product.id, l.qty);
      } else if (!isService && product.stock < l.qty) {
        throw new Error("STOCK");
      }
      const base = l.unitPrice * l.qty;
      const lineTax = base * (l.taxPercent / 100);
      const lineTotal = base + lineTax;
      subtotal += base;
      tax += lineTax;
      saleLines.push({
        productId: l.productId,
        qty: l.qty,
        unitPrice: l.unitPrice,
        discountPercent: 0,
        taxPercent: l.taxPercent,
        lineTotal,
      });
    }
    const total = subtotal + tax;
    const paid = resolveSalePaid(total, terms, convertBody.paid);
    const count = await tx.sale.count({ where: { organizationId: jwt.orgId } });
    const invoiceNumber = String(count + 1).padStart(6, "0");
    const s = await tx.sale.create({
      data: {
        organizationId: jwt.orgId,
        userId: jwt.sub,
        customerId: resolvedCustomerId,
        invoiceNumber,
        terms,
        notes: `Desde cotización ${quote.quoteNumber}`,
        priceTier: 1,
        subtotal,
        tax,
        total,
        paid,
        lines: { create: saleLines },
      },
    });
    for (const line of saleLines) {
      const prod = await tx.product.findUnique({ where: { id: line.productId } });
      if (prod?.productType === "SERVICIO") continue;
      if (prod?.productType === "KIT") {
        await decrementStockForKitSale(tx, jwt.orgId, prod.id, line.qty);
        continue;
      }
      await adjustProductStock(tx, jwt.orgId, line.productId, -line.qty);
    }
    await tx.quote.update({ where: { id: quote.id }, data: { status: "CONVERTIDA" } });
    return tx.sale.findUnique({
      where: { id: s.id },
      include: {
        lines: { include: { product: true } },
        customer: true,
        user: { select: { id: true, displayName: true, username: true } },
      },
    });
  }).catch(() => null);

  if (!sale) return c.json({ error: "No se pudo convertir (stock o datos)" }, 400);
  return c.json(sale);
});

api.get("/orders", async (c) => {
  const jwt = c.get("jwt");
  return c.json(
    await prisma.supplierOrder.findMany({
      where: { organizationId: jwt.orgId },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { supplier: true, lines: { include: { product: true } } },
    })
  );
});

api.post("/orders", async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    supplierId?: string | null;
    expectedDate?: string | null;
    notes?: string;
    lines: { productId: string; qty: number; unitPrice?: number | null; notes?: string }[];
  }>();
  if (!body.lines?.length) return c.json({ error: "Agregue líneas" }, 400);
  const n = await prisma.supplierOrder.count({ where: { organizationId: jwt.orgId } });
  const order = await prisma.supplierOrder.create({
    data: {
      organizationId: jwt.orgId,
      userId: jwt.sub,
      supplierId: body.supplierId || null,
      orderNumber: `PED-${String(n + 1).padStart(5, "0")}`,
      expectedDate: body.expectedDate ? new Date(body.expectedDate) : null,
      notes: body.notes,
      lines: {
        create: body.lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unitPrice: l.unitPrice ?? null,
          notes: l.notes,
        })),
      },
    },
    include: { lines: { include: { product: true } }, supplier: true },
  });
  return c.json(order, 201);
});

api.patch("/orders/:id/status", async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const body = await c.req.json<{ status: string }>();
  const r = await prisma.supplierOrder.updateMany({
    where: { id, organizationId: jwt.orgId },
    data: { status: body.status },
  });
  if (r.count === 0) return c.json({ error: "No encontrado" }, 404);
  return c.json(await prisma.supplierOrder.findUnique({ where: { id }, include: { lines: true } }));
});

function mergeTransferLines(lines: { productId: string; qty: number }[]): { productId: string; qty: number }[] {
  const m = new Map<string, number>();
  for (const l of lines) {
    const q = Number(l.qty);
    if (!Number.isFinite(q)) continue;
    m.set(l.productId, (m.get(l.productId) ?? 0) + q);
  }
  return [...m.entries()].map(([productId, qty]) => ({ productId, qty }));
}

const transferInclude = {
  fromLocation: true,
  toLocation: true,
  user: { select: { id: true, displayName: true, username: true } },
  lines: { include: { product: true } },
} as const;

api.get("/stock-locations", async (c) => {
  const jwt = c.get("jwt");
  const list = await prisma.stockLocation.findMany({
    where: { organizationId: jwt.orgId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return c.json(list);
});

api.post("/stock-locations", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{ code: string; name: string; sortOrder?: number }>();
  const code = body.code?.trim().toUpperCase();
  if (!code || !body.name?.trim()) return c.json({ error: "Código y nombre requeridos" }, 400);
  try {
    const row = await prisma.stockLocation.create({
      data: {
        organizationId: jwt.orgId,
        code,
        name: body.name.trim(),
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return c.json(row, 201);
  } catch {
    return c.json({ error: "Código de ubicación duplicado" }, 409);
  }
});

api.patch("/stock-locations/:id", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const body = await c.req.json<{ name?: string; active?: boolean; sortOrder?: number }>();
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder);
  const r = await prisma.stockLocation.updateMany({ where: { id, organizationId: jwt.orgId }, data });
  if (r.count === 0) return c.json({ error: "No encontrado" }, 404);
  return c.json(await prisma.stockLocation.findUnique({ where: { id } }));
});

api.get("/stock-transfers", requirePermission(PERMISSION_KEYS.INVENTORY_TRANSFERS), async (c) => {
  const jwt = c.get("jwt");
  const list = await prisma.stockTransfer.findMany({
    where: { organizationId: jwt.orgId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: transferInclude,
  });
  return c.json(list);
});

api.get("/stock-transfers/:id/print.html", requirePermission(PERMISSION_KEYS.INVENTORY_TRANSFERS), async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const row = await prisma.stockTransfer.findFirst({
    where: { id, organizationId: jwt.orgId },
    include: transferInclude,
  });
  if (!row) return c.json({ error: "No encontrado" }, 404);
  const org = await prisma.organization.findUnique({ where: { id: jwt.orgId }, select: { name: true } });
  const autoPrint = c.req.query("print") === "1";
  const html = buildStockTransferPrintHtml({
    orgName: org?.name ?? "",
    transferNumber: row.transferNumber,
    status: row.status,
    fromName: `${row.fromLocation.code} — ${row.fromLocation.name}`,
    toName: `${row.toLocation.code} — ${row.toLocation.name}`,
    notes: row.notes,
    lines: row.lines.map((l) => ({
      product: { sku: l.product.sku, name: l.product.name, unit: l.product.unit },
      qty: l.qty,
    })),
    autoPrint,
  });
  return c.html(html);
});

api.get("/stock-transfers/:id", requirePermission(PERMISSION_KEYS.INVENTORY_TRANSFERS), async (c) => {
  const jwt = c.get("jwt");
  const row = await prisma.stockTransfer.findFirst({
    where: { id: c.req.param("id"), organizationId: jwt.orgId },
    include: transferInclude,
  });
  if (!row) return c.json({ error: "No encontrado" }, 404);
  return c.json(row);
});

api.post("/stock-transfers", requirePermission(PERMISSION_KEYS.INVENTORY_TRANSFERS), async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    fromLocationId: string;
    toLocationId: string;
    notes?: string;
    lines: { productId: string; qty: number }[];
  }>();
  if (!body.lines?.length) return c.json({ error: "Agregue líneas al traslado" }, 400);
  if (body.fromLocationId === body.toLocationId) {
    return c.json({ error: "Origen y destino deben ser distintos" }, 400);
  }
  const merged = mergeTransferLines(body.lines);
  try {
    const t = await prisma.$transaction(async (tx) => {
      const fromLoc = await tx.stockLocation.findFirst({
        where: { id: body.fromLocationId, organizationId: jwt.orgId, active: true },
      });
      const toLoc = await tx.stockLocation.findFirst({
        where: { id: body.toLocationId, organizationId: jwt.orgId, active: true },
      });
      if (!fromLoc || !toLoc) throw new Error("TRANSFER_LOC_NOT_FOUND");
      await validateTransferLineProducts(tx, jwt.orgId, merged);
      const n = await tx.stockTransfer.count({ where: { organizationId: jwt.orgId } });
      const transferNumber = `TR-${String(n + 1).padStart(5, "0")}`;
      return tx.stockTransfer.create({
        data: {
          organizationId: jwt.orgId,
          userId: jwt.sub,
          transferNumber,
          fromLocationId: body.fromLocationId,
          toLocationId: body.toLocationId,
          notes: body.notes?.trim() || null,
          status: "BORRADOR",
          lines: { create: merged.map((l) => ({ productId: l.productId, qty: l.qty })) },
        },
        include: transferInclude,
      });
    });
    return c.json(t, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "TRANSFER_LOC_NOT_FOUND") return c.json({ error: "Ubicación no válida" }, 400);
    if (msg === "TRANSFER_NO_LINES") return c.json({ error: "Sin líneas" }, 400);
    if (msg === "TRANSFER_BAD_QTY") return c.json({ error: "Cantidad inválida" }, 400);
    if (msg === "TRANSFER_PRODUCT_NOT_FOUND") return c.json({ error: "Producto no encontrado" }, 400);
    if (msg === "TRANSFER_BAD_PRODUCT_TYPE") {
      return c.json({ error: "No se trasladan kits ni servicios" }, 400);
    }
    throw e;
  }
});

api.post("/stock-transfers/:id/send", requirePermission(PERMISSION_KEYS.INVENTORY_TRANSFERS), async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const tr = await tx.stockTransfer.findFirst({
        where: { id, organizationId: jwt.orgId },
        include: { lines: true },
      });
      if (!tr) return null;
      if (tr.status !== "BORRADOR") throw new Error("TRANSFER_BAD_STATUS");
      await assertStockForTransferSend(
        tx,
        jwt.orgId,
        tr.fromLocationId,
        tr.lines.map((l) => ({ productId: l.productId, qty: l.qty }))
      );
      await applyTransferSendStock(
        tx,
        jwt.orgId,
        tr.fromLocationId,
        tr.lines.map((l) => ({ productId: l.productId, qty: l.qty }))
      );
      await tx.stockTransfer.update({
        where: { id },
        data: { status: "ENVIADA", sentAt: new Date() },
      });
      return tx.stockTransfer.findUnique({ where: { id }, include: transferInclude });
    });
    if (!updated) return c.json({ error: "No encontrado" }, 404);
    return c.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "TRANSFER_BAD_STATUS") return c.json({ error: "Solo se puede enviar un traslado en borrador" }, 400);
    if (msg === "INSUFFICIENT_STOCK") return c.json({ error: "Stock insuficiente para enviar" }, 400);
    if (msg === "TRANSFER_PRODUCT_NOT_FOUND") return c.json({ error: "Producto no encontrado" }, 400);
    throw e;
  }
});

api.post("/stock-transfers/:id/receive", requirePermission(PERMISSION_KEYS.INVENTORY_TRANSFERS), async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const tr = await tx.stockTransfer.findFirst({
        where: { id, organizationId: jwt.orgId },
        include: { lines: true },
      });
      if (!tr) return null;
      if (tr.status !== "ENVIADA") throw new Error("TRANSFER_BAD_STATUS");
      await applyTransferReceiveStock(
        tx,
        jwt.orgId,
        tr.toLocationId,
        tr.lines.map((l) => ({ productId: l.productId, qty: l.qty }))
      );
      await tx.stockTransfer.update({
        where: { id },
        data: { status: "RECIBIDA", receivedAt: new Date() },
      });
      return tx.stockTransfer.findUnique({ where: { id }, include: transferInclude });
    });
    if (!updated) return c.json({ error: "No encontrado" }, 404);
    return c.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "TRANSFER_BAD_STATUS") {
      return c.json({ error: "Solo se puede recibir un traslado enviado" }, 400);
    }
    throw e;
  }
});

api.post("/stock-transfers/:id/cancel", requirePermission(PERMISSION_KEYS.INVENTORY_TRANSFERS), async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const tr = await tx.stockTransfer.findFirst({
        where: { id, organizationId: jwt.orgId },
        include: { lines: true },
      });
      if (!tr) return null;
      if (tr.status === "RECIBIDA" || tr.status === "ANULADA") throw new Error("TRANSFER_NO_CANCEL");
      if (tr.status === "ENVIADA") {
        await applyTransferUndoSendStock(
          tx,
          jwt.orgId,
          tr.fromLocationId,
          tr.lines.map((l) => ({ productId: l.productId, qty: l.qty }))
        );
      }
      await tx.stockTransfer.update({
        where: { id },
        data: { status: "ANULADA" },
      });
      return tx.stockTransfer.findUnique({ where: { id }, include: transferInclude });
    });
    if (!updated) return c.json({ error: "No encontrado" }, 404);
    return c.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "TRANSFER_NO_CANCEL") return c.json({ error: "No se puede anular este traslado" }, 400);
    throw e;
  }
});

api.get("/stock-transfers/:id/export-file", requirePermission(PERMISSION_KEYS.INVENTORY_TRANSFERS), async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const tr = await prisma.stockTransfer.findFirst({
    where: { id, organizationId: jwt.orgId },
    include: {
      fromLocation: { select: { code: true } },
      toLocation: { select: { code: true } },
      lines: { include: { product: { select: { sku: true } } } },
    },
  });
  if (!tr) return c.json({ error: "No encontrado" }, 404);
  const payload = {
    version: 1 as const,
    exportType: "punto-flow-stock-transfer" as const,
    fromLocationCode: tr.fromLocation.code,
    toLocationCode: tr.toLocation.code,
    notes: tr.notes,
    lines: tr.lines.map((l) => ({ sku: l.product.sku, qty: l.qty })),
  };
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="traslado-${tr.transferNumber ?? id}.json"`);
  return c.body(JSON.stringify(payload, null, 2));
});

api.post("/stock-transfers/import-file", requirePermission(PERMISSION_KEYS.INVENTORY_TRANSFERS), async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    version?: number;
    exportType?: string;
    fromLocationCode: string;
    toLocationCode: string;
    notes?: string | null;
    lines: { sku: string; qty: number }[];
  }>();
  if (body.exportType !== "punto-flow-stock-transfer" || body.version !== 1) {
    return c.json({ error: "Formato de archivo no reconocido" }, 400);
  }
  if (!body.lines?.length) return c.json({ error: "Sin líneas" }, 400);
  const fromCode = body.fromLocationCode?.trim();
  const toCode = body.toLocationCode?.trim();
  if (!fromCode || !toCode || fromCode === toCode) {
    return c.json({ error: "Códigos de ubicación inválidos" }, 400);
  }
  try {
    const t = await prisma.$transaction(async (tx) => {
      const fromLoc = await tx.stockLocation.findFirst({
        where: { organizationId: jwt.orgId, code: fromCode, active: true },
      });
      const toLoc = await tx.stockLocation.findFirst({
        where: { organizationId: jwt.orgId, code: toCode, active: true },
      });
      if (!fromLoc || !toLoc) throw new Error("TRANSFER_LOC_NOT_FOUND");
      const merged: { productId: string; qty: number }[] = [];
      for (const line of body.lines) {
        const sku = line.sku?.trim();
        const qty = Number(line.qty);
        if (!sku || !Number.isFinite(qty) || qty <= 0) throw new Error("TRANSFER_BAD_QTY");
        const p = await tx.product.findFirst({
          where: { organizationId: jwt.orgId, sku, active: true },
        });
        if (!p) throw new Error("TRANSFER_PRODUCT_NOT_FOUND");
        merged.push({ productId: p.id, qty });
      }
      const linesNorm = mergeTransferLines(merged);
      await validateTransferLineProducts(tx, jwt.orgId, linesNorm);
      const n = await tx.stockTransfer.count({ where: { organizationId: jwt.orgId } });
      const transferNumber = `TR-${String(n + 1).padStart(5, "0")}`;
      return tx.stockTransfer.create({
        data: {
          organizationId: jwt.orgId,
          userId: jwt.sub,
          transferNumber,
          fromLocationId: fromLoc.id,
          toLocationId: toLoc.id,
          notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 500) || null : null,
          status: "BORRADOR",
          lines: { create: linesNorm.map((l) => ({ productId: l.productId, qty: l.qty })) },
        },
        include: transferInclude,
      });
    });
    return c.json(t, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "TRANSFER_LOC_NOT_FOUND") return c.json({ error: "Ubicación no válida" }, 400);
    if (msg === "TRANSFER_BAD_QTY") return c.json({ error: "Cantidad o SKU inválido" }, 400);
    if (msg === "TRANSFER_PRODUCT_NOT_FOUND") return c.json({ error: "Producto no encontrado" }, 400);
    if (msg === "TRANSFER_BAD_PRODUCT_TYPE") {
      return c.json({ error: "No se trasladan kits ni servicios" }, 400);
    }
    throw e;
  }
});

const adjustmentInclude = {
  user: { select: { id: true, displayName: true, username: true } },
  lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
} as const;

api.get("/stock-adjustments", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const list = await prisma.stockAdjustment.findMany({
    where: { organizationId: jwt.orgId },
    orderBy: { createdAt: "desc" },
    take: 150,
    include: adjustmentInclude,
  });
  return c.json(list);
});

api.post("/stock-adjustments", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    reason: string;
    notes?: string;
    lines: { productId: string; qtyDelta: number }[];
  }>();
  if (!body.reason?.trim()) return c.json({ error: "Indique el motivo del ajuste" }, 400);
  if (!body.lines?.length) return c.json({ error: "Agregue al menos una línea" }, 400);
  try {
    const adj = await prisma.$transaction(async (tx) => {
      for (const line of body.lines) {
        const d = Number(line.qtyDelta);
        if (!Number.isFinite(d) || d === 0) throw new Error("ADJ_BAD_QTY");
        const p = await tx.product.findFirst({
          where: { id: line.productId, organizationId: jwt.orgId },
        });
        if (!p) throw new Error("PRODUCT_NOT_FOUND");
        if (p.stock + d < -0.00001) throw new Error("INSUFFICIENT_STOCK");
      }
      const n = await tx.stockAdjustment.count({ where: { organizationId: jwt.orgId } });
      const adjustmentNumber = `ADJ-${String(n + 1).padStart(5, "0")}`;
      const created = await tx.stockAdjustment.create({
        data: {
          organizationId: jwt.orgId,
          userId: jwt.sub,
          adjustmentNumber,
          reason: body.reason.trim(),
          notes: body.notes?.trim() || null,
          lines: {
            create: body.lines.map((l) => ({
              productId: l.productId,
              qtyDelta: Number(l.qtyDelta),
            })),
          },
        },
      });
      for (const line of body.lines) {
        await adjustProductStock(tx, jwt.orgId, line.productId, Number(line.qtyDelta));
      }
      return tx.stockAdjustment.findUnique({
        where: { id: created.id },
        include: adjustmentInclude,
      });
    });
    return c.json(adj, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "ADJ_BAD_QTY") {
      return c.json({ error: "Cada línea necesita un cambio numérico distinto de cero" }, 400);
    }
    if (msg === "PRODUCT_NOT_FOUND") return c.json({ error: "Producto no encontrado" }, 400);
    if (msg === "INSUFFICIENT_STOCK") {
      return c.json({ error: "El ajuste dejaría existencia negativa en algún producto" }, 400);
    }
    throw e;
  }
});

const employeeSelect = {
  id: true,
  employeeCode: true,
  name: true,
  idDocument: true,
  phone: true,
  email: true,
  position: true,
  hireDate: true,
  active: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;

api.get("/employees", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const list = await prisma.employee.findMany({
    where: { organizationId: jwt.orgId },
    orderBy: { name: "asc" },
    select: employeeSelect,
  });
  return c.json(list);
});

api.post("/employees", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    name: string;
    employeeCode?: string | null;
    idDocument?: string | null;
    phone?: string | null;
    email?: string | null;
    position?: string | null;
    hireDate?: string | null;
    notes?: string | null;
    active?: boolean;
  }>();
  if (!body.name?.trim()) return c.json({ error: "Indique el nombre" }, 400);
  const code = body.employeeCode?.trim() || null;
  if (code) {
    const dup = await prisma.employee.findFirst({
      where: { organizationId: jwt.orgId, employeeCode: code },
    });
    if (dup) return c.json({ error: "Ya existe un empleado con ese código" }, 400);
  }
  const row = await prisma.employee.create({
    data: {
      organizationId: jwt.orgId,
      name: body.name.trim(),
      employeeCode: code,
      idDocument: body.idDocument?.trim() || null,
      phone: body.phone?.trim() || null,
      email: body.email?.trim() || null,
      position: body.position?.trim() || null,
      hireDate: body.hireDate ? new Date(body.hireDate) : null,
      notes: body.notes?.trim() || null,
      active: body.active !== false,
    },
    select: employeeSelect,
  });
  return c.json(row, 201);
});

api.patch("/employees/:id", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    employeeCode?: string | null;
    idDocument?: string | null;
    phone?: string | null;
    email?: string | null;
    position?: string | null;
    hireDate?: string | null;
    notes?: string | null;
    active?: boolean;
  }>();
  const cur = await prisma.employee.findFirst({ where: { id, organizationId: jwt.orgId } });
  if (!cur) return c.json({ error: "No encontrado" }, 404);
  const code = body.employeeCode !== undefined ? (body.employeeCode?.trim() || null) : undefined;
  if (code) {
    const dup = await prisma.employee.findFirst({
      where: { organizationId: jwt.orgId, employeeCode: code, NOT: { id } },
    });
    if (dup) return c.json({ error: "Ya existe un empleado con ese código" }, 400);
  }
  const row = await prisma.employee.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() || cur.name } : {}),
      ...(code !== undefined ? { employeeCode: code } : {}),
      ...(body.idDocument !== undefined ? { idDocument: body.idDocument?.trim() || null } : {}),
      ...(body.phone !== undefined ? { phone: body.phone?.trim() || null } : {}),
      ...(body.email !== undefined ? { email: body.email?.trim() || null } : {}),
      ...(body.position !== undefined ? { position: body.position?.trim() || null } : {}),
      ...(body.hireDate !== undefined
        ? { hireDate: body.hireDate ? new Date(body.hireDate) : null }
        : {}),
      ...(body.notes !== undefined ? { notes: body.notes?.trim() || null } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    },
    select: employeeSelect,
  });
  return c.json(row);
});

const expenseInclude = {
  user: { select: { id: true, displayName: true, username: true } },
  book: { select: { id: true, name: true } },
  expenseCategory: { select: { id: true, name: true } },
} as const;

api.get("/expense-books", requirePermission(PERMISSION_KEYS.EXPENSES_VIEW), async (c) => {
  const jwt = c.get("jwt");
  const list = await prisma.expenseBook.findMany({
    where: { organizationId: jwt.orgId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { categories: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
  });
  return c.json(list);
});

api.post("/expense-books", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{ name: string; sortOrder?: number }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "Nombre requerido" }, 400);
  const row = await prisma.expenseBook.create({
    data: {
      organizationId: jwt.orgId,
      name,
      sortOrder: body.sortOrder != null ? Math.trunc(Number(body.sortOrder)) : 0,
    },
    include: { categories: true },
  });
  return c.json(row, 201);
});

api.patch("/expense-books/:id", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const body = await c.req.json<{ name?: string; sortOrder?: number }>();
  const cur = await prisma.expenseBook.findFirst({ where: { id, organizationId: jwt.orgId } });
  if (!cur) return c.json({ error: "No encontrado" }, 404);
  const row = await prisma.expenseBook.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() || cur.name } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: Math.trunc(Number(body.sortOrder)) } : {}),
    },
    include: { categories: true },
  });
  return c.json(row);
});

api.post("/expense-books/:bookId/categories", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const bookId = c.req.param("bookId");
  const book = await prisma.expenseBook.findFirst({ where: { id: bookId, organizationId: jwt.orgId } });
  if (!book) return c.json({ error: "Libro no encontrado" }, 404);
  const body = await c.req.json<{ name: string; sortOrder?: number }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "Nombre requerido" }, 400);
  const row = await prisma.expenseCategory.create({
    data: {
      bookId,
      name,
      sortOrder: body.sortOrder != null ? Math.trunc(Number(body.sortOrder)) : 0,
    },
  });
  return c.json(row, 201);
});

api.get("/expenses", requirePermission(PERMISSION_KEYS.EXPENSES_VIEW), async (c) => {
  const jwt = c.get("jwt");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const category = c.req.query("category");
  const where: {
    organizationId: string;
    expenseDate?: { gte?: Date; lte?: Date };
    category?: string;
  } = { organizationId: jwt.orgId };
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) where.expenseDate = { ...where.expenseDate, gte: d };
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) where.expenseDate = { ...where.expenseDate, lte: d };
  }
  if (category?.trim()) where.category = category.trim();
  const list = await prisma.expense.findMany({
    where,
    orderBy: { expenseDate: "desc" },
    take: 500,
    include: expenseInclude,
  });
  return c.json(list);
});

api.post("/expenses", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    category: string;
    amount: number;
    expenseDate?: string;
    notes?: string | null;
    bookId?: string | null;
    categoryId?: string | null;
  }>();
  let categoryName = body.category?.trim() ?? "";
  let bookId: string | null = body.bookId?.trim() || null;
  let categoryId: string | null = body.categoryId?.trim() || null;
  if (categoryId) {
    const ec = await prisma.expenseCategory.findFirst({
      where: { id: categoryId, book: { organizationId: jwt.orgId } },
    });
    if (!ec) return c.json({ error: "Categoría no encontrada" }, 400);
    categoryName = ec.name;
    bookId = ec.bookId;
  }
  if (!categoryName) return c.json({ error: "Indique la categoría" }, 400);
  if (bookId) {
    const b = await prisma.expenseBook.findFirst({ where: { id: bookId, organizationId: jwt.orgId } });
    if (!b) return c.json({ error: "Libro no encontrado" }, 400);
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return c.json({ error: "Monto inválido" }, 400);
  const row = await prisma.expense.create({
    data: {
      organizationId: jwt.orgId,
      userId: jwt.sub,
      category: categoryName,
      amount,
      expenseDate: body.expenseDate ? new Date(body.expenseDate) : new Date(),
      notes: body.notes?.trim() || null,
      bookId,
      categoryId,
    },
    include: expenseInclude,
  });
  return c.json(row, 201);
});

type PayrollLineBody = {
  employeeId: string;
  gross: number;
  deductions?: number;
  net: number;
  notes?: string | null;
  deductionItems?: { concept: string; amount: number }[];
};

type ResolvedPayrollLine = {
  employeeId: string;
  gross: number;
  deductions: number;
  net: number;
  notes: string | null;
  deductionCreates: { concept: string; amount: number; sortOrder: number }[];
};

function resolvePayrollLineBody(L: PayrollLineBody): ResolvedPayrollLine {
  const g = Number(L.gross);
  const rawItems = Array.isArray(L.deductionItems) ? L.deductionItems : [];
  const deductionCreates = rawItems
    .map((x, idx) => {
      const concept = typeof x.concept === "string" ? x.concept.trim().slice(0, 80) : "";
      const amount = Number(x.amount);
      return { concept, amount, sortOrder: idx };
    })
    .filter((x) => x.concept.length > 0 && Number.isFinite(x.amount) && x.amount >= 0);

  if (deductionCreates.length > 0) {
    const d = deductionCreates.reduce((s, x) => s + x.amount, 0);
    const n = g - d;
    if (!Number.isFinite(g) || !Number.isFinite(n) || n < -0.0001) throw new Error("PAYROLL_BAD_NUM");
    return {
      employeeId: L.employeeId,
      gross: g,
      deductions: d,
      net: n,
      notes: typeof L.notes === "string" ? L.notes.trim().slice(0, 500) || null : null,
      deductionCreates,
    };
  }

  const d = Number(L.deductions ?? 0);
  const n = Number(L.net);
  if (!Number.isFinite(g) || !Number.isFinite(d) || !Number.isFinite(n)) throw new Error("PAYROLL_BAD_NUM");
  return {
    employeeId: L.employeeId,
    gross: g,
    deductions: d,
    net: n,
    notes: typeof L.notes === "string" ? L.notes.trim().slice(0, 500) || null : null,
    deductionCreates: [],
  };
}

const payrollPeriodInclude = {
  user: { select: { id: true, displayName: true, username: true } },
  lines: {
    include: {
      employee: { select: { id: true, name: true, employeeCode: true } },
      deductionItems: { orderBy: { sortOrder: "asc" as const } },
    },
  },
} as const;

api.get("/payroll-periods", requirePermission(PERMISSION_KEYS.PAYROLL_VIEW), async (c) => {
  const jwt = c.get("jwt");
  const list = await prisma.payrollPeriod.findMany({
    where: { organizationId: jwt.orgId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take: 60,
    include: {
      user: { select: { id: true, displayName: true, username: true } },
      _count: { select: { lines: true } },
    },
  });
  return c.json(list);
});

api.get("/payroll-periods/:id", requirePermission(PERMISSION_KEYS.PAYROLL_VIEW), async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const row = await prisma.payrollPeriod.findFirst({
    where: { id, organizationId: jwt.orgId },
    include: payrollPeriodInclude,
  });
  if (!row) return c.json({ error: "No encontrado" }, 404);
  return c.json(row);
});

api.post("/payroll-periods", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    year: number;
    month: number;
    notes?: string | null;
    lines: PayrollLineBody[];
  }>();
  const year = Math.floor(Number(body.year));
  const month = Math.floor(Number(body.month));
  if (year < 2000 || year > 2100 || month < 1 || month > 12) {
    return c.json({ error: "Año o mes inválido" }, 400);
  }
  if (!body.lines?.length) return c.json({ error: "Agregue al menos una línea de planilla" }, 400);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const exists = await tx.payrollPeriod.findUnique({
        where: {
          organizationId_year_month: { organizationId: jwt.orgId, year, month },
        },
      });
      if (exists) throw new Error("PAYROLL_DUP");
      for (const L of body.lines) {
        const emp = await tx.employee.findFirst({
          where: { id: L.employeeId, organizationId: jwt.orgId, active: true },
        });
        if (!emp) throw new Error("EMP_NOT_FOUND");
        resolvePayrollLineBody(L);
      }
      return tx.payrollPeriod.create({
        data: {
          organizationId: jwt.orgId,
          userId: jwt.sub,
          year,
          month,
          notes: body.notes?.trim() || null,
          lines: {
            create: body.lines.map((L) => {
              const r = resolvePayrollLineBody(L);
              return {
                employeeId: r.employeeId,
                gross: r.gross,
                deductions: r.deductions,
                net: r.net,
                notes: r.notes,
                ...(r.deductionCreates.length > 0
                  ? {
                      deductionItems: {
                        create: r.deductionCreates.map((x) => ({
                          concept: x.concept,
                          amount: x.amount,
                          sortOrder: x.sortOrder,
                        })),
                      },
                    }
                  : {}),
              };
            }),
          },
        },
        include: payrollPeriodInclude,
      });
    });
    return c.json(created, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "PAYROLL_DUP") return c.json({ error: "Ya existe planilla para ese mes" }, 409);
    if (msg === "EMP_NOT_FOUND") return c.json({ error: "Empleado no encontrado o inactivo" }, 400);
    if (msg === "PAYROLL_BAD_NUM") return c.json({ error: "Montos inválidos en líneas" }, 400);
    throw e;
  }
});

api.patch("/payroll-periods/:id", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const body = await c.req.json<{
    status?: string;
    notes?: string | null;
    lines?: PayrollLineBody[];
  }>();
  const cur = await prisma.payrollPeriod.findFirst({ where: { id, organizationId: jwt.orgId } });
  if (!cur) return c.json({ error: "No encontrado" }, 404);
  if (cur.status === "CERRADA" && body.lines) {
    return c.json({ error: "No se puede editar líneas de una planilla cerrada" }, 400);
  }
  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (body.lines && cur.status === "BORRADOR") {
        for (const L of body.lines) {
          const emp = await tx.employee.findFirst({
            where: { id: L.employeeId, organizationId: jwt.orgId, active: true },
          });
          if (!emp) throw new Error("EMP_NOT_FOUND");
          resolvePayrollLineBody(L);
        }
        await tx.payrollLine.deleteMany({ where: { periodId: id } });
        for (const L of body.lines) {
          const r = resolvePayrollLineBody(L);
          await tx.payrollLine.create({
            data: {
              periodId: id,
              employeeId: r.employeeId,
              gross: r.gross,
              deductions: r.deductions,
              net: r.net,
              notes: r.notes,
              ...(r.deductionCreates.length > 0
                ? {
                    deductionItems: {
                      create: r.deductionCreates.map((x) => ({
                        concept: x.concept,
                        amount: x.amount,
                        sortOrder: x.sortOrder,
                      })),
                    },
                  }
                : {}),
            },
          });
        }
      }
      return tx.payrollPeriod.update({
        where: { id },
        data: {
          ...(body.status === "CERRADA" || body.status === "BORRADOR" ? { status: body.status } : {}),
          ...(body.notes !== undefined ? { notes: body.notes?.trim() || null } : {}),
        },
        include: payrollPeriodInclude,
      });
    });
    return c.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "EMP_NOT_FOUND") return c.json({ error: "Empleado no encontrado o inactivo" }, 400);
    if (msg === "PAYROLL_BAD_NUM") return c.json({ error: "Montos inválidos en líneas" }, 400);
    throw e;
  }
});

api.get("/settings", async (c) => {
  const jwt = c.get("jwt");
  let s = await prisma.organizationSettings.findUnique({ where: { organizationId: jwt.orgId } });
  if (!s) {
    s = await prisma.organizationSettings.create({ data: { organizationId: jwt.orgId } });
  }
  return c.json({
    general: JSON.parse(s.generalJson || "{}"),
    invoice: JSON.parse(s.invoiceJson || "{}"),
  });
});

api.patch("/settings", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{ general?: Record<string, unknown>; invoice?: Record<string, unknown> }>();
  let s = await prisma.organizationSettings.findUnique({ where: { organizationId: jwt.orgId } });
  if (!s) s = await prisma.organizationSettings.create({ data: { organizationId: jwt.orgId } });
  const prevG = JSON.parse(s.generalJson || "{}") as Record<string, unknown>;
  const prevI = JSON.parse(s.invoiceJson || "{}") as Record<string, unknown>;
  const general =
    body.general != null ? JSON.stringify({ ...prevG, ...body.general }) : s.generalJson;
  const invoice =
    body.invoice != null ? JSON.stringify({ ...prevI, ...body.invoice }) : s.invoiceJson;
  const updated = await prisma.organizationSettings.update({
    where: { organizationId: jwt.orgId },
    data: { generalJson: general, invoiceJson: invoice },
  });
  return c.json({
    general: JSON.parse(updated.generalJson),
    invoice: JSON.parse(updated.invoiceJson),
  });
});

api.post("/settings/touch-favorites", async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{ productIds: string[] }>();
  const ids = Array.isArray(body.productIds) ? body.productIds.filter((x) => typeof x === "string") : [];
  let s = await prisma.organizationSettings.findUnique({ where: { organizationId: jwt.orgId } });
  if (!s) s = await prisma.organizationSettings.create({ data: { organizationId: jwt.orgId } });
  const prevG = JSON.parse(s.generalJson || "{}") as Record<string, unknown>;
  prevG.touchFavoriteProductIds = ids;
  const updated = await prisma.organizationSettings.update({
    where: { organizationId: jwt.orgId },
    data: { generalJson: JSON.stringify(prevG) },
  });
  return c.json({ general: JSON.parse(updated.generalJson) });
});

api.get("/backup/export", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const orgId = jwt.orgId;
  const [
    org,
    users,
    products,
    customers,
    suppliers,
    sales,
    purchases,
    quotes,
    orders,
    settings,
    stockLocations,
    stockTransfers,
    stockAdjustments,
    employees,
    expenses,
    payrollPeriods,
    cashSessions,
    cashMovements,
    productStocks,
    expenseBooks,
  ] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId } }),
    prisma.user.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        active: true,
        createdAt: true,
        permissionsJson: true,
        permissionsRev: true,
        passwordHash: true,
      },
    }),
    prisma.product.findMany({ where: { organizationId: orgId }, include: { kitLines: true } }),
    prisma.customer.findMany({ where: { organizationId: orgId } }),
    prisma.supplier.findMany({ where: { organizationId: orgId } }),
    prisma.sale.findMany({
      where: { organizationId: orgId },
      include: { lines: true, receivableSurcharges: true },
    }),
    prisma.purchase.findMany({
      where: { organizationId: orgId },
      include: { lines: true, payableSurcharges: true },
    }),
    prisma.quote.findMany({ where: { organizationId: orgId }, include: { lines: true } }),
    prisma.supplierOrder.findMany({ where: { organizationId: orgId }, include: { lines: true } }),
    prisma.organizationSettings.findUnique({ where: { organizationId: orgId } }),
    prisma.stockLocation.findMany({ where: { organizationId: orgId } }),
    prisma.stockTransfer.findMany({ where: { organizationId: orgId }, include: { lines: true } }),
    prisma.stockAdjustment.findMany({ where: { organizationId: orgId }, include: { lines: true } }),
    prisma.employee.findMany({ where: { organizationId: orgId } }),
    prisma.expense.findMany({ where: { organizationId: orgId } }),
    prisma.payrollPeriod.findMany({
      where: { organizationId: orgId },
      include: { lines: { include: { deductionItems: true } } },
    }),
    prisma.cashSession.findMany({ where: { organizationId: orgId } }),
    prisma.cashMovement.findMany({ where: { organizationId: orgId } }),
    prisma.productStock.findMany({ where: { organizationId: orgId } }),
    prisma.expenseBook.findMany({
      where: { organizationId: orgId },
      include: { categories: true },
    }),
  ]);
  const payload = {
    exportedAt: new Date().toISOString(),
    organization: org,
    users,
    products,
    customers,
    suppliers,
    sales,
    purchases,
    quotes,
    orders,
    settings,
    stockLocations,
    stockTransfers,
    stockAdjustments,
    employees,
    expenses,
    payrollPeriods,
    cashSessions,
    cashMovements,
    productStocks,
    expenseBooks,
  };
  c.header("Content-Type", "application/json");
  c.header("Content-Disposition", `attachment; filename="punto-flow-backup-${org?.slug ?? "data"}.json"`);
  return c.body(JSON.stringify(payload, null, 2));
});

api.post("/backup/import", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const body = await c.req.json<{
    payload?: unknown;
    confirm?: string;
    typedOrgName?: string;
    ackExport?: boolean;
  }>();
  if (body.confirm === "REPLACE_FULL") {
    const org = await prisma.organization.findUnique({ where: { id: jwt.orgId } });
    if (!org) return c.json({ error: "Organización no encontrada" }, 400);
    if ((body.typedOrgName ?? "").trim() !== org.name) {
      return c.json({ error: "Debe tipear el nombre exacto de la empresa para confirmar el reemplazo total." }, 400);
    }
    if (body.ackExport !== true) {
      return c.json({ error: "Confirme que descargó un respaldo reciente (ackExport: true)." }, 400);
    }
    try {
      await replaceFullOrganizationFromBackup(prisma, jwt.orgId, body.payload);
      return c.json({ ok: true, replaced: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "INVALID_BACKUP") return c.json({ error: "JSON de respaldo inválido" }, 400);
      if (msg === "BACKUP_ORG_MISMATCH") {
        return c.json({ error: "El respaldo no corresponde a esta organización (organization.id distinto)." }, 400);
      }
      if (msg === "BACKUP_MISSING_PASSWORD_HASH") {
        return c.json(
          {
            error:
              "El respaldo no incluye passwordHash en usuarios. Descargue un respaldo nuevo desde esta versión del sistema.",
          },
          400
        );
      }
      throw e;
    }
  }
  if (body.confirm !== "MERGE_MASTER") {
    return c.json(
      {
        error:
          'Use confirm: "MERGE_MASTER" (fusionar catálogos) o "REPLACE_FULL" con typedOrgName y ackExport (reemplazo total; muyriesgoso).',
      },
      400
    );
  }
  try {
    const r = await mergeMasterFromBackup(prisma, jwt.orgId, body.payload);
    return c.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof Error && e.message === "INVALID_BACKUP") return c.json({ error: "JSON de respaldo inválido" }, 400);
    throw e;
  }
});

api.get("/import/template", requireAdmin, async (c) => {
  const q = c.req.query("type")?.trim() ?? "products";
  if (!["products", "customers", "suppliers"].includes(q)) return c.json({ error: "type inválido" }, 400);
  const buf = await buildImportTemplateBuffer(q as ImportTemplateKind);
  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="plantilla-${q}.xlsx"`,
    },
  });
});

api.post("/import/excel", requireAdmin, async (c) => {
  const jwt = c.get("jwt");
  const b = await c.req.parseBody();
  const type = String(b.type ?? "");
  const file = b.file;
  if (!file || typeof file !== "object" || typeof (file as Blob).arrayBuffer !== "function") {
    return c.json({ error: "Archivo requerido (campo file)" }, 400);
  }
  const buf = new Uint8Array(await (file as Blob).arrayBuffer());
  if (type === "products") {
    const r = await importProductsFromExcel(prisma, jwt.orgId, buf);
    return c.json({ imported: r.imported, errors: r.errors });
  }
  if (type === "customers") {
    const r = await importCustomersFromExcel(prisma, jwt.orgId, buf);
    return c.json({ imported: r.imported, errors: r.errors });
  }
  if (type === "suppliers") {
    const r = await importSuppliersFromExcel(prisma, jwt.orgId, buf);
    return c.json({ imported: r.imported, errors: r.errors });
  }
  return c.json({ error: "type debe ser products, customers o suppliers" }, 400);
});

app.route("/api", api);

const port = Number(process.env.PORT) || 3001;
console.log(`API http://localhost:${port}`);
serve({ fetch: app.fetch, port });
