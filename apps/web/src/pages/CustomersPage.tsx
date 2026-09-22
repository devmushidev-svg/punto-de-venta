import { Pencil, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Modal, Select, Textarea } from "../components/ui";
import type { Customer } from "../types";

const tierOptions = [
  { value: "", label: "Sin predeterminado (lista de la venta)" },
  { value: "1", label: "Lista 1" },
  { value: "2", label: "Lista 2" },
  { value: "3", label: "Lista 3" },
  { value: "4", label: "Lista 4" },
];

export function CustomersPage() {
  const { token } = useAuth();
  const [list, setList] = useState<Customer[]>([]);
  const [openNew, setOpenNew] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    phone: "",
    taxId: "",
    address: "",
    notes: "",
    defaultPriceTier: "" as "" | "1" | "2" | "3" | "4",
  });
  const [err, setErr] = useState("");

  function load() {
    if (!token) return;
    apiFetch<Customer[]>("/api/customers", { token }).then(setList);
  }

  useEffect(() => {
    load();
  }, [token]);

  function resetForm() {
    setForm({
      code: "",
      name: "",
      phone: "",
      taxId: "",
      address: "",
      notes: "",
      defaultPriceTier: "",
    });
    setErr("");
  }

  function openCreate() {
    resetForm();
    setOpenNew(true);
  }

  function openEdit(c: Customer) {
    setEditing(c);
    setForm({
      code: c.code ?? "",
      name: c.name,
      phone: c.phone ?? "",
      taxId: c.taxId ?? "",
      address: c.address ?? "",
      notes: c.notes ?? "",
      defaultPriceTier:
        c.defaultPriceTier != null && c.defaultPriceTier >= 1 && c.defaultPriceTier <= 4
          ? (String(Math.trunc(c.defaultPriceTier)) as "1" | "2" | "3" | "4")
          : "",
    });
    setErr("");
  }

  async function saveNew() {
    if (!token) return;
    setErr("");
    if (!form.name.trim()) {
      setErr("El nombre es obligatorio.");
      return;
    }
    try {
      await apiFetch("/api/customers", {
        method: "POST",
        body: JSON.stringify({
          code: form.code.trim() || undefined,
          name: form.name.trim(),
          phone: form.phone || undefined,
          taxId: form.taxId || undefined,
          address: form.address || undefined,
          notes: form.notes || undefined,
          defaultPriceTier: form.defaultPriceTier === "" ? null : Number(form.defaultPriceTier),
        }),
        token,
      });
      setOpenNew(false);
      resetForm();
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }

  async function saveEdit() {
    if (!token || !editing) return;
    setErr("");
    if (!form.name.trim()) {
      setErr("El nombre es obligatorio.");
      return;
    }
    try {
      await apiFetch(`/api/customers/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          code: form.code.trim() || "0",
          name: form.name.trim(),
          phone: form.phone || null,
          taxId: form.taxId || null,
          address: form.address || null,
          notes: form.notes || null,
          defaultPriceTier: form.defaultPriceTier === "" ? null : Number(form.defaultPriceTier),
        }),
        token,
      });
      setEditing(null);
      resetForm();
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
            Puede fijar la lista de precio por defecto (1–4) para aplicarla al elegir el cliente en venta.
          </p>
        </PageHero>
        <Button
          type="button"
          onClick={openCreate}
          className="min-h-[52px] w-full shrink-0 shadow-lg sm:w-auto sm:min-h-[48px]"
        >
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
            <div className="min-w-0">
              <p className="font-bold text-stone-900">{c.name}</p>
              <p className="text-sm font-medium text-stone-600">
                {[c.phone, c.taxId].filter(Boolean).join(" · ") || "Sin teléfono / RTN"}
              </p>
              {c.defaultPriceTier != null ? (
                <p className="text-xs text-pf-muted mt-0.5">Lista por defecto: precio {c.defaultPriceTier}</p>
              ) : null}
            </div>
            <Button type="button" variant="secondary" className="min-h-10 shrink-0" onClick={() => openEdit(c)}>
              <Pencil className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              Editar
            </Button>
          </div>
        ))}
        {list.length === 0 ? (
          <p className="p-6 text-center font-medium text-pf-muted">Sin clientes</p>
        ) : null}
      </Card>

      <Modal open={openNew} title="Nuevo cliente" onClose={() => setOpenNew(false)}>
        <Field label="Nombre *">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        </Field>
        <Field label="Código (opc.)">
          <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="0" />
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
        <Field label="Notas">
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </Field>
        <Field label="Lista de precio por defecto">
          <Select
            value={form.defaultPriceTier}
            onChange={(e) =>
              setForm((f) => ({ ...f, defaultPriceTier: e.target.value as typeof f.defaultPriceTier }))
            }
          >
            {tierOptions.map((o) => (
              <option key={o.value || "none"} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {err ? (
          <p className="text-sm text-red-600 mt-2" role="alert">
            {err}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={() => setOpenNew(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void saveNew()} disabled={!form.name.trim()}>
            Guardar
          </Button>
        </div>
      </Modal>

      <Modal open={editing != null} title={editing ? `Editar: ${editing.name}` : "Editar"} onClose={() => setEditing(null)}>
        <Field label="Nombre *">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        </Field>
        <Field label="Código">
          <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
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
        <Field label="Notas">
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </Field>
        <Field label="Lista de precio por defecto">
          <Select
            value={form.defaultPriceTier}
            onChange={(e) =>
              setForm((f) => ({ ...f, defaultPriceTier: e.target.value as typeof f.defaultPriceTier }))
            }
          >
            {tierOptions.map((o) => (
              <option key={o.value || "none"} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {err ? (
          <p className="text-sm text-red-600 mt-2" role="alert">
            {err}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={() => setEditing(null)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void saveEdit()} disabled={!form.name.trim()}>
            Guardar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
