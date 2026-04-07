import {
  Eye,
  FileText,
  FilterX,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useSaleDocumentToolbarSetter } from "../layouts/SaleDocumentToolbarContext";
import { Card, Input, Select } from "../components/ui";
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

function RibbonTile({
  icon: Icon,
  line1,
  line2,
  onClick,
  disabled,
  title,
  variant = "default",
}: {
  icon: LucideIcon;
  line1: string;
  line2: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  variant?: "default" | "primary" | "muted" | "danger";
}) {
  const iconBg =
    variant === "primary"
      ? "bg-gradient-to-b from-[color:var(--pf-primary-soft)] to-[color:var(--pf-warning-soft)] text-pf-primary-foreground ring-1 ring-[color:var(--pf-ribbon-active-border)]"
      : variant === "muted"
        ? "bg-gradient-to-b from-[color:var(--pf-surface-soft)] to-[color:var(--pf-surface-muted)] text-pf-text-secondary ring-1 ring-[color:var(--pf-border-soft)]"
        : variant === "danger"
          ? "bg-gradient-to-b from-[color:var(--pf-danger-soft)] to-[color:var(--pf-warning-soft)] text-pf-danger ring-1 ring-[color:var(--pf-danger-soft)]"
          : "bg-gradient-to-b from-[color:var(--pf-surface-soft)] to-[color:var(--pf-surface-elevated)] text-pf-primary-foreground ring-1 ring-[color:var(--pf-border-soft)]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`pf-ribbon-tile-idle group flex min-w-[4.5rem] flex-col items-center gap-0.5 px-2 py-1 text-center transition active:scale-95 disabled:pointer-events-none disabled:opacity-40 sm:min-w-[5rem]`}
    >
      <span className={`pf-ribbon-icon-shell inline-flex rounded-lg p-1.5 ${iconBg}`}>
        <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
      </span>
      <span className="text-[10px] font-semibold leading-tight">{line1}</span>
      <span className="text-[9px] leading-tight opacity-70">{line2}</span>
    </button>
  );
}

function RibbonGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pf-ribbon-group flex flex-col items-stretch">
      <div className="flex flex-1 flex-row items-end gap-0">{children}</div>
      <span className="pf-ribbon-group-label">{title}</span>
    </div>
  );
}

