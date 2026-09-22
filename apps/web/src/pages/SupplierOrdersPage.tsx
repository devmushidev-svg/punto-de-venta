import { Send, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHero } from "../components/PageHero";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Select } from "../components/ui";
import { formatDate, formatMoney } from "../lib/format";
import { hasPermission, PERMISSION_KEYS } from "../lib/permissions";
import type { Product, Supplier } from "../types";

type OrderLine = {
  id: string;
  qty: number;
  unitPrice: number | null;
  notes: string | null;
  product: Product;
};

type SupplierOrderRow = {
  id: string;
  orderNumber: string | null;
  status: string;
  expectedDate: string | null;
  notes: string | null;
  createdAt: string;
  supplier: Supplier | null;
  lines: OrderLine[];
};

type DraftLine = { productId: string; product: Product; qty: number; unitPrice: string; notes: string };

const STATUSES = ["PENDIENTE", "ENVIADO", "RECIBIDO", "CANCELADO"];

export function SupplierOrdersPage() {
  const { token, user, organization } = useAuth();
  const sym = organization?.currencySymbol ?? "L";
  const [orders, setOrders] = useState<SupplierOrderRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<Product[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const loadOrders = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiFetch<SupplierOrderRow[]>("/api/orders", { token });
      setOrders(data);
    } catch {
      setOrders([]);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    apiFetch<Supplier[]>("/api/suppliers", { token }).then((s) => {
      setSuppliers(s);
      if (s[0] && !supplierId) setSupplierId(s[0].id);
    });
    loadOrders();
  }, [token, loadOrders]);

  const runSearch = useCallback(async () => {
    if (!token || !search.trim()) {
      setHits([]);
      return;
    }
    const data = await apiFetch<Product[]>(`/api/products?q=${encodeURIComponent(search.trim())}`, { token });
    setHits(
      data.filter((p) => p.active && p.productType !== "KIT" && p.productType !== "SERVICIO").slice(0, 12)
    );
  }, [token, search]);

  useEffect(() => {
    const t = setTimeout(runSearch, 200);
    return () => clearTimeout(t);
  }, [runSearch]);

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
        {
          productId: p.id,
          product: p,
          qty: 1,
          unitPrice: p.cost ? String(p.cost) : "",
          notes: "",
        },
      ];
    });
    setSearch("");
    setHits([]);
  }

  function updateDraft(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  function removeDraft(i: number) {
    setLines((prev) => prev.filter((_, j) => j !== i));
  }

  const draftTotals = useMemo(() => {
    let est = 0;
    for (const l of lines) {
      const up = l.unitPrice === "" ? 0 : Number(l.unitPrice);
      est += up * l.qty;
    }
    return est;
  }, [lines]);

  async function submitOrder() {
    if (!token || lines.length === 0) return;
    setErr("");
    setBusy(true);
    try {
      await apiFetch("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          supplierId: supplierId || null,
          expectedDate: expectedDate || null,
          notes: orderNotes || undefined,
          lines: lines.map((l) => ({
            productId: l.productId,
            qty: l.qty,
            unitPrice: l.unitPrice === "" ? null : Number(l.unitPrice),
            notes: l.notes || undefined,
          })),
        }),
        token,
      });
      setLines([]);
      setOrderNotes("");
      setExpectedDate("");
      await loadOrders();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function patchStatus(id: string, status: string) {
    if (!token) return;
    try {
      await apiFetch(`/api/orders/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
        token,
      });
      await loadOrders();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-6 pf-safe-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHero title={"Pedidos a proveedor"} constrained>
          <p className="pf-page-lead">
            Solicitudes de mercancía; el inventario sube al registrar la compra en Compras.
          </p>
        </PageHero>
        {hasPermission(user, PERMISSION_KEYS.PURCHASES_RECORD) ? (
          <Link to="/compras" className="block w-full shrink-0 sm:w-auto">
            <Button
              variant="secondary"
              type="button"
              className="min-h-[48px] w-full shadow-md sm:min-h-[44px] sm:w-auto"
            >
              <Truck className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" strokeWidth={2} aria-hidden />
              Ir a compras
            </Button>
          </Link>
        ) : null}
      </div>

      <Card className="space-y-4 border-white/50 bg-gradient-to-br from-white/92 via-teal-50/18 to-amber-50/20 p-4 shadow-lg shadow-stone-900/[0.05] backdrop-blur-sm md:p-5">
        <h2 className="font-bold text-stone-900">Nuevo pedido</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Proveedor">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Entrega esperada">
            <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Notas">
          <Input value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} />
        </Field>
        <Field label="Buscar producto">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o SKU" />
        </Field>
        {hits.length > 0 ? (
          <ul className="max-h-48 divide-y divide-stone-100/90 overflow-y-auto rounded-2xl border border-white/60 bg-white/80 shadow-inner backdrop-blur-sm">
            {hits.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex min-h-[52px] w-full touch-manipulation items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium transition hover:bg-gradient-to-r hover:from-teal-50/80 hover:to-transparent"
                  onClick={() => addProduct(p)}
                >
                  <span className="truncate">{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {lines.length > 0 ? (
          <div className="overflow-x-auto rounded-2xl border border-white/60 bg-white/85 shadow-inner backdrop-blur-sm">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-teal-50/95 to-amber-50/50 text-left text-xs font-bold text-stone-700">
                  <th className="p-2">Producto</th>
                  <th className="p-2 w-24">Cant.</th>
                  <th className="p-2 w-28">Precio ref.</th>
                  <th className="p-2 w-28">Nota</th>
                  <th className="p-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.productId} className="border-t border-stone-100/90 transition hover:bg-teal-50/25">
                    <td className="p-2 font-bold text-stone-900">{l.product.name}</td>
                    <td className="p-2">
                      <Input
                        type="number"
                        step="any"
                        className="min-h-11 py-2 sm:min-h-9 sm:py-1"
                        value={l.qty}
                        onChange={(e) => updateDraft(i, { qty: Math.max(0.0001, Number(e.target.value) || 0) })}
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        step="any"
                        className="min-h-11 py-2 sm:min-h-9 sm:py-1"
                        value={l.unitPrice}
                        onChange={(e) => updateDraft(i, { unitPrice: e.target.value })}
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        className="min-h-11 py-2 sm:min-h-9 sm:py-1"
                        value={l.notes}
                        onChange={(e) => updateDraft(i, { notes: e.target.value })}
                      />
                    </td>
                    <td className="p-2">
                      <button
                        type="button"
                        className="min-h-11 min-w-[4.5rem] touch-manipulation rounded-lg px-2 text-xs font-bold text-red-700 transition hover:bg-red-50 sm:min-h-9"
                        onClick={() => removeDraft(i)}
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-stone-100/80 bg-gradient-to-r from-teal-50/40 to-transparent p-3 text-xs font-semibold text-stone-600">
              Total referencial: <span className="tabular-nums font-bold text-stone-900">{formatMoney(sym, draftTotals)}</span>
            </p>
          </div>
        ) : null}
        {err ? (
          <p className="rounded-xl border border-red-100 bg-red-50/80 px-3 py-2 text-sm font-medium text-red-700">{err}</p>
        ) : null}
        <Button
          type="button"
          className="min-h-[52px] w-full text-base shadow-lg sm:w-auto"
          onClick={submitOrder}
          disabled={busy || lines.length === 0}
        >
          <Send className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          {busy ? "Guardando…" : "Registrar pedido"}
        </Button>
      </Card>

      <Card className="overflow-x-auto border-white/50 bg-gradient-to-br from-white/92 via-teal-50/12 to-amber-50/15 p-0 shadow-lg backdrop-blur-sm">
        <h2 className="border-b border-stone-200/80 bg-gradient-to-r from-white/90 to-teal-50/35 px-4 py-3 text-lg font-bold text-stone-900 backdrop-blur-sm">
          Pedidos recientes
        </h2>
        <table className="w-full min-w-[800px] text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-stone-200/80 bg-gradient-to-r from-teal-50/90 to-amber-50/60 text-left text-xs font-bold text-stone-700 shadow-sm backdrop-blur-md">
              <th className="p-2">N°</th>
              <th className="p-2">Fecha</th>
              <th className="p-2">Proveedor</th>
              <th className="p-2">Estado</th>
              <th className="p-2">Líneas</th>
              <th className="p-2 w-44">Cambiar estado</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-stone-100/90 transition hover:bg-teal-50/30">
                <td className="p-2 font-mono text-xs">{o.orderNumber ?? o.id.slice(0, 8)}</td>
                <td className="p-2 whitespace-nowrap">{formatDate(o.createdAt)}</td>
                <td className="p-2 truncate max-w-[160px]">{o.supplier?.name ?? "—"}</td>
                <td className="p-2">{o.status}</td>
                <td className="p-2">{o.lines?.length ?? 0}</td>
                <td className="p-2">
                  <Select
                    className="min-h-11 text-xs sm:min-h-9"
                    value={o.status}
                    onChange={(e) => patchStatus(o.id, e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 ? <p className="p-8 text-center font-medium text-pf-muted">Sin pedidos</p> : null}
      </Card>
    </div>
  );
}
