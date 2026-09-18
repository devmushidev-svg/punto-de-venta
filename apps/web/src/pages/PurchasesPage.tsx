import { ClipboardCheck, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Select } from "../components/ui";
import { formatDateOnly, formatMoney } from "../lib/format";
import { hasPermission, PERMISSION_KEYS } from "../lib/permissions";
import type { Product, Supplier } from "../types";

type Line = { productId: string; product: Product; qty: number; unitCost: number; taxPercent: number };

type PurchaseRow = {
  id: string;
  purchaseDate: string;
  reference: string | null;
  terms: string;
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  supplier: { id: string; name: string } | null;
  lines: {
    id: string;
    qty: number;
    unitCost: number;
    taxPercent: number;
    lineTotal: number;
    product: { name: string; sku: string };
  }[];
};

/** Que trajo la compra, en palabras. Un conteo de items no dice nada. */
function contentSummary(lines: PurchaseRow["lines"]): string {
  if (!lines?.length) return "Sin productos";
  const names = lines.map((l) => l.product?.name).filter(Boolean);
  const shown = names.slice(0, 2).join(", ");
  const rest = names.length - 2;
  return rest > 0 ? `${shown} y ${rest} más` : shown;
}

function termsLabel(terms: string): string {
  const t = (terms ?? "").trim().toUpperCase();
  if (t === "CONTADO") return "Contado";
  if (t === "CREDITO") return "Crédito";
  const days = t.match(/^(\d+)\s*DIAS?$/);
  if (days) return `${days[1]} días`;
  return terms || "—";
}

