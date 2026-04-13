import { DoorClosed, DoorOpen } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { hasPermission, PERMISSION_KEYS } from "../lib/permissions";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Field, Input, Select } from "../components/ui";
import { formatDate, formatMoney, formatTimeOnly } from "../lib/format";

type Session = {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  closingCash: number | null;
  expectedCash: number | null;
  notes: string | null;
};

type DiarySale = {
  id: string;
  total: number;
  paid: number;
  terms: string;
  saleDate: string;
  invoiceNumber: string | null;
};

type DiaryMovement = {
  id: string;
  category: string;
  amount: number;
  hasVoucher: boolean;
  note: string | null;
  createdAt: string;
};

type Diary = {
  session: Session | null;
  saleCount: number;
  contadoTotal: number;
  tarjetaTotal: number;
  efectivoVentasTotal: number;
  creditoTotal: number;
  creditoCobrado: number;
  creditoPendiente: number;
  ventasTotal: number;
  gastosSesion: number;
  movementNet: number;
  movements: DiaryMovement[];
  efectivoCajaSugerido: number;
  cashDifference: number | null;
  sales: DiarySale[];
};

const EMPTY_DIARY: Diary = {
  session: null,
  saleCount: 0,
  contadoTotal: 0,
  tarjetaTotal: 0,
  efectivoVentasTotal: 0,
  creditoTotal: 0,
  creditoCobrado: 0,
  creditoPendiente: 0,
  ventasTotal: 0,
  gastosSesion: 0,
  movementNet: 0,
  movements: [],
  efectivoCajaSugerido: 0,
  cashDifference: null,
  sales: [],
};

const MOVEMENT_CATEGORIES = [
  { value: "GASTO", label: "Gasto" },
  { value: "INGRESO", label: "Ingreso" },
  { value: "PAGO_ABONO", label: "Pago / abono" },
  { value: "RETIRO", label: "Retiro" },
  { value: "AJUSTE_TARJETA", label: "Ajuste tarjeta" },
] as const;

type AdminSummaryRow = {
  sessionId: string;
  user: { id: string; displayName: string; username: string };
  openedAt: string;
  closedAt: string | null;
  ventasTotal: number;
  efectivoCajaSugerido: number;
  saleCount: number;
};

function DiaryTopField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-pf-border bg-white px-3 py-2.5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-pf-muted">{label}</p>
      <div className="mt-1 text-sm font-semibold text-pf-text">{value}</div>
    </div>
  );
}

