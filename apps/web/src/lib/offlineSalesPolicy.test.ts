import { describe, expect, it } from "vitest";
import { classifyDrainStatus, isOfflineError } from "./offlineSalesPolicy";

describe("isOfflineError", () => {
  it("red caída (TypeError de fetch) cuenta como offline → se encola", () => {
    expect(isOfflineError(new TypeError("Failed to fetch"))).toBe(true);
  });
  it("error de negocio del servidor NO es offline → no se encola", () => {
    expect(isOfflineError(new Error("Stock insuficiente"))).toBe(false);
  });
});

describe("classifyDrainStatus", () => {
  it("2xx → enviada (se borra de la cola)", () => {
    expect(classifyDrainStatus(201)).toBe("sent");
    expect(classifyDrainStatus(200)).toBe("sent");
  });
  it("400 → fallida permanente (rechazo de negocio, no reintentar en bucle)", () => {
    expect(classifyDrainStatus(400)).toBe("failed");
  });
  it("401/403/5xx → reintentar luego (no perder la venta)", () => {
    expect(classifyDrainStatus(401)).toBe("retry");
    expect(classifyDrainStatus(403)).toBe("retry");
    expect(classifyDrainStatus(500)).toBe("retry");
    expect(classifyDrainStatus(503)).toBe("retry");
  });
});
