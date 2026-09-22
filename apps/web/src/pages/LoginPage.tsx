import { CircleHelp, LogIn, Save, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, getApiBase, setApiBase } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { BrandLogo } from "../components/BrandLogo";
import { AppAmbient } from "../components/AppAmbient";
import { Button, Card, Field, Input, Modal } from "../components/ui";

type OrgRow = { id: string; slug: string; name: string };

export function LoginPage() {
  const { login, token, loading } = useAuth();
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [orgId, setOrgId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiBaseDraft, setApiBaseDraft] = useState(() => getApiBase());

  useEffect(() => {
    if (!loading && token) navigate("/", { replace: true });
  }, [loading, token, navigate]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<OrgRow[]>("/auth/organizations")
      .then(async (list) => {
        if (cancelled) return;
        setOrgs(list);
        const demoOrg = list.find((org) => org.slug === "demo");
        if (list.length === 1) setOrgId(list[0].id);

        // La base demo permite entrar directamente para poder probar el sistema
        // aunque todavía no se hayan creado usuarios propios.
        if (demoOrg) {
          setBusy(true);
          try {
            await login({ organizationId: demoOrg.id, username: "ADMIN", password: "admin" });
            if (!cancelled) navigate("/", { replace: true });
          } catch {
            // Si el seed todavía no se ejecutó, se mantiene el formulario normal.
          } finally {
            if (!cancelled) setBusy(false);
          }
        }
      })
      .catch(() => setOrgs([]));
    return () => {
      cancelled = true;
    };
  }, [login, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login({
        organizationId: orgId || undefined,
        organizationSlug: orgId ? undefined : undefined,
        username: username.trim(),
        password,
      });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pf-surface text-pf-muted">
        Cargando…
      </div>
    );
  }

  return (
    <div className="relative isolate min-h-screen min-h-dvh flex flex-col items-center justify-center overflow-hidden px-4 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="pf-auth-backdrop" aria-hidden />
      <AppAmbient className="opacity-70" />
      <div className="relative z-10 mb-8 text-center">
        <div className="mx-auto mb-5 flex justify-center">
          <div className="pf-login-logo-shell">
            <BrandLogo size={76} withShadow className="rounded-2xl" title="MultiPOS" />
          </div>
        </div>
        <h1 className="pf-app-title-xl">MultiPOS</h1>
        <p className="mt-2 mx-auto max-w-xs text-sm font-medium leading-relaxed text-pf-text-tertiary">
          Punto de venta claro y rápido para tu negocio
        </p>
      </div>

      <Card className="relative z-10 pf-login-card p-6 sm:p-8">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Empresa">
            <select
              className="w-full min-h-[48px] rounded-xl border border-pf-border/90 bg-white/95 px-3.5 py-2.5 text-pf-text shadow-inner focus:border-pf-primary focus:ring-2 focus:ring-pf-primary/25 focus:outline-none md:min-h-[44px] md:rounded-[var(--radius-pf)] md:border-pf-border md:bg-white md:shadow-none"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              required={orgs.length > 0}
            >
              {orgs.length === 0 ? (
                <option value="">Sin empresas (ejecute seed)</option>
              ) : (
                <>
                  <option value="">Seleccione empresa…</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </>
              )}
            </select>
          </Field>
          {orgs.find((o) => o.id === orgId)?.slug === "demo" ? (
            <p className="text-xs text-pf-muted leading-relaxed -mt-1">
              Base <strong className="text-pf-text-secondary">demo</strong> (tras <code className="rounded bg-pf-surface px-1 text-[11px]">npm run db:seed</code>
              ): <strong className="text-pf-text-secondary">ADMIN</strong> / <strong className="text-pf-text-secondary">admin</strong> o{" "}
              <strong className="text-pf-text-secondary">CAJERO</strong> / <strong className="text-pf-text-secondary">cajero</strong> — mismo espíritu que el manual Smart POS.
            </p>
          ) : null}
          <Field label="Usuario">
            <Input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Ej. ADMIN"
              required
            />
          </Field>
          <Field label="Contraseña">
            <div className="relative">
              <Input
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-24"
                required
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-pf-primary-hover hover:bg-pf-primary-soft"
                onClick={() => setShowPw((v) => !v)}
              >
                {showPw ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </Field>
          {error ? <p className="text-sm text-pf-danger">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy || (orgs.length > 0 && !orgId)}>
            <LogIn className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            {busy ? "Entrando…" : "Iniciar sesión"}
          </Button>
        </form>
        <div className="mt-4 flex flex-col items-center gap-2">
          <Link
            to="/ayuda-publica"
            className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-pf-primary-hover underline-offset-2 hover:underline"
          >
            <CircleHelp className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Ayuda / FAQ (sin iniciar sesión)
          </Link>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1.5 text-sm text-pf-muted underline-offset-2 hover:text-pf-primary-hover hover:underline"
            onClick={() => {
              setApiBaseDraft(getApiBase());
              setSettingsOpen(true);
            }}
          >
            <Settings2 className="h-4 w-4 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
            Ajustes avanzados (URL del API)
          </button>
        </div>
      </Card>

      <Modal
        open={settingsOpen}
        title="Ajustes avanzados"
        onClose={() => setSettingsOpen(false)}
        wide
      >
        <p className="mb-3 text-sm text-pf-muted">
          Si el API no corre en el mismo origen, indica la URL base (sin barra final), por ejemplo{" "}
          <code className="rounded bg-pf-primary-soft px-1">http://localhost:3001</code>
        </p>
        <Field label="URL base del API">
          <Input
            value={apiBaseDraft}
            onChange={(e) => setApiBaseDraft(e.target.value)}
            placeholder="Vacío = mismo servidor (proxy Vite)"
          />
        </Field>
        <div className="mt-4 flex flex-wrap gap-2 justify-end">
          <Button variant="secondary" type="button" onClick={() => setSettingsOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => {
              setApiBase(apiBaseDraft);
              setSettingsOpen(false);
            }}
          >
            <Save className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Guardar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
