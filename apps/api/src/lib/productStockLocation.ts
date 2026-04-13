import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Primera bodega activa por sortOrder; si no hay, crea MAIN. */
export async function getDefaultLocationId(tx: Tx, orgId: string): Promise<string> {
  const first = await tx.stockLocation.findFirst({
    where: { organizationId: orgId, active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  if (first) return first.id;
  const row = await tx.stockLocation.create({
    data: { organizationId: orgId, code: "MAIN", name: "Principal", sortOrder: 0, active: true },
  });
  return row.id;
}

async function syncProductTotalFromStocks(tx: Tx, productId: string): Promise<void> {
  const agg = await tx.productStock.aggregate({ where: { productId }, _sum: { qty: true } });
  const total = agg._sum.qty ?? 0;
  await tx.product.update({ where: { id: productId }, data: { stock: total } });
}

/** Ajusta cantidad en una bodega y recalcula Product.stock como suma de bodegas. */
export async function setLocationQtyDelta(
  tx: Tx,
  orgId: string,
  productId: string,
  locationId: string,
  delta: number
): Promise<void> {
  if (delta === 0) return;
  const row = await tx.productStock.findUnique({
    where: { productId_locationId: { productId, locationId } },
  });
  if (row) {
    await tx.productStock.update({
      where: { id: row.id },
      data: { qty: row.qty + delta },
    });
  } else {
    await tx.productStock.create({
      data: { organizationId: orgId, productId, locationId, qty: delta },
    });
  }
  await syncProductTotalFromStocks(tx, productId);
}

/** Si el producto no tiene filas ProductStock, solo actualiza Product.stock (modo legacy). */
export async function adjustProductStock(tx: Tx, orgId: string, productId: string, delta: number): Promise<void> {
  if (delta === 0) return;
  const n = await tx.productStock.count({ where: { productId } });
  if (n === 0) {
    await tx.product.update({ where: { id: productId }, data: { stock: { increment: delta } } });
    return;
  }
  const locId = await getDefaultLocationId(tx, orgId);
  await setLocationQtyDelta(tx, orgId, productId, locId, delta);
}

export async function assertStockAtLocation(
  tx: Tx,
  productId: string,
  locationId: string,
  need: number
): Promise<void> {
  const row = await tx.productStock.findUnique({
    where: { productId_locationId: { productId, locationId } },
  });
  const q = row?.qty ?? 0;
  if (q < need) throw new Error("INSUFFICIENT_STOCK");
}

export async function migrateOrgProductStocks(tx: Tx, orgId: string): Promise<{ products: number }> {
  const locId = await getDefaultLocationId(tx, orgId);
  const products = await tx.product.findMany({
    where: { organizationId: orgId },
    select: { id: true, stock: true },
  });
  let n = 0;
  for (const p of products) {
    const exists = await tx.productStock.findUnique({
      where: { productId_locationId: { productId: p.id, locationId: locId } },
    });
    if (exists) continue;
    await tx.productStock.create({
      data: { organizationId: orgId, productId: p.id, locationId: locId, qty: p.stock },
    });
    n++;
  }
  for (const p of products) {
    await syncProductTotalFromStocks(tx, p.id);
  }
  return { products: n };
}
