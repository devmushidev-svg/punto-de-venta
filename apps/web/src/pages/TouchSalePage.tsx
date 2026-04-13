import {
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Eraser,
  FileSpreadsheet,
  FileText,
  Minus,
  Monitor,
  Plus,
  Search,
  Pencil,
  Printer,
  Save,
  ShoppingCart,
  Star,
  Trash2,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useSaleDocumentToolbarSetter } from "../layouts/SaleDocumentToolbarContext";
import { Button, Card, Field, Input, Modal, Select } from "../components/ui";
import { formatMoney } from "../lib/format";
import { defaultQtyForNewLine, tracksStock } from "../lib/saleLineHelpers";
import { isCreditSaleTerm, SALE_TERMS_OPTIONS } from "../lib/saleTerms";
import { printSaleTicketInHiddenFrame } from "../lib/ticketPrint";
import { resolveProductUnitPrice } from "../lib/volumePrice";
import type { Customer, Product, Sale } from "../types";

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}

type Line = {
  productId: string;
  product: Product;
  qty: number;
  unitPrice: number;
  discountPercent: number;
};

type Toast = { message: string; kind: "success" | "print" };

function TouchRibbonTile({
  icon: Icon,
  line1,
  line2,
  onClick,
  disabled,
  title,
  variant = "default",
}: {
  icon: LucideIcon;
  line1: string;
  line2: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
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
      className="group flex w-[6.25rem] shrink-0 flex-col items-stretch rounded-md border border-transparent p-0.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-pf-primary disabled:pointer-events-none disabled:opacity-45 sm:w-28 pf-ribbon-tile-idle"
    >
      <div className="flex flex-1 flex-col items-center gap-1 pb-1 pt-1.5">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-md leading-none shadow-sm ${iconBg} [&>svg]:block [&>svg]:shrink-0`}>
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

function TouchRibbonGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pf-ribbon-group flex min-w-0 flex-col pl-2 first:border-l-0 first:pl-0 sm:pl-3">
      <div className="flex flex-row flex-wrap items-stretch gap-0.5 sm:gap-0">{children}</div>
      <p className="pf-ribbon-group-label mt-0.5 pt-0.5 text-center text-[10px] font-medium uppercase tracking-wide sm:text-[11px]">
        {title}
      </p>
    </div>
  );
}

export function TouchSalePage() {
  const setSaleToolbar = useSaleDocumentToolbarSetter();
  const { token, organization, user } = useAuth();
  const sym = organization?.currencySymbol ?? "L";
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerTaxId, setCustomerTaxId] = useState("");
  const [priceTier, setPriceTier] = useState(1);
  const [terms, setTerms] = useState("CONTADO");
  const [paid, setPaid] = useState("");
  const [notes, setNotes] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [documentSaleDate, setDocumentSaleDate] = useState(() => new Date());
  const [saleDatePickerOpen, setSaleDatePickerOpen] = useState(false);
  const [saleDateDraft, setSaleDateDraft] = useState("");
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [favIds, setFavIds] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showCart, setShowCart] = useState(false);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutAmount, setCheckoutAmount] = useState("");
  const [checkoutMode, setCheckoutMode] = useState<"save" | "print">("save");
  const checkoutAmountRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, kind: Toast["kind"]) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, kind });
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  function applyCustomer(c: Customer) {
    setCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerAddress(c.address ?? "");
    setCustomerPhone(c.phone ?? "");
    setCustomerTaxId(c.taxId ?? "");
    const dt = c.defaultPriceTier;
    if (dt != null && dt >= 1 && dt <= 4) {
      const tier = Math.trunc(dt);
      setPriceTier(tier);
      setLines((prev) =>
        prev.map((l) => ({
          ...l,
          unitPrice: resolveProductUnitPrice(l.product, l.qty, tier),
        }))
      );
    }
  }

  useEffect(() => {
    const label = user?.displayName?.trim() || user?.username?.trim() || "";
    setSellerName(label);
  }, [user?.displayName, user?.username]);

  useEffect(() => {
    if (!token) return;
    apiFetch<Customer[]>("/api/customers", { token }).then((c) => {
      setCustomers(c);
      const def = c.find((x) => /consumidor/i.test(x.name)) ?? c[0];
      if (def) applyCustomer(def);
      else {
        setCustomerId("");
        setCustomerName("");
        setCustomerAddress("");
        setCustomerPhone("");
        setCustomerTaxId("");
      }
    });
    apiFetch<{ general: { touchFavoriteProductIds?: string[] } }>("/api/settings", { token }).then((s) => {
      const ids = s.general?.touchFavoriteProductIds;
      if (Array.isArray(ids)) setFavIds(ids.filter((x) => typeof x === "string"));
    });
    apiFetch<Product[]>("/api/products?touch=1&forPos=1", { token }).then(setProducts).catch(() => setProducts([]));
  }, [token]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.quickCode && p.quickCode.toLowerCase().includes(q))
    );
  }, [products, search]);

  const favorites = useMemo(() => {
    const set = new Set(favIds);
    return products.filter((p) => set.has(p.id));
  }, [products, favIds]);

  function addProduct(p: Product) {
    setErr("");
    if (!p.active || p.productType === "INSUMO") return;
    setLines((prev) => {
      const i = prev.findIndex((l) => l.productId === p.id);
      if (i >= 0) return prev;
      const qty = defaultQtyForNewLine(p);
      return [
        ...prev,
        {
          productId: p.id,
          product: p,
          qty,
          unitPrice: resolveProductUnitPrice(p, qty, priceTier),
          discountPercent: 0,
        },
      ];
    });
  }

  function updateLineQty(i: number, delta: number) {
    setErr("");
    setLines((prev) => {
      const l = prev[i];
      const step = l.product.esGranel ? 0.1 : 1;
      let newQty = l.qty + delta * step;
      if (!l.product.esGranel) newQty = Math.round(newQty);
      if (newQty < 0) newQty = 0;
      if (tracksStock(l.product) && newQty > l.product.stock) {
        queueMicrotask(() =>
          setErr(`«${l.product.name}»: máximo ${l.product.stock} en existencia.`)
        );
        return prev;
      }
      const next = [...prev];
      next[i] = { ...next[i], qty: newQty, unitPrice: resolveProductUnitPrice(l.product, newQty, priceTier) };
      return next;
    });
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, j) => j !== i));
  }

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

  const cartLineCount = lines.length;
  const hasBillableLines = lines.some((l) => l.qty > 0);

  const persistFavorites = useCallback(
    async (nextIds: string[]) => {
      if (!token) return;
      setFavIds(nextIds);
      try {
        await apiFetch("/api/settings/touch-favorites", {
          method: "POST",
          body: JSON.stringify({ productIds: nextIds }),
          token,
        });
      } catch {
        /* keep local state */
      }
    },
    [token]
  );

  function toggleFavorite(id: string) {
    const next = favIds.includes(id) ? favIds.filter((x) => x !== id) : [...favIds, id];
    void persistFavorites(next);
  }

  function openCheckout(mode: "save" | "print") {
    if (!token || lines.length === 0) return;
    setErr("");
    if (!lines.some((l) => l.qty > 0)) {
      setErr("Indique una cantidad mayor que cero en al menos una línea.");
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
      setErr(`Existencia insuficiente — ${detail}`);
      return;
    }
    setCheckoutMode(mode);
    setCheckoutAmount("");
    setCheckoutOpen(true);
    setTimeout(() => checkoutAmountRef.current?.focus(), 80);
  }

  const clearLines = useCallback(() => {
    setLines([]);
    setErr("");
  }, []);

  const removeLastLine = useCallback(() => {
    setLines((prev) => prev.slice(0, -1));
    setErr("");
  }, []);

  async function confirmCheckout() {
    if (!token || lines.length === 0 || busy) return;
    setErr("");
    if (!lines.some((l) => l.qty > 0)) {
      setErr("Indique una cantidad mayor que cero en al menos una línea.");
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
      const sale = await apiFetch<Sale>("/api/sales", {
        method: "POST",
        body: JSON.stringify(body),
        token,
      });

      setCheckoutOpen(false);
      setShowCart(false);

      if (checkoutMode === "print") {
        showToast("Factura guardada. Aparecerá el cuadro de impresión.", "print");
        printSaleTicketInHiddenFrame(sale.id);
      } else {
        showToast("Factura guardada correctamente", "success");
      }

      setLines([]);
      setPaid("");
      setNotes("");
      setSellerName(user?.displayName?.trim() || user?.username?.trim() || "");
      setDocumentSaleDate(new Date());
      setTerms("CONTADO");
      setErr("");

      if (token) {
        apiFetch<Customer[]>("/api/customers", { token }).then((list) => {
          setCustomers(list);
          const def = list.find((x) => /consumidor/i.test(x.name)) ?? list[0];
          if (def) applyCustomer(def);
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  const saleInfoPanel = (
    <div className="space-y-3 rounded-xl border border-pf-border-soft bg-pf-surface-elevated/85 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Nº factura" className="min-w-0" compact>
          <Input
            readOnly
            tabIndex={-1}
            value="—"
            className="!h-9 cursor-default bg-pf-primary-soft/25 px-2 py-0 text-sm tabular-nums text-pf-text"
            title="Se asignará al guardar"
          />
        </Field>
        <Field label="Términos" className="min-w-0" compact>
          <Select
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            className="w-full min-w-0"
          >
            {SALE_TERMS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-pf-text-tertiary">Fecha</span>
          <Button
            type="button"
            variant="ghost"
            className="h-7 min-h-0 shrink-0 gap-1 px-2 py-0 text-[11px] font-semibold text-pf-primary"
            title="Cambiar fecha y hora del documento"
            onClick={() => {
              setSaleDateDraft(toDatetimeLocalValue(documentSaleDate));
              setSaleDatePickerOpen(true);
            }}
          >
            <CalendarClock className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
            Editar fecha
          </Button>
        </div>
        <div className="flex min-h-[2.25rem] items-center rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface-elevated px-3 text-sm font-bold tabular-nums text-pf-text shadow-[var(--pf-control-shadow)]">
          {saleDateDisplayStr}
        </div>
      </div>

      <Field label="Cliente" className="min-w-0" compact>
        <Select
          value={customerId}
          onChange={(e) => {
            const c = customers.find((x) => x.id === e.target.value);
            if (c) applyCustomer(c);
            else {
              setCustomerId(e.target.value);
              setCustomerName("");
              setCustomerAddress("");
              setCustomerPhone("");
              setCustomerTaxId("");
            }
          }}
          className="w-full min-w-0"
        >
          <option value="">Seleccione cliente…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Nombre / razón social" className="min-w-0" compact>
        <Input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Consumidor final"
          className="px-3 py-2 text-sm"
        />
      </Field>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="DIR" className="min-w-0" compact>
          <Input
            value={customerAddress}
            onChange={(e) => setCustomerAddress(e.target.value)}
            placeholder="Dirección"
            className="px-3 py-2 text-sm"
          />
        </Field>
        <Field label="TEL" className="min-w-0" compact>
          <Input
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="Teléfono"
            className="px-3 py-2 text-sm"
          />
        </Field>
        <Field label="RTN" className="min-w-0" compact>
          <Input
            value={customerTaxId}
            onChange={(e) => setCustomerTaxId(e.target.value)}
            placeholder="RTN"
            className="px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Lista de precios" className="min-w-0" compact>
          <Select
            value={priceTier}
            onChange={(e) => setPriceTier(Number(e.target.value))}
            className="w-full min-w-0"
          >
            <option value={1}>Precio 1</option>
            <option value={2}>Precio 2</option>
            <option value={3}>Precio 3</option>
            <option value={4}>Precio 4</option>
          </Select>
        </Field>
        {isCreditSaleTerm(terms) ? (
          <Field label="Abono inicial" className="min-w-0" compact>
            <Input
              type="number"
              step="any"
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              className="px-3 py-2 text-sm"
            />
          </Field>
        ) : null}
      </div>

      <Field label="Vendedor (opc.)" className="min-w-0" compact>
        <Input
          value={sellerName}
          onChange={(e) => setSellerName(e.target.value)}
          placeholder="Nombre en ticket"
          className="!h-9"
        />
      </Field>
      <Field label="Notas (opc.)" className="min-w-0" compact>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Opcional"
          className="px-3 py-2 text-sm"
        />
      </Field>

      {isCreditSaleTerm(terms) ? (
        <p className="text-xs font-medium text-pf-muted">Cliente obligatorio para crédito.</p>
      ) : null}
    </div>
  );

  const cartPanel = (
    <div className="space-y-3">
      {saleInfoPanel}
      <div className="max-h-60 divide-y divide-pf-border-soft overflow-y-auto rounded-xl border border-pf-border-soft bg-pf-surface-elevated/80 text-sm">
        {lines.length === 0 ? (
          <p className="p-6 text-center text-sm font-medium text-pf-muted">Carrito vacío</p>
        ) : (
          lines.map((l, i) => (
            <div key={l.productId} className="flex items-center gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-pf-text">{l.product.name}</p>
                <p className="text-xs tabular-nums text-pf-text-tertiary">
                  {l.qty} × {formatMoney(sym, l.unitPrice)} = {formatMoney(sym, l.qty * l.unitPrice)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => updateLineQty(i, -1)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-pf-border-soft text-pf-text-tertiary transition hover:bg-pf-surface-muted touch-manipulation"
                >
                  <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
                <span className="w-8 text-center text-sm font-bold tabular-nums text-pf-text">{l.qty}</span>
                <button
                  type="button"
                  onClick={() => updateLineQty(i, 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-pf-border-soft text-pf-text-tertiary transition hover:bg-pf-surface-muted touch-manipulation"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              </div>
              <button
                type="button"
                onClick={() => removeLine(i)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-pf-danger/70 transition hover:bg-pf-danger-soft touch-manipulation"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2 rounded-xl border border-pf-border-soft bg-gradient-to-br from-pf-surface-elevated to-pf-surface-muted/60 p-4 text-sm">
        <div className="flex justify-between font-medium text-pf-text-tertiary">
          <span>Subtotal</span>
          <span className="tabular-nums text-pf-text">{formatMoney(sym, totals.subtotal)}</span>
        </div>
        <div className="flex justify-between font-medium text-pf-text-tertiary">
          <span>Impuesto</span>
          <span className="tabular-nums text-pf-text">{formatMoney(sym, totals.tax)}</span>
        </div>
        <div className="flex justify-between border-t border-pf-border-soft pt-3 text-lg font-extrabold text-pf-text">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(sym, totals.total)}</span>
        </div>
      </div>

      {err && <p className="rounded-xl border border-pf-danger-soft bg-pf-danger-soft/40 px-3 py-2 text-sm font-medium text-pf-danger">{err}</p>}

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="secondary"
          className="min-h-[52px] text-sm shadow-md"
          onClick={() => openCheckout("save")}
          disabled={busy || !lines.some((l) => l.qty > 0)}
        >
          <Save className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          Guardar
        </Button>
        <Button
          type="button"
          className="min-h-[52px] text-sm shadow-lg"
          onClick={() => openCheckout("print")}
          disabled={busy || !lines.some((l) => l.qty > 0)}
        >
          <Printer className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          Imprimir
        </Button>
      </div>
    </div>
  );

  const touchRibbonBar = useMemo(
    () => (
      <>
        <TouchRibbonGroup title="Guardar venta final">
          <TouchRibbonTile
            variant="primary"
            icon={Save}
            line1="F5 Guardar"
            line2="venta"
            title="Guardar venta táctil"
            onClick={() => openCheckout("save")}
            disabled={busy || !hasBillableLines}
          />
          <TouchRibbonTile
            variant="muted"
            icon={Printer}
            line1="F8 Imprimir"
            line2="venta"
            title="Guardar e imprimir ticket"
            onClick={() => openCheckout("print")}
            disabled={busy || !hasBillableLines}
          />
        </TouchRibbonGroup>
        <TouchRibbonGroup title="Productos">
          <TouchRibbonTile
            icon={Search}
            line1="F4 Buscar"
            line2="Productos"
            title="Buscar productos"
            onClick={() => searchInputRef.current?.focus()}
          />
          <TouchRibbonTile
            icon={Plus}
            line1="F3 Nuevo"
            line2="Producto"
            title="Ir al catálogo de productos"
            onClick={() => navigate("/productos")}
          />
          <TouchRibbonTile
            icon={Pencil}
            line1="Editar"
            line2="Producto"
            title="Abrir catálogo de productos para editar"
            onClick={() => navigate("/productos")}
          />
          <TouchRibbonTile
            icon={Building2}
            line1="Buscar"
            line2="Sucursales"
            title="Ir a empresa"
            onClick={() => navigate("/empresa")}
          />
        </TouchRibbonGroup>
        <TouchRibbonGroup title="Clientes">
          <TouchRibbonTile
            icon={Users}
            line1="F2 Buscar"
            line2="Clientes"
            title="Abrir panel del carrito para elegir cliente"
            onClick={() => setShowCart(true)}
          />
          <TouchRibbonTile
            icon={UserPlus}
            line1="F6 Nuevo"
            line2="Cliente"
            title="Ir a clientes"
            onClick={() => navigate("/clientes")}
          />
          <TouchRibbonTile
            icon={Pencil}
            line1="Editar"
            line2="Cliente"
            title="Ir a clientes para editar"
            onClick={() => navigate("/clientes")}
          />
        </TouchRibbonGroup>
        <TouchRibbonGroup title="Vendedor">
          <TouchRibbonTile
            icon={Search}
            line1="F7 Buscar"
            line2="Vendedores"
            title="Ir a usuarios"
            onClick={() => navigate("/usuarios")}
          />
        </TouchRibbonGroup>
        <TouchRibbonGroup title="Diario">
          <TouchRibbonTile
            icon={FileSpreadsheet}
            line1="F1 Diario"
            line2="Digital"
            title="Ir a caja y diario digital"
            onClick={() => navigate("/caja")}
          />
        </TouchRibbonGroup>
        <TouchRibbonGroup title="Notas">
          <TouchRibbonTile
            icon={ClipboardList}
            line1="Notas"
            line2=" "
            title="Abrir carrito para editar notas"
            onClick={() => setShowCart(true)}
          />
        </TouchRibbonGroup>
        <TouchRibbonGroup title="Exonerada">
          <TouchRibbonTile
            icon={FileText}
            line1="Venta"
            line2="Exonerada"
            title="Marcar venta exonerada no está implementado aún"
            onClick={() => setErr("Venta exonerada aun no esta implementada en venta tactil.")}
          />
        </TouchRibbonGroup>
        <TouchRibbonGroup title="Filas">
          <TouchRibbonTile
            icon={Trash2}
            line1="F10 Eliminar"
            line2="Fila"
            title="Eliminar ultima fila"
            onClick={removeLastLine}
            disabled={!lines.length}
          />
        </TouchRibbonGroup>
        <TouchRibbonGroup title="Limpiar">
          <TouchRibbonTile
            variant="danger"
            icon={Eraser}
            line1="F11 Limpiar"
            line2=" "
            title="Vaciar carrito"
            onClick={clearLines}
            disabled={!lines.length}
          />
        </TouchRibbonGroup>
      </>
    ),
    [busy, hasBillableLines, lines.length, clearLines, navigate, removeLastLine]
  );

  useLayoutEffect(() => {
    setSaleToolbar?.(touchRibbonBar);
    return () => setSaleToolbar?.(null);
  }, [touchRibbonBar, setSaleToolbar]);

  return (
    <div className="space-y-4 pb-28 pf-safe-page xl:pb-4">
      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed left-1/2 top-4 z-[100] flex items-center gap-2.5 rounded-xl border px-5 py-3 shadow-lg backdrop-blur-md ${
            toast.kind === "print"
              ? "border-pf-info-soft bg-pf-info-soft/90 text-pf-info"
              : "border-pf-success-soft bg-pf-success-soft/90 text-pf-success"
          }`}
          style={{ transform: "translateX(-50%)", animation: "toast-in 0.3s ease-out" }}
        >
          {toast.kind === "print" ? (
            <Printer className="h-5 w-5 shrink-0" strokeWidth={2} />
          ) : (
            <CheckCircle2 className="h-5 w-5 shrink-0" strokeWidth={2} />
          )}
          <span className="text-sm font-bold">{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="pf-doc-section-title">Venta táctil</h1>
          <p className="text-sm text-pf-text-tertiary">Toque productos para agregar al carrito</p>
        </div>
        <div className="flex gap-2">
          <Link to="/venta">
            <Button variant="secondary" type="button" className="min-h-[44px]">
              <Monitor className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              Venta estándar
            </Button>
          </Link>
          <Link to="/ventas/preventas">
            <Button variant="ghost" type="button" className="min-h-[44px]">
              <ClipboardList className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              PreVentas
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        {/* Product catalog */}
        <div className="space-y-3">
          <Card className="pf-glass-card-panel p-3">
            <Input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar producto por nombre, SKU, código…"
              className="!rounded-lg"
            />
          </Card>

          {favorites.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-pf-text-tertiary">
                <Star className="h-3 w-3 text-pf-warning" fill="currentColor" strokeWidth={0} />
                Favoritos
              </p>
              <div className="flex gap-2.5 overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch]">
                {favorites.map((p) => {
                  const outOfStock = tracksStock(p) && p.stock <= 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addProduct(p)}
                      className={`min-h-[80px] min-w-[140px] shrink-0 rounded-xl border p-3 text-left shadow-sm transition active:scale-[0.98] touch-manipulation ${
                        outOfStock
                          ? "border-pf-danger/30 bg-pf-danger-soft/20"
                          : "border-pf-border-soft bg-gradient-to-br from-pf-primary-soft/60 to-pf-surface-elevated hover:shadow-md hover:brightness-[1.02]"
                      }`}
                    >
                      <span className="block text-sm font-semibold text-pf-text line-clamp-2">{p.name}</span>
                      <span className="mt-1 block text-xs font-bold tabular-nums text-pf-primary-hover">
                        {formatMoney(sym, resolveProductUnitPrice(p, 1, priceTier))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-4">
            {filtered.map((p) => {
              const outOfStock = tracksStock(p) && p.stock <= 0;
              const isFav = favIds.includes(p.id);
              return (
                <div
                  key={p.id}
                  className={`relative flex flex-col rounded-xl border shadow-sm transition ${
                    outOfStock
                      ? "border-pf-danger/25 bg-pf-danger-soft/15"
                      : "border-pf-border-soft bg-pf-surface-elevated hover:shadow-md"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => addProduct(p)}
                    className="flex min-h-[100px] flex-1 flex-col p-3 text-left transition active:scale-[0.98] touch-manipulation hover:bg-pf-surface-muted/30 rounded-t-xl"
                  >
                    <span className="line-clamp-2 text-sm font-semibold leading-snug text-pf-text">{p.name}</span>
                    {p.productType === "SERVICIO" ? null : p.productType === "KIT" ? (
                      <span className="mt-0.5 text-[11px] font-medium text-pf-info">Combo</span>
                    ) : (
                      <span className={`mt-0.5 text-[11px] font-medium ${p.stock <= 5 ? "text-pf-warning" : "text-pf-muted"}`}>
                        Stock {p.stock}
                      </span>
                    )}
                    <span className="mt-auto block pt-2 text-base font-bold tabular-nums text-pf-primary-hover">
                      {formatMoney(sym, resolveProductUnitPrice(p, 1, priceTier))}
                    </span>
                    {outOfStock && (
                      <span className="mt-1 text-[10px] font-bold uppercase text-pf-danger">Sin stock</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleFavorite(p.id)}
                    className={`flex min-h-[40px] items-center justify-center gap-1 border-t px-2 py-1.5 text-xs font-semibold transition active:scale-[0.98] touch-manipulation rounded-b-xl ${
                      isFav
                        ? "border-pf-primary-soft/80 bg-pf-primary-soft/50 text-pf-primary-hover"
                        : "border-pf-border-soft bg-pf-surface-muted/30 text-pf-muted hover:bg-pf-surface-muted/60"
                    }`}
                  >
                    <Star className="h-3 w-3" fill={isFav ? "currentColor" : "none"} strokeWidth={2} />
                    {isFav ? "Favorito" : "Favorito"}
                  </button>
                </div>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <p className="py-12 text-center text-sm text-pf-muted">No se encontraron productos</p>
          )}
        </div>

        {/* Desktop cart sidebar */}
        <Card
          id="touch-sale-cart"
          className="pf-glass-card-panel hidden h-fit p-4 xl:sticky xl:top-4 xl:block"
        >
          <p className="mb-3 flex items-center gap-2 text-sm font-bold text-pf-text">
            <ShoppingCart className="h-4 w-4 text-pf-primary-hover" strokeWidth={2} />
            Carrito ({cartLineCount})
          </p>
          {cartPanel}
        </Card>
      </div>

      {/* Mobile bottom bar */}
      <div className="fixed inset-x-0 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-30 px-3 xl:hidden">
        <div className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-2xl border border-pf-glass-border bg-pf-surface-elevated/95 p-2.5 shadow-[var(--pf-shadow-warm-xl)] backdrop-blur-xl">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-pf-surface-muted/60 px-3 py-2">
            <ShoppingCart className="h-4 w-4 shrink-0 text-pf-primary-hover" strokeWidth={2} aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
                {cartLineCount} {cartLineCount === 1 ? "línea" : "líneas"}
              </p>
              <p className="truncate text-sm font-extrabold tabular-nums text-pf-text">{formatMoney(sym, totals.total)}</p>
            </div>
          </div>
          <Button
            type="button"
            className="min-h-[44px] shrink-0"
            onClick={() => setShowCart(true)}
          >
            Ver carrito
          </Button>
        </div>
      </div>

      {/* Mobile cart drawer */}
      {showCart && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div className="absolute inset-0 pf-mobile-menu-scrim" onClick={() => setShowCart(false)} />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col pf-mobile-drawer-shell overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between pf-mobile-drawer-head px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-bold text-pf-text">
                <ShoppingCart className="h-4 w-4 text-pf-primary-hover" strokeWidth={2} />
                Carrito ({cartLineCount})
              </p>
              <button
                type="button"
                onClick={() => setShowCart(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-pf-text-tertiary hover:bg-pf-surface-muted touch-manipulation"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>
            <div className="flex-1 p-4">
              {cartPanel}
            </div>
          </div>
        </div>
      )}

      {/* Checkout confirmation modal */}
      <Modal
        open={checkoutOpen}
        title="Cobrar Factura"
        onClose={() => setCheckoutOpen(false)}
        maxWidthClass="sm:max-w-md"
      >
        {(() => {
          const total = totals.total;
          const received = Number(checkoutAmount) || 0;
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

                <div className="flex items-center justify-between gap-4 rounded-xl border-2 border-pf-primary/40 bg-pf-surface-elevated px-4 py-3">
                  <label htmlFor="checkout-amount-touch" className="text-sm font-bold uppercase tracking-wide text-pf-text-tertiary">
                    Cantidad
                  </label>
                  <Input
                    ref={checkoutAmountRef}
                    id="checkout-amount-touch"
                    type="number"
                    step="any"
                    min={0}
                    className="max-w-[180px] text-right text-xl font-bold"
                    value={checkoutAmount}
                    onChange={(e) => setCheckoutAmount(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (!busy) void confirmCheckout();
                      }
                    }}
                    placeholder="0.00"
                    autoComplete="off"
                  />
                </div>

                <div className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 ${
                  cambio > 0
                    ? "border-pf-success-soft bg-pf-success-soft/40"
                    : "border-pf-border bg-pf-surface-elevated"
                }`}>
                  <span className="text-sm font-bold uppercase tracking-wide text-pf-text-tertiary">Cambio</span>
                  <span className={`text-xl font-black tabular-nums ${cambio > 0 ? "text-pf-success" : "text-pf-text-tertiary"}`}>
                    {formatMoney(sym, cambio)}
                  </span>
                </div>

                <div className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 ${
                  saldo > 0
                    ? "border-pf-warning-soft bg-pf-warning-soft/40"
                    : "border-pf-border bg-pf-surface-elevated"
                }`}>
                  <span className="text-sm font-bold uppercase tracking-wide text-pf-text-tertiary">Saldo</span>
                  <span className={`text-xl font-black tabular-nums ${saldo > 0 ? "text-pf-warning" : "text-pf-text-tertiary"}`}>
                    {formatMoney(sym, saldo)}
                  </span>
                </div>
              </div>

              {err && <p className="text-sm font-medium text-pf-danger">{err}</p>}

              <Button
                type="button"
                className="w-full min-h-12 gap-3 text-base"
                onClick={() => void confirmCheckout()}
                disabled={busy}
              >
                {checkoutMode === "print" ? (
                  <Printer className="h-5 w-5 shrink-0" strokeWidth={2} />
                ) : (
                  <CheckCircle2 className="h-5 w-5 shrink-0" strokeWidth={2.5} />
                )}
                {busy
                  ? "Guardando…"
                  : checkoutMode === "print"
                    ? "Cobrar e Imprimir"
                    : "Cobrar Factura"
                }
              </Button>

              {checkoutMode === "print" && (
                <p className="flex items-center justify-center gap-1.5 text-xs text-pf-muted">
                  <Printer className="h-3.5 w-3.5" />
                  Se imprimirá el ticket automáticamente
                </p>
              )}
            </div>
          );
        })()}
      </Modal>

      <Modal
        open={saleDatePickerOpen}
        title="Fecha y hora del documento"
        onClose={() => setSaleDatePickerOpen(false)}
      >
        <p className="mb-3 text-sm text-pf-muted">
          Esta fecha se guardará en la factura al cobrar (informes y caja la usan como fecha de venta).
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
    </div>
  );
}
