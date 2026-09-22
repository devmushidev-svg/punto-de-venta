import { AlertTriangle, ArrowRight, PackageX, PlusCircle, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { SalesTrend, type DailySale } from "../components/SalesTrend";
import { formatMoney } from "../lib/format";
import { hasPermission, PERMISSION_KEYS } from "../lib/permissions";
import type { ExpenseRow, PaginatedResponse, Sale } from "../types";

type CashSession = {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  expectedCash: number | null;
};

type Alert = {
  id: string;
  title: string;
  detail: string;
  to: string;
  tone: "danger" | "warning";
  icon: typeof AlertTriangle;
};

const timeFmt = new Intl.DateTimeFormat("es-HN", { hour: "2-digit", minute: "2-digit" });

function todayRange() {
  const t = new Date();
  const start = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, 0, 0, 0);
  const end = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 59, 999);
  return { start, end };
}

export function DashboardPage() {
  const { organization, token, user } = useAuth();
  const sym = organization?.currencySymbol ?? "L";

  const [summary, setSummary] = useState<{ count: number; total: number } | null>(null);
  const [inv, setInv] = useState<{ stockValueAtCost: number; lowStock: { name: string; stock: number }[] } | null>(null);
  const [expensesToday, setExpensesToday] = useState<number | null>(null);
  const [session, setSession] = useState<CashSession | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [recent, setRecent] = useState<Sale[] | null>(null);
  const [daily, setDaily] = useState<DailySale[] | null>(null);

  const canReports = hasPermission(user, PERMISSION_KEYS.REPORTS_VIEW);
  const canSeeExpenses = user?.role === "admin" || hasPermission(user, PERMISSION_KEYS.EXPENSES_VIEW);

  useEffect(() => {
    if (!token || !canReports) return;
    // Sin from/to el endpoint devuelve el acumulado historico, no el del dia.
    const { start, end } = todayRange();
    const range = `from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`;
    apiFetch<{ count: number; total: number }>(`/api/reports/sales-summary?${range}`, { token })
      .then(setSummary)
      .catch(() => setSummary(null));
    apiFetch<{ stockValueAtCost: number; lowStock: { name: string; stock: number }[] }>("/api/reports/inventory", { token })
      .then(setInv)
      .catch(() => setInv(null));
    apiFetch<{ days: DailySale[] }>("/api/reports/sales-daily?days=14", { token })
      .then((d) => setDaily(d.days))
      .catch(() => setDaily([]));
  }, [token, canReports]);

  useEffect(() => {
    if (!token || !canSeeExpenses) {
      setExpensesToday(null);
      return;
    }
    const { start, end } = todayRange();
    const q = `from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`;
    apiFetch<ExpenseRow[]>(`/api/expenses?${q}`, { token })
      .then((rows) => setExpensesToday(rows.reduce((sum, row) => sum + row.amount, 0)))
      .catch(() => setExpensesToday(null));
  }, [token, canSeeExpenses]);

  useEffect(() => {
    if (!token) return;
    apiFetch<CashSession | null>("/api/cash-sessions/current", { token })
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setSessionLoaded(true));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    apiFetch<PaginatedResponse<Sale>>("/api/sales?paginated=1&page=1&pageSize=8", { token })
      .then((data) => setRecent(data.items))
      .catch(() => setRecent([]));
  }, [token]);

  const now = new Date();
  const greeting = now.getHours() < 12 ? "Buenos días" : now.getHours() < 18 ? "Buenas tardes" : "Buenas noches";
  const firstName = user?.displayName?.split(" ")[0] || user?.username || "";
  const todayLabel = new Intl.DateTimeFormat("es-HN", { weekday: "long", day: "numeric", month: "long" }).format(now);

  const cashOpen = Boolean(session && !session.closedAt);
  const lowStock = inv?.lowStock ?? [];
  const outOfStock = lowStock.filter((p) => p.stock <= 0);
  const runningLow = lowStock.filter((p) => p.stock > 0);

  // Promedio de los dias anteriores (sin hoy): da sentido a la cifra de hoy.
  const previousDays = daily && daily.length > 1 ? daily.slice(0, -1) : [];
  const previousAvg = previousDays.length
    ? previousDays.reduce((s, d) => s + d.total, 0) / previousDays.length
    : null;
  const todayTotal = daily && daily.length ? daily[daily.length - 1].total : null;
  // Con muy pocos dias vendidos el porcentaje sale absurdo (+11286%) y no informa nada.
  const activePrevious = previousDays.filter((d) => d.total > 0).length;
  const deltaPct =
    previousAvg !== null && previousAvg > 0 && todayTotal !== null && activePrevious >= 3
      ? Math.round(((todayTotal - previousAvg) / previousAvg) * 100)
      : null;
  const bestDay = daily && daily.length ? daily.reduce((a, b) => (b.total > a.total ? b : a)) : null;

  const alerts: Alert[] = [];
  if (sessionLoaded && !cashOpen) {
    alerts.push({
      id: "cash",
      title: "Caja sin abrir",
      detail: "Abra el turno antes de cobrar en efectivo.",
      to: "/caja",
      tone: "danger",
      icon: Wallet,
    });
  }
  if (outOfStock.length > 0) {
    alerts.push({
      id: "out",
      title: `${outOfStock.length} producto${outOfStock.length !== 1 ? "s" : ""} agotado${outOfStock.length !== 1 ? "s" : ""}`,
      detail: outOfStock.slice(0, 3).map((p) => p.name).join(", "),
      to: "/productos",
      tone: "danger",
      icon: PackageX,
    });
  }
  if (runningLow.length > 0) {
    alerts.push({
      id: "low",
      title: `${runningLow.length} producto${runningLow.length !== 1 ? "s" : ""} con stock bajo`,
      detail: runningLow.slice(0, 3).map((p) => `${p.name} (${p.stock})`).join(", "),
      to: "/productos",
      tone: "warning",
      icon: AlertTriangle,
    });
  }

  return (
    <div className="mx-auto max-w-[78rem] pf-safe-page">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-pf-text sm:text-2xl">
            {greeting}{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 truncate text-sm text-pf-text-tertiary">
            <span className="font-medium text-pf-text-secondary">{organization?.name ?? "Mi negocio"}</span>
            <span className="mx-1.5 text-pf-border-strong" aria-hidden>·</span>
            <span className="first-letter:uppercase">{todayLabel}</span>
          </p>
        </div>
        <Link
          to="/venta"
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-pf-primary px-5 text-sm font-semibold text-[color:var(--pf-primary-foreground)] transition-colors hover:bg-pf-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
        >
          <PlusCircle className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
          Iniciar venta
        </Link>
      </header>

      <div className="mt-6 grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          {canReports ? (
            <section className="flex flex-wrap items-end gap-x-10 gap-y-5 border-b border-pf-border pb-5" aria-label="Resumen del día">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Ventas de hoy</p>
                <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-pf-text">
                  {summary ? formatMoney(sym, summary.total) : "—"}
                </p>
                <p className="mt-0.5 text-xs text-pf-text-tertiary">
                  {summary ? `${summary.count} documento${summary.count !== 1 ? "s" : ""}` : "Sin datos"}
                </p>
                {deltaPct !== null ? (
                  <p
                    className={`mt-1.5 inline-flex items-center gap-1 text-xs font-semibold ${
                      deltaPct >= 0 ? "text-pf-success" : "text-pf-danger"
                    }`}
                  >
                    {deltaPct >= 0 ? (
                      <TrendingUp className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} aria-hidden />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} aria-hidden />
                    )}
                    {deltaPct >= 0 ? "+" : ""}
                    {deltaPct}%
                    <span className="font-normal text-pf-text-tertiary">
                      vs. promedio de {previousDays.length} días
                    </span>
                  </p>
                ) : null}
              </div>

              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Caja</p>
                <p className={`mt-1 text-lg font-semibold tabular-nums ${cashOpen ? "text-pf-success" : "text-pf-text-tertiary"}`}>
                  {!sessionLoaded ? "—" : cashOpen ? "Abierta" : "Cerrada"}
                </p>
                <p className="mt-0.5 text-xs text-pf-text-tertiary">
                  {cashOpen && session
                    ? `Desde ${timeFmt.format(new Date(session.openedAt))}`
                    : sessionLoaded
                      ? "Sin turno activo"
                      : ""}
                </p>
              </div>

              {canSeeExpenses && expensesToday !== null ? (
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Gastos de hoy</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-pf-text-secondary">
                    {formatMoney(sym, expensesToday)}
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}

          {canReports && daily && daily.length > 1 ? (
            <section className="mt-6" aria-label="Tendencia de ventas">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-sm font-bold tracking-tight text-pf-text">Ventas de los últimos 14 días</h2>
                <p className="text-xs text-pf-text-tertiary">
                  Promedio diario{" "}
                  <span className="font-semibold tabular-nums text-pf-text-secondary">
                    {formatMoney(sym, daily.reduce((s, d) => s + d.total, 0) / daily.length)}
                  </span>
                  {bestDay && bestDay.total > 0 ? (
                    <>
                      <span className="mx-1.5 text-pf-border-strong" aria-hidden>·</span>
                      Mejor día{" "}
                      <span className="font-semibold tabular-nums text-pf-text-secondary">
                        {formatMoney(sym, bestDay.total)}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface-elevated py-3 pr-3">
                <SalesTrend data={daily} sym={sym} />
              </div>
            </section>
          ) : null}

          <section className="mt-6" aria-label="Últimas ventas">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-bold tracking-tight text-pf-text">Últimas ventas</h2>
              <Link
                to="/ventas"
                className="inline-flex items-center gap-1 py-2 text-xs font-semibold text-pf-primary-hover hover:underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
              >
                Ver todas
                <ArrowRight className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
              </Link>
            </div>

            {recent === null ? (
              <p className="py-8 text-center text-sm text-pf-muted">Cargando…</p>
            ) : recent.length === 0 ? (
              <div className="rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface-elevated px-5 py-8 text-center">
                <p className="text-sm font-medium text-pf-text">Todavía no hay ventas registradas.</p>
                <p className="mt-1 text-sm text-pf-text-tertiary">La primera venta aparecerá aquí.</p>
                <Link
                  to="/venta"
                  className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg bg-pf-primary px-4 text-sm font-semibold text-[color:var(--pf-primary-foreground)] hover:bg-pf-primary-hover"
                >
                  <PlusCircle className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                  Iniciar venta
                </Link>
              </div>
            ) : (
              <div className="overflow-hidden rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface-elevated">
                <table className="w-full text-sm">
                  <caption className="sr-only">Últimas ventas registradas</caption>
                  <thead>
                    <tr className="border-b border-pf-border text-left text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
                      <th scope="col" className="px-4 py-2.5 font-semibold">Documento</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Cliente</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-semibold">Total</th>
                      <th scope="col" className="hidden px-4 py-2.5 text-right font-semibold sm:table-cell">Hora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((sale) => (
                      <tr key={sale.id} className="border-b border-pf-border last:border-0 hover:bg-pf-surface">
                        <td className="p-0">
                          <Link
                            to={`/ventas/${sale.id}/ticket`}
                            className="block px-4 py-3 font-medium text-pf-text hover:text-pf-primary-hover hover:underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
                          >
                            {sale.invoiceNumber ?? "Sin número"}
                          </Link>
                        </td>
                        <td className="max-w-0 truncate px-4 py-2.5 text-pf-text-tertiary">
                          {sale.customer?.name ?? "Consumidor final"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-pf-text">
                          {formatMoney(sym, sale.total)}
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-pf-text-tertiary sm:table-cell">
                          {timeFmt.format(new Date(sale.saleDate))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="min-w-0" aria-label="Pendientes">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-bold tracking-tight text-pf-text">Requiere atención</h2>
            {alerts.length > 0 ? <span className="text-xs font-semibold tabular-nums text-pf-muted">{alerts.length}</span> : null}
          </div>
          {alerts.length === 0 ? (
            <div className="rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface-elevated px-4 py-6 text-center">
              <p className="text-sm font-medium text-pf-text">Todo en orden</p>
              <p className="mt-1 text-sm text-pf-text-tertiary">No hay pendientes ahora mismo.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {alerts.map((alert) => {
                const Icon = alert.icon;
                return (
                  <li key={alert.id}>
                    <Link
                      to={alert.to}
                      className="flex gap-3 rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface-elevated p-3 transition-colors hover:bg-pf-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
                    >
                      <Icon
                        className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${alert.tone === "danger" ? "text-pf-danger" : "text-pf-warning"}`}
                        strokeWidth={1.9}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-pf-text">{alert.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-pf-text-tertiary">{alert.detail}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
