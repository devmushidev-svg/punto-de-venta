import { ArrowRightLeft, FilePlus, LayoutGrid, PackageSearch, Pencil, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { VentasSectionNav } from "../layouts/SalesHubLayout";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Modal, Select } from "../components/ui";
import { formatDate, formatMoney } from "../lib/format";
import { isCreditSaleTerm, SALE_TERMS_OPTIONS } from "../lib/saleTerms";
import type { Customer, Product } from "../types";

type QuoteLine = {
  id: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  product: Product;
};

export type QuoteRow = {
  id: string;
  quoteNumber: string | null;
  status: string;
  subtotal: number;
  tax: number;
  total: number;
  notes: string | null;
  serviceLabel?: string | null;
  createdAt: string;
  customer: Customer | null;
  lines: QuoteLine[];
};

const DAY_MS = 86_400_000;

function ageLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / DAY_MS);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
}

/** Que contiene la cotizacion, en palabras. Un conteo de lineas no dice nada. */
function contentSummary(lines: QuoteLine[]): string {
  if (!lines?.length) return "Sin productos";
  const names = lines.map((l) => l.product?.name).filter(Boolean) as string[];
  const shown = names.slice(0, 2).join(", ");
  const rest = names.length - 2;
  return rest > 0 ? `${shown} y ${rest} más` : shown;
}

function statusLabel(status: string): { text: string; tone: "done" | "open" | "neutral" } {
  const s = (status ?? "").toUpperCase();
  if (s === "CONVERTIDA") return { text: "Convertida en venta", tone: "done" };
  if (s === "BORRADOR" || s === "ABIERTA" || s === "PENDIENTE") return { text: "Pendiente", tone: "open" };
  if (s === "ANULADA" || s === "CANCELADA") return { text: "Anulada", tone: "neutral" };
  return { text: status || "—", tone: "neutral" };
}

