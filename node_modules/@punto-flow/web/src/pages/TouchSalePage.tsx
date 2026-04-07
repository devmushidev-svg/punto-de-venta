import { CheckCircle2, ClipboardList, Minus, Monitor, Plus, Printer, Save, ShoppingCart, Star, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Modal, Select } from "../components/ui";
import { formatMoney } from "../lib/format";
import { isCreditSaleTerm, SALE_TERMS_OPTIONS } from "../lib/saleTerms";
import { printSaleTicketInHiddenFrame } from "../lib/ticketPrint";
import { resolveProductUnitPrice } from "../lib/volumePrice";
import type { Customer, Product, Sale } from "../types";

type Line = {
  productId: string;
  product: Product;
  qty: number;
  unitPrice: number;
  discountPercent: number;
};

type Toast = { message: string; kind: "success" | "print" };

export function TouchSalePage() {
  const { token, organization } = useAuth();
  const sym = organization?.currencySymbol ?? "L";
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [priceTier, setPriceTier] = useState(1);
  const [terms, setTerms] = useState("CONTADO");
  const [paid, setPaid] = useState("");
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

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, kind: Toast["kind"]) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, kind });
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    if (!token) return;
    apiFetch<Customer[]>("/api/customers", { token }).then((c) => {
      setCustomers(c);
      const def = c.find((x) => x.name.includes("CONSUMIDOR")) ?? c[0];
      if (def) setCustomerId(def.id);
      else setCustomerId("");
    });
    apiFetch<{ general: { touchFavoriteProductIds?: string[] } }>("/api/settings", { token }).then((s) => {
      const ids = s.general?.touchFavoriteProductIds;
      if (Array.isArray(ids)) setFavIds(ids.filter((x) => typeof x === "string"));
    });
    apiFetch<Product[]>("/api/products?touch=1", { token }).then(setProducts).catch(() => setProducts([]));
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

  function tracksStock(p: Product) {
    return p.productType !== "KIT" && p.productType !== "SERVICIO";
  }

  function addProduct(p: Product) {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.productId === p.id);
      const step = p.esGranel ? 0.1 : 1;
      if (i >= 0) {
        const next = [...prev];
        const newQty = next[i].qty + step;
        if (tracksStock(p) && newQty > p.stock) return prev;
        next[i] = {
          ...next[i],
          qty: newQty,
          unitPrice: resolveProductUnitPrice(p, newQty, priceTier),
        };
        return next;
      }
      if (tracksStock(p) && p.stock <= 0) return prev;
      const q0 = p.esGranel ? 0.1 : 1;
      return [
        ...prev,
        {
          productId: p.id,
          product: p,
          qty: q0,
          unitPrice: resolveProductUnitPrice(p, q0, priceTier),
          discountPercent: 0,
        },
      ];
    });
  }

  function updateLineQty(i: number, delta: number) {
    setLines((prev) => {
      const l = prev[i];
      const step = l.product.esGranel ? 0.1 : 1;
      const newQty = Math.max(step, l.qty + delta * step);
      if (tracksStock(l.product) && newQty > l.product.stock) return prev;
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

  const cartLineCount = lines.length;

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

  async function confirmCheckout() {
    if (!token || lines.length === 0 || busy) return;
    setErr("");
    setBusy(true);
    try {
      const body = {
        customerId: customerId || null,
        terms,
        priceTier,
        paid: isCreditSaleTerm(terms) ? Number(paid) || 0 : undefined,
        lines: lines.map((l) => ({
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
        showToast("Factura guardada. Enviando ticket a impresión…", "print");
        printSaleTicketInHiddenFrame(sale.id);
      } else {
        showToast("Factura guardada correctamente", "success");
      }

      setLines([]);
      setPaid("");
      setTerms("CONTADO");
      setErr("");

      if (token) {
        apiFetch<Customer[]>("/api/customers", { token }).then((list) => {
          const def = list.find((x) => /consumidor/i.test(x.name)) ?? list[0];
          if (def) setCustomerId(def.id);
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  const cartPanel = (
    <div className="space-y-3">
      <Field label="Cliente">
        <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">Seleccione cliente…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </Field>
      {isCreditSaleTerm(terms) && (
        <p className="text-xs text-pf-muted -mt-1">Obligatorio para crédito.</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Lista precios">
          <Select value={priceTier} onChange={(e) => setPriceTier(Number(e.target.value))}>
            <option value={1}>Precio 1</option>
            <option value={2}>Precio 2</option>
            <option value={3}>Precio 3</option>
            <option value={4}>Precio 4</option>
          </Select>
        </Field>
        <Field label="Condición">
          <Select value={terms} onChange={(e) => setTerms(e.target.value)}>
            {SALE_TERMS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
      </div>
      {isCreditSaleTerm(terms) && (
        <Field label="Abono inicial (opcional)">
          <Input type="number" step="any" value={paid} onChange={(e) => setPaid(e.target.value)} />
        </Field>
      )}

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
          disabled={busy || lines.length === 0}
        >
          <Save className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          Guardar
        </Button>
        <Button
          type="button"
          className="min-h-[52px] text-sm shadow-lg"
          onClick={() => openCheckout("print")}
          disabled={busy || lines.length === 0}
        >
          <Printer className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          Imprimir
        </Button>
      </div>
    </div>
  );

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
                      disabled={outOfStock}
                      className={`min-h-[80px] min-w-[140px] shrink-0 rounded-xl border p-3 text-left shadow-sm transition active:scale-[0.98] touch-manipulation ${
                        outOfStock
                          ? "border-pf-border-soft bg-pf-surface-muted/60 opacity-50"
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
                      ? "border-pf-border-soft bg-pf-surface-muted/50 opacity-60"
                      : "border-pf-border-soft bg-pf-surface-elevated hover:shadow-md"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => addProduct(p)}
                    disabled={outOfStock}
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
    </div>
  );
}
