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
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api/client";
import { submitSale, isOfflineError } from "../lib/offlineSales";
import { useAuth } from "../auth/AuthContext";
import { useSaleDocumentToolbarSetter } from "../layouts/SaleDocumentToolbarContext";
import { CustomerModal } from "../components/CustomerModal";
import { NewProductModal } from "../components/NewProductModal";
import { Button, Field, Input, Modal, Select } from "../components/ui";
import {
  ToolbarButton,
  ToolbarMenu,
  ToolbarSeparator,
} from "../components/DocumentToolbar";
import { formatMoney } from "../lib/format";
import { printSaleTicketInHiddenFrame } from "../lib/ticketPrint";
import {
  PF_PRODUCT_PICK_CHANNEL,
  PF_PRODUCT_PICK_TYPE,
} from "../lib/saleProductPick";
import { isCreditSaleTerm, SALE_TERMS_OPTIONS } from "../lib/saleTerms";
import { defaultQtyForNewLine, tracksStock } from "../lib/saleLineHelpers";
import {
  DEFAULT_POS_BEHAVIOR,
  parsePosBehavior,
  type PosBehavior,
} from "../lib/posBehavior";
import { resolveProductUnitPrice } from "../lib/volumePrice";
import type { Customer, Product, Sale, Supplier } from "../types";

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

type Line = {
  lineKey: string;
  productId: string;
  product: Product;
  qty: number;
  unitPrice: number;
  discountPercent: number;
};

type CatalogModalState =
  { kind: "closed" } | { kind: "new" } | { kind: "edit"; productId: string };

type CustomerCatalogModal =
  { kind: "closed" } | { kind: "new" } | { kind: "edit" };

const SALE_LINE_FIELDS = ["qty", "price", "disc"] as const;
type SaleLineField = (typeof SALE_LINE_FIELDS)[number];

type SaleDraft = {
  customerId: string;
  customerName: string;
  customerAddress: string;
  customerPhone: string;
  customerTaxId: string;
  priceTier: number;
  terms: string;
  paid: string;
  notes: string;
  sellerName: string;
  documentSaleDate: string;
  lines: Line[];
  selectedLineIndex: number | null;
};

type SaveSaleOptions = {
  destination?: "ticket" | "comprobante";
  autoPrintTicket?: boolean;
  termsOverride?: string;
  paidOverride?: number;
};

type CashSessionStatus = { id: string } | null;
type CashSessionOption = { id: string; user: { displayName: string; username: string } };

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
  | "priceTier";

type SaleHeaderArrowDest = SaleHeaderArrowField | "quickAdd";

type ArrowDir = "up" | "down" | "left" | "right";

/** Cabecera: en estos campos las flechas siempre cambian de celda (texto suele ser corto). */
const HEADER_ARROW_ALWAYS_LEAVE_FIELD: ReadonlySet<SaleHeaderArrowField> =
  new Set(["notes", "address", "phone", "taxId"]);

function arrowKeyToDir(key: string): ArrowDir | null {
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  return null;
}

function shouldMoveFromTextInput(
  el: HTMLInputElement | HTMLTextAreaElement,
  dir: ArrowDir,
): boolean {
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
      if (dir === "down") return "quickAdd";
      return null;
    default:
      return null;
  }
}

function newLineKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `l-${Date.now()}-${Math.random()}`;
}

function computeLineTotal(l: Line): number {
  // El precio de catálogo ya incluye ISV; el descuento se aplica sobre ese total.
  return l.unitPrice * l.qty * (1 - l.discountPercent / 100);
}

function saleLineQtyError(l: Line, posBehavior: PosBehavior): string | null {
  if (!Number.isFinite(l.qty) || l.qty <= 0) {
    return `«${l.product.name}»: indique una cantidad mayor que cero.`;
  }
  if (!posBehavior.warnOutOfStock && tracksStock(l.product) && l.qty > l.product.stock) {
    return l.product.stock <= 0
      ? `«${l.product.name}» no tiene existencia disponible.`
      : `«${l.product.name}»: pide ${l.qty}, pero solo hay ${l.product.stock}.`;
  }
  return null;
}

function saleLineQtyErrorDetail(lines: Line[], posBehavior: PosBehavior): string {
  return lines
    .map((line) => saleLineQtyError(line, posBehavior))
    .filter((msg): msg is string => Boolean(msg))
    .join("; ");
}

function splitTaxIncluded(gross: number, taxPercent: number): { net: number; tax: number } {
  if (!Number.isFinite(taxPercent) || taxPercent <= 0) return { net: gross, tax: 0 };
  const tax = gross * (taxPercent / (100 + taxPercent));
  return { net: gross - tax, tax };
}