export function QuotesListPage({ variant }: { variant: "preventas" | "full" }) {
  const { token, organization } = useAuth();
  const navigate = useNavigate();
  const sym = organization?.currencySymbol ?? "L";
  const isPreventas = variant === "preventas";
  const noun = isPreventas ? "PreVenta" : "cotización";

  const [list, setList] = useState<QuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState<string | null>(null);
  const [convertId, setConvertId] = useState<string | null>(null);
  const [convTerms, setConvTerms] = useState("CONTADO");
  const [convPaid, setConvPaid] = useState("");
  const [convCustomerId, setConvCustomerId] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  const newPath = isPreventas ? "/ventas/preventas/nueva" : "/cotizaciones/nueva";
  const editPath = (id: string) => (isPreventas ? `/ventas/preventas/${id}/editar` : `/cotizaciones/${id}/editar`);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<QuoteRow[]>("/api/quotes", { token });
      setList(data);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!token) return;
    apiFetch<Customer[]>("/api/customers", { token }).then(setCustomers).catch(() => setCustomers([]));
  }, [token]);

  function openConvert(id: string) {
    const row = list.find((x) => x.id === id);
    setConvertId(id);
    setConvTerms("CONTADO");
    setConvPaid("");
    setConvCustomerId(row?.customer?.id ?? "");
    setErr("");
  }

  async function confirmConvert() {
    if (!token || !convertId) return;
    setErr("");
    const quoteRow = list.find((x) => x.id === convertId);
    const resolvedCust = convCustomerId.trim() || quoteRow?.customer?.id || "";
    if (isCreditSaleTerm(convTerms) && !resolvedCust) {
      setErr("Las ventas a crédito requieren un cliente. Asígnelo aquí antes de convertir.");
      return;
    }
    setConverting(convertId);
    try {
      const body: { terms: string; paid?: number; customerId?: string } = { terms: convTerms };
      if (isCreditSaleTerm(convTerms)) {
        body.paid = Number(convPaid) || 0;
        body.customerId = resolvedCust;
      }
      const sale = await apiFetch<{ id: string }>(`/api/quotes/${convertId}/convert-to-sale`, {
        method: "POST",
        body: JSON.stringify(body),
        token,
      });
      setConvertId(null);
      navigate(`/ventas/${sale.id}/ticket`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo convertir");
    } finally {
      setConverting(null);
    }
  }

  /** Busca por cliente, numero y referencia; antes solo filtraba por mesa. */
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter(
      (x) =>
        (x.customer?.name ?? "").toLowerCase().includes(t) ||
        (x.quoteNumber ?? "").toLowerCase().includes(t) ||
        (x.serviceLabel ?? "").toLowerCase().includes(t) ||
        x.lines?.some((l) => (l.product?.name ?? "").toLowerCase().includes(t)),
    );
  }, [list, q]);

  const pending = useMemo(() => list.filter((x) => statusLabel(x.status).tone === "open"), [list]);
  const pendingValue = useMemo(() => pending.reduce((sum, x) => sum + x.total, 0), [pending]);

  const convertRow = convertId ? list.find((x) => x.id === convertId) ?? null : null;

  return (
    <div className="mx-auto max-w-[72rem] space-y-4 pf-safe-page">
      {variant === "full" ? <VentasSectionNav /> : null}

      {/* Lo pendiente es lo unico accionable: cuantas esperan y cuanto valen. */}
      <section className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-pf-border pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Pendientes de convertir</p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-pf-text">
            {formatMoney(sym, pendingValue)}
          </p>
          <p className="mt-0.5 text-xs text-pf-text-tertiary">
            {pending.length === 0
              ? `Ninguna ${noun} esperando`
              : `${pending.length} ${pending.length === 1 ? noun : isPreventas ? "PreVentas" : "cotizaciones"} sin cobrar`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={isPreventas ? "/venta/tactil" : "/pedidos-proveedor"}>
            <Button variant="secondary" type="button" className="min-h-10">
              {isPreventas ? (
                <LayoutGrid className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              ) : (
                <PackageSearch className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              )}
              {isPreventas ? "Venta táctil" : "Pedidos a proveedor"}
            </Button>
          </Link>
          <Link to={newPath}>
            <Button type="button" className="min-h-10">
              <FilePlus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              Nueva {noun}
            </Button>
          </Link>
        </div>
      </section>

      {err && convertId == null ? (
        <p className="rounded-[var(--radius-pf)] border border-pf-danger-soft bg-pf-danger-soft px-3 py-2 text-sm font-medium text-pf-danger">
          {err}
        </p>
      ) : null}

      <Card className="p-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pf-muted"
            strokeWidth={2}
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por cliente, número, producto o referencia…"
            aria-label={`Buscar ${noun}`}
            className="!pl-9"
          />
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <p className="p-8 text-center text-sm text-pf-muted">Cargando…</p>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium text-pf-text">
              {list.length === 0 ? `Todavía no hay ${isPreventas ? "PreVentas" : "cotizaciones"}` : "Ninguna coincide"}
            </p>
            <p className="mt-1 text-sm text-pf-text-tertiary">
              {list.length === 0
                ? `Cree una ${noun} para guardar un presupuesto sin afectar el inventario.`
                : "Pruebe con otro cliente, número o producto."}
            </p>
            {list.length === 0 ? (
              <Link to={newPath} className="mt-4 inline-block">
                <Button type="button">
                  <FilePlus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                  Nueva {noun}
                </Button>
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <caption className="sr-only">Listado de {isPreventas ? "PreVentas" : "cotizaciones"}</caption>
              <thead>
                <tr className="border-b border-pf-border text-left text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
                  <th scope="col" className="px-4 py-2.5 font-semibold">N°</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Cliente</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Contiene</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Creada</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Total</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const st = statusLabel(row.status);
                  const ref = row.serviceLabel?.trim();
                  return (
                    <tr key={row.id} className="border-b border-pf-border last:border-0 hover:bg-pf-surface">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-pf-text-tertiary">
                        {row.quoteNumber ?? row.id.slice(0, 8)}
                      </td>
                      <td className="max-w-0 px-4 py-3">
                        <span className="block truncate font-medium text-pf-text">
                          {row.customer?.name ?? "Sin cliente"}
                        </span>
                        {ref ? <span className="block truncate text-xs text-pf-text-tertiary">{ref}</span> : null}
                      </td>
                      <td className="max-w-0 truncate px-4 py-3 text-pf-text-tertiary">{contentSummary(row.lines)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="block text-pf-text-secondary">{ageLabel(row.createdAt)}</span>
                        <span className="block text-xs text-pf-muted">{formatDate(row.createdAt)}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-pf-text">
                        {formatMoney(sym, row.total)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {st.tone === "done" ? (
                          <span className="text-xs font-semibold text-pf-success">{st.text}</span>
                        ) : st.tone === "neutral" ? (
                          <span className="text-xs font-medium text-pf-muted">{st.text}</span>
                        ) : (
                          <div className="flex justify-end gap-1.5">
                            <Link to={editPath(row.id)}>
                              <Button type="button" variant="ghost" className="min-h-9">
                                <Pencil className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                                Editar
                              </Button>
                            </Link>
                            <Button
                              type="button"
                              variant="secondary"
                              className="min-h-9"
                              disabled={converting === row.id}
                              onClick={() => openConvert(row.id)}
                            >
                              <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                              {converting === row.id ? "…" : "Cobrar"}
                            </Button>
                          </div>
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

      <Modal
        open={convertId != null}
        title="Convertir en venta"
        onClose={() => {
          if (!converting) setConvertId(null);
        }}
        maxWidthClass="sm:max-w-md"
      >
        <div className="space-y-4">
          {convertRow ? (
            <div className="rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface p-3 text-sm">
              <p className="font-medium text-pf-text">{convertRow.customer?.name ?? "Sin cliente"}</p>
              <p className="mt-0.5 text-xs text-pf-text-tertiary">{contentSummary(convertRow.lines)}</p>
              <div className="mt-2 flex items-baseline justify-between border-t border-pf-border pt-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Total</span>
                <span className="text-xl font-bold tabular-nums text-pf-text">
                  {formatMoney(sym, convertRow.total)}
                </span>
              </div>
            </div>
          ) : null}

          <p className="text-xs text-pf-text-tertiary">
            Al convertir se genera la factura y se descuenta el inventario.
          </p>

          <Field label="¿Cómo paga?">
            <Select value={convTerms} onChange={(e) => setConvTerms(e.target.value)}>
              {SALE_TERMS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          {isCreditSaleTerm(convTerms) ? (
            <>
              <Field label="Cliente (obligatorio a crédito)">
                <Select value={convCustomerId} onChange={(e) => setConvCustomerId(e.target.value)}>
                  <option value="">Seleccione cliente…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Abono inicial (opcional)">
                <Input type="number" step="any" min={0} value={convPaid} onChange={(e) => setConvPaid(e.target.value)} />
              </Field>
            </>
          ) : null}

          {err ? (
            <p className="rounded-[var(--radius-pf)] border border-pf-danger-soft bg-pf-danger-soft px-3 py-2 text-sm font-medium text-pf-danger">
              {err}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" disabled={converting != null} onClick={() => setConvertId(null)}>
              Cancelar
            </Button>
            <Button type="button" disabled={converting != null} onClick={() => void confirmConvert()}>
              <ArrowRightLeft className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {converting ? "Convirtiendo…" : "Generar venta"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
