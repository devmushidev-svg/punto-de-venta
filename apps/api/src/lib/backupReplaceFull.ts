import type { Prisma, PrismaClient } from "@prisma/client";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** Borra todos los datos de negocio de la organización (no borra la fila Organization). */
export async function wipeOrganizationData(tx: Prisma.TransactionClient, orgId: string): Promise<void> {
  await tx.payrollLineDeduction.deleteMany({
    where: { line: { period: { organizationId: orgId } } },
  });
  await tx.payrollLine.deleteMany({ where: { period: { organizationId: orgId } } });
  await tx.payrollPeriod.deleteMany({ where: { organizationId: orgId } });

  await tx.sale.deleteMany({ where: { organizationId: orgId } });
  await tx.purchase.deleteMany({ where: { organizationId: orgId } });
  await tx.quote.deleteMany({ where: { organizationId: orgId } });
  await tx.supplierOrder.deleteMany({ where: { organizationId: orgId } });
  await tx.stockTransfer.deleteMany({ where: { organizationId: orgId } });
  await tx.stockAdjustment.deleteMany({ where: { organizationId: orgId } });

  await tx.expense.deleteMany({ where: { organizationId: orgId } });
  await tx.cashSession.deleteMany({ where: { organizationId: orgId } });

  await tx.productKitLine.deleteMany({
    where: { OR: [{ kitProduct: { organizationId: orgId } }, { component: { organizationId: orgId } }] },
  });
  await tx.productStock.deleteMany({ where: { organizationId: orgId } });
  await tx.product.deleteMany({ where: { organizationId: orgId } });
  await tx.customer.deleteMany({ where: { organizationId: orgId } });
  await tx.supplier.deleteMany({ where: { organizationId: orgId } });
  await tx.stockLocation.deleteMany({ where: { organizationId: orgId } });

  await tx.expenseCategory.deleteMany({ where: { book: { organizationId: orgId } } });
  await tx.expenseBook.deleteMany({ where: { organizationId: orgId } });
  await tx.employee.deleteMany({ where: { organizationId: orgId } });
  await tx.user.deleteMany({ where: { organizationId: orgId } });
  await tx.organizationSettings.deleteMany({ where: { organizationId: orgId } });
}

function d(raw: unknown): Date {
  return new Date(String(raw));
}

