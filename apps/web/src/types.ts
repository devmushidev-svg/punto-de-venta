export type ProductSupplier = { id: string; name: string };

export type ProductKitLine = {
  id: string;
  kitProductId: string;
  componentProductId: string;
  qty: number;
  component: { id: string; sku: string; name: string; stock: number; unit: string };
};

export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unit: string;
  price: number;
  price2: number | null;
  price3: number | null;
  price4: number | null;
  /** JSON: [{ minQty, price }] — precios por volumen */
  volumePricesJson?: string | null;
  cost: number;
  taxPercent: number;
  taxName: string;
  stock: number;
  minStock: number;
  category: string | null;
  barcode: string | null;
  quickCode: string | null;
  location: string | null;
  brand: string | null;
  imageUrl: string | null;
  productType: string;
  esGranel?: boolean;
  supplierId: string | null;
  supplier?: ProductSupplier | null;
  active: boolean;
  kitLines?: ProductKitLine[];
  printOnKitchenOrder?: boolean;
};

export type Customer = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  taxId: string | null;
  notes: string | null;
  defaultPriceTier?: number | null;
};

export type ProductMovement = {
  at: string;
  type: string;
  typeLabel: string;
  qtyDelta: number;
  ref: string;
  detail: string;
  userName: string | null;
};

export type StockAdjustmentRow = {
  id: string;
  adjustmentNumber: string | null;
  reason: string;
  notes: string | null;
  createdAt: string;
  user: { id: string; displayName: string; username: string };
  lines: { id: string; qtyDelta: number; product: { id: string; sku: string; name: string } }[];
};

export type StockLocation = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  sortOrder: number;
};

export type StockTransferRow = {
  id: string;
  transferNumber: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
  sentAt: string | null;
  receivedAt: string | null;
  fromLocation: StockLocation;
  toLocation: StockLocation;
  user: { id: string; displayName: string; username: string };
  lines: { id: string; qty: number; product: Product }[];
};

export type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  address: string | null;
};

export type SaleUser = {
  id: string;
  displayName: string;
  username: string;
};

export type SaleLine = {
  id: string;
  qty: number;
  unitPrice: number;
  discountPercent: number;
  taxPercent: number;
  lineTotal: number;
  product: Product;
};

export type Sale = {
  id: string;
  invoiceNumber: string | null;
  terms: string;
  priceTier?: number;
  subtotal: number;
  tax: number;
  discount?: number;
  total: number;
  paid: number;
  saleDate: string;
  dueDate?: string | null;
   notes?: string | null;
  sellerName?: string | null;
  customer: Customer | null;
  user?: SaleUser | null;
  lines: SaleLine[];
};

export type EmployeeRow = {
  id: string;
  employeeCode: string | null;
  name: string;
  idDocument: string | null;
  phone: string | null;
  email: string | null;
  position: string | null;
  hireDate: string | null;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseRow = {
  id: string;
  category: string;
  amount: number;
  expenseDate: string;
  notes: string | null;
  createdAt: string;
  user: SaleUser;
  book?: { id: string; name: string } | null;
  expenseCategory?: { id: string; name: string } | null;
};

export type PayrollPeriodListRow = {
  id: string;
  year: number;
  month: number;
  status: string;
  notes: string | null;
  createdAt: string;
  user: SaleUser;
  _count: { lines: number };
};

export type PayrollLineDeductionRow = {
  id: string;
  concept: string;
  amount: number;
  sortOrder: number;
};

export type PayrollLineRow = {
  id: string;
  gross: number;
  deductions: number;
  net: number;
  notes: string | null;
  employee: { id: string; name: string; employeeCode: string | null };
  deductionItems: PayrollLineDeductionRow[];
};

export type PayrollPeriodDetail = {
  id: string;
  year: number;
  month: number;
  status: string;
  notes: string | null;
  createdAt: string;
  user: SaleUser;
  lines: PayrollLineRow[];
};
