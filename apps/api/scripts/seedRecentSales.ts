import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function keyForDay(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function countForDay(dayIndex: number) {
  return 25 + ((dayIndex * 11 + 7) % 26);
}

function splitTaxIncluded(gross: number, taxPercent: number) {
  if (taxPercent <= 0) return { subtotal: gross, tax: 0 };
  const tax = gross * (taxPercent / (100 + taxPercent));
  return { subtotal: gross - tax, tax };
}

async function main() {
  const today = startOfDay(new Date());
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const days: Date[] = [];
  for (let cursor = new Date(firstDay); cursor <= today; cursor = new Date(cursor.getTime() + DAY)) {
    days.push(new Date(cursor));
  }

  const org = await prisma.organization.findUnique({ where: { slug: "demo" } });
  if (!org) throw new Error("No existe la organización demo. Ejecute primero npm run db:seed.");
  const [branch, device, users, customers, products] = await Promise.all([
    prisma.branch.findFirst({ where: { organizationId: org.id, isDefault: true } }),
    prisma.device.findFirst({ where: { organizationId: org.id, active: true } }),
    prisma.user.findMany({ where: { organizationId: org.id, active: true }, orderBy: { username: "asc" } }),
    prisma.customer.findMany({ where: { organizationId: org.id }, orderBy: { code: "asc" } }),
    prisma.product.findMany({
      where: { organizationId: org.id, active: true, productType: { in: ["PRODUCTO", "SERVICIO"] } },
      orderBy: { sku: "asc" },
    }),
  ]);
  if (!branch || !device || !users.length || !customers.length || !products.length) {
    throw new Error("Faltan sucursal, dispositivo, usuarios, clientes o productos de demostración.");
  }

  let created = 0;
  let skipped = 0;
  for (const [dayIndex, day] of days.entries()) {
    const count = countForDay(dayIndex);
    for (let saleIndex = 1; saleIndex <= count; saleIndex++) {
      const invoiceNumber = `DEMO-HIST-${keyForDay(day)}-${String(saleIndex).padStart(2, "0")}`;
      const exists = await prisma.sale.findFirst({ where: { organizationId: org.id, invoiceNumber } });
      if (exists) {
        skipped++;
        continue;
      }

      const product = products[(dayIndex * 17 + saleIndex * 7) % products.length];
      const user = users[(dayIndex + saleIndex) % users.length];
      const customer = customers[(dayIndex * 5 + saleIndex * 3) % customers.length];
      const terms = ["CONTADO", "EFECTIVO", "TARJETA", "CREDITO"][saleIndex % 4];
      const qty = product.productType === "SERVICIO" ? 1 : 1 + ((dayIndex + saleIndex) % 2);
      const lineTotal = product.price * qty;
      const amounts = splitTaxIncluded(lineTotal, product.taxPercent);
      const saleDate = new Date(day);
      saleDate.setHours(8 + ((saleIndex * 23) % 11), (saleIndex * 13) % 60, 0, 0);
      const paid = terms === "CREDITO" ? 0 : lineTotal;

      await prisma.$transaction(async (tx) => {
        await tx.sale.create({
          data: {
            organizationId: org.id,
            branchId: branch.id,
            deviceId: device.id,
            originDeviceId: device.id,
            invoiceNumber,
            customerId: customer.id,
            userId: user.id,
            sellerName: user.displayName,
            terms,
            priceTier: 1,
            subtotal: amounts.subtotal,
            tax: amounts.tax,
            total: lineTotal,
            paid,
            saleDate,
            dueDate: terms === "CREDITO" ? new Date(saleDate.getTime() + 30 * DAY) : null,
            notes: "demo-history-seed",
            lines: {
              create: {
                productId: product.id,
                qty,
                unitPrice: product.price,
                taxPercent: product.taxPercent,
                lineTotal,
              },
            },
          },
        });
        if (product.productType === "PRODUCTO") {
          await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: qty } } });
        }
      });
      created++;
    }
  }

  console.log(`Historial reciente listo: ${created} ventas creadas, ${skipped} existentes, ${days.length} días.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
