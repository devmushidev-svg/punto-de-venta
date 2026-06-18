/** Alineado con la API: términos de venta y detección de crédito. */

export const SALE_TERMS_OPTIONS = [
  { value: "CONTADO", label: "Contado" },
  { value: "TARJETA", label: "Tarjeta" },
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "CREDITO", label: "Crédito" },
  { value: "15 DIAS", label: "15 días" },
  { value: "30 DIAS", label: "30 días" },
  { value: "45 DIAS", label: "45 días" },
  { value: "60 DIAS", label: "60 días" },
] as const;

export function isCreditSaleTerm(terms: string): boolean {
  const t = terms
    .trim()
    .toUpperCase()
    .replace(/Á/g, "A")
    .replace(/É/g, "E")
    .replace(/Í/g, "I")
    .replace(/Ó/g, "O")
    .replace(/Ú/g, "U")
    .replace(/\s+/g, " ");
  if (t === "CREDITO") return true;
  if (/^\d+\s*DIAS$/.test(t)) return true;
  return false;
}
