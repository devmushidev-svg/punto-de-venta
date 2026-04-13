import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Eraser,
  FileText,
  Pencil,
  Plus,
  Printer,
  Save,
  Search,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useSaleDocumentToolbarSetter } from "../layouts/SaleDocumentToolbarContext";
import { CustomerModal } from "../components/CustomerModal";
import { NewProductModal } from "../components/NewProductModal";
import { Button, Field, Input, Modal, Select } from "../components/ui";
import { formatMoney } from "../lib/format";
import { printSaleTicketInHiddenFrame } from "../lib/ticketPrint";
import { PF_PRODUCT_PICK_CHANNEL, PF_PRODUCT_PICK_TYPE } from "../lib/saleProductPick";
import { isCreditSaleTerm, SALE_TERMS_OPTIONS } from "../lib/saleTerms";
import { defaultQtyForNewLine, tracksStock } from "../lib/saleLineHelpers";
import { resolveProductUnitPrice } from "../lib/volumePrice";
import type { Customer, Product, Sale, Supplier } from "../types";

type Line = {
  lineKey: string;
  productId: string;
  product: Product;
  qty: number;
  unitPrice: number;
  discountPercent: number;
};

type CatalogModalState = { kind: "closed" } | { kind: "new" } | { kind: "edit"; productId: string };

type CustomerCatalogModal = { kind: "closed" } | { kind: "new" } | { kind: "edit" };

const SALE_LINE_FIELDS = ["qty", "price", "disc"] as const;
type SaleLineField = (typeof SALE_LINE_FIELDS)[number];

/** Campos del encabezado para navegar con flechas (cuadrícula visual). */
type SaleHeaderArrowField =
  | "invoice"
  | "terms"
  | "fecha"
  | "customer"
  | "address"
  | "phone"
  | "taxId"
  | "notes"
  | "priceTier"
  | "paid";

type SaleHeaderArrowDest = SaleHeaderArrowField | "quickAdd";

type ArrowDir = "up" | "down" | "left" | "right";

/** Cabecera: en estos campos las flechas siempre cambian de celda (texto suele ser corto). */
const HEADER_ARROW_ALWAYS_LEAVE_FIELD: ReadonlySet<SaleHeaderArrowField> = new Set([
  "notes",
  "address",
  "phone",
  "taxId",
]);

function arrowKeyToDir(key: string): ArrowDir | null {
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  return null;
}

function shouldMoveFromTextInput(el: HTMLInputElement | HTMLTextAreaElement, dir: ArrowDir): boolean {
  if (el.readOnly) return true;
  const v = el.value;
  const s = el.selectionStart;
  const e = el.selectionEnd;
  if (s === null || e === null) return true;
  if (s !== e) return false;
  const p = s;
  switch (dir) {
    case "left":
    case "up":
      return p <= 0;
    case "right":
    case "down":
      return p >= v.length;
    default:
      return false;
  }
}

function headerArrowNeighbor(
  from: SaleHeaderArrowField,
  dir: ArrowDir,
  credit: boolean
): SaleHeaderArrowDest | null {
  switch (from) {
    case "invoice":
      if (dir === "right") return "customer";
      if (dir === "down") return "terms";
      return null;
    case "terms":
      if (dir === "up") return "invoice";
      if (dir === "down") return "fecha";
      if (dir === "right") return "address";
      return null;
    case "fecha":
      if (dir === "up") return "terms";
      if (dir === "right") return "address";
      if (dir === "down") return "quickAdd";
      if (dir === "left") return "invoice";
      return null;
    case "customer":
      if (dir === "left") return "invoice";
      if (dir === "right") return "notes";
      if (dir === "down") return "address";
      if (dir === "up") return "invoice";
      return null;
    case "address":
      if (dir === "left") return "terms";
      if (dir === "right") return "phone";
      if (dir === "up") return "customer";
      if (dir === "down") return "quickAdd";
      return null;
    case "phone":
      if (dir === "left") return "address";
      if (dir === "right") return "taxId";
      if (dir === "up") return "customer";
      if (dir === "down") return "quickAdd";
      return null;
    case "taxId":
      if (dir === "left") return "phone";
      if (dir === "right") return "priceTier";
      if (dir === "up") return "customer";
      if (dir === "down") return "quickAdd";
      return null;
    case "notes":
      /* Izquierda → RTN (columna central); abajo/derecha → lista de precios */
      if (dir === "left") return "taxId";
      if (dir === "right") return "priceTier";
      if (dir === "down") return "priceTier";
      if (dir === "up") return "customer";
      return null;
    case "priceTier":
      if (dir === "left") return "taxId";
      if (dir === "up") return "notes";
      if (dir === "down") return credit ? "paid" : "quickAdd";
      return null;
    case "paid":
      if (dir === "up") return "priceTier";
      if (dir === "left") return "taxId";
      if (dir === "down") return "quickAdd";
      if (dir === "right") return "quickAdd";
      return null;
    default:
      return null;
  }
}

function newLineKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `l-${Date.now()}-${Math.random()}`;
}

function computeLineTotal(l: Line): number {
  const base = l.unitPrice * l.qty * (1 - l.discountPercent / 100);
  return base + base * (l.product.taxPercent / 100);
}


function normProductLookup(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** Valor para input `datetime-local` en hora local. */
function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}

