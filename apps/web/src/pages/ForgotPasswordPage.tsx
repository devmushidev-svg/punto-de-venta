import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { BrandLogo } from "../components/BrandLogo";
import { Button, Card, Field, Input } from "../components/ui";

type OrgRow = { id: string; slug: string; name: string };

export function ForgotPasswordPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [orgId, setOrgId] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    apiFetch<OrgRow[]>("/auth/organizations")
      .then((list) => {
        setOrgs(list);
        if (list.length === 1) setOrgId(list[0].id);
      })
      .catch(() => setOrgs([]));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    setBusy(true);
    try {
      await apiFetch<{ ok?: boolean; message?: string; error?: string }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({
          organizationId: orgId.trim(),
          username: username.trim(),
        }),
      });
      setMsg("Si los datos son correctos, revise el correo de recuperación configurado en la empresa.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen min-h-dvh flex flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div className="pf-auth-backdrop" aria-hidden />
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex justify-center">
          <div className="pf-login-logo-shell">
            <BrandLogo size={64} withShadow className="rounded-2xl" title="MultiPOS" />
          </div>
        </div>
        <h1 className="pf-app-title-xl">Recuperar acceso</h1>
        <p className="mt-2 max-w-sm text-sm text-pf-text-tertiary">
          Se enviará un enlace al correo de recuperación de la empresa (configurado en Empresa). Requiere SMTP en el servidor.
        </p>
      </div>

      <Card className="pf-login-card w-full max-w-md p-6 sm:p-8">
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <Field label="Empresa">
            <select
              className="w-full min-h-[48px] rounded-xl border border-stone-200/90 bg-white/95 px-3.5 py-2.5 text-stone-900 md:min-h-[44px] md:rounded-[var(--radius-pf)]"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              required={orgs.length > 0}
            >
              {orgs.length === 0 ? (
                <option value="">Sin empresas</option>
              ) : (
                <>
                  <option value="">Seleccione…</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </>
              )}
            </select>
          </Field>
          <Field label="Usuario">
            <Input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Ej. ADMIN"
              required
            />
          </Field>
          {err ? <p className="text-sm text-red-600">{err}</p> : null}
          {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
          <Button type="submit" className="w-full" disabled={busy || !orgId || !username.trim()}>
            {busy ? "Enviando…" : "Enviar enlace"}
          </Button>
        </form>
        <Link
          to="/login"
          className="mt-6 inline-flex items-center justify-center gap-2 text-sm font-medium text-pf-primary-hover hover:underline"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
          Volver al inicio de sesión
        </Link>
      </Card>
    </div>
  );
}
