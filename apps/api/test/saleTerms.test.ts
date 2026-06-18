import { describe, it, expect } from "vitest";
import {
  normalizeSaleTerms,
  isCreditSaleTerm,
  isImmediateSaleTerm,
  resolveSalePaid,
} from "../src/lib/saleTerms.js";

describe("normalizeSaleTerms", () => {
  it("recorta, pasa a mayúsculas y colapsa espacios", () => {
    expect(normalizeSaleTerms("  contado ")).toBe("CONTADO");
    expect(normalizeSaleTerms("15   dias")).toBe("15 DIAS");
  });

  it("quita acentos en Í y Á", () => {
    expect(normalizeSaleTerms("crédito")).toBe("CREDITO");
    expect(normalizeSaleTerms("15 días")).toBe("15 DIAS");
  });
});

describe("isCreditSaleTerm", () => {
  it("reconoce términos de crédito exactos", () => {
    expect(isCreditSaleTerm("CREDITO")).toBe(true);
    expect(isCreditSaleTerm("30 DIAS")).toBe(true);
    expect(isCreditSaleTerm("crédito")).toBe(true);
  });

  it("reconoce cualquier 'N DIAS' como crédito (incluye 90 DIAS)", () => {
    expect(isCreditSaleTerm("90 DIAS")).toBe(true);
    expect(isCreditSaleTerm("7 dias")).toBe(true);
  });

  it("no marca contado/tarjeta/efectivo como crédito", () => {
    expect(isCreditSaleTerm("CONTADO")).toBe(false);
    expect(isCreditSaleTerm("TARJETA")).toBe(false);
    expect(isCreditSaleTerm("EFECTIVO")).toBe(false);
  });
});

describe("isImmediateSaleTerm", () => {
  it("solo contado, tarjeta y efectivo son inmediatos", () => {
    expect(isImmediateSaleTerm("CONTADO")).toBe(true);
    expect(isImmediateSaleTerm("TARJETA")).toBe(true);
    expect(isImmediateSaleTerm("EFECTIVO")).toBe(true);
    expect(isImmediateSaleTerm("CREDITO")).toBe(false);
    expect(isImmediateSaleTerm("30 DIAS")).toBe(false);
  });
});

describe("resolveSalePaid", () => {
  it("contado: paga el total completo aunque no se indique monto", () => {
    expect(resolveSalePaid(100, "CONTADO")).toBe(100);
  });

  it("contado: nunca paga menos ni más que el total (se ajusta al total)", () => {
    expect(resolveSalePaid(100, "CONTADO", 50)).toBe(100);
    expect(resolveSalePaid(100, "CONTADO", 200)).toBe(100);
  });

  it("crédito: sin abono inicial el pagado es 0", () => {
    expect(resolveSalePaid(100, "CREDITO")).toBe(0);
  });

  it("crédito: respeta el abono dentro del rango [0, total]", () => {
    expect(resolveSalePaid(100, "CREDITO", 30)).toBe(30);
    expect(resolveSalePaid(100, "CREDITO", -5)).toBe(0);
    expect(resolveSalePaid(100, "CREDITO", 150)).toBe(100);
  });
});
