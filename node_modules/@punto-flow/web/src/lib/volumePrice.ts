import type { Product } from "../types";

export type VolumePriceTier = { minQty: number; price: number };

export function parseVolumePricesJson(raw: string | null | undefined): VolumePriceTier[] {
  if (raw == null || String(raw).trim() === "") return [];
  try {
    const j = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(j)) return [];
    const out: VolumePriceTier[] = [];
    for (const o of j) {
      if (!o || typeof o !== "object") continue;
      const minQty = Number((o as { minQty?: unknown }).minQty);
      const price = Number((o as { price?: unknown }).price);
      if (!Number.isFinite(minQty) || minQty <= 0 || !Number.isFinite(price) || price < 0) continue;
      out.push({ minQty, price });
    }
    out.sort((a, b) => a.minQty - b.minQty);
    return out;
  } catch {
    return [];
  }
}

export function priceForTier(p: Product, tier: number): number {
  if (tier === 2 && p.price2 != null) return p.price2;
  if (tier === 3 && p.price3 != null) return p.price3;
  if (tier === 4 && p.price4 != null) return p.price4;
  return p.price;
}

/** Lista 1–4 como base; tramos por cantidad sustituyen cuando la cantidad alcanza cada mínimo. */
export function resolveProductUnitPrice(p: Product, qty: number, tier: number): number {
  const tiers = parseVolumePricesJson(p.volumePricesJson);
  let unit = priceForTier(p, tier);
  if (tiers.length === 0 || !Number.isFinite(qty) || qty <= 0) return unit;
  for (const t of tiers) {
    if (qty >= t.minQty) unit = t.price;
  }
  return unit;
}
