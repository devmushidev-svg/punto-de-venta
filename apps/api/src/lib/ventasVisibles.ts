/** Operaciones de lectura a las que hay que esconderles las ventas eliminadas. */
const LECTURAS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

type ArgsConWhere = { where?: Record<string, unknown> } & Record<string, unknown>;

/**
 * Decide con que `where` sale una consulta a `sale`. Separada del cliente de
 * Prisma para poder probarla: es el punto donde un olvido hace que una venta
 * eliminada siga sumando en el total del dia.
 *
 * - Lecturas sin `deletedAt`: se les agrega `deletedAt: null`.
 * - Lecturas que ya traen `deletedAt`: se respetan (asi ve la bitacora).
 * - Escrituras: intactas, o no se podria marcar la venta como eliminada.
 */
export function argsDeVentasVisibles<T extends ArgsConWhere>(operation: string, args: T): T {
  if (!LECTURAS.has(operation)) return args;
  if (args.where && "deletedAt" in args.where) return args;
  return { ...args, where: { ...(args.where ?? {}), deletedAt: null } };
}
