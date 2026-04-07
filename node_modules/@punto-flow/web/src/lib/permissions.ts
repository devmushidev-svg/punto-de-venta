/** Debe coincidir con `apps/api/src/lib/permissions.ts` (claves y baseline por rol). */

export const PERMISSION_KEYS = {
  REPORTS_VIEW: "reports.view",
  INVENTORY_TRANSFERS: "inventory.transfers",
  ACCOUNTS_RECEIVABLE: "accounts.receivable",
  ACCOUNTS_PAYABLE: "accounts.payable",
  PURCHASES_RECORD: "purchases.record",
  PURCHASES_VIEW: "purchases.view",
  EXPENSES_VIEW: "expenses.view",
  PAYROLL_VIEW: "payroll.view",
} as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[keyof typeof PERMISSION_KEYS];

export const ALL_PERMISSION_KEYS: PermissionKey[] = [
  PERMISSION_KEYS.REPORTS_VIEW,
  PERMISSION_KEYS.INVENTORY_TRANSFERS,
  PERMISSION_KEYS.ACCOUNTS_RECEIVABLE,
  PERMISSION_KEYS.ACCOUNTS_PAYABLE,
  PERMISSION_KEYS.PURCHASES_RECORD,
  PERMISSION_KEYS.PURCHASES_VIEW,
  PERMISSION_KEYS.EXPENSES_VIEW,
  PERMISSION_KEYS.PAYROLL_VIEW,
];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  [PERMISSION_KEYS.REPORTS_VIEW]:
    "Ver reportes (ventas, inventario, top productos). Pestañas Gastos/Planillas en la misma pantalla requieren además expenses.view / payroll.view. Resúmenes JSON gastos/planillas en API siguen esas claves.",
  [PERMISSION_KEYS.INVENTORY_TRANSFERS]: "Traslados entre ubicaciones",
  [PERMISSION_KEYS.ACCOUNTS_RECEIVABLE]: "Cuentas por cobrar (lista, abonos y recargos)",
  [PERMISSION_KEYS.ACCOUNTS_PAYABLE]: "Cuentas por pagar (lista, pagos y recargos)",
  [PERMISSION_KEYS.PURCHASES_RECORD]: "Registrar compras (alta de mercancía e inventario)",
  [PERMISSION_KEYS.PURCHASES_VIEW]: "Ver compras registradas (solo consulta; sin registrar)",
  [PERMISSION_KEYS.EXPENSES_VIEW]:
    "Ver gastos y resumen en reportes (solo consulta; registrar gastos sigue siendo administrador)",
  [PERMISSION_KEYS.PAYROLL_VIEW]:
    "Ver planillas y resumen en reportes (solo consulta; crear/cerrar planilla sigue siendo administrador)",
};

const DEFAULT_AR_AP_PURCHASES: PermissionKey[] = [
  PERMISSION_KEYS.ACCOUNTS_RECEIVABLE,
  PERMISSION_KEYS.ACCOUNTS_PAYABLE,
  PERMISSION_KEYS.PURCHASES_RECORD,
];

/** Baseline por rol (admin se ignora: tiene todo). */
export const ROLE_DEFAULT_PERMISSIONS: Record<string, PermissionKey[]> = {
  admin: [],
  vendedor: [PERMISSION_KEYS.REPORTS_VIEW, PERMISSION_KEYS.INVENTORY_TRANSFERS, ...DEFAULT_AR_AP_PURCHASES],
  cajero: [...DEFAULT_AR_AP_PURCHASES],
};

export type UserPermUser = {
  role: string;
  effectivePermissions?: string[] | null;
};

export function hasPermission(user: UserPermUser | null | undefined, key: PermissionKey): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.effectivePermissions?.includes(key) ?? false;
}

type PermPayload = { allow: PermissionKey[]; deny: PermissionKey[] };

export function parsePermissionsJson(raw: string | null | undefined): PermPayload {
  if (!raw?.trim()) return { allow: [], deny: [] };
  try {
    const o = JSON.parse(raw) as { allow?: unknown; deny?: unknown };
    const allow = Array.isArray(o.allow)
      ? o.allow.filter((x): x is PermissionKey => ALL_PERMISSION_KEYS.includes(x as PermissionKey))
      : [];
    const deny = Array.isArray(o.deny)
      ? o.deny.filter((x): x is PermissionKey => ALL_PERMISSION_KEYS.includes(x as PermissionKey))
      : [];
    return { allow: [...new Set(allow)], deny: [...new Set(deny)] };
  } catch {
    return { allow: [], deny: [] };
  }
}

export function serializePermissionsPayload(allow: PermissionKey[], deny: PermissionKey[]): string {
  return JSON.stringify({
    allow: [...new Set(allow)],
    deny: [...new Set(deny)],
  });
}

function baseSet(role: string): Set<PermissionKey> {
  return new Set(ROLE_DEFAULT_PERMISSIONS[role] ?? []);
}

/** Estado efectivo del checkbox para una clave. */
export function effectivePermission(role: string, allow: PermissionKey[], deny: PermissionKey[], key: PermissionKey): boolean {
  if (role === "admin") return true;
  if (deny.includes(key)) return false;
  const b = baseSet(role);
  return b.has(key) || allow.includes(key);
}

/** Al marcar/desmarcar un permiso (matriz fina). */
export function togglePermission(
  role: string,
  allow: PermissionKey[],
  deny: PermissionKey[],
  key: PermissionKey,
  checked: boolean
): PermPayload {
  if (role === "admin") return { allow: [], deny: [] };
  let a = [...allow];
  let d = [...deny];
  const b = baseSet(role);
  if (checked) {
    d = d.filter((x) => x !== key);
    if (!b.has(key) && !a.includes(key)) a.push(key);
  } else {
    a = a.filter((x) => x !== key);
    if (b.has(key) && !d.includes(key)) d.push(key);
  }
  return { allow: a, deny: d };
}
