import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const DEV_FALLBACK = "dev-secret-change-me";

/**
 * Secretos que alguna vez estuvieron en este repositorio (`.env.example` y un
 * `.env` versionado hasta abril 2026). Estan publicados en GitHub: quien los
 * lea puede firmar tokens validos. Comprobar solo que JWT_SECRET "existe" no
 * alcanza, porque copiar el ejemplo deja un secreto conocido.
 */
const SECRETOS_PUBLICADOS = new Set([
  DEV_FALLBACK,
  "dev-secret-local-change-me",
  "cambiar-en-produccion-usa-openssl-rand-hex-32",
  "change-me",
  "changeme",
  "secret",
]);

const LARGO_MINIMO = 32;

/** Pura y exportada para poder probar el rechazo sin levantar el proceso. */
export function validateJwtSecret(raw: string | undefined, nodeEnv: string | undefined): string {
  const s = raw?.trim();
  const produccion = nodeEnv === "production";
  if (!s) {
    if (produccion) {
      throw new Error(
        "JWT_SECRET is required in production. Set a long random value (e.g. openssl rand -base64 48)."
      );
    }
    console.warn("[auth] JWT_SECRET not set; using development default. Never deploy with the dev default.");
    return DEV_FALLBACK;
  }
  if (produccion && SECRETOS_PUBLICADOS.has(s.toLowerCase())) {
    throw new Error(
      "JWT_SECRET is a placeholder published in this repository. Anyone could forge tokens. " +
        "Generate a new one: openssl rand -base64 48"
    );
  }
  if (produccion && s.length < LARGO_MINIMO) {
    throw new Error(
      `JWT_SECRET must be at least ${LARGO_MINIMO} characters in production. Generate one: openssl rand -base64 48`
    );
  }
  return s;
}

const SECRET = validateJwtSecret(process.env.JWT_SECRET, process.env.NODE_ENV);

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
