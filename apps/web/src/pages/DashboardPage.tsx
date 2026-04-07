import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  LayoutGrid,
  ListOrdered,
  Package,
  PlusCircle,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { BrandLogo } from "../components/BrandLogo";
import { Card } from "../components/ui";
import { formatMoney } from "../lib/format";
import { hasPermission, PERMISSION_KEYS } from "../lib/permissions";
import type { ExpenseRow } from "../types";
import type { OrganizationFull } from "./CompanyInfoPage";

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  to,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  accent: "primary" | "info" | "warning" | "success" | "danger";
  to?: string;
}) {
  const accentMap = {
    primary: "from-pf-primary-soft/70 to-pf-surface-elevated border-pf-primary-soft text-pf-primary-hover",
    info: "from-pf-info-soft/70 to-pf-surface-elevated border-pf-info-soft text-pf-info",
    warning: "from-pf-warning-soft/70 to-pf-surface-elevated border-pf-warning-soft text-pf-warning",
    success: "from-pf-success-soft/70 to-pf-surface-elevated border-pf-success-soft text-pf-success",
    danger: "from-pf-danger-soft/70 to-pf-surface-elevated border-pf-danger-soft text-pf-danger",
  };

  const content = (
    <div
      className={`flex items-start gap-3 rounded-xl border bg-gradient-to-br p-4 shadow-sm transition hover:shadow-md ${accentMap[accent]}`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pf-surface-elevated/80 shadow-sm">
        <Icon className="h-5 w-5" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-pf-muted">{label}</p>
        <p className="mt-0.5 text-lg font-extrabold tabular-nums text-pf-text">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-pf-text-tertiary">{sub}</p>}
      </div>
      {to && <ArrowRight className="mt-2.5 h-4 w-4 shrink-0 text-pf-muted" strokeWidth={2} />}
    </div>
  );

  if (to) return <Link to={to} className="block">{content}</Link>;
  return content;
}

export function DashboardPage() {
  const { organization, token, user } = useAuth();
  const fallbackName = organization?.name ?? "Empresa";
  const sym = organization?.currencySymbol ?? "L";
  const [summary, setSummary] = useState<{ count: number; total: number } | null>(null);
  const [inv, setInv] = useState<{ stockValueAtCost: number; lowStock: { name: string; stock: number }[] } | null>(null);
  const [company, setCompany] = useState<OrganizationFull | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [expensesToday, setExpensesToday] = useState<number | null>(null);

  const canReports = hasPermission(user, PERMISSION_KEYS.REPORTS_VIEW);
  const canSeeExpensesSummary = user?.role === "admin" || hasPermission(user, PERMISSION_KEYS.EXPENSES_VIEW);

  useEffect(() => {
    if (!token) return;
    setOrgLoading(true);
    apiFetch<OrganizationFull>("/api/organizations/current", { token })
      .then(setCompany)
      .catch(() => setCompany(null))
      .finally(() => setOrgLoading(false));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    if (!canReports) {
      setSummary({ count: 0, total: 0 });
      setInv({ stockValueAtCost: 0, lowStock: [] });
      return;
    }
    apiFetch<{ count: number; total: number }>("/api/reports/sales-summary", { token })
      .then(setSummary)
      .catch(() => setSummary({ count: 0, total: 0 }));
    apiFetch<{ stockValueAtCost: number; lowStock: { name: string; stock: number }[] }>("/api/reports/inventory", { token })
      .then(setInv)
      .catch(() => setInv({ stockValueAtCost: 0, lowStock: [] }));
  }, [token, canReports]);

  useEffect(() => {
    if (!token || !canSeeExpensesSummary) {
      setExpensesToday(null);
      return;
    }
    const t = new Date();
    const start = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, 0, 0, 0);
    const end = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 59, 999);
    const q = `from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`;
    apiFetch<ExpenseRow[]>(`/api/expenses?${q}`, { token })
      .then((rows) => setExpensesToday(rows.reduce((s, r) => s + r.amount, 0)))
      .catch(() => setExpensesToday(null));
  }, [token, canSeeExpensesSummary]);

  const lowCount = inv?.lowStock.length ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-2 py-4 pf-safe-page md:px-4 md:py-6">
      {/* Company header */}
      {orgLoading ? (
        <Card className="pf-glass-card-panel p-8 text-center text-sm text-pf-muted">Cargando…</Card>
      ) : company ? (
        <Card className="pf-glass-card-panel relative overflow-hidden p-5 md:p-6">
          <div className="pf-dashboard-card-glow" aria-hidden />
          <div className="relative z-[1] flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              {company.logoUrl ? (
                <img src={company.logoUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-contain shadow-sm" />
              ) : (
                <div className="pf-logo-fallback-ring !rounded-xl !p-2 shrink-0">
                  <BrandLogo size={40} withShadow className="opacity-90" />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-lg font-extrabold tracking-tight text-pf-text md:text-xl">{company.name}</h1>
                {company.slogan && <p className="text-sm text-pf-text-tertiary">{company.slogan}</p>}
                <p className="mt-0.5 text-xs text-pf-muted">
                  {[company.address, company.city, company.department].filter(Boolean).join(", ") || "Sin dirección configurada"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link
                to="/empresa"
                className="rounded-lg border border-pf-border-soft bg-pf-surface-elevated/80 px-3 py-1.5 text-xs font-semibold text-pf-text-tertiary shadow-sm transition hover:bg-pf-surface-muted hover:text-pf-text touch-manipulation"
              >
                Editar empresa
              </Link>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="pf-glass-card-panel space-y-2 p-5 text-center">
          <p className="font-semibold text-pf-text">{fallbackName}</p>
          <p className="text-sm text-pf-muted">No se pudieron cargar los datos completos.</p>
          <Link to="/empresa" className="text-sm font-medium text-pf-primary-hover underline-offset-2 hover:underline">
            Ir a información de la empresa
          </Link>
        </Card>
      )}

      {/* KPI grid */}
      {canReports && (summary || inv) && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summary && (
            <KpiCard
              label="Ventas hoy"
              value={formatMoney(sym, summary.total)}
              sub={`${summary.count} documento${summary.count !== 1 ? "s" : ""}`}
              icon={TrendingUp}
              accent="primary"
              to="/ventas"
            />
          )}
          {inv && (
            <KpiCard
              label="Inventario"
              value={formatMoney(sym, inv.stockValueAtCost)}
              sub="Valor al costo"
              icon={Package}
              accent="info"
              to="/productos"
            />
          )}
          {canSeeExpensesSummary && expensesToday !== null && (
            <KpiCard
              label="Gastos hoy"
              value={formatMoney(sym, expensesToday)}
              icon={Banknote}
              accent={expensesToday > 0 ? "warning" : "success"}
              to="/gastos"
            />
          )}
          {lowCount > 0 && (
            <KpiCard
              label="Stock bajo"
              value={`${lowCount} producto${lowCount !== 1 ? "s" : ""}`}
              sub="Requieren atención"
              icon={AlertTriangle}
              accent="danger"
              to="/productos"
            />
          )}
        </div>
      )}

      {/* Low stock detail */}
      {canReports && inv && lowCount > 0 && (
        <Card className="pf-glass-card-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-pf-border-soft px-4 py-3">
            <p className="text-sm font-bold text-pf-text">Productos con stock bajo</p>
            <Link to="/productos" className="text-xs font-semibold text-pf-primary-hover hover:underline underline-offset-2">
              Ver todos
            </Link>
          </div>
          <div className="divide-y divide-pf-border-soft">
            {inv.lowStock.slice(0, 8).map((item) => (
              <div key={item.name} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="truncate font-medium text-pf-text">{item.name}</span>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums ${
                  item.stock <= 0
                    ? "bg-pf-danger-soft text-pf-danger"
                    : "bg-pf-warning-soft text-pf-warning"
                }`}>
                  {item.stock}
                </span>
              </div>
            ))}
            {lowCount > 8 && (
              <div className="px-4 py-2 text-center">
                <Link to="/productos" className="text-xs font-medium text-pf-primary-hover hover:underline">
                  +{lowCount - 8} más…
                </Link>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Quick actions */}
      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-pf-muted">Acceso rápido</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {[
            { to: "/venta", label: "Nueva venta", icon: PlusCircle, primary: true },
            { to: "/venta/tactil", label: "Venta táctil", icon: LayoutGrid },
            { to: "/ventas", label: "Lista ventas", icon: ListOrdered },
            { to: "/productos", label: "Productos", icon: Package },
            { to: "/caja", label: "Caja", icon: Wallet },
          ].map(({ to, label, icon: Icon, primary }) => (
            <Link
              key={to}
              to={to}
              className={`flex min-h-[52px] items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold shadow-sm transition active:scale-[0.98] touch-manipulation hover:shadow-md ${
                primary
                  ? "pf-btn-primary-gradient border-transparent !rounded-xl"
                  : "border-pf-border-soft bg-pf-surface-elevated text-pf-text hover:bg-pf-surface-muted"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
