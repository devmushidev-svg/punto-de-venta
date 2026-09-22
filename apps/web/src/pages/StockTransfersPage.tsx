import { ArrowLeftRight, Ban, ClipboardCheck, Download, PackageCheck, Plus, Printer, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
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

  return (
    <div className="space-y-4 pf-safe-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHero title={"Traslados de inventario"} constrained>
          <p className="mt-1.5 text-sm font-medium text-stone-700 max-w-xl">
            Mueva mercadería entre ubicaciones. Al <strong className="font-semibold text-stone-800">enviar</strong> baja el stock global (mercancía en
            tránsito); al <strong className="font-semibold text-stone-800">recibir</strong> vuelve a subir. Útil cuando el total del catálogo representa
            existencias vendibles de la empresa.
          </p>
        </PageHero>
        <Button
          type="button"
          variant="secondary"
          className="min-h-[48px] w-full shrink-0 shadow-md sm:w-auto sm:min-h-[44px]"
          onClick={() => void loadTransfers()}
        >
          <RefreshCw className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" strokeWidth={2} aria-hidden />
          Actualizar
        </Button>
      </div>

      {admin ? (
        <Card className="space-y-2 border-white/50 bg-gradient-to-br from-violet-50/40 via-white/95 to-cyan-50/20 p-3 shadow-lg backdrop-blur-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-stone-600">Nueva ubicación (admin)</p>
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

      <Card className="space-y-4 border-white/50 bg-gradient-to-br from-white/92 via-cyan-50/18 to-indigo-50/20 p-4 shadow-lg backdrop-blur-sm md:p-5">
        <div className="flex items-center gap-2 text-stone-800">
          <ArrowLeftRight className="h-5 w-5 shrink-0 text-cyan-700/80" strokeWidth={2} aria-hidden />
          <h2 className="text-lg font-bold text-stone-900">Nuevo traslado (borrador)</h2>
        </div>
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
          <ul className="max-h-48 divide-y divide-stone-100/90 overflow-y-auto rounded-2xl border border-white/60 bg-white/80 text-sm shadow-inner backdrop-blur-sm">
            {hits.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex min-h-[52px] w-full touch-manipulation items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-gradient-to-r hover:from-cyan-50/80 hover:to-transparent"
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
                <tr className="bg-gradient-to-r from-cyan-50/95 to-indigo-50/50 text-left text-xs font-bold text-stone-700">
                  <th className="p-2">Producto</th>
                  <th className="p-2 w-28">Cant.</th>
                  <th className="p-2 w-12" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.productId} className="border-t border-stone-100/90 transition hover:bg-cyan-50/25">
                    <td className="p-2">
                      <span className="font-bold text-stone-900">{l.product.name}</span>
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
                        className="min-h-11 touch-manipulation text-xs font-bold text-red-700 sm:min-h-9"
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
          <p className="rounded-xl border border-red-100 bg-red-50/80 px-3 py-2 text-sm font-medium text-red-700">{err}</p>
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

      <Card className="space-y-2 border-white/50 bg-gradient-to-br from-white/92 via-cyan-50/12 to-indigo-50/15 p-4 shadow-lg backdrop-blur-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-stone-600">Importar archivo de traslado (JSON)</p>
        <p className="text-xs text-stone-600">
          Crea un <strong>borrador</strong> con las mismas líneas (SKU y cantidades) entre ubicaciones con los códigos indicados en el archivo.
        </p>
        <Input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => void importTransferFile(e.target.files?.[0] ?? null)}
        />
      </Card>

      <Card className="overflow-x-auto border-white/50 bg-gradient-to-br from-white/92 via-cyan-50/12 to-indigo-50/15 p-0 shadow-lg backdrop-blur-sm">
        <h2 className="border-b border-stone-200/80 bg-gradient-to-r from-white/90 to-cyan-50/35 px-4 py-3 text-lg font-bold text-stone-900">
          Historial
        </h2>
        {loading ? (
          <p className="p-6 text-center font-medium text-pf-muted">Cargando…</p>
        ) : transfers.length === 0 ? (
          <p className="p-6 text-center font-medium text-pf-muted">No hay traslados registrados.</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-stone-200/80 bg-gradient-to-r from-cyan-50/90 to-indigo-50/60 text-left text-xs font-bold text-stone-700 shadow-sm backdrop-blur-md">
                <th className="p-2">Número</th>
                <th className="p-2">Estado</th>
                <th className="p-2">Ruta</th>
                <th className="p-2">Líneas</th>
                <th className="p-2">Usuario</th>
                <th className="w-52 p-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id} className="border-b border-stone-100/90 transition hover:bg-cyan-50/30">
                  <td className="p-2 font-mono text-xs">{t.transferNumber ?? "—"}</td>
                  <td className="p-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        t.status === "RECIBIDA"
                          ? "bg-emerald-100 text-emerald-900"
                          : t.status === "ENVIADA"
                            ? "bg-amber-100 text-amber-900"
                            : t.status === "ANULADA"
                              ? "bg-stone-200 text-stone-600"
                              : "bg-stone-100 text-stone-700"
                      }`}
                    >
                      {statusLabel(t.status)}
                    </span>
                  </td>
                  <td className="p-2 text-xs">
                    {t.fromLocation.code} → {t.toLocation.code}
                  </td>
                  <td className="p-2 text-xs">{t.lines.length} ítem(s)</td>
                  <td className="p-2 text-xs text-pf-muted">{t.user.displayName}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
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
                            className="min-h-10 py-2 text-xs text-red-600 sm:min-h-8 sm:py-1"
                            onClick={() => void cancelTransfer(t.id)}
                          >
                            <Ban className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
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
                            className="min-h-10 py-2 text-xs text-red-600 sm:min-h-8 sm:py-1"
                            onClick={() => void cancelTransfer(t.id)}
                          >
                            <Ban className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
                            Anular envío
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
