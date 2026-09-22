import { Search, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Input } from "../components/ui";
import { formatDate, formatMoney } from "../lib/format";
import { hasPermission, PERMISSION_KEYS } from "../lib/permissions";
import type { Supplier } from "../types";
import "./admin-workspace.css";

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
  const [query, setQuery] = useState("");

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

  const filteredRows = rows.filter((r) => {
    const q = query.trim().toLocaleLowerCase();
    return (
      !q ||
      [r.reference, r.purchaseId, r.supplier?.name]
        .filter(Boolean)
        .some((v) => String(v).toLocaleLowerCase().includes(q))
    );
  });
  const balanceTotal = rows.reduce((sum, r) => sum + r.balance, 0);

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
    <div className="pf-admin-page space-y-5 pf-safe-page">
      <div className="pf-admin-heading">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Debe a proveedores</p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-pf-text">
            {formatMoney(sym, balanceTotal)}
          </p>
          <p className="mt-0.5 text-xs text-pf-text-tertiary">
            {(() => {
              const n = rows.filter((r) => r.balance > 0).length;
              return n === 1 ? "1 compra con saldo abierto" : `${n} compras con saldo abierto`;
            })()}
          </p>
        </div>
        {hasPermission(user, PERMISSION_KEYS.ACCOUNTS_RECEIVABLE) ? (
          <Link
            to="/cxc"
            className="inline-flex min-h-10 items-center text-sm font-semibold text-pf-primary-hover underline underline-offset-4"
          >
            Ir a cuentas por cobrar
          </Link>
        ) : null}
      </div>

      {err ? (
        <p className="rounded-xl border border-pf-danger-soft bg-pf-danger-soft/40 px-3 py-2 text-sm font-medium text-pf-danger">
          {err}
        </p>
      ) : null}

      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-pf-text-secondary touch-manipulation">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-pf-border"
          checked={registerInCash}
          onChange={(e) => setRegisterInCash(e.target.checked)}
        />
        Registrar pagos en el diario de caja (egreso; si hay turno abierto)
      </label>

      <section className="pf-admin-surface">
        <div className="pf-admin-surface-head">
          <div>
            <h2>Compras por pagar</h2>
            <p>
              {filteredRows.length === rows.length
                ? `${rows.length} ${rows.length === 1 ? "compra" : "compras"}`
                : `${filteredRows.length} de ${rows.length} compras`}
            </p>
          </div>
          <label className="pf-admin-search">
            <Search size={17} aria-hidden />
            <Input
              aria-label="Buscar cuentas por pagar"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Proveedor o referencia"
            />
          </label>
        </div>
        <div
          className="divide-y divide-pf-border sm:hidden"
          role="list"
          aria-label="Compras por pagar"
        >
          {filteredRows.map((r) => {
            const reference = r.reference ?? r.purchaseId.slice(0, 8);
            const supplier = r.supplier?.name ?? "Proveedor sin nombre";
            return (
              <article
                key={r.purchaseId}
                className="space-y-3 px-3 py-4"
                role="listitem"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-pf-text">
                      {supplier}
                    </p>
                    <p className="mt-1 font-mono text-xs text-pf-text-tertiary">
                      {reference} · {formatDate(r.purchaseDate)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-pf-muted">
                      Saldo
                    </p>
                    <p className="mt-0.5 text-base font-bold tabular-nums text-pf-warning">
                      {formatMoney(sym, r.balance)}
                    </p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-y border-pf-border py-2.5 text-xs">
                  <div className="min-w-0">
                    <dt className="text-pf-muted">Total</dt>
                    <dd className="mt-0.5 break-words font-medium tabular-nums text-pf-text">
                      {formatMoney(sym, r.total)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-pf-muted">Pagado</dt>
                    <dd className="mt-0.5 break-words font-medium tabular-nums text-pf-text">
                      {formatMoney(sym, r.paid)}
                    </dd>
                  </div>
                  {r.surchargesTotal > 0 ? (
                    <div className="min-w-0">
                      <dt className="text-pf-muted">Recargos</dt>
                      <dd className="mt-0.5 break-words font-medium tabular-nums text-pf-text">
                        {formatMoney(sym, r.surchargesTotal)}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-pf-text-secondary">
                    Registrar pago
                  </p>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      className="min-w-0 flex-1"
                      aria-label={`Monto del pago para ${supplier}`}
                      placeholder="Monto"
                      value={amounts[r.purchaseId] ?? ""}
                      onChange={(e) =>
                        setAmounts((a) => ({
                          ...a,
                          [r.purchaseId]: e.target.value,
                        }))
                      }
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-12 shrink-0 px-4"
                      disabled={busy === `pay:${r.purchaseId}`}
                      onClick={() => pay(r.purchaseId)}
                    >
                      <Wallet
                        className="h-4 w-4 shrink-0"
                        strokeWidth={2}
                        aria-hidden
                      />
                      {busy === `pay:${r.purchaseId}` ? "…" : "Pagar"}
                    </Button>
                  </div>
                </div>

                <details className="rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface-soft">
                  <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-pf-text-secondary">
                    Agregar recargo
                  </summary>
                  <div className="space-y-2 border-t border-pf-border p-3">
                    <Input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      aria-label={`Monto del recargo para ${supplier}`}
                      placeholder="Monto del recargo"
                      value={surAmounts[r.purchaseId] ?? ""}
                      onChange={(e) =>
                        setSurAmounts((a) => ({
                          ...a,
                          [r.purchaseId]: e.target.value,
                        }))
                      }
                    />
                    <Input
                      aria-label={`Nota del recargo para ${supplier}`}
                      placeholder="Nota (opcional)"
                      value={surNotes[r.purchaseId] ?? ""}
                      onChange={(e) =>
                        setSurNotes((a) => ({
                          ...a,
                          [r.purchaseId]: e.target.value,
                        }))
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11 w-full"
                      disabled={busy === `sur:${r.purchaseId}`}
                      onClick={() => surcharge(r.purchaseId)}
                    >
                      {busy === `sur:${r.purchaseId}` ? "Guardando…" : "Guardar recargo"}
                    </Button>
                  </div>
                </details>
              </article>
            );
          })}
        </div>
        <div className="hidden sm:block pf-admin-table-wrap">
          <table className="w-full min-w-[1020px] text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-pf-border/80 bg-pf-surface text-left text-xs font-bold text-pf-text-secondary shadow-sm backdrop-blur-md">
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
              {filteredRows.map((r) => (
                <tr key={r.purchaseId}>
                  <td className="p-2 font-mono text-xs">
                    {r.reference ?? r.purchaseId.slice(0, 8)}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {formatDate(r.purchaseDate)}
                  </td>
                  <td className="max-w-[160px] truncate">
                    <strong>{r.supplier?.name ?? "—"}</strong>
                  </td>
                  <td className="pf-admin-number">
                    {formatMoney(sym, r.total)}
                  </td>
                  <td className="pf-admin-number">
                    {formatMoney(sym, r.surchargesTotal ?? 0)}
                  </td>
                  <td className="pf-admin-number">
                    {formatMoney(sym, r.paid)}
                  </td>
                  <td className="pf-admin-number font-semibold text-pf-warning">
                    {formatMoney(sym, r.balance)}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2 items-center">
                        <Input
                          type="number"
                          step="any"
                          className="min-h-11 max-w-[120px] py-2 sm:min-h-9 sm:max-w-[100px] sm:py-1"
                          placeholder="Pago"
                          value={amounts[r.purchaseId] ?? ""}
                          onChange={(e) =>
                            setAmounts((a) => ({
                              ...a,
                              [r.purchaseId]: e.target.value,
                            }))
                          }
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          className="min-h-11 px-3 py-2 text-xs sm:min-h-9 sm:px-2 sm:py-1"
                          disabled={busy === `pay:${r.purchaseId}`}
                          onClick={() => pay(r.purchaseId)}
                        >
                          <Wallet
                            className="h-3.5 w-3.5 shrink-0"
                            strokeWidth={2}
                            aria-hidden
                          />
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
                          onChange={(e) =>
                            setSurAmounts((a) => ({
                              ...a,
                              [r.purchaseId]: e.target.value,
                            }))
                          }
                        />
                        <Input
                          className="min-h-11 min-w-[140px] flex-1 max-w-[220px] py-2 sm:min-h-9 sm:min-w-[120px] sm:max-w-[200px] sm:py-1"
                          placeholder="Nota (opc.)"
                          value={surNotes[r.purchaseId] ?? ""}
                          onChange={(e) =>
                            setSurNotes((a) => ({
                              ...a,
                              [r.purchaseId]: e.target.value,
                            }))
                          }
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
        </div>
        {filteredRows.length === 0 ? (
          <div className="pf-admin-empty">
            <strong>
              {rows.length === 0
                ? "No hay saldos por pagar"
                : "No encontramos esa compra"}
            </strong>
            <span>
              {rows.length === 0
                ? "Las compras a crédito aparecerán aquí cuando tengan saldo."
                : "Pruebe con otro proveedor o referencia."}
            </span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
