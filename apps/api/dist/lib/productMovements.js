const TYPE_LABELS = {
    VENTA: "Venta",
    COMPRA: "Compra / ingreso",
    TRASLADO_ENVIO: "Traslado (envío)",
    TRASLADO_RECEPCION: "Traslado (recepción)",
    AJUSTE: "Ajuste / auditoría",
};
export async function getProductMovements(prisma, orgId, productId, limit) {
    const product = await prisma.product.findFirst({
        where: { id: productId, organizationId: orgId },
        select: { id: true },
    });
    if (!product)
        return null;
    const cap = Math.min(200, Math.max(10, limit));
    const movements = [];
    const [saleLines, purchaseLines, transferLines, adjLines] = await Promise.all([
        prisma.saleLine.findMany({
            where: { productId },
            include: {
                product: { select: { productType: true } },
                sale: {
                    select: {
                        invoiceNumber: true,
                        saleDate: true,
                        organizationId: true,
                        user: { select: { displayName: true } },
                    },
                },
            },
            orderBy: { id: "desc" },
            take: cap,
        }),
        prisma.purchaseLine.findMany({
            where: { productId },
            include: {
                purchase: {
                    select: {
                        reference: true,
                        purchaseDate: true,
                        organizationId: true,
                        user: { select: { displayName: true } },
                    },
                },
            },
            orderBy: { id: "desc" },
            take: cap,
        }),
        prisma.stockTransferLine.findMany({
            where: { productId },
            include: {
                transfer: {
                    select: {
                        transferNumber: true,
                        status: true,
                        sentAt: true,
                        receivedAt: true,
                        organizationId: true,
                        fromLocation: { select: { code: true } },
                        toLocation: { select: { code: true } },
                        user: { select: { displayName: true } },
                    },
                },
            },
            orderBy: { id: "desc" },
            take: cap,
        }),
        prisma.stockAdjustmentLine.findMany({
            where: { productId },
            include: {
                adjustment: {
                    select: {
                        adjustmentNumber: true,
                        reason: true,
                        notes: true,
                        createdAt: true,
                        organizationId: true,
                        user: { select: { displayName: true } },
                    },
                },
            },
            orderBy: { id: "desc" },
            take: cap,
        }),
    ]);
    for (const sl of saleLines) {
        if (sl.sale.organizationId !== orgId)
            continue;
        const pt = sl.product.productType;
        if (pt === "SERVICIO" || pt === "KIT")
            continue;
        const type = "VENTA";
        movements.push({
            at: sl.sale.saleDate.toISOString(),
            type,
            typeLabel: TYPE_LABELS[type],
            qtyDelta: -sl.qty,
            ref: String(sl.sale.invoiceNumber ?? sl.saleId),
            detail: `Factura ${sl.sale.invoiceNumber ?? sl.saleId}`,
            userName: sl.sale.user.displayName,
        });
    }
    for (const pl of purchaseLines) {
        if (pl.purchase.organizationId !== orgId)
            continue;
        const type = "COMPRA";
        movements.push({
            at: pl.purchase.purchaseDate.toISOString(),
            type,
            typeLabel: TYPE_LABELS[type],
            qtyDelta: pl.qty,
            ref: String(pl.purchase.reference ?? pl.purchaseId),
            detail: pl.purchase.reference ? `Ref. ${pl.purchase.reference}` : "Ingreso por compra",
            userName: pl.purchase.user.displayName,
        });
    }
    for (const tl of transferLines) {
        const t = tl.transfer;
        if (t.organizationId !== orgId)
            continue;
        if (t.status === "ENVIADA" && t.sentAt) {
            const type = "TRASLADO_ENVIO";
            movements.push({
                at: t.sentAt.toISOString(),
                type,
                typeLabel: TYPE_LABELS[type],
                qtyDelta: -tl.qty,
                ref: String(t.transferNumber ?? tl.transferId),
                detail: `${t.fromLocation.code} → ${t.toLocation.code}`,
                userName: t.user.displayName,
            });
        }
        if (t.status === "RECIBIDA" && t.receivedAt) {
            const type = "TRASLADO_RECEPCION";
            movements.push({
                at: t.receivedAt.toISOString(),
                type,
                typeLabel: TYPE_LABELS[type],
                qtyDelta: tl.qty,
                ref: String(t.transferNumber ?? tl.transferId),
                detail: `${t.fromLocation.code} → ${t.toLocation.code}`,
                userName: t.user.displayName,
            });
        }
    }
    for (const al of adjLines) {
        const a = al.adjustment;
        if (a.organizationId !== orgId)
            continue;
        const type = "AJUSTE";
        movements.push({
            at: a.createdAt.toISOString(),
            type,
            typeLabel: TYPE_LABELS[type],
            qtyDelta: al.qtyDelta,
            ref: String(a.adjustmentNumber ?? al.adjustmentId),
            detail: [a.reason, a.notes].filter(Boolean).join(" · ") || "Ajuste",
            userName: a.user.displayName,
        });
    }
    movements.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
    return movements.slice(0, cap);
}
