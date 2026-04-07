export async function validateTransferLineProducts(tx, orgId, lines) {
    if (!lines.length)
        throw new Error("TRANSFER_NO_LINES");
    for (const line of lines) {
        const q = Number(line.qty);
        if (!Number.isFinite(q) || q <= 0)
            throw new Error("TRANSFER_BAD_QTY");
        const p = await tx.product.findFirst({
            where: { id: line.productId, organizationId: orgId },
        });
        if (!p)
            throw new Error("TRANSFER_PRODUCT_NOT_FOUND");
        if (p.productType === "KIT" || p.productType === "SERVICIO") {
            throw new Error("TRANSFER_BAD_PRODUCT_TYPE");
        }
    }
}
export async function assertStockForTransferSend(tx, lines) {
    for (const line of lines) {
        const p = await tx.product.findUnique({ where: { id: line.productId } });
        if (!p)
            throw new Error("TRANSFER_PRODUCT_NOT_FOUND");
        if (p.productType === "SERVICIO")
            continue;
        if (p.stock < line.qty)
            throw new Error("INSUFFICIENT_STOCK");
    }
}
export async function applyTransferSendStock(tx, lines) {
    for (const line of lines) {
        const p = await tx.product.findUnique({ where: { id: line.productId } });
        if (p?.productType === "SERVICIO")
            continue;
        await tx.product.update({
            where: { id: line.productId },
            data: { stock: { decrement: line.qty } },
        });
    }
}
export async function applyTransferReceiveStock(tx, lines) {
    for (const line of lines) {
        const p = await tx.product.findUnique({ where: { id: line.productId } });
        if (p?.productType === "SERVICIO")
            continue;
        await tx.product.update({
            where: { id: line.productId },
            data: { stock: { increment: line.qty } },
        });
    }
}
