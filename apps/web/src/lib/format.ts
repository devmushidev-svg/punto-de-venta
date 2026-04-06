export function formatMoney(symbol: string, value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return `${symbol} ${n.toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(d: string | Date): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleString("es-HN", { dateStyle: "short", timeStyle: "short" });
}

export function formatDateOnly(d: string | Date): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleDateString("es-HN", { dateStyle: "short" });
}

export function formatTimeOnly(d: string | Date): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" });
}