export function PurchasesPage() {
  const { token, organization, user } = useAuth();
  const canRecord = hasPermission(user, PERMISSION_KEYS.PURCHASES_RECORD);
  const sym = organization?.currencySymbol ?? "L";
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [terms, setTerms] = useState<"CONTADO" | "CREDITO">("CONTADO");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<Product[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [listLoading, setListLoading] = useState(true);

  const loadPurchases = useCallback(async () => {
    if (!token) return;
    setListLoading(true);
    try {
      const data = await apiFetch<PurchaseRow[]>("/api/purchases", { token });
      setPurchases(data);
    } catch {
      setPurchases([]);
    } finally {
      setListLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadPurchases();
  }, [loadPurchases]);

  useEffect(() => {
    if (!token || !canRecord) return;
    apiFetch<Supplier[]>("/api/suppliers", { token }).then((s) => {
      setSuppliers(s);
      if (s[0]) setSupplierId(s[0].id);
    });
  }, [token, canRecord]);

  const runSearch = useCallback(async () => {
    if (!token || !canRecord || !search.trim()) {
      setHits([]);
      return;
    }
    const data = await apiFetch<Product[]>(`/api/products?q=${encodeURIComponent(search.trim())}`, { token });
    setHits(data.filter((p) => p.active && p.productType !== "KIT" && p.productType !== "SERVICIO").slice(0, 12));
  }, [token, canRecord, search]);

  useEffect(() => {
    if (!canRecord) return;
    const t = setTimeout(runSearch, 200);
    return () => clearTimeout(t);
  }, [runSearch, canRecord]);

  function addProduct(p: Product) {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.productId === p.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], qty: next[i].qty + 1 };
        return next;
      }
      return [...prev, { productId: p.id, product: p, qty: 1, unitCost: p.cost || 0, taxPercent: p.taxPercent }];
    });
    setSearch("");
    setHits([]);
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
      const base = l.unitCost * l.qty;
      sub += base;
      tax += base * (l.taxPercent / 100);
    }
    return { subtotal: sub, tax, total: sub + tax };
  }, [lines]);

  /** Lo que la pantalla debe responder: cuanto se compro y cuanto se debe. */
  const summary = useMemo(() => {
    let spent = 0;
    let owed = 0;
    let owedCount = 0;
    for (const p of purchases) {
      spent += p.total;
      const balance = p.total - p.paid;
      if (balance > 0.009) {
        owed += balance;
        owedCount += 1;
      }
    }
    return { spent, owed, owedCount };
  }, [purchases]);

  async function submit() {
    if (!token || lines.length === 0) return;
    setErr("");
    setBusy(true);
    try {
      await apiFetch("/api/purchases", {
        method: "POST",
        body: JSON.stringify({
          supplierId: supplierId || null,
          terms,
          lines: lines.map((l) => ({
            productId: l.productId,
            qty: l.qty,
            unitCost: l.unitCost,
            taxPercent: l.taxPercent,
          })),
        }),
        token,
      });
      setLines([]);
      setErr("");
      await loadPurchases();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[76rem] space-y-4 pf-safe-page">
      <section className="flex flex-wrap items-end gap-x-10 gap-y-4 border-b border-pf-border pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Comprado</p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-pf-text">
            {formatMoney(sym, summary.spent)}
          </p>
          <p className="mt-0.5 text-xs text-pf-text-tertiary">
            {purchases.length} {purchases.length === 1 ? "compra registrada" : "compras registradas"}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Debe a proveedores</p>
          <p
            className={`mt-1 text-2xl font-bold tabular-nums tracking-tight ${
              summary.owed > 0 ? "text-pf-warning" : "text-pf-text-tertiary"
            }`}
          >
            {formatMoney(sym, summary.owed)}
          </p>
          <p className="mt-0.5 text-xs text-pf-text-tertiary">
            {summary.owedCount === 0
              ? "Todo pagado"
              : `${summary.owedCount} ${summary.owedCount === 1 ? "compra con saldo" : "compras con saldo"}`}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="ml-auto min-h-10 self-center"
          onClick={loadPurchases}
          disabled={listLoading}
          title="Recargar el listado"
          aria-label="Recargar el listado"
        >
          <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
        </Button>
      </section>

      <Card className="overflow-hidden p-0">
        {listLoading ? (
          <p className="p-8 text-center text-sm text-pf-muted">Cargando…</p>
        ) : purchases.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium text-pf-text">Todavía no hay compras registradas</p>
            <p className="mt-1 text-sm text-pf-text-tertiary">
              {canRecord
                ? "Registre una compra abajo para dar de alta mercancía y actualizar el costo."
                : "Para registrar compras necesita el permiso «Registrar compras»."}
            </p>
          </div>
        ) : (
          <div className="max-h-[min(420px,calc(100vh-20rem))] overflow-auto overscroll-contain">
            <table className="w-full min-w-[800px] text-sm">
              <caption className="sr-only">Compras registradas</caption>
              <thead className="sticky top-0 z-[1] bg-pf-surface-elevated">
                <tr className="border-b border-pf-border text-left text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Fecha</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Proveedor</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Contiene</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Condición</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Total</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Pendiente</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => {
                  const balance = p.total - p.paid;
                  const ref = p.reference?.trim();
                  return (
                    <tr key={p.id} className="border-b border-pf-border last:border-0 hover:bg-pf-surface">
                      <td className="whitespace-nowrap px-4 py-3 text-pf-text-secondary">
                        {formatDateOnly(p.purchaseDate)}
                        {ref ? <span className="block font-mono text-xs text-pf-muted">{ref}</span> : null}
                      </td>
                      <td className="max-w-0 truncate px-4 py-3 font-medium text-pf-text">
                        {p.supplier?.name ?? "Sin proveedor"}
                      </td>
                      <td className="max-w-0 truncate px-4 py-3 text-pf-text-tertiary">{contentSummary(p.lines)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-pf-text-tertiary">{termsLabel(p.terms)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-pf-text">
                        {formatMoney(sym, p.total)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {balance > 0.009 ? (
                          <span className="font-semibold text-pf-warning">{formatMoney(sym, balance)}</span>
                        ) : (
                          <span className="text-pf-success">Pagada</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canRecord ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(17rem,0.9fr)]">
          <Card className="min-w-0 space-y-3 p-4">
            <h2 className="text-sm font-bold text-pf-text">Registrar una compra</h2>
            <p className="text-xs text-pf-text-tertiary">
              Sube el inventario y actualiza el costo. Los combos se compran por sus componentes.
            </p>

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pf-muted"
                strokeWidth={2}
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar producto por nombre o SKU…"
                aria-label="Buscar producto para agregar a la compra"
                className="!pl-9"
              />
            </div>

            {hits.length > 0 ? (
              <ul className="max-h-52 divide-y divide-pf-border overflow-y-auto rounded-[var(--radius-pf)] border border-pf-border">
                {hits.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-pf-surface focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
                      onClick={() => addProduct(p)}
                    >
                      <span className="min-w-0 truncate font-medium text-pf-text">{p.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-pf-text-tertiary">
                        Costo ref. {formatMoney(sym, p.cost)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="overflow-x-auto rounded-[var(--radius-pf)] border border-pf-border">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-pf-border text-left text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
                    <th scope="col" className="px-3 py-2 font-semibold">Producto</th>
                    <th scope="col" className="w-24 px-3 py-2 font-semibold">Cant.</th>
                    <th scope="col" className="w-28 px-3 py-2 font-semibold">Costo</th>
                    <th scope="col" className="w-24 px-3 py-2 font-semibold">ISV %</th>
                    <th scope="col" className="w-12 px-3 py-2">
                      <span className="sr-only">Quitar</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-sm text-pf-muted">
                        Busque un producto arriba para empezar.
                      </td>
                    </tr>
                  ) : (
                    lines.map((l, i) => (
                      <tr key={l.productId} className="border-b border-pf-border last:border-0">
                        <td className="px-3 py-2 font-medium text-pf-text">{l.product.name}</td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="any"
                            aria-label={`Cantidad de ${l.product.name}`}
                            className="min-h-10"
                            value={l.qty}
                            onChange={(e) => updateLine(i, { qty: Math.max(0.0001, Number(e.target.value) || 0) })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="any"
                            aria-label={`Costo de ${l.product.name}`}
                            className="min-h-10"
                            value={l.unitCost}
                            onChange={(e) => updateLine(i, { unitCost: Number(e.target.value) || 0 })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="any"
                            aria-label={`ISV de ${l.product.name}`}
                            className="min-h-10"
                            value={l.taxPercent}
                            onChange={(e) => updateLine(i, { taxPercent: Number(e.target.value) || 0 })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            aria-label={`Quitar ${l.product.name}`}
                            className="flex h-10 w-10 items-center justify-center rounded-lg text-pf-danger transition-colors hover:bg-pf-danger-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
                            onClick={() => removeLine(i)}
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="h-fit space-y-3 p-4 lg:sticky lg:top-[7rem]">
            <Field label="Proveedor">
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Sin proveedor</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="¿Cómo se paga?">
              <Select value={terms} onChange={(e) => setTerms(e.target.value as "CONTADO" | "CREDITO")}>
                <option value="CONTADO">Contado</option>
                <option value="CREDITO">Crédito</option>
              </Select>
            </Field>

            <div className="rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface p-3 text-sm">
              <div className="flex justify-between text-pf-text-tertiary">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatMoney(sym, totals.subtotal)}</span>
              </div>
              <div className="mt-1 flex justify-between text-pf-text-tertiary">
                <span>Impuesto</span>
                <span className="tabular-nums">{formatMoney(sym, totals.tax)}</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between border-t border-pf-border pt-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Total</span>
                <span className="text-2xl font-bold tabular-nums text-pf-text">{formatMoney(sym, totals.total)}</span>
              </div>
            </div>

            {err ? (
              <p className="rounded-[var(--radius-pf)] border border-pf-danger-soft bg-pf-danger-soft px-3 py-2 text-sm font-medium text-pf-danger">
                {err}
              </p>
            ) : null}

            <Button
              type="button"
              className="min-h-12 w-full"
              onClick={submit}
              disabled={busy || lines.length === 0}
            >
              <ClipboardCheck className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {busy ? "Guardando…" : "Registrar compra"}
            </Button>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
