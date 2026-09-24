import { SALE_TERMS_VALUES } from "./saleTerms";

export type PosBehavior = {
  warnOutOfStock: boolean;
  barcodeAddsLineDirectly: boolean;
  barcodeFocusAfterAdd: "quickAdd" | "qty";
  allowedSaleTerms: string[];
  immediateSaleDocument: "none" | "ticket" | "comprobante";
  showStockWhileSelling: boolean;
  roundTotals: boolean;
  retainInventoryOnSaleEdit: boolean;
  creditRequiresCustomer: boolean;
  creditRequiresInitialPayment: boolean;
  defaultTaxPercent: number;
  requireAdminPasswordForSaleChanges: boolean;
  returnsRequireInvoice: boolean;
  autoPrintImmediateSale: boolean;
};

export const DEFAULT_POS_BEHAVIOR: PosBehavior = {
  warnOutOfStock: false,
  barcodeAddsLineDirectly: true,
  barcodeFocusAfterAdd: "quickAdd",
  allowedSaleTerms: [...SALE_TERMS_VALUES],
  immediateSaleDocument: "comprobante",
  showStockWhileSelling: true,
  roundTotals: false,
  retainInventoryOnSaleEdit: false,
  creditRequiresCustomer: true,
  creditRequiresInitialPayment: false,
  defaultTaxPercent: 15,
  requireAdminPasswordForSaleChanges: true,
  returnsRequireInvoice: true,
  autoPrintImmediateSale: false,
};

export function parsePosBehavior(v: unknown): PosBehavior {
  if (!v || typeof v !== "object") return { ...DEFAULT_POS_BEHAVIOR };
  const o = v as Record<string, unknown>;
  const configuredSaleTerms = Array.isArray(o.allowedSaleTerms)
    ? o.allowedSaleTerms
        .filter((term): term is string => typeof term === "string")
        .filter((term) => SALE_TERMS_VALUES.includes(term as (typeof SALE_TERMS_VALUES)[number]))
    : [...SALE_TERMS_VALUES];
  const immediateSaleDocument =
    o.immediateSaleDocument === "none" || o.immediateSaleDocument === "ticket" || o.immediateSaleDocument === "comprobante"
      ? o.immediateSaleDocument
      : "comprobante";
  const allowedSaleTerms = [...new Set(["CONTADO", ...configuredSaleTerms])];
  const defaultTaxPercent = typeof o.defaultTaxPercent === "number" && Number.isFinite(o.defaultTaxPercent)
    ? Math.min(100, Math.max(0, o.defaultTaxPercent))
    : 15;
  return {
    warnOutOfStock: o.warnOutOfStock === true,
    barcodeAddsLineDirectly: o.barcodeAddsLineDirectly !== false,
    barcodeFocusAfterAdd: o.barcodeFocusAfterAdd === "qty" ? "qty" : "quickAdd",
    allowedSaleTerms,
    immediateSaleDocument,
    showStockWhileSelling: o.showStockWhileSelling !== false,
    roundTotals: o.roundTotals === true,
    retainInventoryOnSaleEdit: o.retainInventoryOnSaleEdit === true,
    creditRequiresCustomer: o.creditRequiresCustomer !== false,
    creditRequiresInitialPayment: o.creditRequiresInitialPayment === true,
    defaultTaxPercent,
    requireAdminPasswordForSaleChanges: o.requireAdminPasswordForSaleChanges !== false,
    returnsRequireInvoice: o.returnsRequireInvoice !== false,
    autoPrintImmediateSale: o.autoPrintImmediateSale === true,
  };
}
