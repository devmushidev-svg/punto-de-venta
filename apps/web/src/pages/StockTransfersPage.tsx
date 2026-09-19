import { ArrowLeftRight, Ban, ClipboardCheck, Download, PackageCheck, Plus, Printer, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { apiDownload, apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { hasPermission, PERMISSION_KEYS } from "../lib/permissions";
import { Button, Card, Field, Input, Select } from "../components/ui";
import type { Product, StockLocation, StockTransferRow } from "../types";

type DraftLine = { productId: string; product: Product; qty: number };

function statusLabel(s: string): string {
  switch (s) {
    case "BORRADOR":
      return "Borrador";
    case "ENVIADA":
      return "En tránsito";
    case "RECIBIDA":
      return "Recibida";
    case "ANULADA":
      return "Anulada";
    default:
      return s;
  }
}

export function StockTransfersPage() {
  const { token, user } = useAuth();
  const admin = user?.role === "admin";
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [transfers, setTransfers] = useState<StockTransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<Product[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [newLocCode, setNewLocCode] = useState("");
  const [newLocName, setNewLocName] = useState("");
  const [locBusy, setLocBusy] = useState(false);

  const loadLocations = useCallback(async () => {
    if (!token) return;
    const list = await apiFetch<StockLocation[]>("/api/stock-locations", { token });
    const active = list.filter((l) => l.active);
    setLocations(active);
    setFromId((prev) => {
      if (prev) return prev;
      const a = active.find((l) => l.code === "PRIN") ?? active[0];
      return a?.id ?? "";
    });
    setToId((prev) => {
      if (prev) return prev;
      const a = active.find((l) => l.code === "PRIN") ?? active[0];
      const b = active.find((l) => l.id !== a?.id) ?? a;
      return b?.id ?? "";
    });
  }, [token]);

  const loadTransfers = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const list = await apiFetch<StockTransferRow[]>("/api/stock-transfers", { token });
      setTransfers(list);
    } catch {
      setTransfers([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  useEffect(() => {
    void loadTransfers();
  }, [loadTransfers]);

  const runSearch = useCallback(async () => {
    if (!token || !search.trim()) {
      setHits([]);
      return;
    }
    const data = await apiFetch<Product[]>(`/api/products?q=${encodeURIComponent(search.trim())}`, { token });
    setHits(
      data.filter((p) => p.active && p.productType !== "KIT" && p.productType !== "SERVICIO").slice(0, 12)
    );
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
        next[i] = { ...next[i], qty: next[i].qty + 1 };
        return next;
      }
      return [...prev, { productId: p.id, product: p, qty: 1 }];
    });
    setSearch("");
    setHits([]);
  }

  function updateQty(i: number, qty: number) {
    setLines((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], qty: Math.max(0.0001, qty) };
      return next;
    });
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, j) => j !== i));
  }

  async function submitDraft() {
    if (!token || lines.length === 0 || !fromId || !toId) return;
    if (fromId === toId) {
      setErr("Elija origen y destino distintos.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      await apiFetch("/api/stock-transfers", {
        method: "POST",
        body: JSON.stringify({
          fromLocationId: fromId,
          toLocationId: toId,
          notes: notes.trim() || undefined,
          lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
        }),
        token,
      });
      setLines([]);
      setNotes("");
      await loadTransfers();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function sendTransfer(id: string) {
    if (!token) return;
    setErr("");
    try {
      await apiFetch(`/api/stock-transfers/${id}/send`, { method: "POST", body: "{}", token });
      await loadTransfers();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }

  async function receiveTransfer(id: string) {
    if (!token) return;
    setErr("");
    try {
      await apiFetch(`/api/stock-transfers/${id}/receive`, { method: "POST", body: "{}", token });
      await loadTransfers();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }

  async function cancelTransfer(id: string) {
    if (!token) return;
    setErr("");
    try {
      await apiFetch(`/api/stock-transfers/${id}/cancel`, { method: "POST", body: "{}", token });
      await loadTransfers();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }

  async function printTransferHtml(id: string) {
    if (!token) return;
    setErr("");
    try {
      const blob = await apiDownload(`/api/stock-transfers/${id}/print.html?print=1`, token);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al imprimir");
    }
  }

  async function exportTransferFile(id: string, transferNumber: string | null) {
    if (!token) return;
    setErr("");
    try {
      const blob = await apiDownload(`/api/stock-transfers/${id}/export-file`, token);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `traslado-${transferNumber ?? id.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al exportar");
    }
  }

  async function importTransferFile(file: File | null) {
    if (!token || !file) return;
    setErr("");
    setBusy(true);
    try {
      const body = JSON.parse(await file.text()) as unknown;
      await apiFetch("/api/stock-transfers/import-file", {
        method: "POST",
        body: JSON.stringify(body),
        token,
      });
      await loadTransfers();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al importar");
    } finally {
      setBusy(false);
    }
  }

  async function addStockLocation() {
    if (!token || !admin) return;
    const code = newLocCode.trim().toUpperCase();
    if (!code || !newLocName.trim()) {
      setErr("Código y nombre de ubicación requeridos.");
      return;
    }
    setLocBusy(true);
    setErr("");
    try {
      await apiFetch("/api/stock-locations", {
        method: "POST",
        body: JSON.stringify({ code, name: newLocName.trim() }),
        token,
      });
      setNewLocCode("");
      setNewLocName("");
      await loadLocations();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setLocBusy(false);
    }
  }

  const locOptions = locations;

  if (!hasPermission(user, PERMISSION_KEYS.INVENTORY_TRANSFERS)) {
    return <Navigate to="/" replace />;
  }

  const inTransit = transfers.filter((t) => t.status === "ENVIADA");
  const drafts = transfers.filter((t) => t.status === "BORRADOR");

  return (
    <div className="mx-auto max-w-[76rem] space-y-4 pf-safe-page">
      {/* Lo que importa vigilar: mercancia que salio y todavia no llego. */}
      <section className="flex flex-wrap items-end gap-x-10 gap-y-4 border-b border-pf-border pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">En tránsito</p>
          <p
            className={`mt-1 text-3xl font-bold tabular-nums tracking-tight ${
              inTransit.length > 0 ? "text-pf-warning" : "text-pf-text"
            }`}
          >
            {inTransit.length}
          </p>
          <p className="mt-0.5 text-xs text-pf-text-tertiary">
            {inTransit.length === 0
              ? "Nada viajando entre ubicaciones"
              : "enviados y sin recibir; ese stock no está disponible"}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Borradores</p>
          <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-pf-text-tertiary">{drafts.length}</p>
          <p className="mt-0.5 text-xs text-pf-text-tertiary">
            {drafts.length === 0 ? "Ninguno sin enviar" : "preparados, aún sin enviar"}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="ml-auto min-h-10 self-center"
          onClick={() => void loadTransfers()}
          title="Recargar traslados"
          aria-label="Recargar traslados"
        >
          <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
        </Button>
      </section>

      {admin ? (
        <Card className="space-y-2 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Nueva ubicación</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Código" className="min-w-[100px]">
              <Input value={newLocCode} onChange={(e) => setNewLocCode(e.target.value)} placeholder="ej. SUC2" />
            </Field>
            <Field label="Nombre" className="min-w-[180px] flex-1">
              <Input value={newLocName} onChange={(e) => setNewLocName(e.target.value)} placeholder="Sucursal norte" />
            </Field>
            <Button type="button" variant="secondary" className="min-h-11 sm:min-h-10" disabled={locBusy} onClick={() => void addStockLocation()}>
              <Plus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              Agregar
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 shrink-0 text-pf-text-tertiary" strokeWidth={2} aria-hidden />
          <h2 className="text-sm font-bold text-pf-text">Nuevo traslado</h2>
        </div>
        <p className="text-xs text-pf-text-tertiary">
          Al enviarlo, el stock sale de la ubicación de origen y queda en tránsito. Vuelve a estar disponible cuando se
          recibe en el destino.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Desde">
            <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {locOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hacia">
            <Select value={toId} onChange={(e) => setToId(e.target.value)}>
              {locOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Notas (opcional)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referencia interna…" />
        </Field>
        <Field label="Buscar producto">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o SKU" />
        </Field>
        {hits.length > 0 ? (
          <ul className="max-h-48 divide-y divide-pf-border overflow-y-auto rounded-[var(--radius-pf)] border border-pf-border text-sm">
            {hits.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full touch-manipulation items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-pf-surface focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
                  onClick={() => addProduct(p)}
                >
                  <span className="font-medium truncate">{p.name}</span>
                  <span className="shrink-0 text-xs text-pf-muted">Stock {p.stock}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {lines.length > 0 ? (
          <div className="overflow-x-auto rounded-2xl border border-white/60 bg-white/85 shadow-inner backdrop-blur-sm">
            <table className="w-full min-w-[400px] text-sm">
              <thead>
                <tr className="border-b border-pf-border text-left text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Producto</th>
                  <th scope="col" className="w-28 px-3 py-2 font-semibold">Cant.</th>
                  <th scope="col" className="w-12 px-3 py-2"><span className="sr-only">Quitar</span></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.productId} className="border-b border-pf-border last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-medium text-pf-text">{l.product.name}</span>
                      <span className="block font-mono text-xs text-pf-muted">{l.product.sku}</span>
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        step="any"
                        className="min-h-11 py-2 sm:min-h-9 sm:py-1"
                        value={l.qty}
                        onChange={(e) => updateQty(i, Number(e.target.value) || 0)}
                      />
                    </td>
                    <td className="p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 touch-manipulation text-xs font-bold text-pf-danger sm:min-h-9"
                        onClick={() => removeLine(i)}
                      >
                        Quitar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-pf-muted">Agregue productos para crear el borrador.</p>
        )}
        {err ? (
          <p className="rounded-xl border border-pf-danger-soft bg-pf-danger-soft/80 px-3 py-2 text-sm font-medium text-pf-danger">{err}</p>
        ) : null}
        <Button
          type="button"
          className="min-h-[52px] w-full text-base shadow-lg sm:w-auto"
          disabled={busy || lines.length === 0 || fromId === toId}
          onClick={() => void submitDraft()}
        >
          <ClipboardCheck className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          {busy ? "Guardando…" : "Guardar borrador"}
        </Button>
      </Card>

      <Card className="space-y-2 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-pf-muted">Importar traslado (JSON)</p>
        <p className="text-xs text-pf-text-tertiary">
          Crea un <strong>borrador</strong> con las mismas líneas (SKU y cantidades) entre ubicaciones con los códigos indicados en el archivo.
        </p>
        <Input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => void importTransferFile(e.target.files?.[0] ?? null)}
        />
      </Card>

      <Card className="overflow-hidden p-0">
        <h2 className="border-b border-pf-border px-4 py-3 text-sm font-bold text-pf-text">Traslados</h2>
        {loading ? (
          <p className="p-8 text-center text-sm text-pf-muted">Cargando…</p>
        ) : transfers.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium text-pf-text">Todavía no hay traslados</p>
            <p className="mt-1 text-sm text-pf-text-tertiary">
              Sirven para mover mercancía entre ubicaciones sin perderle el rastro.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <caption className="sr-only">Traslados de inventario entre ubicaciones</caption>
            <thead>
              <tr className="border-b border-pf-border text-left text-[11px] font-semibold uppercase tracking-wider text-pf-muted">
                <th scope="col" className="px-4 py-2.5 font-semibold">Número</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Estado</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">De → a</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Contiene</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => {
                const names = (t.lines ?? []).map((l) => l.product?.name).filter(Boolean);
                const content =
                  names.length === 0
                    ? "Sin productos"
                    : names.length > 2
                      ? `${names.slice(0, 2).join(", ")} y ${names.length - 2} más`
                      : names.join(", ");
                return (
                <tr key={t.id} className="border-b border-pf-border last:border-0 hover:bg-pf-surface">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-pf-text-tertiary">
                    {t.transferNumber ?? "—"}
                    <span className="mt-0.5 block font-sans text-xs text-pf-muted">{t.user.displayName}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                        t.status === "RECIBIDA"
                          ? "bg-pf-success-soft text-pf-success"
                          : t.status === "ENVIADA"
                            ? "bg-pf-warning-soft text-pf-warning"
                            : "bg-pf-surface-muted text-pf-text-tertiary"
                      }`}
                    >
                      {statusLabel(t.status)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-pf-text">
                    {t.fromLocation.code} → {t.toLocation.code}
                  </td>
                  <td className="max-w-0 truncate px-4 py-3 text-pf-text-tertiary">{content}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-10 py-2 text-xs sm:min-h-8 sm:py-1"
                        title="Vista para impresión"
                        onClick={() => void printTransferHtml(t.id)}
                      >
                        <Printer className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
                        Imprimir
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-10 py-2 text-xs sm:min-h-8 sm:py-1"
                        title="Descargar JSON para otra tienda"
                        onClick={() => void exportTransferFile(t.id, t.transferNumber)}
                      >
                        <Download className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
                        JSON
                      </Button>
                      {t.status === "BORRADOR" ? (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            className="min-h-10 py-2 text-xs sm:min-h-8 sm:py-1"
                            onClick={() => void sendTransfer(t.id)}
                          >
                            <Send className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
                            Enviar
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="min-h-9 text-xs !text-pf-danger"
                            onClick={() => void cancelTransfer(t.id)}
                          >
                            <Ban className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                            Anular
                          </Button>
                        </>
                      ) : null}
                      {t.status === "ENVIADA" ? (
                        <>
                          <Button
                            type="button"
                            className="min-h-10 py-2 text-xs sm:min-h-8 sm:py-1"
                            onClick={() => void receiveTransfer(t.id)}
                          >
                            <PackageCheck className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
                            Recibir
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="min-h-9 text-xs !text-pf-danger"
                            onClick={() => void cancelTransfer(t.id)}
                          >
                            <Ban className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                            Anular envío
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </div>
  );
}
