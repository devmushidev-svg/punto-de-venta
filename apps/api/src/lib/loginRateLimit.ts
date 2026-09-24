/** Ventana deslizante para frenar fuerza bruta en /auth/login (por IP). */

const WINDOW_MS = 15 * 60 * 1000;

function maxFails(): number {
  const n = Number(process.env.LOGIN_RATE_MAX_FAILS);
  return Number.isFinite(n) && n > 0 ? n : 12;
}

const failureTimestamps = new Map<string, number[]>();

function prune(key: string): number[] {
  const now = Date.now();
  const arr = (failureTimestamps.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failureTimestamps.set(key, arr);
  return arr;
}

/** Usar con `c.req.header`; detrás de reverse proxy configurar X-Forwarded-For / X-Real-IP. */
export function clientIpFromHeaders(getHeader: (name: string) => string | undefined): string {
  const xf = getHeader("x-forwarded-for");
  if (xf) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = getHeader("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

export function isLoginBlocked(ip: string): boolean {
  return prune(ip).length >= maxFails();
}

export function isLoginKeyBlocked(key: string): boolean {
  return prune(key).length >= maxFails();
}

/** Tras credenciales inválidas; devuelve true si ya está bloqueado para esta petición. */
export function registerLoginFailure(ip: string): boolean {
  const arr = prune(ip);
  arr.push(Date.now());
  failureTimestamps.set(ip, arr);
  return arr.length >= maxFails();
}

export function registerLoginKeyFailure(key: string): boolean {
  const arr = prune(key);
  arr.push(Date.now());
  failureTimestamps.set(key, arr);
  return arr.length >= maxFails();
}

export function clearLoginFailures(ip: string): void {
  failureTimestamps.delete(ip);
}

export function clearLoginKeyFailures(key: string): void {
  failureTimestamps.delete(key);
}
