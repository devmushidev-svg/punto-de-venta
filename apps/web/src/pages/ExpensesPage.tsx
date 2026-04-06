import { Receipt, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { Navigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { hasPermission, PERMISSION_KEYS } from "../lib/permissions";
import { Button, Card, Field, Input, Select, Textarea } from "../components/ui";
import { formatDate, formatMoney } from "../lib/format";
import type { ExpenseRow } from "../types";

const CATEGORIES = [
  { value: "Servicios públicos", label: "Servicios públicos" },
  { value: "Alquiler", label: "Alquiler" },
  { value: "Nómina", label: "Nómina" },
  { value: "Transporte / flete", label: "Transporte / flete" },
  { value: "Mantenimiento", label: "Mantenimiento" },
  { value: "Oficina / insumos", label: "Oficina / insumos" },
  { value: "Marketing", label: "Marketing" },
  { value: "Otros", label: "Otros" },
] as const;

function startEndOfTodayISO() {
  const t = new Date();
  const start = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, 0, 0, 0);
  const end = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function ExpensesPage() {
  const { token, user, organization } = useAuth();
  const canView = user?.role === "admin" || hasPermission(user, PERMISSION_KEYS.EXPENSES_VIEW);
  const canRegister = user?.role === "admin";
  const sym = organization?.currencySymbol ?? "L";
  const [list, setList] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0].value);
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!token || !canView) return;
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (from) q.set("from", new Date(from + "T00:00:00").toISOString());
      if (to) q.set("to", new Date(to + "T23:59:59").toISOString());
      if (categoryFilter.trim()) q.set("category", categoryFilter.trim());
      const qs = q.toString();
      const data = await apiFetch<ExpenseRow[]>(`/api/expenses${qs ? `?${qs}` : ""}`, { token });
      setList(data);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [token, canView, from, to, categoryFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!token || !canRegister) return;
    setErr("");
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) {
      setErr("Indique un monto válido mayor a cero.");
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/expenses", {
        method: "POST",
        body: JSON.stringify({
          category,
          amount: a,
          expenseDate: expenseDate ? new Date(expenseDate + "T12:00:00").toISOString() : undefined,
          notes: notes.trim() || undefined,
        }),
        token,
      });
      setAmount("");
      setNotes("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  if (!canView) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-4 pf-safe-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHero title={"Gastos"} constrained>
          <p className="mt-1.5 text-sm font-medium text-stone-700 max-w-xl">
            {canRegister
              ? "Registro categorizado para control operativo."
              : "Consulta de gastos registrados. Solo un administrador puede dar de alta nuevos gastos."}
          </p>
        </PageHero>
        <Button
          type="button"
          variant="secondary"
          className="min-h-[48px] w-full shrink-0 shadow-md sm:w-auto sm:min-h-[44px]"
          onClick={() => void load()}
        >
          <RefreshCw className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" strokeWidth={2} aria-hidden />
          Actualizar
        </Button>
      </div>

      {canRegister ? (
      <Card className="space-y-4 border-white/50 bg-gradient-to-br from-white/92 via-rose-50/20 to-violet-50/25 p-4 shadow-lg shadow-stone-900/[0.05] backdrop-blur-sm md:p-5">
        <div className="flex items-center gap-2 text-stone-800">
          <Receipt className="h-5 w-5 shrink-0 text-rose-600/80" strokeWidth={2} aria-hidden />
          <h2 className="text-lg font-bold text-stone-900">Registrar gasto</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Categoría">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Monto">
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Fecha">
            <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
          </Field>
          <Field label="Notas" className="sm:col-span-2 lg:col-span-4">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </Field>
        </div>
        {err ? (
          <p className="rounded-xl border border-red-100 bg-red-50/80 px-3 py-2 text-sm font-medium text-red-700">{err}</p>
        ) : null}
        <Button type="button" className="min-h-[52px] w-full text-base shadow-lg sm:w-auto" onClick={() => void submit()} disabled={busy}>
          Guardar gasto
        </Button>
      </Card>
      ) : null}

      <Card className="pf-glass-card-panel space-y-3 p-4 md:p-5">
        <h2 className="text-lg font-bold text-pf-text">Filtros del listado</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="Desde" className="min-w-[140px] flex-1 sm:flex-none">
            <Input type="date" className="min-h-11 sm:min-h-10" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Hasta" className="min-w-[140px] flex-1 sm:flex-none">
            <Input type="date" className="min-h-11 sm:min-h-10" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Categoría" className="min-w-[180px] w-full sm:w-auto">
            <Select className="min-h-11 sm:min-h-10" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">Todas</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto sm:min-h-10" onClick={() => void load()}>
            Aplicar
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full sm:w-auto sm:min-h-10"
            onClick={() => {
              const { start, end } = startEndOfTodayISO();
              setFrom(start.slice(0, 10));
              setTo(end.slice(0, 10));
            }}
          >
            Hoy
          </Button>
        </div>
      </Card>

      <Card className="overflow-x-auto border-white/50 bg-gradient-to-br from-white/92 via-rose-50/12 to-violet-50/20 p-0 shadow-lg shadow-stone-900/[0.05] backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-stone-200/80 bg-gradient-to-r from-rose-50/90 via-pf-primary-soft/40 to-violet-50/75 text-left text-xs font-bold text-stone-600 shadow-sm backdrop-blur-md">
              <th className="p-3">Fecha</th>
              <th className="p-3">Categoría</th>
              <th className="p-3 text-right">Monto</th>
              <th className="p-3">Usuario</th>
              <th className="p-3">Notas</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-pf-muted">
                  Cargando…
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-pf-muted">
                  Sin gastos en el rango.
                </td>
              </tr>
            ) : (
              list.map((r) => (
                <tr key={r.id} className="border-b border-stone-100/90 transition hover:bg-rose-50/35">
                  <td className="p-3 whitespace-nowrap">{formatDate(r.expenseDate)}</td>
                  <td className="p-3">{r.category}</td>
                  <td className="p-3 text-right font-medium tabular-nums">{formatMoney(sym, r.amount)}</td>
                  <td className="p-3 text-pf-muted">{r.user.displayName}</td>
                  <td className="p-3 text-pf-muted max-w-[220px] truncate" title={r.notes ?? ""}>
                    {r.notes ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
