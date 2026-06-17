import { FileDown, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { Navigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { hasPermission, PERMISSION_KEYS } from "../lib/permissions";
import { Button, Card, Input } from "../components/ui";
import { formatMoney } from "../lib/format";

type SalesSummary = { count: number; subtotal: number; tax: number; total: number };
type InvRow = { id: string; sku: string; name: string; stock: number; cost: number; price: number; minStock: number };
type InventoryReport = {
  products: InvRow[];
  stockValueAtCost: number;
  lowStock: InvRow[];
};
type TopRow = { productId: string; sku: string; name: string; qty: number; lineTotal: number };

type ExpensesSummary = {
  count: number;
  total: number;
  byCategory: { category: string; total: number; count: number }[];
};

type PayrollPeriodRow = {
  id: string;
  year: number;
  month: number;
  status: string;
  lineCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
};

type TabId = "ventas" | "inventario" | "top" | "gastos" | "planillas" | "ia";

type AiDiagnostic = {
  diagnostic: string;
  meta: { days: number; salesCount: number; totalRevenue: number; criticalStockCount: number; tokensUsed: number | null };
};

function toCsv(rows: Record<string, string | number>[], headers: string[]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const line = (obj: Record<string, string | number>) => headers.map((h) => esc(obj[h] ?? "")).join(",");
  return [headers.join(","), ...rows.map(line)].join("\n");
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function monthLabel(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("es-HN", { month: "long", year: "numeric" });
}

export function ReportsPage() {
  const { token, organization, user } = useAuth();
  const sym = organization?.currencySymbol ?? "L";
  const isAdmin = user?.role === "admin";
  const canExpensesTab = isAdmin || hasPermission(user, PERMISSION_KEYS.EXPENSES_VIEW);
  const canPayrollTab = isAdmin || hasPermission(user, PERMISSION_KEYS.PAYROLL_VIEW);
  const [tab, setTab] = useState<TabId>("ventas");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [salesSum, setSalesSum] = useState<SalesSummary | null>(null);
  const [inventory, setInventory] = useState<InventoryReport | null>(null);
  const [topRows, setTopRows] = useState<TopRow[]>([]);
  const [expensesSum, setExpensesSum] = useState<ExpensesSummary | null>(null);
  const [payrollRows, setPayrollRows] = useState<PayrollPeriodRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiDays, setAiDays] = useState(30);
  const [aiResult, setAiResult] = useState<AiDiagnostic | null>(null);
  const [aiErr, setAiErr] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (tab === "gastos" && !canExpensesTab) setTab("ventas");
    if (tab === "planillas" && !canPayrollTab) setTab("ventas");
  }, [canExpensesTab, canPayrollTab, tab]);

  const loadSales = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      const data = await apiFetch<SalesSummary>(`/api/reports/sales-summary${qs ? `?${qs}` : ""}`, { token });
      setSalesSum(data);
    } catch {
      setSalesSum(null);
    } finally {
      setLoading(false);
    }
  }, [token, from, to]);

  const loadInv = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<InventoryReport>("/api/reports/inventory", { token });
      setInventory(data);
    } catch {
      setInventory(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadTop = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("limit", "30");
      const qs = params.toString();
      const data = await apiFetch<{ rows: TopRow[] }>(`/api/reports/top-products?${qs}`, { token });
      setTopRows(data.rows ?? []);
    } catch {
      setTopRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, from, to]);

  const loadExpenses = useCallback(async () => {
    if (!token || !canExpensesTab) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      const data = await apiFetch<ExpensesSummary>(`/api/reports/expenses-summary${qs ? `?${qs}` : ""}`, { token });
      setExpensesSum(data);
    } catch {
      setExpensesSum(null);
    } finally {
      setLoading(false);
    }
  }, [token, from, to, canExpensesTab]);

  const loadPayroll = useCallback(async () => {
    if (!token || !canPayrollTab) return;
    setLoading(true);
    try {
      const data = await apiFetch<{ periods: PayrollPeriodRow[] }>("/api/reports/payroll-summary", { token });
      setPayrollRows(data.periods ?? []);
    } catch {
      setPayrollRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, canPayrollTab]);

  const runAiDiagnostic = useCallback(async () => {
    if (!token || !isAdmin) return;
    setAiLoading(true);
    setAiErr("");
    setAiResult(null);
    try {
      const data = await apiFetch<AiDiagnostic>("/api/ai/diagnostic", {
        method: "POST",
        body: JSON.stringify({ days: aiDays }),
        token,
      });
      setAiResult(data);
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : "Error al generar diagnóstico");
    } finally {
      setAiLoading(false);
    }
  }, [token, isAdmin, aiDays]);

  useEffect(() => {
    if (tab === "ventas") loadSales();
    if (tab === "inventario") loadInv();
    if (tab === "top") loadTop();
    if (tab === "gastos") loadExpenses();
    if (tab === "planillas") loadPayroll();
  }, [tab, loadSales, loadInv, loadTop, loadExpenses, loadPayroll]);

  function exportSalesCsv() {
    if (!salesSum) return;
    const rows = [
      { concepto: "Ventas (conteo)", valor: salesSum.count },
      { concepto: "Subtotal", valor: salesSum.subtotal },
      { concepto: "Impuesto", valor: salesSum.tax },
      { concepto: "Total", valor: salesSum.total },
    ];
    downloadText("reporte-ventas-resumen.csv", toCsv(rows, ["concepto", "valor"]), "text/csv;charset=utf-8");
  }

  function exportTopCsv() {
    const rows = topRows.map((r) => ({
      sku: r.sku,
      nombre: r.name,
      cantidad: r.qty,
      importe: r.lineTotal,
    }));
    downloadText("top-productos.csv", toCsv(rows, ["sku", "nombre", "cantidad", "importe"]), "text/csv;charset=utf-8");
  }

  function exportExpensesCsv() {
    if (!expensesSum) return;
    const rows = expensesSum.byCategory.map((r) => ({
      categoria: r.category,
      registros: r.count,
      total: r.total,
    }));
    downloadText(
      "reporte-gastos-por-categoria.csv",
      toCsv(rows, ["categoria", "registros", "total"]),
      "text/csv;charset=utf-8"
    );
  }

  function exportPayrollCsv() {
    const rows = payrollRows.map((p) => ({
      periodo: `${p.year}-${String(p.month).padStart(2, "0")}`,
      estado: p.status,
      empleados: p.lineCount,
      bruto: p.totalGross,
      deducciones: p.totalDeductions,
      neto: p.totalNet,
    }));
    downloadText("reporte-planillas-resumen.csv", toCsv(rows, ["periodo", "estado", "empleados", "bruto", "deducciones", "neto"]), "text/csv;charset=utf-8");
  }

  function exportInventoryCsv() {
    if (!inventory) return;
    const rows = inventory.products.map((p) => ({
      sku: p.sku,
      nombre: p.name,
      stock: p.stock,
      minimo: p.minStock,
      bajo_minimo: p.stock <= p.minStock ? "si" : "no",
      costo: p.cost,
      precio: p.price,
    }));
    downloadText(
      "reporte-inventario-productos.csv",
      toCsv(rows, ["sku", "nombre", "stock", "minimo", "bajo_minimo", "costo", "precio"]),
      "text/csv;charset=utf-8"
    );
  }

  if (!hasPermission(user, PERMISSION_KEYS.REPORTS_VIEW)) {
    return <Navigate to="/" replace />;
  }

  const tabs: { id: TabId; label: string; needsExpenses?: boolean; needsPayroll?: boolean }[] = [
    { id: "ventas", label: "Ventas" },
    { id: "inventario", label: "Inventario" },
    { id: "top", label: "Top productos" },
    { id: "gastos", label: "Gastos", needsExpenses: true },
    { id: "planillas", label: "Planillas (RH)", needsPayroll: true },
    ...(isAdmin ? [{ id: "ia" as const, label: "Diagnóstico IA" }] : []),
  ];

  const visibleTabs = tabs.filter((t) => {
    if (t.needsExpenses) return canExpensesTab;
    if (t.needsPayroll) return canPayrollTab;
    return true;
  });

  return (
    <div className="space-y-4 pf-safe-page">
      <div className="space-y-4">
        <PageHero title={"Reportes"}>
          <p className="pf-page-lead max-w-2xl">
            Qué es: números consolidados para revisar ventas, existencias, productos más vendidos
            {canExpensesTab || canPayrollTab ? ", gastos y planillas (según permisos)" : ""}. Use fechas donde aplique y exporte CSV para Excel si
            lo necesita.
          </p>
          <p className="pf-page-lead-muted max-w-2xl">
            Los datos respetan su organización y el permiso <strong className="font-medium text-pf-text-secondary">reportes</strong>
            {canExpensesTab || canPayrollTab ? "; gastos/planillas pueden requerir permisos adicionales." : "."}
          </p>
        </PageHero>
        <nav
          className="pf-card-surface flex flex-wrap gap-2 p-2"
          aria-label="Tipo de reporte"
        >
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`min-h-[44px] touch-manipulation rounded-xl px-4 py-2.5 text-sm font-bold transition sm:min-h-0 sm:py-2 ${
                tab === t.id
                  ? "bg-gradient-to-r from-pf-primary-hover to-[color:var(--pf-nav-pill-warm-to)] text-[color:var(--pf-text-on-brand)] shadow-[var(--pf-shadow-btn-primary)]"
                  : "text-pf-text-soft hover:bg-[color:var(--pf-surface-overlay)] hover:text-pf-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {(tab === "ventas" || tab === "top" || tab === "gastos") && (
        <Card className="flex flex-wrap items-end gap-3 p-3">
          <label className="min-w-[140px] flex-1 text-xs font-bold text-pf-text-soft sm:flex-none">
            Desde
            <Input type="date" className="mt-1 min-h-11 sm:min-h-10" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="min-w-[140px] flex-1 text-xs font-bold text-pf-text-soft sm:flex-none">
            Hasta
            <Input type="date" className="mt-1 min-h-11 sm:min-h-10" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full shadow-sm sm:w-auto sm:min-h-10"
            onClick={() => {
              if (tab === "ventas") loadSales();
              if (tab === "top") loadTop();
              if (tab === "gastos") loadExpenses();
            }}
          >
            <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Actualizar
          </Button>
        </Card>
      )}

      {tab === "inventario" ? (
        <Card className="flex flex-wrap items-stretch justify-end gap-2 p-3 sm:items-center">
          <Button type="button" variant="secondary" className="min-h-11 flex-1 sm:flex-none sm:min-h-10" onClick={() => loadInv()}>
            <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Actualizar inventario
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 flex-1 sm:flex-none sm:min-h-10"
            onClick={exportInventoryCsv}
            disabled={!inventory?.products.length}
          >
            <FileDown className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            CSV inventario (todos)
          </Button>
        </Card>
      ) : null}

      {tab === "planillas" && canPayrollTab ? (
        <Card className="flex flex-wrap items-stretch justify-end gap-2 p-3 sm:items-center">
          <Button type="button" variant="secondary" className="min-h-11 flex-1 sm:flex-none sm:min-h-10" onClick={() => loadPayroll()}>
            <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Actualizar planillas
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 flex-1 sm:flex-none sm:min-h-10"
            onClick={exportPayrollCsv}
            disabled={payrollRows.length === 0}
          >
            <FileDown className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            CSV resumen
          </Button>
        </Card>
      ) : null}

      {tab === "ia" && isAdmin ? (
        <Card className="flex flex-wrap items-end gap-3 p-3">
          <label className="min-w-[140px] flex-1 text-xs font-bold text-pf-text-soft sm:flex-none">
            Período (días)
            <Input
              type="number"
              min={1}
              max={365}
              className="mt-1 min-h-11 sm:min-h-10"
              value={aiDays}
              onChange={(e) => setAiDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))}
            />
          </label>
          <Button
            type="button"
            variant="primary"
            className="min-h-11 w-full shadow-sm sm:w-auto sm:min-h-10"
            onClick={() => runAiDiagnostic()}
            disabled={aiLoading}
          >
            <Sparkles className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            {aiLoading ? "Analizando…" : "Generar diagnóstico"}
          </Button>
        </Card>
      ) : null}

      {loading ? (
        <p className="pf-card-surface px-4 py-4 text-center font-medium text-pf-muted">
          Cargando…
        </p>
      ) : null}

      {tab === "ventas" && salesSum ? (
        <Card className="max-w-md space-y-3 p-5">
          <p className="text-sm font-medium text-pf-text-soft">Resumen en el rango seleccionado (todas las ventas)</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-pf-text-soft">Tickets / ventas</span>
              <strong className="tabular-nums text-pf-text">{salesSum.count}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-pf-text-soft">Subtotal</span>
              <span className="tabular-nums">{formatMoney(sym, salesSum.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-pf-text-soft">Impuesto</span>
              <span className="tabular-nums">{formatMoney(sym, salesSum.tax)}</span>
            </div>
            <div className="flex justify-between border-t border-[var(--pf-border-soft)] pt-2 text-lg font-extrabold text-pf-text">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(sym, salesSum.total)}</span>
            </div>
          </div>
          <Button type="button" variant="secondary" className="min-h-[48px] w-full shadow-md" onClick={exportSalesCsv}>
            <FileDown className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Descargar CSV (resumen)
          </Button>
        </Card>
      ) : null}

      {tab === "inventario" && inventory ? (
        <div className="space-y-4">
          <Card className="p-4">
            <p className="text-sm font-semibold text-pf-text-soft">Valor inventario a costo</p>
            <p className="text-2xl font-extrabold tabular-nums text-pf-text">{formatMoney(sym, inventory.stockValueAtCost)}</p>
            <p className="mt-2 text-sm font-bold text-pf-warning">
              Artículos bajo mínimo: {inventory.lowStock.length}
            </p>
          </Card>
          <Card className="pf-table-shell overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="pf-table-thead text-left text-xs">
                  <th className="p-2">SKU</th>
                  <th className="p-2">Nombre</th>
                  <th className="p-2 text-right">Stock</th>
                  <th className="p-2 text-right">Costo</th>
                  <th className="p-2 text-right">Precio</th>
                </tr>
              </thead>
              <tbody className="pf-table-body">
                {inventory.products.slice(0, 200).map((p) => (
                  <tr key={p.id} className="pf-table-row pf-table-row-hoverable">
                    <td className="p-2 font-mono text-xs">{p.sku}</td>
                    <td className="p-2">{p.name}</td>
                    <td className="p-2 text-right">{p.stock}</td>
                    <td className="p-2 text-right">{formatMoney(sym, p.cost)}</td>
                    <td className="p-2 text-right">{formatMoney(sym, p.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      ) : null}

      {tab === "top" ? (
        <Card className="pf-table-shell overflow-x-auto p-0">
          <div className="flex justify-end border-b border-[var(--pf-border-soft)] bg-[color:var(--pf-surface-overlay)] p-3 backdrop-blur-sm">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 w-full shadow-sm sm:w-auto sm:min-h-10"
              onClick={exportTopCsv}
              disabled={topRows.length === 0}
            >
              <FileDown className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              Exportar CSV
            </Button>
          </div>
          <table className="w-full min-w-[520px] text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="pf-table-thead text-left text-xs">
                <th className="p-2">SKU</th>
                <th className="p-2">Producto</th>
                <th className="p-2 text-right">Cant. vendida</th>
                <th className="p-2 text-right">Importe líneas</th>
              </tr>
            </thead>
            <tbody className="pf-table-body">
              {topRows.map((r) => (
                <tr key={r.productId} className="pf-table-row pf-table-row-hoverable">
                  <td className="p-2 font-mono text-xs">{r.sku}</td>
                  <td className="p-2">{r.name}</td>
                  <td className="p-2 text-right">{r.qty}</td>
                  <td className="p-2 text-right font-medium">{formatMoney(sym, r.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && topRows.length === 0 ? (
            <p className="p-6 text-center font-medium text-pf-muted">Sin datos en el rango</p>
          ) : null}
        </Card>
      ) : null}

      {tab === "gastos" && canExpensesTab && expensesSum ? (
        <div className="space-y-4">
          <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-pf-text-soft">Total gastos registrados (rango)</p>
              <p className="text-2xl font-extrabold tabular-nums text-pf-text">{formatMoney(sym, expensesSum.total)}</p>
              <p className="mt-1 text-xs font-medium text-pf-muted">{expensesSum.count} movimientos</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 w-full shadow-md sm:w-auto sm:min-h-10"
              onClick={exportExpensesCsv}
              disabled={expensesSum.byCategory.length === 0}
            >
              <FileDown className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              CSV por categoría
            </Button>
          </Card>
          <Card className="pf-table-shell overflow-x-auto p-0">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="pf-table-thead text-left text-xs">
                  <th className="p-2">Categoría</th>
                  <th className="p-2 text-right">Registros</th>
                  <th className="p-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="pf-table-body">
                {expensesSum.byCategory.map((r) => (
                  <tr key={r.category} className="pf-table-row pf-table-row-hoverable">
                    <td className="p-2 font-medium">{r.category}</td>
                    <td className="p-2 text-right">{r.count}</td>
                    <td className="p-2 text-right">{formatMoney(sym, r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && expensesSum.byCategory.length === 0 ? (
              <p className="p-6 text-center font-medium text-pf-muted">Sin gastos en el rango</p>
            ) : null}
          </Card>
        </div>
      ) : null}

      {tab === "planillas" && canPayrollTab ? (
        <Card className="pf-table-shell overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="pf-table-thead text-left text-xs">
                <th className="p-2">Periodo</th>
                <th className="p-2">Estado</th>
                <th className="p-2 text-right">Empleados</th>
                <th className="p-2 text-right">Bruto</th>
                <th className="p-2 text-right">Deducciones</th>
                <th className="p-2 text-right">Neto</th>
              </tr>
            </thead>
            <tbody className="pf-table-body">
              {payrollRows.map((p) => (
                <tr key={p.id} className="pf-table-row pf-table-row-hoverable">
                  <td className="p-2 capitalize">{monthLabel(p.year, p.month)}</td>
                  <td className="p-2">{p.status}</td>
                  <td className="p-2 text-right">{p.lineCount}</td>
                  <td className="p-2 text-right">{formatMoney(sym, p.totalGross)}</td>
                  <td className="p-2 text-right">{formatMoney(sym, p.totalDeductions)}</td>
                  <td className="p-2 text-right font-medium">{formatMoney(sym, p.totalNet)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && payrollRows.length === 0 ? (
            <p className="p-6 text-center font-medium text-pf-muted">Sin planillas registradas</p>
          ) : null}
        </Card>
      ) : null}

      {tab === "ia" && isAdmin ? (
        <div className="space-y-4">
          {aiErr ? (
            <Card className="border-pf-danger-soft bg-pf-danger-soft/30 p-4 text-sm text-pf-danger">
              {aiErr}
            </Card>
          ) : null}
          {aiResult ? (
            <Card className="space-y-4 p-5">
              <div className="flex flex-wrap gap-3 text-xs text-pf-muted">
                <span>{aiResult.meta.salesCount} ventas</span>
                <span>·</span>
                <span>Ingresos: {formatMoney(sym, aiResult.meta.totalRevenue)}</span>
                <span>·</span>
                <span>{aiResult.meta.criticalStockCount} productos en stock crítico</span>
                {aiResult.meta.tokensUsed != null ? (
                  <>
                    <span>·</span>
                    <span>{aiResult.meta.tokensUsed} tokens</span>
                  </>
                ) : null}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-pf-text">{aiResult.diagnostic}</div>
            </Card>
          ) : !aiLoading && !aiErr ? (
            <Card className="p-6 text-center text-sm text-pf-muted">
              Pulse &quot;Generar diagnóstico&quot; para analizar ventas e inventario con IA.
              Requiere <code className="rounded bg-pf-surface-overlay px-1">OPENAI_API_KEY</code> en el servidor.
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
