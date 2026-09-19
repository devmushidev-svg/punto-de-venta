import { resolveProductUnitPrice } from "./volumePrice.js";

/**
 * El navegador es hardware que el usuario controla: el precio que llega en el
 * payload es una sugerencia, no una decision. El servidor vuelve a resolver el
 * precio autorizado del catalogo y solo acepta uno distinto si quien vende
 * tiene permiso para apartarse.
 */

/** Tolerancia de medio centavo, para no rechazar por redondeo del cliente. */
const TOLERANCIA = 0.005;

export class PriceOverrideForbidden extends Error {
  constructor(
    readonly detail: { authorized: number; requested: number | null; discountPercent: number },
  ) {
    super("PRICE_OVERRIDE_FORBIDDEN");
    this.name = "PriceOverrideForbidden";
  }
}

type PricedProduct = Parameters<typeof resolveProductUnitPrice>[0];

export function authorizedLinePrice(input: {
  product: PricedProduct;
  qty: number;
  priceTier: number;
  requestedUnitPrice?: number | null;
  requestedDiscountPercent?: number | null;
  canOverride: boolean;
}): { unitPrice: number; discountPercent: number } {
  const authorized = resolveProductUnitPrice(input.product, input.qty, input.priceTier);
  const requested =
    typeof input.requestedUnitPrice === "number" && Number.isFinite(input.requestedUnitPrice)
      ? input.requestedUnitPrice
      : null;
  const discountPercent = Math.min(
    100,
    Math.max(0, Number.isFinite(input.requestedDiscountPercent ?? 0) ? (input.requestedDiscountPercent ?? 0) : 0),
  );

  const deviates = requested !== null && Math.abs(requested - authorized) > TOLERANCIA;

  if ((deviates || discountPercent > 0) && !input.canOverride) {
    throw new PriceOverrideForbidden({ authorized, requested, discountPercent });
  }

  return { unitPrice: requested ?? authorized, discountPercent };
}
