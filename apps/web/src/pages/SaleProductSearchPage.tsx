import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Field, Input, Select } from "../components/ui";
import { formatMoney } from "../lib/format";
import { postProductPick } from "../lib/saleProductPick";
import type { Product, Supplier } from "../types";

function buildProductsQuery(q: string, supplierId: string, inStockOnly: boolean): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  params.set("touch", "1");
  params.set("limit", "500");
  if (inStockOnly) params.set("stock", "with");
  if (supplierId.trim()) params.set("supplierId", supplierId.trim());
  return params.toString();
}

export function SaleProductSearchPage() {
  const { token, organization } = useAuth();
  const sym = organization?.currencySymbol ?? "L";
  const [q, setQ] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [rows, setRows] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!token) return;
    apiFetch<Supplier[]>("/api/suppliers", { token })
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setErr("");
    setLoading(true);
    try {
      const qs = buildProductsQuery(q, supplierId, inStockOnly);
      const data = await apiFetch<Product[]>(`/api/products?${qs}`, { token });
      setRows(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al cargar");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, q, supplierId, inStockOnly]);

  useEffect(() => {
    const t = setTimeout(load, 280);
    return () => clearTimeout(t);
  }, [load]);

  function pickRow(p: Product) {
    postProductPick(p.id);
    window.setTimeout(() => {
      try {
        window.close();
      } catch {
        /* ignore */
      }
    }, 80);
  }

  return (
    <div className="flex min-h-0 flex-col bg-pf-surface pf-safe-page">
      <header className="sticky top-0 z-10 border-b border-pf-border bg-gradient-to-b from-pf-surface-elevated to-pf-primary-soft/25 px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-lg font-bold text-pf-text">Buscar producto</h1>
          <Link
            to="/venta"
            className="text-sm font-semibold text-pf-primary underline-offset-2 hover:underline"
          >
            Volver a la venta
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1600px] flex-1 space-y-3 p-3 sm:p-4">
        <div className="rounded-xl border border-pf-border bg-pf-surface-elevated p-3 shadow-sm sm:p-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:items-end">
            <Field label="Buscar por nombre, código, código de barras o código rápido" className="lg:col-span-5 min-w-0">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Escriba para filtrar…"
                autoFocus
              />
            </Field>
            <Field label="Proveedor" className="lg:col-span-4 min-w-0">
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Todos los proveedores</option>
                {suppliers.map((s) => (
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
                  checked={inStockOnly}
                  onChange={(e) => setInStockOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-pf-border text-pf-primary"
                />
                Solo con existencia
              </label>
              <Button type="button" variant="secondary" className="min-h-10" onClick={() => setQ("")}>
                Limpiar búsqueda
              </Button>
            </div>
          </div>
        </div>

        <p className="rounded-lg border border-dashed border-pf-border/80 bg-pf-primary-soft/10 px-3 py-2 text-center text-xs text-pf-muted">
          Clic en una fila para agregar el producto a la venta abierta. Si no se cierra la pestaña, use la tecla o el
          botón de la ventana.
        </p>

        {err ? <p className="text-sm text-red-600">{err}</p> : null}

        <div className="overflow-x-auto rounded-xl border border-pf-border bg-pf-surface-elevated shadow-sm">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-pf-border bg-pf-primary-soft/30 text-left text-xs font-bold uppercase tracking-wide text-pf-text-secondary">
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
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-pf-muted">
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-pf-muted">
                    No hay productos para mostrar. Ajuste filtros o la búsqueda.
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr
                    key={p.id}
                    className="cursor-pointer border-b border-pf-border/60 transition hover:bg-pf-primary-soft/40"
                    onClick={() => pickRow(p)}
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-pf-text-tertiary">{p.sku}</td>
                    <td className="max-w-[280px] px-3 py-2 font-medium text-pf-text">{p.name}</td>
                    <td className="px-3 py-2 text-pf-text-secondary">{p.unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.stock}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatMoney(sym, p.price)}</td>
                    <td className="px-3 py-2 text-pf-text-tertiary">{p.category ?? "—"}</td>
                    <td className="px-3 py-2 text-pf-text-tertiary">{p.location ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-pf-text-tertiary">{p.quickCode ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.taxPercent}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <footer className="pf-btn-primary-gradient sticky bottom-0 border-t border-pf-border px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 text-pf-primary-foreground">
          <span className="text-xl font-light opacity-90" aria-hidden>
            +
          </span>
          <p className="text-sm font-bold uppercase tracking-wide">
            Agregar producto: haga clic en la fila deseada en la tabla
          </p>
        </div>
      </footer>
    </div>
  );
}
