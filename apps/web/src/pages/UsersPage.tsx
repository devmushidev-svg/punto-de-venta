import { Pencil, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { Navigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Modal, Select } from "../components/ui";
import { formatDate } from "../lib/format";
import {
  ALL_PERMISSION_KEYS,
  effectivePermission,
  parsePermissionsJson,
  PERMISSION_LABELS,
  ROLE_DEFAULT_PERMISSIONS,
  serializePermissionsPayload,
  togglePermission,
  type PermissionKey,
} from "../lib/permissions";

type UserRow = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  createdAt: string;
  permissionsJson?: string;
};

const ROLES = [
  { id: "admin", label: "Administrador", desc: "Acceso total; la matriz fina no aplica." },
  {
    id: "vendedor",
    label: "Vendedor",
    desc: "Como cajero más reportes y traslados por defecto; CxC, CxP y compras incluidos salvo restricción en la matriz.",
  },
  {
    id: "cajero",
    label: "Cajero",
    desc: "Ventas, caja, CxC, CxP y compras por defecto; el admin puede restringir esos módulos o añadir reportes y traslados.",
  },
];

export function UsersPage() {
  const { token, user, refreshMe } = useAuth();
  const [list, setList] = useState<UserRow[]>([]);
  const [modal, setModal] = useState<"new" | "edit" | null>(null);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("cajero");
  const [active, setActive] = useState(true);
  const [permAllow, setPermAllow] = useState<PermissionKey[]>([]);
  const [permDeny, setPermDeny] = useState<PermissionKey[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!token || user?.role !== "admin") return;
    apiFetch<UserRow[]>("/api/users", { token }).then(setList).catch(() => setList([]));
  }, [token, user?.role]);

  useEffect(() => {
    load();
  }, [load]);

  if (user?.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  function openNew() {
    setEditing(null);
    setUsername("");
    setPassword("");
    setDisplayName("");
    setRole("cajero");
    setActive(true);
    setPermAllow([]);
    setPermDeny([]);
    setErr("");
    setModal("new");
  }

  function openEdit(u: UserRow) {
    setEditing(u);
    setUsername(u.username);
    setPassword("");
    setDisplayName(u.displayName);
    setRole(u.role);
    setActive(u.active);
    const p = parsePermissionsJson(u.permissionsJson);
    setPermAllow(p.allow);
    setPermDeny(p.deny);
    setErr("");
    setModal("edit");
  }

  async function save() {
    if (!token) return;
    setErr("");
    setBusy(true);
    try {
      const permissionsJson = role === "admin" ? "{}" : serializePermissionsPayload(permAllow, permDeny);
      if (modal === "new") {
        await apiFetch("/api/users", {
          method: "POST",
          body: JSON.stringify({
            username,
            password,
            displayName,
            role,
            active,
            permissionsJson,
          }),
          token,
        });
      } else if (editing) {
        const body: Record<string, unknown> = { displayName, role, active, permissionsJson };
        if (password.trim()) body.password = password;
        await apiFetch(`/api/users/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
          token,
        });
      }
      setModal(null);
      load();
      if (editing?.id === user?.id) await refreshMe();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pf-safe-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHero title={"Usuarios y permisos"} constrained>
          <p className="pf-page-lead">Quién puede operar el sistema y con qué alcance.</p>
        </PageHero>
        <Button type="button" onClick={openNew} className="min-h-[52px] w-full shrink-0 shadow-lg sm:w-auto sm:min-h-[48px]">
          <UserPlus className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" strokeWidth={2} aria-hidden />
          Nuevo usuario
        </Button>
      </div>

      <Card className="border-white/50 bg-gradient-to-br from-white/95 via-violet-50/20 to-slate-50/40 p-4 shadow-lg backdrop-blur-sm">
        <p className="mb-2 text-sm font-bold text-stone-900">Matriz de roles (resumen)</p>
        <ul className="space-y-1.5 text-sm text-stone-600">
          {ROLES.map((r) => (
            <li key={r.id}>
              <strong className="text-stone-700">{r.label}</strong> — {r.desc}
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-stone-200/80 pt-3 text-xs font-medium text-stone-500">
          Permisos finos (cajero/vendedor): al editar un usuario puede conceder o restringir módulos concretos respecto al rol base.
        </p>
      </Card>

      <Card className="overflow-x-auto border-white/50 bg-gradient-to-br from-white/92 to-violet-50/15 p-0 shadow-lg backdrop-blur-sm">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-stone-200/80 bg-gradient-to-r from-violet-50/95 to-slate-50/70 text-left text-xs font-bold text-stone-700 shadow-sm backdrop-blur-md">
              <th className="p-3">Usuario</th>
              <th className="p-3">Nombre</th>
              <th className="p-3">Rol</th>
              <th className="p-3">Estado</th>
              <th className="p-3">Alta</th>
              <th className="p-3 w-24" />
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} className="border-b border-stone-100/90 transition hover:bg-violet-50/30">
                <td className="p-3 font-mono">{u.username}</td>
                <td className="p-3">{u.displayName}</td>
                <td className="p-3 capitalize">{u.role}</td>
                <td className="p-3">{u.active ? "Activo" : "Inactivo"}</td>
                <td className="p-3 whitespace-nowrap text-pf-muted">{formatDate(u.createdAt)}</td>
                <td className="p-3">
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11 px-3 py-2 text-sm font-semibold sm:min-h-0 sm:py-1 sm:px-2"
                    onClick={() => openEdit(u)}
                  >
                    <Pencil className="h-4 w-4 shrink-0 sm:h-3.5 sm:w-3.5" strokeWidth={2} aria-hidden />
                    Editar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 ? <p className="p-8 text-center font-medium text-pf-muted">Sin datos</p> : null}
      </Card>

      <Modal
        open={modal !== null}
        title={modal === "new" ? "Nuevo usuario" : "Editar usuario"}
        onClose={() => setModal(null)}
        wide
      >
        <div className="space-y-3">
          {modal === "new" ? (
            <Field label="Usuario (login)">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </Field>
          ) : (
            <Field label="Usuario">
              <Input value={username} readOnly className="bg-stone-50" />
            </Field>
          )}
          <Field label={modal === "new" ? "Contraseña" : "Nueva contraseña (opcional)"}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Nombre para mostrar">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label="Rol">
            <Select
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setPermAllow([]);
                setPermDeny([]);
              }}
            >
              {ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          {role !== "admin" ? (
            <div className="rounded-lg border border-pf-border bg-stone-50/80 p-3 space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-pf-muted mb-1.5">Incluido en el rol «{role}»</p>
                <p className="text-xs text-stone-600 leading-relaxed">
                  {(ROLE_DEFAULT_PERMISSIONS[role] ?? []).length === 0 ? (
                    <>Ningún permiso de la lista viene activado solo por el rol; marque casillas para conceder (quedará en «Añadido manualmente»).</>
                  ) : (
                    <ul className="list-disc pl-4 space-y-0.5">
                      {(ROLE_DEFAULT_PERMISSIONS[role] ?? []).map((key) => (
                        <li key={key}>{PERMISSION_LABELS[key]}</li>
                      ))}
                    </ul>
                  )}
                </p>
              </div>
              {permDeny.length > 0 ? (
                <div className="rounded-md border border-red-200 bg-red-50/90 px-2.5 py-2">
                  <p className="text-xs font-semibold text-red-900">Restringido (no puede usar)</p>
                  <ul className="mt-1 text-xs text-red-800 list-disc pl-4 space-y-0.5">
                    {permDeny.map((key) => (
                      <li key={key}>{PERMISSION_LABELS[key]}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {permAllow.length > 0 ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50/80 px-2.5 py-2">
                  <p className="text-xs font-semibold text-emerald-900">Añadido manualmente (extra al rol)</p>
                  <ul className="mt-1 text-xs text-emerald-900 list-disc pl-4 space-y-0.5">
                    {permAllow.map((key) => (
                      <li key={key}>{PERMISSION_LABELS[key]}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-pf-muted mb-2">Casillas (quitar o añadir vs el rol)</p>
                <p className="text-xs text-pf-muted mb-2">
                  Desmarcar un permiso que trae el rol lo agrega a «Restringido». Marcar uno que el rol no trae lo añade como extra.
                </p>
                <div className="space-y-2">
                  {ALL_PERMISSION_KEYS.map((key) => (
                    <label key={key} className="flex items-start gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-pf-border"
                        checked={effectivePermission(role, permAllow, permDeny, key)}
                        onChange={(e) => {
                          const next = togglePermission(role, permAllow, permDeny, key, e.target.checked);
                          setPermAllow(next.allow);
                          setPermDeny(next.deny);
                        }}
                      />
                      <span>{PERMISSION_LABELS[key]}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-pf-muted">Los administradores tienen todos los permisos; no se aplica matriz fina.</p>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-pf-border"
            />
            <span className="text-sm font-medium text-stone-700">Usuario activo</span>
          </label>
          {err ? <p className="text-sm text-red-600">{err}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setModal(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={save} disabled={busy}>
              {busy ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
