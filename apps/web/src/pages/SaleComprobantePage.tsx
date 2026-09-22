import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiDownload, apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card } from "../components/ui";
import { formatDate, formatMoney } from "../lib/format";
import type { OrganizationFull } from "./CompanyInfoPage";
import type { Sale } from "../types";

type TicketCfg = {
  headerLine?: string;
  footerLine?: string;
  showTaxBreakdown?: boolean;
};

type ComprobanteCfg = {
  title?: string;
  showSku?: boolean;
};

function parseComprobante(inv: Record<string, unknown> | undefined): ComprobanteCfg {
  const c = inv?.comprobante;
  if (!c || typeof c !== "object") return {};
  const o = c as Record<string, unknown>;
  return {
    title: typeof o.title === "string" ? o.title : undefined,
    showSku: typeof o.showSku === "boolean" ? o.showSku : undefined,
  };
}

export function SaleComprobantePage() {
  const { id } = useParams<{ id: string }>();
  const { token, organization } = useAuth();
  const sym = organization?.currencySymbol ?? "L";
  const [sale, setSale] = useState<Sale | null>(null);
  const [org, setOrg] = useState<OrganizationFull | null>(null);
  const [ticket, setTicket] = useState<TicketCfg>({});
  const [comp, setComp] = useState<ComprobanteCfg>({});
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    if (!token || !id) return;
    apiFetch<Sale>(`/api/sales/${id}`, { token }).then(setSale).catch(() => setSale(null));
  }, [token, id]);

  useEffect(() => {
    if (!token) return;
    apiFetch<OrganizationFull>("/api/organizations/current", { token })
      .then(setOrg)
      .catch(() => setOrg(null));
    apiFetch<{ invoice: Record<string, unknown> }>("/api/settings", { token })
      .then((s) => {
        const inv = s.invoice ?? {};
        setTicket((inv.ticket as TicketCfg) ?? {});
        setComp(parseComprobante(inv));
      })
      .catch(() => {
        setTicket({});
        setComp({});
      });
  }, [token]);

  function printDoc() {
    window.print();
  }

  async function downloadServerPdf() {
    if (!token || !id) return;
    setPdfBusy(true);
    try {
      const blob = await apiDownload(`/api/sales/${id}/comprobante.pdf`, token);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const num = sale?.invoiceNumber?.replace(/[^\w.\-]+/g, "_") ?? id.slice(0, 8);
      a.download = `comprobante-${num}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      /* apiDownload ya dispara PERM_STALE si aplica */
    } finally {
      setPdfBusy(false);
    }
  }

  const title = comp.title?.trim() || "Comprobante de venta";
  const showSku = comp.showSku !== false;
  const showTax = ticket.showTaxBreakdown !== false;

  if (!sale) {
    return (
      <div className="space-y-4 pf-safe-page">
        <p className="rounded-2xl border border-white/50 bg-white/70 px-4 py-6 text-center font-medium text-pf-muted backdrop-blur-sm">
          Cargando comprobante…
        </p>
        <Link
          to="/ventas"
          className="inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-orange-200/50 bg-gradient-to-r from-pf-primary-soft/90 to-amber-50/80 text-sm font-bold text-pf-primary-foreground shadow-md sm:w-auto sm:px-4 touch-manipulation"
        >
          Volver
        </Link>
      </div>
    );
  }

  const o = org;
  const addrLine = [o?.address, o?.city, o?.department, o?.zip].filter(Boolean).join(", ");
  const balance = sale.total - sale.paid;

  return (
    <div className="mx-auto max-w-3xl space-y-4 pf-safe-page print:max-w-none print:pb-0">
      <div className="space-y-3 print:hidden">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" className="min-h-[48px] w-full shadow-md sm:min-h-11 sm:w-auto" onClick={printDoc}>
            <Printer className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Imprimir / PDF (navegador)
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-[48px] w-full sm:min-h-11 sm:w-auto"
            onClick={() => void downloadServerPdf()}
            disabled={pdfBusy || !sale}
          >
            {pdfBusy ? "Generando…" : "Descargar PDF (servidor)"}
          </Button>
          <Link to={`/ventas/${sale.id}/ticket`} className="block w-full sm:w-auto">
            <Button variant="secondary" type="button" className="min-h-[48px] w-full sm:min-h-11 sm:w-auto">
              Ticket térmico
            </Button>
          </Link>
          <Link to="/ventas" className="block w-full sm:w-auto">
            <Button variant="secondary" type="button" className="min-h-[48px] w-full sm:min-h-11 sm:w-auto">
              Lista de ventas
            </Button>
          </Link>
        </div>
        <Card className="border-sky-200/60 bg-gradient-to-br from-sky-50/90 to-white/90 p-4 text-sm text-stone-800 shadow-md backdrop-blur-sm">
          <p className="font-medium text-stone-900">Impresión y PDF</p>
          <p className="mt-1 text-pf-muted text-stone-700">
            <strong className="font-semibold text-stone-900">Descargar PDF (servidor)</strong> genera el archivo en la API
            (misma información que esta vista; respeta título/SKU del comprobante en configuración).{" "}
            <strong className="font-semibold text-stone-900">Imprimir / PDF (navegador)</strong> abre el diálogo del
            sistema; elija <strong className="font-semibold text-stone-900">Guardar como PDF</strong> si prefiere desde el
            navegador. Térmica 80&nbsp;mm:{" "}
            <Link to={`/ventas/${sale.id}/ticket`} className="font-medium text-sky-900 underline-offset-2 hover:underline">
              Ticket térmico
            </Link>
            .
          </p>
        </Card>
      </div>

      <article
        id="pf-comprobante-print"
        className="pf-print-root-comprobante rounded-xl border border-stone-200 bg-white p-6 shadow-sm print:rounded-none print:border-0 print:shadow-none md:p-8"
      >
        <header className="flex flex-col gap-4 border-b border-stone-200 pb-6 sm:flex-row sm:justify-between sm:items-start">
          <div className="min-w-0 space-y-2">
            {o?.logoUrl ? (
              <img src={o.logoUrl} alt="" className="h-14 w-auto max-w-[200px] object-contain" />
            ) : null}
            <h1 className="text-xl font-bold tracking-tight text-stone-900">{o?.name ?? organization?.name ?? "Empresa"}</h1>
            {o?.slogan ? <p className="text-sm text-stone-600">{o.slogan}</p> : null}
            {ticket.headerLine ? (
              <p className="text-sm text-stone-700 whitespace-pre-line">{ticket.headerLine}</p>
            ) : null}
            {addrLine ? <p className="text-sm text-stone-700">{addrLine}</p> : null}
            <div className="text-sm text-stone-600 space-y-0.5">
              {o?.taxId ? (
                <p>
                  <span className="text-pf-muted">{o.taxIdType ?? "RTN"}</span> {o.taxId}
                </p>
              ) : null}
              {o?.phone ? <p>Tel. {o.phone}</p> : null}
              {o?.email ? <p className="break-all">{o.email}</p> : null}
            </div>
          </div>
          <div className="shrink-0 text-left sm:text-right space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-pf-muted">{title}</p>
            <p className="text-lg font-mono font-semibold text-stone-900">No. {sale.invoiceNumber ?? sale.id.slice(0, 8)}</p>
            <p className="text-sm text-stone-600">{formatDate(sale.saleDate)}</p>
            {sale.terms ? (
              <p className="text-sm">
                <span className="text-pf-muted">Términos: </span>
                {sale.terms}
              </p>
            ) : null}
            {sale.dueDate ? (
              <p className="text-sm">
                <span className="text-pf-muted">Vence: </span>
                {formatDate(sale.dueDate)}
              </p>
            ) : null}
          </div>
        </header>

        <section className="py-5 space-y-1 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-pf-muted">Cliente</h2>
          {sale.customer ? (
            <div className="text-stone-800">
              <p className="font-medium text-stone-900">{sale.customer.name}</p>
              {sale.customer.taxId ? (
                <p className="text-pf-muted">ID fiscal: {sale.customer.taxId}</p>
              ) : null}
              {[sale.customer.address, sale.customer.phone].filter(Boolean).length > 0 ? (
                <p>{[sale.customer.address, sale.customer.phone].filter(Boolean).join(" · ")}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-pf-muted">Consumidor final / sin cliente registrado</p>
          )}
        </section>

        <div className="overflow-x-auto border border-stone-200 rounded-lg print:border-stone-300">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200 text-left text-xs font-medium uppercase tracking-wide text-pf-muted">
                {showSku ? <th className="p-2 w-24">Código</th> : null}
                <th className="p-2">Descripción</th>
                <th className="p-2 text-right w-20">Cant.</th>
                <th className="p-2 text-right whitespace-nowrap">P. unit.</th>
                <th className="p-2 text-right w-14">%Desc.</th>
                <th className="p-2 text-right w-14">ISV</th>
                <th className="p-2 text-right whitespace-nowrap">Total</th>
              </tr>
            </thead>
            <tbody>
              {sale.lines.map((l) => (
                <tr key={l.id} className="border-b border-stone-100">
                  {showSku ? (
                    <td className="p-2 font-mono text-xs text-stone-700 align-top">{l.product.sku}</td>
                  ) : null}
                  <td className="p-2 text-stone-900 align-top">{l.product.name}</td>
                  <td className="p-2 text-right tabular-nums align-top">{l.qty}</td>
                  <td className="p-2 text-right tabular-nums whitespace-nowrap align-top">
                    {formatMoney(sym, l.unitPrice)}
                  </td>
                  <td className="p-2 text-right tabular-nums align-top">{l.discountPercent > 0 ? l.discountPercent : "—"}</td>
                  <td className="p-2 text-right tabular-nums align-top">{l.taxPercent > 0 ? `${l.taxPercent}%` : "—"}</td>
                  <td className="p-2 text-right font-medium tabular-nums whitespace-nowrap align-top">
                    {formatMoney(sym, l.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="mt-6 flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
          <div className="text-sm text-stone-600 space-y-1">
            {sale.user ? (
              <p>
                <span className="text-pf-muted">Vendedor: </span>
                {sale.user.displayName}
              </p>
            ) : null}
            {sale.notes ? (
              <p>
                <span className="text-pf-muted">Notas: </span>
                {sale.notes}
              </p>
            ) : null}
          </div>
          <div className="w-full max-w-xs space-y-1.5 text-sm border-t border-stone-200 pt-4 sm:border-0 sm:pt-0">
            {showTax ? (
              <>
                <div className="flex justify-between">
                  <span className="text-pf-muted">Subtotal</span>
                  <span className="tabular-nums">{formatMoney(sym, sale.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-pf-muted">Impuesto</span>
                  <span className="tabular-nums">{formatMoney(sym, sale.tax)}</span>
                </div>
              </>
            ) : null}
            <div className="flex justify-between text-base font-bold text-stone-900 pt-1">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(sym, sale.total)}</span>
            </div>
            <div className="flex justify-between text-pf-muted">
              <span>Pagado</span>
              <span className="tabular-nums">{formatMoney(sym, sale.paid)}</span>
            </div>
            {balance > 0.009 ? (
              <div className="flex justify-between font-semibold text-amber-900">
                <span>Saldo</span>
                <span className="tabular-nums">{formatMoney(sym, balance)}</span>
              </div>
            ) : null}
          </div>
        </footer>

        <p className="text-center text-xs text-pf-muted mt-8 pt-6 border-t border-stone-100 whitespace-pre-line">
          {ticket.footerLine ?? "Documento generado electrónicamente — válido como comprobante de operación."}
        </p>
      </article>
    </div>
  );
}
