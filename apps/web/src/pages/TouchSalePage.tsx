import { Banknote, ClipboardList, Monitor, ShoppingCart } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageHero } from "../components/PageHero";
import { Button, Card, Field, Input, Select } from "../components/ui";
import { formatMoney } from "../lib/format";
import { isCreditSaleTerm, SALE_TERMS_OPTIONS } from "../lib/saleTerms";
import { resolveProductUnitPrice } from "../lib/volumePrice";
import type { Customer, Product } from "../types";

type Line = {
  productId: string;
  product: Product;
  qty: number;
  unitPrice: number;
  discountPercent: number;
};

export function TouchSalePage() {
  const { token, organization } = useAuth();
  const sym = organization?.currencySymbol ?? "L";
  const navigate = useNavigate();
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

  function addProduct(p: Product) {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.productId === p.id);
      const step = p.esGranel ? 0.1 : 1;
      if (i >= 0) {
        const next = [...prev];
        const newQty = next[i].qty + step;
        next[i] = {
          ...next[i],
          qty: newQty,
          unitPrice: resolveProductUnitPrice(p, newQty, priceTier),
        };
        return next;
      }
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

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
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

  async function submit() {
    if (!token || lines.length === 0) return;
    setErr("");
    if (isCreditSaleTerm(terms) && !customerId.trim()) {
      setErr("Las ventas a crédito requieren un cliente registrado.");
      return;
    }
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
      const sale = await apiFetch<{ id: string }>("/api/sales", {
        method: "POST",
        body: JSON.stringify(body),
        token,
      });
      navigate(`/ventas/${sale.id}/ticket`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pb-24 pf-safe-page xl:pb-0">
      <PageHero
        title="Venta táctil"
        actions={
          <>
            <Link to="/venta" className="inline-flex flex-1 min-[400px]:flex-none">
              <Button variant="secondary" type="button" className="w-full min-h-[48px] justify-center sm:w-auto">
                <Monitor className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                Venta estándar
              </Button>
            </Link>
            <Link to="/ventas/preventas" className="inline-flex flex-1 min-[400px]:flex-none">
              <Button variant="ghost" type="button" className="w-full min-h-[48px] justify-center border border-white/50 bg-white/40 backdrop-blur-sm sm:w-auto md:border-transparent md:bg-transparent">
                <ClipboardList className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                PreVentas
              </Button>
            </Link>
          </>
        }
      >
        <p className="pf-page-lead-muted mt-1">Toque productos para agregar al carrito</p>
      </PageHero>

      <div className="grid gap-4 xl:grid-cols-[1fr_min(380px,100%)]">
        <div className="space-y-3">
          <Card className="border-white/50 bg-gradient-to-br from-white/95 to-teal-50/20 p-3 shadow-md backdrop-blur-sm">
            <Field label="Buscar en catálogo táctil">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, SKU, código…" />
            </Field>
          </Card>

          {favorites.length > 0 ? (
            <div>
              <p className="mb-2 rounded-lg bg-gradient-to-r from-pf-mint-soft/90 to-pf-sky-soft/70 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-stone-600">
                Favoritos
              </p>
              <div className="flex gap-2.5 overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch]">
                {favorites.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProduct(p)}
                    className="min-h-[88px] min-w-[148px] shrink-0 rounded-2xl border border-orange-200/50 bg-gradient-to-br from-pf-primary/35 via-amber-100/70 to-pf-primary-soft px-4 py-3 text-left shadow-md shadow-orange-500/10 transition active:scale-[0.98] touch-manipulation hover:brightness-105"
                  >
                    <span className="block font-medium text-sm line-clamp-2">{p.name}</span>
                    <span className="text-xs text-pf-muted">
                      {formatMoney(sym, resolveProductUnitPrice(p, 1, priceTier))}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 md:gap-3">
            {filtered.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-2 rounded-2xl border border-white/60 bg-gradient-to-b from-white/95 to-slate-50/90 p-3 shadow-md shadow-stone-900/[0.06] backdrop-blur-sm ring-1 ring-white/40"
              >
                <button
                  type="button"
                  onClick={() => addProduct(p)}
                  className="-m-1 flex min-h-[96px] flex-1 flex-col rounded-xl p-2 text-left transition active:scale-[0.98] touch-manipulation hover:bg-gradient-to-br hover:from-pf-primary-soft/60 hover:to-teal-50/50"
                >
                  <span className="line-clamp-3 font-semibold text-sm leading-snug text-stone-900">{p.name}</span>
                  {p.productType === "SERVICIO" ? null : p.productType === "KIT" ? (
                    <span className="mt-0.5 text-[11px] font-medium text-teal-700/80">Combo</span>
                  ) : (
                    <span className="mt-0.5 text-[11px] font-medium text-pf-muted">Stock {p.stock}</span>
                  )}
                  <span className="mt-auto block bg-gradient-to-r from-orange-700 to-teal-800 bg-clip-text pt-2 text-lg font-bold tabular-nums text-transparent">
                    {formatMoney(sym, resolveProductUnitPrice(p, 1, priceTier))}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => toggleFavorite(p.id)}
                  className={`min-h-[44px] rounded-xl py-2 text-xs font-semibold transition active:scale-[0.98] touch-manipulation ${
                    favIds.includes(p.id)
                      ? "border border-orange-300/60 bg-gradient-to-r from-pf-primary-soft to-amber-100/80 text-pf-primary-foreground shadow-sm"
                      : "border border-white/60 bg-white/50 text-stone-600 backdrop-blur-sm hover:bg-white/80"
                  }`}
                >
                  {favIds.includes(p.id) ? "★ Favorito" : "☆ Favorito"}
                </button>
              </div>
            ))}
          </div>
        </div>

        <Card
          id="touch-sale-cart"
          className="h-fit space-y-3 border-white/50 bg-gradient-to-b from-white/95 via-pf-primary-soft/15 to-teal-50/25 p-4 shadow-[var(--pf-shadow-warm-md)] backdrop-blur-md xl:sticky xl:top-4"
        >
          <Field label="Cliente">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Seleccione cliente…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {isCreditSaleTerm(terms) ? (
            <p className="text-xs text-pf-muted -mt-1">Obligatorio para crédito.</p>
          ) : null}
          <Field label="Lista de precios">
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
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          {isCreditSaleTerm(terms) ? (
            <Field label="Abono inicial (opcional)">
              <Input type="number" step="any" value={paid} onChange={(e) => setPaid(e.target.value)} />
            </Field>
          ) : null}

          <div className="max-h-52 divide-y divide-stone-100 overflow-y-auto rounded-2xl border border-white/60 bg-white/70 text-sm shadow-inner backdrop-blur-sm">
            {lines.length === 0 ? (
              <p className="p-4 text-center text-sm font-medium text-pf-muted">Carrito vacío</p>
            ) : (
              lines.map((l, i) => (
                <div key={l.productId} className="flex flex-col gap-2 p-3">
                  <div className="flex justify-between gap-2">
                    <span className="line-clamp-2 font-semibold text-stone-800">{l.product.name}</span>
                    <button
                      type="button"
                      className="min-h-[40px] shrink-0 rounded-lg px-2 text-xs font-bold text-red-600 transition hover:bg-red-50 touch-manipulation"
                      onClick={() => removeLine(i)}
                    >
                      Quitar
                    </button>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Input
                      type="number"
                      step="any"
                      className="min-h-9 w-20 py-1"
                      value={l.qty}
                      onChange={(e) => {
                        const qty = Math.max(0.0001, Number(e.target.value) || 0);
                        updateLine(i, {
                          qty,
                          unitPrice: resolveProductUnitPrice(l.product, qty, priceTier),
                        });
                      }}
                    />
                    <span className="text-xs text-pf-muted">× {formatMoney(sym, l.unitPrice)}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="space-y-2 rounded-2xl border border-orange-200/40 bg-gradient-to-br from-pf-primary/20 via-amber-100/50 to-teal-100/40 p-4 text-sm shadow-inner ring-1 ring-white/50">
            <div className="flex justify-between font-medium">
              <span className="text-stone-600">Subtotal</span>
              <span className="tabular-nums text-stone-800">{formatMoney(sym, totals.subtotal)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span className="text-stone-600">Impuesto</span>
              <span className="tabular-nums text-stone-800">{formatMoney(sym, totals.tax)}</span>
            </div>
            <div className="flex justify-between border-t border-orange-200/50 pt-3 text-lg font-extrabold text-stone-900">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(sym, totals.total)}</span>
            </div>
          </div>
          {err ? <p className="text-sm font-medium text-red-600">{err}</p> : null}
          <Button type="button" className="w-full min-h-[56px] text-base shadow-lg" onClick={submit} disabled={busy || lines.length === 0}>
            <Banknote className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
            {busy ? "Guardando…" : "Cobrar"}
          </Button>
        </Card>
      </div>

      <div className="fixed inset-x-0 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-30 px-3 xl:hidden">
        <div className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-2xl border border-white/60 bg-white/95 p-2.5 shadow-[var(--pf-shadow-warm-xl)] backdrop-blur-xl">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-gradient-to-r from-pf-primary-soft/60 to-teal-50/70 px-3 py-2">
            <ShoppingCart className="h-4 w-4 shrink-0 text-pf-text-secondary" strokeWidth={2} aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
                {cartLineCount} {cartLineCount === 1 ? "linea" : "lineas"} en carrito
              </p>
              <p className="truncate text-sm font-extrabold tabular-nums text-pf-text">{formatMoney(sym, totals.total)}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px] shrink-0"
            onClick={() =>
              document.getElementById("touch-sale-cart")?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            Ver carrito
          </Button>
        </div>
      </div>
    </div>
  );
}
