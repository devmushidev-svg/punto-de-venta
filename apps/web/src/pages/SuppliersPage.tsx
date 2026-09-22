import { Warehouse } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Modal } from "../components/ui";
import type { Supplier } from "../types";

export function SuppliersPage() {
  const { token, user } = useAuth();
  const admin = user?.role === "admin";
  const [list, setList] = useState<Supplier[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", taxId: "", address: "" });
  const [err, setErr] = useState("");

  function load() {
    if (!token) return;
    apiFetch<Supplier[]>("/api/suppliers", { token }).then(setList);
  }

  useEffect(() => {
    load();
  }, [token]);

  async function save() {
    if (!token) return;
    setErr("");
    try {
      await apiFetch("/api/suppliers", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone || undefined,
          email: form.email || undefined,
          taxId: form.taxId || undefined,
          address: form.address || undefined,
        }),
        token,
      });
      setOpen(false);
      setForm({ name: "", phone: "", email: "", taxId: "", address: "" });
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }

  return (
    <div className="space-y-4 pf-safe-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHero title="Proveedores" constrained className="space-y-2">
          <p className="pf-page-lead max-w-2xl">
            Qué es: quién le vende mercancía; se usa en compras y pedidos a proveedor.
          </p>
          <p className="pf-page-lead-muted max-w-2xl">
            Listado visible para el equipo; el alta y edición la hace un administrador.
          </p>
          {!admin ? (
            <p className="rounded-2xl border border-amber-200/70 bg-gradient-to-r from-amber-50/95 to-orange-50/60 px-3 py-2.5 text-xs font-medium text-amber-900/95 shadow-sm max-w-xl">
              Solo un administrador puede dar de alta o editar proveedores. Si necesita uno nuevo, pida apoyo al admin.
            </p>
          ) : null}
        </PageHero>
        {admin ? (
          <Button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-[52px] w-full shrink-0 shadow-lg sm:w-auto sm:min-h-[48px]"
          >
            <Warehouse className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" strokeWidth={2} aria-hidden />
            Nuevo proveedor
          </Button>
        ) : null}
      </div>
      <Card className="divide-y divide-stone-100/90 border-white/50 shadow-lg shadow-stone-900/[0.04]">
        {list.map((s) => (
          <div
            key={s.id}
            className="flex flex-col gap-1 p-4 transition hover:bg-gradient-to-r hover:from-violet-50/35 hover:to-transparent sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-bold text-stone-900">{s.name}</p>
              <p className="text-sm font-medium text-stone-600">
                {[s.phone, s.email].filter(Boolean).join(" · ") || "Sin contacto"}
              </p>
            </div>
          </div>
        ))}
        {list.length === 0 ? <p className="p-6 text-center font-medium text-pf-muted">Sin proveedores</p> : null}
      </Card>

      <Modal open={open && admin} title="Nuevo proveedor" onClose={() => setOpen(false)} wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre *" className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Teléfono">
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field label="Correo">
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="RTN" className="sm:col-span-2">
            <Input value={form.taxId} onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))} />
          </Field>
          <Field label="Dirección" className="sm:col-span-2">
            <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </Field>
        </div>
        {err ? <p className="text-sm text-red-600 mt-2">{err}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={save} disabled={!form.name.trim()}>
            Guardar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
