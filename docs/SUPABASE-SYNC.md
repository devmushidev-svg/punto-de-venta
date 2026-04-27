# Supabase + Offline SQLite

Punto Flow usa un modelo cloud-first:

- Navegador/celular/varias cajas: usan la nube.
- Windows offline: usa API local + SQLite.
- Al volver internet: la API local sincroniza eventos pendientes con Supabase.

Supabase usa PostgreSQL internamente, pero el cliente no instala PostgreSQL.

## Variables

En `apps/api/.env`:

```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="cambiar-en-produccion"

SUPABASE_URL="https://tu-proyecto.supabase.co"
SUPABASE_ANON_KEY=""
SUPABASE_SERVICE_ROLE_KEY=""
SUPABASE_STORAGE_BUCKET="punto-flow"
SUPABASE_SYNC_TABLE="punto_sync_events"
```

`SUPABASE_SERVICE_ROLE_KEY` solo debe existir en la API local o servidor seguro. Nunca debe ponerse en el frontend.

## Tabla de intercambio

Crear en Supabase una tabla `punto_sync_events` con columnas equivalentes:

- `id uuid default gen_random_uuid() primary key`
- `organization_id text not null`
- `branch_id text`
- `device_id text`
- `origin_device_id text`
- `entity_type text not null`
- `entity_id text not null`
- `action text not null`
- `sync_status text not null default 'PENDING'`
- `version integer not null default 1`
- `payload_json jsonb not null default '{}'::jsonb`
- `error text`
- `created_at timestamptz not null default now()`
- `last_synced_at timestamptz`

## Flujo

1. La app local guarda operaciones en SQLite.
2. Cada cambio crítico crea un `SyncEvent`.
3. `POST /api/sync/push` sube eventos pendientes a Supabase.
4. `POST /api/sync/pull` baja eventos remotos.
5. Ventas existentes no se sobrescriben; quedan para revisión si falta contexto.

## Estado

La pantalla `Configuracion -> Nube / offline` permite:

- elegir modo de este navegador: nube o local;
- guardar URL de API cloud;
- probar Supabase;
- subir pendientes;
- bajar cambios;
- ver pendientes, errores y eventos en revisión.
