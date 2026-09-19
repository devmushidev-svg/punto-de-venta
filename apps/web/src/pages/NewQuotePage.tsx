import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHero } from "../components/PageHero";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Select } from "../components/ui";
import { formatMoney } from "../lib/format";
import { resolveProductUnitPrice } from "../lib/volumePrice";
import type { Customer, Product } from "../types";

type Line = {
  productId: string;
  product: Product;
  qty: number;
  unitPrice: number;
};

type QuoteApiLine = {
  productId: string;
  qty: number;
  unitPrice: number;
  product: Product;
};

type QuoteApi = {
  id: string;
  status: string;
  customerId: string | null;
  notes: string | null;
  validUntil: string | null;
  serviceLabel: string | null;
  quoteNumber?: string | null;
  lines: QuoteApiLine[];
};

function escapeKitchenHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function printKitchenOrder(opts: { docLabel: string; serviceLabel: string; lines: { name: string; qty: number }[] }) {
  const rowsHtml = opts.lines
    .map(
      (l) =>
        `<tr><td>${escapeKitchenHtml(l.name)}</td><td style="text-align:right">${escapeKitchenHtml(String(l.qty))}</td></tr>`
    )
    .join("");
  const refBlock = opts.serviceLabel.trim()
    ? `<p><strong>Mesa / ref.:</strong> ${escapeKitchenHtml(opts.serviceLabel.trim())}</p>`
    : "";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Orden</title>
<style>body{font-family:system-ui,sans-serif;padding:12px} table{border-collapse:collapse;width:100%} td,th{border:1px solid #ccc;padding:6px}</style></head>
<body><h2>Orden cocina / preparación</h2><p>${escapeKitchenHtml(opts.docLabel)}</p>${refBlock}<table><thead><tr><th>Producto</th><th>Cant.</th></tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`;
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

export function NewQuotePage({
  backTo,
  titleNew,
  titleEdit,
}: {
  backTo: string;
  titleNew: string;
  titleEdit?: string;
}) {
  const { quoteId } = useParams<{ quoteId?: string }>();
  const isEdit = Boolean(quoteId);
  const title = isEdit ? titleEdit ?? titleNew : titleNew;

  const { token, organization } = useAuth();
  const sym = organization?.currencySymbol ?? "L";
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<Product[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState("");
  const [serviceLabel, setServiceLabel] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [editLoading, setEditLoading] = useState(isEdit);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!token) return;
    apiFetch<Customer[]>("/api/customers", { token }).then((c) => {
      setCustomers(c);
      if (!isEdit) {
        const def = c.find((x) => x.name.includes("CONSUMIDOR")) ?? c[0];
        if (def) setCustomerId(def.id);
        else setCustomerId("");
      }
    });
  }, [token, isEdit]);

  useEffect(() => {
    if (!token || !quoteId) {
      setEditLoading(false);
      return;
    }
    let cancelled = false;
    setLoadErr("");
    setEditLoading(true);
    apiFetch<QuoteApi>(`/api/quotes/${quoteId}`, { token })
      .then((q) => {
        if (cancelled) return;
        if (q.status === "CONVERTIDA") {
          setLoadErr("Esta cotización ya fue convertida.");
          return;
        }
        setCustomerId(q.customerId ?? "");
        setNotes(q.notes ?? "");
        setServiceLabel(q.serviceLabel ?? "");
        if (q.validUntil) {
          const d = new Date(q.validUntil);
          setValidUntil(d.toISOString().slice(0, 10));
        } else setValidUntil("");
        setLines(
          q.lines.map((l) => ({
            productId: l.productId,
            product: l.product,
            qty: l.qty,
            unitPrice: l.unitPrice,
          }))
        );
      })
      .catch(() => {
        if (!cancelled) setLoadErr("No se pudo cargar la cotización.");
      })
      .finally(() => {
        if (!cancelled) setEditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, quoteId]);

  const runSearch = useCallback(async () => {
    if (!token || !search.trim()) {
      setHits([]);
      return;
    }
    const data = await apiFetch<Product[]>(
      `/api/products?q=${encodeURIComponent(search.trim())}&forPos=1&limit=40`,
      { token }
    );
    setHits(data.slice(0, 14));
  }, [token, search]);

  useEffect(() => {
    const t = setTimeout(runSearch, 200);
    return () => clearTimeout(t);
  }, [runSearch]);

  function addProduct(p: Product) {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.productId === p.id);
      if (i >= 0) {
        const next = [...prev];
        const newQty = next[i].qty + 1;
        next[i] = {
          ...next[i],
          qty: newQty,
          unitPrice: resolveProductUnitPrice(p, newQty, 1),
        };
        return next;
      }
      return [
        ...prev,
        {
          productId: p.id,
          product: p,
          qty: 1,
          unitPrice: resolveProductUnitPrice(p, 1, 1),
        },
      ];
    });
    setSearch("");
    setHits([]);
  }

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, j) => j !== i));
  }

  const totals = useMemo(() => {
    let sub = 0;
    let tax = 0;
    for (const l of lines) {
      const base = l.unitPrice * l.qty;
      const t = base * (l.product.taxPercent / 100);
      sub += base;
      tax += t;
    }
    return { subtotal: sub, tax, total: sub + tax };
  }, [lines]);

  async function submit() {
    if (!token || lines.length === 0) return;
    setErr("");
    setBusy(true);
    try {
      const body = {
        customerId: customerId || null,
        notes: notes || undefined,
        validUntil: validUntil || null,
        serviceLabel: serviceLabel.trim() || null,
        lines: lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
      };
      let savedNum: string | null | undefined;
      if (isEdit && quoteId) {
        const q = await apiFetch<QuoteApi>(`/api/quotes/${quoteId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
          token,
        });
        savedNum = q.quoteNumber ?? undefined;
      } else {
        const q = await apiFetch<QuoteApi>("/api/quotes", {
          method: "POST",
          body: JSON.stringify(body),
          token,
        });
        savedNum = q.quoteNumber ?? undefined;
      }
      try {
        const inv = await apiFetch<{ invoice: { kitchen?: { kitchenPrintEnabled?: boolean } } }>("/api/settings", {
          token,
        });
        if (inv.invoice?.kitchen?.kitchenPrintEnabled) {
          const kLines = lines
            .filter((l) => l.product.printOnKitchenOrder !== false)
            .map((l) => ({ name: l.product.name, qty: l.qty }));
          if (kLines.length) {
            printKitchenOrder({
              docLabel: savedNum ? `Documento ${savedNum}` : "PreVenta / cotización",
              serviceLabel,
              lines: kLines,
            });
          }
        }
      } catch {
        /* ignore */
      }
      navigate(backTo);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pf-safe-page">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={backTo}
          className="inline-flex min-h-[44px] items-center rounded-xl border border-[color:var(--pf-primary-mid)] bg-pf-primary-soft px-4 text-sm font-semibold text-pf-primary-hover shadow-sm transition hover:brightness-105 touch-manipulation sm:min-h-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-1 sm:font-medium sm:text-pf-primary-hover sm:shadow-none sm:underline sm:underline-offset-2"
        >
          ← Volver
        </Link>
      </div>
      <PageHero title={title}>
        <p className="pf-page-lead">No descuenta inventario hasta convertir a venta</p>
      </PageHero>

      {loadErr ? (
        <p className="rounded-xl border border-pf-danger-soft bg-pf-danger-soft/80 px-3 py-2 text-sm font-medium text-pf-danger">{loadErr}</p>
      ) : null}
      {editLoading ? (
        <p className="rounded-2xl border border-white/50 bg-white/70 px-4 py-3 text-center text-sm font-medium text-pf-muted">
          Cargando cotización…
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-4 p-4 shadow-lg lg:col-span-2 md:p-5">
          <Field label="Buscar producto">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o SKU" />
          </Field>
          {hits.length > 0 ? (
            <ul className="max-h-52 divide-y divide-pf-border/90 overflow-y-auto rounded-2xl border border-white/60 bg-white/80 shadow-inner">
              {hits.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex min-h-[52px] w-full touch-manipulation items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium transition hover:bg-pf-surface"
                    onClick={() => addProduct(p)}
                  >
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="shrink-0 text-pf-muted">
                      {formatMoney(sym, resolveProductUnitPrice(p, 1, 1))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="overflow-x-auto rounded-2xl border border-white/60 bg-white/85 shadow-inner">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="bg-pf-surface text-left text-xs font-bold text-pf-text-secondary">
                  <th className="p-2">Producto</th>
                  <th className="p-2 w-24">Cant.</th>
                  <th className="p-2 w-28">P. unit.</th>
                  <th className="p-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-4 text-center text-pf-muted">
                      Agregue líneas
                    </td>
                  </tr>
                ) : (
                  lines.map((l, i) => (
                    <tr key={l.productId} className="border-t border-pf-border/90 transition hover:bg-pf-surface">
                      <td className="p-2 font-bold text-pf-text">{l.product.name}</td>
                      <td className="p-2">
                        <Input
                          type="number"
                          step="any"
                          className="min-h-11 py-2 sm:min-h-10 sm:py-1"
                          value={l.qty}
                          onChange={(e) => {
                            const qty = Math.max(0.0001, Number(e.target.value) || 0);
                            updateLine(i, {
                              qty,
                              unitPrice: resolveProductUnitPrice(l.product, qty, 1),
                            });
                          }}
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          step="any"
                          className="min-h-11 py-2 sm:min-h-10 sm:py-1"
                          value={l.unitPrice}
                          onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="p-2">
                        <button
                          type="button"
                          className="min-h-11 touch-manipulation text-xs font-bold text-pf-danger sm:min-h-9"
                          onClick={() => removeLine(i)}
                        >
                          Quitar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="h-fit space-y-3 border-white/50 p-4 shadow-lg lg:sticky lg:top-4 md:p-5">
          <Field label="Cliente">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Sin cliente</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Válida hasta (opcional)">
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
          <Field label="Mesa / equipo / referencia (PreVenta)">
            <Input
              value={serviceLabel}
              onChange={(e) => setServiceLabel(e.target.value)}
              placeholder="Ej: Mesa 4, Para llevar…"
            />
          </Field>
          <Field label="Notas">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="space-y-1 rounded-2xl border border-pf-warning-soft/40 bg-pf-primary-soft p-3 text-sm shadow-inner">
            <div className="flex justify-between">
              <span className="text-pf-muted">Subtotal</span>
              <span>{formatMoney(sym, totals.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-pf-muted">Impuesto</span>
              <span>{formatMoney(sym, totals.tax)}</span>
            </div>
            <div className="flex justify-between text-base font-bold pt-2 border-t border-pf-border">
              <span>Total</span>
              <span>{formatMoney(sym, totals.total)}</span>
            </div>
          </div>
          {err ? (
            <p className="rounded-xl border border-pf-danger-soft bg-pf-danger-soft/80 px-3 py-2 text-sm font-medium text-pf-danger">{err}</p>
          ) : null}
          <Button
            type="button"
            className="min-h-[52px] w-full text-base shadow-lg"
            onClick={submit}
            disabled={busy || lines.length === 0 || Boolean(loadErr) || editLoading}
          >
            {busy ? "Guardando…" : isEdit ? "Guardar cambios" : "Guardar cotización"}
          </Button>
        </Card>
      </div>
    </div>
  );
}
