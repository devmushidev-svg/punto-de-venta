import { Columns3, Eye, FileText, FilterX, History, Inbox, Pencil, Plus, Printer, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useSaleDocumentToolbarSetter } from "../layouts/SaleDocumentToolbarContext";
import { Button, Card, EmptyState, Input, Modal, PaginationBar, Select, Textarea } from "../components/ui";
import { ToolbarButton, ToolbarSeparator } from "../components/DocumentToolbar";
import { formatDateOnly, formatMoney, formatTimeOnly } from "../lib/format";
import { hasPermission, PERMISSION_KEYS } from "../lib/permissions";
import { isCreditSaleTerm } from "../lib/saleTerms";
import type { Customer, PaginatedResponse, Sale } from "../types";

/** Fila de la bitacora de ventas eliminadas (GET /api/sales/eliminadas). */
type DeletedSale = {
  id: string;
  invoiceNumber: string | null;
  total: number;
  saleDate: string;
  deletedAt: string;
  deletedReason: string | null;
  customer: { name: string } | null;
  user: { displayName: string };
  deletedBy: { displayName: string } | null;
};

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


export function SalesPage() {
  const setSaleToolbar = useSaleDocumentToolbarSetter();
  const { token, organization, user } = useAuth();
  const canEditSales = user?.role === "admin";
  const canDeleteSales = hasPermission(user, PERMISSION_KEYS.SALES_DELETE);
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

  const selectedSale = list.find((s) => s.id === selectedSaleId) ?? null;
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState<DeletedSale[] | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [deleteErr, setDeleteErr] = useState("");
  const [deleting, setDeleting] = useState(false);

  const [colVis, setColVis] = useState<Record<SalesColKey, boolean>>(SALES_LIST_COL_DEFAULT);
  const [colsOpen, setColsOpen] = useState(false);
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

  function openSale(saleId: string) {
    navigate(canEditSales ? `/ventas/${saleId}/editar` : `/ventas/${saleId}/ticket`);
  }

  /**
   * Acciones sobre la venta seleccionada. "Nueva venta" no vive aqui: es la
   * accion global de la barra lateral. Los filtros de fecha bajaron al panel
   * de filtros, junto al resto.
   */
  const ribbonBar = useMemo(
    () => (
      <>
        <ToolbarButton
          tone="primary"
          icon={Eye}
          label="Ver"
          title="Ver el ticket de la venta seleccionada"
          onClick={() => selectedSaleId && navigate(`/ventas/${selectedSaleId}/ticket`)}
          disabled={!selectedSaleId}
        />
        <ToolbarButton
          icon={Pencil}
          label="Editar"
          title="Editar la venta seleccionada"
          onClick={() => selectedSaleId && navigate(`/ventas/${selectedSaleId}/editar`)}
          disabled={!canEditSales || !selectedSaleId}
        />
        <ToolbarButton
          icon={Printer}
          label="Imprimir"
          title="Imprimir el ticket de la venta seleccionada"
          onClick={() => selectedSaleId && navigate(`/ventas/${selectedSaleId}/ticket?print=1`)}
          disabled={!selectedSaleId}
        />
        <ToolbarButton
          icon={FileText}
          label="Comprobante"
          title="Ver el comprobante tamaño carta"
          onClick={() => selectedSaleId && navigate(`/ventas/${selectedSaleId}/comprobante`)}
          disabled={!selectedSaleId}
        />
        <ToolbarSeparator />
        <ToolbarButton
          icon={RefreshCw}
          label="Actualizar"
          shortcut="F5"
          title="Recargar la lista"
          onClick={load}
        />
        <ToolbarButton
          tone="danger"
          icon={Trash2}
          label="Eliminar"
          title={
            canDeleteSales
              ? "Eliminar la venta seleccionada indicando el motivo"
              : "Requiere el permiso sales.delete"
          }
          onClick={() => {
            if (!selectedSaleId || !canDeleteSales) return;
            setDeleteReason("");
            setDeleteErr("");
            setDeleteOpen(true);
          }}
          disabled={!canDeleteSales || !selectedSaleId}
        />
        {canEditSales ? (
          <ToolbarButton
            icon={History}
            label="Eliminadas"
            title="Ver las ventas eliminadas, con su motivo y quién las eliminó"
            onClick={() => {
              setAuditOpen(true);
              setAudit(null);
              apiFetch<DeletedSale[]>("/api/sales/eliminadas", { token: token! })
                .then(setAudit)
                .catch(() => setAudit([]));
            }}
          />
        ) : null}
      </>
    ),
    [canEditSales, canDeleteSales, load, navigate, selectedSaleId, token]
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
      <Card className="space-y-3 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px] flex-1">
            <label
              htmlFor="sales-search"
              className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-pf-muted"
            >
              Buscar
            </label>
            <Input
              id="sales-search"
              ref={searchRef}
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Nombre o N° de factura…"
              autoComplete="off"
            />
          </div>
          <label className="min-w-[150px] shrink-0 text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
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
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-pf-muted">Contraseña de administrador</span>
            <Input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="Confirmar autorización" />
          </label>
          <label className="min-w-[130px] shrink-0 text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
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
          <label className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
            Desde
            <Input
              type="date"
              className="mt-1 min-h-10 w-[140px] cursor-pointer"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
            />
          </label>
          <label className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
            Hasta
            <Input
              type="date"
              className="mt-1 min-h-10 w-[140px] cursor-pointer"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
            />
          </label>
          {hasFilters ? (
            <Button type="button" variant="ghost" className="min-h-10 shrink-0" onClick={clearFilters}>
              <FilterX className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              Limpiar
            </Button>
          ) : null}
          {canConfigColumns ? (
            <Button
              type="button"
              variant="secondary"
              className="!hidden min-h-10 shrink-0 sm:!inline-flex"
              aria-expanded={colsOpen}
              onClick={() => setColsOpen((v) => !v)}
            >
              <Columns3 className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              Columnas
            </Button>
          ) : null}
        </div>

        {canConfigColumns && colsOpen ? (
          <div className="hidden flex-wrap gap-x-4 gap-y-2 border-t border-pf-border pt-3 text-xs sm:flex">
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
              <label key={key} className="flex min-h-8 cursor-pointer items-center gap-1.5 font-medium text-pf-text-secondary">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-pf-border accent-[color:var(--pf-primary)]"
                  checked={colVis[key]}
                  onChange={(e) => persistColumns({ ...colVis, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        ) : null}
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
          <div className="divide-y divide-pf-border-soft sm:hidden" role="list" aria-label="Ventas">
            {list.map((s) => {
              const balance = s.total - s.paid;
              const selected = selectedSaleId === s.id;
              const status = saleStatus(s);
              const invoice = s.invoiceNumber ?? "Venta sin factura";
              const ActionIcon = canEditSales ? Pencil : Eye;
              const actionLabel = canEditSales ? "Editar" : "Ver ticket";

              return (
                <article
                  key={s.id}
                  role="listitem"
                  className={`p-3 transition-colors ${
                    selected ? "bg-pf-primary-soft shadow-[inset_3px_0_0_0_var(--pf-primary-mid)]" : "bg-pf-surface-elevated"
                  }`}
                  aria-current={selected ? "true" : undefined}
                >
                  <button
                    type="button"
                    className="flex w-full touch-manipulation items-start justify-between gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
                    aria-pressed={selected}
                    aria-label={`Seleccionar ${invoice}`}
                    onClick={() => setSelectedSaleId(s.id)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs font-semibold text-pf-text">{invoice}</span>
                      <span className="mt-1 block truncate text-sm font-semibold text-pf-text">
                        {s.customer?.name ?? "Consumidor final"}
                      </span>
                      <span className="mt-1 block text-xs text-pf-muted">
                        {formatDateOnly(s.saleDate)} · {formatTimeOnly(s.saleDate)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-base font-bold tabular-nums text-pf-text">
                        {formatMoney(sym, s.total)}
                      </span>
                      {balance > 0.009 ? (
                        <span className="mt-1 block text-xs font-medium tabular-nums text-pf-warning">
                          Saldo {formatMoney(sym, balance)}
                        </span>
                      ) : null}
                    </span>
                  </button>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-xs">
                      <span className="truncate rounded-md bg-pf-surface px-2 py-1 font-medium text-pf-text-secondary">
                        {s.terms}
                      </span>
                      <span
                        className={
                          status === "PAGADA"
                            ? "font-semibold text-pf-success"
                            : status === "CRÉDITO"
                              ? "font-semibold text-pf-warning"
                              : "font-semibold text-pf-text-soft"
                        }
                      >
                        {status}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant={canEditSales ? "secondary" : "ghost"}
                      className="min-h-11 shrink-0 px-3 text-xs"
                      aria-label={`${actionLabel}: ${invoice}`}
                      onClick={() => {
                        setSelectedSaleId(s.id);
                        openSale(s.id);
                      }}
                    >
                      <ActionIcon className="h-4 w-4" strokeWidth={2} aria-hidden />
                      {actionLabel}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="hidden max-h-[min(600px,calc(100vh-14rem))] overflow-auto overscroll-contain sm:block">
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
                      aria-selected={selected}
                      className={`pf-table-row cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)] ${
                        selected
                          ? "bg-pf-primary-soft shadow-[inset_2px_0_0_0_var(--pf-primary-mid)]"
                          : "hover:bg-pf-surface"
                      }`}
                      onClick={() => setSelectedSaleId(s.id)}
                      onDoubleClick={() => {
                        openSale(s.id);
                      }}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          openSale(s.id);
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
          <PaginationBar page={page} pageSize={pageSize} total={total} itemLabel="ventas" onPageChange={setPage} />
          </>
        )}
      </Card>

      <Modal
        open={deleteOpen}
        title="Eliminar venta"
        onClose={() => (deleting ? undefined : setDeleteOpen(false))}
      >
        <div className="space-y-3">
          <p className="text-sm text-pf-text">
            Va a eliminar la venta{" "}
            <strong>{selectedSale?.invoiceNumber ?? "sin número"}</strong>
            {selectedSale ? ` por ${formatMoney(sym, selectedSale.total)}` : ""}.
          </p>
          <div className="rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface p-3 text-xs text-pf-text-tertiary">
            <p>La venta deja de contar en los listados, en los reportes y en la caja.</p>
            <p className="mt-1">El inventario de sus productos vuelve a existencias.</p>
            <p className="mt-1">
              Queda registrada con su nombre, la fecha y el motivo. Un administrador puede consultarla después.
            </p>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-pf-muted">
              Motivo de la eliminación
            </span>
            <Textarea
              autoFocus
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="Ej.: factura duplicada por error del cajero"
              className="min-h-[80px]"
              maxLength={300}
            />
          </label>
          {deleteErr ? <p className="text-sm text-pf-danger">{deleteErr}</p> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={() => setDeleteOpen(false)} disabled={deleting}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={deleteReason.trim().length < 4 || adminPassword.length === 0 || deleting || !selectedSaleId}
            onClick={async () => {
              if (!selectedSaleId || !token) return;
              setDeleting(true);
              setDeleteErr("");
              try {
                await apiFetch(`/api/sales/${selectedSaleId}`, {
                  method: "DELETE",
                  body: JSON.stringify({ reason: deleteReason.trim(), adminPassword }),
                  token,
                });
                setDeleteOpen(false);
                setSelectedSaleId(null);
                setAdminPassword("");
                void load();
              } catch (e) {
                setDeleteErr(e instanceof Error ? e.message : "No se pudo eliminar la venta.");
              } finally {
                setDeleting(false);
              }
            }}
          >
            {deleting ? "Eliminando…" : "Eliminar venta"}
          </Button>
        </div>
      </Modal>

      <Modal open={auditOpen} title="Ventas eliminadas" onClose={() => setAuditOpen(false)} wide>
        {audit === null ? (
          <p className="py-8 text-center text-sm text-pf-muted">Cargando…</p>
        ) : audit.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-pf-text">No se ha eliminado ninguna venta.</p>
            <p className="mt-1 text-sm text-pf-text-tertiary">
              Cuando alguien elimine una, aparecerá aquí con el motivo y su nombre.
            </p>
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-pf-surface-elevated">
                <tr className="border-b border-pf-border text-left text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
                  <th scope="col" className="py-2 pr-3 font-semibold">Documento</th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">Total</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Eliminó</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Cuándo</th>
                  <th scope="col" className="py-2 font-semibold">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((d) => (
                  <tr key={d.id} className="border-b border-pf-border last:border-0 align-top">
                    <td className="py-2.5 pr-3">
                      <span className="block font-medium text-pf-text">{d.invoiceNumber ?? "Sin número"}</span>
                      <span className="block text-xs text-pf-text-tertiary">
                        {d.customer?.name ?? "Consumidor final"} · vendió {d.user.displayName}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-right font-semibold tabular-nums text-pf-text">
                      {formatMoney(sym, d.total)}
                    </td>
                    <td className="py-2.5 pr-3 text-pf-text-secondary">{d.deletedBy?.displayName ?? "Usuario eliminado"}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums text-pf-text-tertiary">
                      {formatDateOnly(d.deletedAt)} {formatTimeOnly(d.deletedAt)}
                    </td>
                    <td className="py-2.5 text-pf-text-tertiary">{d.deletedReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
