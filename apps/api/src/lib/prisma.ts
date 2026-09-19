import { PrismaClient } from "@prisma/client";
import { argsDeVentasVisibles } from "./ventasVisibles.js";

const base = new PrismaClient();

/**
 * Una venta eliminada no se borra de la base: queda con `deletedAt`, quien la
 * elimino y por que. Pero no debe contar en ningun lado — listados, reportes,
 * caja, totales del dia.
 *
 * Filtrar en cada consulta es olvidarse en una, y una venta eliminada que
 * igual suma en el total del dia es peor que no poder eliminarla. Por eso se
 * filtra aca, una sola vez, y las 14 consultas a `sale` lo heredan.
 *
 * Para verlas a proposito (la bitacora), se pasa `deletedAt` explicito en el
 * `where`: si ya viene, esta capa no lo toca.
 */
const extendido = base.$extends({
  query: {
    sale: {
      async $allOperations({ operation, args, query }) {
        return query(argsDeVentasVisibles(operation, args as Record<string, unknown>));
      },
    },
  },
});

/**
 * ponytail: el cast mantiene el tipo `PrismaClient` en los 16 lugares que ya
 * anotaban `Prisma.TransactionClient` o `PrismaClient`; sin el, el cliente
 * extendido obliga a cambiarlos en 8 archivos. Lo unico que pierde el tipo
 * extendido es `$on`/`$use`, que este codigo no usa (verificado). Si algun dia
 * hace falta `$on`, el camino es cambiar esas anotaciones por `typeof prisma`.
 */
export const prisma = extendido as unknown as PrismaClient;
