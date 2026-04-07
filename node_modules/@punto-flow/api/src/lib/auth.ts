import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export type JwtPayload = {
  sub: string;
  orgId: string;
  role: string;
  /** Copia de `User.permissionsRev` al firmar; si no coincide con BD, hay que volver a iniciar sesión. */
  permRev?: number;
  /** Permisos efectivos al firmar (P6); ausente en tokens antiguos. */
  perms?: string[];
};

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, SECRET) as Record<string, unknown>;
  const sub = String(decoded.sub ?? "");
  const orgId = String(decoded.orgId ?? "");
  const role = String(decoded.role ?? "");
  const permRev = typeof decoded.permRev === "number" ? decoded.permRev : undefined;
  const rawPerms = decoded.perms;
  const perms = Array.isArray(rawPerms) ? rawPerms.filter((x): x is string => typeof x === "string") : undefined;
  return { sub, orgId, role, permRev, perms };
}

export async function hashPassword(p: string): Promise<string> {
  return bcrypt.hash(p, 10);
}

export async function verifyPassword(p: string, hash: string): Promise<boolean> {
  return bcrypt.compare(p, hash);
}
