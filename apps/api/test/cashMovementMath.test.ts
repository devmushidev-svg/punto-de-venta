import { describe, it, expect } from "vitest";
import { isCashMovementCategory, cashMovementDelta } from "../src/lib/cashMovementMath.js";

describe("isCashMovementCategory", () => {
  it("acepta categorías válidas del diario", () => {
    expect(isCashMovementCategory("GASTO")).toBe(true);
    expect(isCashMovementCategory("INGRESO")).toBe(true);
    expect(isCashMovementCategory("PAGO_ABONO")).toBe(true);
  });

  it("rechaza categorías desconocidas", () => {
    expect(isCashMovementCategory("FOO")).toBe(false);
    expect(isCashMovementCategory("")).toBe(false);
  });
});

describe("cashMovementDelta", () => {
  it("ingresos y abonos suman efectivo (positivo)", () => {
    expect(cashMovementDelta("INGRESO", 50)).toBe(50);
    expect(cashMovementDelta("PAGO_ABONO", 30)).toBe(30);
  });

  it("gastos, retiros y ajustes de tarjeta restan efectivo (negativo)", () => {
    expect(cashMovementDelta("GASTO", 50)).toBe(-50);
    expect(cashMovementDelta("RETIRO", 20)).toBe(-20);
    expect(cashMovementDelta("AJUSTE_TARJETA", 15)).toBe(-15);
  });

  it("usa el valor absoluto del monto sin importar el signo recibido", () => {
    expect(cashMovementDelta("INGRESO", -40)).toBe(40);
    expect(cashMovementDelta("GASTO", -40)).toBe(-40);
  });

  it("categoría desconocida no afecta el efectivo", () => {
    expect(cashMovementDelta("FOO", 100)).toBe(0);
  });
});