export function SalesPage() {
  const setSaleToolbar = useSaleDocumentToolbarSetter();
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
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

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

  const ribbonBar = useMemo(
    () => (
      <>
        <RibbonGroup title="Facturas">
          <RibbonTile
            variant="primary"
            icon={Plus}
            line1="Nueva venta"
            line2="estándar"
            title="Crear nueva venta (abre pestaña Venta)"
            onClick={() => navigate("/venta")}
          />
          <RibbonTile
            variant="default"
            icon={Pencil}
            line1="Editar"
            line2="venta"
            title="Editar la venta seleccionada"
            onClick={() => selectedSaleId && navigate(`/ventas/${selectedSaleId}/editar`)}
            disabled={!canEditSales || !selectedSaleId}
          />
          <RibbonTile
            variant="default"
            icon={Eye}
            line1="Ver"
            line2="venta"
            title="Ver ticket de la venta seleccionada"
            onClick={() => selectedSaleId && navigate(`/ventas/${selectedSaleId}/ticket`)}
            disabled={!selectedSaleId}
          />
          <RibbonTile
            variant="danger"
            icon={Trash2}
            line1="Eliminar"
            line2="venta"
            title="Eliminar la venta seleccionada (solo admin)"
            onClick={() => {
              if (!selectedSaleId || !canEditSales) return;
              if (!window.confirm("¿Seguro que desea eliminar esta venta? Esta acción no se puede deshacer.")) return;
              apiFetch(`/api/sales/${selectedSaleId}`, { method: "DELETE", token: token! })
                .then(() => {
                  setSelectedSaleId(null);
                  void load();
                })
                .catch(() => alert("No se pudo eliminar la venta."));
            }}
            disabled={!canEditSales || !selectedSaleId}
          />
        </RibbonGroup>
        <RibbonGroup title="Filtro fecha">
          <div className="flex items-end gap-2 px-2 py-1">
            <label className="text-[10px] font-semibold text-pf-text-tertiary">
              Inicio
              <Input
                type="date"
                className="mt-0.5 min-h-8 w-[130px] cursor-pointer text-xs"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
              />
            </label>
            <label className="text-[10px] font-semibold text-pf-text-tertiary">
              Final
              <Input
                type="date"
                className="mt-0.5 min-h-8 w-[130px] cursor-pointer text-xs"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
              />
            </label>
          </div>
          <RibbonTile
            variant="muted"
            icon={RefreshCw}
            line1="F5 Actualizar"
            line2="lista"
            title="Recargar la lista de ventas"
            onClick={load}
          />
          <RibbonTile
            variant="default"
            icon={FilterX}
            line1="Limpiar"
            line2="filtros"
            title="Quitar todos los filtros"
            onClick={clearFilters}
          />
        </RibbonGroup>
        <RibbonGroup title="Imprimir / Ver">
          <RibbonTile
            variant="default"
            icon={Printer}
            line1="Imprimir"
            line2="factura"
            title="Ver e imprimir ticket de la venta seleccionada"
            onClick={() => selectedSaleId && navigate(`/ventas/${selectedSaleId}/ticket?print=1`)}
            disabled={!selectedSaleId}
          />
          <RibbonTile
            variant="default"
            icon={FileText}
            line1="Vista previa"
            line2="factura"
            title="Ver comprobante carta de la venta seleccionada"
            onClick={() => selectedSaleId && navigate(`/ventas/${selectedSaleId}/comprobante`)}
            disabled={!selectedSaleId}
          />
        </RibbonGroup>
      </>
    ),
    [canEditSales, dateFrom, dateTo, load, navigate, selectedSaleId, token]
  );

  useLayoutEffect(() => {
    setSaleToolbar?.(ribbonBar);
    return () => setSaleToolbar?.(null);
  }, [ribbonBar, setSaleToolbar]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F5") {
        e.preventDefault();
        void load();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load]);

  return (
    <div className="flex min-h-0 flex-col gap-3 pf-safe-page">
      <Card className="space-y-3 p-3 sm:p-3.5">
        <div className="flex flex-wrap items-end gap-2 sm:gap-3">
          <div className="min-w-[200px] flex-1">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-pf-text-tertiary">
              Buscar venta por nombre o código
            </span>
            <Input
              ref={searchRef}
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Nombre, N° factura…"
              autoComplete="off"
            />
          </div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-pf-text-tertiary shrink-0 min-w-[160px]">
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
          <label className="text-[11px] font-semibold uppercase tracking-wide text-pf-text-tertiary shrink-0 min-w-[130px]">
            Términos
            <Select className="mt-1 min-h-10" value={termsFilter} onChange={(e) => setTermsFilter(e.target.value)}>
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
        </div>
      </Card>

      <Card className="pf-table-shell min-h-0 flex-1 overflow-hidden p-0">
        {loading ? (
          <p className="p-4 text-center font-medium text-pf-muted">Cargando…</p>
        ) : (
          <div className="max-h-[min(600px,calc(100vh-14rem))] overflow-auto overscroll-contain">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead className="sticky top-0 z-[1]">
                <tr className="pf-table-thead text-left">
                  <th className="p-2">Fecha</th>
                  <th className="p-2">N° Factura</th>
                  <th className="p-2">Cliente</th>
                  <th className="p-2">Términos</th>
                  <th className="p-2 text-right">Total</th>
                  <th className="p-2 text-right">Pago</th>
                  <th className="p-2 text-right">Saldo</th>
                  <th className="p-2">Hora</th>
                  <th className="p-2">Estado</th>
                </tr>
              </thead>
              <tbody className="pf-table-body">
                {list.map((s) => {
                  const balance = s.total - s.paid;
                  const selected = selectedSaleId === s.id;
                  return (
                    <tr
                      key={s.id}
                      className={`pf-table-row cursor-pointer transition ${
                        selected
                          ? "bg-[linear-gradient(to_right,var(--pf-row-selected-from),var(--pf-row-selected-to))]"
                          : "hover:bg-pf-primary-soft/20"
                      }`}
                      onClick={() => setSelectedSaleId(s.id)}
                      onDoubleClick={() => {
                        if (canEditSales) navigate(`/ventas/${s.id}/editar`);
                        else navigate(`/ventas/${s.id}/ticket`);
                      }}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (canEditSales) navigate(`/ventas/${s.id}/editar`);
                          else navigate(`/ventas/${s.id}/ticket`);
                        }
                      }}
                    >
                      <td className="p-2 whitespace-nowrap">{formatDateOnly(s.saleDate)}</td>
                      <td className="p-2 font-mono text-xs">{s.invoiceNumber ?? "—"}</td>
                      <td className="p-2 truncate max-w-[180px]">{s.customer?.name ?? "—"}</td>
                      <td className="p-2">{s.terms}</td>
                      <td className="p-2 text-right font-medium whitespace-nowrap tabular-nums">{formatMoney(sym, s.total)}</td>
                      <td className="p-2 text-right whitespace-nowrap tabular-nums">{formatMoney(sym, s.paid)}</td>
                      <td className="p-2 text-right whitespace-nowrap tabular-nums">{formatMoney(sym, balance)}</td>
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
