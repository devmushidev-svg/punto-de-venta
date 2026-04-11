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
  assertStockForTransferSend,
  validateTransferLineProducts,
} from "./lib/stockTransfer.js";

const PRODUCT_TYPES = ["PRODUCTO", "SERVICIO", "INSUMO", "KIT"] as const;

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

  const where: {
    organizationId: string;
    OR?: { name?: { contains: string }; sku?: { contains: string }; barcode?: { contains: string }; quickCode?: { contains: string } }[];
    stock?: { gt?: number; lte?: number };
    supplierId?: string;
    active?: boolean;
    productType?: { not: string };
  } = { organizationId: jwt.orgId };

  if (touch === "1") {
    where.active = true;
    where.productType = { not: "INSUMO" };
  }

  if (q) {
    where.OR = [
      { name: { contains: q } },
      { sku: { contains: q } },
      { barcode: { contains: q } },
      { quickCode: { contains: q } },
    ];
  }
  if (stock === "with") where.stock = { gt: 0 };
  if (stock === "without") where.stock = { lte: 0 };
  if (supplierId) where.supplierId = supplierId;

  const rawLimit = Number(c.req.query("limit"));
  const parsedLimit = Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 5000;
  const limit = Math.min(8000, Math.max(1, parsedLimit));
  const take = touch === "1" ? 500 : limit;

  const products = await prisma.product.findMany({
    where,
    orderBy: { name: "asc" },
    take,
    include: { supplier: { select: { id: true, name: true } } },
  });
  return c.json(products);
});

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
  try {
    const p = await prisma.$transaction(async (tx) => {
      const row = await tx.product.create({
        data: {
          organizationId: jwt.orgId,
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
          volumePricesJson: normalizeVolumePricesPayload(body.volumePricesJson ?? []),
        },
      });
      if (productType === "KIT") {
        await replaceProductKitLines(tx, row.id, jwt.orgId, body.kitLines, "KIT");
      }
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
  ];
  for (const k of num) if (body[k] !== undefined) data[k] = Number(body[k]);
  for (const k of str) if (body[k] !== undefined) data[k] = body[k];
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.esGranel !== undefined) data.esGranel = Boolean(body.esGranel);
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
  }>();
  if (!body.name?.trim()) return c.json({ error: "Nombre requerido" }, 400);
  const cust = await prisma.customer.create({
    data: {
      organizationId: jwt.orgId,
      code: body.code ?? "0",
      name: body.name.trim(),
      address: body.address,
      phone: body.phone,
      taxId: body.taxId,
      notes: body.notes,
    },
  });
  return c.json(cust, 201);
});

async function restoreStockForSaleLine(tx: Prisma.TransactionClient, line: { productId: string; qty: number }) {
  const prod = await tx.product.findUnique({ where: { id: line.productId } });
  if (!prod) throw new Error("PRODUCT_NOT_FOUND");
  if (prod.productType === "SERVICIO") return;
  if (prod.productType === "KIT") {
    const kitLines = await tx.productKitLine.findMany({ where: { kitProductId: prod.id } });
    for (const kl of kitLines) {
      await tx.product.update({
        where: { id: kl.componentProductId },
        data: { stock: { increment: line.qty * kl.qty } },
      });
    }
    return;
  }
  await tx.product.update({
    where: { id: line.productId },
    data: { stock: { increment: line.qty } },
  });
}

api.patch("/customers/:id", async (c) => {
  const jwt = c.get("jwt");
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();
  const data: Record<string, unknown> = {};
  for (const k of ["code", "name", "address", "phone", "taxId", "notes"]) {
    if (body[k] !== undefined) data[k] = body[k];
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

    const count = await tx.sale.count({ where: { organizationId: jwt.orgId } });
    const invoiceNumber = String(count + 1).padStart(6, "0");
    const saleDateResolved = parseClientSaleDate(body.saleDate) ?? new Date();

    const sale = await tx.sale.create({
      data: {
        organizationId: jwt.orgId,
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
        await decrementStockForKitSale(tx, prod.id, line.qty);
        continue;
      }
      await tx.product.update({
        where: { id: line.productId },
        data: { stock: { decrement: line.qty } },
      });
    }

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

      for (const oldLine of existing.lines) {
        await restoreStockForSaleLine(tx, { productId: oldLine.productId, qty: oldLine.qty });
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

      await tx.saleLine.deleteMany({ where: { saleId: existing.id } });
      await tx.sale.update({
        where: { id: existing.id },
        data: {
          customerId: body.customerId || null,
          terms,
          notes: body.notes,
          priceTier,
          subtotal,
          tax,
          total,
          paid,
          ...(saleDatePatch ? { saleDate: saleDatePatch } : {}),
          lines: { create: saleLines },
        },
      });

      for (const line of saleLines) {
        const prod = await tx.product.findUnique({ where: { id: line.productId } });
        if (prod?.productType === "SERVICIO") continue;
        if (prod?.productType === "KIT") {
          await decrementStockForKitSale(tx, prod.id, line.qty);
          continue;
        }
        await tx.product.update({
          where: { id: line.productId },
          data: { stock: { decrement: line.qty } },
        });
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
      await tx.product.update({
        where: { id: line.productId },
        data: {
          stock: { increment: line.qty },
          cost: line.unitCost,
        },
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

  const efectivoCajaSugerido =
    session.openingCash + efectivoVentasTotal + cobradoEfectivoCredito - gastosSesion;

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
  const body = await c.req.json<{ amount: number }>();
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
  const updated = await prisma.sale.update({
    where: { id: saleId },
    data: { paid: { increment: amount } },
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
  const body = await c.req.json<{ amount: number }>();
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
  const updated = await prisma.purchase.update({
    where: { id: purchaseId },
    data: { paid: { increment: amount } },
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
    lines: { productId: string; qty: number; unitPrice?: number }[];
  }>();
  if (!body.lines?.length) return c.json({ error: "Agregue líneas" }, 400);

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
    lines: { productId: string; qty: number; unitPrice?: number }[];
  }>();
  if (!body.lines?.length) return c.json({ error: "Agregue líneas" }, 400);

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
        await decrementStockForKitSale(tx, prod.id, line.qty);
        continue;
      }
      await tx.product.update({
        where: { id: line.productId },
        data: { stock: { decrement: line.qty } },
      });
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
        tr.lines.map((l) => ({ productId: l.productId, qty: l.qty }))
      );
      await applyTransferSendStock(
        tx,
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
        await applyTransferReceiveStock(
          tx,
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
        await tx.product.update({
          where: { id: line.productId },
          data: { stock: { increment: Number(line.qtyDelta) } },
        });
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
} as const;

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
  }>();
  if (!body.category?.trim()) return c.json({ error: "Indique la categoría" }, 400);
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return c.json({ error: "Monto inválido" }, 400);
  const row = await prisma.expense.create({
    data: {
      organizationId: jwt.orgId,
      userId: jwt.sub,
      category: body.category.trim(),
      amount,
      expenseDate: body.expenseDate ? new Date(body.expenseDate) : new Date(),
      notes: body.notes?.trim() || null,
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
      },
    }),
    prisma.product.findMany({ where: { organizationId: orgId } }),
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
  };
  c.header("Content-Type", "application/json");
  c.header("Content-Disposition", `attachment; filename="punto-flow-backup-${org?.slug ?? "data"}.json"`);
  return c.body(JSON.stringify(payload, null, 2));
});

app.route("/api", api);

const port = Number(process.env.PORT) || 3001;
console.log(`API http://localhost:${port}`);
serve({ fetch: app.fetch, port });
