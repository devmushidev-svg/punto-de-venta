import { describe, expect, it } from "vitest";
import { assertValidUnitPrice, MAX_BACKDATE_NON_ADMIN_MS, resolveSaleDate } from "../src/lib/saleIntegrity.js";
import { clientIpFromHeaders } from "../src/lib/loginRateLimit.js";

const now = new Date("2026-11-14T12:00:00Z");

describe("resolveSaleDate", () => {
  it("sin fecha usa la del servidor", () => {
    expect(resolveSaleDate(null, false, now)).toBe(now);
  });
  it("una fecha futura (reloj de la caja adelantado) se recorta a la hora del servidor", () => {
    const future = new Date(now.getTime() + 60 * 60 * 1000);
    expect(resolveSaleDate(future, true, now)).toBe(now);
    expect(resolveSaleDate(future, false, now)).toBe(now);
  });
  it("un cajero puede reenviar ventas offline de hasta 7 días", () => {
    const d = new Date(now.getTime() - MAX_BACKDATE_NON_ADMIN_MS + 1000);
    expect(resolveSaleDate(d, false, now)).toBe(d);
  });
  it("un cajero no puede fechar una venta en 2020; el admin sí", () => {
    const old = new Date("2020-01-01T10:00:00Z");
    expect(() => resolveSaleDate(old, false, now)).toThrow("SALE_DATE_TOO_OLD");
    expect(resolveSaleDate(old, true, now)).toBe(old);
  });
});

describe("assertValidUnitPrice", () => {
  it("acepta cero y positivos, rechaza negativos y NaN", () => {
    expect(() => assertValidUnitPrice(0)).not.toThrow();
    expect(() => assertValidUnitPrice(12.5)).not.toThrow();
    expect(() => assertValidUnitPrice(-500)).toThrow("INVALID_PRICE");
    expect(() => assertValidUnitPrice(Number.NaN)).toThrow("INVALID_PRICE");
  });
});

describe("clientIpFromHeaders", () => {
  const h = (xff?: string) => (name: string) => (name === "x-forwarded-for" ? xff : undefined);
  it("usa la IP que agregó el proxy (última), no la que escribió el cliente", () => {
    expect(clientIpFromHeaders(h("1.2.3.4, 203.0.113.50"))).toBe("203.0.113.50");
  });
  it("con una sola entrada usa esa", () => {
    expect(clientIpFromHeaders(h("203.0.113.50"))).toBe("203.0.113.50");
  });
  it("sin cabeceras devuelve unknown", () => {
    expect(clientIpFromHeaders(h(undefined))).toBe("unknown");
  });
});
