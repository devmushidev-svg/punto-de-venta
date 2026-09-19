import { describe, expect, it } from "vitest";
import { argsDeVentasVisibles } from "../src/lib/ventasVisibles.js";

/**
 * Pruebas NEGATIVAS: casi todas afirman que una lectura NO puede salir sin el
 * filtro. Si esto se afloja, una venta eliminada vuelve a sumar en el total
 * del dia, en la caja y en los reportes, sin que nadie lo note.
 */
describe("argsDeVentasVisibles", () => {
  const LECTURAS = [
    "findMany",
    "findFirst",
    "findFirstOrThrow",
    "findUnique",
    "findUniqueOrThrow",
    "count",
    "aggregate",
    "groupBy",
  ];

  it("ninguna lectura sale sin filtrar las eliminadas", () => {
    for (const op of LECTURAS) {
      const r = argsDeVentasVisibles(op, { where: { organizationId: "org1" } });
      expect(r.where, `${op} salio sin filtro`).toEqual({ organizationId: "org1", deletedAt: null });
    }
  });

  it("tambien filtra cuando la consulta no trae where", () => {
    for (const op of LECTURAS) {
      expect(argsDeVentasVisibles(op, {}).where, `${op} sin where`).toEqual({ deletedAt: null });
    }
  });

  it("no pisa el resto del where", () => {
    const r = argsDeVentasVisibles("findMany", {
      where: { organizationId: "org1", saleDate: { gte: "2026-01-01" } },
      take: 10,
      orderBy: { saleDate: "desc" },
    });
    expect(r.where).toEqual({
      organizationId: "org1",
      saleDate: { gte: "2026-01-01" },
      deletedAt: null,
    });
    expect(r.take).toBe(10);
    expect(r.orderBy).toEqual({ saleDate: "desc" });
  });

  it("respeta un deletedAt explicito: asi se lee la bitacora", () => {
    const r = argsDeVentasVisibles("findMany", {
      where: { organizationId: "org1", deletedAt: { not: null } },
    });
    expect(r.where).toEqual({ organizationId: "org1", deletedAt: { not: null } });
  });

  it("no toca las escrituras, o no se podria marcar como eliminada", () => {
    for (const op of ["update", "updateMany", "create", "delete", "deleteMany", "upsert"]) {
      const args = { where: { id: "v1" }, data: { deletedAt: new Date() } };
      expect(argsDeVentasVisibles(op, args), `${op} fue alterada`).toBe(args);
    }
  });

  it("no muta el objeto que recibe", () => {
    const args = { where: { organizationId: "org1" } };
    argsDeVentasVisibles("findMany", args);
    expect(args.where).toEqual({ organizationId: "org1" });
  });
});
