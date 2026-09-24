import { AlertTriangle, Coins, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Modal } from "../components/ui";
import { formatDate, formatMoney } from "../lib/format";
import { hasPermission, PERMISSION_KEYS } from "../lib/permissions";
import type { Customer } from "../types";

type Row = {
  saleId: string;
  invoiceNumber: string | null;
  customer: Customer | null;
  total: number;
  surchargesTotal: number;
  paid: number;
  balance: number;
  saleDate: string;
  dueDate: string | null;
};

type CashSessionStatus = { id: string } | null;

const DAY_MS = 86_400_000;

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Dias de atraso: positivo = vencida, negativo = aun por vencer, null = sin fecha. */
function daysOverdue(dueDate: string | null): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  due.setHours(0, 0, 0, 0);
  return Math.round((startOfToday() - due.getTime()) / DAY_MS);
}

function dueLabel(days: number | null): { text: string; tone: "danger" | "warning" | "neutral" } {
  if (days === null) return { text: "Sin fecha de pago", tone: "neutral" };
  if (days > 0) return { text: `Vencida hace ${days} ${days === 1 ? "día" : "días"}`, tone: "danger" };
  if (days === 0) return { text: "Vence hoy", tone: "warning" };
  const left = -days;
  if (left <= 7) return { text: `Vence en ${left} ${left === 1 ? "día" : "días"}`, tone: "warning" };
  return { text: `Vence en ${left} días`, tone: "neutral" };
}

