/** Catálogo y transacciones de demostración (idempotentes por claves estables). */

export type SupplierSeed = { name: string; phone?: string; email?: string; taxId?: string; address?: string };

export type CustomerSeed = {
  code: string;
  name: string;
  address?: string;
  phone?: string;
  taxId?: string;
};

export type ProductSeed = {
  sku: string;
  name: string;
  price: number;
  price2?: number;
  price3?: number;
  taxPercent: number;
  stock: number;
  unit?: string;
  category?: string;
  barcode?: string;
  quickCode?: string;
  location?: string;
  productType?: string;
  esGranel?: boolean;
  cost?: number;
  minStock?: number;
  supplierName?: string;
  price4?: number;
  /** JSON string o se serializa desde tramos en seed */
  volumePricesJson?: string;
};

export type DemoSaleLine = {
  sku: string;
  qty: number;
  unitPrice: number;
  discountPercent?: number;
};

export type DemoSaleSeed = {
  invoiceNumber: string;
  terms: string;
  /** Si es `null`, se usa el total (contado / pago completo según términos). */
  paid: number | null;
  daysAgo: number;
  customerCode: string;
  notes?: string;
  lines: DemoSaleLine[];
};

export type DemoPurchaseSeed = {
  reference: string;
  supplierName: string;
  daysAgo: number;
  paid: number;
  terms: string;
  lines: { sku: string; qty: number; unitCost: number }[];
};

export const SUPPLIERS: SupplierSeed[] = [
  { name: "Distribuidora Centro S.A.", phone: "2234-1100", email: "ventas@centro.hn", taxId: "08019901234567" },
  { name: "Importadora del Norte", phone: "2512-8899", taxId: "08018807654321" },
  { name: "Abarrotes La Economía", phone: "2788-4411" },
  { name: "Papelera Industrial", phone: "2233-2200", email: "pedidos@papelera.hn" },
  { name: "Proveedor Demo", phone: "0000-0000" },
  { name: "TechMayoristas HN", phone: "3399-1200", taxId: "08015501020304" },
];

export const CUSTOMERS: CustomerSeed[] = [
  { code: "0", name: "CONSUMIDOR FINAL" },
  { code: "C001", name: "Ferretería El Tornillo", address: "Col. Kennedy", phone: "9999-1001", taxId: "08019901112233" },
  { code: "C002", name: "Cafetería La Molienda", address: "Centro", phone: "9999-1002" },
  { code: "C003", name: "Farmacia San José", address: "Boulevard Morazán", phone: "9999-1003", taxId: "08019904445556" },
  { code: "C004", name: "Taller Mecánico Rápido", phone: "9999-1004" },
  { code: "C005", name: "Instituto Educativo Beta", address: "Zona 5", phone: "9999-1005", taxId: "08019907778889" },
  { code: "C006", name: "Boutique Mar Azul", phone: "9999-1006" },
  { code: "C007", name: "Restaurante El Sazón", address: "Col. Palmira", phone: "9999-1007" },
  { code: "C008", name: "Constructora Omega", taxId: "08019909990001", phone: "9999-1008" },
  { code: "C009", name: "Mini Súper 3 Estrellas", phone: "9999-1009" },
  { code: "C010", name: "Clínica Dental Sonrisa", phone: "9999-1010" },
  { code: "C011", name: "Hotel Vista Verde", address: "Lago", phone: "9999-1011", taxId: "08019901230099" },
  { code: "C012", name: "Pulpería Don Tito", phone: "9999-1012" },
];

const cat = (c: string) => c;

