import { AlertTriangle, Search, Send, Trash2, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Select } from "../components/ui";
import { formatDate, formatDateOnly, formatMoney } from "../lib/format";
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

const STATUSES = [
  { value: "PENDIENTE", label: "Pendiente de enviar" },
  { value: "ENVIADO", label: "Enviado al proveedor" },
  { value: "RECIBIDO", label: "Recibido" },
  { value: "CANCELADO", label: "Cancelado" },
];

const DAY_MS = 86_400_000;

function statusLabel(status: string): string {
  return STATUSES.find((s) => s.value === (status ?? "").toUpperCase())?.label ?? status ?? "—";
}

/** Un pedido sigue esperando mientras no se reciba ni se cancele. */
function isOpen(status: string): boolean {
  const s = (status ?? "").toUpperCase();
  return s === "PENDIENTE" || s === "ENVIADO";
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Dias de retraso respecto de la entrega esperada; null si no hay fecha. */
function daysLate(expectedDate: string | null): number | null {
  if (!expectedDate) return null;
  const d = new Date(expectedDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return Math.round((startOfToday() - d.getTime()) / DAY_MS);
}

function deliveryLabel(
  expectedDate: string | null,
  status: string,
): { text: string; tone: "danger" | "warning" | "neutral" } {
  if (!isOpen(status)) return { text: "—", tone: "neutral" };
  const late = daysLate(expectedDate);
  if (late === null) return { text: "Sin fecha acordada", tone: "neutral" };
  if (late > 0) return { text: `Atrasado ${late} ${late === 1 ? "día" : "días"}`, tone: "danger" };
  if (late === 0) return { text: "Llega hoy", tone: "warning" };
  const left = -late;
  return { text: `Llega en ${left} ${left === 1 ? "día" : "días"}`, tone: left <= 3 ? "warning" : "neutral" };
}

export function SupplierOrdersPage() {
  const { token, user, organization } = useAuth();
  const sym = organization?.currencySymbol ?? "L";
  const [orders, setOrders] = useState<SupplierOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
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
    setLoading(true);
    try {
      const data = await apiFetch<SupplierOrderRow[]>("/api/orders", { token });
      setOrders(data);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
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
    setHits(data.filter((p) => p.active && p.productType !== "KIT" && p.productType !== "SERVICIO").slice(0, 12));
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
      return [...prev, { productId: p.id, product: p, qty: 1, unitPrice: p.cost ? String(p.cost) : "", notes: "" }];
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

  const draftTotal = useMemo(
    () => lines.reduce((sum, l) => sum + (l.unitPrice === "" ? 0 : Number(l.unitPrice)) * l.qty, 0),
    [lines],
  );

  /** Lo accionable: cuantos siguen esperando y cuantos ya se pasaron de fecha. */
  const summary = useMemo(() => {
    const open = orders.filter((o) => isOpen(o.status));
    const late = open.filter((o) => {
      const d = daysLate(o.expectedDate);
      return d !== null && d > 0;
    });
    return { open: open.length, late: late.length };
  }, [orders]);

  /** Lo mas atrasado primero; los cerrados al final. */
  const sorted = useMemo(() => {
    return [...orders].sort((a, b) => {
      const ao = isOpen(a.status);
      const bo = isOpen(b.status);
      if (ao !== bo) return ao ? -1 : 1;
      const da = daysLate(a.expectedDate);
      const db = daysLate(b.expectedDate);
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return db - da;
    });
  }, [orders]);

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
    <div className="mx-auto max-w-[76rem] space-y-4 pf-safe-page">
      <section className="flex flex-wrap items-end gap-x-10 gap-y-4 border-b border-pf-border pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Esperando mercancía</p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-pf-text">{summary.open}</p>
          <p className="mt-0.5 text-xs text-pf-text-tertiary">
            {summary.open === 0 ? "Ningún pedido abierto" : summary.open === 1 ? "pedido sin recibir" : "pedidos sin recibir"}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Atrasados</p>
          <p
            className={`mt-1 text-2xl font-bold tabular-nums tracking-tight ${
              summary.late > 0 ? "text-pf-danger" : "text-pf-text-tertiary"
            }`}
          >
            {summary.late}
          </p>
          <p className="mt-0.5 text-xs text-pf-text-tertiary">
            {summary.late === 0 ? "Nadie se pasó de fecha" : "pasaron la fecha acordada"}
          </p>
        </div>
        {hasPermission(user, PERMISSION_KEYS.PURCHASES_RECORD) ? (
          <Link to="/compras" className="ml-auto self-center">
            <Button variant="secondary" type="button" className="min-h-10">
              <Truck className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              Registrar la compra
            </Button>
          </Link>
        ) : null}
      </section>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <p className="p-8 text-center text-sm text-pf-muted">Cargando…</p>
        ) : sorted.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium text-pf-text">Todavía no hay pedidos</p>
            <p className="mt-1 text-sm text-pf-text-tertiary">
              Un pedido deja constancia de lo que le encargó al proveedor. El inventario sube después, al registrar la
              compra.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <caption className="sr-only">Pedidos a proveedor, los más atrasados primero</caption>
              <thead>
                <tr className="border-b border-pf-border text-left text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
                  <th scope="col" className="px-4 py-2.5 font-semibold">N°</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Proveedor</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Pidió</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Entrega</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((o) => {
                  const delivery = deliveryLabel(o.expectedDate, o.status);
                  const names = (o.lines ?? []).map((l) => l.product?.name).filter(Boolean);
                  const content =
                    names.length === 0
                      ? "Sin productos"
                      : names.length > 2
                        ? `${names.slice(0, 2).join(", ")} y ${names.length - 2} más`
                        : names.join(", ");
                  return (
                    <tr key={o.id} className="border-b border-pf-border last:border-0 hover:bg-pf-surface">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-pf-text-tertiary">
                        {o.orderNumber ?? o.id.slice(0, 8)}
                        <span className="mt-0.5 block font-sans text-xs text-pf-muted">{formatDate(o.createdAt)}</span>
                      </td>
                      <td className="max-w-0 truncate px-4 py-3 font-medium text-pf-text">
                        {o.supplier?.name ?? "Sin proveedor"}
                      </td>
                      <td className="max-w-0 truncate px-4 py-3 text-pf-text-tertiary">{content}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 font-medium ${
                            delivery.tone === "danger"
                              ? "text-pf-danger"
                              : delivery.tone === "warning"
                                ? "text-pf-warning"
                                : "text-pf-text-tertiary"
                          }`}
                        >
                          {delivery.tone === "danger" ? (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                          ) : null}
                          {delivery.text}
                        </span>
                        {o.expectedDate && isOpen(o.status) ? (
                          <span className="mt-0.5 block text-xs text-pf-muted">{formatDateOnly(o.expectedDate)}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          className="min-h-10 text-xs"
                          aria-label={`Estado del pedido ${o.orderNumber ?? ""}`}
                          value={(o.status ?? "").toUpperCase()}
                          onChange={(e) => patchStatus(o.id, e.target.value)}
                        >
                          {STATUSES.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </Select>
                        <span className="sr-only">{statusLabel(o.status)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-bold text-pf-text">Nuevo pedido</h2>

        <div className="grid gap-3 sm:grid-cols-2">
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
          <Field label="¿Para cuándo lo espera?">
            <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Notas (opcional)">
          <Input value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} placeholder="Ej. entregar por la mañana" />
        </Field>

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
            aria-label="Buscar producto para agregar al pedido"
            className="!pl-9"
          />
        </div>

        {hits.length > 0 ? (
          <ul className="max-h-48 divide-y divide-pf-border overflow-y-auto rounded-[var(--radius-pf)] border border-pf-border">
            {hits.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center px-3 py-2 text-left text-sm font-medium text-pf-text transition-colors hover:bg-pf-surface focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
                  onClick={() => addProduct(p)}
                >
                  <span className="truncate">{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {lines.length > 0 ? (
          <div className="overflow-x-auto rounded-[var(--radius-pf)] border border-pf-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-pf-border text-left text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Producto</th>
                  <th scope="col" className="w-24 px-3 py-2 font-semibold">Cant.</th>
                  <th scope="col" className="w-28 px-3 py-2 font-semibold">Precio ref.</th>
                  <th scope="col" className="w-32 px-3 py-2 font-semibold">Nota</th>
                  <th scope="col" className="w-12 px-3 py-2">
                    <span className="sr-only">Quitar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.productId} className="border-b border-pf-border last:border-0">
                    <td className="px-3 py-2 font-medium text-pf-text">{l.product.name}</td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        step="any"
                        aria-label={`Cantidad de ${l.product.name}`}
                        className="min-h-10"
                        value={l.qty}
                        onChange={(e) => updateDraft(i, { qty: Math.max(0.0001, Number(e.target.value) || 0) })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        step="any"
                        aria-label={`Precio de referencia de ${l.product.name}`}
                        className="min-h-10"
                        value={l.unitPrice}
                        onChange={(e) => updateDraft(i, { unitPrice: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        aria-label={`Nota para ${l.product.name}`}
                        className="min-h-10"
                        value={l.notes}
                        onChange={(e) => updateDraft(i, { notes: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        aria-label={`Quitar ${l.product.name}`}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-pf-danger transition-colors hover:bg-pf-danger-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
                        onClick={() => removeDraft(i)}
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-pf-border px-3 py-2 text-xs text-pf-text-tertiary">
              Costo estimado:{" "}
              <span className="font-semibold tabular-nums text-pf-text">{formatMoney(sym, draftTotal)}</span>. Es
              referencial; el costo real se fija al registrar la compra.
            </p>
          </div>
        ) : null}

        {err ? (
          <p className="rounded-[var(--radius-pf)] border border-pf-danger-soft bg-pf-danger-soft px-3 py-2 text-sm font-medium text-pf-danger">
            {err}
          </p>
        ) : null}

        <Button type="button" className="min-h-11 sm:w-auto" onClick={submitOrder} disabled={busy || lines.length === 0}>
          <Send className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          {busy ? "Guardando…" : "Registrar pedido"}
        </Button>
      </Card>
    </div>
  );
}
