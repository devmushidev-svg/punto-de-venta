import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
export function signToken(payload) {
    return jwt.sign(payload, SECRET, { expiresIn: "7d" });
}
export function verifyToken(token) {
    const decoded = jwt.verify(token, SECRET);
    const sub = String(decoded.sub ?? "");
    const orgId = String(decoded.orgId ?? "");
    const role = String(decoded.role ?? "");
    const permRev = typeof decoded.permRev === "number" ? decoded.permRev : undefined;
    const rawPerms = decoded.perms;
    const perms = Array.isArray(rawPerms) ? rawPerms.filter((x) => typeof x === "string") : undefined;
    return { sub, orgId, role, permRev, perms };
}
export async function hashPassword(p) {
    return bcrypt.hash(p, 10);
}
export async function verifyPassword(p, hash) {
    return bcrypt.compare(p, hash);
}
