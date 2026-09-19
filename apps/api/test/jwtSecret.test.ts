import { describe, expect, it } from "vitest";
import { validateJwtSecret } from "../src/lib/auth.js";

/**
 * Pruebas NEGATIVAS: casi todas afirman un rechazo. Un secreto de ejemplo
 * aceptado en produccion permite firmar tokens de cualquier usuario, porque
 * esos valores estan publicados en este repositorio.
 */
describe("validateJwtSecret", () => {
  const BUENO = "N0vqf8Zk2pT7wQx1LmR4sJhB6yCdE3aUgVzXnPtKrFo=";

  it("rechaza el secreto que vive en .env.example", () => {
    expect(() => validateJwtSecret("dev-secret-local-change-me", "production")).toThrow(/published/i);
  });

  it("rechaza el secreto que estuvo versionado en apps/api/.env", () => {
    expect(() =>
      validateJwtSecret("cambiar-en-produccion-usa-openssl-rand-hex-32", "production")
    ).toThrow(/published/i);
  });

  it("rechaza el fallback de desarrollo", () => {
    expect(() => validateJwtSecret("dev-secret-change-me", "production")).toThrow(/published/i);
  });

  it("no se deja enganar por mayusculas", () => {
    expect(() => validateJwtSecret("Dev-Secret-Change-Me", "production")).toThrow(/published/i);
  });

  it("no se deja enganar por espacios alrededor", () => {
    expect(() => validateJwtSecret("  dev-secret-change-me  ", "production")).toThrow(/published/i);
  });

  it("rechaza un secreto ausente en produccion", () => {
    expect(() => validateJwtSecret(undefined, "production")).toThrow(/required in production/i);
    expect(() => validateJwtSecret("   ", "production")).toThrow(/required in production/i);
  });

  it("rechaza un secreto corto aunque sea aleatorio", () => {
    expect(() => validateJwtSecret("a7Kq2Lm9Zx", "production")).toThrow(/at least 32/i);
    expect(() => validateJwtSecret("x".repeat(31), "production")).toThrow(/at least 32/i);
  });

  it("acepta uno largo y propio", () => {
    expect(validateJwtSecret(BUENO, "production")).toBe(BUENO);
    expect(validateJwtSecret("x".repeat(32), "production")).toBe("x".repeat(32));
  });

  it("fuera de produccion no estorba al desarrollo", () => {
    expect(validateJwtSecret("dev-secret-local-change-me", "development")).toBe("dev-secret-local-change-me");
    expect(validateJwtSecret(undefined, "development")).toBe("dev-secret-change-me");
    expect(validateJwtSecret("corto", undefined)).toBe("corto");
  });
});
