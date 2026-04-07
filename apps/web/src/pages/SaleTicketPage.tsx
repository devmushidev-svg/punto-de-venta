import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card } from "../components/ui";
import { formatDate, formatMoney } from "../lib/format";
import type { Sale } from "../types";

type TicketCfg = {
  headerLine?: string;
  footerLine?: string;
  showTaxBreakdown?: boolean;
};

export function SaleTicketPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { token, organization } = useAuth();
  const sym = organization?.currencySymbol ?? "L";
  const [sale, setSale] = useState<Sale | null>(null);
  const [ticket, setTicket] = useState<TicketCfg>({});

  useEffect(() => {
    if (!token || !id) return;
    apiFetch<Sale>(`/api/sales/${id}`, { token }).then(setSale).catch(() => setSale(null));
  }, [token, id]);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ invoice: { ticket?: TicketCfg } }>("/api/settings", { token })
      .then((s) => setTicket(s.invoice?.ticket ?? {}))
      .catch(() => setTicket({}));
  }, [token]);

  useEffect(() => {
    if (!sale) return;
    const params = new URLSearchParams(location.search);
    if (params.get("print") !== "1") return;

    let cancelled = false;
    const outer = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (cancelled) return;
        window.print();
        params.delete("print");
        const qs = params.toString();
        const path = qs ? `${location.pathname}?${qs}` : location.pathname;
        window.history.replaceState(null, "", path);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
    };
  }, [sale, location.pathname, location.search]);

  function printTicket() {
    window.print();
  }

  if (!sale) {
    return (
      <div className="space-y-4 pf-safe-page">
        <p className="rounded-2xl border border-white/50 bg-white/70 px-4 py-6 text-center font-medium text-pf-muted backdrop-blur-sm">
          Cargando ticket…
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

  return (
    <div className="mx-auto max-w-md space-y-4 pf-safe-page print:max-w-none print:pb-0">
      <div className="flex flex-col gap-2 print:hidden sm:flex-row sm:flex-wrap">
        <Button type="button" className="min-h-[48px] w-full shadow-md sm:min-h-11 sm:w-auto" onClick={printTicket}>
          Imprimir
        </Button>
        <Link to={`/ventas/${sale.id}/comprobante`} className="block w-full sm:w-auto">
          <Button variant="secondary" type="button" className="min-h-[48px] w-full sm:min-h-11 sm:w-auto">
            Comprobante (carta)
          </Button>
        </Link>
        <Link to="/ventas" className="block w-full sm:w-auto">
          <Button variant="secondary" type="button" className="min-h-[48px] w-full sm:min-h-11 sm:w-auto">
            Lista de ventas
          </Button>
        </Link>
        <Link to="/venta" className="block w-full sm:w-auto">
          <Button variant="ghost" type="button" className="min-h-[48px] w-full sm:min-h-11 sm:w-auto">
            Nueva venta
          </Button>
        </Link>
      </div>

      <Card className="border-white/50 bg-white/95 p-6 shadow-lg backdrop-blur-sm print:border-0 print:bg-white print:shadow-none" id="ticket">
        <div className="text-center border-b border-pf-border pb-4 mb-4">
          <h1 className="text-xl font-bold text-stone-900">{organization?.name ?? "MultiPOS"}</h1>
          {ticket.headerLine ? (
            <p className="text-sm text-stone-700 mt-1 whitespace-pre-line">{ticket.headerLine}</p>
          ) : (
            <p className="text-sm text-pf-muted mt-1">Ticket de venta</p>
          )}
          <p className="text-sm font-mono mt-2">No. {sale.invoiceNumber ?? sale.id.slice(0, 8)}</p>
          <p className="text-xs text-pf-muted">{formatDate(sale.saleDate)}</p>
        </div>
        {sale.customer ? (
          <p className="text-sm mb-3">
            <span className="text-pf-muted">Cliente: </span>
            {sale.customer.name}
          </p>
        ) : null}
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="text-left text-pf-muted border-b border-pf-border">
              <th className="py-1 pr-2">Cant</th>
              <th className="py-1">Descripción</th>
              <th className="py-1 text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((l) => (
              <tr key={l.id} className="border-b border-pf-border/60">
                <td className="py-2 pr-2 whitespace-nowrap">{l.qty}</td>
                <td className="py-2">{l.product.name}</td>
                <td className="py-2 text-right whitespace-nowrap">{formatMoney(sym, l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-1 text-sm border-t border-pf-border pt-3">
          {ticket.showTaxBreakdown !== false ? (
            <>
              <div className="flex justify-between">
                <span className="text-pf-muted">Subtotal</span>
                <span>{formatMoney(sym, sale.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-pf-muted">Impuesto</span>
                <span>{formatMoney(sym, sale.tax)}</span>
              </div>
            </>
          ) : null}
          <div className="flex justify-between text-lg font-bold pt-2">
            <span>Total</span>
            <span>{formatMoney(sym, sale.total)}</span>
          </div>
          <div className="flex justify-between text-pf-muted">
            <span>Pagado</span>
            <span>{formatMoney(sym, sale.paid)}</span>
          </div>
          {sale.terms === "CREDITO" ? (
            <div className="flex justify-between font-medium">
              <span>Saldo</span>
              <span>{formatMoney(sym, sale.total - sale.paid)}</span>
            </div>
          ) : null}
        </div>
        <p className="text-center text-xs text-pf-muted mt-6 whitespace-pre-line">
          {ticket.footerLine ?? "Gracias por su compra"}
        </p>
      </Card>
    </div>
  );
}
