import { Search, Warehouse } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Field, Input, Modal } from "../components/ui";
import type { Supplier } from "../types";
import "./admin-workspace.css";

export function SuppliersPage() {
  const { token, user } = useAuth();
  const admin = user?.role === "admin";
  const [list, setList] = useState<Supplier[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    taxId: "",
    address: "",
  });
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");

  function load() {
    if (!token) return;
    apiFetch<Supplier[]>("/api/suppliers", { token }).then(setList);
  }

  useEffect(() => {
    load();
  }, [token]);

  const filteredList = list.filter((s) => {
    const q = query.trim().toLocaleLowerCase();
    return (
      !q ||
      [s.name, s.phone, s.email, s.taxId, s.address]
        .filter(Boolean)
        .some((v) => String(v).toLocaleLowerCase().includes(q))
    );
  });

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
    <div className="pf-admin-page space-y-5 pf-safe-page">
      <div className="pf-admin-heading">
        <div>
          {!admin && (
            <p className="text-xs font-medium text-pf-warning">
              Solo un administrador puede registrar proveedores.
            </p>
          )}
        </div>
        {admin ? (
          <Button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-11 w-full shrink-0 sm:w-auto"
          >
            <Warehouse
              className="h-5 w-5 shrink-0 sm:h-4 sm:w-4"
              strokeWidth={2}
              aria-hidden
            />
            Nuevo proveedor
          </Button>
        ) : null}
      </div>
      <section className="pf-admin-surface">
        <div className="pf-admin-surface-head">
          <div>
            <h2>Directorio</h2>
            <p>
              {query.trim()
                ? `${filteredList.length} de ${list.length} ${list.length === 1 ? "proveedor" : "proveedores"}`
                : `${list.length} ${list.length === 1 ? "proveedor" : "proveedores"}`}
            </p>
          </div>
          <label className="pf-admin-search">
            <Search size={17} aria-hidden />
            <Input
              aria-label="Buscar proveedores"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nombre, teléfono, correo o RTN"
            />
          </label>
        </div>
        {filteredList.map((s) => (
          <div key={s.id} className="pf-admin-list-row">
            <div className="pf-admin-list-main">
              <strong>{s.name}</strong>
              <span>{[s.phone, s.email, s.taxId, s.address].filter(Boolean).join(" · ")}</span>
            </div>
          </div>
        ))}
        {filteredList.length === 0 ? (
          <div className="pf-admin-empty">
            <strong>
              {list.length === 0
                ? "Todavía no hay proveedores"
                : "No encontramos ese proveedor"}
            </strong>
            <span>
              {list.length === 0
                ? "Registre el primero para usarlo en compras y pedidos."
                : "Pruebe con otro nombre, teléfono, correo o RTN."}
            </span>
          </div>
        ) : null}
      </section>

      <Modal
        open={open && admin}
        title="Nuevo proveedor"
        onClose={() => setOpen(false)}
        wide
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre *" className="sm:col-span-2">
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <Field label="Teléfono">
            <Input
              value={form.phone}
              onChange={(e) =>
                setForm((f) => ({ ...f, phone: e.target.value }))
              }
            />
          </Field>
          <Field label="Correo">
            <Input
              type="email"
              value={form.email}
              onChange={(e) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
            />
          </Field>
          <Field label="RTN" className="sm:col-span-2">
            <Input
              value={form.taxId}
              onChange={(e) =>
                setForm((f) => ({ ...f, taxId: e.target.value }))
              }
            />
          </Field>
          <Field label="Dirección" className="sm:col-span-2">
            <Input
              value={form.address}
              onChange={(e) =>
                setForm((f) => ({ ...f, address: e.target.value }))
              }
            />
          </Field>
        </div>
        {err ? <p className="text-sm text-pf-danger mt-2">{err}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="secondary"
            type="button"
            onClick={() => setOpen(false)}
          >
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