export function AccountsReceivablePage() {
  const { token, user, organization } = useAuth();
  const navigate = useNavigate();
  const sym = organization?.currencySymbol ?? "L";
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [cashSessionChecked, setCashSessionChecked] = useState(false);
  const [cashSessionOpen, setCashSessionOpen] = useState(false);

  const [payFor, setPayFor] = useState<Row | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [surOpen, setSurOpen] = useState(false);
  const [surAmount, setSurAmount] = useState("");
  const [surNote, setSurNote] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<Row[]>("/api/accounts/receivable", { token });
      setRows(data);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const refreshCashSession = useCallback(async () => {
    if (!token) return;
    setCashSessionChecked(false);
    try {
      const session = await apiFetch<CashSessionStatus>("/api/cash-sessions/current", { token });
      setCashSessionOpen(Boolean(session));
    } catch {
      setCashSessionOpen(false);
    } finally {
      setCashSessionChecked(true);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    void refreshCashSession();
  }, [refreshCashSession]);

  const cashRequiredBlocked = cashSessionChecked && !cashSessionOpen;
  const cashRequiredLoading = !cashSessionChecked;

  /** Lo primero que se cobra es lo mas atrasado. */
  const sorted = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = term
      ? rows.filter(
          (r) =>
            (r.customer?.name ?? "").toLowerCase().includes(term) ||
            (r.invoiceNumber ?? "").toLowerCase().includes(term),
        )
      : rows;
    return [...filtered].sort((a, b) => {
      const da = daysOverdue(a.dueDate);
      const db = daysOverdue(b.dueDate);
      if (da === null && db === null) return b.balance - a.balance;
      if (da === null) return 1;
      if (db === null) return -1;
      return db - da;
    });
  }, [rows, q]);

  const totals = useMemo(() => {
    let owed = 0;
    let overdue = 0;
    let overdueCount = 0;
    for (const r of rows) {
      owed += r.balance;
      const d = daysOverdue(r.dueDate);
      if (d !== null && d > 0) {
        overdue += r.balance;
        overdueCount += 1;
      }
    }
    return { owed, overdue, overdueCount };
  }, [rows]);

  function openPay(row: Row) {
    if (cashRequiredLoading || cashRequiredBlocked) {
      setErr("Abra una caja antes de registrar abonos.");
      return;
    }
    setPayFor(row);
    setPayAmount("");
    setSurOpen(false);
    setSurAmount("");
    setSurNote("");
    setErr("");
  }

  async function pay() {
    if (!token || !payFor) return;
    if (cashRequiredLoading || cashRequiredBlocked) {
      setErr("Abra una caja antes de registrar abonos.");
      return;
    }
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      setErr("Indique un monto válido.");
      return;
    }
    setErr("");
    setBusy("pay");
    try {
      await apiFetch(`/api/accounts/receivable/${payFor.saleId}/pay`, {
        method: "POST",
        body: JSON.stringify({ amount }),
        token,
      });
      setPayFor(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo registrar el abono.");
    } finally {
      setBusy(null);
    }
  }

  async function surcharge() {
    if (!token || !payFor) return;
    const amount = Number(surAmount);
    if (!amount || amount <= 0) {
      setErr("Indique un monto de recargo válido.");
      return;
    }
    setErr("");
    setBusy("sur");
    try {
      await apiFetch(`/api/accounts/receivable/${payFor.saleId}/surcharge`, {
        method: "POST",
        body: JSON.stringify({ amount, note: surNote.trim() || undefined }),
        token,
      });
      setPayFor(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo registrar el recargo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-[72rem] space-y-4 pf-safe-page">
      {/* Lo que la pantalla responde de un vistazo: cuanto le deben y cuanto esta atrasado. */}
      <section className="flex flex-wrap items-end gap-x-10 gap-y-4 border-b border-pf-border pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Le deben</p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-pf-text">
            {formatMoney(sym, totals.owed)}
          </p>
          <p className="mt-0.5 text-xs text-pf-text-tertiary">
            {rows.length} {rows.length === 1 ? "factura pendiente" : "facturas pendientes"}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Vencido</p>
          <p
            className={`mt-1 text-2xl font-bold tabular-nums tracking-tight ${
              totals.overdue > 0 ? "text-pf-danger" : "text-pf-text-tertiary"
            }`}
          >
            {formatMoney(sym, totals.overdue)}
          </p>
          <p className="mt-0.5 text-xs text-pf-text-tertiary">
            {totals.overdueCount === 0
              ? "Nada atrasado"
              : `${totals.overdueCount} ${totals.overdueCount === 1 ? "factura atrasada" : "facturas atrasadas"}`}
          </p>
        </div>
        {hasPermission(user, PERMISSION_KEYS.ACCOUNTS_PAYABLE) ? (
          <Link
            to="/cxp"
            className="ml-auto self-center text-sm font-semibold text-pf-primary-hover underline-offset-2 hover:underline"
          >
            Ver cuentas por pagar
          </Link>
        ) : null}
      </section>

      <Card className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pf-muted"
              strokeWidth={2}
              aria-hidden
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar cliente o N° de factura…"
              aria-label="Buscar cliente o factura"
              className="!pl-9"
            />
          </div>
        </div>
      </Card>

      {cashRequiredLoading || cashRequiredBlocked ? (
        <Card className="space-y-3 border-pf-warning/40 bg-pf-warning-soft/40 p-4">
          <div>
            <p className="font-semibold text-pf-text">
              {cashRequiredLoading ? "Verificando caja abierta…" : "Caja requerida para registrar abonos"}
            </p>
            <p className="mt-1 text-sm text-pf-text-secondary">
              {cashRequiredLoading
                ? "Estamos revisando si hay una caja abierta antes de permitir cobros."
                : "Todo abono de cliente mueve dinero, por eso debe quedar en una caja abierta."}
            </p>
          </div>
          {cashRequiredBlocked ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => navigate("/caja")}>
                Abrir caja
              </Button>
              <Button type="button" variant="secondary" onClick={() => void refreshCashSession()}>
                Ya abrí caja, verificar
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        {loading ? (
          <p className="p-8 text-center text-sm text-pf-muted">Cargando…</p>
        ) : sorted.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium text-pf-text">
              {rows.length === 0 ? "Nadie le debe nada" : "Ninguna factura coincide con la búsqueda"}
            </p>
            <p className="mt-1 text-sm text-pf-text-tertiary">
              {rows.length === 0
                ? "Las ventas a crédito aparecerán aquí hasta que se salden."
                : "Pruebe con otro nombre o número."}
            </p>
          </div>
        ) : (
          <>
          <div
            className="divide-y divide-pf-border sm:hidden"
            role="list"
            aria-label="Facturas por cobrar"
          >
            {sorted.map((r) => {
              const days = daysOverdue(r.dueDate);
              const due = dueLabel(days);
              return (
                <article key={r.saleId} className="space-y-3 px-4 py-4" role="listitem">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-pf-text">
                        {r.customer?.name ?? "Sin cliente"}
                      </p>
                      <p className="mt-1 font-mono text-xs text-pf-text-tertiary">
                        Factura {r.invoiceNumber ?? r.saleId.slice(0, 8)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-pf-muted">
                        Saldo
                      </p>
                      <p className="mt-0.5 text-lg font-bold tabular-nums text-pf-text">
                        {formatMoney(sym, r.balance)}
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-start gap-2 text-sm font-medium ${
                      due.tone === "danger"
                        ? "text-pf-danger"
                        : due.tone === "warning"
                          ? "text-pf-warning"
                          : "text-pf-text-tertiary"
                    }`}
                  >
                    {due.tone === "danger" ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    ) : null}
                    <div className="min-w-0">
                      <p>{due.text}</p>
                      {r.dueDate ? (
                        <p className="mt-0.5 text-xs text-pf-text-tertiary">
                          Fecha de pago: {formatDate(r.dueDate)}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-12 w-full"
                    disabled={cashRequiredLoading || cashRequiredBlocked}
                    onClick={() => openPay(r)}
                  >
                    <Coins className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    Registrar abono
                  </Button>
                </article>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[720px] text-sm">
              <caption className="sr-only">Facturas con saldo pendiente, las más atrasadas primero</caption>
              <thead>
                <tr className="border-b border-pf-border text-left text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Factura</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Cliente</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Vencimiento</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Saldo</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const days = daysOverdue(r.dueDate);
                  const due = dueLabel(days);
                  return (
                    <tr key={r.saleId} className="border-b border-pf-border last:border-0 hover:bg-pf-surface">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-pf-text-tertiary">
                        {r.invoiceNumber ?? r.saleId.slice(0, 8)}
                      </td>
                      <td className="max-w-0 truncate px-4 py-3 font-medium text-pf-text">
                        {r.customer?.name ?? "Sin cliente"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 font-medium ${
                            due.tone === "danger"
                              ? "text-pf-danger"
                              : due.tone === "warning"
                                ? "text-pf-warning"
                                : "text-pf-text-tertiary"
                          }`}
                        >
                          {due.tone === "danger" ? (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                          ) : null}
                          {due.text}
                        </span>
                        {r.dueDate ? (
                          <span className="ml-1 text-xs text-pf-muted">· {formatDate(r.dueDate)}</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-base font-bold tabular-nums text-pf-text">
                        {formatMoney(sym, r.balance)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Button
                          type="button"
                          variant="secondary"
                          className="min-h-9"
                          disabled={cashRequiredLoading || cashRequiredBlocked}
                          onClick={() => openPay(r)}
                        >
                          <Coins className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                          Abonar
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      <Modal
        open={payFor != null}
        title={payFor ? `Cobrar a ${payFor.customer?.name ?? "cliente"}` : "Cobrar"}
        onClose={() => {
          if (!busy) setPayFor(null);
        }}
        maxWidthClass="sm:max-w-md"
      >
        {payFor ? (
          <div className="space-y-4">
            {/* El desglose vive aqui, donde importa, y no en 4 columnas de la lista. */}
            <div className="rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface p-3 text-sm">
              <div className="flex justify-between text-pf-text-tertiary">
                <span>Total de la factura</span>
                <span className="tabular-nums">{formatMoney(sym, payFor.total)}</span>
              </div>
              {payFor.surchargesTotal > 0 ? (
                <div className="mt-1 flex justify-between text-pf-text-tertiary">
                  <span>Recargos</span>
                  <span className="tabular-nums">{formatMoney(sym, payFor.surchargesTotal)}</span>
                </div>
              ) : null}
              <div className="mt-1 flex justify-between text-pf-text-tertiary">
                <span>Ya pagó</span>
                <span className="tabular-nums">{formatMoney(sym, payFor.paid)}</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between border-t border-pf-border pt-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Debe</span>
                <span className="text-xl font-bold tabular-nums text-pf-text">
                  {formatMoney(sym, payFor.balance)}
                </span>
              </div>
            </div>

            <Field label="Monto del abono">
              <Input
                type="number"
                step="any"
                min={0}
                autoFocus
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="0.00"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) {
                    e.preventDefault();
                    void pay();
                  }
                }}
              />
            </Field>
            <button
              type="button"
              className="text-sm font-semibold text-pf-primary-hover underline-offset-2 hover:underline"
              onClick={() => setPayAmount(String(payFor.balance))}
            >
              Abonar el saldo completo ({formatMoney(sym, payFor.balance)})
            </button>

            <p className="text-xs text-pf-text-tertiary">
              El abono quedará registrado en la caja abierta.
            </p>

            {err ? (
              <p className="rounded-[var(--radius-pf)] border border-pf-danger-soft bg-pf-danger-soft px-3 py-2 text-sm font-medium text-pf-danger">
                {err}
              </p>
            ) : null}

            <Button
              type="button"
              className="min-h-12 w-full"
              disabled={busy != null || cashRequiredLoading || cashRequiredBlocked}
              onClick={() => void pay()}
            >
              <Coins className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {busy === "pay" ? "Registrando…" : "Registrar abono"}
            </Button>

            <div className="border-t border-pf-border pt-3">
              {surOpen ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-pf-text">Agregar un recargo</p>
                  <p className="text-xs text-pf-text-tertiary">
                    Aumenta lo que el cliente debe, por ejemplo por intereses de mora.
                  </p>
                  <Field label="Monto del recargo">
                    <Input
                      type="number"
                      step="any"
                      min={0}
                      value={surAmount}
                      onChange={(e) => setSurAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </Field>
                  <Field label="Motivo (opcional)">
                    <Input
                      value={surNote}
                      onChange={(e) => setSurNote(e.target.value)}
                      placeholder="Ej. interés por mora"
                    />
                  </Field>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" disabled={busy != null} onClick={() => setSurOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="button" variant="secondary" disabled={busy != null} onClick={() => void surcharge()}>
                      {busy === "sur" ? "Guardando…" : "Agregar recargo"}
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="flex min-h-9 items-center gap-1.5 text-sm font-semibold text-pf-text-tertiary hover:text-pf-text"
                  onClick={() => setSurOpen(true)}
                >
                  <Plus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                  Agregar un recargo
                </button>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
