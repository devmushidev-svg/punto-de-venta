import { describe, it, expect } from "vitest";
import {
  parseVolumePricesJson,
  priceForTier,
  resolveProductUnitPrice,
  normalizeVolumePricesPayload,
} from "../src/lib/volumePrice.js";

const base = { price: 10, price2: 8, price3: null, price4: null };

describe("parseVolumePricesJson", () => {
  it("devuelve [] para entradas vacías o inválidas", () => {
    expect(parseVolumePricesJson(null)).toEqual([]);
    expect(parseVolumePricesJson("")).toEqual([]);
    expect(parseVolumePricesJson("no-es-json")).toEqual([]);
    expect(parseVolumePricesJson('{"minQty":1}')).toEqual([]); // no es arreglo
  });

  it("filtra tramos inválidos y ordena por minQty ascendente", () => {
    const raw = '[{"minQty":10,"price":5},{"minQty":3,"price":8},{"minQty":-1,"price":2},{"minQty":5,"price":-9}]';
    expect(parseVolumePricesJson(raw)).toEqual([
      { minQty: 3, price: 8 },
      { minQty: 10, price: 5 },
    ]);
  });
});

describe("priceForTier", () => {
  it("usa el precio del nivel cuando existe", () => {
    expect(priceForTier(base, 2)).toBe(8);
  });

  it("cae al precio base si el nivel no está definido", () => {
    expect(priceForTier(base, 3)).toBe(10);
    expect(priceForTier(base, 1)).toBe(10);
  });
});

describe("resolveProductUnitPrice", () => {
  it("sin tramos por cantidad usa el precio del nivel", () => {
    expect(resolveProductUnitPrice(base, 5, 2)).toBe(8);
  });

  it("aplica el tramo del mayor minQty que la cantidad alcanza", () => {
    const p = {
      ...base,
      volumePricesJson: '[{"minQty":3,"price":8},{"minQty":10,"price":5}]',
    };
    expect(resolveProductUnitPrice(p, 1, 1)).toBe(10); // por debajo del primer tramo → base
    expect(resolveProductUnitPrice(p, 5, 1)).toBe(8); // alcanza minQty 3
    expect(resolveProductUnitPrice(p, 12, 1)).toBe(5); // alcanza minQty 10
  });

  it("cantidad inválida o <= 0 devuelve el precio base del nivel", () => {
    const p = { ...base, volumePricesJson: '[{"minQty":3,"price":8}]' };
    expect(resolveProductUnitPrice(p, 0, 1)).toBe(10);
  });
});

describe("normalizeVolumePricesPayload", () => {
  it("acepta un arreglo y lo devuelve normalizado como string JSON", () => {
    const out = normalizeVolumePricesPayload([
      { minQty: 10, price: 5 },
      { minQty: 3, price: 8 },
    ]);
    expect(out).toBe('[{"minQty":3,"price":8},{"minQty":10,"price":5}]');
  });

  it("acepta un string JSON y filtra lo inválido", () => {
    const out = normalizeVolumePricesPayload('[{"minQty":2,"price":7},{"minQty":0,"price":1}]');
    expect(out).toBe('[{"minQty":2,"price":7}]');
  });

  it("entradas no válidas producen '[]'", () => {
    expect(normalizeVolumePricesPayload("basura")).toBe("[]");
    expect(normalizeVolumePricesPayload(null)).toBe("[]");
  });
});
