import type { Prisma } from "@prisma/client";
import { assertStockAtLocation, setLocationQtyDelta } from "./productStockLocation.js";

type Tx = Prisma.TransactionClient;

export type TransferLineInput = { productId: string; qty: number };

export async function validateTransferLineProducts(
  tx: Tx,
  orgId: string,
  lines: TransferLineInput[]
): Promise<void> {
  if (!lines.length) throw new Error("TRANSFER_NO_LINES");
  for (const line of lines) {
    const q = Number(line.qty);
    if (!Number.isFinite(q) || q <= 0) throw new Error("TRANSFER_BAD_QTY");
    const p = await tx.product.findFirst({
      where: { id: line.productId, organizationId: orgId },
    });
    if (!p) throw new Error("TRANSFER_PRODUCT_NOT_FOUND");
    if (p.productType === "KIT" || p.productType === "SERVICIO") {
      throw new Error("TRANSFER_BAD_PRODUCT_TYPE");
    }
  }
}

export async function assertStockForTransferSend(
  tx: Tx,
  orgId: string,
  fromLocationId: string,
  lines: { productId: string; qty: number }[]
): Promise<void> {
  for (const line of lines) {
    const p = await tx.product.findUnique({ where: { id: line.productId } });
    if (!p) throw new Error("TRANSFER_PRODUCT_NOT_FOUND");
    if (p.productType === "SERVICIO") continue;
    const n = await tx.productStock.count({ where: { productId: line.productId } });
    if (n === 0) {
      if (p.stock < line.qty) throw new Error("INSUFFICIENT_STOCK");
    } else {
      await assertStockAtLocation(tx, line.productId, fromLocationId, line.qty);
    }
  }
}

export async function applyTransferSendStock(
  tx: Tx,
  orgId: string,
  fromLocationId: string,
  lines: { productId: string; qty: number }[]
): Promise<void> {
  for (const line of lines) {
    const p = await tx.product.findUnique({ where: { id: line.productId } });
    if (p?.productType === "SERVICIO") continue;
    const n = await tx.productStock.count({ where: { productId: line.productId } });
    if (n === 0) {
      await tx.product.update({
        where: { id: line.productId },
        data: { stock: { decrement: line.qty } },
      });
    } else {
      await setLocationQtyDelta(tx, orgId, line.productId, fromLocationId, -line.qty);
    }
  }
}

export async function applyTransferReceiveStock(
  tx: Tx,
  orgId: string,
  toLocationId: string,
  lines: { productId: string; qty: number }[]
): Promise<void> {
  for (const line of lines) {
    const p = await tx.product.findUnique({ where: { id: line.productId } });
    if (p?.productType === "SERVICIO") continue;
    const n = await tx.productStock.count({ where: { productId: line.productId } });
    if (n === 0) {
      await tx.product.update({
        where: { id: line.productId },
        data: { stock: { increment: line.qty } },
      });
    } else {
      await setLocationQtyDelta(tx, orgId, line.productId, toLocationId, line.qty);
    }
  }
}

/** Revierte un envío (devuelve existencias a la bodega de origen). */
export async function applyTransferUndoSendStock(
  tx: Tx,
  orgId: string,
  fromLocationId: string,
  lines: { productId: string; qty: number }[]
): Promise<void> {
  for (const line of lines) {
    const p = await tx.product.findUnique({ where: { id: line.productId } });
    if (p?.productType === "SERVICIO") continue;
    const n = await tx.productStock.count({ where: { productId: line.productId } });
    if (n === 0) {
      await tx.product.update({
        where: { id: line.productId },
        data: { stock: { increment: line.qty } },
      });
    } else {
      await setLocationQtyDelta(tx, orgId, line.productId, fromLocationId, line.qty);
    }
  }
}
