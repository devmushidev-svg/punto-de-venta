import { Pencil, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { Navigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Modal, Textarea } from "../components/ui";
import { formatDate } from "../lib/format";
import type { EmployeeRow } from "../types";

export function EmployeesPage() {
  const { token, user } = useAuth();
  const [list, setList] = useState<EmployeeRow[]>([]);
  const [modal, setModal] = useState<"new" | "edit" | null>(null);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [form, setForm] = useState({
    employeeCode: "",
    name: "",
    idDocument: "",
    phone: "",
    email: "",
    position: "",
    hireDate: "",
    notes: "",
    active: true,
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!token || user?.role !== "admin") return;
    apiFetch<EmployeeRow[]>("/api/employees", { token }).then(setList).catch(() => setList([]));
  }, [token, user?.role]);

  useEffect(() => {
    load();
  }, [load]);

  if (user?.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  function openNew() {
    setEditing(null);
    setForm({
      employeeCode: "",
      name: "",
      idDocument: "",
      phone: "",
      email: "",
      position: "",
      hireDate: "",
      notes: "",
      active: true,
    });
    setErr("");
    setModal("new");
  }

  function openEdit(e: EmployeeRow) {
    setEditing(e);
    setForm({
      employeeCode: e.employeeCode ?? "",
      name: e.name,
      idDocument: e.idDocument ?? "",
      phone: e.phone ?? "",
      email: e.email ?? "",
      position: e.position ?? "",
      hireDate: e.hireDate ? e.hireDate.slice(0, 10) : "",
      notes: e.notes ?? "",
      active: e.active,
    });
    setErr("");
    setModal("edit");
  }

  async function save() {
    if (!token) return;
    setErr("");
    if (!form.name.trim()) {
      setErr("El nombre es obligatorio.");
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        employeeCode: form.employeeCode.trim() || null,
        idDocument: form.idDocument.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        position: form.position.trim() || null,
        hireDate: form.hireDate ? form.hireDate : null,
        notes: form.notes.trim() || null,
        active: form.active,
      };
      if (modal === "new") {
        await apiFetch("/api/employees", { method: "POST", body: JSON.stringify(body), token });
      } else if (editing) {
        await apiFetch(`/api/employees/${editing.id}`, { method: "PATCH", body: JSON.stringify(body), token });
      }
      setModal(null);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pf-safe-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHero title={"Empleados"} constrained>
          <p className="pf-page-lead">
            Personal de la empresa (distinto de usuarios del sistema). Uso en planillas y referencia interna.
          </p>
        </PageHero>
        <Button type="button" onClick={openNew} className="min-h-[52px] w-full shrink-0 shadow-lg sm:w-auto sm:min-h-[48px]">
          <UserPlus className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" strokeWidth={2} aria-hidden />
          Nuevo empleado
        </Button>
      </div>

      <Card className="overflow-x-auto border-white/50 bg-gradient-to-br from-white/92 via-blue-50/12 to-indigo-50/20 p-0 shadow-lg backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-stone-200/80 bg-gradient-to-r from-blue-50/95 to-indigo-50/70 text-left text-xs font-bold text-stone-600 shadow-sm backdrop-blur-md">
              <th className="p-3">Código</th>
              <th className="p-3">Nombre</th>
              <th className="p-3">Puesto</th>
              <th className="p-3">Ingreso</th>
              <th className="p-3">Estado</th>
              <th className="w-24 p-3" />
            </tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id} className="border-b border-stone-100/90 transition hover:bg-blue-50/30">
                <td className="p-3 font-mono text-xs">{e.employeeCode ?? "—"}</td>
                <td className="p-3 font-medium text-stone-900">{e.name}</td>
                <td className="p-3 text-pf-muted">{e.position ?? "—"}</td>
                <td className="p-3 whitespace-nowrap text-pf-muted">
                  {e.hireDate ? formatDate(e.hireDate) : "—"}
                </td>
                <td className="p-3">{e.active ? "Activo" : "Inactivo"}</td>
                <td className="p-3">
                  <Button type="button" variant="secondary" className="min-h-11 px-3 sm:h-8 sm:min-h-0 sm:px-2" onClick={() => openEdit(e)}>
                    <Pencil className="h-4 w-4 sm:h-3.5 sm:w-3.5" strokeWidth={2} aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
            {list.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center font-medium text-pf-muted">
                  Sin empleados registrados.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      <Modal open={modal !== null} title={modal === "new" ? "Nuevo empleado" : "Editar empleado"} onClose={() => setModal(null)} wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre *" className="sm:col-span-2">
            <Input value={form.name} onChange={(ev) => setForm((f) => ({ ...f, name: ev.target.value }))} />
          </Field>
          <Field label="Código interno">
            <Input value={form.employeeCode} onChange={(ev) => setForm((f) => ({ ...f, employeeCode: ev.target.value }))} />
          </Field>
          <Field label="Identificación (DPI/RTN)">
            <Input value={form.idDocument} onChange={(ev) => setForm((f) => ({ ...f, idDocument: ev.target.value }))} />
          </Field>
          <Field label="Teléfono">
            <Input value={form.phone} onChange={(ev) => setForm((f) => ({ ...f, phone: ev.target.value }))} />
          </Field>
          <Field label="Correo">
            <Input type="email" value={form.email} onChange={(ev) => setForm((f) => ({ ...f, email: ev.target.value }))} />
          </Field>
          <Field label="Puesto" className="sm:col-span-2">
            <Input value={form.position} onChange={(ev) => setForm((f) => ({ ...f, position: ev.target.value }))} />
          </Field>
          <Field label="Fecha de ingreso">
            <Input type="date" value={form.hireDate} onChange={(ev) => setForm((f) => ({ ...f, hireDate: ev.target.value }))} />
          </Field>
          <Field label="Activo" className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(ev) => setForm((f) => ({ ...f, active: ev.target.checked }))}
              />
              En nómina / planillas
            </label>
          </Field>
          <Field label="Notas" className="sm:col-span-2">
            <Textarea rows={2} value={form.notes} onChange={(ev) => setForm((f) => ({ ...f, notes: ev.target.value }))} />
          </Field>
        </div>
        {err ? <p className="text-sm text-red-600 mt-2">{err}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={() => setModal(null)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy}>
            Guardar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
