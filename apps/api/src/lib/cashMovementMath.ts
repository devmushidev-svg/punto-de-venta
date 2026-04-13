/** Categorías alineadas al manual Smart (diario digital). */
export const CASH_MOVEMENT_CATEGORIES = [
  "GASTO",
  "INGRESO",
  "PAGO_ABONO",
  "RETIRO",
  "AJUSTE_TARJETA",
] as const;

export type CashMovementCategory = (typeof CASH_MOVEMENT_CATEGORIES)[number];

export function isCashMovementCategory(s: string): s is CashMovementCategory {
  return (CASH_MOVEMENT_CATEGORIES as readonly string[]).includes(s);
}

/** Efecto sobre el efectivo esperado en caja (positivo = entra, negativo = sale). */
export function cashMovementDelta(category: string, amount: number): number {
  const a = Math.abs(amount);
  switch (category) {
    case "INGRESO":
    case "PAGO_ABONO":
      return a;
    case "GASTO":
    case "RETIRO":
    case "AJUSTE_TARJETA":
      return -a;
    default:
      return 0;
  }
}
