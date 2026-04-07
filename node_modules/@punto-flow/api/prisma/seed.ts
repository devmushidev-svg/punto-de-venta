import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { resolveSalePaid } from "../src/lib/saleTerms.ts";
import {
  CUSTOMERS,
  DEMO_PURCHASES,
  DEMO_QUOTE_NOTES,
  DEMO_SALES,
  PRODUCTS,
  SUPPLIERS,
} from "./seedDemoData.ts";

const prisma = new PrismaClient();

function daysAgoDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(10, 30, 0, 0);
  return d;
}

async function main() {
  const slug = "demo";
  let org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        slug,
        name: "Mi Empresa Demo",
        taxIdType: "RTN",
        country: "HN",
        currency: "HNL",
        currencySymbol: "L",
        language: "es",
        address: "Boulevard Demo 123",
        city: "Tegucigalpa",
        department: "FM",
        phone: "2233-4455",
        email: "contacto@demo.hn",
      },
    });
    await prisma.organizationSettings.create({
      data: { organizationId: org.id },
    });
  }

  const ensureUser = async (username: string, displayName: string, role: string, password: string) => {
    const exists = await prisma.user.findFirst({
      where: { organizationId: org!.id, username },
    });
    if (exists) return exists;
    const passwordHash = await bcrypt.hash(password, 10);
    return prisma.user.create({
      data: {
        organizationId: org!.id,
        username,
        passwordHash,
        displayName,
        role,
      },
    });
  };

  const adminUser = await ensureUser("ADMIN", "Administrador", "admin", "admin");
  const cajeroUser = await ensureUser("CAJERO", "María Cajero", "cajero", "cajero");

  const demoEmployee = await prisma.employee.findFirst({
    where: { organizationId: org.id, employeeCode: "E001" },
  });
  if (!demoEmployee) {
    await prisma.employee.create({
      data: {
        organizationId: org.id,
        employeeCode: "E001",
        name: "Juan Pérez (demo RH)",
        position: "Ventas",
        hireDate: daysAgoDate(400),
        active: true,
        notes: "demo-seed",
      },
    });
  }

  const demoExpense = await prisma.expense.findFirst({
    where: { organizationId: org.id, notes: "demo-seed-gasto" },
  });
  if (!demoExpense) {
    await prisma.expense.create({
      data: {
        organizationId: org.id,
        userId: adminUser.id,
        category: "Oficina / insumos",
        amount: 350,
        expenseDate: daysAgoDate(3),
        notes: "demo-seed-gasto",
      },
    });
  }

  for (const loc of [
    { code: "PRIN", name: "Tienda principal", sortOrder: 0 },
    { code: "BODE", name: "Bodega", sortOrder: 1 },
  ] as const) {
    const ex = await prisma.stockLocation.findFirst({
      where: { organizationId: org.id, code: loc.code },
    });
    if (!ex) {
      await prisma.stockLocation.create({
        data: { organizationId: org.id, code: loc.code, name: loc.name, sortOrder: loc.sortOrder },
      });
    }
  }

  const supplierByName = new Map<string, string>();
  for (const s of SUPPLIERS) {
    let row = await prisma.supplier.findFirst({
      where: { organizationId: org.id, name: s.name },
    });
    if (!row) {
      row = await prisma.supplier.create({
        data: {
          organizationId: org.id,
          name: s.name,
          phone: s.phone,
          email: s.email,
          taxId: s.taxId,
          address: s.address,
        },
      });
    }
    supplierByName.set(s.name, row.id);
  }

  for (const c of CUSTOMERS) {
    const exists = await prisma.customer.findFirst({
      where: { organizationId: org.id, code: c.code },
    });
    if (!exists) {
      await prisma.customer.create({
        data: {
          organizationId: org.id,
          code: c.code,
          name: c.name,
          address: c.address,
          phone: c.phone,
          taxId: c.taxId,
        },
      });
    }
  }

  const productRows = PRODUCTS.map((p) => ({
    organizationId: org.id,
    sku: p.sku,
    name: p.name,
    price: p.price,
    price2: p.price2 ?? null,
    price3: p.price3 ?? null,
    price4: p.price4 ?? null,
    volumePricesJson: p.volumePricesJson ?? "[]",
    cost: p.cost ?? 0,
    taxPercent: p.taxPercent,
    stock: p.stock,
    minStock: p.minStock ?? 0,
    unit: p.unit ?? "UND",
    category: p.category ?? null,
    barcode: p.barcode ?? null,
    quickCode: p.quickCode ?? null,
    location: p.location ?? null,
    productType: p.productType ?? "PRODUCTO",
    esGranel: p.esGranel ?? false,
    supplierId: p.supplierName ? supplierByName.get(p.supplierName) ?? null : null,
    active: true,
  }));

  for (const row of productRows) {
    const exists = await prisma.product.findFirst({
      where: { organizationId: org.id, sku: row.sku },
    });
    if (!exists) await prisma.product.create({ data: row });
  }

  const customerByCode = new Map(
    (await prisma.customer.findMany({ where: { organizationId: org.id } })).map((c) => [c.code, c])
  );
  const productBySku = new Map(
    (await prisma.product.findMany({ where: { organizationId: org.id } })).map((p) => [p.sku, p])
  );

  const kitDemo = productBySku.get("KIT-DEMO-01");
  const kitCoffee = productBySku.get("SEED-014");
  const kitMilk = productBySku.get("SEED-015");
  if (
    kitDemo?.productType === "KIT" &&
    kitCoffee?.productType === "PRODUCTO" &&
    kitMilk?.productType === "PRODUCTO"
  ) {
    const n = await prisma.productKitLine.count({ where: { kitProductId: kitDemo.id } });
    if (n === 0) {
      await prisma.productKitLine.createMany({
        data: [
          { kitProductId: kitDemo.id, componentProductId: kitCoffee.id, qty: 0.25 },
          { kitProductId: kitDemo.id, componentProductId: kitMilk.id, qty: 1 },
        ],
      });
    }
  }

  /* --- Ventas demo (facturas DS-2400xx) --- */
  for (const spec of DEMO_SALES) {
    const exists = await prisma.sale.findFirst({
      where: { organizationId: org.id, invoiceNumber: spec.invoiceNumber },
    });
    if (exists) continue;

    const cust = customerByCode.get(spec.customerCode);
    if (!cust) continue;

    await prisma.$transaction(async (tx) => {
      const linePayload: {
        productId: string;
        qty: number;
        unitPrice: number;
        discountPercent: number;
        taxPercent: number;
        lineTotal: number;
      }[] = [];

      let subtotal = 0;
      let tax = 0;

      for (const L of spec.lines) {
        const prod = await tx.product.findFirst({
          where: { organizationId: org.id, sku: L.sku },
        });
        if (!prod) throw new Error(`Seed: producto ${L.sku} no encontrado`);
        if (prod.productType === "INSUMO") throw new Error(`Seed: no vender insumo ${L.sku} en demo`);

        const discountPercent = L.discountPercent ?? 0;
        const base = L.unitPrice * L.qty * (1 - discountPercent / 100);
        const lineTax = base * (prod.taxPercent / 100);
        const lineTotal = base + lineTax;
        subtotal += base;
        tax += lineTax;
        linePayload.push({
          productId: prod.id,
          qty: L.qty,
          unitPrice: L.unitPrice,
          discountPercent,
          taxPercent: prod.taxPercent,
          lineTotal,
        });
      }

      const total = subtotal + tax;
      const paid =
        spec.paid == null ? resolveSalePaid(total, spec.terms, undefined) : resolveSalePaid(total, spec.terms, spec.paid);

      await tx.sale.create({
        data: {
          organizationId: org.id,
          userId: cajeroUser.id,
          customerId: cust.id,
          invoiceNumber: spec.invoiceNumber,
          terms: spec.terms,
          notes: spec.notes ?? "demo-seed",
          priceTier: 1,
          subtotal,
          tax,
          total,
          paid,
          saleDate: daysAgoDate(spec.daysAgo),
          lines: { create: linePayload },
        },
      });

      for (const line of linePayload) {
        const prod = await tx.product.findUnique({ where: { id: line.productId } });
        if (prod?.productType === "SERVICIO") continue;
        await tx.product.update({
          where: { id: line.productId },
          data: { stock: { decrement: line.qty } },
        });
      }
    });
  }

  /* --- Compras demo --- */
  for (const spec of DEMO_PURCHASES) {
    const exists = await prisma.purchase.findFirst({
      where: { organizationId: org.id, reference: spec.reference },
    });
    if (exists) continue;

    const supId = supplierByName.get(spec.supplierName);
    if (!supId) continue;

    await prisma.$transaction(async (tx) => {
      const linesData: {
        productId: string;
        qty: number;
        unitCost: number;
        taxPercent: number;
        lineTotal: number;
      }[] = [];

      let subtotal = 0;
      let tax = 0;

      for (const L of spec.lines) {
        const prod = await tx.product.findFirst({
          where: { organizationId: org.id, sku: L.sku },
        });
        if (!prod) throw new Error(`Seed compra: ${L.sku}`);
        const base = L.unitCost * L.qty;
        const lineTax = base * (prod.taxPercent / 100);
        const lineTotal = base + lineTax;
        subtotal += base;
        tax += lineTax;
        linesData.push({
          productId: prod.id,
          qty: L.qty,
          unitCost: L.unitCost,
          taxPercent: prod.taxPercent,
          lineTotal,
        });
      }

      const total = subtotal + tax;
      const terms = spec.terms.toUpperCase();
      let paid = spec.paid;
      if (terms === "CONTADO" && paid < total) paid = total;

      await tx.purchase.create({
        data: {
          organizationId: org.id,
          userId: adminUser.id,
          supplierId: supId,
          reference: spec.reference,
          terms,
          subtotal,
          tax,
          total,
          paid,
          purchaseDate: daysAgoDate(spec.daysAgo),
          lines: { create: linesData },
        },
      });

      for (const line of linesData) {
        await tx.product.update({
          where: { id: line.productId },
          data: {
            stock: { increment: line.qty },
            cost: line.unitCost,
          },
        });
      }
    });
  }

  /* --- Cotizaciones demo --- */
  const qProducts = ["SEED-025", "SEED-026", "SEED-013"].map((sku) => productBySku.get(sku)).filter(Boolean) as {
    id: string;
    taxPercent: number;
    price: number;
  }[];

  for (let i = 0; i < DEMO_QUOTE_NOTES.length; i++) {
    const note = DEMO_QUOTE_NOTES[i];
    const exists = await prisma.quote.findFirst({
      where: { organizationId: org.id, notes: note },
    });
    if (exists) continue;

    const cust = customerByCode.get(`C00${i + 1}` as string) ?? customerByCode.get("0");
    if (!cust || !qProducts[i]) continue;

    const p = qProducts[i];
    const qty = i === 0 ? 2 : i === 1 ? 5 : 12;
    const unitPrice = p.price;
    const base = unitPrice * qty;
    const lineTax = base * (p.taxPercent / 100);
    const lineTotal = base + lineTax;

    await prisma.quote.create({
      data: {
        organizationId: org.id,
        userId: adminUser.id,
        customerId: cust.id,
        quoteNumber: `SEED-Q-${String(i + 1).padStart(2, "0")}`,
        status: "BORRADOR",
        subtotal: base,
        tax: lineTax,
        total: lineTotal,
        notes: note,
        lines: {
          create: [
            {
              productId: p.id,
              qty,
              unitPrice,
              taxPercent: p.taxPercent,
              lineTotal,
            },
          ],
        },
      },
    });
  }

  /* --- Pedidos a proveedor --- */
  const soSpecs = [
    { num: "SEED-SO-01", supplier: "Importadora del Norte", sku: "SEED-030", qty: 24 },
    { num: "SEED-SO-02", supplier: "Papelera Industrial", sku: "SEED-034", qty: 60 },
  ] as const;

  for (const so of soSpecs) {
    const exists = await prisma.supplierOrder.findFirst({
      where: { organizationId: org.id, orderNumber: so.num },
    });
    if (exists) continue;
    const supId = supplierByName.get(so.supplier);
    const pr = productBySku.get(so.sku);
    if (!supId || !pr) continue;

    await prisma.supplierOrder.create({
      data: {
        organizationId: org.id,
        supplierId: supId,
        userId: adminUser.id,
        orderNumber: so.num,
        status: "PENDIENTE",
        notes: "demo-seed",
        lines: {
          create: [{ productId: pr.id, qty: so.qty, unitPrice: pr.price * 0.85 }],
        },
      },
    });
  }

  /* --- Turnos de caja cerrados --- */
  const cashMarkers = ["demo-seed-cash-1", "demo-seed-cash-2", "demo-seed-cash-3"];
  for (let i = 0; i < cashMarkers.length; i++) {
    const notes = cashMarkers[i];
    const exists = await prisma.cashSession.findFirst({
      where: { organizationId: org.id, notes },
    });
    if (exists) continue;

    const opened = daysAgoDate(20 - i * 5);
    const closed = new Date(opened);
    closed.setHours(18, 0, 0, 0);
    const opening = 500 + i * 100;
    const expected = opening + 1200 + i * 200;
    const closing = expected - 15;

    await prisma.cashSession.create({
      data: {
        organizationId: org.id,
        userId: cajeroUser.id,
        openedAt: opened,
        closedAt: closed,
        openingCash: opening,
        closingCash: closing,
        expectedCash: expected,
        notes,
      },
    });
  }

  /* --- Favoritos táctil (si aún vacío) --- */
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId: org.id },
  });
  if (settings) {
    let general: Record<string, unknown> = {};
    try {
      general = JSON.parse(settings.generalJson || "{}") as Record<string, unknown>;
    } catch {
      general = {};
    }
    const favs = general.touchFavoriteProductIds;
    if (!Array.isArray(favs) || favs.length === 0) {
      const favSkus = ["SEED-023", "SEED-010", "SEED-025", "SEED-029", "001"];
      const ids = favSkus
        .map((sku) => productBySku.get(sku)?.id)
        .filter((x): x is string => Boolean(x));
      general.touchFavoriteProductIds = ids;
      await prisma.organizationSettings.update({
        where: { organizationId: org.id },
        data: { generalJson: JSON.stringify(general) },
      });
    }
  }

  console.log(
    "Seed OK | Org: demo | ADMIN/admin | CAJERO/cajero | P4: empleado E001 + gasto demo | Productos, ventas, compras, caja."
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