function normProductLookup(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function parseOptionalAmount(raw: string): number {
  const t = raw.trim();
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
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

export function NewSalePage() {
  const setSaleToolbar = useSaleDocumentToolbarSetter();
  const { token, organization, user } = useAuth();
  const admin = user?.role === "admin";
  const canOverridePrice = user?.role === "admin";
  const { id: editSaleId } = useParams();
  const isEditMode = Boolean(editSaleId);
  const sym = organization?.currencySymbol ?? "L";
  const navigate = useNavigate();
  const location = useLocation();
  const saleDraftStorageKey = useMemo(() => {
    if (isEditMode) return null;
    const tab = new URLSearchParams(location.search).get("tab") || "default";
    return `pf-sale-draft:${tab}`;
  }, [isEditMode, location.search]);
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
  const [loadedInvoiceNumber, setLoadedInvoiceNumber] = useState<string | null>(
    null,
  );
  const [quickAddCode, setQuickAddCode] = useState("");
  const [quickAddErr, setQuickAddErr] = useState("");
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const [catalogModal, setCatalogModal] = useState<CatalogModalState>({
    kind: "closed",
  });
  const [pickLineForEditOpen, setPickLineForEditOpen] = useState(false);
  const [customerCatalogModal, setCustomerCatalogModal] =
    useState<CustomerCatalogModal>({ kind: "closed" });
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [customerSuggestionsOpen, setCustomerSuggestionsOpen] = useState(false);
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
  const productCacheRef = useRef<Map<string, Product>>(new Map());
  const productLookupCacheRef = useRef<Map<string, string>>(new Map());
  const [selectedLineIndex, setSelectedLineIndex] = useState<number | null>(
    null,
  );
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "print";
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback(
    (message: string, type: "success" | "print") => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToast({ message, type });
      toastTimerRef.current = setTimeout(() => setToast(null), 3500);
    },
    [],
  );
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutAmountReceived, setCheckoutAmountReceived] = useState("");
  const [checkoutOpts, setCheckoutOpts] = useState<SaveSaleOptions>({
    destination: "ticket",
  });
  const [creditFullPaymentConfirmOpen, setCreditFullPaymentConfirmOpen] =
    useState(false);
  const checkoutAmountInputRef = useRef<HTMLInputElement | null>(null);
  /** Fecha/hora del documento (nueva venta editable; en editar venta viene del API). */
  const [documentSaleDate, setDocumentSaleDate] = useState(() => new Date());
  const [saleDatePickerOpen, setSaleDatePickerOpen] = useState(false);
  const [saleDateDraft, setSaleDateDraft] = useState("");
  const [saleExtraOpen, setSaleExtraOpen] = useState(
    () => typeof window === "undefined" || window.matchMedia("(min-width: 640px)").matches,
  );
  const quickAddInputRef = useRef<HTMLInputElement | null>(null);
  /** Evita un segundo Enter (lector) mientras el primero aún procesa; el estado `quickAddBusy` llega tarde en el mismo tick. */
  const quickAddBusyRef = useRef(false);
  /** Tras agregar línea, decide si el flujo vuelve al código o pasa a editar cantidad. */
  const pendingLineFieldFocusRef = useRef<{
    lineIndex: number;
    field: SaleLineField;
  } | null>(null);
  const pendingQuickAddFocusRef = useRef(false);
  const saleTermsRef = useRef<HTMLSelectElement | null>(null);
  const saleCustomerRef = useRef<HTMLInputElement | null>(null);
  const saleAddressRef = useRef<HTMLInputElement | null>(null);
  const salePhoneRef = useRef<HTMLInputElement | null>(null);
  const saleTaxIdRef = useRef<HTMLInputElement | null>(null);
  const saleNotesRef = useRef<HTMLInputElement | null>(null);
  const salePriceTierRef = useRef<HTMLSelectElement | null>(null);
  const saleInvoiceRef = useRef<HTMLInputElement | null>(null);
  const saleFechaRef = useRef<HTMLDivElement | null>(null);
  const [customerPickHighlight, setCustomerPickHighlight] = useState(0);
  const [productSearchHighlight, setProductSearchHighlight] = useState(0);
  const [pickLineHighlight, setPickLineHighlight] = useState(0);
  const pickLinePanelRef = useRef<HTMLDivElement | null>(null);
  const [posBehavior, setPosBehavior] =
    useState<PosBehavior>(DEFAULT_POS_BEHAVIOR);
  const saleDraftReadyRef = useRef(false);
  const [cashSessionChecked, setCashSessionChecked] = useState(false);
  const [cashSessionOpen, setCashSessionOpen] = useState(false);
  const [cashSessions, setCashSessions] = useState<CashSessionOption[]>([]);
  const [cashSessionId, setCashSessionId] = useState("");
  const cashRequiredBlocked = !isEditMode && cashSessionChecked && !cashSessionOpen;
  const cashRequiredLoading = !isEditMode && !cashSessionChecked;

  const refreshCashSession = useCallback(() => {
    if (!token || isEditMode) {
      setCashSessionChecked(true);
      setCashSessionOpen(true);
      return;
    }
    setCashSessionChecked(false);
    const request = admin
      ? apiFetch<CashSessionOption[]>("/api/cash-sessions/open", { token }).then((sessions) => {
          setCashSessions(sessions);
          setCashSessionId((current) => sessions.some((s) => s.id === current) ? current : sessions[0]?.id ?? "");
          setCashSessionOpen(sessions.length > 0);
        })
      : apiFetch<CashSessionStatus>("/api/cash-sessions/current", { token })
          .then((session) => {
            setCashSessions([]);
            setCashSessionId(session?.id ?? "");
            setCashSessionOpen(Boolean(session));
          });
    request
      .catch(() => setCashSessionOpen(false))
      .finally(() => setCashSessionChecked(true));
  }, [admin, isEditMode, token]);

  const openAdminCashSession = useCallback(async () => {
    if (!token || !admin) return;
    setErr("");
    try {
      await apiFetch("/api/cash-sessions/open", {
        method: "POST",
        token,
        body: JSON.stringify({ openingCash: 0 }),
      });
      refreshCashSession();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo abrir la caja administrativa.");
    }
  }, [admin, refreshCashSession, token]);

  const allowedSaleTermOptions = useMemo(() => {
    const allowed = new Set(posBehavior.allowedSaleTerms);
    return SALE_TERMS_OPTIONS.filter((option) => allowed.has(option.value));
  }, [posBehavior.allowedSaleTerms]);

  useEffect(() => {
    if (allowedSaleTermOptions.length === 0) return;
    if (!allowedSaleTermOptions.some((option) => option.value === terms)) {
      setTerms(allowedSaleTermOptions[0].value);
    }
  }, [allowedSaleTermOptions, terms]);

  const rememberProduct = useCallback((p: Product) => {
    productCacheRef.current.set(p.id, p);
    for (const key of [p.sku, p.barcode, p.quickCode]) {
      const normalized = normProductLookup(key);
      if (normalized) productLookupCacheRef.current.set(normalized, p.id);
    }
  }, []);

  const rememberProducts = useCallback(
    (list: Product[]) => {
      for (const p of list) rememberProduct(p);
    },
    [rememberProduct],
  );

  const loadPosBehavior = useCallback(() => {
    if (!token) return;
    apiFetch<{ general?: { posBehavior?: unknown } }>("/api/settings", {
      token,
    })
      .then((s) => setPosBehavior(parsePosBehavior(s.general?.posBehavior)))
      .catch(() => setPosBehavior(DEFAULT_POS_BEHAVIOR));
  }, [token]);

  useEffect(() => {
    loadPosBehavior();
    window.addEventListener("pf-settings-saved", loadPosBehavior);
    return () => window.removeEventListener("pf-settings-saved", loadPosBehavior);
  }, [loadPosBehavior]);

  useEffect(() => {
    refreshCashSession();
  }, [refreshCashSession]);

  useEffect(() => {
    if (!token || isEditMode) return;
    const id = window.setTimeout(() => {
      apiFetch<Product[]>("/api/products?touch=1&forPos=1&limit=120", { token })
        .then(rememberProducts)
        .catch(() => {
          /* precarga opcional */
        });
    }, 250);
    return () => window.clearTimeout(id);
  }, [isEditMode, rememberProducts, token]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 640px)");
    const syncDisclosure = () => setSaleExtraOpen(media.matches);
    syncDisclosure();
    media.addEventListener("change", syncDisclosure);
    return () => media.removeEventListener("change", syncDisclosure);
  }, []);

  useEffect(() => {
    if (isEditMode) return;
    const label = user?.displayName?.trim() || user?.username?.trim() || "";
    setSellerName(label);
  }, [isEditMode, user?.displayName, user?.username]);

  useEffect(() => {
    if (!token) return;
    if (isEditMode) return;
    saleDraftReadyRef.current = false;
    setLoadedInvoiceNumber(null);
    apiFetch<Customer[]>("/api/customers", { token }).then((list) => {
      setCustomerPickList(list);
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
      if (saleDraftStorageKey) {
        try {
          const raw = sessionStorage.getItem(saleDraftStorageKey);
          const draft = raw ? (JSON.parse(raw) as SaleDraft) : null;
          if (draft) {
            setCustomerId(draft.customerId);
            setCustomerName(draft.customerName);
            setCustomerAddress(draft.customerAddress);
            setCustomerPhone(draft.customerPhone);
            setCustomerTaxId(draft.customerTaxId);
            setPriceTier(draft.priceTier);
            priceTierRef.current = draft.priceTier;
            setTerms(draft.terms);
            setPaid(draft.paid);
            setNotes(draft.notes);
            setSellerName(draft.sellerName);
            setDocumentSaleDate(new Date(draft.documentSaleDate));
            setLines(draft.lines);
            setSelectedLineIndex(draft.selectedLineIndex);
          }
        } catch {
          /* borrador inválido: se ignora */
        }
      }
      saleDraftReadyRef.current = true;
    });
  }, [token, isEditMode, saleDraftStorageKey]);

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
            "",
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
          })),
        );
      })
      .catch((e) =>
        setErr(e instanceof Error ? e.message : "No se pudo cargar la venta"),
      )
      .finally(() => setLoadingSale(false));
  }, [token, isEditMode, editSaleId, user?.displayName, user?.username]);

  useEffect(() => {
    if (!saleDraftStorageKey || !saleDraftReadyRef.current) return;
    const draft: SaleDraft = {
      customerId,
      customerName,
      customerAddress,
      customerPhone,
      customerTaxId,
      priceTier,
      terms,
      paid,
      notes,
      sellerName,
      documentSaleDate: documentSaleDate.toISOString(),
      lines,
      selectedLineIndex,
    };
    try {
      sessionStorage.setItem(saleDraftStorageKey, JSON.stringify(draft));
    } catch {
      /* sin almacenamiento disponible */
    }
  }, [
    saleDraftStorageKey,
    customerId,
    customerName,
    customerAddress,
    customerPhone,
    customerTaxId,
    priceTier,
    terms,
    paid,
    notes,
    sellerName,
    documentSaleDate,
    lines,
    selectedLineIndex,
  ]);

  const addProductToSale = useCallback(
    (p: Product, opts?: { focusAfterAdd?: "qty" | "quickAdd" }) => {
      if (cashRequiredBlocked || cashRequiredLoading) {
        setErr("Abra una caja antes de agregar productos a una venta.");
        return;
      }
      if (!p.active || p.productType === "INSUMO") return;
      rememberProduct(p);

      const tier = priceTierRef.current;
      const focusAfterAdd = opts?.focusAfterAdd ?? "qty";
      let focusLineAfter: number | null = null;
      let lineErr = "";
      const queueFocus = (lineIndex: number) => {
        if (focusAfterAdd === "quickAdd") {
          pendingQuickAddFocusRef.current = true;
          pendingLineFieldFocusRef.current = null;
          return;
        }
        pendingQuickAddFocusRef.current = false;
        pendingLineFieldFocusRef.current = { lineIndex, field: "qty" };
      };
      flushSync(() => {
        setLines((prev) => {
          const i = prev.findIndex((l) => l.productId === p.id);
          if (i >= 0) {
            focusLineAfter = i;
            queueFocus(i);
            const next = [...prev];
            let qty = next[i].qty + 1;
            if (!posBehavior.warnOutOfStock && tracksStock(p) && qty > p.stock) {
              lineErr =
                p.stock <= 0
                  ? `«${p.name}» no tiene existencia disponible.`
                  : `«${p.name}»: no puede vender más de ${p.stock} (existencia).`;
              qty = next[i].qty;
            }
            next[i] = {
              ...next[i],
              product: p,
              qty,
              unitPrice: resolveProductUnitPrice(p, qty, tier),
            };
            return next;
          }

          const idx = prev.length;
          focusLineAfter = idx;
          queueFocus(idx);
          const qty = defaultQtyForNewLine(p, { allowOutOfStock: posBehavior.warnOutOfStock });
          if (!posBehavior.warnOutOfStock && tracksStock(p) && qty <= 0) {
            lineErr = `«${p.name}» no tiene existencia disponible.`;
          }
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
          setSelectedLineIndex(focusLineAfter);
        }
      });
      setErr(lineErr);
    },
    [cashRequiredBlocked, cashRequiredLoading, posBehavior.warnOutOfStock, rememberProduct],
  );

  const addProductById = useCallback(
    async (productId: string) => {
      const cached = productCacheRef.current.get(productId);
      if (cached) {
        addProductToSale(cached);
        return;
      }
      if (!token) return;
      try {
        const p = await apiFetch<Product>(`/api/products/${productId}`, {
          token,
        });
        addProductToSale(p);
      } catch {
        /* ignorar */
      }
    },
    [addProductToSale, token],
  );

  const openProductSearchModal = useCallback(
    (opts?: { initialQuery?: string }) => {
      if (opts?.initialQuery !== undefined)
        setProductSearchQ(opts.initialQuery);
      setProductSearchOpen(true);
    },
    [],
  );

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
          : l,
      ),
    );
  }, []);

  const startEditProductFlow = useCallback(() => {
    if (!admin || lines.length === 0) return;
    const sel =
      selectedLineIndex !== null &&
      selectedLineIndex >= 0 &&
      selectedLineIndex < lines.length
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

  const openProductEditorFromLine = useCallback(
    (lineIndex: number) => {
      if (!admin) {
        setErr("Solo un administrador puede editar productos desde la venta.");
        return;
      }
      const line = lines[lineIndex];
      if (!line) return;
      setSelectedLineIndex(lineIndex);
      setCatalogModal({ kind: "edit", productId: line.productId });
    },
    [admin, lines],
  );

  const applyCustomer = useCallback((c: Customer) => {
    setCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerSearchQ(c.name);
    setCustomerSuggestionsOpen(false);
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
        })),
      );
    }
  }, []);

  useEffect(() => {
    if (!customerSearchOpen || !token) return;
    setCustomerSearchQ("");
    apiFetch<Customer[]>("/api/customers", { token })
      .then(setCustomerPickList)
      .catch(() => setCustomerPickList([]));
  }, [customerSearchOpen, token]);

  useEffect(() => {
    if (!token || customerPickList.length > 0) return;
    apiFetch<Customer[]>("/api/customers", { token })
      .then(setCustomerPickList)
      .catch(() => setCustomerPickList([]));
  }, [customerPickList.length, token]);

  useEffect(() => {
    if (!token || customerPickList.length > 0) return;
    apiFetch<Customer[]>("/api/customers", { token })
      .then(setCustomerPickList)
      .catch(() => setCustomerPickList([]));
  }, [customerPickList.length, token]);

  useEffect(() => {
    if (!productSearchOpen || !token) return;
    apiFetch<Supplier[]>("/api/suppliers", { token })
      .then(setProductSuppliers)
      .catch(() => setProductSuppliers([]));
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
        if (productSupplierId.trim())
          params.set("supplierId", productSupplierId.trim());
        const data = await apiFetch<Product[]>(
          `/api/products?${params.toString()}`,
          { token },
        );
        rememberProducts(data);
        setProductSearchRows(
          data.filter((p) => p.active && p.productType !== "INSUMO"),
        );
      } catch (e) {
        setProductSearchErr(
          e instanceof Error ? e.message : "Error al cargar productos",
        );
        setProductSearchRows([]);
      } finally {
        setProductSearchLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(t);
  }, [
    productSearchOpen,
    token,
    productSearchQ,
    productSupplierId,
    productInStockOnly,
    rememberProducts,
  ]);

  const filteredPickCustomers = useMemo(() => {
    const q = customerSearchQ.trim().toLowerCase();
    if (!q) return customerPickList;
    return customerPickList.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.code && c.code.toLowerCase().includes(q)) ||
        (c.taxId && c.taxId.toLowerCase().includes(q)) ||
        (c.phone && c.phone.toLowerCase().includes(q)),
    );
  }, [customerPickList, customerSearchQ]);

  const customerCreateInitialValues = useMemo(
    () => ({
      name: customerName.trim(),
      address: customerAddress.trim(),
      phone: customerPhone.trim(),
      taxId: customerTaxId.trim(),
    }),
    [customerAddress, customerName, customerPhone, customerTaxId],
  );

  const customerSearchHasQuery = customerSearchQ.trim().length >= 2;
  const customerHasExactMatch = filteredPickCustomers.some(
    (c) => c.name.trim().toLowerCase() === customerSearchQ.trim().toLowerCase(),
  );

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
      .querySelector<HTMLElement>(
        `[data-customer-pick-index="${customerPickHighlight}"]`,
      )
      ?.scrollIntoView({ block: "nearest" });
  }, [customerPickHighlight, filteredPickCustomers, customerSearchOpen]);

  useEffect(() => {
    if (!productSearchOpen) return;
    setProductSearchHighlight(0);
  }, [
    productSearchOpen,
    productSearchQ,
    productSupplierId,
    productInStockOnly,
  ]);

  useLayoutEffect(() => {
    if (!productSearchOpen) return;
    setProductSearchHighlight((h) => {
      const n = productSearchRows.length;
      if (n === 0) return 0;
      return Math.min(Math.max(h, 0), n - 1);
    });
  }, [productSearchOpen, productSearchRows.length]);

  useLayoutEffect(() => {
    if (
      !productSearchOpen ||
      productSearchLoading ||
      productSearchRows.length === 0
    )
      return;
    document
      .querySelector<HTMLElement>(
        `[data-product-search-row="${productSearchHighlight}"]`,
      )
      ?.scrollIntoView({ block: "nearest" });
  }, [
    productSearchHighlight,
    productSearchRows,
    productSearchOpen,
    productSearchLoading,
  ]);

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
      .querySelector<HTMLElement>(
        `[data-pick-line-index="${pickLineHighlight}"]`,
      )
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
      selectedLineIndex !== null &&
      selectedLineIndex >= 0 &&
      selectedLineIndex < lines.length
        ? selectedLineIndex
        : lines.length - 1;
    const next = lines.filter((_, j) => j !== delIdx);
    const wasSel =
      selectedLineIndex !== null &&
      selectedLineIndex >= 0 &&
      selectedLineIndex < lines.length
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

  const focusSaleLineField = useCallback(
    (lineIndex: number, field: SaleLineField) => {
      const el = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          `[data-sale-form-line="${lineIndex}"][data-sale-form-field="${field}"]`,
        ),
      ).find((candidate) => candidate.offsetParent !== null);
      if (!el) return;
      el.focus();
      el.select();
    },
    [],
  );

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
        } else if (
          !HEADER_ARROW_ALWAYS_LEAVE_FIELD.has(from) &&
          !shouldMoveFromTextInput(tgt, dir)
        ) {
          return false;
        }
      }

      const next = headerArrowNeighbor(from, dir);
      if (!next) return false;
      e.preventDefault();
      focusHeaderArrowTarget(next);
      return true;
    },
    [terms, focusHeaderArrowTarget],
  );

  const handleSaleHeaderInputKeyDown = useCallback(
    (
      e: ReactKeyboardEvent<HTMLInputElement>,
      field: "customer" | "address" | "phone" | "taxId" | "notes",
    ) => {
      if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const next: Record<typeof field, () => void> = {
        customer: () => saleAddressRef.current?.focus(),
        address: () => salePhoneRef.current?.focus(),
        phone: () => saleTaxIdRef.current?.focus(),
        taxId: () => saleNotesRef.current?.focus(),
        notes: () => salePriceTierRef.current?.focus(),
      };
      const prev: Record<typeof field, () => void> = {
        customer: () => saleTermsRef.current?.focus(),
        address: () => saleCustomerRef.current?.focus(),
        phone: () => saleAddressRef.current?.focus(),
        taxId: () => salePhoneRef.current?.focus(),
        notes: () => saleTaxIdRef.current?.focus(),
      };
      if (e.shiftKey) {
        e.preventDefault();
        prev[field]();
      } else {
        e.preventDefault();
        next[field]();
      }
    },
    [],
  );

  const handleSaleLineInputKeyDown = useCallback(
    (
      e: ReactKeyboardEvent<HTMLInputElement>,
      lineIndex: number,
      field: SaleLineField,
    ) => {
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
        else salePriceTierRef.current?.focus();
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      if (fi < SALE_LINE_FIELDS.length - 1)
        focusSaleLineField(lineIndex, SALE_LINE_FIELDS[fi + 1]);
      /* Tras el último campo de la fila ir siempre al código nuevo (no recorrer fila por fila). */
      else queueMicrotask(() => quickAddInputRef.current?.focus());
    },
    [lines.length, terms, focusSaleLineField],
  );

  const handleSaleTermsKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLSelectElement>) => {
      if (tryHeaderArrowNav(e, "terms")) return;
      if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      saleCustomerRef.current?.focus();
    },
    [tryHeaderArrowNav],
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
      if (lines.length > 0) focusSaleLineField(0, "qty");
      else quickAddInputRef.current?.focus();
    },
    [tryHeaderArrowNav, terms, lines.length, focusSaleLineField],
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
      const key = raw.toLowerCase();
      const cachedId = productLookupCacheRef.current.get(key);
      const cached = cachedId ? productCacheRef.current.get(cachedId) : undefined;
      if (cached && cached.active && cached.productType !== "INSUMO") {
        if (!posBehavior.barcodeAddsLineDirectly) {
          setQuickAddCode("");
          setQuickAddErr("");
          quickAddBusyRef.current = false;
          setQuickAddBusy(false);
          setProductSearchQ(raw);
          setProductSearchOpen(true);
          return;
        }
        addProductToSale(cached, { focusAfterAdd: posBehavior.barcodeFocusAfterAdd });
        focusLineAfter = 0;
        setQuickAddCode("");
        return;
      }
      const list = await apiFetch<Product[]>(
        `/api/products?q=${encodeURIComponent(raw)}&touch=1&forPos=1&limit=120`,
        { token },
      );
      rememberProducts(list);
      const exact = list.find(
        (p) =>
          normProductLookup(p.sku) === key ||
          normProductLookup(p.barcode) === key ||
          normProductLookup(p.quickCode) === key,
      );
      if (!exact || !exact.active || exact.productType === "INSUMO") {
        if (list.length > 0) {
          /* Si el texto coincide por nombre o parcialmente, continúa en el catálogo
             para que el campo funcione como búsqueda, no solo como lector exacto. */
          setQuickAddCode("");
          setQuickAddErr("");
          quickAddBusyRef.current = false;
          setQuickAddBusy(false);
          setProductSearchQ(raw);
          setProductSearchOpen(true);
          return;
        }
        setQuickAddErr("No encontramos productos con ese texto.");
        return;
      }
      if (!posBehavior.barcodeAddsLineDirectly) {
        setQuickAddCode("");
        setQuickAddErr("");
        quickAddBusyRef.current = false;
        setQuickAddBusy(false);
        setProductSearchQ(raw);
        setProductSearchOpen(true);
        return;
      }
      rememberProduct(exact);
      addProductToSale(exact, { focusAfterAdd: posBehavior.barcodeFocusAfterAdd });
      focusLineAfter = 0;
      setQuickAddCode("");
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
  }, [
    addProductToSale,
    rememberProduct,
    rememberProducts,
    token,
    quickAddCode,
    posBehavior.barcodeAddsLineDirectly,
    posBehavior.barcodeFocusAfterAdd,
  ]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (
        e.data?.type === PF_PRODUCT_PICK_TYPE &&
        typeof e.data?.productId === "string"
      ) {
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
      selectedLineIndex !== null &&
      selectedLineIndex >= 0 &&
      selectedLineIndex < lines.length
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
      const gross = computeLineTotal(l);
      const split = splitTaxIncluded(gross, l.product.taxPercent);
      sub += split.net;
      tax += split.tax;
    }
    const rawTotal = sub + tax;
    if (!posBehavior.roundTotals)
      return { subtotal: sub, tax, total: rawTotal };
    return {
      subtotal: roundMoney2(sub),
      tax: roundMoney2(tax),
      total: roundMoney2(rawTotal),
    };
  }, [lines, posBehavior.roundTotals]);

  const canSubmitSaleLines = useMemo(
    () => lines.length > 0 && lines.every((l) => saleLineQtyError(l, posBehavior) === null),
    [lines, posBehavior],
  );

  const stockIssueCount = useMemo(
    () =>
      lines.filter((l) => tracksStock(l.product) && l.qty > l.product.stock)
        .length,
    [lines],
  );

  const validateInitialPayment = useCallback((raw = paid): number | null => {
    const amount = parseOptionalAmount(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      setErr("El abono inicial debe ser un monto válido.");
      return null;
    }
    if (amount > totals.total) {
      setErr(
        `El abono inicial (${formatMoney(sym, amount)}) no puede ser mayor que el total de la factura (${formatMoney(sym, totals.total)}).`,
      );
      return null;
    }
    if (posBehavior.creditRequiresInitialPayment && amount <= 0) {
      setErr("Esta empresa exige un abono inicial para las ventas a plazo.");
      return null;
    }
    return amount;
  }, [paid, sym, totals.total]);

  const saveSale = useCallback(
    async (opts?: SaveSaleOptions) => {
      if (!token || lines.length === 0) return;
      if (cashRequiredBlocked || cashRequiredLoading) {
        setErr("Abra una caja antes de cobrar o guardar esta venta.");
        return;
      }
      const saleTerms = opts?.termsOverride ?? terms;
      setErr("");
      const adminPassword = isEditMode && posBehavior.requireAdminPasswordForSaleChanges
        ? window.prompt("Ingrese la contraseña de un administrador para editar esta factura") ?? ""
        : undefined;
      if (isEditMode && posBehavior.requireAdminPasswordForSaleChanges && !adminPassword) {
        setErr("La edición fue cancelada: se necesita autorización de administrador.");
        return;
      }
      if (!posBehavior.allowedSaleTerms.includes(saleTerms)) {
        setErr("Este tipo de venta no está permitido en configuración.");
        return;
      }
      const qtyErrorDetail = saleLineQtyErrorDetail(lines, posBehavior);
      if (qtyErrorDetail) {
        setErr(`Revise las cantidades antes de guardar: ${qtyErrorDetail}`);
        return;
      }
      if (isCreditSaleTerm(saleTerms) && !customerId.trim()) {
        setErr("Las ventas a crédito requieren un cliente registrado.");
        return;
      }
      const initialPayment = isCreditSaleTerm(saleTerms)
        ? opts?.paidOverride ?? validateInitialPayment()
        : 0;
      if (initialPayment === null) return;
      setBusy(true);
      try {
        if (customerId.trim()) {
          const name = customerName.trim() || "Cliente";
          try {
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
          } catch (e) {
            if (!isOfflineError(e)) throw e; // sin red: la venta sigue; el cambio de cliente se omite
          }
        }
        const body = {
          customerId: customerId || null,
          terms: saleTerms,
          priceTier,
          notes: notes.trim() || undefined,
          sellerName: sellerName.trim() || undefined,
          ...(adminPassword ? { adminPassword } : {}),
          cashSessionId: cashSessionId || undefined,
          paid: isCreditSaleTerm(saleTerms) ? initialPayment : undefined,
          saleDate: documentSaleDate.toISOString(),
          lines: lines
            .map((l) => ({
              productId: l.productId,
              qty: l.qty,
              ...(canOverridePrice
                ? {
                    unitPrice: l.unitPrice,
                    discountPercent: l.discountPercent,
                  }
                : {}),
            })),
        };
        let sale: Sale = { id: "" } as Sale;
        let offline = false;
        if (isEditMode) {
          sale = await apiFetch<Sale>(`/api/sales/${editSaleId}`, {
            method: "PATCH",
            body: JSON.stringify(body),
            token,
          });
        } else {
          const res = await submitSale<Sale>(body, token);
          offline = res.offline;
          if (!res.offline) sale = res.sale;
        }

        if (isEditMode) {
          showToast("Factura actualizada correctamente", "success");
          navigate("/ventas");
        } else if (offline) {
          showToast(
            "Sin conexión: venta guardada y se enviará al reconectar.",
            "success",
          );
        } else if (opts?.destination === "comprobante") {
          showToast("Factura guardada correctamente", "success");
          navigate(`/ventas/${sale.id}/comprobante`);
        } else if (opts?.autoPrintTicket) {
          showToast(
            "Factura guardada. Aparecerá el cuadro de impresión (siga en esta pantalla).",
            "print",
          );
          printSaleTicketInHiddenFrame(sale.id);
        } else if (!isCreditSaleTerm(saleTerms) && posBehavior.immediateSaleDocument === "comprobante") {
          showToast("Factura guardada correctamente", "success");
          navigate(`/ventas/${sale.id}/comprobante`);
        } else if (!isCreditSaleTerm(saleTerms) && posBehavior.immediateSaleDocument === "ticket") {
          showToast("Factura guardada correctamente", "success");
          navigate(`/ventas/${sale.id}/ticket${posBehavior.autoPrintImmediateSale ? "?print=1" : ""}`);
        } else {
          showToast("Factura guardada correctamente", "success");
        }

        if (!isEditMode) {
          if (saleDraftStorageKey) {
            try {
              sessionStorage.removeItem(saleDraftStorageKey);
            } catch {
              /* sin almacenamiento disponible */
            }
            saleDraftReadyRef.current = false;
          }
          setLines([]);
          setSelectedLineIndex(null);
          setNotes("");
          setSellerName(
            user?.displayName?.trim() || user?.username?.trim() || "",
          );
          setPaid("");
          setTerms(allowedSaleTermOptions[0]?.value ?? "CONTADO");
          setQuickAddCode("");
          setQuickAddErr("");
          setErr("");
          setLoadedInvoiceNumber(null);
          setDocumentSaleDate(new Date());
          saleDraftReadyRef.current = true;

          if (token) {
            apiFetch<Customer[]>("/api/customers", { token })
              .then((list) => {
                const def =
                  list.find((x) => /consumidor/i.test(x.name)) ?? list[0];
                if (def) {
                  setCustomerId(def.id);
                  setCustomerName(def.name);
                  setCustomerAddress(def.address ?? "");
                  setCustomerPhone(def.phone ?? "");
                  setCustomerTaxId(def.taxId ?? "");
                }
              })
              .catch(() => {}); // sin red: se conserva el cliente actual
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
      cashRequiredBlocked,
      cashRequiredLoading,
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
      canOverridePrice,
      allowedSaleTermOptions,
      posBehavior,
      saleDraftStorageKey,
      validateInitialPayment,
    ],
  );

  const openCheckout = useCallback(
    (opts: {
      destination: "ticket" | "comprobante";
      autoPrintTicket?: boolean;
    }) => {
      if (!token || lines.length === 0) return;
      if (cashRequiredBlocked || cashRequiredLoading) {
        setErr("Abra una caja antes de cobrar esta venta.");
        return;
      }
      setErr("");
      const qtyErrorDetail = saleLineQtyErrorDetail(lines, posBehavior);
      if (qtyErrorDetail) {
        setErr(`Revise las cantidades antes de cobrar: ${qtyErrorDetail}`);
        return;
      }
      if (isCreditSaleTerm(terms) && !customerId.trim()) {
        setErr("Las ventas a crédito requieren un cliente registrado.");
        return;
      }
      setCheckoutOpts(opts);
      setCheckoutAmountReceived(isCreditSaleTerm(terms) ? paid.trim() : "");
      setCheckoutOpen(true);
      setTimeout(() => checkoutAmountInputRef.current?.focus(), 80);
    },
    [
      token,
      cashRequiredBlocked,
      cashRequiredLoading,
      lines,
      terms,
      customerId,
      posBehavior,
      paid,
    ],
  );

  const confirmCheckout = useCallback(() => {
    const received = Number(checkoutAmountReceived);
    if (!Number.isFinite(received) || received < 0) {
      setErr("Ingrese una cantidad recibida válida.");
      return;
    }
    if (received < totals.total) {
      setErr(
        `Cantidad recibida insuficiente: faltan ${formatMoney(sym, totals.total - received)} para completar la factura.`,
      );
      return;
    }
    setCheckoutOpen(false);
    void saveSale(checkoutOpts);
  }, [checkoutAmountReceived, checkoutOpts, saveSale, sym, totals.total]);

  const confirmCreditCheckout = useCallback(() => {
    const amount = validateInitialPayment(checkoutAmountReceived);
    if (amount === null) return;
    if (amount === totals.total && totals.total > 0) {
      setCreditFullPaymentConfirmOpen(true);
      return;
    }
    setPaid(amount > 0 ? String(amount) : "");
    setCheckoutOpen(false);
    void saveSale({ ...checkoutOpts, paidOverride: amount });
  }, [checkoutAmountReceived, checkoutOpts, saveSale, totals.total, validateInitialPayment]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const commandKey = e.ctrlKey || e.metaKey;
      const isSaleFunctionKey = /^F(?:2|3|4|5|6|8|9|10|11)$/.test(e.key);
      const isSaleCommand =
        (commandKey && (e.key.toLowerCase() === "k" || e.key === "Enter")) || isSaleFunctionKey;

      // Los F-keys no escriben dentro de un campo: deben seguir funcionando
      // mientras el cajero escanea o edita una línea. También bloqueamos la
      // acción nativa del navegador cuando el evento todavía es cancelable.
      if (isSaleCommand) e.preventDefault();
      if ((cashRequiredBlocked || cashRequiredLoading) && isSaleCommand) return;

      // Atajos alternativos para Chrome/Edge, que pueden reservar F4/F5.
      if (commandKey && e.key.toLowerCase() === "k") {
        if (e.shiftKey) setCustomerSearchOpen(true);
        else openProductSearchModal();
        return;
      }
      if (commandKey && e.key === "Enter") {
        if (busy || loadingSale || lines.length === 0) return;
        if (isCreditSaleTerm(terms) && !customerId.trim()) return;
        openCheckout({ destination: "ticket", autoPrintTicket: e.shiftKey });
        return;
      }

      const t = e.target;
      if (
        !isSaleFunctionKey &&
        t instanceof HTMLElement &&
        t.closest("input, textarea, select, [contenteditable=true]")
      )
        return;
      if (e.key === "F2") {
        setCustomerSearchOpen(true);
        return;
      }
      if (e.key === "F3") {
        if (admin) setCatalogModal({ kind: "new" });
        return;
      }
      if (e.key === "F4") {
        openProductSearchModal();
        return;
      }
      if (e.key === "F6") {
        setCustomerCatalogModal({ kind: "new" });
        return;
      }
      if (e.key === "F9") {
        insertRowAfterSelection();
        return;
      }
      if (e.key === "F10") {
        deleteSelectedOrLastRow();
        return;
      }
      if (e.key === "F11") {
        clearLines();
        return;
      }
      if (e.key !== "F5" && e.key !== "F8") return;
      if (busy || loadingSale || lines.length === 0) return;
      if (isCreditSaleTerm(terms) && !customerId.trim()) return;
      if (e.key === "F8")
        openCheckout({ destination: "ticket", autoPrintTicket: true });
      else openCheckout({ destination: "ticket" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    admin,
    busy,
    cashRequiredBlocked,
    cashRequiredLoading,
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
    [documentSaleDate],
  );

  const saleRibbonBar = useMemo(
    () => (
      <>
        <ToolbarButton
          tone="primary"
          mobilePriority="primary"
          icon={Save}
          label={isEditMode ? "Guardar cambios" : "Guardar venta"}
          shortcut="F5 / Ctrl+Enter"
          title={isEditMode ? "Guardar cambios (F5 o Ctrl+Enter)" : "Guardar venta (F5 o Ctrl+Enter)"}
          onClick={() => openCheckout({ destination: "ticket" })}
          disabled={busy || !canSubmitSaleLines || loadingSale || cashRequiredBlocked || cashRequiredLoading}
        />
        <ToolbarButton
          icon={Printer}
          label="Imprimir"
          shortcut="F8 / Ctrl+Shift+Enter"
          title="Guardar e imprimir ticket térmico (F8 o Ctrl+Shift+Enter)"
          onClick={() =>
            openCheckout({ destination: "ticket", autoPrintTicket: true })
          }
          disabled={busy || !canSubmitSaleLines || loadingSale || cashRequiredBlocked || cashRequiredLoading}
        />
        <ToolbarSeparator />
        <ToolbarButton
          icon={Users}
          label="Cliente"
          shortcut="F2"
          title="Buscar y elegir cliente (F2)"
          onClick={() => setCustomerSearchOpen(true)}
        />
        <ToolbarButton
          mobilePriority="overflow"
          icon={Search}
          label="Productos"
          shortcut="F4 / Ctrl+K"
          title="Buscar productos (F4 o Ctrl+K)"
          onClick={openProductSearchModal}
          disabled={cashRequiredBlocked || cashRequiredLoading}
        />
        <ToolbarSeparator />
        <ToolbarButton
          mobilePriority="overflow"
          icon={Plus}
          label="Insertar fila"
          shortcut="F9"
          title="Enfocar el campo Código / barras / rápido para agregar un producto (no copia la fila seleccionada)"
          onClick={insertRowAfterSelection}
          disabled={cashRequiredBlocked || cashRequiredLoading}
        />
        <ToolbarButton
          tone="danger"
          mobilePriority="overflow"
          icon={X}
          label="Eliminar fila"
          shortcut="F10"
          title="Eliminar la fila seleccionada o la última (F10)"
          onClick={deleteSelectedOrLastRow}
          disabled={lines.length === 0 || cashRequiredBlocked || cashRequiredLoading}
        />
        <ToolbarSeparator />
        <ToolbarMenu
          items={[
            {
              icon: FileText,
              label: "Guardar y abrir factura carta",
              onClick: () => openCheckout({ destination: "comprobante" }),
              disabled: busy || !canSubmitSaleLines || loadingSale || cashRequiredBlocked || cashRequiredLoading,
            },
            {
              icon: Search,
              label: "Buscar productos",
              shortcut: "F4 / Ctrl+K",
              onClick: openProductSearchModal,
              disabled: cashRequiredBlocked || cashRequiredLoading,
            },
            {
              icon: Plus,
              label: "Agregar producto por código",
              shortcut: "F9",
              onClick: insertRowAfterSelection,
              disabled: cashRequiredBlocked || cashRequiredLoading,
            },
            {
              icon: X,
              label: "Eliminar fila seleccionada",
              shortcut: "F10",
              onClick: deleteSelectedOrLastRow,
              disabled: lines.length === 0 || cashRequiredBlocked || cashRequiredLoading,
              danger: true,
            },
            {
              icon: UserPlus,
              label: "Nuevo cliente",
              shortcut: "F6",
              onClick: () => setCustomerCatalogModal({ kind: "new" }),
            },
            {
              icon: Pencil,
              label: "Editar cliente",
              onClick: startEditCustomerFlow,
              disabled: !customerId.trim(),
            },
            {
              icon: Plus,
              label: "Nuevo producto",
              shortcut: "F3",
              onClick: () => admin && setCatalogModal({ kind: "new" }),
              disabled: !admin,
            },
            {
              icon: Pencil,
              label: "Editar producto",
              onClick: startEditProductFlow,
              disabled: !admin || lines.length === 0,
            },
            {
              icon: Eraser,
              label: "Vaciar líneas",
              shortcut: "F11",
              onClick: clearLines,
              disabled: lines.length === 0,
              danger: true,
            },
          ]}
        />
      </>
    ),
    [
      admin,
      busy,
      cashRequiredBlocked,
      cashRequiredLoading,
      clearLines,
      customerId,
      deleteSelectedOrLastRow,
      canSubmitSaleLines,
      insertRowAfterSelection,
      isEditMode,
      lines.length,
      loadingSale,
      openCheckout,
      openProductSearchModal,
      startEditCustomerFlow,
      startEditProductFlow,
    ],
  );

  useLayoutEffect(() => {
    if (pendingQuickAddFocusRef.current) {
      pendingQuickAddFocusRef.current = false;
      quickAddBusyRef.current = false;
      setQuickAddBusy(false);
      const el = quickAddInputRef.current;
      if (el && !el.disabled) {
        el.focus({ preventScroll: true });
        el.select();
      }
      return;
    }
    const p = pendingLineFieldFocusRef.current;
    if (!p) return;
    pendingLineFieldFocusRef.current = null;
    const focusLineField = (): boolean => {
      const el = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          `[data-sale-form-line="${p.lineIndex}"][data-sale-form-field="${p.field}"]`,
        ),
      ).find((candidate) => candidate.offsetParent !== null);
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
              ? "border-pf-info-soft bg-pf-info-soft text-pf-info"
              : "border-pf-success-soft bg-pf-success-soft text-pf-success"
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
      {cashRequiredLoading ? (
        <div className="rounded-xl border border-pf-border bg-pf-surface-elevated p-6 text-center shadow-sm">
          <p className="text-sm font-bold text-pf-text">Verificando caja abierta…</p>
          <p className="mt-1 text-sm text-pf-muted">Un momento antes de iniciar la venta.</p>
        </div>
      ) : cashRequiredBlocked ? (
        <div className="rounded-xl border border-pf-warning-soft bg-pf-warning-soft p-6 shadow-sm">
          <div className="mx-auto max-w-xl text-center">
            <p className="text-lg font-black text-pf-text">Caja requerida</p>
            <p className="mt-2 text-sm leading-6 text-pf-text-secondary">
              Para vender, cobrar o recibir abonos debe haber una caja abierta. Así cada entrada o salida de dinero queda registrada en una caja.
            </p>
            <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
              {admin && (
                <Button type="button" className="min-h-12" onClick={() => void openAdminCashSession()}>
                  Usar una caja administrativa
                </Button>
              )}
              <Button type="button" className="min-h-12" onClick={() => navigate("/caja")}>
                {admin ? "Ver y controlar otras cajas" : "Abrir caja"}
              </Button>
              <Button type="button" variant="secondary" className="min-h-12" onClick={refreshCashSession}>
                Ya abrí caja, verificar
              </Button>
            </div>
            {err && <p className="mt-3 text-sm font-semibold text-pf-danger" role="alert">{err}</p>}
          </div>
        </div>
      ) : null}
      {cashRequiredLoading || cashRequiredBlocked ? null : (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
        {admin && cashSessions.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-pf-border bg-white px-3 py-2 text-sm">
            <span className="font-semibold text-pf-text">Registrar en caja:</span>
            <Select value={cashSessionId} onChange={(e) => setCashSessionId(e.target.value)} className="min-w-[14rem]">
              {cashSessions.map((session) => <option key={session.id} value={session.id}>{session.user.displayName} (@{session.user.username})</option>)}
            </Select>
          </div>
        )}
        <div className="pf-sale-grid-shell">
          <div className="pf-sale-doc-header">
            <h1 className="pf-doc-section-title pf-doc-section-title-compact px-2 sm:px-2.5">
              {isEditMode ? "Editar venta" : "Nueva venta"}
            </h1>

            <div className="w-full min-w-0 rounded-lg border border-pf-border bg-white p-1.5 shadow-sm ring-1 ring-pf-border/70 sm:p-2">
              <div className="grid grid-cols-1 gap-1 min-[900px]:grid-cols-2 xl:grid-cols-12 xl:items-start xl:gap-x-1.5 xl:gap-y-0.5">
                {/* Columna documento: Nº factura, términos, fecha */}
                <div className="pf-sale-doc-key-fields flex min-w-0 flex-col gap-0.5 xl:col-span-2">
                  <Field label="Nº factura" className="min-w-0" compact>
                    <Input
                      readOnly
                      ref={saleInvoiceRef}
                      tabIndex={-1}
                      value={
                        loadedInvoiceNumber &&
                        String(loadedInvoiceNumber).trim()
                          ? loadedInvoiceNumber
                          : "—"
                      }
                      className="!h-7 !min-h-[28px] cursor-default bg-pf-primary-soft/25 px-1.5 py-0 text-xs tabular-nums text-pf-text"
                      title={
                        isEditMode
                          ? "Número de factura"
                          : "Se asignará al guardar"
                      }
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
                      {allowedSaleTermOptions.map((o) => (
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
                            setSaleDateDraft(
                              toDatetimeLocalValue(documentSaleDate),
                            );
                            setSaleDatePickerOpen(true);
                          }}
                        >
                          <CalendarClock
                            className="h-3 w-3 shrink-0"
                            strokeWidth={2}
                            aria-hidden
                          />
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
                    <div className="relative">
                      <Input
                        ref={saleCustomerRef}
                        value={customerName}
                        onFocus={() => {
                          setCustomerSearchQ(customerName);
                          setCustomerSuggestionsOpen(
                            customerName.trim().length >= 2,
                          );
                        }}
                        onBlur={() =>
                          window.setTimeout(
                            () => setCustomerSuggestionsOpen(false),
                            140,
                          )
                        }
                        onChange={(e) => {
                          const nextName = e.target.value;
                          setCustomerName(nextName);
                          setCustomerSearchQ(nextName);
                          setCustomerSuggestionsOpen(
                            nextName.trim().length >= 2,
                          );
                          if (
                            customerId &&
                            nextName.trim() !== customerName.trim()
                          ) {
                            setCustomerId("");
                            setCustomerAddress("");
                            setCustomerPhone("");
                            setCustomerTaxId("");
                          }
                        }}
                        placeholder="Buscar cliente o escribir uno nuevo"
                        autoComplete="off"
                        className={`!h-7 !min-h-[28px] px-1.5 py-0 text-xs ${customerId ? "border-pf-success/60 bg-pf-success-soft/30" : ""}`}
                        onKeyDown={(e) => {
                          if (
                            customerSuggestionsOpen &&
                            customerSearchHasQuery &&
                            filteredPickCustomers.length > 0
                          ) {
                            if (e.key === "ArrowDown") {
                              e.preventDefault();
                              setCustomerPickHighlight((h) =>
                                Math.min(
                                  h + 1,
                                  filteredPickCustomers.length - 1,
                                ),
                              );
                              return;
                            }
                            if (e.key === "ArrowUp") {
                              e.preventDefault();
                              setCustomerPickHighlight((h) =>
                                Math.max(h - 1, 0),
                              );
                              return;
                            }
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const selected =
                                filteredPickCustomers[customerPickHighlight];
                              if (selected) applyCustomer(selected);
                              return;
                            }
                          }
                          if (tryHeaderArrowNav(e, "customer")) return;
                          handleSaleHeaderInputKeyDown(e, "customer");
                        }}
                      />
                      {customerSuggestionsOpen && customerSearchHasQuery ? (
                        <div
                          className="absolute left-0 right-0 top-[calc(100%+0.3rem)] z-40 overflow-hidden rounded-xl border border-pf-border bg-pf-surface-elevated shadow-[var(--pf-shadow-lg)]"
                          role="listbox"
                          aria-label="Clientes coincidentes"
                        >
                          {filteredPickCustomers.slice(0, 6).map((c, index) => (
                            <button
                              key={c.id}
                              type="button"
                              role="option"
                              aria-selected={index === customerPickHighlight}
                              className={`flex w-full items-center justify-between gap-3 border-b border-pf-border-soft px-3 py-2 text-left text-xs last:border-b-0 ${
                                index === customerPickHighlight
                                  ? "bg-pf-primary-soft/60"
                                  : "hover:bg-pf-surface-muted"
                              }`}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => applyCustomer(c)}
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-pf-text">
                                  {c.name}
                                </span>
                                <span className="block truncate text-[11px] text-pf-text-tertiary">
                                  {[c.taxId, c.phone]
                                    .filter(Boolean)
                                    .join(" · ") || "Sin datos adicionales"}
                                </span>
                              </span>
                              {c.defaultPriceTier ? (
                                <span className="shrink-0 rounded-md bg-pf-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-pf-text-secondary">
                                  Precio {c.defaultPriceTier}
                                </span>
                              ) : null}
                            </button>
                          ))}
                          {filteredPickCustomers.length === 0 &&
                          !customerHasExactMatch ? (
                            <div className="flex items-center justify-between gap-3 px-3 py-3">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-pf-text">
                                  Cliente nuevo
                                </p>
                                <p className="mt-0.5 text-[11px] text-pf-text-tertiary">
                                  No encontramos “{customerSearchQ.trim()}”.
                                  ¿Desea guardar sus datos?
                                </p>
                                {customerTaxId.trim() ? (
                                  <p className="mt-1 text-[10px] font-semibold text-pf-success">
                                    RTN incluido en el formulario
                                  </p>
                                ) : null}
                              </div>
                              <Button
                                type="button"
                                variant="secondary"
                                className="min-h-8 shrink-0 gap-1.5 px-2.5 py-1 text-xs"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setCustomerSuggestionsOpen(false);
                                  setCustomerCatalogModal({ kind: "new" });
                                }}
                              >
                                <UserPlus
                                  className="h-3.5 w-3.5"
                                  strokeWidth={2}
                                  aria-hidden
                                />
                                Guardar cliente
                              </Button>
                            </div>
                          ) : null}
                          {filteredPickCustomers.length > 6 ? (
                            <button
                              type="button"
                              className="w-full border-t border-pf-border-soft px-3 py-2 text-left text-[11px] font-semibold text-pf-primary-hover hover:bg-pf-primary-soft/40"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setCustomerSuggestionsOpen(false);
                                setCustomerSearchOpen(true);
                              }}
                            >
                              Ver todos los clientes (
                              {filteredPickCustomers.length}) · F2
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </Field>
                  <div className="pf-sale-customer-contact grid grid-cols-1 gap-0.5 sm:grid-cols-3 xl:grid-cols-3 sm:gap-1">
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

                {/* Los datos secundarios se pliegan en teléfono: cliente y productos
                    siguen siendo el primer tramo visible del flujo de cobro. */}
                <details
                  className="pf-sale-extra-details min-h-0 min-w-0 xl:col-span-6"
                  open={saleExtraOpen}
                  onToggle={(e) => setSaleExtraOpen(e.currentTarget.open)}
                >
                  <summary>Datos de venta y lista de precios</summary>
                  <div className="pf-sale-extra-details-body min-h-0 min-w-0 flex-col gap-0.5">
                  <Field
                    label="Vendedor (opc.)"
                    className="min-w-0 shrink-0"
                    compact
                  >
                    <Input
                      value={sellerName}
                      onChange={(e) => setSellerName(e.target.value)}
                      placeholder="Nombre en ticket / reportes"
                      className="!h-7 !min-h-[28px] px-1.5 py-0 text-xs"
                    />
                  </Field>
                  <Field
                    label="Notas (opc.)"
                    className="min-w-0 shrink-0"
                    compact
                  >
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
                  <Field
                    label="Lista de precios"
                    className="min-w-0 shrink-0"
                    compact
                  >
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
                </details>
              </div>

              {isCreditSaleTerm(terms) ? (
                <div className="mt-1.5 border-t border-pf-border/60 pt-1.5">
                  <p className="rounded-lg bg-pf-primary-soft/40 px-2.5 py-1.5 text-[10px] font-medium text-pf-muted">
                    Cliente obligatorio para crédito. El abono inicial se pedirá al cobrar.
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="pf-sale-product-row flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-pf-primary-soft text-pf-primary-hover">
                <Search className="h-4 w-4" strokeWidth={2.2} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-pf-text">
                  Agregar productos
                </p>
                <p className="truncate text-[11px] text-pf-text-tertiary">
                  Escanee un código o busque en el catálogo
                </p>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:max-w-xl sm:justify-end">
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
                    if (lines.length > 0)
                      focusSaleLineField(lines.length - 1, "qty");
                    else salePriceTierRef.current?.focus();
                    return;
                  }
                  if (e.key === "Enter") {
                    if (e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (quickAddBusyRef.current) return;
                    void submitQuickAddByCode();
                  }
                }}
                placeholder="Código, barras o código rápido"
                readOnly={quickAddBusy}
                disabled={loadingSale || !token || cashRequiredBlocked || cashRequiredLoading}
                autoComplete="off"
                className="min-h-10 min-w-0 flex-1 font-mono text-sm read-only:bg-pf-surface-muted"
                aria-label="Agregar producto por código"
              />
              {quickAddErr ? (
                <p className="basis-full text-xs font-semibold text-pf-danger">
                  {quickAddErr}
                </p>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                className="min-h-10 shrink-0 gap-1.5 px-3"
                onClick={() => openProductSearchModal()}
                title="Buscar productos (F4)"
              >
                <Search className="h-4 w-4" strokeWidth={2} aria-hidden />
                <span className="hidden sm:inline">Catálogo</span>
                <span className="text-[10px] text-pf-text-tertiary">F4</span>
              </Button>
            </div>
          </div>
        </div>

        {/* En móvil las líneas son tarjetas editables: cantidad, precio y total
            caben en el ancho útil sin esconder el botón de quitar. */}
        <div className="overflow-hidden rounded-b-2xl border border-t-0 border-pf-border bg-pf-surface-elevated shadow-[var(--pf-shadow-sm)] sm:hidden">
          {lines.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-sm font-semibold text-pf-text">
                Todavía no hay productos en la venta
              </p>
              <p className="mt-1 text-xs text-pf-text-tertiary">
                Escanee un código arriba o abra el catálogo para empezar.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-pf-border-soft">
              {lines.map((l, i) => (
                <article
                  key={l.lineKey}
                  onClick={() => setSelectedLineIndex(i)}
                  onDoubleClick={() => openProductEditorFromLine(i)}
                  className={`p-3 transition-colors ${
                    selectedLineIndex === i
                      ? "bg-pf-primary-soft/45 shadow-[inset_3px_0_0_0_var(--pf-primary-mid)]"
                      : posBehavior.showStockWhileSelling &&
                          tracksStock(l.product) &&
                          l.qty > l.product.stock
                        ? "bg-pf-danger-soft/30"
                        : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-bold leading-snug text-pf-text">
                        {l.product.name}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-pf-text-tertiary">
                        {l.product.sku} · {l.product.unit}
                      </p>
                      {posBehavior.showStockWhileSelling ? (
                        <p
                          className={`mt-1 text-[11px] font-medium ${
                            tracksStock(l.product) && l.qty > l.product.stock
                              ? "text-pf-danger"
                              : "text-pf-muted"
                          }`}
                        >
                          {l.product.productType === "KIT"
                            ? "Combo (exist. por componentes)"
                            : `Exist. ${l.product.stock}`}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      aria-label={`Quitar ${l.product.name}`}
                      title={`Quitar ${l.product.name}`}
                      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-pf-danger transition hover:bg-pf-danger-soft active:scale-95 touch-manipulation"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeLine(i);
                      }}
                    >
                      <X className="h-4 w-4" strokeWidth={2.2} aria-hidden />
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                    <label className="min-w-0">
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-pf-text-tertiary">
                        Cant.
                      </span>
                      <Input
                        type="number"
                        step="any"
                        data-sale-form-line={i}
                        data-sale-form-field="qty"
                        className="!min-h-11 w-full px-2 py-2 text-right text-sm tabular-nums [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={l.qty}
                        onFocus={() => setSelectedLineIndex(i)}
                        onKeyDown={(e) => handleSaleLineInputKeyDown(e, i, "qty")}
                        onChange={(e) => {
                          const parsed = Number(e.target.value);
                          let qty = Number.isFinite(parsed)
                            ? Math.max(0, parsed)
                            : l.qty;

                          if (
                            !posBehavior.warnOutOfStock &&
                            tracksStock(l.product)
                          ) {
                            const cap = l.product.stock;
                            if (!l.product.esGranel) qty = Math.round(qty);
                            if (qty > cap) {
                              setErr(
                                `«${l.product.name}»: no puede vender más de ${cap} (existencia). Aumente el stock en Productos antes de continuar.`,
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
                            qty = Number.isFinite(parsed)
                              ? Math.max(0, parsed)
                              : l.qty;
                            if (qty > 0 && qty < 0.0001) qty = 0.0001;
                          }

                          updateLine(i, {
                            qty,
                            unitPrice: resolveProductUnitPrice(
                              l.product,
                              qty,
                              priceTier,
                            ),
                          });
                        }}
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-pf-text-tertiary">
                        Precio final
                      </span>
                      <Input
                        type="number"
                        step="any"
                        data-sale-form-line={i}
                        data-sale-form-field="price"
                        className="!min-h-11 w-full px-2 py-2 text-right text-sm tabular-nums [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={l.unitPrice}
                        readOnly={!canOverridePrice}
                        aria-readonly={!canOverridePrice}
                        title={
                          canOverridePrice
                            ? "Puede ajustar el precio con el permiso sales.price_override"
                            : "El precio se toma del catálogo"
                        }
                        onFocus={() => setSelectedLineIndex(i)}
                        onKeyDown={(e) => handleSaleLineInputKeyDown(e, i, "price")}
                        onChange={(e) =>
                          updateLine(i, {
                            unitPrice: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </label>
                    <div className="min-w-[4.75rem] rounded-lg bg-pf-surface px-2 py-2 text-right">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-pf-text-tertiary">
                        Total
                      </p>
                      <p className="mt-0.5 text-sm font-black tabular-nums text-pf-text">
                        {formatMoney(sym, computeLineTotal(l))}
                      </p>
                    </div>
                  </div>

                  {canOverridePrice ? (
                    <label className="mt-2 block max-w-[10rem]">
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-pf-text-tertiary">
                        Descuento %
                      </span>
                      <Input
                        type="number"
                        step="any"
                        data-sale-form-line={i}
                        data-sale-form-field="disc"
                        className="!min-h-11 w-full px-2 py-2 text-right text-sm tabular-nums [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={l.discountPercent}
                        onFocus={() => setSelectedLineIndex(i)}
                        onKeyDown={(e) => handleSaleLineInputKeyDown(e, i, "disc")}
                        onChange={(e) =>
                          updateLine(i, {
                            discountPercent: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </label>
                  ) : l.discountPercent > 0 ? (
                    <p className="mt-2 text-xs font-medium text-pf-text-tertiary">
                      Descuento aplicado: {l.discountPercent}%
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>

        {/* Cuadrícula completa para teclado y escritorio. */}
        <div className="hidden flex-1 overflow-x-auto rounded-b-2xl border border-t-0 border-pf-border bg-pf-surface-elevated shadow-[var(--pf-shadow-sm)] sm:block">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="pf-table-thead text-left uppercase tracking-wide">
                <th className="px-2 py-2 w-24">Código</th>
                <th className="px-2 py-2">Descripción</th>
                <th className="px-2 py-2 w-[6rem] text-right">Cant.</th>
                <th className="px-2 py-2 w-14">Und.</th>
                <th className="px-2 py-2 w-32 text-right">Precio final</th>
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
                  onDoubleClick={() => openProductEditorFromLine(i)}
                  className={`pf-table-row cursor-pointer transition hover:bg-pf-surface ${
                    selectedLineIndex === i
                      ? "bg-[linear-gradient(to_right,var(--pf-row-selected-from),var(--pf-row-selected-to))]"
                      : posBehavior.showStockWhileSelling &&
                          tracksStock(l.product) &&
                          l.qty > l.product.stock
                        ? "bg-pf-danger-soft/30"
                        : ""
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-xs text-pf-text-tertiary">
                    {l.product.sku}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-medium text-pf-text">
                      {l.product.name}
                    </span>
                    {posBehavior.showStockWhileSelling ? (
                      <>
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
                        {tracksStock(l.product) &&
                          l.product.stock > 0 &&
                          l.qty > l.product.stock && (
                            <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-pf-danger">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              Excede existencia por{" "}
                              {(l.qty - l.product.stock).toFixed(
                                l.product.esGranel ? 2 : 0,
                              )}
                            </span>
                          )}
                      </>
                    ) : null}
                  </td>
                  <td
                    className="px-3 py-2 text-right"
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
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
                        let qty = Number.isFinite(parsed)
                          ? Math.max(0, parsed)
                          : l.qty;

                        if (
                          !posBehavior.warnOutOfStock &&
                          tracksStock(l.product)
                        ) {
                          const cap = l.product.stock;
                          if (!l.product.esGranel) qty = Math.round(qty);
                          if (qty > cap) {
                            setErr(
                              `«${l.product.name}»: no puede vender más de ${cap} (existencia). Aumente el stock en Productos antes de continuar.`,
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
                          qty = Number.isFinite(parsed)
                            ? Math.max(0, parsed)
                            : l.qty;
                          if (qty > 0 && qty < 0.0001) qty = 0.0001;
                        }

                        updateLine(i, {
                          qty,
                          unitPrice: resolveProductUnitPrice(
                            l.product,
                            qty,
                            priceTier,
                          ),
                        });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-pf-text-tertiary">
                    {l.product.unit}
                  </td>
                  <td
                    className="px-3 py-2 text-right"
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    <Input
                      type="number"
                      step="any"
                      data-sale-form-line={i}
                      data-sale-form-field="price"
                      className="!min-h-[44px] w-full min-w-[5.5rem] px-2 py-2 text-right text-sm tabular-nums [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      value={l.unitPrice}
                      readOnly={!canOverridePrice}
                      aria-readonly={!canOverridePrice}
                      title={
                        canOverridePrice
                          ? "Puede ajustar el precio con el permiso sales.price_override"
                          : "El precio se toma del catálogo"
                      }
                      onFocus={() => setSelectedLineIndex(i)}
                      onKeyDown={(e) =>
                        handleSaleLineInputKeyDown(e, i, "price")
                      }
                      onChange={(e) =>
                        updateLine(i, {
                          unitPrice: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </td>
                  <td
                    className="px-3 py-2 text-right"
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    <Input
                      type="number"
                      step="any"
                      data-sale-form-line={i}
                      data-sale-form-field="disc"
                      className="!min-h-[44px] w-full min-w-[4.5rem] px-2 py-2 text-right text-sm tabular-nums [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      value={l.discountPercent}
                      readOnly={!canOverridePrice}
                      aria-readonly={!canOverridePrice}
                      title={
                        canOverridePrice
                          ? "Puede aplicar descuentos con el permiso sales.price_override"
                          : "Los descuentos requieren autorización"
                      }
                      onFocus={() => setSelectedLineIndex(i)}
                      onKeyDown={(e) =>
                        handleSaleLineInputKeyDown(e, i, "disc")
                      }
                      onChange={(e) =>
                        updateLine(i, {
                          discountPercent: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-pf-text-tertiary">
                    {l.product.taxPercent}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatMoney(sym, computeLineTotal(l))}
                  </td>
                  <td
                    className="px-2 py-2"
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
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
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-14 text-center">
                    <p className="text-sm font-semibold text-pf-text">
                      Todavía no hay productos en la venta
                    </p>
                    <p className="mt-1 text-xs text-pf-text-tertiary">
                      Escanee un código arriba o abra el catálogo para empezar.
                    </p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Resumen monetario (antes estaba duplicado en la cabecera) */}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-x-6 gap-y-2 rounded-xl border border-pf-border bg-white px-4 py-3 text-sm shadow-sm sm:gap-x-8">
          <div className="rounded-lg bg-pf-surface px-3 py-2 text-right">
            <span className="font-medium text-pf-muted">Subtotal</span>
            <span className="ml-2 font-semibold tabular-nums text-pf-text-secondary">
              {formatMoney(sym, totals.subtotal)}
            </span>
          </div>
          <div className="rounded-lg bg-pf-surface px-3 py-2 text-right">
            <span className="font-medium text-pf-muted">ISV incluido</span>
            <span className="ml-2 font-semibold tabular-nums text-pf-text-secondary">
              {formatMoney(sym, totals.tax)}
            </span>
          </div>
          <div className="rounded-lg bg-[color:var(--pf-text)] px-4 py-2 text-right text-white shadow-md">
            <span className="font-bold text-pf-surface-muted">Total</span>
            <span className="ml-2 text-base font-black tabular-nums text-white sm:text-xl">
              {formatMoney(sym, totals.total)}
            </span>
          </div>
        </div>

        {stockIssueCount > 0 && (
          <div
            className="mt-2 flex items-start gap-2 rounded-xl border border-pf-danger/40 bg-pf-danger-soft/30 px-4 py-3 text-sm"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-pf-danger"
            />
            <p
              className="font-medium text-pf-danger"
            >
              {stockIssueCount === 1
                ? "1 producto excede la existencia disponible. Ajuste la cantidad para poder guardar."
                : `${stockIssueCount} productos exceden la existencia disponible. Ajuste las cantidades para poder guardar.`}
            </p>
          </div>
        )}
        {err ? <p className="mt-2 text-sm text-pf-danger">{err}</p> : null}
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
                    idx === customerPickHighlight
                      ? "bg-pf-primary-soft/50 ring-2 ring-inset ring-pf-primary"
                      : ""
                  }`}
                  onClick={() => {
                    setCustomerPickHighlight(idx);
                    applyCustomer(c);
                    setCustomerSearchOpen(false);
                  }}
                >
                  <span className="font-medium text-pf-text">{c.name}</span>
                  <span className="text-xs text-pf-muted">
                    {[
                      c.code && c.code !== "0" ? `Cód. ${c.code}` : null,
                      c.phone,
                      c.taxId,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {filteredPickCustomers.length === 0 ? (
            <p className="mt-3 text-center text-sm text-pf-muted">
              Sin resultados
            </p>
          ) : null}
        </Modal>

        <Modal
          open={saleDatePickerOpen}
          title="Fecha y hora del documento"
          onClose={() => setSaleDatePickerOpen(false)}
        >
          <p className="mb-3 text-sm text-pf-muted">
            Esta fecha se guardará en la factura al pulsar Guardar o Cobrar
            (informes y caja la usan como fecha de venta).
          </p>
          <Input
            type="datetime-local"
            value={saleDateDraft}
            onChange={(e) => setSaleDateDraft(e.target.value)}
            className="w-full min-h-[44px] max-w-md"
          />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSaleDatePickerOpen(false)}
            >
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
          existingCustomerId={
            customerCatalogModal.kind === "edit" ? customerId : null
          }
          initialValues={
            customerCatalogModal.kind === "new"
              ? customerCreateInitialValues
              : undefined
          }
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
            <Field
              label="Buscar por nombre, código, código de barras o código rápido"
              className="lg:col-span-5 min-w-0"
            >
              <Input
                value={productSearchQ}
                onChange={(e) => setProductSearchQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (productSearchLoading || productSearchRows.length === 0)
                    return;
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
                    addProductToSale(p);
                    setProductSearchOpen(false);
                  }
                }}
                placeholder="Escriba para filtrar…"
                autoFocus
              />
            </Field>
            <Field label="Proveedor" className="lg:col-span-4 min-w-0">
              <Select
                value={productSupplierId}
                onChange={(e) => setProductSupplierId(e.target.value)}
              >
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

          {productSearchErr ? (
            <p className="mt-3 text-sm text-pf-danger">{productSearchErr}</p>
          ) : null}

          <div className="mt-3 max-h-[min(65vh,560px)] overflow-auto rounded-xl border border-pf-border bg-pf-surface-elevated shadow-sm">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="pf-table-thead text-left text-xs font-bold uppercase tracking-wide">
                  <th className="px-3 py-2.5">Código</th>
                  <th className="px-3 py-2.5">Descripción</th>
                  <th className="px-3 py-2.5">Und.</th>
                  {posBehavior.showStockWhileSelling ? (
                    <th className="px-3 py-2.5 text-right">Exist.</th>
                  ) : null}
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
                    <td
                      colSpan={posBehavior.showStockWhileSelling ? 9 : 8}
                      className="px-4 py-12 text-center text-pf-muted"
                    >
                      Cargando…
                    </td>
                  </tr>
                ) : productSearchRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={posBehavior.showStockWhileSelling ? 9 : 8}
                      className="px-4 py-12 text-center text-pf-muted"
                    >
                      No hay productos para mostrar. Ajuste filtros o la
                      búsqueda.
                    </td>
                  </tr>
                ) : (
                  productSearchRows.map((p, idx) => {
                    const outOfStock =
                      posBehavior.showStockWhileSelling &&
                      tracksStock(p) &&
                      p.stock <= 0;
                    const isHi = idx === productSearchHighlight;
                    return (
                      <tr
                        key={p.id}
                        data-product-search-row={idx}
                        tabIndex={-1}
                        className={`pf-table-row cursor-pointer transition hover:bg-pf-primary-soft/40 ${outOfStock ? "bg-pf-danger-soft/20 opacity-70" : ""} ${
                          isHi
                            ? "bg-pf-primary-soft/50 ring-2 ring-inset ring-pf-primary"
                            : ""
                        }`}
                        onClick={() => {
                          setProductSearchHighlight(idx);
                          addProductToSale(p);
                          setProductSearchOpen(false);
                        }}
                      >
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-pf-text-tertiary">
                          {p.sku}
                        </td>
                        <td className="max-w-[280px] px-3 py-2">
                          <span className="font-medium text-pf-text">
                            {p.name}
                          </span>
                          {outOfStock && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-pf-danger-soft/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-pf-danger">
                              <AlertTriangle className="h-3 w-3" />
                              Sin stock
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-pf-text-secondary">
                          {p.unit}
                        </td>
                        {posBehavior.showStockWhileSelling ? (
                          <td
                            className={`px-3 py-2 text-right tabular-nums ${outOfStock ? "font-semibold text-pf-danger" : ""}`}
                          >
                            {p.stock}
                          </td>
                        ) : null}
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {formatMoney(sym, p.price)}
                        </td>
                        <td className="px-3 py-2 text-pf-text-tertiary">
                          {p.category ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-pf-text-tertiary">
                          {p.location ?? "—"}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-pf-text-tertiary">
                          {p.quickCode ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {p.taxPercent}
                        </td>
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
            Hay varias líneas en la venta. Elija cuál desea abrir en el
            catálogo.
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
                      idx === pickLineHighlight
                        ? "bg-pf-primary-soft/50 ring-2 ring-inset ring-pf-primary"
                        : ""
                    }`}
                    onClick={() => {
                      setPickLineHighlight(idx);
                      setPickLineForEditOpen(false);
                      setCatalogModal({ kind: "edit", productId: l.productId });
                    }}
                  >
                    <span className="font-mono text-xs text-pf-muted">
                      {l.product.sku}
                    </span>
                    <span className="ml-2 font-medium text-pf-text">
                      {l.product.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Modal>

        <NewProductModal
          open={catalogModal.kind !== "closed"}
          existingProductId={
            catalogModal.kind === "edit" ? catalogModal.productId : null
          }
          onClose={() => setCatalogModal({ kind: "closed" })}
          onSaved={(p) => void addProductById(p.id)}
          onUpdated={refreshLinesWithProduct}
        />

        <Modal
          open={checkoutOpen}
          title={isCreditSaleTerm(terms) ? "Abono inicial" : "Cobrar Factura"}
          onClose={() => {
            setCheckoutOpen(false);
            setErr("");
          }}
          maxWidthClass="sm:max-w-md"
        >
          {(() => {
            const creditCheckout = isCreditSaleTerm(terms);
            const total = totals.total;
            const received = Number(checkoutAmountReceived) || 0;
            const cambio = Math.max(0, received - total);
            const saldo = Math.max(0, total - received);
            const excede = Math.max(0, received - total);
            return (
              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-pf-border bg-pf-primary-soft/25 px-4 py-3">
                    <span className="text-sm font-bold uppercase tracking-wide text-pf-text-tertiary">
                      Total
                    </span>
                    <span className="text-2xl font-black tabular-nums tracking-tight text-pf-text">
                      {formatMoney(sym, total)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-xl border-2 border-pf-primary/40 bg-white px-4 py-3">
                    <label
                      htmlFor="checkout-amount"
                      className="text-sm font-bold uppercase tracking-wide text-pf-text-tertiary"
                    >
                      {creditCheckout ? "Abono" : "Cantidad"}
                    </label>
                    <Input
                      ref={checkoutAmountInputRef}
                      id="checkout-amount"
                      type="number"
                      step="any"
                      min={0}
                      className="max-w-[180px] text-right text-xl font-bold"
                      value={checkoutAmountReceived}
                      onChange={(e) => {
                        setCheckoutAmountReceived(e.target.value);
                        setErr("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (!busy) {
                            if (creditCheckout) confirmCreditCheckout();
                            else confirmCheckout();
                          }
                        }
                      }}
                      placeholder="0.00"
                      autoComplete="off"
                    />
                  </div>

                  {creditCheckout ? null : (
                    <div
                      className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 ${
                        cambio > 0
                          ? "border-pf-success-soft bg-pf-success-soft"
                          : "border-pf-border bg-pf-surface-elevated"
                      }`}
                    >
                      <span className="text-sm font-bold uppercase tracking-wide text-pf-text-tertiary">
                        Cambio
                      </span>
                      <span
                        className={`text-xl font-black tabular-nums ${cambio > 0 ? "text-pf-success" : "text-pf-text-tertiary"}`}
                      >
                        {formatMoney(sym, cambio)}
                      </span>
                    </div>
                  )}

                  <div
                    className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 ${
                      saldo > 0
                        ? "border-pf-warning-soft bg-pf-warning-soft"
                        : "border-pf-border bg-pf-surface-elevated"
                    }`}
                  >
                    <span className="text-sm font-bold uppercase tracking-wide text-pf-text-tertiary">
                      Saldo
                    </span>
                    <span
                      className={`text-xl font-black tabular-nums ${saldo > 0 ? "text-pf-warning" : "text-pf-text-tertiary"}`}
                    >
                      {formatMoney(sym, saldo)}
                    </span>
                  </div>

                  {creditCheckout && received === total && total > 0 ? (
                    <p className="rounded-xl border border-pf-info-soft bg-pf-info-soft px-3 py-2 text-sm font-medium text-pf-info">
                      El abono cubre todo el total. Puedes cambiar esta factura a contado antes de guardarla.
                    </p>
                  ) : null}

                  {creditCheckout && excede > 0 ? (
                    <p className="rounded-xl border border-pf-danger-soft bg-pf-danger-soft px-3 py-2 text-sm font-medium text-pf-danger">
                      El abono excede el total por {formatMoney(sym, excede)}.
                    </p>
                  ) : null}
                </div>

                {err ? (
                  <p className="text-sm font-medium text-pf-danger">{err}</p>
                ) : null}

                <Button
                  type="button"
                  className="w-full min-h-12 gap-3 text-base"
                  onClick={creditCheckout ? confirmCreditCheckout : confirmCheckout}
                  disabled={busy}
                >
                  <CheckCircle2
                    className="h-5 w-5 shrink-0"
                    strokeWidth={2.5}
                  />
                  {busy ? "Guardando…" : creditCheckout ? "Guardar con abono" : "Cobrar Factura"}
                </Button>

                {checkoutOpts.autoPrintTicket && (
                  <p className="flex items-center justify-center gap-1.5 text-center text-xs text-pf-muted">
                    <Printer className="h-3.5 w-3.5 shrink-0" />
                    Tras cobrar verá solo el diálogo de impresión; no se abre
                    otra pestaña ni la página del comprobante.
                  </p>
                )}
              </div>
            );
          })()}
        </Modal>

        <Modal
          open={creditFullPaymentConfirmOpen}
          title="Abono igual al total"
          onClose={() => setCreditFullPaymentConfirmOpen(false)}
          maxWidthClass="sm:max-w-md"
        >
          <div className="space-y-4">
            <p className="text-sm leading-6 text-pf-text-secondary">
              El abono inicial cubre el total completo de la factura. ¿Quieres cambiar el tipo de factura a contado?
            </p>
            <div className="rounded-xl border border-pf-border bg-pf-surface-elevated px-4 py-3">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="font-bold uppercase tracking-wide text-pf-text-tertiary">Total</span>
                <span className="text-lg font-black tabular-nums text-pf-text">{formatMoney(sym, totals.total)}</span>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="secondary"
                className="min-h-12"
                disabled={busy}
                onClick={() => {
                  const amount = totals.total;
                  setPaid(String(amount));
                  setCreditFullPaymentConfirmOpen(false);
                  setCheckoutOpen(false);
                  void saveSale({ ...checkoutOpts, paidOverride: amount });
                }}
              >
                Mantener plazo
              </Button>
              <Button
                type="button"
                className="min-h-12"
                disabled={busy || !posBehavior.allowedSaleTerms.includes("CONTADO")}
                onClick={() => {
                  if (!posBehavior.allowedSaleTerms.includes("CONTADO")) return;
                  setPaid("");
                  setTerms("CONTADO");
                  setCreditFullPaymentConfirmOpen(false);
                  setCheckoutOpen(false);
                  void saveSale({ ...checkoutOpts, termsOverride: "CONTADO" });
                }}
              >
                {posBehavior.allowedSaleTerms.includes("CONTADO") ? "Cambiar a contado" : "Contado desactivado"}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
      )}
    </div>
  );
}
