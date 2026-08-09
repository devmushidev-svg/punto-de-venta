// Decisiones puras del motor offline (sin DOM ni red): el núcleo que evita perder o duplicar ventas.

/** True solo si el servidor es inalcanzable (red caída), NO si responde con un error de negocio. */
export function isOfflineError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return e instanceof TypeError || (e as { name?: string } | null)?.name === "TypeError";
}

export type DrainAction = "sent" | "failed" | "retry";

/** Qué hacer con una venta encolada según la respuesta HTTP al reenviarla. */
export function classifyDrainStatus(status: number): DrainAction {
  if (status >= 200 && status < 300) return "sent";
  if (status >= 400 && status < 500 && status !== 401 && status !== 403) return "failed"; // rechazo de negocio: no reintentar
  return "retry"; // 401/403/5xx: reintentar luego (re-login o servidor recuperado)
}
