# Arquitectura — POS web responsivo

## Visión

- **Frontend**: `apps/web` — Vite, React 19, TypeScript, Tailwind CSS v4, React Router.
- **Backend**: `apps/api` — Hono (Node), Prisma ORM, SQLite en desarrollo (archivo `dev.db`).
- **Auth**: JWT en header `Authorization: Bearer`; contraseñas con bcrypt.
- **Multi-tenant**: todas las tablas de negocio llevan `organizationId`; el token incluye `organizationId` activo.

## Estructura del repositorio

```
apps/web     SPA responsiva (login, shell, módulos)
apps/api     REST API + Prisma
docs/        MODULES, ARCHITECTURE, DESIGN
```

## API principal

- `POST /auth/login` — body: organizationSlug | organizationId, username, password
- `GET /auth/me` — usuario y organización
- `POST /auth/forgot-password`, `POST /auth/reset-password` — recuperación por correo (requiere SMTP configurado en el servidor)
- CRUD bajo `/organizations`, `/users`, `/products`, `/customers`, `/suppliers`
- `POST /sales`, `GET /sales`
- `POST /purchases`, `GET /purchases`
- `POST /cash-sessions/open`, `POST /cash-sessions/:id/close`
- `PATCH /api/cash-movements/:id` — admin: reclasificar categoría y/o nota de un movimiento de caja
- `POST /api/org/logo` — admin: subir logo (multipart campo `file`; PNG/JPEG/WebP); la API devuelve `logoUrl` (ruta bajo `/uploads/logos/…` o URL absoluta si existe `API_PUBLIC_URL`)
- `GET /uploads/logos/:file` — servir logos subidos
- Fase ampliada: `/quotes`, `/orders`, `/reports/*`, `/settings`, `GET /backup/export`
- `POST /admin/bootstrap-org` — alta de organización + usuario admin (cabecera `X-Bootstrap-Secret` igual a `BOOTSTRAP_SECRET` en el servidor; uso puntual en despliegue)
- Importación de respaldo: modo destructivo `REPLACE_FULL` documentado en la UI de ajustes (reemplaza datos de la organización; requiere confirmaciones explícitas)

### Variables de entorno relevantes (API)

- `DATABASE_URL` — en producción (p. ej. Postgres).
- `BOOTSTRAP_SECRET` — secreto para `POST /admin/bootstrap-org`.
- `API_PUBLIC_URL` — base pública de la API (opcional; usada en `logoUrl` absoluto y enlaces en correos).
- `WEB_APP_ORIGIN` — origen de la app web (opcional; enlaces en correo de restablecimiento).
- SMTP (p. ej. `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) — envío de correos para olvidé contraseña (ver implementación en `smtpSend` / rutas auth).

## Despliegue futuro

- Frontend: CDN estático.
- API + Postgres: variables `DATABASE_URL` para producción.
- Impresión: navegador (`window.print`) en v1; agente local opcional después.
- Si la web y la API están en distintos orígenes, configure `pf_api_base` en el cliente o proxy reverso coherente; las rutas `/uploads/…` deben resolverse contra el host de la API para ver logos y PDFs que referencian esas URLs.

## Diseño visual

Ver `docs/DESIGN.md` — tokens de color, tipografía Inter, componentes reutilizables.
