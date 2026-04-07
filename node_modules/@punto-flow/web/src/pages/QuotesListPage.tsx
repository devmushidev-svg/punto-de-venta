import { ArrowRightLeft, FilePlus, LayoutGrid, PackageSearch, Pencil } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHero } from "../components/PageHero";
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
  createdAt: string;
  customer: Customer | null;
  lines: QuoteLine[];
};

export function QuotesListPage({
  variant,
}: {
  variant: "preventas" | "full";
}) {
  const { token, organization } = useAuth();
  const navigate = useNavigate();
  const sym = organization?.currencySymbol ?? "L";
  const [list, setList] = useState<QuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState<string | null>(null);
  const [convertId, setConvertId] = useState<string | null>(null);
  const [convTerms, setConvTerms] = useState("CONTADO");
  const [convPaid, setConvPaid] = useState("");
  const [convCustomerId, setConvCustomerId] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [err, setErr] = useState("");

  const newPath = variant === "preventas" ? "/ventas/preventas/nueva" : "/cotizaciones/nueva";
  const editPath = (id: string) =>
    variant === "preventas" ? `/ventas/preventas/${id}/editar` : `/cotizaciones/${id}/editar`;

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
    const q = list.find((x) => x.id === id);
    setConvertId(id);
    setConvTerms("CONTADO");
    setConvPaid("");
    setConvCustomerId(q?.customer?.id ?? "");
    setErr("");
  }

  async function confirmConvert() {
    if (!token || !convertId) return;
    setErr("");
    const quoteRow = list.find((x) => x.id === convertId);
    const resolvedCust = convCustomerId.trim() || quoteRow?.customer?.id || "";
    if (isCreditSaleTerm(convTerms) && !resolvedCust) {
      setErr("Las ventas a crédito requieren un cliente. Asígnelo en la cotización o elija uno aquí.");
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

  return (
    <div className="space-y-4 pf-safe-page">
      {variant === "full" ? <VentasSectionNav /> : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHero
          title={variant === "preventas" ? "PreVentas" : "Cotizaciones"}
          constrained
          className="sm:!max-w-xl"
        >
          <p className="pf-page-lead">
            {variant === "preventas"
              ? "Cotizaciones sin afectar stock; convierta al cobrar."
              : "Listado de cotizaciones; convertir a venta o gestionar desde aquí."}
          </p>
        </PageHero>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {variant === "preventas" ? (
            <Link to="/venta/tactil" className="w-full sm:w-auto">
              <Button variant="secondary" type="button" className="w-full min-h-[48px] sm:w-auto">
                <LayoutGrid className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                Venta táctil
              </Button>
            </Link>
          ) : (
            <Link to="/pedidos-proveedor" className="w-full sm:w-auto">
              <Button variant="secondary" type="button" className="w-full min-h-[48px] sm:w-auto">
                <PackageSearch className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                Pedidos proveedor
              </Button>
            </Link>
          )}
          <Link to={newPath} className="w-full sm:w-auto">
            <Button type="button" className="w-full min-h-[48px] shadow-lg sm:w-auto">
              <FilePlus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              Nueva cotización
            </Button>
          </Link>
        </div>
      </div>

      {err ? <p className="text-sm text-red-600">{err}</p> : null}

      <Card className="overflow-x-auto border-white/50 shadow-lg shadow-stone-900/[0.04]">
        {loading ? (
          <p className="p-4 text-center font-medium text-pf-muted">Cargando…</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-stone-200/80 bg-gradient-to-r from-violet-100/60 via-pf-primary-soft/40 to-teal-50/50 text-left backdrop-blur-sm">
                <th className="p-2">N°</th>
                <th className="p-2">Fecha</th>
                <th className="p-2">Cliente</th>
                <th className="p-2">Estado</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2">Líneas</th>
                <th className="p-2 w-40" />
              </tr>
            </thead>
            <tbody>
              {list.map((q) => (
                <tr
                  key={q.id}
                  className="border-b border-stone-100/90 transition hover:bg-gradient-to-r hover:from-violet-50/40 hover:to-transparent"
                >
                  <td className="p-2 font-mono text-xs">{q.quoteNumber ?? q.id.slice(0, 8)}</td>
                  <td className="p-2 whitespace-nowrap">{formatDate(q.createdAt)}</td>
                  <td className="p-2 truncate max-w-[140px]">{q.customer?.name ?? "—"}</td>
                  <td className="p-2">{q.status}</td>
                  <td className="p-2 text-right font-medium">{formatMoney(sym, q.total)}</td>
                  <td className="p-2 text-pf-muted">{q.lines?.length ?? 0}</td>
                  <td className="p-2">
                    {q.status !== "CONVERTIDA" ? (
                      <div className="flex flex-wrap gap-1.5">
                        <Link to={editPath(q.id)}>
                          <Button type="button" variant="ghost" className="min-h-9 py-1 text-xs">
                            <Pencil className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                            Editar
                          </Button>
                        </Link>
                        <Button
                          type="button"
                          variant="secondary"
                          className="min-h-9 py-1 text-xs"
                          disabled={converting === q.id}
                          onClick={() => openConvert(q.id)}
                        >
                          <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                          {converting === q.id ? "…" : "Convertir"}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-pf-muted">Convertida</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && list.length === 0 ? (
          <p className="p-4 text-center text-pf-muted">Sin cotizaciones</p>
        ) : null}
      </Card>

      <Modal
        open={convertId != null}
        title="Convertir a venta"
        onClose={() => {
          if (!converting) setConvertId(null);
        }}
      >
        <div className="space-y-3">
          <Field label="Términos de pago">
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
              <Field label="Cliente (obligatorio para crédito)">
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
                <Input type="number" step="any" value={convPaid} onChange={(e) => setConvPaid(e.target.value)} />
              </Field>
            </>
          ) : null}
          <div className="flex flex-wrap gap-2 justify-end pt-2">
            <Button type="button" variant="secondary" disabled={converting != null} onClick={() => setConvertId(null)}>
              Cancelar
            </Button>
            <Button type="button" disabled={converting != null} onClick={() => void confirmConvert()}>
              <ArrowRightLeft className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {converting ? "Convirtiendo…" : "Confirmar"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
