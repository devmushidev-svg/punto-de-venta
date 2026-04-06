import { FilterX, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Input, Select } from "../components/ui";
import { formatDateOnly, formatMoney, formatTimeOnly } from "../lib/format";
import { isCreditSaleTerm } from "../lib/saleTerms";
import type { Customer, Sale } from "../types";

function saleStatus(s: Sale): string {
  const balance = s.total - s.paid;
  if (balance > 0.009) {
    return isCreditSaleTerm(s.terms) ? "CRÉDITO" : "PENDIENTE";
  }
  return "PAGADA";
}

export function SalesPage() {
  const { token, organization, user } = useAuth();
  const canEditSales = user?.role === "admin";
  const sym = organization?.currencySymbol ?? "L";
  const navigate = useNavigate();
  const [list, setList] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [termsFilter, setTermsFilter] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchQ), 400);
    return () => clearTimeout(t);
  }, [searchQ]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
      if (customerId) params.set("customerId", customerId);
      if (termsFilter === "__credit__") params.set("termsGroup", "credit");
      else if (termsFilter === "__immediate__") params.set("termsGroup", "cash");
      else if (termsFilter) params.set("terms", termsFilter);
      const qs = params.toString();
      const data = await apiFetch<Sale[]>(`/api/sales${qs ? `?${qs}` : ""}`, { token });
      setList(data);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [token, dateFrom, dateTo, debouncedQ, customerId, termsFilter]);

  useEffect(() => {
    if (!token) return;
    apiFetch<Customer[]>("/api/customers", { token }).then(setCustomers).catch(() => setCustomers([]));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setSearchQ("");
    setDebouncedQ("");
    setCustomerId("");
    setTermsFilter("");
  }

  function openSaleEditor(id: string) {
    if (!canEditSales) return;
    navigate(`/ventas/${id}/editar`);
  }

  return (
    <div className="flex min-h-0 flex-col space-y-3 sm:space-y-4">
      <PageHero title={"Ventas"}>
        <p className="pf-page-lead max-w-2xl">
          Qué es: historial de ventas ya registradas (documento, cliente, totales y enlaces a ticket o comprobante
          carta).
        </p>
        <p className="pf-page-lead-muted max-w-2xl">
          Filtre por rango de fechas, cliente, condición de pago o busque por nombre de cliente o número de factura.
        </p>
      </PageHero>

      <Card className="space-y-3 p-3 sm:p-3.5">
        <div className="flex flex-wrap items-end gap-2 sm:gap-3">
          <label className="text-xs font-medium text-pf-muted shrink-0">
            Desde
            <Input
              type="date"
              className="mt-1 min-h-10"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="text-xs font-medium text-pf-muted shrink-0">
            Hasta
            <Input
              type="date"
              className="mt-1 min-h-10"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <label className="text-xs font-medium text-pf-muted shrink-0 min-w-[160px]">
            Cliente
            <Select className="mt-1 min-h-10" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Todos</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs font-medium text-pf-muted shrink-0 min-w-[130px]">
            Términos
            <Select
              className="mt-1 min-h-10"
              value={termsFilter}
              onChange={(e) => setTermsFilter(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="__immediate__">Contado / tarjeta / efectivo</option>
              <option value="__credit__">Todos los créditos</option>
              <option value="CONTADO">Solo contado</option>
              <option value="TARJETA">Solo tarjeta</option>
              <option value="EFECTIVO">Solo efectivo</option>
              <option value="CREDITO">Crédito</option>
              <option value="15 DIAS">15 días</option>
              <option value="30 DIAS">30 días</option>
              <option value="45 DIAS">45 días</option>
              <option value="60 DIAS">60 días</option>
            </Select>
          </label>
          <div className="min-w-[200px] flex-1">
            <span className="text-xs font-medium text-pf-muted block mb-1">Buscar (cliente o N° factura)</span>
            <Input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Nombre o código…"
            />
          </div>
          <Button type="button" variant="secondary" className="min-h-[48px] md:min-h-10" onClick={clearFilters}>
            <FilterX className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Limpiar
          </Button>
          <Button type="button" variant="secondary" className="min-h-[48px] md:min-h-10" onClick={load}>
            <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Actualizar
          </Button>
        </div>
      </Card>

      <Card className="pf-table-shell min-h-0 flex-1 overflow-hidden p-0">
        {loading ? (
          <p className="p-4 text-center font-medium text-pf-muted">Cargando…</p>
        ) : (
          <div className="max-h-[min(520px,calc(100vh-15rem))] overflow-auto overscroll-contain rounded-2xl md:rounded-none">
            <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead className="sticky top-0 z-[1]">
              <tr className="pf-table-thead text-left">
                <th className="p-2">Fecha</th>
                <th className="p-2">N° doc.</th>
                <th className="p-2">Cliente</th>
                <th className="p-2">Usuario</th>
                <th className="p-2">Términos</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-right">Pago</th>
                <th className="p-2 text-right">Saldo</th>
                <th className="p-2">Hora</th>
                <th className="p-2">Estado</th>
                <th className="p-2 min-w-[210px]" />
              </tr>
            </thead>
            <tbody className="pf-table-body">
              {list.map((s) => {
                const balance = s.total - s.paid;
                return (
                  <tr
                    key={s.id}
                    className={`pf-table-row pf-table-row-hoverable ${
                      canEditSales ? "cursor-pointer" : ""
                    }`}
                    onClick={() => openSaleEditor(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openSaleEditor(s.id);
                      }
                    }}
                    tabIndex={canEditSales ? 0 : -1}
                  >
                    <td className="p-2 whitespace-nowrap">{formatDateOnly(s.saleDate)}</td>
                    <td className="p-2 font-mono text-xs">{s.invoiceNumber ?? "—"}</td>
                    <td className="p-2 truncate max-w-[140px]">{s.customer?.name ?? "—"}</td>
                    <td className="p-2 truncate max-w-[100px]">{s.user?.displayName ?? s.user?.username ?? "—"}</td>
                    <td className="p-2">{s.terms}</td>
                    <td className="p-2 text-right font-medium whitespace-nowrap">{formatMoney(sym, s.total)}</td>
                    <td className="p-2 text-right whitespace-nowrap">{formatMoney(sym, s.paid)}</td>
                    <td className="p-2 text-right whitespace-nowrap">{formatMoney(sym, balance)}</td>
                    <td className="p-2 whitespace-nowrap">{formatTimeOnly(s.saleDate)}</td>
                    <td className="p-2">
                      <span
                        className={
                          saleStatus(s) === "PAGADA"
                            ? "text-pf-success font-medium"
                            : saleStatus(s) === "CRÉDITO"
                              ? "text-pf-warning font-medium"
                              : "text-pf-text-soft"
                        }
                      >
                        {saleStatus(s)}
                      </span>
                    </td>
                    <td className="p-2">
                      <span className="flex flex-wrap gap-1.5">
                        <Link
                          to={`/ventas/${s.id}/ticket`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex min-h-[40px] items-center rounded-lg border border-[var(--pf-border-soft)] bg-[color:var(--pf-primary-soft)] px-2.5 py-1.5 text-xs font-bold text-pf-primary-foreground shadow-[var(--pf-shadow-btn-soft)] transition hover:brightness-105 touch-manipulation md:min-h-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:text-pf-primary-hover md:shadow-none md:underline md:underline-offset-2"
                        >
                          Ticket
                        </Link>
                        <Link
                          to={`/ventas/${s.id}/comprobante`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex min-h-[40px] items-center rounded-lg border border-[var(--pf-border-soft)] bg-[color:var(--pf-info-soft)] px-2.5 py-1.5 text-xs font-bold text-pf-info shadow-[var(--pf-shadow-btn-soft)] transition hover:brightness-105 touch-manipulation md:min-h-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:font-medium md:text-pf-text-secondary md:shadow-none md:underline md:underline-offset-2"
                        >
                          Factura
                        </Link>
                        {canEditSales ? (
                          <Link
                            to={`/ventas/${s.id}/editar`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex min-h-[40px] items-center rounded-lg border border-[var(--pf-border-soft)] bg-[color:var(--pf-sky-soft)] px-2.5 py-1.5 text-xs font-bold text-pf-text-secondary shadow-[var(--pf-shadow-btn-soft)] transition hover:brightness-105 touch-manipulation md:min-h-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:font-medium md:text-pf-primary-hover md:shadow-none md:underline md:underline-offset-2"
                          >
                            Editar
                          </Link>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        {!loading && list.length === 0 ? (
          <p className="p-4 text-pf-muted text-center">Sin ventas con los filtros actuales</p>
        ) : null}
      </Card>
    </div>
  );
}
