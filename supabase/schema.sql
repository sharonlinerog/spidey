-- =====================================================================
-- Spidey — esquema de base de datos
-- Ejecútalo una sola vez en: Supabase -> tu proyecto -> SQL Editor -> New query
-- Es idempotente: puedes volver a correrlo sin romper nada.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Tabla de tareas
-- ---------------------------------------------------------------------
create table if not exists public.tareas (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  titulo       text not null,
  notas        text not null default '',
  estado       text not null default 'por_hacer',
  prioridad    text not null default 'media',
  responsable  text not null default '',
  etiquetas    text[] not null default '{}',
  vence        date,
  posicion     double precision not null default 0,
  creada       timestamptz not null default now(),
  actualizada  timestamptz not null default now(),
  completada   timestamptz,

  constraint titulo_no_vacio    check (char_length(btrim(titulo)) between 1 and 140),
  constraint notas_razonables   check (char_length(notas) <= 1200),
  constraint estado_valido      check (estado in ('por_hacer','en_curso','en_revision','hecho')),
  constraint prioridad_valida   check (prioridad in ('alta','media','baja')),
  constraint pocas_etiquetas    check (array_length(etiquetas, 1) is null or array_length(etiquetas, 1) <= 12)
);

comment on table public.tareas is 'Tareas de Spidey. Cada fila pertenece a un único usuario.';

-- ---------------------------------------------------------------------
-- Índices: las consultas siempre filtran por usuario y ordenan por posición
-- ---------------------------------------------------------------------
create index if not exists tareas_usuario_idx  on public.tareas (user_id, posicion);
create index if not exists tareas_vence_idx    on public.tareas (user_id, vence) where vence is not null;

-- ---------------------------------------------------------------------
-- Mantener "actualizada" al día
-- ---------------------------------------------------------------------
create or replace function public.tocar_actualizada()
returns trigger
language plpgsql
as $$
begin
  new.actualizada := now();
  return new;
end;
$$;

drop trigger if exists tareas_actualizada on public.tareas;
create trigger tareas_actualizada
  before update on public.tareas
  for each row execute function public.tocar_actualizada();

-- ---------------------------------------------------------------------
-- Seguridad a nivel de fila (RLS)
--
-- Esta es la protección real de la app: aunque alguien tome la clave
-- pública (anon) del navegador, solo podrá ver y tocar SUS propias filas.
-- ---------------------------------------------------------------------
alter table public.tareas enable row level security;

drop policy if exists "leer mis tareas"      on public.tareas;
drop policy if exists "crear mis tareas"     on public.tareas;
drop policy if exists "editar mis tareas"    on public.tareas;
drop policy if exists "eliminar mis tareas"  on public.tareas;

create policy "leer mis tareas"
  on public.tareas for select
  to authenticated
  using (auth.uid() = user_id);

create policy "crear mis tareas"
  on public.tareas for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "editar mis tareas"
  on public.tareas for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "eliminar mis tareas"
  on public.tareas for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Realtime: para que un cambio en el celular aparezca solo en el computador
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tareas'
  ) then
    alter publication supabase_realtime add table public.tareas;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Opcional: permitir que una persona borre su propia cuenta desde la app.
-- Descoméntalo si quieres ofrecer "eliminar mi cuenta".
-- ---------------------------------------------------------------------
-- create or replace function public.eliminar_mi_cuenta()
-- returns void
-- language sql
-- security definer
-- set search_path = public
-- as $$
--   delete from auth.users where id = auth.uid();
-- $$;
-- revoke all on function public.eliminar_mi_cuenta() from public;
-- grant execute on function public.eliminar_mi_cuenta() to authenticated;
