import { ChevronDown, ChevronUp, Download, Eye, EyeOff, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { Link, Navigate } from "react-router-dom";
import { apiDownload, apiFetch, apiUrl } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Textarea } from "../components/ui";
import type { PfThemeId } from "../theme/pfTheme";
import { usePfTheme } from "../theme/ThemeProvider";

type Tab = "apariencia" | "ticket" | "avanzado";

type TicketSettings = {
  headerLine: string;
  footerLine: string;
  showTaxBreakdown: boolean;
};

type ComprobanteSettings = {
  title: string;
  showSku: boolean;
};

type KitchenSettings = { kitchenPrintEnabled?: boolean; kitchenPrinterName?: string };
type SarSettings = {
  autoNumber?: boolean;
  series?: string;
  nextNum?: number;
  rangeEnd?: number;
  /** Fecha límite de autorización (YYYY-MM-DD); bloquea ventas con fecha posterior. */
  rangeValidUntil?: string;
  footerSar?: string;
};

type InvoiceShape = {
  ticket: TicketSettings;
  comprobante: ComprobanteSettings;
  kitchen?: KitchenSettings;
  sar?: SarSettings;
};

const DEFAULT_TICKET: TicketSettings = { headerLine: "", footerLine: "Gracias por su compra", showTaxBreakdown: true };
const DEFAULT_COMPROBANTE: ComprobanteSettings = { title: "Comprobante de venta", showSku: true };

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 touch-manipulation">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
          checked
            ? "border-pf-primary bg-pf-primary"
            : "border-pf-border-strong bg-pf-surface-muted"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-[1.375rem]" : "translate-x-1"
          }`}
        />
      </button>
      <span className="text-sm font-medium text-pf-text">{label}</span>
    </label>
  );
}

export function SettingsPage() {
  const { token, user } = useAuth();
  const { theme, setTheme } = usePfTheme();
  const admin = user?.role === "admin";
  const [tab, setTab] = useState<Tab>("apariencia");

  const [ticket, setTicket] = useState<TicketSettings>({ ...DEFAULT_TICKET });
  const [comprobante, setComprobante] = useState<ComprobanteSettings>({ ...DEFAULT_COMPROBANTE });
  const [kitchenPrintEnabled, setKitchenPrintEnabled] = useState(false);
  const [kitchenPrinterName, setKitchenPrinterName] = useState("");
  const [sarAutoNumber, setSarAutoNumber] = useState(false);
  const [sarSeries, setSarSeries] = useState("");
  const [sarNextNum, setSarNextNum] = useState("");
  const [sarRangeEnd, setSarRangeEnd] = useState("");
  const [sarRangeValidUntil, setSarRangeValidUntil] = useState("");
  const [sarFooter, setSarFooter] = useState("");

  const [generalJson, setGeneralJson] = useState("{}");
  const [showRawInvoice, setShowRawInvoice] = useState(false);

  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const load = useCallback(async () => {
    if (!token || !admin) return;
    try {
      const data = await apiFetch<{ general: Record<string, unknown>; invoice: InvoiceShape }>(
        "/api/settings",
        { token }
      );
      setGeneralJson(JSON.stringify(data.general ?? {}, null, 2));
      if (data.invoice?.ticket) {
        setTicket({
          headerLine: data.invoice.ticket.headerLine ?? DEFAULT_TICKET.headerLine,
          footerLine: data.invoice.ticket.footerLine ?? DEFAULT_TICKET.footerLine,
          showTaxBreakdown: data.invoice.ticket.showTaxBreakdown ?? DEFAULT_TICKET.showTaxBreakdown,
        });
      }
      if (data.invoice?.comprobante) {
        setComprobante({
          title: data.invoice.comprobante.title ?? DEFAULT_COMPROBANTE.title,
          showSku: data.invoice.comprobante.showSku ?? DEFAULT_COMPROBANTE.showSku,
        });
      }
      const k = data.invoice?.kitchen;
      if (k) {
        setKitchenPrintEnabled(!!k.kitchenPrintEnabled);
        setKitchenPrinterName(typeof k.kitchenPrinterName === "string" ? k.kitchenPrinterName : "");
      }
      const sar = data.invoice?.sar;
      if (sar) {
        setSarAutoNumber(!!sar.autoNumber);
        setSarSeries(typeof sar.series === "string" ? sar.series : "");
        setSarNextNum(sar.nextNum != null ? String(sar.nextNum) : "");
        setSarRangeEnd(sar.rangeEnd != null ? String(sar.rangeEnd) : "");
        setSarRangeValidUntil(typeof sar.rangeValidUntil === "string" ? sar.rangeValidUntil : "");
        setSarFooter(typeof sar.footerSar === "string" ? sar.footerSar : "");
      }
    } catch {
      /* ignore */
    }
  }, [token, admin]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!token || !admin) return;
    setErr("");
    setOk("");
    let general: Record<string, unknown>;
    try {
      general = JSON.parse(generalJson) as Record<string, unknown>;
    } catch {
      setErr("JSON inválido en la pestaña Avanzado");
      return;
    }
    const invoice: InvoiceShape = {
      ticket,
      comprobante,
      kitchen: {
        kitchenPrintEnabled,
        kitchenPrinterName: kitchenPrinterName.trim() || undefined,
      },
      sar: {
        autoNumber: sarAutoNumber,
        series: sarSeries.trim() || undefined,
        nextNum: sarNextNum.trim() ? Math.trunc(Number(sarNextNum)) || undefined : undefined,
        rangeEnd: sarRangeEnd.trim() ? Math.trunc(Number(sarRangeEnd)) || undefined : undefined,
        rangeValidUntil: sarRangeValidUntil.trim() || undefined,
        footerSar: sarFooter.trim() || undefined,
      },
    };
    setBusy(true);
    try {
      await apiFetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ general, invoice }),
        token,
      });
      setOk("Configuración guardada correctamente");
      setTimeout(() => setOk(""), 4000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadExcelImport(kind: "products" | "customers" | "suppliers", file: File | null) {
    if (!token || !admin || !file) return;
    setImportMsg("");
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.set("type", kind);
      fd.set("file", file);
      const res = await fetch(apiUrl("/api/import/excel"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const j = (await res.json()) as { imported?: number; errors?: string[]; error?: string };
      if (!res.ok) throw new Error(j.error ?? "Error");
      const errs = j.errors?.length ? ` · Avisos: ${j.errors.slice(0, 5).join("; ")}` : "";
      setImportMsg(`Importados: ${j.imported ?? 0}${errs}`);
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setImportBusy(false);
    }
  }

  async function mergeBackupMaster(file: File | null) {
    if (!token || !admin || !file) return;
    if (!window.confirm("¿Fusionar catálogos desde este respaldo? No borra ventas existentes.")) return;
    setImportMsg("");
    setImportBusy(true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;
      const r = await apiFetch<{ ok: boolean; products?: number; customers?: number }>("/api/backup/import", {
        method: "POST",
        body: JSON.stringify({ payload, confirm: "MERGE_MASTER" }),
        token,
      });
      setImportMsg(
        `Fusión lista: productos ${r.products ?? 0}, clientes ${r.customers ?? 0}, proveedores ${(r as { suppliers?: number }).suppliers ?? 0}, ubicaciones ${(r as { stockLocations?: number }).stockLocations ?? 0}.`
      );
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setImportBusy(false);
    }
  }

  async function downloadBackup() {
    if (!token || !admin) return;
    setBackupBusy(true);
    setErr("");
    try {
      const blob = await apiDownload("/api/backup/export", token);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `multipos-backup-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al descargar");
    } finally {
      setBackupBusy(false);
    }
  }

  async function downloadImportTemplate(kind: "products" | "customers" | "suppliers") {
    if (!token || !admin) return;
    setErr("");
    try {
      const blob = await apiDownload(`/api/import/template?type=${kind}`, token);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `plantilla-${kind}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al descargar plantilla");
    }
  }

  if (!admin) return <Navigate to="/" replace />;

  const tabs: { id: Tab; label: string }[] = [
    { id: "apariencia", label: "Apariencia" },
    { id: "ticket", label: "Factura y ticket" },
    { id: "avanzado", label: "Avanzado" },
  ];

  return (
    <div className="space-y-4 pf-safe-page">
      <PageHero title="Configuración">
        <p className="pf-page-lead">
          Personaliza la apariencia, configura tickets y respalda tus datos.{" "}
          <Link
            to="/ayuda"
            className="font-bold text-pf-primary-hover underline-offset-2 hover:underline touch-manipulation"
          >
            Ayuda / FAQ
          </Link>
        </p>
      </PageHero>

      {/* Tab navigation */}
      <nav className="pf-settings-tabs-nav" aria-label="Secciones de configuración">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`min-h-[44px] touch-manipulation rounded-xl px-4 py-2.5 text-sm font-bold transition sm:min-h-0 sm:py-2 ${
              tab === id ? "pf-settings-tab-active" : "pf-settings-tab-idle"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="min-w-0 space-y-4">
        {/* ─── Apariencia ─── */}
        {tab === "apariencia" && (
          <Card className="pf-glass-card-panel space-y-5 p-4 md:p-5">
            <div>
              <p className="text-sm font-bold text-pf-text">Tema visual</p>
              <p className="mt-0.5 text-xs text-pf-text-tertiary">Se guarda solo en este navegador.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { id: "default" as PfThemeId, label: "Cobre", desc: "Cálido y acogedor", color: "bg-[#f4a574]" },
                { id: "slate" as PfThemeId, label: "Pizarra", desc: "Neutro y sobrio", color: "bg-[#64748b]" },
                { id: "ocean" as PfThemeId, label: "Océano", desc: "Frío y profesional", color: "bg-[#2494c7]" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTheme(t.id)}
                  className={`flex items-center gap-3 rounded-xl border p-4 text-left transition touch-manipulation ${
                    theme === t.id
                      ? "border-pf-primary bg-pf-primary-soft/40 shadow-md"
                      : "border-pf-border-soft bg-pf-surface-elevated hover:bg-pf-surface-muted"
                  }`}
                >
                  <div className={`h-8 w-8 shrink-0 rounded-full shadow-sm ${t.color}`} />
                  <div>
                    <p className="text-sm font-bold text-pf-text">{t.label}</p>
                    <p className="text-xs text-pf-text-tertiary">{t.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        )}

        {/* ─── Factura y Ticket ─── */}
        {tab === "ticket" && (
          <>
            <Card className="pf-glass-card-panel space-y-4 p-4 md:p-5">
              <p className="text-sm font-bold text-pf-text">Ticket térmico</p>
              <p className="text-xs text-pf-text-tertiary">Texto que aparece en la impresión del ticket de venta.</p>
              <Field label="Encabezado del ticket">
                <Input
                  value={ticket.headerLine}
                  onChange={(e) => setTicket({ ...ticket, headerLine: e.target.value })}
                  placeholder="Ej: Sucursal Centro"
                />
              </Field>
              <Field label="Pie del ticket">
                <Input
                  value={ticket.footerLine}
                  onChange={(e) => setTicket({ ...ticket, footerLine: e.target.value })}
                  placeholder="Ej: Gracias por su compra"
                />
              </Field>
              <Toggle
                checked={ticket.showTaxBreakdown}
                onChange={(v) => setTicket({ ...ticket, showTaxBreakdown: v })}
                label="Mostrar desglose de impuestos"
              />
            </Card>

            <Card className="pf-glass-card-panel space-y-4 p-4 md:p-5">
              <p className="text-sm font-bold text-pf-text">Comprobante (carta / PDF)</p>
              <p className="text-xs text-pf-text-tertiary">Configuración del documento impreso en formato carta.</p>
              <Field label="Título del comprobante">
                <Input
                  value={comprobante.title}
                  onChange={(e) => setComprobante({ ...comprobante, title: e.target.value })}
                  placeholder="Ej: Comprobante de venta"
                />
              </Field>
              <Toggle
                checked={comprobante.showSku}
                onChange={(v) => setComprobante({ ...comprobante, showSku: v })}
                label="Mostrar SKU en el comprobante"
              />
            </Card>

            <Card className="pf-glass-card-panel space-y-4 p-4 md:p-5">
              <p className="text-sm font-bold text-pf-text">PreVenta / cocina</p>
              <p className="text-xs text-pf-text-tertiary">
                Al guardar cotización o PreVenta, puede abrirse una ventana de impresión con los productos marcados para cocina.
              </p>
              <Toggle
                checked={kitchenPrintEnabled}
                onChange={setKitchenPrintEnabled}
                label="Imprimir orden de cocina al guardar"
              />
              <Field label="Nombre impresora (referencia / notas)">
                <Input
                  value={kitchenPrinterName}
                  onChange={(e) => setKitchenPrinterName(e.target.value)}
                  placeholder="Opcional; en web se usa ventana de impresión del navegador"
                />
              </Field>
            </Card>

            <Card className="pf-glass-card-panel space-y-4 p-4 md:p-5">
              <p className="text-sm font-bold text-pf-text">Facturación SAR (Honduras)</p>
              <p className="text-xs text-pf-text-tertiary">
                Numeración automática al crear ventas. El API valida el tope del rango si está configurado.
              </p>
              <Toggle checked={sarAutoNumber} onChange={setSarAutoNumber} label="Numeración automática SAR" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Serie">
                  <Input value={sarSeries} onChange={(e) => setSarSeries(e.target.value)} placeholder="Ej: A" />
                </Field>
                <Field label="Siguiente número">
                  <Input value={sarNextNum} onChange={(e) => setSarNextNum(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Fin de rango (tope)">
                  <Input value={sarRangeEnd} onChange={(e) => setSarRangeEnd(e.target.value)} inputMode="numeric" />
                </Field>
              </div>
              <Field label="Válido hasta (autorización SAR)">
                <Input type="date" value={sarRangeValidUntil} onChange={(e) => setSarRangeValidUntil(e.target.value)} />
                <p className="mt-1 text-[11px] text-pf-text-tertiary">
                  Opcional. Bloquea ventas con fecha de documento posterior a este día.
                </p>
              </Field>
              <Field label="Texto pie SAR / CAI">
                <Input value={sarFooter} onChange={(e) => setSarFooter(e.target.value)} placeholder="Texto legal en factura" />
              </Field>
            </Card>

            <button
              type="button"
              onClick={() => setShowRawInvoice(!showRawInvoice)}
              className="flex items-center gap-1.5 text-xs font-medium text-pf-muted hover:text-pf-text-tertiary transition touch-manipulation"
            >
              {showRawInvoice ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showRawInvoice ? "Ocultar JSON" : "Ver JSON generado"}
              {showRawInvoice ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {showRawInvoice && (
              <Card className="pf-glass-card-panel p-4">
                <pre className="overflow-x-auto rounded-lg bg-pf-surface-muted/60 p-3 text-xs font-mono text-pf-text-tertiary">
                  {JSON.stringify(
                    {
                      ticket,
                      comprobante,
                      kitchen: { kitchenPrintEnabled, kitchenPrinterName },
                      sar: {
                        autoNumber: sarAutoNumber,
                        series: sarSeries,
                        nextNum: sarNextNum,
                        rangeEnd: sarRangeEnd,
                        rangeValidUntil: sarRangeValidUntil,
                        footerSar: sarFooter,
                      },
                    },
                    null,
                    2
                  )}
                </pre>
              </Card>
            )}
          </>
        )}

        {/* ─── Avanzado ─── */}
        {tab === "avanzado" && (
          <>
            <Card className="pf-glass-card-panel space-y-4 p-4 md:p-5">
              <div>
                <p className="text-sm font-bold text-pf-text">Configuración general (JSON)</p>
                <p className="mt-0.5 text-xs text-pf-text-tertiary">
                  Objeto JSON fusionado con el existente. Incluye por ejemplo{" "}
                  <code className="rounded bg-pf-surface-muted px-1 text-[11px] font-semibold">touchFavoriteProductIds</code>{" "}
                  desde venta táctil.
                </p>
              </div>
              <Textarea
                className="font-mono text-xs min-h-[240px]"
                value={generalJson}
                onChange={(e) => setGeneralJson(e.target.value)}
                spellCheck={false}
              />
            </Card>

            <Card className="pf-glass-card-panel space-y-4 p-4 md:p-5">
              <div>
                <p className="text-sm font-bold text-pf-text">Copia de seguridad</p>
                <p className="mt-0.5 text-xs text-pf-text-tertiary">
                  Descarga un archivo JSON con todos los datos de tu organización.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="min-h-[48px] w-full shadow-md sm:w-auto sm:min-h-11"
                onClick={downloadBackup}
                disabled={backupBusy}
              >
                <Download className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                {backupBusy ? "Descargando…" : "Descargar respaldo JSON"}
              </Button>
              <div className="border-t border-pf-border/60 pt-4">
                <p className="text-sm font-bold text-pf-text">Importar datos maestros (merge)</p>
                <p className="mt-0.5 text-xs text-pf-text-tertiary">
                  Fusiona productos, clientes, proveedores, ubicaciones y libros de gastos desde un JSON exportado. No elimina ventas.
                </p>
                <Input
                  type="file"
                  accept="application/json,.json"
                  className="mt-2 text-sm"
                  disabled={importBusy}
                  onChange={(e) => void mergeBackupMaster(e.target.files?.[0] ?? null)}
                />
              </div>
            </Card>

            <Card className="pf-glass-card-panel space-y-4 p-4 md:p-5">
              <div>
                <p className="text-sm font-bold text-pf-text">Importar Excel</p>
                <p className="mt-0.5 text-xs text-pf-text-tertiary">
                  Plantillas: productos, clientes o proveedores. Primera fila = encabezados.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-10"
                  disabled={importBusy}
                  onClick={() => void downloadImportTemplate("products")}
                >
                  Plantilla productos
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-10"
                  disabled={importBusy}
                  onClick={() => void downloadImportTemplate("customers")}
                >
                  Plantilla clientes
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-10"
                  disabled={importBusy}
                  onClick={() => void downloadImportTemplate("suppliers")}
                >
                  Plantilla proveedores
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="text-xs font-semibold text-pf-text-tertiary">
                  Productos (.xlsx)
                  <Input
                    type="file"
                    accept=".xlsx"
                    className="mt-1"
                    disabled={importBusy}
                    onChange={(e) => void uploadExcelImport("products", e.target.files?.[0] ?? null)}
                  />
                </label>
                <label className="text-xs font-semibold text-pf-text-tertiary">
                  Clientes (.xlsx)
                  <Input
                    type="file"
                    accept=".xlsx"
                    className="mt-1"
                    disabled={importBusy}
                    onChange={(e) => void uploadExcelImport("customers", e.target.files?.[0] ?? null)}
                  />
                </label>
                <label className="text-xs font-semibold text-pf-text-tertiary">
                  Proveedores (.xlsx)
                  <Input
                    type="file"
                    accept=".xlsx"
                    className="mt-1"
                    disabled={importBusy}
                    onChange={(e) => void uploadExcelImport("suppliers", e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              {importMsg ? (
                <p className="rounded-lg border border-pf-border bg-pf-surface-soft px-3 py-2 text-xs font-medium text-pf-text">{importMsg}</p>
              ) : null}
            </Card>
          </>
        )}

        {/* Messages */}
        {err && (
          <p className="rounded-xl border border-pf-danger-soft bg-pf-danger-soft/40 px-3 py-2 text-sm font-medium text-pf-danger">{err}</p>
        )}
        {ok && (
          <p className="rounded-xl border border-pf-success-soft bg-pf-success-soft/40 px-3 py-2 text-sm font-medium text-pf-success">{ok}</p>
        )}

        {/* Save button */}
        <Button type="button" className="min-h-[52px] w-full shadow-lg sm:w-auto sm:min-h-11" onClick={save} disabled={busy}>
          <Save className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          {busy ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </div>
  );
}