/** Restaura desde JSON de exportación (misma org, mismos ids). Requiere `passwordHash` en usuarios del backup. */
export async function restoreOrganizationFromBackupPayload(
  tx: Prisma.TransactionClient,
  orgId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const orgRaw = payload.organization;
  if (!isRecord(orgRaw) || String(orgRaw.id) !== orgId) throw new Error("BACKUP_ORG_MISMATCH");

  await tx.organization.update({
    where: { id: orgId },
    data: {
      slug: String(orgRaw.slug ?? "org"),
      name: String(orgRaw.name ?? "Empresa"),
      slogan: orgRaw.slogan != null ? String(orgRaw.slogan) : null,
      taxId: orgRaw.taxId != null ? String(orgRaw.taxId) : null,
      phone: orgRaw.phone != null ? String(orgRaw.phone) : null,
      email: orgRaw.email != null ? String(orgRaw.email) : null,
      website: orgRaw.website != null ? String(orgRaw.website) : null,
      address: orgRaw.address != null ? String(orgRaw.address) : null,
      city: orgRaw.city != null ? String(orgRaw.city) : null,
      department: orgRaw.department != null ? String(orgRaw.department) : null,
      zip: orgRaw.zip != null ? String(orgRaw.zip) : null,
      recoveryEmail: orgRaw.recoveryEmail != null ? String(orgRaw.recoveryEmail) : null,
      country: String(orgRaw.country ?? "HN"),
      currency: String(orgRaw.currency ?? "HNL"),
      currencySymbol: String(orgRaw.currencySymbol ?? "L"),
      language: String(orgRaw.language ?? "es"),
      logoUrl: orgRaw.logoUrl != null ? String(orgRaw.logoUrl) : null,
      taxIdType: orgRaw.taxIdType != null ? String(orgRaw.taxIdType) : "RTN",
    },
  });

  const settings = payload.settings;
  if (isRecord(settings)) {
    await tx.organizationSettings.create({
      data: {
        organizationId: orgId,
        generalJson: typeof settings.generalJson === "string" ? settings.generalJson : "{}",
        invoiceJson: typeof settings.invoiceJson === "string" ? settings.invoiceJson : "{}",
      },
    });
  } else {
    await tx.organizationSettings.create({ data: { organizationId: orgId } });
  }

  const users = Array.isArray(payload.users) ? payload.users : [];
  for (const u of users) {
    if (!isRecord(u)) continue;
    const passwordHash = u.passwordHash != null ? String(u.passwordHash) : "";
    if (!passwordHash) throw new Error("BACKUP_MISSING_PASSWORD_HASH");
    await tx.user.create({
      data: {
        id: String(u.id),
        organizationId: orgId,
        username: String(u.username).toUpperCase(),
        displayName: String(u.displayName ?? u.username),
        role: String(u.role ?? "cajero"),
        active: u.active !== false,
        passwordHash,
        permissionsJson: typeof u.permissionsJson === "string" ? u.permissionsJson : JSON.stringify(u.permissionsJson ?? {}),
        permissionsRev: Math.trunc(Number(u.permissionsRev)) || 0,
        createdAt: u.createdAt ? d(u.createdAt) : undefined,
      },
    });
  }

  const locs = Array.isArray(payload.stockLocations) ? payload.stockLocations : [];
  for (const r of locs) {
    if (!isRecord(r)) continue;
    await tx.stockLocation.create({
      data: {
        id: String(r.id),
        organizationId: orgId,
        code: String(r.code ?? ""),
        name: String(r.name ?? ""),
        active: r.active !== false,
        sortOrder: Math.trunc(Number(r.sortOrder)) || 0,
      },
    });
  }

  const sups = Array.isArray(payload.suppliers) ? payload.suppliers : [];
  for (const r of sups) {
    if (!isRecord(r)) continue;
    await tx.supplier.create({
      data: {
        id: String(r.id),
        organizationId: orgId,
        name: String(r.name ?? ""),
        phone: r.phone != null ? String(r.phone) : null,
        email: r.email != null ? String(r.email) : null,
        taxId: r.taxId != null ? String(r.taxId) : null,
        address: r.address != null ? String(r.address) : null,
      },
    });
  }

  const custs = Array.isArray(payload.customers) ? payload.customers : [];
  for (const r of custs) {
    if (!isRecord(r)) continue;
    await tx.customer.create({
      data: {
        id: String(r.id),
        organizationId: orgId,
        code: String(r.code ?? "0"),
        name: String(r.name ?? ""),
        address: r.address != null ? String(r.address) : null,
        phone: r.phone != null ? String(r.phone) : null,
        taxId: r.taxId != null ? String(r.taxId) : null,
        notes: r.notes != null ? String(r.notes) : null,
        defaultPriceTier: r.defaultPriceTier != null ? Math.trunc(Number(r.defaultPriceTier)) || null : null,
      },
    });
  }

  const products = Array.isArray(payload.products) ? payload.products : [];
  for (const r of products) {
    if (!isRecord(r)) continue;
    const supplierId = r.supplierId != null ? String(r.supplierId) : null;
    await tx.product.create({
      data: {
        id: String(r.id),
        organizationId: orgId,
        sku: String(r.sku ?? ""),
        name: String(r.name ?? ""),
        description: r.description != null ? String(r.description) : null,
        unit: String(r.unit ?? "UND"),
        price: Number(r.price) || 0,
        price2: r.price2 != null ? Number(r.price2) : null,
        price3: r.price3 != null ? Number(r.price3) : null,
        price4: r.price4 != null ? Number(r.price4) : null,
        volumePricesJson: typeof r.volumePricesJson === "string" ? r.volumePricesJson : JSON.stringify(r.volumePricesJson ?? []),
        cost: Number(r.cost) || 0,
        taxPercent: Number(r.taxPercent) || 0,
        taxName: String(r.taxName ?? "ISV"),
        stock: Number(r.stock) || 0,
        minStock: Number(r.minStock) || 0,
        lotCode: r.lotCode != null ? String(r.lotCode) : null,
        expiresAt: r.expiresAt ? d(r.expiresAt) : null,
        category: r.category != null ? String(r.category) : null,
        barcode: r.barcode != null ? String(r.barcode) : null,
        quickCode: r.quickCode != null ? String(r.quickCode) : null,
        location: r.location != null ? String(r.location) : null,
        brand: r.brand != null ? String(r.brand) : null,
        imageUrl: r.imageUrl != null ? String(r.imageUrl) : null,
        productType: String(r.productType ?? "PRODUCTO"),
        esGranel: Boolean(r.esGranel),
        printOnKitchenOrder: r.printOnKitchenOrder !== false,
        supplierId,
        active: r.active !== false,
      },
    });
  }

  for (const r of products) {
    if (!isRecord(r)) continue;
    const kitLines = r.kitLines;
    if (!Array.isArray(kitLines)) continue;
    for (const kl of kitLines) {
      if (!isRecord(kl)) continue;
      await tx.productKitLine.create({
        data: {
          id: String(kl.id),
          kitProductId: String(kl.kitProductId ?? r.id),
          componentProductId: String(kl.componentProductId),
          qty: Number(kl.qty) || 0,
        },
      });
    }
  }

  const pStocks = Array.isArray(payload.productStocks) ? payload.productStocks : [];
  for (const r of pStocks) {
    if (!isRecord(r)) continue;
    await tx.productStock.create({
      data: {
        id: String(r.id),
        organizationId: orgId,
        productId: String(r.productId),
        locationId: String(r.locationId),
        qty: Number(r.qty) || 0,
      },
    });
  }

  const books = Array.isArray(payload.expenseBooks) ? payload.expenseBooks : [];
  for (const b of books) {
    if (!isRecord(b)) continue;
    const book = await tx.expenseBook.create({
      data: {
        id: String(b.id),
        organizationId: orgId,
        name: String(b.name ?? ""),
        sortOrder: Math.trunc(Number(b.sortOrder)) || 0,
      },
    });
    const cats = b.categories;
    if (Array.isArray(cats)) {
      for (const c of cats) {
        if (!isRecord(c)) continue;
        await tx.expenseCategory.create({
          data: {
            id: String(c.id),
            bookId: book.id,
            name: String(c.name ?? ""),
            sortOrder: Math.trunc(Number(c.sortOrder)) || 0,
          },
        });
      }
    }
  }

  const emps = Array.isArray(payload.employees) ? payload.employees : [];
  for (const r of emps) {
    if (!isRecord(r)) continue;
    await tx.employee.create({
      data: {
        id: String(r.id),
        organizationId: orgId,
        employeeCode: r.employeeCode != null ? String(r.employeeCode) : null,
        name: String(r.name ?? ""),
        idDocument: r.idDocument != null ? String(r.idDocument) : null,
        phone: r.phone != null ? String(r.phone) : null,
        email: r.email != null ? String(r.email) : null,
        position: r.position != null ? String(r.position) : null,
        hireDate: r.hireDate ? d(r.hireDate) : null,
        active: r.active !== false,
        notes: r.notes != null ? String(r.notes) : null,
      },
    });
  }

  const payrollPeriods = Array.isArray(payload.payrollPeriods) ? payload.payrollPeriods : [];
  for (const per of payrollPeriods) {
    if (!isRecord(per)) continue;
    const period = await tx.payrollPeriod.create({
      data: {
        id: String(per.id),
        organizationId: orgId,
        userId: String(per.userId),
        year: Math.trunc(Number(per.year)) || new Date().getFullYear(),
        month: Math.trunc(Number(per.month)) || 1,
        status: String(per.status ?? "BORRADOR"),
        notes: per.notes != null ? String(per.notes) : null,
      },
    });
    const lines = per.lines;
    if (Array.isArray(lines)) {
      for (const ln of lines) {
        if (!isRecord(ln)) continue;
        const line = await tx.payrollLine.create({
          data: {
            id: String(ln.id),
            periodId: period.id,
            employeeId: String(ln.employeeId),
            gross: Number(ln.gross) || 0,
            deductions: Number(ln.deductions) || 0,
            net: Number(ln.net) || 0,
            notes: ln.notes != null ? String(ln.notes) : null,
          },
        });
        const deds = ln.deductionItems;
        if (Array.isArray(deds)) {
          for (const di of deds) {
            if (!isRecord(di)) continue;
            await tx.payrollLineDeduction.create({
              data: {
                id: String(di.id),
                lineId: line.id,
                concept: String(di.concept ?? ""),
                amount: Number(di.amount) || 0,
                sortOrder: Math.trunc(Number(di.sortOrder)) || 0,
              },
            });
          }
        }
      }
    }
  }

  const sessions = Array.isArray(payload.cashSessions) ? payload.cashSessions : [];
  for (const r of sessions) {
    if (!isRecord(r)) continue;
    await tx.cashSession.create({
      data: {
        id: String(r.id),
        organizationId: orgId,
        userId: String(r.userId),
        openedAt: d(r.openedAt),
        closedAt: r.closedAt ? d(r.closedAt) : null,
        openingCash: Number(r.openingCash) || 0,
        closingCash: r.closingCash != null ? Number(r.closingCash) : null,
        expectedCash: r.expectedCash != null ? Number(r.expectedCash) : null,
        notes: r.notes != null ? String(r.notes) : null,
      },
    });
  }

  const movements = Array.isArray(payload.cashMovements) ? payload.cashMovements : [];
  for (const r of movements) {
    if (!isRecord(r)) continue;
    await tx.cashMovement.create({
      data: {
        id: String(r.id),
        organizationId: orgId,
        sessionId: String(r.sessionId),
        userId: String(r.userId),
        category: String(r.category ?? "GASTO"),
        amount: Number(r.amount) || 0,
        hasVoucher: Boolean(r.hasVoucher),
        note: r.note != null ? String(r.note) : null,
        createdAt: r.createdAt ? d(r.createdAt) : undefined,
      },
    });
  }

  const sales = Array.isArray(payload.sales) ? payload.sales : [];
  for (const s of sales) {
    if (!isRecord(s)) continue;
    const lines = Array.isArray(s.lines) ? s.lines : [];
    const surcharges = Array.isArray(s.receivableSurcharges) ? s.receivableSurcharges : [];
    await tx.sale.create({
      data: {
        id: String(s.id),
        organizationId: orgId,
        customerId: s.customerId != null ? String(s.customerId) : null,
        userId: String(s.userId),
        invoiceNumber: s.invoiceNumber != null ? String(s.invoiceNumber) : null,
        sellerName: s.sellerName != null ? String(s.sellerName) : null,
        terms: String(s.terms ?? "CONTADO"),
        status: String(s.status ?? "COMPLETADA"),
        notes: s.notes != null ? String(s.notes) : null,
        priceTier: Math.trunc(Number(s.priceTier)) || 1,
        subtotal: Number(s.subtotal) || 0,
        tax: Number(s.tax) || 0,
        discount: Number(s.discount) || 0,
        total: Number(s.total) || 0,
        paid: Number(s.paid) || 0,
        saleDate: d(s.saleDate),
        dueDate: s.dueDate ? d(s.dueDate) : null,
        lines: {
          create: lines
            .filter(isRecord)
            .map((l) => ({
              id: String(l.id),
              productId: String(l.productId),
              qty: Number(l.qty) || 0,
              unitPrice: Number(l.unitPrice) || 0,
              discountPercent: Number(l.discountPercent) || 0,
              taxPercent: Number(l.taxPercent) || 0,
              lineTotal: Number(l.lineTotal) || 0,
            })),
        },
        receivableSurcharges:
          surcharges.length > 0
            ? {
                create: surcharges.filter(isRecord).map((x) => ({
                  id: String(x.id),
                  amount: Number(x.amount) || 0,
                  note: x.note != null ? String(x.note) : null,
                  userId: String(x.userId),
                  createdAt: x.createdAt ? d(x.createdAt) : undefined,
                })),
              }
            : undefined,
      },
    });
  }

  const purchases = Array.isArray(payload.purchases) ? payload.purchases : [];
  for (const s of purchases) {
    if (!isRecord(s)) continue;
    const lines = Array.isArray(s.lines) ? s.lines : [];
    const surcharges = Array.isArray(s.payableSurcharges) ? s.payableSurcharges : [];
    await tx.purchase.create({
      data: {
        id: String(s.id),
        organizationId: orgId,
        supplierId: s.supplierId != null ? String(s.supplierId) : null,
        userId: String(s.userId),
        reference: s.reference != null ? String(s.reference) : null,
        terms: String(s.terms ?? "CONTADO"),
        subtotal: Number(s.subtotal) || 0,
        tax: Number(s.tax) || 0,
        total: Number(s.total) || 0,
        paid: Number(s.paid) || 0,
        purchaseDate: d(s.purchaseDate),
        lines: {
          create: lines
            .filter(isRecord)
            .map((l) => ({
              id: String(l.id),
              productId: String(l.productId),
              qty: Number(l.qty) || 0,
              unitCost: Number(l.unitCost) || 0,
              taxPercent: Number(l.taxPercent) || 0,
              lineTotal: Number(l.lineTotal) || 0,
            })),
        },
        payableSurcharges:
          surcharges.length > 0
            ? {
                create: surcharges.filter(isRecord).map((x) => ({
                  id: String(x.id),
                  amount: Number(x.amount) || 0,
                  note: x.note != null ? String(x.note) : null,
                  userId: String(x.userId),
                  createdAt: x.createdAt ? d(x.createdAt) : undefined,
                })),
              }
            : undefined,
      },
    });
  }

  const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
  for (const s of quotes) {
    if (!isRecord(s)) continue;
    const lines = Array.isArray(s.lines) ? s.lines : [];
    await tx.quote.create({
      data: {
        id: String(s.id),
        organizationId: orgId,
        customerId: s.customerId != null ? String(s.customerId) : null,
        userId: String(s.userId),
        quoteNumber: s.quoteNumber != null ? String(s.quoteNumber) : null,
        status: String(s.status ?? "BORRADOR"),
        validUntil: s.validUntil ? d(s.validUntil) : null,
        subtotal: Number(s.subtotal) || 0,
        tax: Number(s.tax) || 0,
        total: Number(s.total) || 0,
        notes: s.notes != null ? String(s.notes) : null,
        serviceLabel: s.serviceLabel != null ? String(s.serviceLabel) : null,
        lines: {
          create: lines
            .filter(isRecord)
            .map((l) => ({
              id: String(l.id),
              productId: String(l.productId),
              qty: Number(l.qty) || 0,
              unitPrice: Number(l.unitPrice) || 0,
              taxPercent: Number(l.taxPercent) || 0,
              lineTotal: Number(l.lineTotal) || 0,
            })),
        },
      },
    });
  }

  const orders = Array.isArray(payload.orders) ? payload.orders : [];
  for (const s of orders) {
    if (!isRecord(s)) continue;
    const lines = Array.isArray(s.lines) ? s.lines : [];
    await tx.supplierOrder.create({
      data: {
        id: String(s.id),
        organizationId: orgId,
        supplierId: s.supplierId != null ? String(s.supplierId) : null,
        userId: String(s.userId),
        orderNumber: s.orderNumber != null ? String(s.orderNumber) : null,
        status: String(s.status ?? "PENDIENTE"),
        expectedDate: s.expectedDate ? d(s.expectedDate) : null,
        notes: s.notes != null ? String(s.notes) : null,
        lines: {
          create: lines
            .filter(isRecord)
            .map((l) => ({
              id: String(l.id),
              productId: String(l.productId),
              qty: Number(l.qty) || 0,
              unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
              notes: l.notes != null ? String(l.notes) : null,
            })),
        },
      },
    });
  }

  const transfers = Array.isArray(payload.stockTransfers) ? payload.stockTransfers : [];
  for (const s of transfers) {
    if (!isRecord(s)) continue;
    const lines = Array.isArray(s.lines) ? s.lines : [];
    await tx.stockTransfer.create({
      data: {
        id: String(s.id),
        organizationId: orgId,
        userId: String(s.userId),
        transferNumber: s.transferNumber != null ? String(s.transferNumber) : null,
        fromLocationId: String(s.fromLocationId),
        toLocationId: String(s.toLocationId),
        status: String(s.status ?? "BORRADOR"),
        notes: s.notes != null ? String(s.notes) : null,
        sentAt: s.sentAt ? d(s.sentAt) : null,
        receivedAt: s.receivedAt ? d(s.receivedAt) : null,
        lines: {
          create: lines
            .filter(isRecord)
            .map((l) => ({
              id: String(l.id),
              productId: String(l.productId),
              qty: Number(l.qty) || 0,
            })),
        },
      },
    });
  }

  const adjs = Array.isArray(payload.stockAdjustments) ? payload.stockAdjustments : [];
  for (const s of adjs) {
    if (!isRecord(s)) continue;
    const lines = Array.isArray(s.lines) ? s.lines : [];
    await tx.stockAdjustment.create({
      data: {
        id: String(s.id),
        organizationId: orgId,
        userId: String(s.userId),
        adjustmentNumber: s.adjustmentNumber != null ? String(s.adjustmentNumber) : null,
        reason: String(s.reason ?? ""),
        notes: s.notes != null ? String(s.notes) : null,
        lines: {
          create: lines
            .filter(isRecord)
            .map((l) => ({
              id: String(l.id),
              productId: String(l.productId),
              qtyDelta: Number(l.qtyDelta) || 0,
            })),
        },
      },
    });
  }

  const exps = Array.isArray(payload.expenses) ? payload.expenses : [];
  for (const r of exps) {
    if (!isRecord(r)) continue;
    await tx.expense.create({
      data: {
        id: String(r.id),
        organizationId: orgId,
        userId: String(r.userId),
        bookId: r.bookId != null ? String(r.bookId) : null,
        categoryId: r.categoryId != null ? String(r.categoryId) : null,
        category: String(r.category ?? ""),
        amount: Number(r.amount) || 0,
        expenseDate: r.expenseDate ? d(r.expenseDate) : new Date(),
        notes: r.notes != null ? String(r.notes) : null,
      },
    });
  }
}

export async function replaceFullOrganizationFromBackup(
  prisma: PrismaClient,
  orgId: string,
  payload: unknown
): Promise<void> {
  if (!isRecord(payload)) throw new Error("INVALID_BACKUP");
  await prisma.$transaction(
    async (tx) => {
      await wipeOrganizationData(tx, orgId);
      await restoreOrganizationFromBackupPayload(tx, orgId, payload);
    },
    { maxWait: 30_000, timeout: 120_000 }
  );
}
