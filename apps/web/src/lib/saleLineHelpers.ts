import type { Product } from "../types";

export function tracksStock(p: Product): boolean {
  return p.productType !== "KIT" && p.productType !== "SERVICIO";
}

/** Cantidad inicial al añadir línea: 1 si hay existencia (o no controla stock); 0 solo sin existencia. */
export function defaultQtyForNewLine(p: Product): number {
  if (tracksStock(p) && p.stock <= 0) return 0;
  return 1;
}
