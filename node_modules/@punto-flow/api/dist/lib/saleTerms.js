/** Términos de venta: contado inmediato vs crédito (aparece en CxC). */
export function normalizeSaleTerms(raw) {
    return raw
        .trim()
        .toUpperCase()
        .replace(/Í/g, "I")
        .replace(/Á/g, "A")
        .replace(/\s+/g, " ");
}
export const CREDIT_SALE_TERMS_EXACT = ["CREDITO", "15 DIAS", "30 DIAS", "45 DIAS", "60 DIAS"];
export function isCreditSaleTerm(terms) {
    const t = normalizeSaleTerms(terms);
    if (CREDIT_SALE_TERMS_EXACT.includes(t))
        return true;
    if (/^\d+\s*DIAS$/.test(t))
        return true;
    return false;
}
export function isImmediateSaleTerm(terms) {
    const t = normalizeSaleTerms(terms);
    return t === "CONTADO" || t === "TARJETA" || t === "EFECTIVO";
}
export function resolveSalePaid(total, terms, bodyPaid) {
    const t = normalizeSaleTerms(terms);
    if (isImmediateSaleTerm(t)) {
        let paid = bodyPaid != null ? Number(bodyPaid) : total;
        if (!Number.isFinite(paid))
            paid = total;
        if (paid < total)
            paid = total;
        if (paid > total)
            paid = total;
        return paid;
    }
    if (isCreditSaleTerm(t)) {
        let paid = Number(bodyPaid) || 0;
        if (!Number.isFinite(paid))
            paid = 0;
        if (paid < 0)
            paid = 0;
        if (paid > total)
            paid = total;
        return paid;
    }
    return total;
}
