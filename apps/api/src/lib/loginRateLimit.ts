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

/**
 * IP del cliente para el limite de intentos.
 *
 * `X-Forwarded-For` es una lista: cada proxy AGREGA al final la IP de quien le
 * hablo. Lo que viene al principio lo escribe el propio cliente. Antes se usaba
 * la primera entrada, asi que rotar la cabecera daba intentos ilimitados.
 * Ahora se toma la ultima, que es la que puso el proxy de confianza mas cercano
 * (Railway/Vercel). `TRUST_PROXY_HOPS` permite ajustar si hay mas de un proxy.
 */
export function clientIpFromHeaders(getHeader: (name: string) => string | undefined): string {
  const xf = getHeader("x-forwarded-for");
  if (xf) {
    const parts = xf.split(",").map((p) => p.trim()).filter(Boolean);
    const hops = Math.max(1, Math.trunc(Number(process.env.TRUST_PROXY_HOPS) || 1));
    const ip = parts[Math.max(0, parts.length - hops)];
    if (ip) return ip;
  }
  const realIp = getHeader("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

export function isLoginBlocked(ip: string): boolean {
  return prune(ip).length >= maxFails();
}

export function isLoginKeyBlocked(key: string, limit = maxFails()): boolean {
  return prune(key).length >= limit;
}

/** Tras credenciales inválidas; devuelve true si ya está bloqueado para esta petición. */
export function registerLoginFailure(ip: string): boolean {
  const arr = prune(ip);
  arr.push(Date.now());
  failureTimestamps.set(ip, arr);
  return arr.length >= maxFails();
}

export function registerLoginKeyFailure(key: string, limit = maxFails()): boolean {
  const arr = prune(key);
  arr.push(Date.now());
  failureTimestamps.set(key, arr);
  return arr.length >= limit;
}

/** Limite por cuenta (empresa + usuario) sin importar la IP: frena ataques repartidos entre muchas IPs. */
export function accountLoginLimit(): number {
  return maxFails() * 3;
}

export function clearLoginFailures(ip: string): void {
  failureTimestamps.delete(ip);
}

export function clearLoginKeyFailures(key: string): void {
  failureTimestamps.delete(key);
}