function SaleRibbonTile({
  icon: Icon,
  line1,
  line2,
  onClick,
  disabled,
  title,
  active,
  variant = "default",
}: {
  icon: LucideIcon;
  line1: string;
  line2: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  active?: boolean;
  variant?: "default" | "primary" | "muted" | "danger";
}) {
  const iconBg =
    variant === "primary"
      ? "bg-gradient-to-b from-[color:var(--pf-primary-soft)] to-[color:var(--pf-warning-soft)] text-pf-primary-foreground ring-1 ring-[color:var(--pf-ribbon-active-border)]"
      : variant === "muted"
        ? "bg-gradient-to-b from-[color:var(--pf-surface-soft)] to-[color:var(--pf-surface-muted)] text-pf-text-secondary ring-1 ring-[color:var(--pf-border-soft)]"
        : variant === "danger"
          ? "bg-gradient-to-b from-[color:var(--pf-danger-soft)] to-[color:var(--pf-warning-soft)] text-pf-danger ring-1 ring-[color:var(--pf-danger-soft)]"
          : "pf-ribbon-icon-shell";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`group flex w-[6.25rem] shrink-0 flex-col items-stretch rounded-md border border-transparent p-0.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-pf-primary disabled:pointer-events-none disabled:opacity-45 sm:w-28 ${
        active
          ? "pf-ribbon-tile-active"
          : "pf-ribbon-tile-idle"
      }`}
    >
      <div className="flex flex-1 flex-col items-center gap-1 pb-1 pt-1.5">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-md leading-none shadow-sm ${iconBg} [&>svg]:block [&>svg]:shrink-0`}
        >
          <Icon className="!size-5" strokeWidth={2} aria-hidden />
        </span>
        <span className="w-full px-0.5 text-center text-[10px] font-semibold leading-tight text-pf-text sm:text-[11px]">
          {line1}
        </span>
        <span className="w-full px-0.5 text-center text-[9px] font-medium leading-tight text-pf-text-soft sm:text-[10px]">
          {line2}
        </span>
      </div>
    </button>
  );
}

function SaleRibbonGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pf-ribbon-group flex min-w-0 flex-col pl-2 first:border-l-0 first:pl-0 sm:pl-3">
      <div className="flex flex-row flex-wrap items-stretch gap-0.5 sm:gap-0">
        {children}
      </div>
      <p className="pf-ribbon-group-label mt-0.5 pt-0.5 text-center text-[10px] font-medium uppercase tracking-wide sm:text-[11px]">
        {title}
      </p>
    </div>
  );
}

export function NewSalePage() {
  const setSaleToolbar = useSaleDocumentToolbarSetter();
  const { token, organization, user } = useAuth();
  const admin = user?.role === "admin";
  const { id: editSaleId } = useParams();
  const isEditMode = Boolean(editSaleId);
  const sym = organization?.currencySymbol ?? "L";
  const navigate = useNavigate();
  /** Id del cliente en BD (p. ej. consumidor final); no se muestra lista, solo se usa al guardar. */
  const [customerId, setCustomerId] = useState<string>("");
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerTaxId, setCustomerTaxId] = useState("");
  const [priceTier, setPriceTier] = useState(1);
  const priceTierRef = useRef(priceTier);
  priceTierRef.current = priceTier;
  const [terms, setTerms] = useState("CONTADO");
  const [paid, setPaid] = useState("");
  const [notes, setNotes] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingSale, setLoadingSale] = useState(false);
  const [err, setErr] = useState("");
  /** Solo en edición: número de factura para mostrar en cabecera */
  const [loadedInvoiceNumber, setLoadedInvoiceNumber] = useState<string | null>(null);
  const [quickAddCode, setQuickAddCode] = useState("");
  const [quickAddErr, setQuickAddErr] = useState("");
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const [catalogModal, setCatalogModal] = useState<CatalogModalState>({ kind: "closed" });
  const [pickLineForEditOpen, setPickLineForEditOpen] = useState(false);
  const [customerCatalogModal, setCustomerCatalogModal] = useState<CustomerCatalogModal>({ kind: "closed" });
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [customerPickList, setCustomerPickList] = useState<Customer[]>([]);
  const [customerSearchQ, setCustomerSearchQ] = useState("");
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchQ, setProductSearchQ] = useState("");
  const [productSupplierId, setProductSupplierId] = useState("");
  const [productInStockOnly, setProductInStockOnly] = useState(false);
  const [productSuppliers, setProductSuppliers] = useState<Supplier[]>([]);
  const [productSearchRows, setProductSearchRows] = useState<Product[]>([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [productSearchErr, setProductSearchErr] = useState("");
  const [selectedLineIndex, setSelectedLineIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "print" } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, type: "success" | "print") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutAmountReceived, setCheckoutAmountReceived] = useState("");
  const [checkoutOpts, setCheckoutOpts] = useState<{ destination: "ticket" | "comprobante"; autoPrintTicket?: boolean }>({ destination: "ticket" });
  const checkoutAmountInputRef = useRef<HTMLInputElement | null>(null);
  /** Fecha/hora del documento (nueva venta editable; en editar venta viene del API). */
  const [documentSaleDate, setDocumentSaleDate] = useState(() => new Date());
  const [saleDatePickerOpen, setSaleDatePickerOpen] = useState(false);
  const [saleDateDraft, setSaleDateDraft] = useState("");
  const quickAddInputRef = useRef<HTMLInputElement | null>(null);
  /** Evita un segundo Enter (lector) mientras el primero aún procesa; el estado `quickAddBusy` llega tarde en el mismo tick. */
  const quickAddBusyRef = useRef(false);
  /** Tras agregar línea por código o catálogo: enfocar cantidad cuando el DOM ya tiene la fila (evita que el foco se quede en «código»). */
  const pendingLineFieldFocusRef = useRef<{ lineIndex: number; field: SaleLineField } | null>(null);
  const saleTermsRef = useRef<HTMLSelectElement | null>(null);
  const saleCustomerRef = useRef<HTMLInputElement | null>(null);
  const saleAddressRef = useRef<HTMLInputElement | null>(null);
  const salePhoneRef = useRef<HTMLInputElement | null>(null);
  const saleTaxIdRef = useRef<HTMLInputElement | null>(null);
  const saleNotesRef = useRef<HTMLInputElement | null>(null);
  const salePriceTierRef = useRef<HTMLSelectElement | null>(null);
  const salePaidRef = useRef<HTMLInputElement | null>(null);
  const saleInvoiceRef = useRef<HTMLInputElement | null>(null);
  const saleFechaRef = useRef<HTMLDivElement | null>(null);
  const [customerPickHighlight, setCustomerPickHighlight] = useState(0);
  const [productSearchHighlight, setProductSearchHighlight] = useState(0);
  const [pickLineHighlight, setPickLineHighlight] = useState(0);
  const pickLinePanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isEditMode) return;
    const label = user?.displayName?.trim() || user?.username?.trim() || "";
    setSellerName(label);
  }, [isEditMode, user?.displayName, user?.username]);

  useEffect(() => {
    if (!token) return;
    if (isEditMode) return;
    setLoadedInvoiceNumber(null);
    apiFetch<Customer[]>("/api/customers", { token }).then((list) => {
      const def = list.find((x) => /consumidor/i.test(x.name)) ?? list[0];
      if (def) {
        setCustomerId(def.id);
        setCustomerName(def.name);
        setCustomerAddress(def.address ?? "");
        setCustomerPhone(def.phone ?? "");
        setCustomerTaxId(def.taxId ?? "");
      } else {
        setCustomerId("");
        setCustomerName("");
        setCustomerAddress("");
        setCustomerPhone("");
        setCustomerTaxId("");
      }
    });
  }, [token, isEditMode]);

  useEffect(() => {
    if (!token || !isEditMode || !editSaleId) return;
    setLoadingSale(true);
    setErr("");
    apiFetch<Sale>(`/api/sales/${editSaleId}`, { token })
      .then((sale) => {
        setLoadedInvoiceNumber(sale.invoiceNumber ?? null);
        setCustomerId(sale.customer?.id ?? "");
        if (sale.customer) {
          setCustomerName(sale.customer.name);
          setCustomerAddress(sale.customer.address ?? "");
          setCustomerPhone(sale.customer.phone ?? "");
          setCustomerTaxId(sale.customer.taxId ?? "");
        } else {
          setCustomerName("");
          setCustomerAddress("");
          setCustomerPhone("");
          setCustomerTaxId("");
        }
        setPriceTier(sale.priceTier ?? 1);
        setTerms(sale.terms || "CONTADO");
        setPaid(String(sale.paid ?? 0));
        setNotes(sale.notes ?? "");
        setSellerName(
          (sale.sellerName && String(sale.sellerName).trim()) ||
            user?.displayName?.trim() ||
            user?.username?.trim() ||
            ""
        );
        setDocumentSaleDate(new Date(sale.saleDate));
        setLines(
          sale.lines.map((l) => ({
            lineKey: newLineKey(),
            productId: l.product.id,
            product: l.product,
            qty: l.qty,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent ?? 0,
          }))
        );
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "No se pudo cargar la venta"))
      .finally(() => setLoadingSale(false));
  }, [token, isEditMode, editSaleId, user?.displayName, user?.username]);

  const addProductById = useCallback(
    async (productId: string) => {
      if (!token) return;
      try {
        const p = await apiFetch<Product>(`/api/products/${productId}`, { token });
        if (!p.active || p.productType === "INSUMO") return;

        const tier = priceTierRef.current;
        let focusLineAfter: number | null = null;
        setLines((prev) => {
          const i = prev.findIndex((l) => l.productId === p.id);
          if (i >= 0) {
            focusLineAfter = i;
            return [...prev];
          }

          focusLineAfter = prev.length;
          const qty = defaultQtyForNewLine(p);
          return [
            ...prev,
            {
              lineKey: newLineKey(),
              productId: p.id,
              product: p,
              qty,
              unitPrice: resolveProductUnitPrice(p, qty, tier),
              discountPercent: 0,
            },
          ];
        });
        if (focusLineAfter !== null) {
          pendingLineFieldFocusRef.current = { lineIndex: focusLineAfter, field: "qty" };
          setSelectedLineIndex(focusLineAfter);
        }
      } catch {
        /* ignorar */
      }
    },
    [token]
  );

  const openProductSearchModal = useCallback(() => {
    setProductSearchOpen(true);
  }, []);

  const refreshLinesWithProduct = useCallback((p: Product) => {
    const tier = priceTierRef.current;
    setLines((prev) =>
      prev.map((l) =>
        l.productId === p.id
          ? {
              ...l,
              product: p,
              unitPrice: resolveProductUnitPrice(p, l.qty, tier),
            }
          : l
      )
    );
  }, []);

  const startEditProductFlow = useCallback(() => {
    if (!admin || lines.length === 0) return;
    const sel =
      selectedLineIndex !== null && selectedLineIndex >= 0 && selectedLineIndex < lines.length
        ? selectedLineIndex
        : null;
    if (sel !== null) {
      setCatalogModal({ kind: "edit", productId: lines[sel].productId });
      return;
    }
    if (lines.length === 1) {
      setCatalogModal({ kind: "edit", productId: lines[0].productId });
      return;
    }
    setPickLineForEditOpen(true);
  }, [admin, lines, selectedLineIndex]);

  const applyCustomer = useCallback((c: Customer) => {
    setCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerAddress(c.address ?? "");
    setCustomerPhone(c.phone ?? "");
    setCustomerTaxId(c.taxId ?? "");
    const dt = c.defaultPriceTier;
    if (dt != null && dt >= 1 && dt <= 4) {
      const tier = Math.trunc(dt);
      setPriceTier(tier);
      priceTierRef.current = tier;
      setLines((prev) =>
        prev.map((l) => ({
          ...l,
          unitPrice: resolveProductUnitPrice(l.product, l.qty, tier),
        }))
      );
    }
  }, []);

  useEffect(() => {
    if (!customerSearchOpen || !token) return;
    setCustomerSearchQ("");
    apiFetch<Customer[]>("/api/customers", { token }).then(setCustomerPickList).catch(() => setCustomerPickList([]));
  }, [customerSearchOpen, token]);

  useEffect(() => {
    if (!productSearchOpen || !token) return;
    apiFetch<Supplier[]>("/api/suppliers", { token }).then(setProductSuppliers).catch(() => setProductSuppliers([]));
  }, [productSearchOpen, token]);

  useEffect(() => {
    if (!productSearchOpen || !token) return;
    const t = window.setTimeout(async () => {
      setProductSearchErr("");
      setProductSearchLoading(true);
      try {
        const params = new URLSearchParams();
        if (productSearchQ.trim()) params.set("q", productSearchQ.trim());
        params.set("touch", "1");
        params.set("forPos", "1");
        params.set("limit", "250");
        if (productInStockOnly) params.set("stock", "with");
        if (productSupplierId.trim()) params.set("supplierId", productSupplierId.trim());
        const data = await apiFetch<Product[]>(`/api/products?${params.toString()}`, { token });
        setProductSearchRows(data.filter((p) => p.active && p.productType !== "INSUMO"));
      } catch (e) {
        setProductSearchErr(e instanceof Error ? e.message : "Error al cargar productos");
        setProductSearchRows([]);
      } finally {
        setProductSearchLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(t);
  }, [productSearchOpen, token, productSearchQ, productSupplierId, productInStockOnly]);

  const filteredPickCustomers = useMemo(() => {
    const q = customerSearchQ.trim().toLowerCase();
    if (!q) return customerPickList;
    return customerPickList.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.code && c.code.toLowerCase().includes(q)) ||
        (c.taxId && c.taxId.toLowerCase().includes(q)) ||
        (c.phone && c.phone.toLowerCase().includes(q))
    );
  }, [customerPickList, customerSearchQ]);

  useEffect(() => {
    if (!customerSearchOpen) return;
    setCustomerPickHighlight(0);
  }, [customerSearchOpen, customerSearchQ]);

  useLayoutEffect(() => {
    if (!customerSearchOpen) return;
    setCustomerPickHighlight((h) => {
      const n = filteredPickCustomers.length;
      if (n === 0) return 0;
      return Math.min(Math.max(h, 0), n - 1);
    });
  }, [customerSearchOpen, filteredPickCustomers.length]);

  useLayoutEffect(() => {
    if (!customerSearchOpen || filteredPickCustomers.length === 0) return;
    document
      .querySelector<HTMLElement>(`[data-customer-pick-index="${customerPickHighlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [customerPickHighlight, filteredPickCustomers, customerSearchOpen]);

  useEffect(() => {
    if (!productSearchOpen) return;
    setProductSearchHighlight(0);
  }, [productSearchOpen, productSearchQ, productSupplierId, productInStockOnly]);

  useLayoutEffect(() => {
    if (!productSearchOpen) return;
    setProductSearchHighlight((h) => {
      const n = productSearchRows.length;
      if (n === 0) return 0;
      return Math.min(Math.max(h, 0), n - 1);
    });
  }, [productSearchOpen, productSearchRows.length]);

  useLayoutEffect(() => {
    if (!productSearchOpen || productSearchLoading || productSearchRows.length === 0) return;
    document
      .querySelector<HTMLElement>(`[data-product-search-row="${productSearchHighlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [productSearchHighlight, productSearchRows, productSearchOpen, productSearchLoading]);

  useEffect(() => {
    if (!pickLineForEditOpen) return;
    setPickLineHighlight(0);
    const id = window.setTimeout(() => pickLinePanelRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [pickLineForEditOpen]);

  useLayoutEffect(() => {
    if (!pickLineForEditOpen) return;
    setPickLineHighlight((h) => {
      const n = lines.length;
      if (n === 0) return 0;
      return Math.min(Math.max(h, 0), n - 1);
    });
  }, [pickLineForEditOpen, lines.length]);

  useLayoutEffect(() => {
    if (!pickLineForEditOpen || lines.length === 0) return;
    document
      .querySelector<HTMLElement>(`[data-pick-line-index="${pickLineHighlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [pickLineHighlight, lines, pickLineForEditOpen]);

  /** F9: no duplica producto; solo lleva el foco al campo código/barras para añadir otra línea. */
  const insertRowAfterSelection = useCallback(() => {
    setQuickAddErr("");
    queueMicrotask(() => {
      const el = quickAddInputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.select();
    });
  }, []);

  const deleteSelectedOrLastRow = useCallback(() => {
    if (lines.length === 0) return;
    const delIdx =
      selectedLineIndex !== null && selectedLineIndex >= 0 && selectedLineIndex < lines.length
        ? selectedLineIndex
        : lines.length - 1;
    const next = lines.filter((_, j) => j !== delIdx);
    const wasSel =
      selectedLineIndex !== null && selectedLineIndex >= 0 && selectedLineIndex < lines.length
        ? selectedLineIndex
        : lines.length - 1;
    let newSel: number | null;
    if (next.length === 0) newSel = null;
    else if (delIdx < wasSel) newSel = wasSel - 1;
    else if (delIdx === wasSel) newSel = Math.min(wasSel, next.length - 1);
    else newSel = wasSel;
    setLines(next);
    setSelectedLineIndex(newSel);
  }, [lines, selectedLineIndex]);

  const focusSaleLineField = useCallback((lineIndex: number, field: SaleLineField) => {
    const el = document.querySelector<HTMLInputElement>(
      `[data-sale-form-line="${lineIndex}"][data-sale-form-field="${field}"]`
    );
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const focusHeaderArrowTarget = useCallback((dest: SaleHeaderArrowDest) => {
    if (dest === "quickAdd") {
      queueMicrotask(() => quickAddInputRef.current?.focus());
      return;
    }
    switch (dest) {
      case "invoice":
        saleInvoiceRef.current?.focus();
        break;
      case "terms":
        saleTermsRef.current?.focus();
        break;
      case "fecha":
        saleFechaRef.current?.focus();
        break;
      case "customer":
        saleCustomerRef.current?.focus();
        break;
      case "address":
        saleAddressRef.current?.focus();
        break;
      case "phone":
        salePhoneRef.current?.focus();
        break;
      case "taxId":
        saleTaxIdRef.current?.focus();
        break;
      case "notes":
        saleNotesRef.current?.focus();
        break;
      case "priceTier":
        salePriceTierRef.current?.focus();
        break;
      case "paid":
        salePaidRef.current?.focus();
        break;
      default:
        break;
    }
  }, []);

  const tryHeaderArrowNav = useCallback(
    (e: ReactKeyboardEvent, from: SaleHeaderArrowField): boolean => {
      if (e.nativeEvent.isComposing) return false;
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const dir = arrowKeyToDir(e.key);
      if (!dir) return false;

      const tgt = e.currentTarget;
      if (tgt instanceof HTMLInputElement) {
        if (tgt.readOnly) {
          /* siempre navegar */
        } else if (tgt.type === "number") {
          /* abono: flechas solo cambian de campo */
        } else if (!HEADER_ARROW_ALWAYS_LEAVE_FIELD.has(from) && !shouldMoveFromTextInput(tgt, dir)) {
          return false;
        }
      }

      const credit = isCreditSaleTerm(terms);
      if (from === "paid" && !credit) return false;

      const next = headerArrowNeighbor(from, dir, credit);
      if (!next) return false;
      e.preventDefault();
      focusHeaderArrowTarget(next);
      return true;
    },
    [terms, focusHeaderArrowTarget]
  );

  const handleSaleHeaderInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>, field: "customer" | "address" | "phone" | "taxId" | "notes" | "paid") => {
      if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const next: Record<typeof field, () => void> = {
        customer: () => saleAddressRef.current?.focus(),
        address: () => salePhoneRef.current?.focus(),
        phone: () => saleTaxIdRef.current?.focus(),
        taxId: () => saleNotesRef.current?.focus(),
        notes: () => salePriceTierRef.current?.focus(),
        paid: () => quickAddInputRef.current?.focus(),
      };
      const prev: Record<typeof field, () => void> = {
        customer: () => saleTermsRef.current?.focus(),
        address: () => saleCustomerRef.current?.focus(),
        phone: () => saleAddressRef.current?.focus(),
        taxId: () => salePhoneRef.current?.focus(),
        notes: () => saleTaxIdRef.current?.focus(),
        paid: () => salePriceTierRef.current?.focus(),
      };
      if (e.shiftKey) {
        e.preventDefault();
        prev[field]();
      } else {
        e.preventDefault();
        next[field]();
      }
    },
    []
  );

  const handleSaleLineInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>, lineIndex: number, field: SaleLineField) => {
      const n = lines.length;
      if (e.nativeEvent.isComposing) return;

      if (e.key === "ArrowDown" && e.altKey) {
        e.preventDefault();
        if (lineIndex < n - 1) focusSaleLineField(lineIndex + 1, field);
        else queueMicrotask(() => quickAddInputRef.current?.focus());
        return;
      }
      if (e.key === "ArrowUp" && e.altKey) {
        e.preventDefault();
        if (lineIndex > 0) focusSaleLineField(lineIndex - 1, field);
        else if (isCreditSaleTerm(terms)) salePaidRef.current?.focus();
        else salePriceTierRef.current?.focus();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key !== "Enter") return;

      const fi = SALE_LINE_FIELDS.indexOf(field);
      if (fi < 0) return;

      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (fi > 0) focusSaleLineField(lineIndex, SALE_LINE_FIELDS[fi - 1]);
        else if (lineIndex > 0) focusSaleLineField(lineIndex - 1, "disc");
        else if (isCreditSaleTerm(terms)) salePaidRef.current?.focus();
        else salePriceTierRef.current?.focus();
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      if (fi < SALE_LINE_FIELDS.length - 1) focusSaleLineField(lineIndex, SALE_LINE_FIELDS[fi + 1]);
      /* Tras el último campo de la fila ir siempre al código nuevo (no recorrer fila por fila). */
      else queueMicrotask(() => quickAddInputRef.current?.focus());
    },
    [lines.length, terms, focusSaleLineField]
  );

  const handleSaleTermsKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLSelectElement>) => {
      if (tryHeaderArrowNav(e, "terms")) return;
      if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      saleCustomerRef.current?.focus();
    },
    [tryHeaderArrowNav]
  );

  const handleSalePriceTierKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLSelectElement>) => {
      if (tryHeaderArrowNav(e, "priceTier")) return;
      if (e.nativeEvent.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (e.shiftKey) {
        saleNotesRef.current?.focus();
        return;
      }
      if (isCreditSaleTerm(terms)) salePaidRef.current?.focus();
      else if (lines.length > 0) focusSaleLineField(0, "qty");
      else quickAddInputRef.current?.focus();
    },
    [tryHeaderArrowNav, terms, lines.length, focusSaleLineField]
  );

  const startEditCustomerFlow = useCallback(() => {
    if (!customerId.trim()) {
      setErr("Elija un cliente con F2 o cree uno con F6 antes de editar.");
      return;
    }
    setErr("");
    setCustomerCatalogModal({ kind: "edit" });
  }, [customerId]);

  const submitQuickAddByCode = useCallback(async () => {
    const raw = quickAddCode.trim();
    setQuickAddErr("");
    if (!raw || !token) return;
    if (quickAddBusyRef.current) return;
    quickAddBusyRef.current = true;
    setQuickAddBusy(true);
    let focusLineAfter: number | null = null;
    try {
      const list = await apiFetch<Product[]>(
        `/api/products?q=${encodeURIComponent(raw)}&touch=1&forPos=1&limit=120`,
        { token }
      );
      const key = raw.toLowerCase();
      const exact = list.find(
        (p) =>
          normProductLookup(p.sku) === key ||
          normProductLookup(p.barcode) === key ||
          normProductLookup(p.quickCode) === key
      );
      if (!exact || !exact.active || exact.productType === "INSUMO") {
        setQuickAddErr("El producto no existe.");
        return;
      }
      const tier = priceTierRef.current;
      /* Commit síncrono: la fila existe y useLayoutEffect enfoca cantidad antes de otro Enter del lector. */
      flushSync(() => {
        setLines((prev) => {
          const i = prev.findIndex((l) => l.productId === exact.id);
          if (i >= 0) {
            focusLineAfter = i;
            pendingLineFieldFocusRef.current = { lineIndex: i, field: "qty" };
            return [...prev];
          }
          const idx = prev.length;
          focusLineAfter = idx;
          pendingLineFieldFocusRef.current = { lineIndex: idx, field: "qty" };
          const qty = defaultQtyForNewLine(exact);
          return [
            ...prev,
            {
              lineKey: newLineKey(),
              productId: exact.id,
              product: exact,
              qty,
              unitPrice: resolveProductUnitPrice(exact, qty, tier),
              discountPercent: 0,
            },
          ];
        });
        if (focusLineAfter !== null) {
          setSelectedLineIndex(focusLineAfter);
        }
        setQuickAddCode("");
      });
    } catch {
      setQuickAddErr("No se pudo buscar el producto.");
    } finally {
      /* Si la línea se agregó bien, el campo código sigue «ocupado» hasta useLayoutEffect. */
      if (focusLineAfter === null) {
        quickAddBusyRef.current = false;
        setQuickAddBusy(false);
        window.setTimeout(() => {
          const el = quickAddInputRef.current;
          if (!el || el.disabled) return;
          el.focus({ preventScroll: true });
          el.select();
        }, 0);
      }
    }
  }, [token, quickAddCode]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === PF_PRODUCT_PICK_TYPE && typeof e.data?.productId === "string") {
        void addProductById(e.data.productId);
      }
    }
    window.addEventListener("message", onMessage);
    let bc: BroadcastChannel | undefined;
    try {
      bc = new BroadcastChannel(PF_PRODUCT_PICK_CHANNEL);
      bc.onmessage = (ev: MessageEvent) => {
        const id = ev.data?.productId;
        if (typeof id === "string") void addProductById(id);
      };
    } catch {
      /* */
    }
    return () => {
      window.removeEventListener("message", onMessage);
      bc?.close();
    };
  }, [addProductById]);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  function removeLine(i: number) {
    const next = lines.filter((_, j) => j !== i);
    const wasSel =
      selectedLineIndex !== null && selectedLineIndex >= 0 && selectedLineIndex < lines.length
        ? selectedLineIndex
        : lines.length - 1;
    let newSel: number | null;
    if (next.length === 0) newSel = null;
    else if (i < wasSel) newSel = wasSel - 1;
    else if (i === wasSel) newSel = Math.min(wasSel, next.length - 1);
    else newSel = wasSel;
    setLines(next);
    setSelectedLineIndex(newSel);
  }

  const clearLines = useCallback(() => {
    setLines([]);
    setSelectedLineIndex(null);
    setErr("");
    setQuickAddCode("");
    setQuickAddErr("");
  }, []);

  const totals = useMemo(() => {
    let sub = 0;
    let tax = 0;
    for (const l of lines) {
      const base = l.unitPrice * l.qty * (1 - l.discountPercent / 100);
      const t = base * (l.product.taxPercent / 100);
      sub += base;
      tax += t;
    }
    return { subtotal: sub, tax, total: sub + tax };
  }, [lines]);

  const hasBillableLines = useMemo(() => lines.some((l) => l.qty > 0), [lines]);

  const stockIssueCount = useMemo(
    () => lines.filter((l) => tracksStock(l.product) && l.qty > l.product.stock).length,
    [lines]
  );

  const saveSale = useCallback(
    async (opts?: { destination?: "ticket" | "comprobante"; autoPrintTicket?: boolean }) => {
      if (!token || lines.length === 0) return;
      setErr("");
      if (!lines.some((l) => l.qty > 0)) {
        setErr("Indique una cantidad mayor que cero en al menos una línea antes de guardar.");
        return;
      }
      if (isCreditSaleTerm(terms) && !customerId.trim()) {
        setErr("Las ventas a crédito requieren un cliente registrado.");
        return;
      }
      const stockProblems = lines.filter((l) => tracksStock(l.product) && l.qty > l.product.stock);
      if (stockProblems.length > 0) {
        const detail = stockProblems
          .map((l) =>
            l.product.stock <= 0
              ? `«${l.product.name}» sin existencia`
              : `«${l.product.name}» (pide ${l.qty}, exist. ${l.product.stock})`
          )
          .join("; ");
        setErr(`No se puede guardar: existencia insuficiente — ${detail}.`);
        return;
      }
      setBusy(true);
      try {
        if (customerId.trim()) {
          const name = customerName.trim() || "Cliente";
          await apiFetch(`/api/customers/${customerId}`, {
            method: "PATCH",
            body: JSON.stringify({
              name,
              address: customerAddress.trim() || null,
              phone: customerPhone.trim() || null,
              taxId: customerTaxId.trim() || null,
            }),
            token,
          });
        }
        const body = {
          customerId: customerId || null,
          terms,
          priceTier,
          notes: notes.trim() || undefined,
          sellerName: sellerName.trim() || undefined,
          paid: isCreditSaleTerm(terms) ? Number(paid) || 0 : undefined,
          saleDate: documentSaleDate.toISOString(),
          lines: lines
            .filter((l) => l.qty > 0)
            .map((l) => ({
              productId: l.productId,
              qty: l.qty,
              unitPrice: l.unitPrice,
              discountPercent: l.discountPercent,
            })),
        };
        const sale = await apiFetch<Sale>(isEditMode ? `/api/sales/${editSaleId}` : "/api/sales", {
          method: isEditMode ? "PATCH" : "POST",
          body: JSON.stringify(body),
          token,
        });

        if (isEditMode) {
          showToast("Factura actualizada correctamente", "success");
          navigate("/ventas");
        } else if (opts?.destination === "comprobante") {
          showToast("Factura guardada correctamente", "success");
          navigate(`/ventas/${sale.id}/comprobante`);
        } else if (opts?.autoPrintTicket) {
          showToast("Factura guardada. Aparecerá el cuadro de impresión (siga en esta pantalla).", "print");
          printSaleTicketInHiddenFrame(sale.id);
        } else {
          showToast("Factura guardada correctamente", "success");
        }

        if (!isEditMode) {
          setLines([]);
          setSelectedLineIndex(null);
          setNotes("");
          setSellerName(user?.displayName?.trim() || user?.username?.trim() || "");
          setPaid("");
          setTerms("CONTADO");
          setQuickAddCode("");
          setQuickAddErr("");
          setErr("");
          setLoadedInvoiceNumber(null);
          setDocumentSaleDate(new Date());

          if (token) {
            apiFetch<Customer[]>("/api/customers", { token }).then((list) => {
              const def = list.find((x) => /consumidor/i.test(x.name)) ?? list[0];
              if (def) {
                setCustomerId(def.id);
                setCustomerName(def.name);
                setCustomerAddress(def.address ?? "");
                setCustomerPhone(def.phone ?? "");
                setCustomerTaxId(def.taxId ?? "");
              }
            });
          }
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Error");
      } finally {
        setBusy(false);
      }
    },
    [
      token,
      lines,
      customerId,
      customerName,
      customerAddress,
      customerPhone,
      customerTaxId,
      terms,
      priceTier,
      paid,
      notes,
      sellerName,
      documentSaleDate,
      isEditMode,
      editSaleId,
      navigate,
      showToast,
      user?.displayName,
      user?.username,
    ]
  );

  const openCheckout = useCallback(
    (opts: { destination: "ticket" | "comprobante"; autoPrintTicket?: boolean }) => {
      if (!token || lines.length === 0) return;
      setErr("");
      if (!lines.some((l) => l.qty > 0)) {
        setErr("Indique una cantidad mayor que cero en al menos una línea antes de cobrar.");
        return;
      }
      if (isCreditSaleTerm(terms) && !customerId.trim()) {
        setErr("Las ventas a crédito requieren un cliente registrado.");
        return;
      }
      const stockProblems = lines.filter((l) => tracksStock(l.product) && l.qty > l.product.stock);
      if (stockProblems.length > 0) {
        const detail = stockProblems
          .map((l) =>
            l.product.stock <= 0
              ? `«${l.product.name}» sin existencia`
              : `«${l.product.name}» (pide ${l.qty}, exist. ${l.product.stock})`
          )
          .join("; ");
        setErr(`No se puede guardar: existencia insuficiente — ${detail}.`);
        return;
      }
      setCheckoutOpts(opts);
      setCheckoutAmountReceived("");
      setCheckoutOpen(true);
      setTimeout(() => checkoutAmountInputRef.current?.focus(), 80);
    },
    [token, lines, terms, customerId]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target;
      if (t instanceof HTMLElement && t.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "F2") {
        e.preventDefault();
        setCustomerSearchOpen(true);
        return;
      }
      if (e.key === "F3") {
        e.preventDefault();
        if (admin) setCatalogModal({ kind: "new" });
        return;
      }
      if (e.key === "F4") {
        e.preventDefault();
        openProductSearchModal();
        return;
      }
      if (e.key === "F6") {
        e.preventDefault();
        setCustomerCatalogModal({ kind: "new" });
        return;
      }
      if (e.key === "F9") {
        e.preventDefault();
        insertRowAfterSelection();
        return;
      }
      if (e.key === "F10") {
        e.preventDefault();
        deleteSelectedOrLastRow();
        return;
      }
      if (e.key === "F11") {
        e.preventDefault();
        clearLines();
        return;
      }
      if (e.key !== "F5" && e.key !== "F8") return;
      e.preventDefault();
      if (busy || loadingSale || lines.length === 0) return;
      if (isCreditSaleTerm(terms) && !customerId.trim()) return;
      if (e.key === "F8") openCheckout({ destination: "ticket", autoPrintTicket: true });
      else openCheckout({ destination: "ticket" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    admin,
    busy,
    loadingSale,
    lines.length,
    terms,
    customerId,
    openCheckout,
    openProductSearchModal,
    insertRowAfterSelection,
    deleteSelectedOrLastRow,
  ]);

  const saleDateDisplayStr = useMemo(
    () =>
      documentSaleDate.toLocaleString("es-HN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [documentSaleDate]
  );

  const saleRibbonBar = useMemo(
    () => (
      <>
        <SaleRibbonGroup title={isEditMode ? "Guardar venta" : "Guardar venta final"}>
          <SaleRibbonTile
            variant="primary"
            icon={Save}
            line1="F5 Guardar"
            line2={isEditMode ? "cambios" : "venta"}
            title={isEditMode ? "Guardar cambios (F5)" : "Guardar venta (F5)"}
            onClick={() => openCheckout({ destination: "ticket" })}
            disabled={busy || !hasBillableLines || loadingSale}
          />
          <SaleRibbonTile
            variant="muted"
            icon={Printer}
            line1="F8 Imprimir"
            line2="ticket"
            title="Guardar e imprimir ticket térmico (F8)"
            onClick={() => openCheckout({ destination: "ticket", autoPrintTicket: true })}
            disabled={busy || !hasBillableLines || loadingSale}
          />
          <SaleRibbonTile
            variant="default"
            icon={FileText}
            line1="Factura"
            line2="carta"
            title="Guardar y abrir comprobante en carta"
            onClick={() => openCheckout({ destination: "comprobante" })}
            disabled={busy || !hasBillableLines || loadingSale}
          />
        </SaleRibbonGroup>
        <SaleRibbonGroup title="Clientes">
          <SaleRibbonTile
            variant="default"
            icon={Users}
            line1="F2 Buscar"
            line2="clientes"
            title="Buscar y elegir cliente (F2)"
            onClick={() => setCustomerSearchOpen(true)}
          />
          <SaleRibbonTile
            variant="default"
            icon={UserPlus}
            line1="F6 Nuevo"
            line2="cliente"
            title="Registrar cliente (F6). En el formulario: Enter siguiente campo, Shift+Enter anterior."
            onClick={() => setCustomerCatalogModal({ kind: "new" })}
          />
          <SaleRibbonTile
            variant="default"
            icon={Pencil}
            line1="Editar"
            line2="cliente"
            title="Editar el cliente seleccionado (debe estar en catálogo)"
            onClick={startEditCustomerFlow}
            disabled={!customerId.trim()}
          />
        </SaleRibbonGroup>
        <SaleRibbonGroup title="Productos">
          <SaleRibbonTile
            variant="default"
            icon={Plus}
            line1="F3 Nuevo"
            line2="producto"
            title={
              admin
                ? "Crear producto (F3). En el formulario: Enter siguiente campo, Shift+Enter anterior."
                : "Solo el administrador puede crear productos nuevos"
            }
            onClick={() => admin && setCatalogModal({ kind: "new" })}
            disabled={!admin}
          />
          <SaleRibbonTile
            variant="default"
            icon={Pencil}
            line1="Editar"
            line2="producto"
            title={
              admin
                ? "Editar producto de la fila seleccionada"
                : "Solo el administrador puede editar el catálogo"
            }
            onClick={startEditProductFlow}
            disabled={!admin || lines.length === 0}
          />
          <SaleRibbonTile
            variant="default"
            icon={Search}
            line1="F4 Buscar"
            line2="productos"
            title="Buscar productos (F4)"
            onClick={openProductSearchModal}
          />
        </SaleRibbonGroup>
        <SaleRibbonGroup title="Filas">
          <SaleRibbonTile
            variant="default"
            icon={Plus}
            line1="F9 Insertar"
            line2="fila"
            title="Enfocar el campo Código / barras / rápido para agregar un producto (no copia la fila seleccionada)"
            onClick={insertRowAfterSelection}
          />
          <SaleRibbonTile
            variant="danger"
            icon={X}
            line1="F10 Eliminar"
            line2="fila"
            title="Eliminar la fila seleccionada o la última (F10)"
            onClick={deleteSelectedOrLastRow}
            disabled={lines.length === 0}
          />
        </SaleRibbonGroup>
        <SaleRibbonGroup title="Limpiar">
          <SaleRibbonTile
            variant="default"
            icon={Eraser}
            line1="F11 Limpiar"
            line2="líneas"
            title="Vaciar todas las líneas del documento (F11)"
            onClick={clearLines}
            disabled={lines.length === 0}
          />
        </SaleRibbonGroup>
      </>
    ),
    [
      admin,
      busy,
      clearLines,
      customerId,
      deleteSelectedOrLastRow,
      hasBillableLines,
      insertRowAfterSelection,
      isEditMode,
      lines.length,
      loadingSale,
      openCheckout,
      openProductSearchModal,
      startEditCustomerFlow,
      startEditProductFlow,
    ]
  );

  useLayoutEffect(() => {
    const p = pendingLineFieldFocusRef.current;
    if (!p) return;
    pendingLineFieldFocusRef.current = null;
    const focusLineField = (): boolean => {
      const el = document.querySelector<HTMLInputElement>(
        `[data-sale-form-line="${p.lineIndex}"][data-sale-form-field="${p.field}"]`
      );
      if (!el) return false;
      quickAddInputRef.current?.blur();
      el.focus({ preventScroll: true });
      el.select();
      return true;
    };
    const releaseQuickAdd = () => {
      quickAddBusyRef.current = false;
      setQuickAddBusy(false);
    };
    if (focusLineField()) {
      releaseQuickAdd();
      return;
    }
    requestAnimationFrame(() => {
      if (!focusLineField()) {
        quickAddInputRef.current?.focus({ preventScroll: true });
        quickAddInputRef.current?.select();
      }
      releaseQuickAdd();
    });
  }, [lines]);

  useLayoutEffect(() => {
    setSaleToolbar?.(saleRibbonBar);
    return () => setSaleToolbar?.(null);
  }, [saleRibbonBar, setSaleToolbar]);

  return (
    <div className="flex min-h-0 flex-col gap-3 pf-safe-page">
      {toast && (
        <div
          className={`fixed left-1/2 top-6 z-[9999] -translate-x-1/2 animate-[toast-in_0.35s_ease-out] rounded-2xl border px-6 py-4 shadow-2xl ${
            toast.type === "print"
              ? "border-sky-300 bg-sky-50 text-sky-800"
              : "border-emerald-300 bg-emerald-50 text-emerald-800"
          }`}
        >
          <div className="flex items-center gap-3">
            {toast.type === "print" ? (
              <Printer className="h-6 w-6 shrink-0" strokeWidth={2} />
            ) : (
              <CheckCircle2 className="h-6 w-6 shrink-0" strokeWidth={2} />
            )}
            <span className="text-base font-bold">{toast.message}</span>
          </div>
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
      <div className="pf-sale-doc-header">
        <h1 className="pf-doc-section-title pf-doc-section-title-compact px-2 sm:px-2.5">
          {isEditMode ? "Editar venta" : "Nueva venta"}
        </h1>

        <div className="w-full min-w-0 rounded-lg border border-pf-border bg-pf-surface-elevated/95 p-1 shadow-sm sm:p-1.5">
          <div className="grid grid-cols-1 gap-1 min-[900px]:grid-cols-2 xl:grid-cols-12 xl:items-start xl:gap-x-1.5 xl:gap-y-0.5">
            {/* Columna documento: Nº factura, términos, fecha */}
            <div className="min-w-0 space-y-0.5 xl:col-span-2">
              <Field label="Nº factura" className="min-w-0" compact>
                <Input
                  readOnly
                  ref={saleInvoiceRef}
                  tabIndex={-1}
                  value={loadedInvoiceNumber && String(loadedInvoiceNumber).trim() ? loadedInvoiceNumber : "—"}
                  className="!h-7 !min-h-[28px] cursor-default bg-pf-primary-soft/25 px-1.5 py-0 text-xs tabular-nums text-pf-text"
                  title={isEditMode ? "Número de factura" : "Se asignará al guardar"}
                  onKeyDown={(e) => {
                    tryHeaderArrowNav(e, "invoice");
                  }}
                />
              </Field>
              <Field label="Términos" className="min-w-0" compact>
                <Select
                  ref={saleTermsRef}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  onKeyDown={handleSaleTermsKeyDown}
                  className="w-full min-w-0 shrink-0 !h-auto !max-h-none !min-h-[2.375rem]"
                >
                  {SALE_TERMS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-pf-text-tertiary">
                    Fecha
                  </span>
                  {!isEditMode ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-6 min-h-0 shrink-0 gap-1 px-1.5 py-0 text-[10px] font-semibold text-pf-primary"
                      title="Cambiar fecha y hora del documento (se guardará al facturar)"
                      onClick={() => {
                        setSaleDateDraft(toDatetimeLocalValue(documentSaleDate));
                        setSaleDatePickerOpen(true);
                      }}
                    >
                      <CalendarClock className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
                      Editar fecha
                    </Button>
                  ) : null}
                </div>
                <div
                  ref={saleFechaRef}
                  tabIndex={0}
                  role="textbox"
                  aria-readonly="true"
                  aria-label={`Fecha de la venta, ${saleDateDisplayStr}`}
                  className="mt-0 flex !h-7 min-h-[28px] cursor-default items-center rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface-elevated px-1.5 text-[11px] font-bold tabular-nums text-pf-text shadow-[var(--pf-control-shadow)] outline-none focus-visible:ring-2 focus-visible:ring-pf-primary focus-visible:ring-offset-1"
                  onKeyDown={(e) => {
                    tryHeaderArrowNav(e, "fecha");
                  }}
                >
                  {saleDateDisplayStr}
                </div>
              </div>
            </div>

            {/* Cliente + DIR / TEL / RTN — en xl una sola fila para no alargar la cabecera */}
            <div className="min-w-0 space-y-0.5 xl:col-span-4">
              <Field label="Cliente" className="min-w-0" compact>
                <Input
                  ref={saleCustomerRef}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Nombre o razón social"
                  autoComplete="name"
                  className="!h-7 !min-h-[28px] px-1.5 py-0 text-xs"
                  onKeyDown={(e) => {
                    if (tryHeaderArrowNav(e, "customer")) return;
                    handleSaleHeaderInputKeyDown(e, "customer");
                  }}
                />
              </Field>
              <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-3 xl:grid-cols-3 sm:gap-1">
                <Field label="DIR" className="min-w-0" compact>
                  <Input
                    ref={saleAddressRef}
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    placeholder="Dirección"
                    autoComplete="street-address"
                    className="!h-7 !min-h-[28px] px-1.5 py-0 text-xs"
                    onKeyDown={(e) => {
                      if (tryHeaderArrowNav(e, "address")) return;
                      handleSaleHeaderInputKeyDown(e, "address");
                    }}
                  />
                </Field>
                <Field label="TEL" className="min-w-0" compact>
                  <Input
                    ref={salePhoneRef}
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Teléfono"
                    autoComplete="tel"
                    className="!h-7 !min-h-[28px] px-1.5 py-0 text-xs"
                    onKeyDown={(e) => {
                      if (tryHeaderArrowNav(e, "phone")) return;
                      handleSaleHeaderInputKeyDown(e, "phone");
                    }}
                  />
                </Field>
                <Field label="RTN" className="min-w-0" compact>
                  <Input
                    ref={saleTaxIdRef}
                    value={customerTaxId}
                    onChange={(e) => setCustomerTaxId(e.target.value)}
                    placeholder="RTN"
                    className="!h-7 !min-h-[28px] px-1.5 py-0 text-xs"
                    onKeyDown={(e) => {
                      if (tryHeaderArrowNav(e, "taxId")) return;
                      handleSaleHeaderInputKeyDown(e, "taxId");
                    }}
                  />
                </Field>
              </div>
            </div>

            {/* Notas y lista de precios (el total va en subtotal/impuesto y en la cinta) */}
            <div className="flex min-h-0 min-w-0 flex-col gap-0.5 xl:col-span-6">
              <Field label="Vendedor (opc.)" className="min-w-0 shrink-0" compact>
                <Input
                  value={sellerName}
                  onChange={(e) => setSellerName(e.target.value)}
                  placeholder="Nombre en ticket / reportes"
                  className="!h-7 !min-h-[28px] px-1.5 py-0 text-xs"
                />
              </Field>
              <Field label="Notas (opc.)" className="min-w-0 shrink-0" compact>
                <Input
                  ref={saleNotesRef}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Opcional"
                  className="!h-7 !min-h-[28px] px-1.5 py-0 text-xs"
                  onKeyDown={(e) => {
                    if (tryHeaderArrowNav(e, "notes")) return;
                    handleSaleHeaderInputKeyDown(e, "notes");
                  }}
                  title="Cabecera: flechas · Enter pasa a lista de precios. Líneas: Alt+flecha. F2…F11."
                />
              </Field>
              <Field label="Lista de precios" className="min-w-0 shrink-0" compact>
                <Select
                  ref={salePriceTierRef}
                  value={priceTier}
                  onChange={(e) => setPriceTier(Number(e.target.value))}
                  onKeyDown={handleSalePriceTierKeyDown}
                  className="w-full min-w-0 shrink-0 !h-auto !max-h-none !min-h-[2.375rem]"
                  title="↑↓←→ cabecera · Alt+↑↓ líneas · F2…F11"
                >
                  <option value={1}>Precio 1</option>
                  <option value={2}>Precio 2</option>
                  <option value={3}>Precio 3</option>
                  <option value={4}>Precio 4</option>
                </Select>
              </Field>
            </div>
          </div>

          {isCreditSaleTerm(terms) ? (
            <div className="mt-1.5 grid gap-1 border-t border-pf-border/60 pt-1.5 sm:grid-cols-2 sm:items-end lg:grid-cols-3">
              <p className="text-[10px] text-pf-muted sm:col-span-2 lg:col-span-1">Cliente obligatorio para crédito.</p>
              <Field label="Abono inicial (opcional)" className="sm:max-w-xs lg:max-w-none" compact>
                <Input
                  ref={salePaidRef}
                  type="number"
                  step="any"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                  className="!h-7 !min-h-[28px] px-1.5 py-0 text-xs"
                  onKeyDown={(e) => {
                    if (tryHeaderArrowNav(e, "paid")) return;
                    handleSaleHeaderInputKeyDown(e, "paid");
                  }}
                />
              </Field>
            </div>
          ) : null}
        </div>
      </div>

      {/* Cuadrícula principal */}
      <div className="flex-1 overflow-x-auto rounded-b-3xl border border-t-0 border-[var(--pf-glass-border)] bg-[color:var(--pf-surface-overlay)] shadow-[var(--pf-shadow-card)] backdrop-blur-sm md:rounded-b-2xl md:border-pf-border md:bg-white md:shadow-sm md:backdrop-blur-none">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="pf-table-thead text-left uppercase tracking-wide">
              <th className="px-2 py-2 w-24">Código</th>
              <th className="px-2 py-2">Descripción</th>
              <th className="px-2 py-2 w-[6rem] text-right">Cant.</th>
              <th className="px-2 py-2 w-14">Und.</th>
              <th className="px-2 py-2 w-32 text-right">Precio</th>
              <th className="px-2 py-2 w-28 text-right">Desc. %</th>
              <th className="px-2 py-2 w-20 text-right">ISV %</th>
              <th className="px-2 py-2 min-w-[5.5rem] text-right">Total</th>
              <th className="px-1 py-2 w-16" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
                <tr
                  key={l.lineKey}
                  onClick={() => setSelectedLineIndex(i)}
                  className={`pf-table-row cursor-pointer transition hover:bg-gradient-to-r hover:from-pf-primary-soft/20 hover:to-transparent ${
                    selectedLineIndex === i
                      ? "bg-[linear-gradient(to_right,var(--pf-row-selected-from),var(--pf-row-selected-to))]"
                      : tracksStock(l.product) && l.qty > l.product.stock
                        ? "bg-pf-danger-soft/30"
                        : ""
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-xs text-pf-text-tertiary">
                    {l.product.sku}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-medium text-pf-text">{l.product.name}</span>
                    <span className="block text-[11px] text-pf-muted">
                      {l.product.productType === "KIT"
                        ? "Combo (exist. por componentes)"
                        : `Exist. ${l.product.stock}`}
                    </span>
                    {tracksStock(l.product) && l.product.stock <= 0 && (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-pf-danger">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Sin existencia
                      </span>
                    )}
                    {tracksStock(l.product) && l.product.stock > 0 && l.qty > l.product.stock && (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-pf-danger">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Excede existencia por {(l.qty - l.product.stock).toFixed(l.product.esGranel ? 2 : 0)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <Input
                      type="number"
                      step="any"
                      data-sale-form-line={i}
                      data-sale-form-field="qty"
                      className="!min-h-[44px] w-full min-w-[5.25rem] px-2 py-2 text-right text-sm tabular-nums [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      value={l.qty}
                      onFocus={() => setSelectedLineIndex(i)}
                      onKeyDown={(e) => handleSaleLineInputKeyDown(e, i, "qty")}
                      onChange={(e) => {
                        const parsed = Number(e.target.value);
                        let qty = Number.isFinite(parsed) ? Math.max(0, parsed) : l.qty;

                        if (tracksStock(l.product)) {
                          const cap = l.product.stock;
                          if (!l.product.esGranel) qty = Math.round(qty);
                          if (qty > cap) {
                            setErr(
                              `«${l.product.name}»: no puede vender más de ${cap} (existencia). Aumente el stock en Productos antes de continuar.`
                            );
                            qty = cap;
                          }
                          if (qty > 0) {
                            const floor = l.product.esGranel ? 0.0001 : 1;
                            if (qty < floor) {
                              qty = floor;
                              if (qty > cap) qty = cap;
                            }
                          }
                        } else {
                          qty = Number.isFinite(parsed) ? Math.max(0, parsed) : l.qty;
                          if (qty > 0 && qty < 0.0001) qty = 0.0001;
                        }

                        updateLine(i, {
                          qty,
                          unitPrice: resolveProductUnitPrice(l.product, qty, priceTier),
                        });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-pf-text-tertiary">{l.product.unit}</td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <Input
                      type="number"
                      step="any"
                      data-sale-form-line={i}
                      data-sale-form-field="price"
                      className="!min-h-[44px] w-full min-w-[5.5rem] px-2 py-2 text-right text-sm tabular-nums [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      value={l.unitPrice}
                      onFocus={() => setSelectedLineIndex(i)}
                      onKeyDown={(e) => handleSaleLineInputKeyDown(e, i, "price")}
                      onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <Input
                      type="number"
                      step="any"
                      data-sale-form-line={i}
                      data-sale-form-field="disc"
                      className="!min-h-[44px] w-full min-w-[4.5rem] px-2 py-2 text-right text-sm tabular-nums [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      value={l.discountPercent}
                      onFocus={() => setSelectedLineIndex(i)}
                      onKeyDown={(e) => handleSaleLineInputKeyDown(e, i, "disc")}
                      onChange={(e) => updateLine(i, { discountPercent: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-pf-text-tertiary">
                    {l.product.taxPercent}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatMoney(sym, computeLineTotal(l))}
                  </td>
                  <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="min-h-[44px] min-w-[44px] rounded-xl px-2 text-xs font-semibold text-pf-danger transition hover:bg-pf-danger-soft active:scale-95 touch-manipulation"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeLine(i);
                      }}
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            {/* Fila “vacía” del grid: código aquí y Enter agrega el producto */}
            <tr className="border-t-2 border-dashed border-pf-border bg-pf-primary-soft/20">
              <td className="px-3 py-2 align-middle" onClick={(e) => e.stopPropagation()}>
                <Input
                  ref={quickAddInputRef}
                  value={quickAddCode}
                  onChange={(e) => {
                    setQuickAddCode(e.target.value);
                    setQuickAddErr("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (lines.length > 0) focusSaleLineField(lines.length - 1, "qty");
                      else if (isCreditSaleTerm(terms)) salePaidRef.current?.focus();
                      else salePriceTierRef.current?.focus();
                      return;
                    }
                    if (e.key === "Enter") {
                      if (e.nativeEvent.isComposing) return;
                      e.preventDefault();
                      e.stopPropagation();
                      /* Segundo Enter del lector en el mismo tick: ignorar hasta terminar el primero. */
                      if (quickAddBusyRef.current) return;
                      void submitQuickAddByCode();
                    }
                  }}
                  placeholder="Código / barras / rápido"
                  readOnly={quickAddBusy}
                  disabled={loadingSale || !token}
                  autoComplete="off"
                  className="!min-h-[44px] w-full min-w-[10.5rem] px-2 py-2 font-mono text-sm read-only:bg-pf-surface-elevated/80"
                />
              </td>
              <td className="px-3 py-2 align-middle text-xs leading-snug" onClick={(e) => e.stopPropagation()}>
                {quickAddErr ? (
                  <span className="font-medium text-red-600">{quickAddErr}</span>
                ) : quickAddBusy ? (
                  <span className="text-pf-muted">Buscando…</span>
                ) : (
                  <span className="text-pf-muted">
                    {lines.length === 0
                      ? "Código o barras y Enter → cantidad; Enter sigue a precio y descuento, luego nuevo código."
                      : "Siguiente: código y Enter → cantidad del producto."}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right text-pf-text-tertiary tabular-nums">—</td>
              <td className="px-3 py-2 text-xs text-pf-text-tertiary">—</td>
              <td className="px-3 py-2 text-right text-pf-text-tertiary tabular-nums">—</td>
              <td className="px-3 py-2 text-right text-pf-text-tertiary tabular-nums">—</td>
              <td className="px-3 py-2 text-right text-pf-text-tertiary tabular-nums">—</td>
              <td className="px-3 py-2 text-right text-pf-text-tertiary tabular-nums">—</td>
              <td className="px-2 py-2" onClick={(e) => e.stopPropagation()} />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Resumen monetario (antes estaba duplicado en la cabecera) */}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-x-6 gap-y-2 sm:gap-x-8 rounded-xl border border-pf-border/80 bg-pf-primary-soft/15 px-4 py-3 text-sm">
        <div className="text-right">
          <span className="font-medium text-pf-muted">Subtotal</span>
          <span className="ml-2 font-semibold tabular-nums text-pf-text-secondary">
            {formatMoney(sym, totals.subtotal)}
          </span>
        </div>
        <div className="text-right">
          <span className="font-medium text-pf-muted">Impuesto</span>
          <span className="ml-2 font-semibold tabular-nums text-pf-text-secondary">
            {formatMoney(sym, totals.tax)}
          </span>
        </div>
        <div className="text-right">
          <span className="font-medium text-pf-muted">Total</span>
          <span className="ml-2 text-base font-black tabular-nums text-pf-text sm:text-lg">
            {formatMoney(sym, totals.total)}
          </span>
        </div>
      </div>

      {stockIssueCount > 0 && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-pf-danger/40 bg-pf-danger-soft/30 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-pf-danger" />
          <p className="font-medium text-pf-danger">
            {stockIssueCount === 1
              ? "1 producto excede la existencia disponible. Ajuste la cantidad para poder guardar."
              : `${stockIssueCount} productos exceden la existencia disponible. Ajuste las cantidades para poder guardar.`}
          </p>
        </div>
      )}
      {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
      <Modal
        open={customerSearchOpen}
        title="Buscar cliente"
        onClose={() => setCustomerSearchOpen(false)}
        wide
        maxWidthClass="sm:max-w-2xl"
      >
        <Field label="Código, nombre, teléfono o RTN">
          <Input
            value={customerSearchQ}
            onChange={(e) => setCustomerSearchQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              const n = filteredPickCustomers.length;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (n === 0) return;
                setCustomerPickHighlight((h) => Math.min(h + 1, n - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setCustomerPickHighlight((h) => Math.max(h - 1, 0));
                return;
              }
              if (e.key === "Enter" && n > 0) {
                e.preventDefault();
                applyCustomer(filteredPickCustomers[customerPickHighlight]!);
                setCustomerSearchOpen(false);
              }
            }}
            placeholder="Filtrar la lista…"
            autoComplete="off"
            autoFocus
          />
        </Field>
        <ul className="mt-3 max-h-[min(400px,55vh)] divide-y divide-pf-border/70 overflow-y-auto rounded-lg border border-pf-border">
          {filteredPickCustomers.map((c, idx) => (
            <li key={c.id}>
              <button
                type="button"
                data-customer-pick-index={idx}
                className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition hover:bg-pf-primary-soft/40 ${
                  idx === customerPickHighlight ? "bg-pf-primary-soft/50 ring-2 ring-inset ring-pf-primary" : ""
                }`}
                onClick={() => {
                  setCustomerPickHighlight(idx);
                  applyCustomer(c);
                  setCustomerSearchOpen(false);
                }}
              >
                <span className="font-medium text-pf-text">{c.name}</span>
                <span className="text-xs text-pf-muted">
                  {[c.code && c.code !== "0" ? `Cód. ${c.code}` : null, c.phone, c.taxId].filter(Boolean).join(" · ") ||
                    "—"}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {filteredPickCustomers.length === 0 ? (
          <p className="mt-3 text-center text-sm text-pf-muted">Sin resultados</p>
        ) : null}
      </Modal>

      <Modal
        open={saleDatePickerOpen}
        title="Fecha y hora del documento"
        onClose={() => setSaleDatePickerOpen(false)}
      >
        <p className="mb-3 text-sm text-pf-muted">
          Esta fecha se guardará en la factura al pulsar Guardar o Cobrar (informes y caja la usan como fecha de
          venta).
        </p>
        <Input
          type="datetime-local"
          value={saleDateDraft}
          onChange={(e) => setSaleDateDraft(e.target.value)}
          className="w-full min-h-[44px] max-w-md"
        />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setSaleDatePickerOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => {
              const d = new Date(saleDateDraft);
              if (Number.isNaN(d.getTime())) {
                setErr("Fecha u hora no válida.");
                return;
              }
              setDocumentSaleDate(d);
              setSaleDatePickerOpen(false);
              setErr("");
            }}
          >
            Aplicar
          </Button>
        </div>
      </Modal>

      <CustomerModal
        open={customerCatalogModal.kind !== "closed"}
        existingCustomerId={customerCatalogModal.kind === "edit" ? customerId : null}
        onClose={() => setCustomerCatalogModal({ kind: "closed" })}
        onSaved={applyCustomer}
      />

      <Modal
        open={productSearchOpen}
        title="Buscar producto"
        onClose={() => setProductSearchOpen(false)}
        wide
        maxWidthClass="sm:max-w-5xl"
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:items-end">
          <Field label="Buscar por nombre, código, código de barras o código rápido" className="lg:col-span-5 min-w-0">
            <Input
              value={productSearchQ}
              onChange={(e) => setProductSearchQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (productSearchLoading || productSearchRows.length === 0) return;
                const n = productSearchRows.length;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setProductSearchHighlight((h) => Math.min(h + 1, n - 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setProductSearchHighlight((h) => Math.max(h - 1, 0));
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  const p = productSearchRows[productSearchHighlight];
                  if (!p) return;
                  void addProductById(p.id);
                  setProductSearchOpen(false);
                }
              }}
              placeholder="Escriba para filtrar…"
              autoFocus
            />
          </Field>
          <Field label="Proveedor" className="lg:col-span-4 min-w-0">
            <Select value={productSupplierId} onChange={(e) => setProductSupplierId(e.target.value)}>
              <option value="">Todos los proveedores</option>
              {productSuppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap items-center gap-3 lg:col-span-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-pf-text-secondary">
              <input
                type="checkbox"
                checked={productInStockOnly}
                onChange={(e) => setProductInStockOnly(e.target.checked)}
                className="h-4 w-4 rounded border-pf-border text-pf-primary"
              />
              Solo con existencia
            </label>
            <button
              type="button"
              className="text-sm font-semibold text-pf-primary-hover underline-offset-2 hover:underline"
              onClick={() => {
                setProductSearchQ("");
                setProductSupplierId("");
                setProductInStockOnly(false);
              }}
            >
              Limpiar búsqueda
            </button>
          </div>
        </div>

        {productSearchErr ? <p className="mt-3 text-sm text-red-600">{productSearchErr}</p> : null}

        <div className="mt-3 max-h-[min(65vh,560px)] overflow-auto rounded-xl border border-pf-border bg-pf-surface-elevated shadow-sm">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="pf-table-thead text-left text-xs font-bold uppercase tracking-wide">
                <th className="px-3 py-2.5">Código</th>
                <th className="px-3 py-2.5">Descripción</th>
                <th className="px-3 py-2.5">Und.</th>
                <th className="px-3 py-2.5 text-right">Exist.</th>
                <th className="px-3 py-2.5 text-right">Precio</th>
                <th className="px-3 py-2.5">Categoría</th>
                <th className="px-3 py-2.5">Ubicación</th>
                <th className="px-3 py-2.5">Cód. rápido</th>
                <th className="px-3 py-2.5 text-right">ISV %</th>
              </tr>
            </thead>
            <tbody className="pf-table-body">
              {productSearchLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-pf-muted">
                    Cargando…
                  </td>
                </tr>
              ) : productSearchRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-pf-muted">
                    No hay productos para mostrar. Ajuste filtros o la búsqueda.
                  </td>
                </tr>
              ) : (
                productSearchRows.map((p, idx) => {
                  const outOfStock = tracksStock(p) && p.stock <= 0;
                  const isHi = idx === productSearchHighlight;
                  return (
                    <tr
                      key={p.id}
                      data-product-search-row={idx}
                      tabIndex={-1}
                      className={`pf-table-row cursor-pointer transition hover:bg-pf-primary-soft/40 ${outOfStock ? "bg-pf-danger-soft/20 opacity-70" : ""} ${
                        isHi ? "bg-pf-primary-soft/50 ring-2 ring-inset ring-pf-primary" : ""
                      }`}
                      onClick={() => {
                        setProductSearchHighlight(idx);
                        void addProductById(p.id);
                        setProductSearchOpen(false);
                      }}
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-pf-text-tertiary">{p.sku}</td>
                      <td className="max-w-[280px] px-3 py-2">
                        <span className="font-medium text-pf-text">{p.name}</span>
                        {outOfStock && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-pf-danger-soft/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-pf-danger">
                            <AlertTriangle className="h-3 w-3" />
                            Sin stock
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-pf-text-secondary">{p.unit}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${outOfStock ? "font-semibold text-pf-danger" : ""}`}>
                        {p.stock}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{formatMoney(sym, p.price)}</td>
                      <td className="px-3 py-2 text-pf-text-tertiary">{p.category ?? "—"}</td>
                      <td className="px-3 py-2 text-pf-text-tertiary">{p.location ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs text-pf-text-tertiary">{p.quickCode ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.taxPercent}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Modal>

      <Modal
        open={pickLineForEditOpen}
        title="¿Qué producto editar?"
        onClose={() => setPickLineForEditOpen(false)}
      >
        <p className="mb-3 text-sm text-pf-muted">
          Hay varias líneas en la venta. Elija cuál desea abrir en el catálogo.
        </p>
        <div
          ref={pickLinePanelRef}
          tabIndex={-1}
          className="outline-none focus-visible:ring-2 focus-visible:ring-pf-primary focus-visible:ring-offset-2"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            const n = lines.length;
            if (n === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setPickLineHighlight((h) => Math.min(h + 1, n - 1));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setPickLineHighlight((h) => Math.max(h - 1, 0));
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              const l = lines[pickLineHighlight];
              if (!l) return;
              setPickLineForEditOpen(false);
              setCatalogModal({ kind: "edit", productId: l.productId });
            }
          }}
        >
        <ul className="max-h-[min(360px,50vh)] space-y-2 overflow-y-auto">
          {lines.map((l, idx) => (
            <li key={l.productId}>
              <button
                type="button"
                data-pick-line-index={idx}
                className={`w-full rounded-lg border border-pf-border bg-pf-surface-elevated px-3 py-2.5 text-left text-sm transition hover:bg-pf-primary-soft/40 ${
                  idx === pickLineHighlight ? "bg-pf-primary-soft/50 ring-2 ring-inset ring-pf-primary" : ""
                }`}
                onClick={() => {
                  setPickLineHighlight(idx);
                  setPickLineForEditOpen(false);
                  setCatalogModal({ kind: "edit", productId: l.productId });
                }}
              >
                <span className="font-mono text-xs text-pf-muted">{l.product.sku}</span>
                <span className="ml-2 font-medium text-pf-text">{l.product.name}</span>
              </button>
            </li>
          ))}
        </ul>
        </div>
      </Modal>

      <NewProductModal
        open={catalogModal.kind !== "closed"}
        existingProductId={catalogModal.kind === "edit" ? catalogModal.productId : null}
        onClose={() => setCatalogModal({ kind: "closed" })}
        onSaved={(p) => void addProductById(p.id)}
        onUpdated={refreshLinesWithProduct}
      />

      <Modal
        open={checkoutOpen}
        title="Cobrar Factura"
        onClose={() => setCheckoutOpen(false)}
        maxWidthClass="sm:max-w-md"
      >
        {(() => {
          const total = totals.total;
          const received = Number(checkoutAmountReceived) || 0;
          const cambio = Math.max(0, received - total);
          const saldo = Math.max(0, total - received);
          return (
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4 rounded-xl border border-pf-border bg-pf-primary-soft/25 px-4 py-3">
                  <span className="text-sm font-bold uppercase tracking-wide text-pf-text-tertiary">Total</span>
                  <span className="text-2xl font-black tabular-nums tracking-tight text-pf-text">
                    {formatMoney(sym, total)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-xl border-2 border-pf-primary/40 bg-white px-4 py-3">
                  <label htmlFor="checkout-amount" className="text-sm font-bold uppercase tracking-wide text-pf-text-tertiary">
                    Cantidad
                  </label>
                  <Input
                    ref={checkoutAmountInputRef}
                    id="checkout-amount"
                    type="number"
                    step="any"
                    min={0}
                    className="max-w-[180px] text-right text-xl font-bold"
                    value={checkoutAmountReceived}
                    onChange={(e) => setCheckoutAmountReceived(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (!busy) {
                          setCheckoutOpen(false);
                          void saveSale(checkoutOpts);
                        }
                      }
                    }}
                    placeholder="0.00"
                    autoComplete="off"
                  />
                </div>

                <div className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 ${
                  cambio > 0
                    ? "border-emerald-300 bg-emerald-50"
                    : "border-pf-border bg-pf-surface-elevated"
                }`}>
                  <span className="text-sm font-bold uppercase tracking-wide text-pf-text-tertiary">Cambio</span>
                  <span className={`text-xl font-black tabular-nums ${cambio > 0 ? "text-emerald-600" : "text-pf-text-tertiary"}`}>
                    {formatMoney(sym, cambio)}
                  </span>
                </div>

                <div className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 ${
                  saldo > 0
                    ? "border-amber-300 bg-amber-50"
                    : "border-pf-border bg-pf-surface-elevated"
                }`}>
                  <span className="text-sm font-bold uppercase tracking-wide text-pf-text-tertiary">Saldo</span>
                  <span className={`text-xl font-black tabular-nums ${saldo > 0 ? "text-amber-600" : "text-pf-text-tertiary"}`}>
                    {formatMoney(sym, saldo)}
                  </span>
                </div>
              </div>

              {err ? <p className="text-sm font-medium text-red-600">{err}</p> : null}

              <Button
                type="button"
                className="w-full min-h-12 gap-3 text-base"
                onClick={() => {
                  setCheckoutOpen(false);
                  void saveSale(checkoutOpts);
                }}
                disabled={busy}
              >
                <CheckCircle2 className="h-5 w-5 shrink-0" strokeWidth={2.5} />
                {busy ? "Guardando…" : "Cobrar Factura"}
              </Button>

              {checkoutOpts.autoPrintTicket && (
                <p className="flex items-center justify-center gap-1.5 text-center text-xs text-pf-muted">
                  <Printer className="h-3.5 w-3.5 shrink-0" />
                  Tras cobrar verá solo el diálogo de impresión; no se abre otra pestaña ni la página del comprobante.
                </p>
              )}
            </div>
          );
        })()}
      </Modal>
      </div>
    </div>
  );
}
