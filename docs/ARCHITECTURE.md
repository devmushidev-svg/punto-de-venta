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
- CRUD bajo `/organizations`, `/users`, `/products`, `/customers`, `/suppliers`
- `POST /sales`, `GET /sales`
- `POST /purchases`, `GET /purchases`
- `POST /cash-sessions/open`, `POST /cash-sessions/:id/close`
- Fase ampliada: `/quotes`, `/orders`, `/reports/*`, `/settings`, `GET /backup/export`

## Despliegue futuro

- Frontend: CDN estático.
- API + Postgres: variables `DATABASE_URL` para producción.
- Impresión: navegador (`window.print`) en v1; agente local opcional después.

## Diseño visual

Ver `docs/DESIGN.md` — tokens de color, tipografía Inter, componentes reutilizables.
