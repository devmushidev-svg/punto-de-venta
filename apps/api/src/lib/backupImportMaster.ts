import type { PrismaClient } from "@prisma/client";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** Importa solo datos maestros desde un JSON de respaldo (merge por claves naturales). No borra ventas ni documentos. */
export async function mergeMasterFromBackup(
  prisma: PrismaClient,
  orgId: string,
  payload: unknown
): Promise<{
  products: number;
  customers: number;
  suppliers: number;
  stockLocations: number;
  expenseBooks: number;
}> {
  if (!isRecord(payload)) throw new Error("INVALID_BACKUP");

  let products = 0;
  let customers = 0;
  let suppliers = 0;
  let stockLocations = 0;
  let expenseBooks = 0;

  if (Array.isArray(payload.stockLocations)) {
    for (const raw of payload.stockLocations) {
      if (!isRecord(raw)) continue;
      const code = String(raw.code ?? "").trim();
      const name = String(raw.name ?? "").trim();
      if (!code || !name) continue;
      await prisma.stockLocation.upsert({
        where: { organizationId_code: { organizationId: orgId, code } },
        create: {
          organizationId: orgId,
          code,
          name,
          active: raw.active !== false,
          sortOrder: Number(raw.sortOrder) || 0,
        },
        update: {
          name,
          active: raw.active !== false,
          sortOrder: Number(raw.sortOrder) || 0,
        },
      });
      stockLocations++;
    }
  }

  if (Array.isArray(payload.suppliers)) {
    for (const raw of payload.suppliers) {
      if (!isRecord(raw)) continue;
      const name = String(raw.name ?? "").trim();
      if (!name) continue;
      const row = await prisma.supplier.findFirst({ where: { organizationId: orgId, name } });
      const data = {
        name,
        phone: raw.phone != null ? String(raw.phone) : null,
        email: raw.email != null ? String(raw.email) : null,
        taxId: raw.taxId != null ? String(raw.taxId) : null,
        address: raw.address != null ? String(raw.address) : null,
      };
      if (row) {
        await prisma.supplier.update({
          where: { id: row.id },
          data,
        });
      } else {
        await prisma.supplier.create({ data: { organizationId: orgId, ...data } });
      }
      suppliers++;
    }
  }

  if (Array.isArray(payload.customers)) {
    for (const raw of payload.customers) {
      if (!isRecord(raw)) continue;
      const code = String(raw.code ?? "0").trim() || "0";
      const name = String(raw.name ?? "").trim();
      if (!name) continue;
      const tierRaw = raw.defaultPriceTier;
      const defaultPriceTier =
        tierRaw == null
          ? null
          : Math.min(4, Math.max(1, Math.trunc(Number(tierRaw)))) || null;
      const custRow = await prisma.customer.findFirst({
        where: { organizationId: orgId, code },
      });
      const custData = {
        name,
        address: raw.address != null ? String(raw.address) : null,
        phone: raw.phone != null ? String(raw.phone) : null,
        taxId: raw.taxId != null ? String(raw.taxId) : null,
        notes: raw.notes != null ? String(raw.notes) : null,
        defaultPriceTier,
      };
      if (custRow) {
        await prisma.customer.update({
          where: { id: custRow.id },
          data: custData,
        });
      } else {
        await prisma.customer.create({
          data: { organizationId: orgId, code, ...custData },
        });
      }
      customers++;
    }
  }

  if (Array.isArray(payload.products)) {
    for (const raw of payload.products) {
      if (!isRecord(raw)) continue;
      const sku = String(raw.sku ?? "").trim();
      const name = String(raw.name ?? "").trim();
      if (!sku || !name) continue;
      const productType = String(raw.productType ?? "PRODUCTO").toUpperCase();
      const vol = raw.volumePricesJson;
      const volumePricesJson =
        typeof vol === "string"
          ? vol
          : vol != null
            ? JSON.stringify(vol)
            : undefined;
      await prisma.product.upsert({
        where: { organizationId_sku: { organizationId: orgId, sku } },
        create: {
          organizationId: orgId,
          sku,
          name,
          description: raw.description != null ? String(raw.description) : null,
          unit: String(raw.unit ?? "UND"),
          price: Number(raw.price) || 0,
          price2: raw.price2 != null ? Number(raw.price2) : null,
          price3: raw.price3 != null ? Number(raw.price3) : null,
          price4: raw.price4 != null ? Number(raw.price4) : null,
          cost: Number(raw.cost) || 0,
          taxPercent: Number(raw.taxPercent) || 0,
          taxName: String(raw.taxName ?? "ISV"),
          stock: Number(raw.stock) || 0,
          minStock: Number(raw.minStock) || 0,
          category: raw.category != null ? String(raw.category) : null,
          barcode: raw.barcode != null ? String(raw.barcode) : null,
          quickCode: raw.quickCode != null ? String(raw.quickCode) : null,
          location: raw.location != null ? String(raw.location) : null,
          brand: raw.brand != null ? String(raw.brand) : null,
          imageUrl: raw.imageUrl != null ? String(raw.imageUrl) : null,
          productType: ["PRODUCTO", "SERVICIO", "INSUMO", "KIT"].includes(productType) ? productType : "PRODUCTO",
          esGranel: Boolean(raw.esGranel),
          active: raw.active !== false,
          volumePricesJson,
          printOnKitchenOrder: Boolean(raw.printOnKitchenOrder),
          supplierId: null,
        },
        update: {
          name,
          description: raw.description != null ? String(raw.description) : null,
          unit: String(raw.unit ?? "UND"),
          price: Number(raw.price) || 0,
          price2: raw.price2 != null ? Number(raw.price2) : null,
          price3: raw.price3 != null ? Number(raw.price3) : null,
          price4: raw.price4 != null ? Number(raw.price4) : null,
          cost: Number(raw.cost) || 0,
          taxPercent: Number(raw.taxPercent) || 0,
          taxName: String(raw.taxName ?? "ISV"),
          stock: Number(raw.stock) || 0,
          minStock: Number(raw.minStock) || 0,
          category: raw.category != null ? String(raw.category) : null,
          barcode: raw.barcode != null ? String(raw.barcode) : null,
          quickCode: raw.quickCode != null ? String(raw.quickCode) : null,
          location: raw.location != null ? String(raw.location) : null,
          brand: raw.brand != null ? String(raw.brand) : null,
          imageUrl: raw.imageUrl != null ? String(raw.imageUrl) : null,
          productType: ["PRODUCTO", "SERVICIO", "INSUMO", "KIT"].includes(productType) ? productType : "PRODUCTO",
          esGranel: Boolean(raw.esGranel),
          active: raw.active !== false,
          ...(volumePricesJson != null ? { volumePricesJson } : {}),
          printOnKitchenOrder: Boolean(raw.printOnKitchenOrder),
        },
      });
      products++;
    }
  }

  if (Array.isArray(payload.expenseBooks)) {
    for (const raw of payload.expenseBooks) {
      if (!isRecord(raw)) continue;
      const bookName = String(raw.name ?? "").trim();
      if (!bookName) continue;
      let book = await prisma.expenseBook.findFirst({
        where: { organizationId: orgId, name: bookName },
      });
      if (!book) {
        book = await prisma.expenseBook.create({
          data: {
            organizationId: orgId,
            name: bookName,
            sortOrder: Number(raw.sortOrder) || 0,
          },
        });
      } else {
        await prisma.expenseBook.update({
          where: { id: book.id },
          data: { sortOrder: Number(raw.sortOrder) || 0 },
        });
      }
      expenseBooks++;
      const cats = raw.categories;
      if (Array.isArray(cats)) {
        for (const cRaw of cats) {
          if (!isRecord(cRaw)) continue;
          const cname = String(cRaw.name ?? "").trim();
          if (!cname) continue;
          const exist = await prisma.expenseCategory.findFirst({
            where: { bookId: book.id, name: cname },
          });
          if (!exist) {
            await prisma.expenseCategory.create({
              data: {
                bookId: book.id,
                name: cname,
                sortOrder: Number(cRaw.sortOrder) || 0,
              },
            });
          }
        }
      }
    }
  }

  return { products, customers, suppliers, stockLocations, expenseBooks };
}
