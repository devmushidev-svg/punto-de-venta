import { describe, expect, it } from "vitest";
import { demoSeedCredentials } from "../src/lib/demoSeedCredentials.js";

describe("demoSeedCredentials", () => {
  it("mantiene las credenciales conocidas solo para desarrollo local", () => {
    expect(demoSeedCredentials({ NODE_ENV: "development" })).toEqual({
      adminPassword: "admin",
      cashierPassword: "cajero",
      normalPassword: "usuario",
    });
  });

  it("rechaza sembrar credenciales públicas conocidas en producción", () => {
    expect(() => demoSeedCredentials({ NODE_ENV: "production" })).toThrow(/DEMO_ADMIN_PASSWORD/);
  });

  it("acepta contraseñas de demostración explícitas en producción", () => {
    expect(
      demoSeedCredentials({
        NODE_ENV: "production",
        DEMO_ADMIN_PASSWORD: "admin-demo-no-publica-123",
        DEMO_CASHIER_PASSWORD: "cajero-demo-no-publica-123",
        DEMO_NORMAL_PASSWORD: "usuario-demo-no-publica-123",
      })
    ).toEqual({
      adminPassword: "admin-demo-no-publica-123",
      cashierPassword: "cajero-demo-no-publica-123",
      normalPassword: "usuario-demo-no-publica-123",
    });
  });

  it("exige también la contraseña del usuario normal en producción", () => {
    expect(() =>
      demoSeedCredentials({
        NODE_ENV: "production",
        DEMO_ADMIN_PASSWORD: "a-demo-no-publica-123",
        DEMO_CASHIER_PASSWORD: "c-demo-no-publica-123",
      })
    ).toThrow(/DEMO_NORMAL_PASSWORD/);
  });
});
