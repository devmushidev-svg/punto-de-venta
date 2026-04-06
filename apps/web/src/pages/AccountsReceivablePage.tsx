import { Coins } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Input } from "../components/ui";
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

export function AccountsReceivablePage() {
  const { token, user, organization } = useAuth();
  const sym = organization?.currencySymbol ?? "L";
  const [rows, setRows] = useState<Row[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [surAmounts, setSurAmounts] = useState<Record<string, string>>({});
  const [surNotes, setSurNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiFetch<Row[]>("/api/accounts/receivable", { token });
      setRows(data);
    } catch {
      setRows([]);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function pay(saleId: string) {
    if (!token) return;
    const raw = amounts[saleId] ?? "";
    const amount = Number(raw);
    if (!amount || amount <= 0) {
      setErr("Indique un monto válido");
      return;
    }
    setErr("");
    setBusy(`pay:${saleId}`);
    try {
      await apiFetch(`/api/accounts/receivable/${saleId}/pay`, {
        method: "POST",
        body: JSON.stringify({ amount }),
        token,
      });
      setAmounts((a) => ({ ...a, [saleId]: "" }));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  }

  async function surcharge(saleId: string) {
    if (!token) return;
    const raw = surAmounts[saleId] ?? "";
    const amount = Number(raw);
    if (!amount || amount <= 0) {
      setErr("Indique un monto de recargo válido");
      return;
    }
    setErr("");
    setBusy(`sur:${saleId}`);
    try {
      const note = (surNotes[saleId] ?? "").trim() || undefined;
      await apiFetch(`/api/accounts/receivable/${saleId}/surcharge`, {
        method: "POST",
        body: JSON.stringify({ amount, note }),
        token,
      });
      setSurAmounts((a) => ({ ...a, [saleId]: "" }));
      setSurNotes((a) => ({ ...a, [saleId]: "" }));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 pf-safe-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHero title={"Cuentas por cobrar"} constrained>
          <p className="pf-page-lead max-w-2xl">
            Qué es: el dinero que aún le deben sus clientes por ventas a crédito (cuentas por cobrar).
          </p>
          <p className="pf-page-lead-muted max-w-2xl">
            Registre <strong className="font-medium text-stone-700">abonos</strong> para reducir el saldo y{" "}
            <strong className="font-medium text-stone-700">recargos</strong> (intereses u otros cargos) si deben pagar más
            que el total original de la factura.
          </p>
        </PageHero>
        {hasPermission(user, PERMISSION_KEYS.ACCOUNTS_PAYABLE) ? (
          <Link
            to="/cxp"
            className="inline-flex min-h-[48px] w-full shrink-0 items-center justify-center rounded-2xl border border-teal-200/60 bg-gradient-to-r from-teal-50/95 to-emerald-50/80 px-4 text-sm font-bold text-teal-900 shadow-md transition hover:brightness-105 touch-manipulation sm:w-auto sm:min-h-0 sm:justify-start sm:border-0 sm:bg-transparent sm:px-0 sm:py-1 sm:font-medium sm:text-pf-primary-hover sm:shadow-none sm:underline sm:underline-offset-2"
          >
            Ir a cuentas por pagar
          </Link>
        ) : null}
      </div>

      {err ? (
        <p className="rounded-xl border border-red-100 bg-red-50/80 px-3 py-2 text-sm font-medium text-red-700">{err}</p>
      ) : null}

      <Card className="overflow-x-auto border-white/50 bg-gradient-to-br from-white/92 via-amber-50/15 to-sky-50/25 p-0 shadow-lg shadow-stone-900/[0.05] backdrop-blur-sm">
        <table className="w-full min-w-[1020px] text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-stone-200/80 bg-gradient-to-r from-amber-50/95 via-pf-primary-soft/50 to-sky-50/80 text-left text-xs font-bold text-stone-700 shadow-sm backdrop-blur-md">
              <th className="p-2">Factura</th>
              <th className="p-2">Fecha</th>
              <th className="p-2">Cliente</th>
              <th className="p-2 text-right">Total</th>
              <th className="p-2 text-right">Recargos</th>
              <th className="p-2 text-right">Pagado</th>
              <th className="p-2 text-right">Saldo</th>
              <th className="p-2 min-w-[220px]">Abono / recargo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.saleId} className="border-b border-stone-100/90 transition hover:bg-amber-50/40">
                <td className="p-2 font-mono text-xs">{r.invoiceNumber ?? r.saleId.slice(0, 8)}</td>
                <td className="p-2 whitespace-nowrap">{formatDate(r.saleDate)}</td>
                <td className="p-2 truncate max-w-[160px]">{r.customer?.name ?? "—"}</td>
                <td className="p-2 text-right">{formatMoney(sym, r.total)}</td>
                <td className="p-2 text-right text-stone-700">{formatMoney(sym, r.surchargesTotal ?? 0)}</td>
                <td className="p-2 text-right">{formatMoney(sym, r.paid)}</td>
                <td className="p-2 text-right font-medium text-amber-900">{formatMoney(sym, r.balance)}</td>
                <td className="p-2">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2 items-center">
                      <Input
                        type="number"
                        step="any"
                        className="min-h-11 max-w-[120px] py-2 sm:min-h-9 sm:max-w-[100px] sm:py-1"
                        placeholder="Abono"
                        value={amounts[r.saleId] ?? ""}
                        onChange={(e) => setAmounts((a) => ({ ...a, [r.saleId]: e.target.value }))}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-11 px-3 py-2 text-xs sm:min-h-9 sm:px-2 sm:py-1"
                        disabled={busy === `pay:${r.saleId}`}
                        onClick={() => pay(r.saleId)}
                      >
                        <Coins className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                        {busy === `pay:${r.saleId}` ? "…" : "Abonar"}
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      <Input
                        type="number"
                        step="any"
                        className="min-h-11 max-w-[120px] py-2 sm:min-h-9 sm:max-w-[100px] sm:py-1"
                        placeholder="Recargo"
                        value={surAmounts[r.saleId] ?? ""}
                        onChange={(e) => setSurAmounts((a) => ({ ...a, [r.saleId]: e.target.value }))}
                      />
                      <Input
                        className="min-h-11 min-w-[140px] flex-1 max-w-[220px] py-2 sm:min-h-9 sm:min-w-[120px] sm:max-w-[200px] sm:py-1"
                        placeholder="Nota (opc.)"
                        value={surNotes[r.saleId] ?? ""}
                        onChange={(e) => setSurNotes((a) => ({ ...a, [r.saleId]: e.target.value }))}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 px-3 py-2 text-xs sm:min-h-9 sm:px-2 sm:py-1"
                        disabled={busy === `sur:${r.saleId}`}
                        onClick={() => surcharge(r.saleId)}
                      >
                        {busy === `sur:${r.saleId}` ? "…" : "Recargo"}
                      </Button>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="p-8 text-center font-medium text-pf-muted">Sin saldos por cobrar</p> : null}
      </Card>
    </div>
  );
}
