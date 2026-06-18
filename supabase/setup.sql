-- Punto de Venta — Setup de almacenamiento en linea (Supabase)
-- Ejecutar una sola vez en el proyecto de Supabase (SQL Editor) para habilitar la sincronizacion.
-- La API local usa SUPABASE_SERVICE_ROLE_KEY (solo del lado servidor) para leer/escribir aqui.

create extension if not exists "pgcrypto";

-- Cola de eventos de sincronizacion. Cada cambio local (producto, venta, cliente, etc.)
-- se empuja como un evento versionado a esta tabla y otros dispositivos lo reciben con pull.
create table if not exists public.punto_sync_events (
  id uuid default gen_random_uuid() primary key,
  organization_id text not null,
  branch_id text,
  device_id text,
  origin_device_id text,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  sync_status text not null default 'PENDING',
  version integer not null default 1,
  payload_json jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  last_synced_at timestamptz
);

create index if not exists punto_sync_events_org_idx
  on public.punto_sync_events (organization_id, created_at);

create index if not exists punto_sync_events_org_origin_idx
  on public.punto_sync_events (organization_id, origin_device_id, created_at);

create index if not exists punto_sync_events_entity_idx
  on public.punto_sync_events (organization_id, entity_type, entity_id);

-- RLS activado sin politicas: solo la SERVICE_ROLE_KEY (que omite RLS) puede acceder.
-- Las llaves anon/publicas quedan bloqueadas.
alter table public.punto_sync_events enable row level security;

-- Bucket de Storage para imagenes de productos, logos y adjuntos.
insert into storage.buckets (id, name, public)
values ('punto-flow', 'punto-flow', true)
on conflict (id) do nothing;
