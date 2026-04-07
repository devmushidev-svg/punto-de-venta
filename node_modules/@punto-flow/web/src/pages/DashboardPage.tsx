import { LayoutGrid, ListOrdered, Package, PlusCircle, Wallet } from "lucide-react";
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

export function DashboardPage() {
  const { organization, token, user } = useAuth();
  const fallbackName = organization?.name ?? "Empresa";
  const sym = organization?.currencySymbol ?? "L";
  const [summary, setSummary] = useState<{ count: number; total: number } | null>(null);
  const [inv, setInv] = useState<{ stockValueAtCost: number; lowStock: { name: string; stock: number }[] } | null>(
    null
  );
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
    apiFetch<{ stockValueAtCost: number; lowStock: { name: string; stock: number }[] }>("/api/reports/inventory", {
      token,
    })
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
    <div className="flex min-h-[min(72vh,760px)] flex-col items-center justify-center px-2 py-6 md:py-8">
      <p className="pf-page-eyebrow">Inicio</p>

      {orgLoading ? (
        <Card className="w-full max-w-md p-8 text-center text-sm text-pf-muted">Cargando…</Card>
      ) : company ? (
        <Card className="relative w-full max-w-2xl overflow-hidden p-6 shadow-[var(--pf-shadow-warm-md)] md:p-8">
          <div className="pf-dashboard-card-glow" aria-hidden />
          <div className="relative z-[1] flex flex-col gap-6 md:flex-row md:items-start md:justify-between md:gap-8">
            <div className="min-w-0 flex-1 space-y-3 text-center md:text-left">
              <h1 className="text-xl font-extrabold leading-snug tracking-tight text-pf-text md:text-2xl">{company.name}</h1>
              {company.slogan ? <p className="text-sm text-pf-text-tertiary">{company.slogan}</p> : null}
              {company.address ? (
                <p className="text-sm text-pf-text-secondary">
                  {[company.address, company.city, company.department].filter(Boolean).join(", ")}
                </p>
              ) : null}
              <div className="flex flex-col gap-1 text-sm text-pf-text-tertiary md:text-left">
                {company.taxId ? (
                  <p>
                    <span className="text-pf-muted">{company.taxIdType ?? "RTN"}</span> {company.taxId}
                  </p>
                ) : null}
                {company.phone ? <p>Tel. {company.phone}</p> : null}
                {company.email ? <p className="break-all">{company.email}</p> : null}
              </div>
              <p className="pt-2">
                <Link
                  to="/empresa"
                  className="text-sm font-medium text-pf-primary-hover underline-offset-2 hover:underline"
                >
                  Editar datos de la empresa
                </Link>
              </p>
            </div>
            {company.logoUrl ? (
              <div className="flex shrink-0 justify-center md:justify-end">
                <img
                  src={company.logoUrl}
                  alt=""
                  className="h-24 w-auto max-w-[180px] object-contain md:h-28"
                />
              </div>
            ) : (
              <div className="flex shrink-0 items-center justify-center md:justify-end" aria-hidden>
                <div className="pf-logo-fallback-ring">
                  <BrandLogo size={80} withShadow className="opacity-90" />
                </div>
              </div>
            )}
          </div>

          {(((summary || inv) && canReports) || (canSeeExpensesSummary && expensesToday !== null)) && (
            <div className="relative z-[1] mt-6 border-t border-pf-border/80 pt-4 text-center text-xs text-pf-muted md:text-left">
              <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 md:justify-start">
                {canReports && summary ? (
                  <>
                    <span>
                      Ventas: <strong className="font-semibold text-pf-text-secondary">{formatMoney(sym, summary.total)}</strong>
                      <span className="text-pf-muted"> ({summary.count} docs)</span>
                    </span>
                    <span className="hidden sm:inline text-pf-border" aria-hidden>
                      ·
                    </span>
                  </>
                ) : null}
                {canReports && inv ? (
                  <span>
                    Inventario:{" "}
                    <strong className="font-semibold text-pf-text-secondary">{formatMoney(sym, inv.stockValueAtCost)}</strong>
                  </span>
                ) : null}
                {canReports && inv && lowCount > 0 ? (
                  <>
                    <span className="hidden sm:inline text-pf-border" aria-hidden>
                      ·
                    </span>
                    <Link to="/productos" className="text-amber-800 underline-offset-2 hover:underline">
                      Stock bajo: {lowCount} artículo{lowCount !== 1 ? "s" : ""}
                    </Link>
                  </>
                ) : null}
                {canSeeExpensesSummary && expensesToday !== null ? (
                  <>
                    <span className="hidden sm:inline text-pf-border" aria-hidden>
                      ·
                    </span>
                    <Link to="/gastos" className="text-pf-text-secondary underline-offset-2 hover:underline">
                      Gastos hoy: <strong className="font-semibold">{formatMoney(sym, expensesToday)}</strong>
                    </Link>
                  </>
                ) : null}
              </p>
            </div>
          )}
        </Card>
      ) : (
        <Card className="w-full max-w-md space-y-3 p-6 text-center">
          <p className="font-semibold text-pf-text">{fallbackName}</p>
          <p className="text-sm text-pf-muted">No se pudieron cargar los datos completos.</p>
          <Link to="/empresa" className="text-sm font-medium text-pf-primary-hover underline-offset-2 hover:underline">
            Ir a información de la empresa
          </Link>
        </Card>
      )}

      <nav
        className="mt-8 grid w-full max-w-2xl grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:justify-center sm:gap-3"
        aria-label="Accesos rápidos"
      >
        {(
          [
            {
              to: "/venta",
              label: "Nueva venta",
              icon: PlusCircle,
              className:
                "border-orange-200/60 bg-gradient-to-br from-pf-primary via-[#f0a068] to-pf-primary-hover text-pf-primary-foreground shadow-lg shadow-orange-500/25",
            },
            {
              to: "/venta/tactil",
              label: "Venta táctil",
              icon: LayoutGrid,
              className:
                "border-sky-200/50 bg-gradient-to-br from-sky-100 via-sky-50 to-cyan-100 text-sky-950 shadow-md shadow-sky-500/15",
            },
            {
              to: "/ventas",
              label: "Lista ventas",
              icon: ListOrdered,
              className:
                "border-stone-200/70 bg-gradient-to-br from-stone-100 to-stone-50 text-stone-800 shadow-md shadow-stone-900/5",
            },
            {
              to: "/productos",
              label: "Productos",
              icon: Package,
              className:
                "border-emerald-200/60 bg-gradient-to-br from-emerald-100 via-teal-50 to-emerald-50 text-emerald-950 shadow-md shadow-emerald-600/10",
            },
            {
              to: "/caja",
              label: "Caja",
              icon: Wallet,
              className:
                "border-amber-200/60 bg-gradient-to-br from-amber-100 via-yellow-50 to-orange-50 text-amber-950 shadow-md shadow-amber-500/15",
            },
          ] as const
        ).map(({ to, label, icon: Icon, className }) => (
          <Link
            key={to}
            to={to}
            className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-bold shadow-sm transition-[transform,filter] active:scale-[0.98] touch-manipulation sm:min-h-0 sm:rounded-full sm:px-5 sm:py-2.5 sm:font-semibold hover:brightness-[1.02] ${className}`}
          >
            <Icon className="h-[1.15rem] w-[1.15rem] shrink-0 opacity-95 sm:h-4 sm:w-4" strokeWidth={2} aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
