export async function replaceProductKitLines(tx, kitProductId, organizationId, lines, productType) {
    if (productType !== "KIT") {
        await tx.productKitLine.deleteMany({ where: { kitProductId } });
        return;
    }
    if (!lines?.length)
        throw new Error("KIT_EMPTY");
    const seen = new Set();
    await tx.productKitLine.deleteMany({ where: { kitProductId } });
    for (const row of lines) {
        if (seen.has(row.productId))
            throw new Error("KIT_DUP_COMPONENT");
        seen.add(row.productId);
        const q = Number(row.qty);
        if (!Number.isFinite(q) || q <= 0)
            throw new Error("KIT_BAD_LINE");
        const comp = await tx.product.findFirst({
            where: { id: row.productId, organizationId },
        });
        if (!comp)
            throw new Error("KIT_COMPONENT_NOT_FOUND");
        if (comp.productType !== "PRODUCTO")
            throw new Error("KIT_BAD_COMPONENT");
        if (comp.id === kitProductId)
            throw new Error("KIT_SELF_REF");
        await tx.productKitLine.create({
            data: { kitProductId, componentProductId: comp.id, qty: q },
        });
    }
}
export async function assertKitSaleStock(tx, kitProductId, lineQty) {
    const lines = await tx.productKitLine.findMany({
        where: { kitProductId },
        include: { component: true },
    });
    if (lines.length === 0)
        throw new Error("KIT_EMPTY");
    for (const kl of lines) {
        if (kl.component.productType !== "PRODUCTO")
            throw new Error("KIT_BAD_COMPONENT");
        const need = lineQty * kl.qty;
        if (kl.component.stock < need)
            throw new Error("INSUFFICIENT_STOCK");
    }
}
export async function decrementStockForKitSale(tx, kitProductId, lineQty) {
    const lines = await tx.productKitLine.findMany({ where: { kitProductId } });
    for (const kl of lines) {
        const dec = lineQty * kl.qty;
        await tx.product.update({
            where: { id: kl.componentProductId },
            data: { stock: { decrement: dec } },
        });
    }
}
