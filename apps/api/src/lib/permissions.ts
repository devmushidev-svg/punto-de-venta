/** Permisos granulares (P6). El rol aporta un baseline; allow/deny en `permissionsJson` ajusta. */

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

const DEFAULT_AR_AP_PURCHASES: PermissionKey[] = [
  PERMISSION_KEYS.ACCOUNTS_RECEIVABLE,
  PERMISSION_KEYS.ACCOUNTS_PAYABLE,
  PERMISSION_KEYS.PURCHASES_RECORD,
];

/** Permisos que incluye cada rol sin JSON extra (admin no usa esta lista en runtime: siempre todo). */
export const ROLE_DEFAULT_PERMISSIONS: Record<string, PermissionKey[]> = {
  admin: [],
  vendedor: [PERMISSION_KEYS.REPORTS_VIEW, PERMISSION_KEYS.INVENTORY_TRANSFERS, ...DEFAULT_AR_AP_PURCHASES],
  cajero: [...DEFAULT_AR_AP_PURCHASES],
};

export type PermissionsPayload = { allow?: string[]; deny?: string[] };

function isValidKey(k: string): k is PermissionKey {
  return (ALL_PERMISSION_KEYS as readonly string[]).includes(k);
}

export function parsePermissionsJson(raw: string | null | undefined): PermissionsPayload {
  if (!raw?.trim()) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return {};
    const p = o as Record<string, unknown>;
    const allow = Array.isArray(p.allow) ? p.allow.filter((x): x is string => typeof x === "string") : [];
    const deny = Array.isArray(p.deny) ? p.deny.filter((x): x is string => typeof x === "string") : [];
    return { allow, deny };
  } catch {
    return {};
  }
}

/** Normaliza allow/deny a claves conocidas únicas. */
export function sanitizePermissionsPayload(input: PermissionsPayload): { allow: PermissionKey[]; deny: PermissionKey[] } {
  const allow = [...new Set((input.allow ?? []).filter(isValidKey))];
  const deny = [...new Set((input.deny ?? []).filter(isValidKey))];
  return { allow, deny };
}

export function serializePermissionsPayload(input: PermissionsPayload): string {
  const { allow, deny } = sanitizePermissionsPayload(input);
  return JSON.stringify({ allow, deny });
}

export function userHasPermission(role: string, permissionsJson: string | null | undefined, key: PermissionKey): boolean {
  if (role === "admin") return true;
  const parsed = parsePermissionsJson(permissionsJson);
  const allow = parsed.allow ?? [];
  const deny = parsed.deny ?? [];
  const denySet = new Set(deny.filter(isValidKey));
  if (denySet.has(key)) return false;
  const base = new Set((ROLE_DEFAULT_PERMISSIONS[role] ?? []).filter(isValidKey));
  for (const a of allow) {
    if (isValidKey(a)) base.add(a);
  }
  return base.has(key);
}

/** Lista efectiva para la UI (sin admin: devuelve todas las claves concedidas). */
export function effectivePermissionList(role: string, permissionsJson: string | null | undefined): PermissionKey[] {
  if (role === "admin") return [...ALL_PERMISSION_KEYS];
  return ALL_PERMISSION_KEYS.filter((k) => userHasPermission(role, permissionsJson, k));
}
