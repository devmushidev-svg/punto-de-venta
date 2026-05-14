import { ArrowLeft, KeyRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../api/client";
import { BrandLogo } from "../components/BrandLogo";
import { Button, Card, Field, Input } from "../components/ui";

export function ResetPasswordPage() {
  const [search] = useSearchParams();
  const token = useMemo(() => search.get("token")?.trim() ?? "", [search]);
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (pw.length < 6) {
      setErr("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (pw !== pw2) {
      setErr("Las contraseñas no coinciden.");
      return;
    }
    if (!token) {
      setErr("Enlace inválido.");
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword: pw }),
      });
      setOk(true);
      window.setTimeout(() => navigate("/login", { replace: true }), 2000);
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
        <h1 className="pf-app-title-xl">Nueva contraseña</h1>
      </div>

      <Card className="pf-login-card w-full max-w-md p-6 sm:p-8">
        {!token ? (
          <p className="text-sm text-red-600">Falta el token en el enlace. Solicite un correo nuevo desde «Olvidé mi contraseña».</p>
        ) : ok ? (
          <p className="text-sm font-medium text-emerald-700">Contraseña actualizada. Redirigiendo al inicio de sesión…</p>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            <Field label="Nueva contraseña">
              <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} />
            </Field>
            <Field label="Confirmar contraseña">
              <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={6} />
            </Field>
            {err ? <p className="text-sm text-red-600">{err}</p> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              <KeyRound className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {busy ? "Guardando…" : "Guardar contraseña"}
            </Button>
          </form>
        )}
        <Link
          to="/login"
          className="mt-6 inline-flex items-center justify-center gap-2 text-sm font-medium text-pf-primary-hover hover:underline"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
          Ir al inicio de sesión
        </Link>
      </Card>
    </div>
  );
}
