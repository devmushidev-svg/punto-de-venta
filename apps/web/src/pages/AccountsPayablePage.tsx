import { Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Input } from "../components/ui";
import { formatDate, formatMoney } from "../lib/format";
import { hasPermission, PERMISSION_KEYS } from "../lib/permissions";
import type { Supplier } from "../types";

type Row = {
  purchaseId: string;
  reference: string | null;
  supplier: Supplier | null;
  total: number;
  surchargesTotal: number;
  paid: number;
  balance: number;
  purchaseDate: string;
};

export function AccountsPayablePage() {
  const { token, user, organization } = useAuth();
  const sym = organization?.currencySymbol ?? "L";
  const [rows, setRows] = useState<Row[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [surAmounts, setSurAmounts] = useState<Record<string, string>>({});
  const [surNotes, setSurNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [registerInCash, setRegisterInCash] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiFetch<Row[]>("/api/accounts/payable", { token });
      setRows(data);
    } catch {
      setRows([]);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function pay(purchaseId: string) {
    if (!token) return;
    const raw = amounts[purchaseId] ?? "";
    const amount = Number(raw);
    if (!amount || amount <= 0) {
      setErr("Indique un monto válido");
      return;
    }
    setErr("");
    setBusy(`pay:${purchaseId}`);
    try {
      await apiFetch(`/api/accounts/payable/${purchaseId}/pay`, {
        method: "POST",
        body: JSON.stringify({ amount, registerCashMovement: registerInCash }),
        token,
      });
      setAmounts((a) => ({ ...a, [purchaseId]: "" }));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  }

  async function surcharge(purchaseId: string) {
    if (!token) return;
    const raw = surAmounts[purchaseId] ?? "";
    const amount = Number(raw);
    if (!amount || amount <= 0) {
      setErr("Indique un monto de recargo válido");
      return;
    }
    setErr("");
    setBusy(`sur:${purchaseId}`);
    try {
      const note = (surNotes[purchaseId] ?? "").trim() || undefined;
      await apiFetch(`/api/accounts/payable/${purchaseId}/surcharge`, {
        method: "POST",
        body: JSON.stringify({ amount, note }),
        token,
      });
      setSurAmounts((a) => ({ ...a, [purchaseId]: "" }));
      setSurNotes((a) => ({ ...a, [purchaseId]: "" }));
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
        <PageHero title={"Cuentas por pagar"} constrained>
          <p className="pf-page-lead max-w-2xl">
            Qué es: lo que su empresa aún debe a proveedores por compras a crédito (cuentas por pagar).
          </p>
          <p className="pf-page-lead-muted max-w-2xl">
            Use <strong className="font-medium text-stone-700">pagos</strong> parciales para ir saldando y{" "}
            <strong className="font-medium text-stone-700">recargos</strong> si el proveedor factura cargos adicionales
            sobre la compra original.
          </p>
        </PageHero>
        {hasPermission(user, PERMISSION_KEYS.ACCOUNTS_RECEIVABLE) ? (
          <Link
            to="/cxc"
            className="inline-flex min-h-[48px] w-full shrink-0 items-center justify-center rounded-2xl border border-amber-200/60 bg-gradient-to-r from-amber-50/95 to-orange-50/80 px-4 text-sm font-bold text-amber-950 shadow-md transition hover:brightness-105 touch-manipulation sm:w-auto sm:min-h-0 sm:justify-start sm:border-0 sm:bg-transparent sm:px-0 sm:py-1 sm:font-medium sm:text-pf-primary-hover sm:shadow-none sm:underline sm:underline-offset-2"
          >
            Ir a cuentas por cobrar
          </Link>
        ) : null}
      </div>

      {err ? (
        <p className="rounded-xl border border-red-100 bg-red-50/80 px-3 py-2 text-sm font-medium text-red-700">{err}</p>
      ) : null}

      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-stone-800 touch-manipulation">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-stone-300"
          checked={registerInCash}
          onChange={(e) => setRegisterInCash(e.target.checked)}
        />
        Registrar pagos en el diario de caja (egreso; si tiene turno abierto)
      </label>

      <Card className="overflow-x-auto border-white/50 bg-gradient-to-br from-white/92 via-teal-50/18 to-violet-50/20 p-0 shadow-lg shadow-stone-900/[0.05] backdrop-blur-sm">
        <table className="w-full min-w-[1020px] text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-stone-200/80 bg-gradient-to-r from-teal-50/90 via-pf-primary-soft/45 to-violet-50/75 text-left text-xs font-bold text-stone-700 shadow-sm backdrop-blur-md">
              <th className="p-2">Ref.</th>
              <th className="p-2">Fecha</th>
              <th className="p-2">Proveedor</th>
              <th className="p-2 text-right">Total</th>
              <th className="p-2 text-right">Recargos</th>
              <th className="p-2 text-right">Pagado</th>
              <th className="p-2 text-right">Saldo</th>
              <th className="p-2 min-w-[220px]">Pago / recargo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.purchaseId} className="border-b border-stone-100/90 transition hover:bg-teal-50/35">
                <td className="p-2 font-mono text-xs">{r.reference ?? r.purchaseId.slice(0, 8)}</td>
                <td className="p-2 whitespace-nowrap">{formatDate(r.purchaseDate)}</td>
                <td className="p-2 truncate max-w-[160px]">{r.supplier?.name ?? "—"}</td>
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
                        placeholder="Pago"
                        value={amounts[r.purchaseId] ?? ""}
                        onChange={(e) => setAmounts((a) => ({ ...a, [r.purchaseId]: e.target.value }))}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-11 px-3 py-2 text-xs sm:min-h-9 sm:px-2 sm:py-1"
                        disabled={busy === `pay:${r.purchaseId}`}
                        onClick={() => pay(r.purchaseId)}
                      >
                        <Wallet className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                        {busy === `pay:${r.purchaseId}` ? "…" : "Pagar"}
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      <Input
                        type="number"
                        step="any"
                        className="min-h-11 max-w-[120px] py-2 sm:min-h-9 sm:max-w-[100px] sm:py-1"
                        placeholder="Recargo"
                        value={surAmounts[r.purchaseId] ?? ""}
                        onChange={(e) => setSurAmounts((a) => ({ ...a, [r.purchaseId]: e.target.value }))}
                      />
                      <Input
                        className="min-h-11 min-w-[140px] flex-1 max-w-[220px] py-2 sm:min-h-9 sm:min-w-[120px] sm:max-w-[200px] sm:py-1"
                        placeholder="Nota (opc.)"
                        value={surNotes[r.purchaseId] ?? ""}
                        onChange={(e) => setSurNotes((a) => ({ ...a, [r.purchaseId]: e.target.value }))}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 px-3 py-2 text-xs sm:min-h-9 sm:px-2 sm:py-1"
                        disabled={busy === `sur:${r.purchaseId}`}
                        onClick={() => surcharge(r.purchaseId)}
                      >
                        {busy === `sur:${r.purchaseId}` ? "…" : "Recargo"}
                      </Button>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="p-8 text-center font-medium text-pf-muted">Sin saldos por pagar</p> : null}
      </Card>
    </div>
  );
}
