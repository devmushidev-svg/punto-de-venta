import { Eraser, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Field, Input, Modal, Textarea } from "./ui";
import type { Customer } from "../types";

const emptyForm = {
  code: "",
  name: "",
  address: "",
  phone: "",
  taxId: "",
  notes: "",
};

type Props = {
  open: boolean;
  onClose: () => void;
  existingCustomerId?: string | null;
  onSaved: (customer: Customer) => void;
};

export function CustomerModal({ open, onClose, existingCustomerId = null, onSaved }: Props) {
  const { token } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !token) return;
    if (!existingCustomerId) {
      setForm(emptyForm);
      setErr("");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr("");
    apiFetch<Customer>(`/api/customers/${existingCustomerId}`, { token })
      .then((c) => {
        if (cancelled) return;
        setForm({
          code: c.code ?? "",
          name: c.name,
          address: c.address ?? "",
          phone: c.phone ?? "",
          taxId: c.taxId ?? "",
          notes: c.notes ?? "",
        });
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "No se pudo cargar el cliente");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, existingCustomerId, token]);

  function clearForm() {
    setErr("");
    if (!existingCustomerId) {
      setForm(emptyForm);
      return;
    }
    if (!token) return;
    setLoading(true);
    apiFetch<Customer>(`/api/customers/${existingCustomerId}`, { token })
      .then((c) => {
        setForm({
          code: c.code ?? "",
          name: c.name,
          address: c.address ?? "",
          phone: c.phone ?? "",
          taxId: c.taxId ?? "",
          notes: c.notes ?? "",
        });
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Error al recargar"))
      .finally(() => setLoading(false));
  }

  async function save() {
    if (!token) return;
    setErr("");
    if (!form.name.trim()) {
      setErr("El nombre es obligatorio.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim() || undefined,
        name: form.name.trim(),
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        taxId: form.taxId.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };
      if (existingCustomerId) {
        const updated = await apiFetch<Customer>(`/api/customers/${existingCustomerId}`, {
          method: "PATCH",
          body: JSON.stringify({
            code: form.code.trim() || "0",
            name: payload.name,
            address: payload.address ?? null,
            phone: payload.phone ?? null,
            taxId: payload.taxId ?? null,
            notes: payload.notes ?? null,
          }),
          token,
        });
        onSaved(updated);
      } else {
        const created = await apiFetch<Customer>("/api/customers", {
          method: "POST",
          body: JSON.stringify(payload),
          token,
        });
        onSaved(created);
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const title = existingCustomerId
    ? `Cliente${form.name ? ` — ${form.name}` : ""}`
    : "Nuevo cliente";

  return (
    <Modal open={open} title={title} onClose={onClose} wide maxWidthClass="sm:max-w-2xl">
      {loading ? <p className="mb-3 text-sm text-pf-muted">Cargando…</p> : null}
      {!loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Código">
            <Input
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              className="font-mono"
            />
          </Field>
          <Field label="Nombre *" className="sm:col-span-2">
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoComplete="organization"
            />
          </Field>
          <Field label="Dirección" className="sm:col-span-2">
            <Input
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </Field>
          <Field label="Teléfono">
            <Input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              autoComplete="tel"
            />
          </Field>
          <Field label="RTN / ID fiscal">
            <Input value={form.taxId} onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))} />
          </Field>
          <Field label="Notas" className="sm:col-span-2">
            <Textarea
              rows={4}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
        </div>
      ) : null}

      {err ? <p className="mt-3 text-sm font-medium text-red-600">{err}</p> : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-pf-border pt-4">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 gap-2"
          onClick={() => void clearForm()}
          disabled={saving || loading}
        >
          <Eraser className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          Limpiar
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving || loading}>
            Cancelar
          </Button>
          <Button
            type="button"
            className="min-h-11 gap-2"
            onClick={() => void save()}
            disabled={saving || loading}
          >
            <Save className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Guardar y cerrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
