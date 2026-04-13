import ExcelJS from "exceljs";
import type { PrismaClient } from "@prisma/client";

export type ImportTemplateKind = "products" | "customers" | "suppliers";

export async function buildImportTemplateBuffer(kind: ImportTemplateKind): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Datos");
  if (kind === "products") {
    ws.addRow([
      "sku",
      "name",
      "price",
      "cost",
      "stock",
      "minStock",
      "barcode",
      "category",
      "productType",
      "taxPercent",
    ]);
  } else if (kind === "customers") {
    ws.addRow(["code", "name", "phone", "taxId", "address", "defaultPriceTier"]);
  } else {
    ws.addRow(["name", "phone", "email", "taxId", "address"]);
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const PRODUCT_TYPES = new Set(["PRODUCTO", "SERVICIO", "INSUMO", "KIT"]);

function cellStr(row: ExcelJS.Row, col: number): string {
  const v = row.getCell(col).value;
  if (v == null) return "";
  if (typeof v === "object" && v !== null && "text" in v) return String((v as { text: string }).text ?? "").trim();
  return String(v).trim();
}

function cellNum(row: ExcelJS.Row, col: number, def: number): number {
  const v = row.getCell(col).value;
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

async function loadXlsx(wb: ExcelJS.Workbook, data: Uint8Array): Promise<void> {
  await wb.xlsx.load(Buffer.from(data) as never);
}

export async function importProductsFromExcel(
  prisma: PrismaClient,
  orgId: string,
  buffer: Uint8Array
): Promise<{ imported: number; errors: string[] }> {
  const wb = new ExcelJS.Workbook();
  await loadXlsx(wb, buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { imported: 0, errors: ["El archivo no tiene hojas."] };
  const errors: string[] = [];
  let imported = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const sku = cellStr(row, 1);
    const name = cellStr(row, 2);
    if (!sku && !name) continue;
    if (!sku || !name) {
      errors.push(`Fila ${r}: sku y nombre son obligatorios.`);
      continue;
    }
    const price = cellNum(row, 3, 0);
    const cost = cellNum(row, 4, 0);
    const stock = cellNum(row, 5, 0);
    const minStock = cellNum(row, 6, 0);
    const barcode = cellStr(row, 7) || null;
    const category = cellStr(row, 8) || null;
    let productType = cellStr(row, 9).toUpperCase() || "PRODUCTO";
    if (!PRODUCT_TYPES.has(productType)) productType = "PRODUCTO";
    const taxPercent = cellNum(row, 10, 0);
    try {
      await prisma.product.upsert({
        where: { organizationId_sku: { organizationId: orgId, sku } },
        create: {
          organizationId: orgId,
          sku,
          name,
          price,
          cost,
          stock,
          minStock,
          barcode,
          category,
          productType,
          taxPercent,
          unit: "UND",
          taxName: "ISV",
        },
        update: {
          name,
          price,
          cost,
          stock,
          minStock,
          barcode,
          category,
          productType,
          taxPercent,
        },
      });
      imported++;
    } catch (e) {
      errors.push(`Fila ${r}: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  return { imported, errors };
}

export async function importCustomersFromExcel(
  prisma: PrismaClient,
  orgId: string,
  buffer: Uint8Array
): Promise<{ imported: number; errors: string[] }> {
  const wb = new ExcelJS.Workbook();
  await loadXlsx(wb, buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { imported: 0, errors: ["El archivo no tiene hojas."] };
  const errors: string[] = [];
  let imported = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const code = cellStr(row, 1) || "0";
    const name = cellStr(row, 2);
    if (!name) continue;
    const phone = cellStr(row, 3) || null;
    const taxId = cellStr(row, 4) || null;
    const address = cellStr(row, 5) || null;
    const tierRaw = cellNum(row, 6, NaN);
    const defaultPriceTier =
      Number.isFinite(tierRaw) && tierRaw >= 1 && tierRaw <= 4 ? Math.trunc(tierRaw) : null;
    try {
      const existing = await prisma.customer.findFirst({
        where: { organizationId: orgId, code },
      });
      if (existing) {
        await prisma.customer.update({
          where: { id: existing.id },
          data: {
            name,
            phone,
            taxId,
            address,
            ...(defaultPriceTier != null ? { defaultPriceTier } : {}),
          },
        });
      } else {
        await prisma.customer.create({
          data: {
            organizationId: orgId,
            code,
            name,
            phone,
            taxId,
            address,
            defaultPriceTier,
          },
        });
      }
      imported++;
    } catch (e) {
      errors.push(`Fila ${r}: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  return { imported, errors };
}

export async function importSuppliersFromExcel(
  prisma: PrismaClient,
  orgId: string,
  buffer: Uint8Array
): Promise<{ imported: number; errors: string[] }> {
  const wb = new ExcelJS.Workbook();
  await loadXlsx(wb, buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { imported: 0, errors: ["El archivo no tiene hojas."] };
  const errors: string[] = [];
  let imported = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = cellStr(row, 1);
    if (!name) continue;
    const phone = cellStr(row, 2) || null;
    const email = cellStr(row, 3) || null;
    const taxId = cellStr(row, 4) || null;
    const address = cellStr(row, 5) || null;
    try {
      const existing = await prisma.supplier.findFirst({
        where: { organizationId: orgId, name },
      });
      if (existing) {
        await prisma.supplier.update({
          where: { id: existing.id },
          data: { phone, email, taxId, address },
        });
      } else {
        await prisma.supplier.create({
          data: { organizationId: orgId, name, phone, email, taxId, address },
        });
      }
      imported++;
    } catch (e) {
      errors.push(`Fila ${r}: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  return { imported, errors };
}
