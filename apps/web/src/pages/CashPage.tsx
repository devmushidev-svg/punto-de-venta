import {
  ArrowRight,
  ArrowDownUp,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  DoorClosed,
  DoorOpen,
  Printer,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { hasPermission, PERMISSION_KEYS } from "../lib/permissions";
import { apiDownload, apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Field, Input, Select } from "../components/ui";
import { formatDate, formatMoney, formatTimeOnly } from "../lib/format";
import "./cash-workspace.css";

type Session = {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  closingCash: number | null;
  expectedCash: number | null;
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
  sales: {
    id: string;
    total: number;
    paid: number;
    terms: string;
    saleDate: string;
    invoiceNumber: string | null;
  }[];
};
type AdminSummary = {
  sessions: {
    sessionId: string;
    user: { id: string; displayName: string };
    openedAt: string;
    closedAt: string | null;
    ventasTotal: number;
    efectivoCajaSugerido: number;
  }[];
  totals: { ventasTotal: number; efectivoCajaSugerido: number };
};
const CATEGORIES = [
  { value: "GASTO", label: "Gasto" },
  { value: "INGRESO", label: "Ingreso" },
  { value: "PAGO_ABONO", label: "Pago / abono" },
  { value: "RETIRO", label: "Retiro" },
  { value: "AJUSTE_TARJETA", label: "Ajuste tarjeta" },
];
const categoryLabel = (value: string) =>
  CATEGORIES.find((c) => c.value === value)?.label ?? value;
function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function validMoney(value: string) {
  return (
    value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0
  );
}

// A failed request is not an empty register. Key each result so changing a filter
// cannot briefly display the previous cashier's figures under the new heading.
function useCashResource<T>(
  url: string | null,
  revision: number,
): { data?: T; error?: string } {
  const { token } = useAuth();
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: string;
  }>();
  const key = `${url}:${revision}:${token}`;
  useEffect(() => {
    if (!url || !token) return;
    let active = true;
    apiFetch<T>(url, { token }).then(
      (data) => {
        if (active) setResult({ key, data });
      },
      (e) => {
        if (active)
          setResult({
            key,
            error:
              e instanceof Error
                ? e.message
                : "No se pudo conectar con el sistema.",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [url, token, key]);
  return result?.key === key ? result : {};
}

function LoadState({ error, retry }: { error?: string; retry: () => void }) {
  return (
    <div className="cash-load" role={error ? "alert" : "status"}>
      <h2>{error ? "No pudimos consultar la caja" : "Consultando la caja…"}</h2>
      <p>
        {error ?? "Estamos obteniendo el estado y los movimientos del turno."}
      </p>
      {error && (
        <Button variant="secondary" onClick={retry}>
          Volver a intentar
        </Button>
      )}
    </div>
  );
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cash-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function CashPage() {
  const { user } = useAuth();
  const [view, setView] = useState<"current" | "history">("current");
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((v) => v + 1);
  return (
    <div className="cash-workspace pf-safe-page">
      <header className="cash-heading">
        <div>
          <p>
            {user?.displayName} <span aria-hidden>·</span>{" "}
            {new Date().toLocaleDateString("es-HN", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <Button variant="ghost" aria-label="Actualizar caja" onClick={refresh}>
          <RefreshCw size={16} aria-hidden />
          <span>Actualizar</span>
        </Button>
      </header>
      <nav className="cash-tabs" aria-label="Vistas de caja">
        <button
          type="button"
          aria-current={view === "current" ? "page" : undefined}
          onClick={() => setView("current")}
        >
          <Wallet size={18} aria-hidden />
          Mi caja
        </button>
        <button
          type="button"
          aria-current={view === "history" ? "page" : undefined}
          onClick={() => setView("history")}
        >
          <BookOpen size={18} aria-hidden />
          Diario digital
        </button>
      </nav>
      {view === "current" ? (
        <CurrentCash
          revision={revision}
          refresh={refresh}
          showHistory={() => setView("history")}
        />
      ) : (
        <CashHistory revision={revision} refresh={refresh} />
      )}
    </div>
  );
}

function CurrentCash({
  revision,
  refresh,
  showHistory,
}: {
  revision: number;
  refresh: () => void;
  showHistory: () => void;
}) {
  const { token, organization, user } = useAuth();
  const { data: diary, error } = useCashResource<Diary>(
    "/api/cash-sessions/current/diary",
    revision,
  );
  const sym = organization?.currencySymbol ?? "L";
  const [task, setTask] = useState<"overview" | "movement" | "close">(
    "overview",
  );
  const [opening, setOpening] = useState("0");
  const [closing, setClosing] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const session = diary?.session;
  async function submitSession(action: "open" | "close") {
    if (!token || busy) return;
    const amount = action === "open" ? opening : closing;
    if (!validMoney(amount)) {
      setErr("Ingrese un monto válido, igual o mayor que cero.");
      return;
    }
    if (action === "close" && !session) return;
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      await apiFetch(
        action === "open"
          ? "/api/cash-sessions/open"
          : `/api/cash-sessions/${session!.id}/close`,
        {
          method: "POST",
          token,
          body: JSON.stringify(
            action === "open"
              ? { openingCash: Number(amount) }
              : {
                  closingCash: Number(amount),
                  notes: notes.trim() || undefined,
                },
          ),
        },
      );
      setNotice(
        action === "open"
          ? "Caja abierta. Ya puede empezar a vender."
          : "Caja cerrada. El resumen quedó disponible en el diario digital.",
      );
      setClosing("");
      setNotes("");
      setOpening("0");
      setTask("overview");
      refresh();
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : "No se pudo guardar. Intente de nuevo.",
      );
    } finally {
      setBusy(false);
    }
  }
  function changeTask(next: typeof task) {
    setTask(next);
    setErr("");
    setNotice("");
  }
  if (!diary) return <LoadState error={error} retry={refresh} />;
  const difference = validMoney(closing)
    ? Math.round((Number(closing) - diary.efectivoCajaSugerido) * 100) / 100
    : null;
  return (
    <>
      {notice && (
        <p className="cash-notice" role="status">
          <Check size={18} aria-hidden />
          {notice}
        </p>
      )}
      {!session ? (
        <>
          <section className="cash-start" aria-labelledby="cash-open-title">
            <div className="cash-start-copy">
              <span className="cash-status">Caja cerrada</span>
              <h2 id="cash-open-title">
                Abra su caja
                <br />
                para empezar.
              </h2>
              <p>
                Cuente el efectivo que tiene en el cajón. Ese será su fondo
                inicial para dar cambio.
              </p>
              <p className="cash-start-note">
                Las ventas y los movimientos se irán sumando a su turno.
              </p>
            </div>
            <form
              className="cash-opening-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submitSession("open");
              }}
            >
              <Field label={`Efectivo inicial (${sym})`}>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={opening}
                  onChange={(e) => setOpening(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  required
                  aria-describedby="cash-opening-help"
                  className="cash-money-input"
                />
              </Field>
              <p id="cash-opening-help">
                Si empieza sin efectivo, deje el monto en 0.
              </p>
              {err && (
                <p className="cash-error" role="alert">
                  {err}
                </p>
              )}
              <Button
                type="submit"
                className="cash-primary"
                disabled={busy || !validMoney(opening)}
              >
                <DoorOpen size={18} aria-hidden />
                {busy ? "Abriendo caja…" : "Abrir caja"}
                <ArrowRight size={18} aria-hidden />
              </Button>
              <span className="cash-form-footnote">
                Abre un turno a su nombre.
              </span>
            </form>
          </section>
          <div className="cash-next">
            <div>
              <h3>¿Busca un cierre anterior?</h3>
              <p>Consulte ventas, movimientos y cierres sin abrir una caja.</p>
            </div>
            <Button variant="secondary" onClick={showHistory}>
              Ver diario digital
              <ArrowRight size={16} aria-hidden />
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="cash-session-bar">
            <span className="cash-status cash-status-open">Caja abierta</span>
            <span>Desde {formatDate(session.openedAt)}</span>
          </div>
          <section className="cash-overview" aria-label="Resumen de su turno">
            <div>
              <span>Efectivo esperado en caja</span>
              <strong>{formatMoney(sym, diary.efectivoCajaSugerido)}</strong>
              <small>
                Incluye su fondo inicial de{" "}
                {formatMoney(sym, session.openingCash)}
              </small>
            </div>
            <div>
              <span>Ventas del turno</span>
              <strong>{formatMoney(sym, diary.ventasTotal)}</strong>
              <small>
                {diary.saleCount}{" "}
                {diary.saleCount === 1
                  ? "venta registrada"
                  : "ventas registradas"}
              </small>
            </div>
            <div>
              <span>Cobros con tarjeta</span>
              <strong>{formatMoney(sym, diary.tarjetaTotal)}</strong>
              <small>No son efectivo en el cajón</small>
            </div>
          </section>
          <div className="cash-actions">
            <Link className="cash-sale-link" to="/venta">
              Nueva venta
              <ArrowRight size={17} aria-hidden />
            </Link>
            <Button
              variant="secondary"
              aria-expanded={task === "movement"}
              onClick={() =>
                changeTask(task === "movement" ? "overview" : "movement")
              }
            >
              <ArrowDownUp size={17} aria-hidden />
              Registrar movimiento
            </Button>
            <Button
              variant="secondary"
              aria-expanded={task === "close"}
              onClick={() =>
                changeTask(task === "close" ? "overview" : "close")
              }
            >
              <DoorClosed size={17} aria-hidden />
              Preparar cierre
            </Button>
          </div>
          {task === "movement" && (
            <MovementForm
              sessionId={session.id}
              onCancel={() => changeTask("overview")}
              onSaved={() => {
                setTask("overview");
                setNotice(
                  "Movimiento registrado. El efectivo esperado se actualizó.",
                );
                refresh();
              }}
            />
          )}
          {task === "close" && (
            <section className="cash-close" aria-labelledby="cash-close-title">
              <div className="cash-close-copy">
                <h2 id="cash-close-title">Cuente el efectivo y cierre su caja</h2>
                <p>
                  Incluya billetes y monedas. No sume comprobantes de tarjeta.
                </p>
                <CashBreakdown diary={diary} sym={sym} />
              </div>
              <form
                className="cash-close-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitSession("close");
                }}
              >
                <Field label={`Efectivo que contaste (${sym})`}>
                  <Input
                    autoFocus
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={closing}
                    onChange={(e) => setClosing(e.target.value)}
                    required
                    placeholder="0.00"
                    className="cash-money-input"
                  />
                </Field>
                <div
                  className={`cash-difference ${difference === 0 ? "cash-balanced" : difference !== null ? "cash-unbalanced" : ""}`}
                  role="status"
                >
                  <span>
                    {difference === null
                      ? "Diferencia por comprobar"
                      : difference === 0
                        ? "Su caja cuadra"
                        : difference > 0
                          ? "Hay un sobrante"
                          : "Hay un faltante"}
                  </span>
                  <strong>
                    {difference === null
                      ? "—"
                      : formatMoney(sym, Math.abs(difference))}
                  </strong>
                </div>
                <Field label="Observaciones (opcional)">
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Anote cualquier diferencia o detalle"
                  />
                </Field>
                {err && (
                  <p className="cash-error" role="alert">
                    {err}
                  </p>
                )}
                <p className="cash-confirm-help">
                  Al confirmar, este turno termina y se guarda el efectivo
                  contado.
                </p>
                <div className="cash-form-actions">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => changeTask("overview")}
                  >
                    Volver
                  </Button>
                  <Button
                    type="submit"
                    className="cash-primary"
                    disabled={busy || !validMoney(closing)}
                  >
                    <DoorClosed size={17} aria-hidden />
                    {busy ? "Cerrando…" : "Confirmar cierre"}
                  </Button>
                </div>
              </form>
            </section>
          )}
          {task === "overview" && (
            <details className="cash-details">
              <summary>Ver cómo se calcula el efectivo esperado</summary>
              <CashBreakdown diary={diary} sym={sym} />
            </details>
          )}
          <Activity diary={diary} sym={sym} refresh={refresh} />
          <nav className="cash-related" aria-label="Otras operaciones">
            <span>Otras operaciones</span>
            {hasPermission(user, PERMISSION_KEYS.ACCOUNTS_RECEIVABLE) && (
              <Link to="/cxc">Pagos de clientes</Link>
            )}
            {hasPermission(user, PERMISSION_KEYS.ACCOUNTS_PAYABLE) && (
              <Link to="/cxp">Pagos a proveedores</Link>
            )}
            {(user?.role === "admin" ||
              hasPermission(user, PERMISSION_KEYS.EXPENSES_VIEW)) && (
              <Link to="/gastos">Gastos</Link>
            )}
          </nav>
        </>
      )}
    </>
  );
}

function CashBreakdown({ diary: d, sym }: { diary: Diary; sym: string }) {
  // Credit collections include non-cash payments in creditoCobrado; derive only
  // the cash contribution from the server's authoritative register total.
  const creditCash =
    d.efectivoCajaSugerido -
    (d.session?.openingCash ?? 0) -
    d.efectivoVentasTotal +
    d.gastosSesion -
    d.movementNet;
  const rows: [string, number][] = [
    ["Fondo inicial", d.session?.openingCash ?? 0],
    ["Ventas en efectivo", d.efectivoVentasTotal],
    ["Abonos en efectivo", creditCash],
    ["Gastos del turno", -d.gastosSesion],
    ["Movimientos manuales (neto)", d.movementNet],
  ];
  return (
    <dl className="cash-breakdown">
      {rows.map(([label, amount]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{formatMoney(sym, Math.round(amount * 100) / 100 || 0)}</dd>
        </div>
      ))}
      <div className="cash-breakdown-total">
        <dt>Efectivo esperado</dt>
        <dd>{formatMoney(sym, d.efectivoCajaSugerido)}</dd>
      </div>
    </dl>
  );
}

function MovementForm({
  sessionId,
  onCancel,
  onSaved,
}: {
  sessionId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { token, organization } = useAuth();
  const [category, setCategory] = useState("GASTO");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [voucher, setVoucher] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    if (!token || busy || !validMoney(amount) || Number(amount) <= 0) return;
    setBusy(true);
    setErr("");
    try {
      await apiFetch("/api/cash-movements", {
        method: "POST",
        token,
        body: JSON.stringify({
          sessionId,
          category,
          amount: Number(amount),
          hasVoucher: voucher,
          note: note.trim() || undefined,
        }),
      });
      onSaved();
    } catch (e) {
      setErr(
        e instanceof Error ? e.message : "No se pudo registrar el movimiento.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Registrar movimiento">
      <p className="cash-description">
        Registre una entrada o salida de dinero que no sea una venta. No repita
        un gasto que ya registró en Gastos.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="cash-movement-fields">
          <Field label="Tipo de movimiento">
            <Select
              autoFocus
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Monto (${organization?.currencySymbol ?? "L"})`}>
            <Input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Descripción (opcional)">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Por ejemplo: retiro para depósito"
            />
          </Field>
        </div>
        <label className="cash-checkbox">
          <input
            type="checkbox"
            checked={voucher}
            onChange={(e) => setVoucher(e.target.checked)}
          />
          Tengo comprobante
        </label>
        {err && (
          <p className="cash-error" role="alert">
            {err}
          </p>
        )}
        <div className="cash-form-actions">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button
            type="submit"
            className="cash-primary"
            disabled={busy || !validMoney(amount) || Number(amount) <= 0}
          >
            {busy ? "Guardando…" : "Guardar movimiento"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function CashHistory({
  revision,
  refresh,
}: {
  revision: number;
  refresh: () => void;
}) {
  const { token, user, organization } = useAuth();
  const sym = organization?.currencySymbol ?? "L";
  const admin = user?.role === "admin";
  const [date, setDate] = useState(localDate);
  const [userId, setUserId] = useState("");
  const [printError, setPrintError] = useState("");
  const [printing, setPrinting] = useState(false);
  const query = new URLSearchParams({
    date,
    ...(userId ? { userId } : {}),
  }).toString();
  const { data: diary, error } = useCashResource<Diary>(
    `/api/cash-diary?${query}`,
    revision,
  );
  const { data: users, error: usersError } = useCashResource<
    { id: string; displayName: string }[]
  >(admin ? "/api/users" : null, revision);
  const { data: summary, error: summaryError } = useCashResource<AdminSummary>(
    admin ? `/api/cash-diary/admin-summary?date=${date}` : null,
    revision,
  );
  function shift(delta: number) {
    const day = new Date(`${date}T12:00:00`);
    day.setDate(day.getDate() + delta);
    setDate(localDate(day));
  }
  async function print() {
    if (!token || printing) return;
    setPrinting(true);
    setPrintError("");
    try {
      const blob = await apiDownload(
        `/api/cash-diary/close-report.html?${query}&print=1`,
        token,
      );
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setPrintError(
        e instanceof Error ? e.message : "No se pudo generar el reporte.",
      );
    } finally {
      setPrinting(false);
    }
  }
  return (
    <>
      <div className="cash-history-intro">
        <h2>Consulte un turno anterior</h2>
        <p>
          Elija una fecha para revisar el turno. Esta vista no modifica
          su caja actual.
        </p>
      </div>
      <div className="cash-filters">
        <div className="cash-date-filter">
          <Button
            variant="secondary"
            aria-label="Día anterior"
            onClick={() => shift(-1)}
          >
            <ChevronLeft size={18} aria-hidden />
          </Button>
          <Field label="Fecha">
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
            />
          </Field>
          <Button
            variant="secondary"
            aria-label="Día siguiente"
            onClick={() => shift(1)}
          >
            <ChevronRight size={18} aria-hidden />
          </Button>
        </div>
        <Button variant="ghost" onClick={() => setDate(localDate())}>
          Hoy
        </Button>
        {admin && (
          <Field label="Cajero">
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Mi diario · {user?.displayName}</option>
              {users
                ?.filter((u) => u.id !== user?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
            </Select>
          </Field>
        )}
      </div>
      {usersError && (
        <p className="cash-error" role="alert">
          No se pudo cargar la lista de cajeros. Use Actualizar para reintentar.
        </p>
      )}
      {!diary ? (
        <LoadState error={error} retry={refresh} />
      ) : !diary.session ? (
        <div className="cash-empty">
          <BookOpen size={26} aria-hidden />
          <h3>No hay turno para esta consulta</h3>
          <p>
            Pruebe con otra fecha{admin ? " o elija otro cajero" : ""}. No
            necesita abrir una caja para consultar el diario.
          </p>
        </div>
      ) : (
        <>
          <div className="cash-history-title">
            <div>
              <h3>
                {userId
                  ? (users?.find((u) => u.id === userId)?.displayName ??
                    "Cajero seleccionado")
                  : user?.displayName}
              </h3>
              <p>
                Abrió {formatDate(diary.session.openedAt)}
                {diary.session.closedAt
                  ? ` · Cerró ${formatDate(diary.session.closedAt)}`
                  : " · Turno todavía abierto"}
              </p>
            </div>
            <Button
              variant="secondary"
              disabled={printing}
              onClick={() => void print()}
            >
              <Printer size={17} aria-hidden />
              {printing ? "Preparando…" : "Imprimir resumen"}
            </Button>
          </div>
          {printError && (
            <p className="cash-error" role="alert">
              {printError}
            </p>
          )}
          <div className="cash-history-summary">
            <Panel title="Efectivo del turno">
              <CashBreakdown diary={diary} sym={sym} />
              {diary.session.closedAt && (
                <dl className="cash-breakdown">
                  <div>
                    <dt>Efectivo contado al cierre</dt>
                    <dd>
                      {diary.session.closingCash === null
                        ? "No registrado"
                        : formatMoney(sym, diary.session.closingCash)}
                    </dd>
                  </div>
                  <div>
                    <dt>Diferencia registrada</dt>
                    <dd>
                      {diary.cashDifference === null
                        ? "No registrada"
                        : formatMoney(sym, diary.cashDifference)}
                    </dd>
                  </div>
                </dl>
              )}
            </Panel>
            <Panel title="Ventas del turno">
              <dl className="cash-breakdown">
                <div>
                  <dt>Ventas registradas</dt>
                  <dd>{diary.saleCount}</dd>
                </div>
                <div>
                  <dt>Venta inmediata</dt>
                  <dd>{formatMoney(sym, diary.contadoTotal)}</dd>
                </div>
                <div>
                  <dt>Con tarjeta</dt>
                  <dd>{formatMoney(sym, diary.tarjetaTotal)}</dd>
                </div>
                <div>
                  <dt>Crédito facturado</dt>
                  <dd>{formatMoney(sym, diary.creditoTotal)}</dd>
                </div>
                <div>
                  <dt>Pendiente a crédito</dt>
                  <dd>{formatMoney(sym, diary.creditoPendiente)}</dd>
                </div>
                <div className="cash-breakdown-total">
                  <dt>Facturación total</dt>
                  <dd>{formatMoney(sym, diary.ventasTotal)}</dd>
                </div>
              </dl>
            </Panel>
          </div>
          <Activity diary={diary} sym={sym} refresh={refresh} />
        </>
      )}
      {admin && (
        <details className="cash-details">
          <summary>Todos los turnos abiertos en esta fecha</summary>
          {summaryError ? (
            <p className="cash-error">
              No se pudo cargar el resumen general. Use Actualizar para
              reintentar.
            </p>
          ) : !summary ? (
            <p role="status">Cargando turnos…</p>
          ) : !summary.sessions.length ? (
            <p>No se abrieron turnos en esta fecha.</p>
          ) : (
            <>
              <p className="cash-description">
                Ventas de todos los turnos:{" "}
                {formatMoney(sym, summary.totals.ventasTotal)} · Efectivo
                esperado:{" "}
                {formatMoney(sym, summary.totals.efectivoCajaSugerido)}
              </p>
              <div className="cash-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Cajero</th>
                      <th>Apertura</th>
                      <th>Cierre</th>
                      <th className="cash-number">Ventas</th>
                      <th className="cash-number">Efectivo esperado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.sessions.map((s) => (
                      <tr key={s.sessionId}>
                        <td>{s.user.displayName}</td>
                        <td>{formatTimeOnly(s.openedAt)}</td>
                        <td>
                          {s.closedAt ? formatTimeOnly(s.closedAt) : "Abierto"}
                        </td>
                        <td className="cash-number">
                          {formatMoney(sym, s.ventasTotal)}
                        </td>
                        <td className="cash-number">
                          {formatMoney(sym, s.efectivoCajaSugerido)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </details>
      )}
    </>
  );
}

function Activity({
  diary,
  sym,
  refresh,
}: {
  diary: Diary;
  sym: string;
  refresh: () => void;
}) {
  const { token, user } = useAuth();
  const [view, setView] = useState<"sales" | "movements">("sales");
  const [editing, setEditing] = useState(false);
  return (
    <section className="cash-activity" aria-label="Actividad del turno">
      <div className="cash-activity-heading">
        <h2>Actividad del turno</h2>
        <div
          className="cash-activity-switch"
          role="group"
          aria-label="Tipo de actividad"
        >
          <button
            type="button"
            aria-pressed={view === "sales"}
            onClick={() => setView("sales")}
          >
            Ventas ({diary.sales.length})
          </button>
          <button
            type="button"
            aria-pressed={view === "movements"}
            onClick={() => setView("movements")}
          >
            Movimientos ({diary.movements.length})
          </button>
        </div>
      </div>
      {view === "sales" ? (
        !diary.sales.length ? (
          <div className="cash-empty-inline">
            <p>
              {diary.session?.closedAt
                ? "No se registraron ventas en este turno."
                : "Todavía no hay ventas en este turno."}
            </p>
            {!diary.session?.closedAt && (
              <span>Las ventas que registre aparecerán aquí.</span>
            )}
          </div>
        ) : (
          <div className="cash-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Documento</th>
                  <th>Términos</th>
                  <th className="cash-number">Total</th>
                </tr>
              </thead>
              <tbody>
                {diary.sales.map((s) => (
                  <tr key={s.id}>
                    <td>{formatTimeOnly(s.saleDate)}</td>
                    <td>{s.invoiceNumber ?? s.id.slice(0, 6)}</td>
                    <td>{s.terms}</td>
                    <td className="cash-number">{formatMoney(sym, s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : !diary.movements.length ? (
        <div className="cash-empty-inline">
          <p>No hay movimientos manuales en este turno.</p>
          <span>
            Aquí se muestran los ingresos, retiros y ajustes registrados en
            caja.
          </span>
        </div>
      ) : (
        <>
          {user?.role === "admin" && (
            <div className="cash-edit-toolbar">
              <Button variant="ghost" onClick={() => setEditing(!editing)}>
                {editing
                  ? "Terminar correcciones"
                  : "Corregir categoría o nota"}
              </Button>
            </div>
          )}
          <div className="cash-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Tipo</th>
                  <th className="cash-number">Monto</th>
                  <th>Nota</th>
                  {editing && <th>Corrección</th>}
                </tr>
              </thead>
              <tbody>
                {diary.movements.map((m) => (
                  <MovementRow
                    key={m.id}
                    movement={m}
                    sym={sym}
                    token={token}
                    editing={editing && user?.role === "admin"}
                    refresh={refresh}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
function MovementRow({
  movement: m,
  sym,
  token,
  editing,
  refresh,
}: {
  movement: DiaryMovement;
  sym: string;
  token: string | null;
  editing: boolean;
  refresh: () => void;
}) {
  const [category, setCategory] = useState(m.category);
  const [note, setNote] = useState(m.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    setCategory(m.category);
    setNote(m.note ?? "");
  }, [m.category, m.note, editing]);
  const dirty =
    category !== m.category || note.trim() !== (m.note ?? "").trim();
  async function save() {
    if (!token || busy || !dirty) return;
    setBusy(true);
    setErr("");
    try {
      await apiFetch(`/api/cash-movements/${m.id}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ category, note: note.trim() || null }),
      });
      refresh();
    } catch (e) {
      setErr(
        e instanceof Error ? e.message : "No se pudo corregir el movimiento.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <tr>
      <td>{formatTimeOnly(m.createdAt)}</td>
      <td>
        {editing ? (
          <Select
            aria-label="Corregir categoría"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        ) : (
          categoryLabel(m.category)
        )}
      </td>
      <td className="cash-number">{formatMoney(sym, m.amount)}</td>
      <td>
        {editing ? (
          <Input
            aria-label="Corregir nota"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        ) : (
          m.note || "—"
        )}
        {m.hasVoucher && (
          <small className="cash-voucher">Con comprobante</small>
        )}
      </td>
      {editing && (
        <td>
          <Button
            variant="secondary"
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            {busy ? "Guardando…" : "Guardar"}
          </Button>
          {err && (
            <p className="cash-error" role="alert">
              {err}
            </p>
          )}
        </td>
      )}
    </tr>
  );
}
