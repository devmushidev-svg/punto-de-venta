import { describe, expect, it } from "vitest";
import { PriceOverrideForbidden, authorizedLinePrice } from "../src/lib/salePricing.js";

/**
 * El precio que llega del navegador es una sugerencia, no una decision. Estas
 * pruebas existen para que un refactor no vuelva a confiar en el cliente:
 * casi todas afirman un rechazo, no un exito.
 */

const producto = { price: 5, price2: 4, price3: null, price4: null, volumePricesJson: null };
const sinPermiso = { product: producto, qty: 1, priceTier: 1, canOverride: false };
const conPermiso = { ...sinPermiso, canOverride: true };

describe("authorizedLinePrice", () => {
  it("sin precio pedido usa el del catalogo", () => {
    expect(authorizedLinePrice(sinPermiso)).toEqual({ unitPrice: 5, discountPercent: 0 });
  });

  it("rechaza un precio menor sin permiso", () => {
    expect(() => authorizedLinePrice({ ...sinPermiso, requestedUnitPrice: 0.01 })).toThrow(
      PriceOverrideForbidden,
    );
  });

  it("rechaza tambien un precio mayor sin permiso", () => {
    // Vender caro no es robo, pero sigue siendo apartarse del catalogo.
    expect(() => authorizedLinePrice({ ...sinPermiso, requestedUnitPrice: 999 })).toThrow(
      PriceOverrideForbidden,
    );
  });

  it("rechaza cualquier descuento sin permiso", () => {
    expect(() => authorizedLinePrice({ ...sinPermiso, requestedDiscountPercent: 1 })).toThrow(
      PriceOverrideForbidden,
    );
    expect(() => authorizedLinePrice({ ...sinPermiso, requestedDiscountPercent: 100 })).toThrow(
      PriceOverrideForbidden,
    );
  });

  it("acepta el mismo precio del catalogo aunque venga en el payload", () => {
    expect(authorizedLinePrice({ ...sinPermiso, requestedUnitPrice: 5 })).toEqual({
      unitPrice: 5,
      discountPercent: 0,
    });
  });

  it("tolera el redondeo del cliente por medio centavo", () => {
    expect(authorizedLinePrice({ ...sinPermiso, requestedUnitPrice: 5.004 }).unitPrice).toBe(5.004);
    expect(() => authorizedLinePrice({ ...sinPermiso, requestedUnitPrice: 5.02 })).toThrow();
  });

  it("con permiso acepta precio y descuento", () => {
    expect(authorizedLinePrice({ ...conPermiso, requestedUnitPrice: 0.01, requestedDiscountPercent: 50 })).toEqual({
      unitPrice: 0.01,
      discountPercent: 50,
    });
  });

  it("respeta la lista de precios del cliente al resolver el autorizado", () => {
    expect(authorizedLinePrice({ ...sinPermiso, priceTier: 2 }).unitPrice).toBe(4);
    // pedir el precio de la lista 2 estando en la lista 1 sigue siendo desviarse
    expect(() => authorizedLinePrice({ ...sinPermiso, requestedUnitPrice: 4 })).toThrow();
  });

  it("acota el descuento al rango 0-100 y descarta valores no finitos", () => {
    expect(authorizedLinePrice({ ...conPermiso, requestedDiscountPercent: 150 }).discountPercent).toBe(100);
    expect(authorizedLinePrice({ ...conPermiso, requestedDiscountPercent: -20 }).discountPercent).toBe(0);
    expect(authorizedLinePrice({ ...sinPermiso, requestedDiscountPercent: Number.NaN }).discountPercent).toBe(0);
  });

  it("ignora un precio no finito y cae al catalogo", () => {
    expect(authorizedLinePrice({ ...sinPermiso, requestedUnitPrice: Number.NaN }).unitPrice).toBe(5);
    expect(authorizedLinePrice({ ...sinPermiso, requestedUnitPrice: Number.POSITIVE_INFINITY }).unitPrice).toBe(5);
  });

  it("el error lleva el precio autorizado y el pedido, para poder auditarlo", () => {
    try {
      authorizedLinePrice({ ...sinPermiso, requestedUnitPrice: 0.01 });
      expect.unreachable("deberia haber lanzado");
    } catch (e) {
      expect(e).toBeInstanceOf(PriceOverrideForbidden);
      expect((e as PriceOverrideForbidden).detail).toEqual({
        authorized: 5,
        requested: 0.01,
        discountPercent: 0,
      });
    }
  });
});