export const PRODUCTS: ProductSeed[] = [
  { sku: "001", name: "Producto de ejemplo", price: 100, taxPercent: 15, stock: 200, unit: "UNIDAD", category: cat("GENERAL"), barcode: "7501234567890", quickCode: "P01", location: "A-01", supplierName: "Proveedor Demo", productType: "PRODUCTO", cost: 65 },
  { sku: "002", name: "Otro producto", price: 50, price2: 48, taxPercent: 15, stock: 150, unit: "UNIDAD", category: cat("GENERAL"), location: "A-02", cost: 30 },
  { sku: "SERV01", name: "Servicio de instalación", price: 200, taxPercent: 15, stock: 0, unit: "UND", category: cat("SERVICIOS"), productType: "SERVICIO", cost: 0 },
  { sku: "INS01", name: "Insumo interno", price: 10, taxPercent: 15, stock: 800, unit: "UND", category: cat("INSUMOS"), productType: "INSUMO", cost: 4 },
  { sku: "SEED-010", name: "Arroz 1 lb", price: 28, taxPercent: 15, stock: 400, unit: "LB", category: cat("Abarrotes"), barcode: "7401001000010", location: "B-01", supplierName: "Abarrotes La Economía", cost: 18, esGranel: true, minStock: 50 },
  { sku: "SEED-011", name: "Frijoles negros 1 lb", price: 35, taxPercent: 15, stock: 320, unit: "LB", category: cat("Abarrotes"), location: "B-01", supplierName: "Abarrotes La Economía", cost: 22, esGranel: true },
  { sku: "SEED-012", name: "Azúcar 1 lb", price: 22, taxPercent: 15, stock: 500, unit: "LB", category: cat("Abarrotes"), location: "B-02", supplierName: "Abarrotes La Economía", cost: 14, esGranel: true },
  { sku: "SEED-013", name: "Aceite 946 ml", price: 95, taxPercent: 15, stock: 180, unit: "BOT", category: cat("Abarrotes"), location: "B-03", supplierName: "Distribuidora Centro S.A.", cost: 62 },
  { sku: "SEED-014", name: "Café molido 1 lb", price: 120, taxPercent: 15, stock: 90, unit: "LB", category: cat("Abarrotes"), location: "B-04", supplierName: "Importadora del Norte", cost: 78, esGranel: true },
  { sku: "SEED-015", name: "Leche evaporada lata", price: 28, taxPercent: 15, stock: 240, unit: "UND", category: cat("Lácteos"), location: "C-01", supplierName: "Distribuidora Centro S.A.", cost: 17 },
  { sku: "SEED-016", name: "Papel higiénico 4 rollos", price: 55, taxPercent: 15, stock: 120, unit: "PAQ", category: cat("Hogar"), location: "D-01", supplierName: "Papelera Industrial", cost: 36 },
  { sku: "SEED-017", name: "Detergente 1L", price: 72, taxPercent: 15, stock: 100, unit: "UND", category: cat("Limpieza"), location: "D-02", supplierName: "Distribuidora Centro S.A.", cost: 48 },
  { sku: "SEED-018", name: "Cloro 1 galón", price: 45, taxPercent: 15, stock: 85, unit: "GAL", category: cat("Limpieza"), location: "D-02", supplierName: "Distribuidora Centro S.A.", cost: 28 },
  { sku: "SEED-019", name: "Jabón en barra 3 pk", price: 38, taxPercent: 15, stock: 200, unit: "PAQ", category: cat("Higiene"), location: "D-03", supplierName: "Abarrotes La Economía", cost: 22 },
  { sku: "SEED-020", name: "Pasta dental 100g", price: 42, taxPercent: 15, stock: 160, unit: "UND", category: cat("Higiene"), location: "D-03", supplierName: "Importadora del Norte", cost: 26 },
  { sku: "SEED-021", name: "Shampoo 400ml", price: 88, taxPercent: 15, stock: 75, unit: "UND", category: cat("Higiene"), location: "D-04", supplierName: "Importadora del Norte", cost: 55 },
  { sku: "SEED-022", name: "Galletas surtidas 400g", price: 48, taxPercent: 15, stock: 130, unit: "PAQ", category: cat("Snacks"), location: "E-01", supplierName: "Distribuidora Centro S.A.", cost: 30 },
  {
    sku: "SEED-023",
    name: "Refresco 2L",
    price: 35,
    taxPercent: 15,
    stock: 220,
    unit: "UND",
    category: cat("Bebidas"),
    location: "E-02",
    supplierName: "Distribuidora Centro S.A.",
    cost: 22,
    volumePricesJson: JSON.stringify([
      { minQty: 6, price: 32 },
      { minQty: 12, price: 30 },
    ]),
  },
  { sku: "SEED-024", name: "Agua pura 1 galón", price: 32, taxPercent: 15, stock: 300, unit: "UND", category: cat("Bebidas"), location: "E-02", supplierName: "Abarrotes La Economía", cost: 18 },
  { sku: "SEED-025", name: "Cable HDMI 2m", price: 185, price2: 175, price3: 165, taxPercent: 15, stock: 45, unit: "UND", category: cat("Electrónica"), location: "F-01", supplierName: "TechMayoristas HN", cost: 95, quickCode: "HDMI2" },
  { sku: "SEED-026", name: "Mouse USB óptico", price: 120, taxPercent: 15, stock: 60, unit: "UND", category: cat("Electrónica"), location: "F-01", supplierName: "TechMayoristas HN", cost: 68 },
  { sku: "SEED-027", name: "Teclado multimedia", price: 265, taxPercent: 15, stock: 35, unit: "UND", category: cat("Electrónica"), location: "F-02", supplierName: "TechMayoristas HN", cost: 155 },
  { sku: "SEED-028", name: "Extensión eléctrica 6 tomas", price: 195, taxPercent: 15, stock: 40, unit: "UND", category: cat("Ferretería"), location: "G-01", supplierName: "Importadora del Norte", cost: 110 },
  { sku: "SEED-029", name: "Bombillo LED 9W", price: 55, taxPercent: 15, stock: 300, unit: "UND", category: cat("Ferretería"), location: "G-02", supplierName: "Distribuidora Centro S.A.", cost: 28 },
  { sku: "SEED-030", name: "Cinta métrica 5m", price: 75, taxPercent: 15, stock: 55, unit: "UND", category: cat("Ferretería"), location: "G-03", supplierName: "Importadora del Norte", cost: 40 },
  { sku: "SEED-031", name: "Martillo 16oz", price: 145, taxPercent: 15, stock: 40, unit: "UND", category: cat("Ferretería"), location: "G-04", supplierName: "Importadora del Norte", cost: 88 },
  { sku: "SEED-032", name: "Destornillador set 6 pzas", price: 95, taxPercent: 15, stock: 50, unit: "SET", category: cat("Ferretería"), location: "G-04", supplierName: "Importadora del Norte", cost: 52 },
  { sku: "SEED-033", name: "Cuaderno cosido 100 hojas", price: 42, taxPercent: 15, stock: 400, unit: "UND", category: cat("Papelería"), location: "H-01", supplierName: "Papelera Industrial", cost: 22 },
  { sku: "SEED-034", name: "Lápiz grafito HB c/12", price: 36, taxPercent: 15, stock: 250, unit: "CAJ", category: cat("Papelería"), location: "H-01", supplierName: "Papelera Industrial", cost: 18 },
  { sku: "SEED-035", name: "Resma papel carta", price: 185, taxPercent: 15, stock: 80, unit: "RES", category: cat("Papelería"), location: "H-02", supplierName: "Papelera Industrial", cost: 125 },
  { sku: "SEED-036", name: "Caja de clips metálicos", price: 28, taxPercent: 15, stock: 150, unit: "UND", category: cat("Papelería"), location: "H-02", supplierName: "Papelera Industrial", cost: 12 },
  { sku: "SEED-037", name: "Servicio armado de mueble", price: 350, taxPercent: 15, stock: 0, unit: "SERV", category: cat("SERVICIOS"), productType: "SERVICIO", cost: 0 },
  { sku: "SEED-038", name: "Servicio mantenimiento A/C", price: 800, taxPercent: 15, stock: 0, unit: "SERV", category: cat("SERVICIOS"), productType: "SERVICIO", cost: 0 },
  { sku: "SEED-039", name: "Insumo empaque burbuja", price: 8, taxPercent: 15, stock: 600, unit: "M", category: cat("INSUMOS"), productType: "INSUMO", cost: 3 },
  { sku: "SEED-040", name: "Insumo etiquetas térmicas", price: 5, taxPercent: 15, stock: 2000, unit: "UND", category: cat("INSUMOS"), productType: "INSUMO", cost: 1.2 },
  {
    sku: "KIT-DEMO-01",
    name: "Combo desayuno (café + leche)",
    price: 145,
    taxPercent: 15,
    stock: 0,
    unit: "COMBO",
    category: cat("Abarrotes"),
    productType: "KIT",
    cost: 0,
  },
  /** Códigos 1…20: mismo número en SKU, código rápido y barras (para caja / lector). */
  ...Array.from({ length: 20 }, (_, i) => {
    const n = i + 1;
    const code = String(n);
    return {
      sku: code,
      name: `Artículo prueba ${code}`,
      price: 5 * n,
      taxPercent: 15,
      stock: 100 + n,
      unit: "UND",
      category: cat("Pruebas"),
      quickCode: code,
      barcode: `999${String(n).padStart(10, "0")}`,
      location: "TST",
      cost: 2 * n,
    } satisfies ProductSeed;
  }),
];

