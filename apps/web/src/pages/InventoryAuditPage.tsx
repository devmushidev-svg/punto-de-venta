import { ClipboardCheck, History, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Select, Textarea } from "../components/ui";
import type { Product, StockAdjustmentRow } from "../types";

type DraftLine = { productId: string; product: Product; qtyDelta: string };

const REASONS = [
  { value: "Conteo físico", label: "Conteo físico" },
  { value: "Merma / rotura", label: "Merma / rotura" },
  { value: "Daño", label: "Daño en almacén" },
  { value: "Corrección de datos", label: "Corrección de datos" },
  { value: "Otro (ver notas)", label: "Otro (detallar en notas)" },
] as const;

export function InventoryAuditPage() {
  const { token, user } = useAuth();
  const [list, setList] = useState<StockAdjustmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState<string>(REASONS[0].value);
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<Product[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<StockAdjustmentRow[]>("/api/stock-adjustments", { token });
      setList(data);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const runSearch = useCallback(async () => {
    if (!token || !search.trim()) {
      setHits([]);
      return;
    }
    const data = await apiFetch<Product[]>(`/api/products?q=${encodeURIComponent(search.trim())}`, { token });
    setHits(data.filter((p) => p.active && p.productType !== "KIT" && p.productType !== "SERVICIO").slice(0, 12));
  }, [token, search]);

  useEffect(() => {
    const t = setTimeout(runSearch, 200);
    return () => clearTimeout(t);
  }, [runSearch]);

  function addProduct(p: Product) {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.productId === p.id);
      if (i >= 0) return prev;
      return [...prev, { productId: p.id, product: p, qtyDelta: "" }];
    });
    setSearch("");
    setHits([]);
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, j) => j !== i));
  }

  async function submit() {
    if (!token || lines.length === 0) return;
    setErr("");
    const payloadLines: { productId: string; qtyDelta: number }[] = [];
    for (const l of lines) {
      const d = Number(l.qtyDelta);
      if (!Number.isFinite(d) || d === 0) {
        setErr("Cada línea necesita un cambio (+ o −) distinto de cero.");
        return;
      }
      payloadLines.push({ productId: l.productId, qtyDelta: d });
    }
    setBusy(true);
    try {
      await apiFetch("/api/stock-adjustments", {
        method: "POST",
        body: JSON.stringify({
          reason,
          notes: notes.trim() || undefined,
          lines: payloadLines,
        }),
        token,
      });
      setLines([]);
      setNotes("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  if (user?.role !== "admin") {
    return (
      <div className="p-4 pf-safe-page">
        <p className="rounded-2xl border border-amber-200/70 bg-gradient-to-r from-amber-50 to-orange-50/80 px-4 py-4 text-sm font-medium text-amber-950 shadow-sm">
          Solo el administrador puede registrar ajustes de inventario.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pf-safe-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHero title={"Auditoría de inventario"} constrained>
          <p className="mt-1.5 text-sm font-medium text-stone-700 max-w-xl">
            Registre ajustes con motivo (conteo, merma, corrección). Cada línea suma o resta existencia del producto. El historial por producto incluye
            ventas, compras, traslados y estos ajustes.
          </p>
        </PageHero>
        <Button
          type="button"
          variant="secondary"
          className="min-h-[48px] w-full shrink-0 shadow-md sm:w-auto sm:min-h-[44px]"
          onClick={() => void load()}
        >
          <RefreshCw className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" strokeWidth={2} aria-hidden />
          Actualizar
        </Button>
      </div>

      <Card className="space-y-4 border-white/50 bg-gradient-to-br from-white/92 via-slate-50/25 to-amber-50/20 p-4 shadow-lg backdrop-blur-sm md:p-5">
        <div className="flex items-center gap-2 text-stone-800">
          <ClipboardCheck className="h-5 w-5 shrink-0 text-amber-700/80" strokeWidth={2} aria-hidden />
          <h2 className="text-lg font-bold text-stone-900">Nuevo ajuste</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Motivo">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Notas (opcional)">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Detalle adicional…" />
        </Field>
        <Field label="Buscar producto">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o SKU" />
        </Field>
        {hits.length > 0 ? (
          <ul className="max-h-48 divide-y divide-stone-100/90 overflow-y-auto rounded-2xl border border-white/60 bg-white/80 text-sm shadow-inner backdrop-blur-sm">
            {hits.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex min-h-[52px] w-full touch-manipulation items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-gradient-to-r hover:from-amber-50/80 hover:to-transparent"
                  onClick={() => addProduct(p)}
                >
                  <span className="font-medium truncate">{p.name}</span>
                  <span className="shrink-0 text-xs text-pf-muted">Stock {p.stock}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {lines.length > 0 ? (
          <div className="overflow-x-auto rounded-2xl border border-white/60 bg-white/85 shadow-inner backdrop-blur-sm">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-slate-50/95 to-amber-50/50 text-left text-xs font-bold text-stone-700">
                  <th className="p-2">Producto</th>
                  <th className="p-2 w-36">Cambio (+/−)</th>
                  <th className="p-2 w-12" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.productId} className="border-t border-stone-100/90 transition hover:bg-amber-50/25">
                    <td className="p-2">
                      <span className="font-bold text-stone-900">{l.product.name}</span>
                      <span className="block font-mono text-xs text-pf-muted">{l.product.sku}</span>
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        step="any"
                        className="min-h-11 py-2 sm:min-h-9 sm:py-1"
                        value={l.qtyDelta}
                        onChange={(e) =>
                          setLines((prev) => {
                            const next = [...prev];
                            next[i] = { ...next[i], qtyDelta: e.target.value };
                            return next;
                          })
                        }
                        placeholder="ej. -2 o 5"
                      />
                    </td>
                    <td className="p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 touch-manipulation text-xs font-bold text-red-700 sm:min-h-9"
                        onClick={() => removeLine(i)}
                      >
                        Quitar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs font-medium text-stone-500">Agregue productos y el cambio de existencia (positivo suma, negativo resta).</p>
        )}
        {err ? (
          <p className="rounded-xl border border-red-100 bg-red-50/80 px-3 py-2 text-sm font-medium text-red-700">{err}</p>
        ) : null}
        <Button type="button" className="min-h-[52px] w-full text-base shadow-lg sm:w-auto" disabled={busy || lines.length === 0} onClick={() => void submit()}>
          <Plus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          {busy ? "Guardando…" : "Registrar ajuste"}
        </Button>
      </Card>

      <Card className="overflow-x-auto border-white/50 bg-gradient-to-br from-white/92 via-slate-50/15 to-amber-50/12 p-0 shadow-lg backdrop-blur-sm">
        <div className="flex items-center gap-2 border-b border-stone-200/80 bg-gradient-to-r from-white/90 to-slate-50/40 px-4 py-3">
          <History className="h-5 w-5 shrink-0 text-stone-500" strokeWidth={2} aria-hidden />
          <h2 className="text-lg font-bold text-stone-900">Ajustes recientes</h2>
        </div>
        {loading ? (
          <p className="p-6 text-center font-medium text-pf-muted">Cargando…</p>
        ) : list.length === 0 ? (
          <p className="p-6 text-center font-medium text-pf-muted">Aún no hay ajustes registrados.</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-stone-200/80 bg-gradient-to-r from-slate-50/95 to-amber-50/50 text-left text-xs font-bold text-stone-700 shadow-sm backdrop-blur-md">
                <th className="p-2">Número</th>
                <th className="p-2">Fecha</th>
                <th className="p-2">Motivo</th>
                <th className="p-2">Usuario</th>
                <th className="p-2">Líneas</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className="border-b border-stone-100/90 align-top transition hover:bg-slate-50/50">
                  <td className="p-2 font-mono text-xs">{a.adjustmentNumber ?? "—"}</td>
                  <td className="p-2 text-xs whitespace-nowrap">
                    {new Date(a.createdAt).toLocaleString("es-HN", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="p-2 text-xs">
                    <span className="font-medium">{a.reason}</span>
                    {a.notes ? <span className="block text-pf-muted mt-0.5">{a.notes}</span> : null}
                  </td>
                  <td className="p-2 text-xs text-pf-muted">{a.user.displayName}</td>
                  <td className="p-2 text-xs">
                    <ul className="space-y-1">
                      {a.lines.map((ln) => (
                        <li key={ln.id}>
                          {ln.product.sku} {ln.qtyDelta > 0 ? "+" : ""}
                          {ln.qtyDelta} — {ln.product.name}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
