import { ClipboardCheck, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHero } from "../components/PageHero";
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
    setHits(
      data.filter((p) => p.active && p.productType !== "KIT" && p.productType !== "SERVICIO").slice(0, 12)
    );
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
      return [
        ...prev,
        { productId: p.id, product: p, qty: 1, unitCost: p.cost || 0, taxPercent: p.taxPercent },
      ];
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
      const t = base * (l.taxPercent / 100);
      sub += base;
      tax += t;
    }
    return { subtotal: sub, tax, total: sub + tax };
  }, [lines]);

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
    <div className="space-y-4 pf-safe-page">
      <PageHero title={"Compras"}>
        <p className="pf-page-lead max-w-2xl">
          Qué es: historial de compras registradas
          {canRecord ? "; con permiso de registro puede dar de alta mercancía (inventario y costo)." : "."}
        </p>
        <p className="pf-page-lead-muted max-w-2xl">
          {canRecord
            ? "Elija proveedor y términos (contado o crédito), busque productos y confirme. Los combos (KIT) no se compran como tal; use los componentes."
            : "Su usuario solo puede consultar este listado. Para registrar compras necesita el permiso «Registrar compras»."}
        </p>
      </PageHero>

      <Card className="min-h-0 overflow-hidden border-white/50 p-0 shadow-lg shadow-stone-900/[0.04]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200/80 bg-gradient-to-r from-stone-50/90 to-teal-50/30 px-3 py-3 backdrop-blur-sm">
          <span className="text-sm font-bold text-stone-800">Compras registradas</span>
          <Button type="button" variant="secondary" className="min-h-[48px] md:min-h-9" onClick={loadPurchases} disabled={listLoading}>
            <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Actualizar
          </Button>
        </div>
        {listLoading ? (
          <p className="p-4 text-center font-medium text-pf-muted">Cargando…</p>
        ) : (
          <div className="max-h-[min(420px,calc(100vh-14rem))] overflow-auto overscroll-contain rounded-b-2xl md:rounded-none">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="sticky top-0 z-[1]">
                <tr className="border-b border-stone-200/80 bg-gradient-to-r from-stone-100/98 via-amber-50/40 to-teal-50/45 text-left shadow-sm backdrop-blur-md">
                  <th className="p-2">Fecha</th>
                  <th className="p-2">Ref.</th>
                  <th className="p-2">Proveedor</th>
                  <th className="p-2">Términos</th>
                  <th className="p-2 text-right">Ítems</th>
                  <th className="p-2 text-right">Total</th>
                  <th className="p-2 text-right">Pagado</th>
                </tr>
              </thead>
              <tbody className="bg-white/80 md:bg-pf-surface-elevated">
                {purchases.map((p) => {
                  const balance = p.total - p.paid;
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-stone-100/90 transition hover:bg-gradient-to-r hover:from-amber-50/45 hover:to-transparent"
                    >
                      <td className="p-2 whitespace-nowrap">{formatDateOnly(p.purchaseDate)}</td>
                      <td className="p-2 font-mono text-xs">{p.reference?.trim() || "—"}</td>
                      <td className="p-2 truncate max-w-[180px]">{p.supplier?.name ?? "—"}</td>
                      <td className="p-2">{p.terms}</td>
                      <td className="p-2 text-right">{p.lines.length}</td>
                      <td className="p-2 text-right font-medium whitespace-nowrap">{formatMoney(sym, p.total)}</td>
                      <td className="p-2 text-right whitespace-nowrap">
                        {formatMoney(sym, p.paid)}
                        {balance > 0.009 ? (
                          <span className="block text-xs text-amber-800">Saldo {formatMoney(sym, balance)}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!listLoading && purchases.length === 0 ? (
          <p className="p-4 text-center text-pf-muted">Aún no hay compras registradas</p>
        ) : null}
      </Card>

      {canRecord ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="space-y-4 border-white/50 bg-gradient-to-b from-white/95 to-teal-50/10 p-4 shadow-md backdrop-blur-sm lg:col-span-2">
            <Field label="Buscar producto">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o SKU" />
            </Field>
            {hits.length > 0 ? (
              <ul className="max-h-52 divide-y divide-stone-100 overflow-y-auto rounded-2xl border border-white/60 bg-white/90 shadow-[var(--pf-shadow-warm-sm)] backdrop-blur-sm">
                {hits.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition hover:bg-gradient-to-r hover:from-teal-50/60 hover:to-pf-primary-soft/40 touch-manipulation active:bg-teal-50/80"
                      onClick={() => addProduct(p)}
                    >
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="shrink-0 text-pf-muted">Costo ref. {formatMoney(sym, p.cost)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="overflow-x-auto rounded-2xl border border-white/60 bg-white/80 shadow-inner backdrop-blur-sm">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="bg-gradient-to-r from-teal-100/50 via-pf-primary-soft/40 to-amber-50/50 text-left">
                    <th className="p-2">Producto</th>
                    <th className="p-2 w-24">Cant.</th>
                    <th className="p-2 w-28">Costo</th>
                    <th className="p-2 w-24">ISV %</th>
                    <th className="p-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-pf-muted">
                        Agregue productos desde la búsqueda
                      </td>
                    </tr>
                  ) : (
                    lines.map((l, i) => (
                      <tr key={l.productId} className="border-t border-stone-100/90 hover:bg-teal-50/20">
                        <td className="p-2 font-medium">{l.product.name}</td>
                        <td className="p-2">
                          <Input
                            type="number"
                            step="any"
                            className="min-h-10 py-1"
                            value={l.qty}
                            onChange={(e) => updateLine(i, { qty: Math.max(0.0001, Number(e.target.value) || 0) })}
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            step="any"
                            className="min-h-10 py-1"
                            value={l.unitCost}
                            onChange={(e) => updateLine(i, { unitCost: Number(e.target.value) || 0 })}
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            step="any"
                            className="min-h-10 py-1"
                            value={l.taxPercent}
                            onChange={(e) => updateLine(i, { taxPercent: Number(e.target.value) || 0 })}
                          />
                        </td>
                        <td className="p-2">
                          <button
                            type="button"
                            className="min-h-[44px] rounded-lg px-2 text-xs font-semibold text-red-600 hover:bg-red-50 touch-manipulation"
                            onClick={() => removeLine(i)}
                          >
                            Quitar
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="h-fit space-y-3 border-white/50 bg-gradient-to-b from-white/95 via-amber-50/15 to-teal-50/20 p-4 shadow-[var(--pf-shadow-warm-md)] backdrop-blur-md lg:sticky lg:top-4">
            <Field label="Proveedor">
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">— Ninguno —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Condición">
              <Select value={terms} onChange={(e) => setTerms(e.target.value as "CONTADO" | "CREDITO")}>
                <option value="CONTADO">Contado</option>
                <option value="CREDITO">Crédito</option>
              </Select>
            </Field>
            <div className="space-y-2 rounded-2xl border border-teal-200/40 bg-gradient-to-br from-teal-50/80 via-pf-primary-soft/50 to-amber-50/50 p-4 text-sm shadow-inner ring-1 ring-white/50">
              <div className="flex justify-between font-medium">
                <span className="text-stone-600">Subtotal</span>
                <span className="tabular-nums text-stone-800">{formatMoney(sym, totals.subtotal)}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span className="text-stone-600">Impuesto</span>
                <span className="tabular-nums text-stone-800">{formatMoney(sym, totals.tax)}</span>
              </div>
              <div className="flex justify-between border-t border-teal-200/50 pt-3 text-lg font-extrabold text-stone-900">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(sym, totals.total)}</span>
              </div>
            </div>
            {err ? <p className="text-sm font-medium text-red-600">{err}</p> : null}
            <Button type="button" className="w-full min-h-[52px] text-base shadow-lg" onClick={submit} disabled={busy || lines.length === 0}>
              <ClipboardCheck className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {busy ? "Guardando…" : "Registrar compra"}
            </Button>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
