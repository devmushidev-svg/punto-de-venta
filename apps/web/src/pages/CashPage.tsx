import { DoorClosed, DoorOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { Link } from "react-router-dom";
import { hasPermission, PERMISSION_KEYS } from "../lib/permissions";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input } from "../components/ui";
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
  efectivoCajaSugerido: number;
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
  efectivoCajaSugerido: 0,
  sales: [],
};

export function CashPage() {
  const { token, user, organization } = useAuth();
  const canCxc = hasPermission(user, PERMISSION_KEYS.ACCOUNTS_RECEIVABLE);
  const canCxp = hasPermission(user, PERMISSION_KEYS.ACCOUNTS_PAYABLE);
  const canGastosLink = user?.role === "admin" || hasPermission(user, PERMISSION_KEYS.EXPENSES_VIEW);
  const sym = organization?.currencySymbol ?? "L";
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [opening, setOpening] = useState("0");
  const [closing, setClosing] = useState("");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [diary, setDiary] = useState<Diary | null>(null);

  function refresh() {
    if (!token) return;
    apiFetch<Session | null>("/api/cash-sessions/current", { token })
      .then((s) => setSession(s))
      .catch(() => setSession(null));
    apiFetch<Diary>("/api/cash-sessions/current/diary", { token })
      .then(setDiary)
      .catch(() => setDiary(EMPTY_DIARY));
  }

  useEffect(() => {
    refresh();
  }, [token]);

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
          expectedCash: expected === "" ? undefined : Number(expected),
          notes: notes || undefined,
        }),
        token,
      });
      setClosing("");
      setExpected("");
      setNotes("");
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  if (session === undefined || diary === null) {
    return (
      <p className="rounded-2xl border border-white/50 bg-white/60 px-4 py-6 text-center font-medium text-pf-muted backdrop-blur-sm">
        Cargando caja…
      </p>
    );
  }

  return (
    <div className="max-w-4xl space-y-6 pf-safe-page">
      <PageHero title={"Caja y diario digital"}>
        <p className="pf-page-lead max-w-2xl">
          Qué es: control de turno (apertura/cierre), resumen de ventas del usuario en la sesión y referencia para arqueo
          de efectivo.
        </p>
        <p className="pf-page-lead-muted max-w-2xl">
          Equivale al diario digital / cierre de caja del manual tipo Smart POS. La referencia de efectivo en caja suma
          fondo inicial, ventas en efectivo o contado del turno, el abonado en facturas a crédito <strong>emitidas en esta
          misma sesión</strong> y resta gastos registrados con su usuario en el mismo periodo (no incluye ventas con
          tarjeta en el cajón). Los abonos en CxC a facturas de <strong>otros días</strong> no se reflejan aquí (no hay
          registro de pagos por fecha en el diario); si cobró esas cuentas en efectivo durante el turno, incorpórelos al
          arqueo manualmente.
        </p>
      </PageHero>

      <Card className="space-y-3 border-orange-200/40 bg-gradient-to-br from-pf-primary-soft/50 via-white/80 to-teal-50/30 p-4 shadow-[var(--pf-shadow-warm-sm)] backdrop-blur-sm md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-bold text-stone-900">Resumen del turno (sus ventas en esta sesión)</h2>
          {(canCxc || canCxp || canGastosLink) && (
            <div className="flex flex-wrap gap-2 text-sm">
              {canCxc ? (
                <Link
                  to="/cxc"
                  className="inline-flex min-h-[40px] items-center rounded-xl border border-orange-200/50 bg-gradient-to-r from-pf-primary-soft/90 to-amber-50/90 px-3 py-2 text-xs font-bold text-pf-primary-foreground shadow-sm transition hover:brightness-105 touch-manipulation md:min-h-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:text-pf-primary-hover md:shadow-none md:underline md:underline-offset-2"
                >
                  CxC
                </Link>
              ) : null}
              {canCxc && canCxp ? <span className="hidden text-pf-muted md:inline" aria-hidden>·</span> : null}
              {canCxp ? (
                <Link
                  to="/cxp"
                  className="inline-flex min-h-[40px] items-center rounded-xl border border-teal-200/50 bg-teal-50/90 px-3 py-2 text-xs font-bold text-teal-900 shadow-sm transition hover:brightness-105 touch-manipulation md:min-h-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:font-medium md:text-pf-primary-hover md:shadow-none md:underline md:underline-offset-2"
                >
                  CxP
                </Link>
              ) : null}
              {canGastosLink ? (
                <>
                  {canCxc || canCxp ? <span className="hidden text-pf-muted md:inline" aria-hidden>·</span> : null}
                  <Link
                    to="/gastos"
                    className="inline-flex min-h-[40px] items-center rounded-xl border border-violet-200/50 bg-violet-50/90 px-3 py-2 text-xs font-bold text-violet-900 shadow-sm transition hover:brightness-105 touch-manipulation md:min-h-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:font-medium md:text-pf-primary-hover md:shadow-none md:underline md:underline-offset-2"
                  >
                    Gastos
                  </Link>
                </>
              ) : null}
            </div>
          )}
        </div>
        {diary.session ? (
          <p className="text-xs text-pf-muted">
            Sesión desde {formatDate(diary.session.openedAt)} {formatTimeOnly(diary.session.openedAt)}
          </p>
        ) : (
          <p className="text-sm text-amber-800">Abra caja para registrar ventas en un turno.</p>
        )}
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-2xl border border-white/60 bg-gradient-to-br from-white/95 to-slate-50/80 p-3 shadow-md shadow-stone-900/[0.04] backdrop-blur-sm">
            <p className="text-xs font-semibold text-stone-500">Ventas (tickets)</p>
            <p className="text-xl font-extrabold tabular-nums text-stone-900">{diary.saleCount}</p>
          </div>
          <div className="rounded-2xl border border-white/60 bg-gradient-to-br from-sky-50/90 to-white/90 p-3 shadow-md backdrop-blur-sm">
            <p className="text-xs font-semibold text-stone-500">Venta inmediata</p>
            <p className="mb-0.5 text-xs text-stone-500">Contado / tarjeta / efectivo</p>
            <p className="text-xl font-extrabold tabular-nums text-stone-900">{formatMoney(sym, diary.contadoTotal)}</p>
          </div>
          <div className="rounded-2xl border border-white/60 bg-gradient-to-br from-violet-50/80 to-white/90 p-3 shadow-md backdrop-blur-sm">
            <p className="text-xs font-semibold text-stone-500">Tarjeta (en turno)</p>
            <p className="text-xl font-extrabold tabular-nums text-stone-900">{formatMoney(sym, diary.tarjetaTotal)}</p>
          </div>
          <div className="rounded-2xl border border-white/60 bg-gradient-to-br from-amber-50/80 to-white/90 p-3 shadow-md backdrop-blur-sm">
            <p className="text-xs font-semibold text-stone-500">Crédito facturado</p>
            <p className="text-xl font-extrabold tabular-nums text-stone-900">{formatMoney(sym, diary.creditoTotal)}</p>
          </div>
          <div className="rounded-2xl border border-amber-200/50 bg-gradient-to-br from-amber-100/70 to-orange-50/90 p-3 shadow-md">
            <p className="text-xs font-semibold text-amber-900/80">Pendiente cobro crédito</p>
            <p className="text-xl font-extrabold tabular-nums text-amber-950">{formatMoney(sym, diary.creditoPendiente)}</p>
          </div>
          <div className="rounded-2xl border border-emerald-200/40 bg-gradient-to-br from-emerald-50/90 to-teal-50/50 p-3 shadow-md">
            <p className="text-xs font-semibold text-stone-500">Facturación total</p>
            <p className="text-xl font-extrabold tabular-nums text-stone-900">{formatMoney(sym, diary.ventasTotal)}</p>
          </div>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-1 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/60 bg-gradient-to-br from-white/95 to-teal-50/40 p-3 shadow-md backdrop-blur-sm">
            <p className="text-xs font-semibold text-stone-500">Efectivo y contado (cajón)</p>
            <p className="mb-0.5 text-xs text-stone-500">Sin tarjeta</p>
            <p className="text-lg font-extrabold tabular-nums text-stone-900">{formatMoney(sym, diary.efectivoVentasTotal)}</p>
          </div>
          <div className="rounded-2xl border border-red-100/80 bg-gradient-to-br from-red-50/60 to-white/90 p-3 shadow-md backdrop-blur-sm">
            <p className="text-xs font-semibold text-stone-500">Gastos del turno</p>
            <p className="mb-0.5 text-xs text-stone-500">Registrados con su usuario</p>
            <p className="text-lg font-extrabold tabular-nums text-red-800">{formatMoney(sym, diary.gastosSesion)}</p>
          </div>
          <div className="rounded-2xl border-2 border-orange-300/50 bg-gradient-to-br from-pf-primary/25 via-amber-100/70 to-pf-primary-soft/90 p-3 shadow-lg shadow-orange-500/15 ring-1 ring-white/60">
            <p className="text-xs font-bold text-stone-600">Efectivo en caja (referencia)</p>
            <p className="mb-0.5 text-xs text-stone-600">
              Fondo + efectivo ventas + abonado en créditos <span className="whitespace-nowrap">de ventas de este turno</span> −
              gastos (no incluye abonos CxC a facturas antiguas)
            </p>
            <p className="text-xl font-extrabold tabular-nums text-pf-primary-foreground">{formatMoney(sym, diary.efectivoCajaSugerido)}</p>
          </div>
        </div>
        {diary.sales.length > 0 ? (
          <div className="max-h-48 overflow-y-auto rounded-2xl border border-white/60 bg-white/85 text-xs shadow-inner backdrop-blur-sm">
            <table className="w-full">
              <thead>
                <tr className="border-b border-stone-200/80 bg-gradient-to-r from-stone-50 to-pf-primary-soft/30 text-left text-xs font-bold text-stone-600">
                  <th className="p-2">Hora</th>
                  <th className="p-2">Doc.</th>
                  <th className="p-2">Términos</th>
                  <th className="p-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {diary.sales.map((s) => (
                  <tr key={s.id} className="border-b border-stone-100/80 transition hover:bg-pf-primary-soft/25">
                    <td className="p-2 whitespace-nowrap">{formatTimeOnly(s.saleDate)}</td>
                    <td className="p-2 font-mono">{s.invoiceNumber ?? s.id.slice(0, 6)}</td>
                    <td className="p-2">{s.terms}</td>
                    <td className="p-2 text-right">{formatMoney(sym, s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {session ? (
        <Card className="space-y-4 border-white/50 bg-gradient-to-b from-white/95 to-red-50/10 p-5 shadow-lg backdrop-blur-sm">
          <div>
            <p className="text-sm text-pf-muted">Sesión abierta</p>
            <p className="font-medium">{formatDate(session.openedAt)}</p>
            <p className="text-sm mt-2">
              Fondo inicial: <strong>{formatMoney(sym, session.openingCash)}</strong>
            </p>
          </div>
          <Field label="Efectivo al cerrar (conteo)">
            <Input type="number" step="any" value={closing} onChange={(e) => setClosing(e.target.value)} />
          </Field>
          <Field
            label={`Efectivo esperado (opcional)${diary.session ? ` · referencia ${formatMoney(sym, diary.efectivoCajaSugerido)}` : ""}`}
          >
            <Input type="number" step="any" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
          <Field label="Notas">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {err ? <p className="text-sm text-red-600">{err}</p> : null}
          <Button type="button" variant="danger" className="w-full min-h-[52px] text-base shadow-lg" onClick={closeSession} disabled={busy}>
            <DoorClosed className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            {busy ? "Cerrando…" : "Cerrar caja"}
          </Button>
        </Card>
      ) : (
        <Card className="space-y-4 border-white/50 bg-gradient-to-b from-white/95 via-emerald-50/20 to-pf-primary-soft/25 p-5 shadow-lg backdrop-blur-sm">
          <p className="text-sm font-medium text-stone-600">No hay sesión abierta para su usuario.</p>
          <Field label="Fondo inicial en caja">
            <Input type="number" step="any" value={opening} onChange={(e) => setOpening(e.target.value)} />
          </Field>
          {err ? <p className="text-sm text-red-600">{err}</p> : null}
          <Button type="button" className="w-full min-h-[52px] text-base shadow-lg" onClick={openSession} disabled={busy}>
            <DoorOpen className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            {busy ? "Abriendo…" : "Abrir caja"}
          </Button>
        </Card>
      )}
    </div>
  );
}
