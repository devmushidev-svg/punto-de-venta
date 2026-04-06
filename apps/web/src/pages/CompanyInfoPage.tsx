import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHero } from "../components/PageHero";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Select, Textarea } from "../components/ui";

export type OrganizationFull = {
  id: string;
  slug: string;
  name: string;
  slogan: string | null;
  taxIdType: string | null;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  department: string | null;
  zip: string | null;
  recoveryEmail: string | null;
  country: string;
  currency: string;
  currencySymbol: string;
  language: string;
  logoUrl: string | null;
};

const empty: OrganizationFull = {
  id: "",
  slug: "",
  name: "",
  slogan: null,
  taxIdType: "RTN",
  taxId: null,
  phone: null,
  email: null,
  website: null,
  address: null,
  city: null,
  department: null,
  zip: null,
  recoveryEmail: null,
  country: "HN",
  currency: "HNL",
  currencySymbol: "L",
  language: "es",
  logoUrl: null,
};

const TAX_ID_TYPES = ["RTN", "RUC", "NIT", "Otro"] as const;

const COUNTRY_OPTIONS = [
  { code: "HN", label: "Honduras" },
  { code: "GT", label: "Guatemala" },
  { code: "SV", label: "El Salvador" },
  { code: "NI", label: "Nicaragua" },
  { code: "CR", label: "Costa Rica" },
  { code: "PA", label: "Panamá" },
  { code: "US", label: "Estados Unidos" },
] as const;

const LANG_OPTIONS = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
] as const;

function mergeOrg(o: OrganizationFull): OrganizationFull {
  return {
    ...empty,
    ...o,
    taxIdType: o.taxIdType ?? "RTN",
    country: o.country || "HN",
    currency: o.currency || "HNL",
    currencySymbol: o.currencySymbol || "L",
    language: o.language || "es",
  };
}

