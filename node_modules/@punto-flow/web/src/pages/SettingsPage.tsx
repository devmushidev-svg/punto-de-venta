import { Download, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { Link, Navigate } from "react-router-dom";
import { apiDownload, apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Select, Textarea } from "../components/ui";
import type { PfThemeId } from "../theme/pfTheme";
import { usePfTheme } from "../theme/ThemeProvider";

type Tab = "general" | "factura";

export function SettingsPage() {
  const { token, user } = useAuth();
  const { theme, setTheme } = usePfTheme();
  const admin = user?.role === "admin";
  const [tab, setTab] = useState<Tab>("general");
  const [generalJson, setGeneralJson] = useState("{}");
  const [invoiceJson, setInvoiceJson] = useState(
    JSON.stringify(
      {
        ticket: {
          headerLine: "",
          footerLine: "Gracias por su compra",
          showTaxBreakdown: true,
        },
        comprobante: {
          title: "Comprobante de venta",
          showSku: true,
        },
      },
      null,
      2
    )
  );
  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const load = useCallback(async () => {
    if (!token || !admin) return;
    try {
      const data = await apiFetch<{ general: Record<string, unknown>; invoice: Record<string, unknown> }>(
        "/api/settings",
        { token }
      );
      setGeneralJson(JSON.stringify(data.general ?? {}, null, 2));
      setInvoiceJson(JSON.stringify(data.invoice ?? {}, null, 2));
    } catch {
      /* ignore */
    }
  }, [token, admin]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!token || !admin) return;
    setErr("");
    setOk("");
    let general: Record<string, unknown>;
    let invoice: Record<string, unknown>;
    try {
      general = JSON.parse(generalJson) as Record<string, unknown>;
      invoice = JSON.parse(invoiceJson) as Record<string, unknown>;
    } catch {
      setErr("JSON inválido");
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ general, invoice }),
        token,
      });
      setOk("Guardado");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
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
      a.download = `punto-flow-backup-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al descargar");
    } finally {
      setBackupBusy(false);
    }
  }

  if (!admin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-4 pf-safe-page">
      <div className="space-y-4">
        <PageHero title="Configuración">
          <p className="pf-page-lead">
            Ajustes avanzados, texto del ticket y copia de seguridad.{" "}
            <Link
              to="/ayuda"
              className="font-bold text-pf-primary-hover underline-offset-2 hover:underline touch-manipulation"
            >
              Ayuda / FAQ
            </Link>
          </p>
        </PageHero>
        <Card className="pf-glass-card-panel space-y-3 p-4 md:p-5">
          <p className="text-sm font-semibold text-pf-text">Apariencia</p>
          <Field label="Tema visual">
            <Select value={theme} onChange={(e) => setTheme(e.target.value as PfThemeId)}>
              <option value="default">Claro (cálido)</option>
              <option value="slate">Neutro (pizarra)</option>
            </Select>
          </Field>
          <p className="pf-page-lead-muted">Se guarda solo en este navegador.</p>
        </Card>
        <nav className="pf-settings-tabs-nav" aria-label="Secciones de configuración">
          {(["general", "factura"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`min-h-[44px] touch-manipulation rounded-xl px-4 py-2.5 text-sm font-bold transition sm:min-h-0 sm:py-2 ${
                tab === id ? "pf-settings-tab-active" : "pf-settings-tab-idle"
              }`}
            >
              {id === "general" ? "General (JSON)" : "Factura y ticket"}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-w-0 space-y-4">
          {tab === "general" ? (
            <Card className="pf-glass-card-panel space-y-3 p-4 md:p-5">
              <p className="text-sm font-medium text-pf-text-tertiary">
                Objeto JSON fusionado con el existente. Incluye por ejemplo{" "}
                <code className="text-xs bg-stone-100 px-1 rounded">touchFavoriteProductIds</code> desde venta táctil.
              </p>
              <Field label="general">
                <Textarea
                  className="font-mono text-xs min-h-[240px]"
                  value={generalJson}
                  onChange={(e) => setGeneralJson(e.target.value)}
                  spellCheck={false}
                />
              </Field>
            </Card>
          ) : (
            <Card className="pf-glass-card-panel space-y-3 p-4 md:p-5">
              <p className="text-sm font-medium text-pf-text-tertiary">
                <code className="text-xs bg-stone-100 px-1 rounded">ticket</code>:{" "}
                <code className="text-xs bg-stone-100 px-1 rounded">headerLine</code>,{" "}
                <code className="text-xs bg-stone-100 px-1 rounded">footerLine</code>,{" "}
                <code className="text-xs bg-stone-100 px-1 rounded">showTaxBreakdown</code>.{" "}
                <code className="text-xs bg-stone-100 px-1 rounded">comprobante</code> (carta/PDF):{" "}
                <code className="text-xs bg-stone-100 px-1 rounded">title</code>,{" "}
                <code className="text-xs bg-stone-100 px-1 rounded">showSku</code> (boolean, default true).
              </p>
              <Field label="invoice (factura / ticket)">
                <Textarea
                  className="font-mono text-xs min-h-[280px]"
                  value={invoiceJson}
                  onChange={(e) => setInvoiceJson(e.target.value)}
                  spellCheck={false}
                />
              </Field>
            </Card>
          )}

          {err ? (
            <p className="rounded-xl border border-red-100 bg-red-50/80 px-3 py-2 text-sm font-medium text-red-700">{err}</p>
          ) : null}
          {ok ? (
            <p className="rounded-xl border border-emerald-100 bg-emerald-50/80 px-3 py-2 text-sm font-medium text-emerald-800">{ok}</p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button type="button" className="min-h-[52px] w-full shadow-lg sm:w-auto sm:min-h-11" onClick={save} disabled={busy}>
              <Save className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {busy ? "Guardando…" : "Guardar cambios"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-[52px] w-full shadow-md sm:w-auto sm:min-h-11"
              onClick={downloadBackup}
              disabled={backupBusy}
            >
              <Download className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {backupBusy ? "Descargando…" : "Descargar respaldo JSON"}
            </Button>
          </div>
      </div>
    </div>
  );
}
