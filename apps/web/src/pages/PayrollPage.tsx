import { Lock, Plus, RefreshCw } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { Navigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Modal, Select, Textarea } from "../components/ui";
import { formatMoney } from "../lib/format";
import { hasPermission, PERMISSION_KEYS } from "../lib/permissions";
import type { EmployeeRow, PayrollPeriodDetail, PayrollPeriodListRow } from "../types";

const MONTHS = [
  [1, "Enero"],
  [2, "Febrero"],
  [3, "Marzo"],
  [4, "Abril"],
  [5, "Mayo"],
  [6, "Junio"],
  [7, "Julio"],
  [8, "Agosto"],
  [9, "Septiembre"],
  [10, "Octubre"],
  [11, "Noviembre"],
  [12, "Diciembre"],
] as const;

type DedDraft = { concept: string; amount: string };

type DraftLine = {
  employeeId: string;
  gross: string;
  deductions: string;
  net: string;
  notes: string;
  deductionItems: DedDraft[];
};

export function PayrollPage() {
  const { token, user, organization } = useAuth();
  const canView = user?.role === "admin" || hasPermission(user, PERMISSION_KEYS.PAYROLL_VIEW);
  const canManage = user?.role === "admin";
  const sym = organization?.currencySymbol ?? "L";
  const [periods, setPeriods] = useState<PayrollPeriodListRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<PayrollPeriodDetail | null>(null);
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [month, setMonth] = useState(() => String(new Date().getMonth() + 1));
  const [periodNotes, setPeriodNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { employeeId: "", gross: "", deductions: "0", net: "", notes: "", deductionItems: [] },
  ]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token || !canView) return;
    setLoading(true);
    try {
      const p = await apiFetch<PayrollPeriodListRow[]>("/api/payroll-periods", { token });
      setPeriods(p);
      if (canManage) {
        const e = await apiFetch<EmployeeRow[]>("/api/employees", { token });
        setEmployees(e.filter((x) => x.active));
      } else {
        setEmployees([]);
      }
    } catch {
      setPeriods([]);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [token, canView, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(id: string) {
    if (!token) return;
    setErr("");
    try {
      const row = await apiFetch<PayrollPeriodDetail>(`/api/payroll-periods/${id}`, { token });
      setDetail(row);
    } catch {
      setDetail(null);
    }
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { employeeId: "", gross: "", deductions: "0", net: "", notes: "", deductionItems: [] },
    ]);
  }

  function addDeductionItem(lineIndex: number) {
    setLines((prev) =>
      prev.map((l, j) =>
        j === lineIndex ? { ...l, deductionItems: [...l.deductionItems, { concept: "", amount: "" }] } : l
      )
    );
  }

  function setDeductionItem(lineIndex: number, dedIndex: number, patch: Partial<DedDraft>) {
    setLines((prev) =>
      prev.map((l, j) => {
        if (j !== lineIndex) return l;
        const next = [...l.deductionItems];
        next[dedIndex] = { ...next[dedIndex], ...patch };
        return { ...l, deductionItems: next };
      })
    );
  }

  function removeDeductionItem(lineIndex: number, dedIndex: number) {
    setLines((prev) =>
      prev.map((l, j) =>
        j === lineIndex
          ? { ...l, deductionItems: l.deductionItems.filter((_, k) => k !== dedIndex) }
          : l
      )
    );
  }

  function setLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function removeLine(i: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
  }

  async function submitCreate() {
    if (!token || !canManage) return;
    setErr("");
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
      setErr("Año o mes inválido.");
      return;
    }
    const payloadLines: {
      employeeId: string;
      gross: number;
      deductions?: number;
      net: number;
      notes?: string;
      deductionItems?: { concept: string; amount: number }[];
    }[] = [];
    for (const l of lines) {
      if (!l.employeeId) continue;
      const g = Number(l.gross);
      if (!Number.isFinite(g)) {
        setErr("Revise el bruto en cada línea.");
        return;
      }
      const items = l.deductionItems
        .map((d) => ({ concept: d.concept.trim(), amount: Number(d.amount) }))
        .filter((d) => d.concept.length > 0 && Number.isFinite(d.amount) && d.amount >= 0);
      if (l.deductionItems.length > 0) {
        if (items.length === 0) {
          setErr("Complete al menos un concepto con monto, o quite las filas de concepto y use deducción única.");
          return;
        }
      }
      if (items.length > 0) {
        const sumD = items.reduce((s, x) => s + x.amount, 0);
        const n = g - sumD;
        if (!Number.isFinite(n) || n < -0.0001) {
          setErr("Las deducciones por concepto no pueden superar el bruto.");
          return;
        }
        payloadLines.push({
          employeeId: l.employeeId,
          gross: g,
          net: n,
          deductionItems: items,
          notes: l.notes.trim() || undefined,
        });
      } else {
        const d = Number(l.deductions);
        const n = Number(l.net);
        if (!Number.isFinite(d) || !Number.isFinite(n)) {
          setErr("Revise deducciones y neto en cada línea (o use conceptos).");
          return;
        }
        payloadLines.push({
          employeeId: l.employeeId,
          gross: g,
          deductions: d,
          net: n,
          notes: l.notes.trim() || undefined,
        });
      }
    }
    if (payloadLines.length === 0) {
      setErr("Agregue al menos una línea con empleado y montos.");
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/payroll-periods", {
        method: "POST",
        body: JSON.stringify({
          year: y,
          month: m,
          notes: periodNotes.trim() || undefined,
          lines: payloadLines,
        }),
        token,
      });
      setCreateOpen(false);
      setPeriodNotes("");
      setLines([{ employeeId: "", gross: "", deductions: "0", net: "", notes: "", deductionItems: [] }]);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function closePeriod() {
    if (!token || !canManage || !detail || detail.status !== "BORRADOR") return;
    setBusy(true);
    try {
      await apiFetch(`/api/payroll-periods/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "CERRADA" }),
        token,
      });
      await openDetail(detail.id);
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
        <PageHero title={"Planillas"} constrained>
          <p className="mt-1.5 text-sm font-medium text-stone-700 max-w-xl">
            {canManage
              ? "Resumen mensual por empleado (bruto, deducciones, neto). Puede detallar deducciones por concepto (IHSS, rap, etc.) o usar un solo monto de deducciones como antes."
              : "Consulta de planillas registradas. Solo un administrador puede crear o cerrar periodos."}
          </p>
        </PageHero>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          <Button type="button" variant="secondary" className="min-h-11 w-full shadow-md sm:w-auto sm:min-h-10" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Actualizar
          </Button>
          {canManage ? (
            <Button type="button" className="min-h-11 w-full shadow-lg sm:w-auto sm:min-h-10" onClick={() => { setErr(""); setCreateOpen(true); }}>
              <Plus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              Nueva planilla
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="overflow-x-auto border-white/50 bg-gradient-to-br from-white/92 via-violet-50/15 to-fuchsia-50/15 p-0 shadow-lg backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-stone-200/80 bg-gradient-to-r from-violet-50/95 to-fuchsia-50/60 text-left text-xs font-bold text-stone-600 shadow-sm backdrop-blur-md">
              <th className="p-3">Periodo</th>
              <th className="p-3">Estado</th>
              <th className="p-3">Líneas</th>
              <th className="p-3">Registró</th>
              <th className="w-28 p-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-pf-muted">
                  Cargando…
                </td>
              </tr>
            ) : periods.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-pf-muted">
                  Sin planillas. Cree la primera con «Nueva planilla».
                </td>
              </tr>
            ) : (
              periods.map((p) => (
                <tr key={p.id} className="border-b border-stone-100/90 transition hover:bg-violet-50/30">
                  <td className="p-3 font-medium text-stone-900">
                    {MONTHS.find(([n]) => n === p.month)?.[1] ?? p.month} {p.year}
                  </td>
                  <td className="p-3">{p.status === "CERRADA" ? "Cerrada" : "Borrador"}</td>
                  <td className="p-3 tabular-nums">{p._count.lines}</td>
                  <td className="p-3 text-pf-muted">{p.user.displayName}</td>
                  <td className="p-3">
                    <Button type="button" variant="secondary" className="min-h-11 w-full sm:h-8 sm:min-h-0 sm:w-auto" onClick={() => void openDetail(p.id)}>
                      Ver
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {canManage ? (
      <Modal open={createOpen} title="Nueva planilla mensual" onClose={() => setCreateOpen(false)} wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Año">
            <Input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Mes">
            <Select value={month} onChange={(e) => setMonth(e.target.value)}>
              {MONTHS.map(([n, label]) => (
                <option key={n} value={String(n)}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notas del periodo" className="sm:col-span-2">
            <Textarea rows={2} value={periodNotes} onChange={(e) => setPeriodNotes(e.target.value)} />
          </Field>
        </div>
        <p className="text-sm text-pf-muted mt-2">
          Solo empleados activos. Una fila por empleado. Si añade al menos un concepto con monto, el neto será{" "}
          <strong>bruto − suma de conceptos</strong> (los campos Deducciones/Neto de la derecha se ignoran para esa fila).
        </p>
        <div className="mt-3 space-y-3 max-h-[50vh] overflow-y-auto pr-1">
          {lines.map((l, i) => (
            <div key={i} className="border border-pf-border rounded-lg p-3 space-y-3">
              <div className="grid gap-2 sm:grid-cols-12 items-end">
                <Field label="Empleado" className="sm:col-span-4">
                  <Select value={l.employeeId} onChange={(e) => setLine(i, { employeeId: e.target.value })}>
                    <option value="">— Elegir —</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.employeeCode ? `${e.employeeCode} · ` : ""}
                        {e.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Bruto" className="sm:col-span-2">
                  <Input inputMode="decimal" value={l.gross} onChange={(e) => setLine(i, { gross: e.target.value })} />
                </Field>
                <Field label="Deducciones (total)" className="sm:col-span-2">
                  <Input
                    inputMode="decimal"
                    value={l.deductions}
                    onChange={(e) => setLine(i, { deductions: e.target.value })}
                    disabled={l.deductionItems.length > 0}
                    title={l.deductionItems.length > 0 ? "Con filas de concepto, el total se calcula de la lista" : undefined}
                  />
                </Field>
                <Field label="Neto" className="sm:col-span-2">
                  <Input
                    inputMode="decimal"
                    value={l.net}
                    onChange={(e) => setLine(i, { net: e.target.value })}
                    disabled={l.deductionItems.length > 0}
                    title={l.deductionItems.length > 0 ? "Con filas de concepto, neto = bruto − suma conceptos" : undefined}
                  />
                </Field>
                <div className="sm:col-span-2 flex gap-1">
                  <Button type="button" variant="secondary" className="flex-1 h-9" onClick={() => removeLine(i)}>
                    Quitar fila
                  </Button>
                </div>
                <Field label="Notas línea" className="sm:col-span-12">
                  <Input value={l.notes} onChange={(e) => setLine(i, { notes: e.target.value })} placeholder="Opcional" />
                </Field>
              </div>
              <div className="rounded-md bg-stone-50 border border-pf-border/80 p-2 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-stone-700">Deducciones por concepto</span>
                  <Button type="button" variant="secondary" className="h-8 text-xs" onClick={() => addDeductionItem(i)}>
                    <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                    Añadir concepto
                  </Button>
                </div>
                {l.deductionItems.length === 0 ? (
                  <p className="text-xs text-pf-muted">Opcional. Ej.: IHSS, rap, préstamo.</p>
                ) : (
                  <ul className="space-y-2">
                    {l.deductionItems.map((d, di) => (
                      <li key={di} className="flex flex-wrap items-end gap-2">
                        <Field label="Concepto" className="min-w-[140px] flex-1">
                          <Input
                            value={d.concept}
                            onChange={(e) => setDeductionItem(i, di, { concept: e.target.value })}
                            placeholder="IHSS, rap…"
                          />
                        </Field>
                        <Field label="Monto" className="w-28">
                          <Input
                            inputMode="decimal"
                            value={d.amount}
                            onChange={(e) => setDeductionItem(i, di, { amount: e.target.value })}
                          />
                        </Field>
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-9 shrink-0"
                          onClick={() => removeDeductionItem(i, di)}
                        >
                          Quitar
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" className="mt-2" onClick={addLine}>
          <Plus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          Añadir línea
        </Button>
        {err ? <p className="text-sm text-red-600 mt-2">{err}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={() => setCreateOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void submitCreate()} disabled={busy}>
            Crear planilla
          </Button>
        </div>
      </Modal>
      ) : null}

      <Modal
        open={detail !== null}
        title={
          detail
            ? `Planilla ${MONTHS.find(([n]) => n === detail.month)?.[1] ?? detail.month} ${detail.year}`
            : "Planilla"
        }
        onClose={() => setDetail(null)}
        wide
      >
        {detail ? (
          <div className="space-y-3">
            <p className="text-sm text-pf-muted">
              Estado: <strong className="text-stone-800">{detail.status === "CERRADA" ? "Cerrada" : "Borrador"}</strong>
              {detail.notes ? (
                <>
                  {" "}
                  · {detail.notes}
                </>
              ) : null}
            </p>
            <div className="overflow-x-auto border border-pf-border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-pf-border text-left text-pf-muted">
                    <th className="p-2 font-medium">Empleado</th>
                    <th className="p-2 font-medium text-right">Bruto</th>
                    <th className="p-2 font-medium text-right">Deducc.</th>
                    <th className="p-2 font-medium text-right">Neto</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((ln) => (
                    <Fragment key={ln.id}>
                      <tr className="border-b border-pf-border/80">
                        <td className="p-2">
                          {ln.employee.name}
                          {ln.employee.employeeCode ? (
                            <span className="text-pf-muted text-xs ml-1">({ln.employee.employeeCode})</span>
                          ) : null}
                        </td>
                        <td className="p-2 text-right tabular-nums">{formatMoney(sym, ln.gross)}</td>
                        <td className="p-2 text-right tabular-nums">{formatMoney(sym, ln.deductions)}</td>
                        <td className="p-2 text-right font-medium tabular-nums">{formatMoney(sym, ln.net)}</td>
                      </tr>
                      {ln.deductionItems && ln.deductionItems.length > 0 ? (
                        <tr className="border-b border-pf-border/80 bg-stone-50/80">
                          <td colSpan={4} className="p-2 pl-6 text-xs text-pf-muted">
                            <span className="font-medium text-stone-600">Desglose: </span>
                            <ul className="mt-1 list-disc list-inside space-y-0.5">
                              {ln.deductionItems.map((di) => (
                                <li key={di.id}>
                                  {di.concept}: {formatMoney(sym, di.amount)}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-stone-50 font-medium">
                    <td className="p-2">Total neto</td>
                    <td className="p-2" colSpan={2} />
                    <td className="p-2 text-right tabular-nums">
                      {formatMoney(sym, detail.lines.reduce((s, ln) => s + ln.net, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {canManage && detail.status === "BORRADOR" ? (
              <Button type="button" onClick={() => void closePeriod()} disabled={busy}>
                <Lock className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                Cerrar planilla
              </Button>
            ) : null}
            {err ? <p className="text-sm text-red-600">{err}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
