import {
  CalendarClock,
  CheckCircle2,
  Eraser,
  Minus,
  Monitor,
  Plus,
  Printer,
  Save,
  Search,
  ShoppingCart,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useSaleDocumentToolbarSetter } from "../layouts/SaleDocumentToolbarContext";
import { Button, Field, Input, Modal, Select } from "../components/ui";
import { ToolbarButton, ToolbarSeparator } from "../components/DocumentToolbar";
import { formatMoney } from "../lib/format";
import { defaultQtyForNewLine, tracksStock } from "../lib/saleLineHelpers";
import { isCreditSaleTerm, SALE_TERMS_OPTIONS } from "../lib/saleTerms";
import { printSaleTicketInHiddenFrame } from "../lib/ticketPrint";
import { submitSale, isOfflineError } from "../lib/offlineSales";
import { DEFAULT_POS_BEHAVIOR, parsePosBehavior, type PosBehavior } from "../lib/posBehavior";
import { resolveProductUnitPrice } from "../lib/volumePrice";
import type { Customer, Product, Sale } from "../types";

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

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


export function TouchSalePage() {
  const setSaleToolbar = useSaleDocumentToolbarSetter();
  const { token, organization, user } = useAuth();
  const sym = organization?.currencySymbol ?? "L";
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
  const [saleInfoOpen, setSaleInfoOpen] = useState(false);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutAmount, setCheckoutAmount] = useState("");
  const [checkoutMode, setCheckoutMode] = useState<"save" | "print">("save");
  const checkoutAmountRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [posBehavior, setPosBehavior] = useState<PosBehavior>(DEFAULT_POS_BEHAVIOR);

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
    apiFetch<{ general: { touchFavoriteProductIds?: string[]; posBehavior?: unknown } }>("/api/settings", { token }).then(
      (s) => {
        const ids = s.general?.touchFavoriteProductIds;
        if (Array.isArray(ids)) setFavIds(ids.filter((x) => typeof x === "string"));
        setPosBehavior(parsePosBehavior(s.general?.posBehavior));
      }
    );
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
      // El paso de 0.1 en granel arrastra error de coma flotante y se veia crudo en el carrito.
      newQty = l.product.esGranel ? Math.round(newQty * 1000) / 1000 : Math.round(newQty);
      if (newQty < 0) newQty = 0;
      if (!posBehavior.warnOutOfStock && tracksStock(l.product) && newQty > l.product.stock) {
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
    const rawTotal = sub + tax;
    if (!posBehavior.roundTotals) return { subtotal: sub, tax, total: rawTotal };
    return { subtotal: roundMoney2(sub), tax: roundMoney2(tax), total: roundMoney2(rawTotal) };
  }, [lines, posBehavior.roundTotals]);

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
  const termsLabel = SALE_TERMS_OPTIONS.find((o) => o.value === terms)?.label ?? terms;

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
    if (stockProblems.length > 0 && !posBehavior.warnOutOfStock) {
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
      const res = await submitSale<Sale>(body, token);

      setCheckoutOpen(false);
      setShowCart(false);

      if (res.offline) {
        showToast("Sin conexión: venta guardada y se enviará al reconectar.", "success");
      } else if (checkoutMode === "print") {
        showToast("Factura guardada. Aparecerá el cuadro de impresión.", "print");
        printSaleTicketInHiddenFrame(res.sale.id);
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
    <div className="space-y-3">
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
      <button
        type="button"
        onClick={() => setSaleInfoOpen(true)}
        className="flex w-full items-center gap-3 rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface-elevated px-3 py-2.5 text-left transition-colors hover:bg-pf-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-pf-text">
            {customerName.trim() || "Consumidor final"}
          </span>
          <span className="mt-0.5 block truncate text-xs text-pf-text-tertiary">
            {termsLabel} · Precio {priceTier} · {saleDateDisplayStr}
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-pf-primary-hover">Cambiar</span>
      </button>

      <div className="divide-y divide-pf-border overflow-y-auto rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface-elevated text-sm lg:max-h-[calc(100dvh-27rem)]">
        {lines.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-pf-muted">
            Toque un producto para agregarlo.
          </p>
        ) : (
          lines.map((l, i) => (
            <div key={l.productId} className="px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-pf-text">{l.product.name}</p>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-pf-text">
                  {formatMoney(sym, l.qty * l.unitPrice)}
                </p>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => updateLineQty(i, -1)}
                  aria-label={`Quitar uno de ${l.product.name}`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-pf-border text-pf-text-tertiary transition-colors hover:bg-pf-surface touch-manipulation focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
                >
                  <Minus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                </button>
                <span className="w-10 shrink-0 text-center text-sm font-bold tabular-nums text-pf-text">{l.qty}</span>
                <button
                  type="button"
                  onClick={() => updateLineQty(i, 1)}
                  aria-label={`Agregar uno de ${l.product.name}`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-pf-border text-pf-text-tertiary transition-colors hover:bg-pf-surface touch-manipulation focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
                >
                  <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                </button>
                <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-pf-text-tertiary">
                  × {formatMoney(sym, l.unitPrice)}
                </span>
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  aria-label={`Quitar ${l.product.name} de la venta`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-pf-danger transition-colors hover:bg-pf-danger-soft touch-manipulation focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface-elevated p-4">
        <div className="flex justify-between text-sm text-pf-text-tertiary">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatMoney(sym, totals.subtotal)}</span>
        </div>
        <div className="mt-1 flex justify-between text-sm text-pf-text-tertiary">
          <span>Impuesto</span>
          <span className="tabular-nums">{formatMoney(sym, totals.tax)}</span>
        </div>
        <div className="mt-3 flex items-baseline justify-between border-t border-pf-border pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Total</span>
          <span className="text-3xl font-bold tabular-nums tracking-tight text-pf-text">
            {formatMoney(sym, totals.total)}
          </span>
        </div>
      </div>

      {err && (
        <p className="rounded-[var(--radius-pf)] border border-pf-danger-soft bg-pf-danger-soft px-3 py-2 text-sm font-medium text-pf-danger">
          {err}
        </p>
      )}

      <div className="space-y-2">
        <Button
          type="button"
          className="min-h-14 w-full text-base"
          onClick={() => openCheckout("save")}
          disabled={busy || !hasBillableLines}
        >
          <Save className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
          Cobrar
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 w-full text-sm"
          onClick={() => openCheckout("print")}
          disabled={busy || !hasBillableLines}
        >
          <Printer className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          Cobrar e imprimir
        </Button>
      </div>
    </div>
  );

  /**
   * Solo acciones del documento. Los destinos que antes vivian aqui (productos,
   * clientes, usuarios, empresa, caja) estan en la barra lateral a un toque.
   */
  const touchRibbonBar = useMemo(
    () => (
      <>
        <ToolbarButton
          tone="primary"
          icon={Save}
          label="Cobrar"
          shortcut="F5"
          title="Cobrar y guardar la venta"
          onClick={() => openCheckout("save")}
          disabled={busy || !hasBillableLines}
        />
        <ToolbarButton
          icon={Printer}
          label="Cobrar e imprimir"
          shortcut="F8"
          title="Cobrar, guardar e imprimir el ticket"
          onClick={() => openCheckout("print")}
          disabled={busy || !hasBillableLines}
        />
        <ToolbarSeparator />
        <ToolbarButton
          icon={Search}
          label="Buscar producto"
          shortcut="F4"
          title="Ir al buscador de productos"
          onClick={() => searchInputRef.current?.focus()}
        />
        <ToolbarButton
          icon={Trash2}
          label="Quitar última"
          shortcut="F10"
          title="Eliminar la última línea"
          onClick={removeLastLine}
          disabled={!lines.length}
        />
        <ToolbarButton
          tone="danger"
          icon={Eraser}
          label="Vaciar"
          shortcut="F11"
          title="Vaciar el carrito"
          onClick={clearLines}
          disabled={!lines.length}
        />
      </>
    ),
    [busy, hasBillableLines, lines.length, clearLines, removeLastLine]
  );

  useLayoutEffect(() => {
    setSaleToolbar?.(touchRibbonBar);
    return () => setSaleToolbar?.(null);
  }, [touchRibbonBar, setSaleToolbar]);

  return (
    <div className="space-y-4 pb-28 pf-safe-page lg:pb-4">
      {/* Toast notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed left-1/2 top-4 z-[100] flex items-center gap-2.5 rounded-[var(--radius-pf)] border px-5 py-3 shadow-[var(--pf-shadow-warm-md)] ${
            toast.kind === "print"
              ? "border-pf-info-soft bg-pf-info-soft text-pf-info"
              : "border-pf-success-soft bg-pf-success-soft text-pf-success"
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_23rem]">
        {/* Catalogo de productos */}
        <div className="min-w-0 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pf-muted"
                strokeWidth={2}
                aria-hidden
              />
              <Input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar producto por nombre, SKU o código…"
                aria-label="Buscar producto"
                className="!h-12 !pl-9 text-base"
              />
            </div>
            <Link to="/venta" className="shrink-0">
              <Button variant="secondary" type="button" className="min-h-12" title="Cambiar a venta estándar">
                <Monitor className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                <span className="hidden xl:inline">Venta estándar</span>
                <span className="sr-only xl:hidden">Venta estándar</span>
              </Button>
            </Link>
          </div>

          {favorites.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-pf-text-tertiary">
                <Star className="h-3 w-3 text-pf-warning" fill="currentColor" strokeWidth={0} />
                Favoritos
              </p>
              <div className="flex gap-2.5 overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch]">
                {favorites.map((p) => {
                  const outOfStock = posBehavior.showStockWhileSelling && tracksStock(p) && p.stock <= 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addProduct(p)}
                      className={`min-h-[80px] min-w-[140px] shrink-0 rounded-[var(--radius-pf)] border p-3 text-left transition-colors touch-manipulation focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)] ${
                        outOfStock
                          ? "border-pf-danger-soft bg-pf-danger-soft"
                          : "border-[color:var(--pf-primary-mid)] bg-pf-primary-soft hover:bg-pf-surface-elevated"
                      }`}
                    >
                      <span className="block line-clamp-2 text-sm font-semibold text-pf-text">{p.name}</span>
                      <span className="mt-1 block text-xs font-bold tabular-nums text-pf-text">
                        {formatMoney(sym, resolveProductUnitPrice(p, 1, priceTier))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filtered.map((p) => {
              const outOfStock = posBehavior.showStockWhileSelling && tracksStock(p) && p.stock <= 0;
              const isFav = favIds.includes(p.id);
              return (
                <div key={p.id} className="relative">
                  <button
                    type="button"
                    onClick={() => addProduct(p)}
                    className={`flex min-h-[104px] w-full flex-col rounded-[var(--radius-pf)] border p-3 pr-10 text-left transition-colors touch-manipulation focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)] ${
                      outOfStock
                        ? "border-pf-danger-soft bg-pf-danger-soft"
                        : "border-pf-border bg-pf-surface-elevated hover:border-[color:var(--pf-primary-mid)] hover:bg-pf-surface"
                    }`}
                  >
                    <span className="line-clamp-2 text-sm font-semibold leading-snug text-pf-text">{p.name}</span>
                    {p.productType === "SERVICIO" ? null : p.productType === "KIT" ? (
                      <span className="mt-0.5 text-[11px] font-medium text-pf-info">Combo</span>
                    ) : posBehavior.showStockWhileSelling ? (
                      <span className={`mt-0.5 text-[11px] font-medium ${p.stock <= 5 ? "text-pf-warning" : "text-pf-muted"}`}>
                        {outOfStock ? "Sin existencia" : `Stock ${p.stock}`}
                      </span>
                    ) : null}
                    <span className="mt-auto block pt-2 text-base font-bold tabular-nums text-pf-text">
                      {formatMoney(sym, resolveProductUnitPrice(p, 1, priceTier))}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleFavorite(p.id)}
                    aria-pressed={isFav}
                    aria-label={isFav ? `Quitar ${p.name} de favoritos` : `Marcar ${p.name} como favorito`}
                    title={isFav ? "Quitar de favoritos" : "Marcar como favorito"}
                    className={`absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-lg transition-colors touch-manipulation focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)] ${
                      isFav ? "text-pf-warning" : "text-pf-border-strong hover:text-pf-muted"
                    }`}
                  >
                    <Star className="h-4 w-4" fill={isFav ? "currentColor" : "none"} strokeWidth={2} aria-hidden />
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
        <aside id="touch-sale-cart" className="hidden h-fit lg:sticky lg:top-[7rem] lg:block" aria-label="Carrito">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold text-pf-text">
            <ShoppingCart className="h-4 w-4 text-pf-text-tertiary" strokeWidth={2} aria-hidden />
            Carrito
            {cartLineCount > 0 ? (
              <span className="rounded-full bg-pf-primary-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-[color:var(--pf-sale-tab-ink)]">
                {cartLineCount}
              </span>
            ) : null}
          </p>
          {cartPanel}
        </aside>
      </div>

      {/* Mobile bottom bar */}
      <div className="fixed inset-x-0 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-30 px-3 lg:hidden">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3 rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface-elevated p-2.5 shadow-[var(--pf-shadow-warm-xl)]">
          <div className="min-w-0 flex-1 pl-1">
            <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
              {cartLineCount} {cartLineCount === 1 ? "línea" : "líneas"}
            </p>
            <p className="truncate text-xl font-bold tabular-nums text-pf-text">{formatMoney(sym, totals.total)}</p>
          </div>
          <Button type="button" className="min-h-12 shrink-0" onClick={() => setShowCart(true)}>
            <ShoppingCart className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Ver carrito
          </Button>
        </div>
      </div>

      {/* Mobile cart drawer */}
      {showCart && (
        <div className="fixed inset-0 z-50 lg:hidden">
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

      {/* Datos del documento: fuera del carrito para no tapar el total */}
      <Modal
        open={saleInfoOpen}
        title="Datos de la venta"
        onClose={() => setSaleInfoOpen(false)}
        maxWidthClass="sm:max-w-lg"
      >
        {saleInfoPanel}
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={() => setSaleInfoOpen(false)}>
            Listo
          </Button>
        </div>
      </Modal>

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