export function CompanyInfoPage() {
  const { token, user, refreshMe } = useAuth();
  const admin = user?.role === "admin";
  const [org, setOrg] = useState<OrganizationFull | null>(null);
  const [form, setForm] = useState<OrganizationFull>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const preview = useMemo(() => {
    const locale = form.language === "en" ? "en-HN" : "es-HN";
    const dateStr = new Date().toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
    let moneyStr = "";
    try {
      moneyStr = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: form.currency || "HNL",
        minimumFractionDigits: 2,
      }).format(1000);
    } catch {
      moneyStr = `${form.currencySymbol} 1,000.00`;
    }
    return { dateStr, moneyStr };
  }, [form.language, form.currency, form.currencySymbol]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    apiFetch<OrganizationFull>("/api/organizations/current", { token })
      .then((o) => {
        const m = mergeOrg(o as OrganizationFull);
        setOrg(m);
        setForm(m);
      })
      .catch(() => setOrg(null))
      .finally(() => setLoading(false));
  }, [token]);

  async function save() {
    if (!token || !admin) return;
    setErr("");
    setMsg("");
    setSaving(true);
    try {
      await apiFetch("/api/organizations/current", {
        method: "PATCH",
        token,
        body: JSON.stringify({
          name: form.name,
          slogan: form.slogan || "",
          taxIdType: form.taxIdType || "RTN",
          taxId: form.taxId || "",
          phone: form.phone || "",
          email: form.email || "",
          website: form.website || "",
          address: form.address || "",
          city: form.city || "",
          department: form.department || "",
          zip: form.zip || "",
          recoveryEmail: form.recoveryEmail || "",
          country: form.country,
          currency: form.currency,
          currencySymbol: form.currencySymbol,
          language: form.language,
          logoUrl: form.logoUrl || "",
        }),
      });
      setMsg("Cambios guardados.");
      await refreshMe();
      const updated = await apiFetch<OrganizationFull>("/api/organizations/current", { token });
      const m = mergeOrg(updated as OrganizationFull);
      setOrg(m);
      setForm(m);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="rounded-2xl border border-white/50 bg-white/70 px-4 py-6 text-center font-medium text-pf-muted backdrop-blur-sm">
        Cargando información de la empresa…
      </p>
    );
  }
  if (!org) {
    return (
      <p className="rounded-2xl border border-red-100 bg-red-50/90 px-4 py-4 text-center font-medium text-red-700">
        No se pudo cargar la empresa.
      </p>
    );
  }

  const ro = !admin;

  return (
    <div className="max-w-5xl space-y-6 pf-safe-page">
      <PageHero title={"Información de la empresa"}>
        <p className="pf-page-lead">
          Datos fiscales, contacto, logo y moneda; se usan en tickets y documentos.
        </p>
        {!admin ? (
          <p className="mt-3 rounded-2xl border border-amber-200/70 bg-gradient-to-r from-amber-50 to-orange-50/80 px-3 py-2.5 text-sm font-medium text-amber-950 shadow-sm">
            Solo los administradores pueden editar.
          </p>
        ) : null}
      </PageHero>

      <Card className="border-white/50 bg-gradient-to-br from-white/95 via-orange-50/10 to-sky-50/20 p-5 shadow-lg backdrop-blur-sm md:p-6">
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">
          <div className="space-y-8">
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-pf-muted mb-3">Datos generales</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nombre de la empresa" className="sm:col-span-2">
                  <Input
                    value={form.name}
                    disabled={ro}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </Field>
                <Field label="Eslogan" className="sm:col-span-2">
                  <Input
                    value={form.slogan ?? ""}
                    disabled={ro}
                    onChange={(e) => setForm((f) => ({ ...f, slogan: e.target.value }))}
                  />
                </Field>
                <Field label="Tipo de registro">
                  <Select
                    value={form.taxIdType ?? "RTN"}
                    disabled={ro}
                    onChange={(e) => setForm((f) => ({ ...f, taxIdType: e.target.value }))}
                  >
                    {TAX_ID_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Número">
                  <Input
                    value={form.taxId ?? ""}
                    disabled={ro}
                    onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))}
                    placeholder="0801…"
                  />
                </Field>
                <Field label="Teléfono">
                  <Input
                    value={form.phone ?? ""}
                    disabled={ro}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </Field>
                <Field label="Correo electrónico">
                  <Input
                    type="email"
                    value={form.email ?? ""}
                    disabled={ro}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </Field>
                <Field label="Sitio web" className="sm:col-span-2">
                  <Input
                    value={form.website ?? ""}
                    disabled={ro}
                    onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                  />
                </Field>
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-pf-muted mb-3">Dirección fiscal</h2>
              <Field label="Dirección">
                <Textarea
                  value={form.address ?? ""}
                  disabled={ro}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  rows={3}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3 mt-3">
                <Field label="Ciudad">
                  <Input
                    value={form.city ?? ""}
                    disabled={ro}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  />
                </Field>
                <Field label="Departamento">
                  <Input
                    value={form.department ?? ""}
                    disabled={ro}
                    onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                  />
                </Field>
                <Field label="Código postal">
                  <Input
                    value={form.zip ?? ""}
                    disabled={ro}
                    onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))}
                  />
                </Field>
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-pf-muted mb-3">Correo de recuperación</h2>
              <Field label="Correo para recuperación de acceso">
                <Input
                  type="email"
                  value={form.recoveryEmail ?? ""}
                  disabled={ro}
                  onChange={(e) => setForm((f) => ({ ...f, recoveryEmail: e.target.value }))}
                />
              </Field>
            </section>
          </div>

          <div className="space-y-8">
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-pf-muted mb-3">Logo</h2>
              <p className="text-xs text-pf-muted mb-2">URL pública de la imagen (en web no subimos archivo local).</p>
              <Field label="URL del logo">
                <Input
                  value={form.logoUrl ?? ""}
                  disabled={ro}
                  onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
                  placeholder="https://…"
                />
              </Field>
              <div className="mt-3 flex min-h-[120px] items-center justify-center rounded-[var(--radius-pf)] border-2 border-dashed border-pf-border bg-pf-surface p-4">
                {form.logoUrl ? (
                  <img
                    src={form.logoUrl}
                    alt=""
                    className="max-h-28 max-w-full object-contain"
                  />
                ) : (
                  <span className="text-sm text-pf-muted">Vista previa del logo</span>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-orange-200/40 bg-gradient-to-br from-pf-primary-soft/50 to-sky-50/30 p-4 shadow-md backdrop-blur-sm">
              <h2 className="mb-3 text-sm font-bold text-stone-900">Idioma / formato de fecha y moneda</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Idioma">
                  <Select
                    value={form.language}
                    disabled={ro}
                    onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                  >
                    {LANG_OPTIONS.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="País">
                  <Select
                    value={form.country}
                    disabled={ro}
                    onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                  >
                    {COUNTRY_OPTIONS.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Moneda (código ISO)">
                  <Input
                    value={form.currency}
                    disabled={ro}
                    onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                  />
                </Field>
                <Field label="Símbolo">
                  <Input
                    value={form.currencySymbol}
                    disabled={ro}
                    onChange={(e) => setForm((f) => ({ ...f, currencySymbol: e.target.value }))}
                  />
                </Field>
              </div>
              <div className="mt-4 rounded-lg bg-white/80 border border-pf-border px-3 py-2 text-sm space-y-1">
                <p>
                  <span className="text-pf-muted">FECHA: </span>
                  <strong>{preview.dateStr}</strong>
                </p>
                <p>
                  <span className="text-pf-muted">MONEDA: </span>
                  <strong>{preview.moneyStr}</strong>
                </p>
              </div>
            </section>
          </div>
        </div>

        {err ? (
          <p className="mt-6 rounded-xl border border-red-100 bg-red-50/80 px-3 py-2 text-sm font-medium text-red-700">{err}</p>
        ) : null}
        {msg ? (
          <p className="mt-6 rounded-xl border border-emerald-100 bg-emerald-50/80 px-3 py-2 text-sm font-medium text-emerald-800">{msg}</p>
        ) : null}

        {admin ? (
          <div className="mt-6 flex justify-end border-t border-stone-200/80 pt-6">
            <Button type="button" className="min-h-[52px] w-full shadow-lg sm:w-auto sm:min-h-11" onClick={save} disabled={saving}>
              <Save className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