export const DEMO_SALES: DemoSaleSeed[] = [
  { invoiceNumber: "DS-240001", terms: "CONTADO", paid: null, daysAgo: 1, customerCode: "0", lines: [{ sku: "SEED-023", qty: 4, unitPrice: 35 }] },
  { invoiceNumber: "DS-240002", terms: "TARJETA", paid: null, daysAgo: 1, customerCode: "C002", lines: [{ sku: "SEED-014", qty: 2, unitPrice: 120 }] },
  { invoiceNumber: "DS-240003", terms: "30 DIAS", paid: 100, daysAgo: 2, customerCode: "C001", notes: "demo-seed", lines: [{ sku: "SEED-031", qty: 2, unitPrice: 145 }] },
  { invoiceNumber: "DS-240004", terms: "EFECTIVO", paid: null, daysAgo: 2, customerCode: "C007", lines: [{ sku: "SEED-013", qty: 3, unitPrice: 95 }, { sku: "SEED-015", qty: 6, unitPrice: 28 }] },
  { invoiceNumber: "DS-240005", terms: "CONTADO", paid: null, daysAgo: 3, customerCode: "C003", lines: [{ sku: "SEED-020", qty: 10, unitPrice: 42 }] },
  { invoiceNumber: "DS-240006", terms: "CREDITO", paid: 0, daysAgo: 4, customerCode: "C008", lines: [{ sku: "SEED-028", qty: 5, unitPrice: 195 }] },
  { invoiceNumber: "DS-240007", terms: "15 DIAS", paid: 200, daysAgo: 5, customerCode: "C004", lines: [{ sku: "SEED-025", qty: 2, unitPrice: 185 }, { sku: "SERV01", qty: 1, unitPrice: 200 }] },
  { invoiceNumber: "DS-240008", terms: "CONTADO", paid: null, daysAgo: 6, customerCode: "0", lines: [{ sku: "001", qty: 3, unitPrice: 100 }] },
  { invoiceNumber: "DS-240009", terms: "45 DIAS", paid: 0, daysAgo: 7, customerCode: "C011", lines: [{ sku: "SEED-035", qty: 4, unitPrice: 185 }] },
  { invoiceNumber: "DS-240010", terms: "CONTADO", paid: null, daysAgo: 8, customerCode: "C006", lines: [{ sku: "SEED-021", qty: 3, unitPrice: 88 }] },
  { invoiceNumber: "DS-240011", terms: "60 DIAS", paid: 500, daysAgo: 10, customerCode: "C005", lines: [{ sku: "SEED-027", qty: 4, unitPrice: 265 }] },
  { invoiceNumber: "DS-240012", terms: "CONTADO", paid: null, daysAgo: 12, customerCode: "C010", lines: [{ sku: "SEED-037", qty: 1, unitPrice: 350 }, { sku: "SEED-038", qty: 1, unitPrice: 800 }] },
  { invoiceNumber: "DS-240013", terms: "TARJETA", paid: null, daysAgo: 14, customerCode: "C009", lines: [{ sku: "SEED-010", qty: 10, unitPrice: 28 }, { sku: "SEED-012", qty: 8, unitPrice: 22 }] },
  { invoiceNumber: "DS-240014", terms: "CONTADO", paid: null, daysAgo: 18, customerCode: "0", lines: [{ sku: "002", qty: 6, unitPrice: 50 }] },
  { invoiceNumber: "DS-240015", terms: "30 DIAS", paid: 0, daysAgo: 22, customerCode: "C012", lines: [{ sku: "SEED-029", qty: 50, unitPrice: 55 }] },
];

export const DEMO_PURCHASES: DemoPurchaseSeed[] = [
  {
    reference: "SEED-PO-001",
    supplierName: "Distribuidora Centro S.A.",
    daysAgo: 3,
    paid: 0,
    terms: "CREDITO",
    lines: [
      { sku: "SEED-013", qty: 40, unitCost: 50 },
      { sku: "SEED-023", qty: 48, unitCost: 14 },
    ],
  },
  {
    reference: "SEED-PO-002",
    supplierName: "TechMayoristas HN",
    daysAgo: 8,
    paid: 0,
    terms: "30 DIAS",
    lines: [
      { sku: "SEED-025", qty: 20, unitCost: 80 },
      { sku: "SEED-026", qty: 30, unitCost: 45 },
    ],
  },
  {
    reference: "SEED-PO-003",
    supplierName: "Papelera Industrial",
    daysAgo: 15,
    paid: 0,
    terms: "CONTADO",
    lines: [
      { sku: "SEED-033", qty: 100, unitCost: 15 },
      { sku: "SEED-035", qty: 25, unitCost: 95 },
    ],
  },
];

export const DEMO_QUOTE_NOTES = ["demo-seed-q1", "demo-seed-q2", "demo-seed-q3"];
