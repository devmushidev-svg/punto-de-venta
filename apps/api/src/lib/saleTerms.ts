/** Términos de venta: contado inmediato vs crédito (aparece en CxC). */

export function normalizeSaleTerms(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/Á/g, "A")
    .replace(/É/g, "E")
    .replace(/Í/g, "I")
    .replace(/Ó/g, "O")
    .replace(/Ú/g, "U")
    .replace(/\s+/g, " ");
}

export const CREDIT_SALE_TERMS_EXACT = ["CREDITO", "15 DIAS", "30 DIAS", "45 DIAS", "60 DIAS"] as const;

export function isCreditSaleTerm(terms: string): boolean {
  const t = normalizeSaleTerms(terms);
  if ((CREDIT_SALE_TERMS_EXACT as readonly string[]).includes(t)) return true;
  if (/^\d+\s*DIAS$/.test(t)) return true;
  return false;
}

export function isImmediateSaleTerm(terms: string): boolean {
  const t = normalizeSaleTerms(terms);
  return t === "CONTADO" || t === "TARJETA" || t === "EFECTIVO";
}

export function resolveSalePaid(total: number, terms: string, bodyPaid?: number): number {
  const t = normalizeSaleTerms(terms);
  if (isImmediateSaleTerm(t)) {
    let paid = bodyPaid != null ? Number(bodyPaid) : total;
    if (!Number.isFinite(paid)) paid = total;
    if (paid < total) paid = total;
    if (paid > total) paid = total;
    return paid;
  }
  if (isCreditSaleTerm(t)) {
    let paid = Number(bodyPaid) || 0;
    if (!Number.isFinite(paid)) paid = 0;
    if (paid < 0) paid = 0;
    if (paid > total) paid = total;
    return paid;
  }
  return total;
}
