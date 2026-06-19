# Despliegue en la nube (Fase 1: online)

Arquitectura: **Frontend en Vercel** + **API en Railway** + **PostgreSQL en Supabase**.
La app se "instala" abriendo el dominio en el navegador y pulsando *Instalar* (PWA). Sin instaladores.

```
Vercel (web, gratis)  ──►  Railway (API Node, ~$5/mes)  ──►  Supabase (Postgres, gratis)
```

---

## 1. Base de datos — Supabase

1. El proyecto Supabase ya existe (se aplicó `supabase/setup.sql`).
2. Ve a **Project Settings → Database → Connection string → Session pooler**.
3. Copia la cadena (puerto **5432**) y reemplaza `[YOUR-PASSWORD]` por la contraseña real de la BD.
   Queda algo así:
   ```
   postgresql://postgres.xxxx:CONTRASEÑA@aws-0-us-east-1.pooler.supabase.com:5432/postgres
   ```

---

## 2. API — Railway

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → este repo.
2. En el servicio, **Settings → Root Directory** = `apps/api`.
3. **Settings → Deploy**:
   - Build Command: `npm run build`
   - Start Command: `npm run start:cloud`  *(corre `prisma db push` y luego arranca; la primera vez crea las tablas)*
4. **Variables** (Settings → Variables):
   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | la cadena del paso 1 |
   | `JWT_SECRET` | una cadena larga y aleatoria |
   | `CORS_ORIGINS` | el dominio de Vercel, ej. `https://tu-app.vercel.app` |
   | `API_PUBLIC_URL` | la URL pública de esta API en Railway |
   | `NODE_ENV` | `production` |
5. Deploy. Railway te da una URL: `https://tu-api.up.railway.app`.
6. **Crear el primer usuario**: en la pestaña *Shell* de Railway (o local apuntando a la misma `DATABASE_URL`):
   ```
   npm run db:seed -w apps/api
   ```
   Crea la organización demo con `ADMIN/admin` y `CAJERO/cajero`. Cambia la contraseña al entrar.

---

## 3. Frontend — Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → este repo.
2. **Root Directory** = `apps/web`.
3. Framework: Vite (autodetectado). Build: `npm run build`, Output: `dist`.
4. **Environment Variables**:
   | Variable | Valor |
   |---|---|
   | `VITE_API_BASE` | la URL de la API en Railway (paso 2.5) |
5. Deploy. Te da `https://tu-app.vercel.app`.
6. Vuelve a Railway y confirma que `CORS_ORIGINS` tiene ese dominio exacto.

---

## Verificación

- Abre el dominio de Vercel → login con `ADMIN/admin`.
- Crea un producto, búscalo en mayúsculas/minúsculas (búsqueda insensible a may/min ✓).
- Instala la PWA desde el navegador (móvil o escritorio).

## Offline real (Fase 2 — ya implementado)

Si se cae el internet, el cajero **sigue vendiendo**:
- El catálogo (productos/clientes) queda cacheado por la PWA → la pantalla de venta carga offline.
- Al cobrar sin red, la venta se guarda en el navegador (IndexedDB) y aparece el chip **"Sin conexión"**.
- Al volver la conexión (o cada 30 s) las ventas pendientes se reenvían solas. El servidor las
  deduplica por `clientRef`, así que **un reenvío nunca duplica** la venta.
- Si una venta offline es rechazada por el servidor (p. ej. stock), el chip la marca en rojo para revisión.

Límites de esta fase: la venta offline obtiene su número de factura al sincronizar (no antes); la búsqueda
offline solo encuentra lo ya cacheado; el offline solo aplica a **crear ventas** (no editar/otros módulos).
**Pendiente de QA manual en navegador** (alternar red real); la lógica de no-perder/no-duplicar tiene prueba unitaria.

## Otros límites conocidos (ponytail)

- **Logo de empresa**: se guarda en disco del contenedor; tras un *redeploy* hay que volver a subirlo.
  Upgrade: subir al bucket Supabase `punto-flow`.
- **Esquema**: se sincroniza con `prisma db push` (sin historial de migraciones). Suficiente para Fase 1.
