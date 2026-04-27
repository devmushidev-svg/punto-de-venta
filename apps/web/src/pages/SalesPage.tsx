import {
  Eye,
  FileText,
  FilterX,
  Inbox,
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
import { Button, Card, EmptyState, Input, PaginationBar, Select } from "../components/ui";
import { formatDateOnly, formatMoney, formatTimeOnly } from "../lib/format";
import { isCreditSaleTerm } from "../lib/saleTerms";
import type { Customer, PaginatedResponse, Sale } from "../types";

function saleStatus(s: Sale): string {
  const balance = s.total - s.paid;
  if (balance > 0.009) {
    return isCreditSaleTerm(s.terms) ? "CRÉDITO" : "PENDIENTE";
  }
  return "PAGADA";
}

type SalesColKey = "date" | "invoice" | "customer" | "terms" | "total" | "paid" | "balance" | "time" | "status" | "seller";

const SALES_LIST_COL_DEFAULT: Record<SalesColKey, boolean> = {
  date: true,
  invoice: true,
  customer: true,
  terms: true,
  total: true,
  paid: true,
  balance: true,
  time: true,
  status: true,
  seller: false,
};

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
  const canConfigColumns = user?.role === "admin";
  const sym = organization?.currencySymbol ?? "L";
  const navigate = useNavigate();
  const [list, setList] = useState<Sale[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
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

  const [colVis, setColVis] = useState<Record<SalesColKey, boolean>>(SALES_LIST_COL_DEFAULT);
  const hasFilters = Boolean(dateFrom || dateTo || debouncedQ.trim() || customerId || termsFilter);

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
      params.set("paginated", "1");
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const qs = params.toString();
      const data = await apiFetch<PaginatedResponse<Sale>>(`/api/sales${qs ? `?${qs}` : ""}`, { token });
      setList(data.items);
      setTotal(data.total);
    } catch {
      setList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [token, dateFrom, dateTo, debouncedQ, customerId, termsFilter, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, debouncedQ, customerId, termsFilter]);

  useEffect(() => {
    if (!token) return;
    apiFetch<Customer[]>("/api/customers", { token }).then(setCustomers).catch(() => setCustomers([]));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ general: Record<string, unknown> }>("/api/settings", { token })
      .then((s) => {
        const raw = s.general?.salesList as { columns?: Partial<Record<SalesColKey, boolean>> } | undefined;
        const c = raw?.columns;
        if (c && typeof c === "object") {
          setColVis({ ...SALES_LIST_COL_DEFAULT, ...c });
        }
      })
      .catch(() => {});
  }, [token]);

  function persistColumns(next: Record<SalesColKey, boolean>) {
    setColVis(next);
    if (!token || !canConfigColumns) return;
    void apiFetch("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ general: { salesList: { columns: next } } }),
      token,
    }).catch(() => {});
  }

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
        {canConfigColumns ? (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-pf-border/60 pt-3 text-[11px] font-semibold text-pf-text-tertiary">
            <span className="w-full text-pf-text">Columnas visibles:</span>
            {(
              [
                ["date", "Fecha"],
                ["invoice", "N° factura"],
                ["customer", "Cliente"],
                ["terms", "Términos"],
                ["total", "Total"],
                ["paid", "Pago"],
                ["balance", "Saldo"],
                ["time", "Hora"],
                ["status", "Estado"],
                ["seller", "Vendedor"],
              ] as [SalesColKey, string][]
            ).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-1.5 text-pf-text">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-pf-border"
                  checked={colVis[key]}
                  onChange={(e) => persistColumns({ ...colVis, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        ) : null}
        <div className="pf-table-toolbar mt-3">
          <div className="flex flex-wrap gap-1.5">
            <span className="pf-filter-chip">{total} venta(s)</span>
            {debouncedQ.trim() ? <span className="pf-filter-chip">Busqueda: {debouncedQ.trim()}</span> : null}
            {dateFrom || dateTo ? <span className="pf-filter-chip">Rango de fechas</span> : null}
            {customerId ? <span className="pf-filter-chip">Cliente filtrado</span> : null}
            {termsFilter ? <span className="pf-filter-chip">Terminos filtrados</span> : null}
          </div>
          <p className="text-xs font-medium text-pf-text-soft">{list.length} visibles en esta pagina</p>
        </div>
      </Card>

      <Card className="pf-table-shell min-h-0 flex-1 overflow-hidden p-0">
        {loading ? (
          <p className="p-4 text-center font-medium text-pf-muted">Cargando…</p>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-5 w-5" strokeWidth={2} aria-hidden />}
            title={hasFilters ? "No hay ventas con esos filtros" : "Todavia no hay ventas registradas"}
            description={
              hasFilters
                ? "Cambie el rango, cliente, termino o busqueda para ampliar los resultados."
                : "Cuando registre ventas, apareceran aqui para consulta, impresion y seguimiento."
            }
            action={
              hasFilters ? (
                <Button type="button" variant="secondary" onClick={clearFilters}>
                  <FilterX className="h-4 w-4" strokeWidth={2} aria-hidden />
                  Limpiar filtros
                </Button>
              ) : (
                <Button type="button" onClick={() => navigate("/venta")}>
                  <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
                  Nueva venta
                </Button>
              )
            }
          />
        ) : (
          <>
          <div className="max-h-[min(600px,calc(100vh-14rem))] overflow-auto overscroll-contain">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead className="sticky top-0 z-[1]">
                <tr className="pf-table-thead text-left">
                  {colVis.date ? <th className="p-2">Fecha</th> : null}
                  {colVis.invoice ? <th className="p-2">N° Factura</th> : null}
                  {colVis.customer ? <th className="p-2">Cliente</th> : null}
                  {colVis.terms ? <th className="p-2">Términos</th> : null}
                  {colVis.total ? <th className="p-2 text-right">Total</th> : null}
                  {colVis.paid ? <th className="p-2 text-right">Pago</th> : null}
                  {colVis.balance ? <th className="p-2 text-right">Saldo</th> : null}
                  {colVis.time ? <th className="p-2">Hora</th> : null}
                  {colVis.status ? <th className="p-2">Estado</th> : null}
                  {colVis.seller ? <th className="p-2">Vendedor</th> : null}
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
                      {colVis.date ? <td className="p-2 whitespace-nowrap">{formatDateOnly(s.saleDate)}</td> : null}
                      {colVis.invoice ? <td className="p-2 font-mono text-xs">{s.invoiceNumber ?? "—"}</td> : null}
                      {colVis.customer ? (
                        <td className="p-2 truncate max-w-[180px]">{s.customer?.name ?? "—"}</td>
                      ) : null}
                      {colVis.terms ? <td className="p-2">{s.terms}</td> : null}
                      {colVis.total ? (
                        <td className="p-2 text-right font-medium whitespace-nowrap tabular-nums">{formatMoney(sym, s.total)}</td>
                      ) : null}
                      {colVis.paid ? (
                        <td className="p-2 text-right whitespace-nowrap tabular-nums">{formatMoney(sym, s.paid)}</td>
                      ) : null}
                      {colVis.balance ? (
                        <td className="p-2 text-right whitespace-nowrap tabular-nums">{formatMoney(sym, balance)}</td>
                      ) : null}
                      {colVis.time ? <td className="p-2 whitespace-nowrap">{formatTimeOnly(s.saleDate)}</td> : null}
                      {colVis.status ? (
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
                      ) : null}
                      {colVis.seller ? <td className="p-2 truncate max-w-[120px]">{s.user?.displayName ?? "—"}</td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="hidden">
            <span>
              Mostrando {list.length} de {total} ventas · PÃ¡gina {page} de {Math.max(1, Math.ceil(total / pageSize))}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-pf-border-soft bg-pf-surface-elevated px-2 py-1 font-semibold disabled:opacity-45"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </button>
              <button
                type="button"
                className="rounded-md border border-pf-border-soft bg-pf-surface-elevated px-2 py-1 font-semibold disabled:opacity-45"
                disabled={page >= Math.max(1, Math.ceil(total / pageSize))}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente
              </button>
            </div>
          </div>
          <PaginationBar page={page} pageSize={pageSize} total={total} itemLabel="ventas" onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
