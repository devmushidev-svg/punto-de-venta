import { UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Modal } from "../components/ui";
import type { Customer } from "../types";

export function CustomersPage() {
  const { token } = useAuth();
  const [list, setList] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", taxId: "", address: "" });
  const [err, setErr] = useState("");

  function load() {
    if (!token) return;
    apiFetch<Customer[]>("/api/customers", { token }).then(setList);
  }

  useEffect(() => {
    load();
  }, [token]);

  async function save() {
    if (!token) return;
    setErr("");
    try {
      await apiFetch("/api/customers", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone || undefined,
          taxId: form.taxId || undefined,
          address: form.address || undefined,
        }),
        token,
      });
      setOpen(false);
      setForm({ name: "", phone: "", taxId: "", address: "" });
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }

  return (
    <div className="space-y-4 pf-safe-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHero title={"Clientes"} constrained>
          <p className="pf-page-lead max-w-2xl">
            Qué es: personas o empresas a quien factura; sirven para crédito y datos en el ticket.
          </p>
          <p className="pf-page-lead-muted">
            Alta rápida desde aquí; el catálogo se usa en nueva venta y cotizaciones.
          </p>
        </PageHero>
        <Button type="button" onClick={() => setOpen(true)} className="min-h-[52px] w-full shrink-0 shadow-lg sm:w-auto sm:min-h-[48px]">
          <UserPlus className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" strokeWidth={2} aria-hidden />
          Nuevo cliente
        </Button>
      </div>
      <Card className="divide-y divide-stone-100/90 border-white/50 shadow-lg shadow-stone-900/[0.04]">
        {list.map((c) => (
          <div
            key={c.id}
            className="pf-list-row-hover flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-bold text-stone-900">{c.name}</p>
              <p className="text-sm font-medium text-stone-600">
                {[c.phone, c.taxId].filter(Boolean).join(" · ") || "Sin teléfono / RTN"}
              </p>
            </div>
          </div>
        ))}
        {list.length === 0 ? (
          <p className="p-6 text-center font-medium text-pf-muted">Sin clientes</p>
        ) : null}
      </Card>

      <Modal open={open} title="Nuevo cliente" onClose={() => setOpen(false)}>
        <Field label="Nombre *">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        </Field>
        <Field label="Teléfono">
          <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </Field>
        <Field label="RTN / ID fiscal">
          <Input value={form.taxId} onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))} />
        </Field>
        <Field label="Dirección">
          <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        </Field>
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