function DiaryMetric({
  label,
  value,
  help,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  help?: string;
  tone?: "default" | "warn" | "danger" | "strong";
}) {
  const toneClass =
    tone === "warn"
      ? "border-amber-200 bg-amber-50/70"
      : tone === "danger"
        ? "border-red-200 bg-red-50/70"
        : tone === "strong"
          ? "border-pf-primary/35 bg-pf-primary-soft/35"
          : "border-pf-border bg-white";
  return (
    <div className={`rounded-xl border px-3 py-3 shadow-sm ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-pf-muted">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-pf-text">{value}</p>
      {help ? <p className="mt-1 text-xs text-pf-text-tertiary">{help}</p> : null}
    </div>
  );
}

function DiarySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-pf-border bg-white p-4 shadow-[var(--pf-shadow-card)]">
      <h2 className="text-sm font-bold uppercase tracking-wide text-pf-text">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function CashPage() {
  const { token, user, organization } = useAuth();
  const canCxc = hasPermission(user, PERMISSION_KEYS.ACCOUNTS_RECEIVABLE);
  const canCxp = hasPermission(user, PERMISSION_KEYS.ACCOUNTS_PAYABLE);
  const canGastosLink = user?.role === "admin" || hasPermission(user, PERMISSION_KEYS.EXPENSES_VIEW);
  const sym = organization?.currencySymbol ?? "L";
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [opening, setOpening] = useState("0");
  const [closing, setClosing] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [diary, setDiary] = useState<Diary | null>(null);
  const isAdmin = user?.role === "admin";
  const [viewDate, setViewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [viewUserId, setViewUserId] = useState("");
  const [orgUsers, setOrgUsers] = useState<{ id: string; displayName: string; username: string }[]>([]);
  const [adminSummary, setAdminSummary] = useState<{
    date: string;
    sessions: AdminSummaryRow[];
    totals: { ventasTotal: number; efectivoCajaSugerido: number };
  } | null>(null);
  const [movCategory, setMovCategory] = useState<string>(MOVEMENT_CATEGORIES[0].value);
  const [movAmount, setMovAmount] = useState("");
  const [movNote, setMovNote] = useState("");
  const [movVoucher, setMovVoucher] = useState(false);
  const [movBusy, setMovBusy] = useState(false);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const viewingSelf =
    (viewUserId === "" || viewUserId === user?.id) && viewDate === todayStr;

  const todayLabel = useMemo(() => {
    const d = new Date(viewDate + "T12:00:00");
    return d.toLocaleDateString("es-HN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }, [viewDate]);

  function shiftViewDate(delta: number) {
    const d = new Date(viewDate + "T12:00:00");
    d.setDate(d.getDate() + delta);
    setViewDate(d.toISOString().slice(0, 10));
  }

  function refresh() {
    if (!token) return;
    apiFetch<Session | null>("/api/cash-sessions/current", { token })
      .then((s) => setSession(s))
      .catch(() => setSession(null));
    const qs = new URLSearchParams();
    qs.set("date", viewDate);
    if (viewUserId.trim()) qs.set("userId", viewUserId.trim());
    apiFetch<Diary>(`/api/cash-diary?${qs.toString()}`, { token })
      .then(setDiary)
      .catch(() => setDiary(EMPTY_DIARY));
    if (isAdmin) {
      apiFetch<{
        date: string;
        sessions: AdminSummaryRow[];
        totals: { ventasTotal: number; efectivoCajaSugerido: number };
      }>(`/api/cash-diary/admin-summary?date=${encodeURIComponent(viewDate)}`, { token })
        .then(setAdminSummary)
        .catch(() => setAdminSummary(null));
    } else {
      setAdminSummary(null);
    }
  }

  useEffect(() => {
    if (!token || !isAdmin) return;
    apiFetch<{ id: string; displayName: string; username: string }[]>("/api/users", { token })
      .then(setOrgUsers)
      .catch(() => setOrgUsers([]));
  }, [token, isAdmin]);

  useEffect(() => {
    refresh();
  }, [token, viewDate, viewUserId, isAdmin]);

  async function openSession() {
    if (!token) return;
    setErr("");
    setBusy(true);
    try {
      await apiFetch("/api/cash-sessions/open", {
        method: "POST",
        body: JSON.stringify({ openingCash: Number(opening) || 0 }),
        token,
      });
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function closeSession() {
    if (!token || !session?.id) return;
    setErr("");
    setBusy(true);
    try {
      await apiFetch(`/api/cash-sessions/${session.id}/close`, {
        method: "POST",
        body: JSON.stringify({
          closingCash: closing === "" ? undefined : Number(closing),
          notes: notes || undefined,
        }),
        token,
      });
      setClosing("");
      setNotes("");
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function addCashMovement() {
    if (!token || !session?.id) return;
    const amount = Number(movAmount);
    if (!amount || amount <= 0) {
      setErr("Indique un monto válido para el movimiento.");
      return;
    }
    setErr("");
    setMovBusy(true);
    try {
      await apiFetch("/api/cash-movements", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.id,
          category: movCategory,
          amount,
          hasVoucher: movVoucher,
          note: movNote.trim() || undefined,
        }),
        token,
      });
      setMovAmount("");
      setMovNote("");
      setMovVoucher(false);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setMovBusy(false);
    }
  }

  if (session === undefined || diary === null) {
    return (
      <p className="rounded-2xl border border-white/50 bg-white/60 px-4 py-6 text-center font-medium text-pf-muted backdrop-blur-sm">
        Cargando caja…
      </p>
    );
  }

  const closingValue = closing === "" ? null : Number(closing);
  const closingDifference =
    closingValue !== null && Number.isFinite(closingValue) ? closingValue - diary.efectivoCajaSugerido : null;
  const sessionStatus = session ? "Turno abierto" : "Sin turno abierto";
  const sessionStatusTone =
    closingDifference === null ? "text-pf-text" : closingDifference === 0 ? "text-pf-success" : closingDifference > 0 ? "text-pf-info" : "text-pf-danger";

  return (
    <div className="max-w-6xl space-y-4 pf-safe-page">
      <DiarySection title="Caja y Diario Digital">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1.5">
              <p className="text-3xl font-extrabold tracking-tight text-pf-text">Caja y diario digital</p>
              <p className="max-w-3xl text-sm text-pf-text-secondary">
                Administre el turno de caja: abra con un fondo inicial, venda normalmente, registre gastos y cierre comparando
                efectivo esperado contra efectivo contado.
              </p>
            </div>
            {(canCxc || canCxp || canGastosLink) && (
              <div className="flex flex-wrap gap-2">
                {canCxc ? (
                  <Link to="/cxc" className="rounded-lg border border-pf-border bg-pf-surface-soft px-3 py-2 text-xs font-semibold text-pf-text hover:bg-pf-surface-muted">
                    Pagos clientes
                  </Link>
                ) : null}
                {canCxp ? (
                  <Link to="/cxp" className="rounded-lg border border-pf-border bg-pf-surface-soft px-3 py-2 text-xs font-semibold text-pf-text hover:bg-pf-surface-muted">
                    Pagos proveedores
                  </Link>
                ) : null}
                {canGastosLink ? (
                  <Link to="/gastos" className="rounded-lg border border-pf-border bg-pf-surface-soft px-3 py-2 text-xs font-semibold text-pf-text hover:bg-pf-surface-muted">
                    Gastos
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={refresh}
                  className="rounded-lg border border-pf-border bg-pf-surface-soft px-3 py-2 text-xs font-semibold text-pf-text hover:bg-pf-surface-muted"
                >
                  Actualizar
                </button>
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <DiaryTopField label="Usuario" value={user?.displayName ?? "Usuario actual"} />
            <DiaryTopField label="Fecha consulta" value={todayLabel} />
            <DiaryTopField
              label="Estado"
              value={<span className={session ? "text-pf-success" : "text-pf-warning"}>{sessionStatus}</span>}
            />
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-pf-border bg-pf-surface-soft/80 p-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" className="min-h-10 text-xs" onClick={() => shiftViewDate(-1)}>
                ← Día anterior
              </Button>
              <Field label="Fecha" className="min-w-[160px]">
                <Input type="date" value={viewDate} onChange={(e) => setViewDate(e.target.value)} className="min-h-10" />
              </Field>
              <Button type="button" variant="secondary" className="min-h-10 text-xs" onClick={() => shiftViewDate(1)}>
                Día siguiente →
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-10 text-xs"
                onClick={() => {
                  setViewDate(todayStr);
                  setViewUserId("");
                }}
              >
                Hoy
              </Button>
            </div>
            {isAdmin ? (
              <Field label="Ver diario de" className="min-w-[200px] flex-1">
                <Select value={viewUserId} onChange={(e) => setViewUserId(e.target.value)} className="min-h-10">
                  <option value="">Cajero (filtro por fecha)</option>
                  {orgUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>

          <div className="rounded-xl border border-pf-border bg-pf-surface-soft px-3 py-2 text-xs leading-5 text-pf-text-secondary">
            Arqueo: <strong>fondo inicial + efectivo de ventas + abonos a crédito del mismo turno − gastos ± movimientos manuales</strong>.
            Las ventas con tarjeta no cuentan como efectivo en cajón. Use movimientos para retiros, ingresos y ajustes (diario digital).
          </div>
        </div>
      </DiarySection>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <DiarySection title="Resumen del turno">
          <div className="grid gap-3 lg:grid-cols-2">
            <DiaryMetric label="Ventas (tickets)" value={diary.saleCount} />
            <DiaryMetric label="Facturacion total" value={formatMoney(sym, diary.ventasTotal)} />
            <DiaryMetric label="Venta inmediata" value={formatMoney(sym, diary.contadoTotal)} help="Contado / tarjeta / efectivo" />
            <DiaryMetric label="Tarjeta" value={formatMoney(sym, diary.tarjetaTotal)} help="No entra al cajon" />
            <DiaryMetric label="Credito facturado" value={formatMoney(sym, diary.creditoTotal)} />
            <DiaryMetric label="Pendiente credito" value={formatMoney(sym, diary.creditoPendiente)} tone="warn" />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <DiaryMetric label="Efectivo ventas" value={formatMoney(sym, diary.efectivoVentasTotal)} help="Contado y efectivo" />
            <DiaryMetric label="Gastos turno" value={formatMoney(sym, diary.gastosSesion)} help="Registrados con su usuario" tone="danger" />
            <DiaryMetric
              label="Mov. manual (neto)"
              value={formatMoney(sym, diary.movementNet)}
              help="Retiros, ingresos, ajustes"
            />
            <DiaryMetric
              label="Efectivo esperado"
              value={formatMoney(sym, diary.efectivoCajaSugerido)}
              help="Fondo + ventas + abonos − gastos ± movimientos"
              tone="strong"
            />
          </div>

          <div className="mt-3 rounded-xl border border-pf-border bg-pf-surface-soft/70 px-3 py-2 text-xs text-pf-text-tertiary">
            {diary.session
              ? `Turno abierto desde ${formatDate(diary.session.openedAt)} ${formatTimeOnly(diary.session.openedAt)}`
              : "No hay turno abierto. Abra un turno para poder cuadrar la caja correctamente."}
          </div>
        </DiarySection>

        <DiarySection title={session ? "Cierre de turno" : "Apertura de turno"}>
          {!viewingSelf ? (
            <p className="text-sm text-pf-text-secondary">
              Está viendo el diario de otra fecha o cajero. Para abrir o cerrar <strong>su</strong> turno de hoy, use «Hoy» y
              deje el filtro de cajero en blanco.
            </p>
          ) : null}
          {session ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <DiaryMetric label="Fondo inicial" value={formatMoney(sym, session.openingCash)} />
                <DiaryMetric label="Esperado" value={formatMoney(sym, diary.efectivoCajaSugerido)} tone="strong" />
                <DiaryMetric
                  label="Diferencia"
                  value={closingDifference === null ? "—" : formatMoney(sym, closingDifference)}
                  help={
                    closingDifference === null
                      ? "Ingrese el contado real."
                      : closingDifference === 0
                        ? "Caja cuadrada"
                        : closingDifference > 0
                          ? "Sobrante"
                          : "Faltante"
                  }
                  tone={
                    closingDifference === null
                      ? "default"
                      : closingDifference === 0
                        ? "strong"
                        : closingDifference > 0
                          ? "warn"
                          : "danger"
                  }
                />
              </div>

              <div className="rounded-xl border border-pf-border bg-pf-surface-soft p-3">
                <div className="grid gap-4">
                  <Field label="Efectivo contado al cierre">
                    <Input type="number" step="any" value={closing} onChange={(e) => setClosing(e.target.value)} />
                  </Field>
                  <Field label="Observaciones (opcional)">
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Faltante, sobrante, retiro, cambio, etc." />
                  </Field>
                </div>
              </div>

              {err ? <p className="text-sm font-medium text-pf-danger">{err}</p> : null}

              <Button
                type="button"
                variant="danger"
                className="w-full min-h-[48px]"
                onClick={closeSession}
                disabled={busy || !viewingSelf}
              >
                <DoorClosed className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                {busy ? "Cerrando…" : "Cerrar turno"}
              </Button>

              <p className={`text-xs font-semibold ${sessionStatusTone}`}>
                {closingDifference === null
                  ? "Listo para arqueo."
                  : closingDifference === 0
                    ? "La caja cuadra correctamente."
                    : closingDifference > 0
                      ? "Hay un sobrante respecto al efectivo esperado."
                      : "Hay un faltante respecto al efectivo esperado."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-pf-border bg-pf-surface-soft p-3 text-sm text-pf-text-secondary">
                Abra el turno ingresando solo el fondo inicial. Si la caja empieza vacia, deje <strong>0</strong>.
              </div>
              <Field label="Fondo inicial">
                <Input type="number" step="any" value={opening} onChange={(e) => setOpening(e.target.value)} />
              </Field>
              {err ? <p className="text-sm font-medium text-pf-danger">{err}</p> : null}
              <Button type="button" className="w-full min-h-[48px]" onClick={openSession} disabled={busy || !viewingSelf}>
                <DoorOpen className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                {busy ? "Abriendo…" : "Abrir turno"}
              </Button>
            </div>
          )}
        </DiarySection>
      </div>

      {viewingSelf && session ? (
        <DiarySection title="Registrar movimiento de caja">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Field label="Categoría">
              <Select value={movCategory} onChange={(e) => setMovCategory(e.target.value)} className="min-h-10">
                {MOVEMENT_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Monto">
              <Input type="number" step="any" value={movAmount} onChange={(e) => setMovAmount(e.target.value)} className="min-h-10" />
            </Field>
            <Field label="Nota (opc.)">
              <Input value={movNote} onChange={(e) => setMovNote(e.target.value)} className="min-h-10" />
            </Field>
            <label className="flex cursor-pointer items-center gap-2 pt-7 text-sm font-medium text-pf-text">
              <input type="checkbox" checked={movVoucher} onChange={(e) => setMovVoucher(e.target.checked)} className="h-4 w-4" />
              Comprobante
            </label>
          </div>
          <Button type="button" className="mt-3 min-h-11" onClick={() => void addCashMovement()} disabled={movBusy}>
            {movBusy ? "Guardando…" : "Agregar movimiento"}
          </Button>
        </DiarySection>
      ) : null}

      {diary.movements.length > 0 ? (
        <DiarySection title="Movimientos manuales registrados">
          <div className="max-h-56 overflow-y-auto rounded-xl border border-pf-border bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-pf-surface-soft">
                <tr className="border-b border-pf-border text-left text-xs font-bold uppercase text-pf-text-tertiary">
                  <th className="px-3 py-2">Hora</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2">Nota</th>
                </tr>
              </thead>
              <tbody>
                {diary.movements.map((m) => (
                  <tr key={m.id} className="border-b border-pf-border/70">
                    <td className="px-3 py-2 whitespace-nowrap text-pf-text-secondary">{formatTimeOnly(m.createdAt)}</td>
                    <td className="px-3 py-2 font-medium text-pf-text">{m.category}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(sym, m.amount)}</td>
                    <td className="px-3 py-2 text-pf-text-secondary">{m.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DiarySection>
      ) : null}

      {isAdmin && adminSummary && adminSummary.sessions.length > 0 ? (
        <DiarySection title={`Diario general (admin) — ${adminSummary.date}`}>
          <p className="mb-2 text-xs text-pf-text-secondary">
            Suma de turnos del día: ventas {formatMoney(sym, adminSummary.totals.ventasTotal)} · efectivo sugerido{" "}
            {formatMoney(sym, adminSummary.totals.efectivoCajaSugerido)}
          </p>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-pf-border bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-pf-surface-soft">
                <tr className="text-left text-xs font-bold uppercase text-pf-text-tertiary">
                  <th className="px-3 py-2">Cajero</th>
                  <th className="px-3 py-2">Apertura</th>
                  <th className="px-3 py-2">Cierre</th>
                  <th className="px-3 py-2 text-right">Ventas</th>
                  <th className="px-3 py-2 text-right">Efectivo sug.</th>
                </tr>
              </thead>
              <tbody>
                {adminSummary.sessions.map((s) => (
                  <tr key={s.sessionId} className="border-b border-pf-border/70">
                    <td className="px-3 py-2">{s.user.displayName}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{formatDate(s.openedAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{s.closedAt ? formatDate(s.closedAt) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(sym, s.ventasTotal)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(sym, s.efectivoCajaSugerido)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DiarySection>
      ) : null}

      {diary.sales.length > 0 ? (
        <DiarySection title="Movimientos del turno">
          <div className="max-h-72 overflow-y-auto rounded-xl border border-pf-border bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-pf-surface-soft">
                <tr className="border-b border-pf-border text-left text-xs font-bold uppercase tracking-wide text-pf-text-tertiary">
                  <th className="px-3 py-2">Hora</th>
                  <th className="px-3 py-2">Documento</th>
                  <th className="px-3 py-2">Términos</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {diary.sales.map((s) => (
                  <tr key={s.id} className="border-b border-pf-border/70 last:border-b-0">
                    <td className="px-3 py-2 whitespace-nowrap text-pf-text-secondary">{formatTimeOnly(s.saleDate)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-pf-text">{s.invoiceNumber ?? s.id.slice(0, 6)}</td>
                    <td className="px-3 py-2 text-pf-text-secondary">{s.terms}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-pf-text">{formatMoney(sym, s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DiarySection>
      ) : null}
    </div>
  );
}
