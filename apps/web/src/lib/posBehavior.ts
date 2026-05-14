export type PosBehavior = {
  warnOutOfStock: boolean;
  barcodeAddsLineDirectly: boolean;
  showStockWhileSelling: boolean;
  roundTotals: boolean;
  retainInventoryOnSaleEdit: boolean;
};

export const DEFAULT_POS_BEHAVIOR: PosBehavior = {
  warnOutOfStock: false,
  barcodeAddsLineDirectly: true,
  showStockWhileSelling: true,
  roundTotals: false,
  retainInventoryOnSaleEdit: false,
};

export function parsePosBehavior(v: unknown): PosBehavior {
  if (!v || typeof v !== "object") return { ...DEFAULT_POS_BEHAVIOR };
  const o = v as Record<string, unknown>;
  return {
    warnOutOfStock: o.warnOutOfStock === true,
    barcodeAddsLineDirectly: o.barcodeAddsLineDirectly !== false,
    showStockWhileSelling: o.showStockWhileSelling !== false,
    roundTotals: o.roundTotals === true,
    retainInventoryOnSaleEdit: o.retainInventoryOnSaleEdit === true,
  };
}
