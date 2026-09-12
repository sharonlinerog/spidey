-- =====================================================================
-- Spidey — esquema de base de datos (v2)
--
-- Ejecútalo en: Supabase -> tu proyecto -> SQL Editor -> New query
-- Es idempotente: puedes volver a correrlo sin romper nada, y migra solo
-- los datos de la versión anterior (tareas sueltas por usuario) al modelo
-- nuevo de tableros compartidos.
--
-- Contenido:
--   1. Perfiles          — nombre y correo visibles entre compañeros
--   2. Tableros          — varios proyectos por persona
--   3. Miembros          — quién entra a cada tablero y con qué permiso
--   4. Funciones de permiso (la pieza que evita la recursión en RLS)
--   5. Tareas            — ahora pertenecen a un tablero, no a una persona
--   6. Subtareas
--   7. Comentarios
--   8. Adjuntos          — metadatos; el archivo vive en Storage
--   9. Historial         — bitácora automática por disparadores
--  10. Suscripciones push
--  11. Invitaciones por correo
--  12. Migración desde la v1
--  13. Políticas RLS
--  14. Realtime
--  15. Eliminar mi cuenta
-- =====================================================================

create extension if not exists "pgcrypto";

-- =====================================================================
-- 1. PERFILES
--
-- auth.users no es consultable desde el navegador. Sin esta tabla, en un
-- tablero compartido verías identificadores en vez de nombres.
-- =====================================================================
create table if not exists public.perfiles (
  id      uuid primary key references auth.users(id) on delete cascade,
  email   text not null,
  nombre  text not null default '',
  creado  timestamptz not null default now(),

  constraint nombre_razonable check (char_length(nombre) <= 80)
);

comment on table public.perfiles is 'Datos públicos mínimos de cada cuenta, para mostrarlos entre miembros de un tablero.';

-- Se crea solo al registrarse. `security definer` porque escribe en una
-- tabla con RLS desde un disparador sobre auth.users.
create or replace function public.crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, email, nombre)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'nombre', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil();

-- Rellena los perfiles de las cuentas que ya existían antes de este script.
insert into public.perfiles (id, email, nombre)
select u.id, coalesce(u.email, ''), split_part(coalesce(u.email, ''), '@', 1)
from auth.users u
on conflict (id) do nothing;

-- =====================================================================
-- 2. TABLEROS
-- =====================================================================
create table if not exists public.tableros (
  id           uuid primary key default gen_random_uuid(),
  propietario  uuid not null references auth.users(id) on delete cascade,
  nombre       text not null,
  descripcion  text not null default '',
  color        text not null default '#D30000',
  posicion     double precision not null default 0,
  archivado    boolean not null default false,
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now(),

  constraint nombre_tablero_valido check (char_length(btrim(nombre)) between 1 and 60),
  constraint descripcion_razonable check (char_length(descripcion) <= 300),
  constraint color_valido          check (color ~ '^#[0-9A-Fa-f]{6}$')
);

comment on table public.tableros is 'Un tablero es un proyecto: agrupa tareas y tiene sus propios miembros.';

create index if not exists tableros_propietario_idx on public.tableros (propietario, posicion);

-- =====================================================================
-- 3. MIEMBROS
--
-- Roles:
--   propietario — renombra, invita, expulsa y borra el tablero
--   editor      — crea y modifica tareas, comenta, adjunta
--   lector      — solo mira y comenta
-- =====================================================================
create table if not exists public.tablero_miembros (
  tablero_id  uuid not null references public.tableros(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  rol         text not null default 'editor',
  creado      timestamptz not null default now(),

  primary key (tablero_id, user_id),
  constraint rol_valido check (rol in ('propietario','editor','lector'))
);

create index if not exists miembros_usuario_idx on public.tablero_miembros (user_id);

-- Quien crea un tablero queda dentro como propietario en la misma
-- transacción: no hay forma de que quede un tablero sin dueño.
create or replace function public.membresia_del_creador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tablero_miembros (tablero_id, user_id, rol)
  values (new.id, new.propietario, 'propietario')
  on conflict (tablero_id, user_id) do update set rol = 'propietario';
  return new;
end;
$$;

drop trigger if exists al_crear_tablero on public.tableros;
create trigger al_crear_tablero
  after insert on public.tableros
  for each row execute function public.membresia_del_creador();

-- =====================================================================
-- 4. FUNCIONES DE PERMISO
--
-- Son `security definer` a propósito. Si una política sobre
-- tablero_miembros consultara tablero_miembros con RLS activo, Postgres
-- entraría en recursión infinita. Al saltarse RLS aquí, la pregunta
-- "¿pertenece este usuario a este tablero?" se responde una sola vez.
-- =====================================================================
create or replace function public.es_miembro(p_tablero uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tablero_miembros
    where tablero_id = p_tablero and user_id = auth.uid()
  );
$$;

create or replace function public.puede_editar(p_tablero uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tablero_miembros
    where tablero_id = p_tablero
      and user_id = auth.uid()
      and rol in ('propietario','editor')
  );
$$;

create or replace function public.es_propietario(p_tablero uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tablero_miembros
    where tablero_id = p_tablero and user_id = auth.uid() and rol = 'propietario'
  );
$$;

-- Las tablas hijas (subtareas, comentarios, adjuntos) heredan el permiso
-- de su tarea. Esta función hace de puente.
create or replace function public.tablero_de(p_tarea uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tablero_id from public.tareas where id = p_tarea;
$$;

-- =====================================================================
-- 5. TAREAS
-- =====================================================================
create table if not exists public.tareas (
  id           uuid primary key default gen_random_uuid(),
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

-- Columnas nuevas de la v2 (la tabla puede venir de la versión anterior).
alter table public.tareas add column if not exists tablero_id uuid references public.tableros(id) on delete cascade;
alter table public.tareas add column if not exists creada_por uuid references auth.users(id) on delete set null;

comment on table public.tareas is 'Tareas de Spidey. Cada fila pertenece a un tablero; quien entra al tablero la ve.';

-- =====================================================================
-- 6. SUBTAREAS
-- =====================================================================
create table if not exists public.subtareas (
  id        uuid primary key default gen_random_uuid(),
  tarea_id  uuid not null references public.tareas(id) on delete cascade,
  texto     text not null,
  hecha     boolean not null default false,
  posicion  double precision not null default 0,
  creada    timestamptz not null default now(),

  constraint texto_subtarea_valido check (char_length(btrim(texto)) between 1 and 160)
);

create index if not exists subtareas_tarea_idx on public.subtareas (tarea_id, posicion);

-- =====================================================================
-- 7. COMENTARIOS
-- =====================================================================
create table if not exists public.comentarios (
  id        uuid primary key default gen_random_uuid(),
  tarea_id  uuid not null references public.tareas(id) on delete cascade,
  autor     uuid not null references auth.users(id) on delete cascade,
  texto     text not null,
  creado    timestamptz not null default now(),
  editado   timestamptz,

  constraint texto_comentario_valido check (char_length(btrim(texto)) between 1 and 2000)
);

create index if not exists comentarios_tarea_idx on public.comentarios (tarea_id, creado);

-- =====================================================================
-- 8. ADJUNTOS
--
-- Aquí solo viven los metadatos. El archivo va al bucket "adjuntos" de
-- Storage, en la ruta <tablero_id>/<tarea_id>/<uuid>-<nombre>. Esa ruta
-- no es decorativa: las políticas de Storage leen el primer segmento
-- para saber a qué tablero pertenece el archivo.
-- =====================================================================
create table if not exists public.adjuntos (
  id         uuid primary key default gen_random_uuid(),
  tarea_id   uuid not null references public.tareas(id) on delete cascade,
  nombre     text not null,
  ruta       text not null unique,
  tipo       text not null default '',
  tamano     bigint not null default 0,
  subido_por uuid references auth.users(id) on delete set null,
  creado     timestamptz not null default now(),

  constraint nombre_adjunto_valido check (char_length(btrim(nombre)) between 1 and 200),
  constraint tamano_razonable      check (tamano >= 0 and tamano <= 26214400)
);

create index if not exists adjuntos_tarea_idx on public.adjuntos (tarea_id, creado);

-- =====================================================================
-- 9. HISTORIAL
--
-- Lo escriben disparadores, no la aplicación. Si lo llenara el navegador,
-- bastaría con no llamar a la función para que un cambio no quedara
-- registrado; así el registro es un hecho de la base de datos.
-- =====================================================================
create table if not exists public.historial (
  id          uuid primary key default gen_random_uuid(),
  tablero_id  uuid not null references public.tableros(id) on delete cascade,
  tarea_id    uuid,
  actor       uuid references auth.users(id) on delete set null,
  accion      text not null,
  detalle     jsonb not null default '{}'::jsonb,
  creado      timestamptz not null default now()
);

create index if not exists historial_tablero_idx on public.historial (tablero_id, creado desc);
create index if not exists historial_tarea_idx   on public.historial (tarea_id, creado desc);

comment on table public.historial is 'Bitácora automática de cambios. tarea_id no tiene clave foránea a propósito: el registro sobrevive al borrado de la tarea.';

-- =====================================================================
-- 10. SUSCRIPCIONES PUSH
-- =====================================================================
create table if not exists public.suscripciones_push (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  endpoint  text not null unique,
  p256dh    text not null,
  auth      text not null,
  agente    text not null default '',
  creada    timestamptz not null default now(),
  usada     timestamptz
);

create index if not exists push_usuario_idx on public.suscripciones_push (user_id);

-- =====================================================================
-- 11. INVITACIONES POR CORREO
--
-- Si invitas a alguien que todavía no tiene cuenta, la invitación espera
-- aquí y se convierte en membresía sola cuando esa persona se registra.
-- =====================================================================
create table if not exists public.invitaciones (
  id           uuid primary key default gen_random_uuid(),
  tablero_id   uuid not null references public.tableros(id) on delete cascade,
  email        text not null,
  rol          text not null default 'editor',
  invitado_por uuid references auth.users(id) on delete set null,
  creada       timestamptz not null default now(),

  unique (tablero_id, email),
  constraint rol_invitacion_valido check (rol in ('editor','lector'))
);

create index if not exists invitaciones_email_idx on public.invitaciones (lower(email));

-- Al crearse un perfil, se cobran las invitaciones que esperaban por ese correo.
create or replace function public.cobrar_invitaciones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tablero_miembros (tablero_id, user_id, rol)
  select i.tablero_id, new.id, i.rol
  from public.invitaciones i
  where lower(i.email) = lower(new.email)
  on conflict (tablero_id, user_id) do nothing;

  delete from public.invitaciones where lower(email) = lower(new.email);
  return new;
end;
$$;

drop trigger if exists al_crear_perfil on public.perfiles;
create trigger al_crear_perfil
  after insert on public.perfiles
  for each row execute function public.cobrar_invitaciones();

-- Invitar desde la app. Es `security definer` porque necesita mirar
-- auth.users para saber si ese correo ya tiene cuenta; el permiso de quien
-- invita se verifica explícitamente en la primera línea.
create or replace function public.invitar_a_tablero(p_tablero uuid, p_email text, p_rol text default 'editor')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_email  text := lower(btrim(p_email));
begin
  if not public.es_propietario(p_tablero) then
    raise exception 'Solo el propietario del tablero puede invitar.' using errcode = '42501';
  end if;
  if p_rol not in ('editor','lector') then
    raise exception 'Rol no válido.' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Correo no válido.' using errcode = '22023';
  end if;

  select id into v_id from auth.users where lower(email) = v_email limit 1;

  if v_id is null then
    insert into public.invitaciones (tablero_id, email, rol, invitado_por)
    values (p_tablero, v_email, p_rol, auth.uid())
    on conflict (tablero_id, email) do update set rol = excluded.rol;
    return 'pendiente';
  end if;

  if v_id = auth.uid() then
    return 'ya_estaba';
  end if;

  insert into public.tablero_miembros (tablero_id, user_id, rol)
  values (p_tablero, v_id, p_rol)
  on conflict (tablero_id, user_id) do update set rol = excluded.rol;

  insert into public.historial (tablero_id, actor, accion, detalle)
  values (p_tablero, auth.uid(), 'miembro_agregado', jsonb_build_object('email', v_email, 'rol', p_rol));

  return 'agregado';
end;
$$;

revoke all on function public.invitar_a_tablero(uuid, text, text) from public;
grant execute on function public.invitar_a_tablero(uuid, text, text) to authenticated;

-- =====================================================================
-- 12. MIGRACIÓN DESDE LA v1
--
-- La versión anterior guardaba tareas con una columna user_id y sin
-- tableros. Se le crea a cada persona un tablero "Mis tareas" con todo
-- lo suyo dentro, y se retira la columna vieja.
-- =====================================================================
do $$
declare
  v_user     uuid;
  v_tablero  uuid;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tareas' and column_name = 'user_id'
  ) then
    return;
  end if;

  for v_user in execute 'select distinct user_id from public.tareas where tablero_id is null and user_id is not null'
  loop
    insert into public.tableros (propietario, nombre, descripcion)
    values (v_user, 'Mis tareas', 'Tablero creado al actualizar Spidey.')
    returning id into v_tablero;

    execute 'update public.tareas set tablero_id = $1, creada_por = $2 where user_id = $2 and tablero_id is null'
      using v_tablero, v_user;
  end loop;

  execute 'alter table public.tareas drop column user_id';
end
$$;

-- Ya migrado: a partir de aquí toda tarea vive en un tablero.
do $$
begin
  if exists (select 1 from public.tareas where tablero_id is null) then
    raise notice 'Hay tareas sin tablero; se dejan como están para no perder datos.';
  else
    begin
      alter table public.tareas alter column tablero_id set not null;
    exception when others then
      null;
    end;
  end if;
end
$$;

create index if not exists tareas_tablero_idx on public.tareas (tablero_id, posicion);
create index if not exists tareas_vence_idx   on public.tareas (tablero_id, vence) where vence is not null;

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

drop trigger if exists tableros_actualizado on public.tableros;
create trigger tableros_actualizado
  before update on public.tableros
  for each row execute function public.tocar_actualizada();

-- ---------------------------------------------------------------------
-- Bitácora automática de tareas
--
-- Solo se anotan los campos que cambiaron. Una tarea que se arrastra
-- entre columnas mueve `posicion` en cada suelta; registrarla llenaría
-- el historial de ruido, así que un cambio de sola posición se ignora.
-- ---------------------------------------------------------------------
create or replace function public.anotar_tarea()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cambios jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.historial (tablero_id, tarea_id, actor, accion, detalle)
    values (new.tablero_id, new.id, auth.uid(), 'tarea_creada',
            jsonb_build_object('titulo', new.titulo));
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.historial (tablero_id, tarea_id, actor, accion, detalle)
    values (old.tablero_id, old.id, auth.uid(), 'tarea_eliminada',
            jsonb_build_object('titulo', old.titulo));
    return old;
  end if;

  if new.titulo is distinct from old.titulo then
    v_cambios := v_cambios || jsonb_build_object('titulo', jsonb_build_array(old.titulo, new.titulo));
  end if;
  if new.estado is distinct from old.estado then
    v_cambios := v_cambios || jsonb_build_object('estado', jsonb_build_array(old.estado, new.estado));
  end if;
  if new.prioridad is distinct from old.prioridad then
    v_cambios := v_cambios || jsonb_build_object('prioridad', jsonb_build_array(old.prioridad, new.prioridad));
  end if;
  if new.responsable is distinct from old.responsable then
    v_cambios := v_cambios || jsonb_build_object('responsable', jsonb_build_array(old.responsable, new.responsable));
  end if;
  if new.vence is distinct from old.vence then
    v_cambios := v_cambios || jsonb_build_object('vence', jsonb_build_array(old.vence, new.vence));
  end if;
  if new.notas is distinct from old.notas then
    v_cambios := v_cambios || jsonb_build_object('notas', jsonb_build_array('', ''));
  end if;
  if new.etiquetas is distinct from old.etiquetas then
    v_cambios := v_cambios || jsonb_build_object('etiquetas',
      jsonb_build_array(array_to_string(old.etiquetas, ', '), array_to_string(new.etiquetas, ', ')));
  end if;
  if new.tablero_id is distinct from old.tablero_id then
    v_cambios := v_cambios || jsonb_build_object('tablero', jsonb_build_array(old.tablero_id, new.tablero_id));
  end if;

  if v_cambios = '{}'::jsonb then
    return new;
  end if;

  insert into public.historial (tablero_id, tarea_id, actor, accion, detalle)
  values (new.tablero_id, new.id, auth.uid(), 'tarea_editada',
          jsonb_build_object('titulo', new.titulo, 'campos', v_cambios));
  return new;
end;
$$;

drop trigger if exists tareas_bitacora on public.tareas;
create trigger tareas_bitacora
  after insert or update or delete on public.tareas
  for each row execute function public.anotar_tarea();

-- Comentarios y adjuntos también dejan rastro.
create or replace function public.anotar_hijo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tarea    uuid := coalesce(new.tarea_id, old.tarea_id);
  v_tablero  uuid := public.tablero_de(v_tarea);
  v_accion   text;
  v_detalle  jsonb;
begin
  if v_tablero is null then return coalesce(new, old); end if;

  if tg_table_name = 'comentarios' and tg_op = 'INSERT' then
    v_accion := 'comentario_agregado';
    v_detalle := jsonb_build_object('extracto', left(new.texto, 90));
  elsif tg_table_name = 'adjuntos' and tg_op = 'INSERT' then
    v_accion := 'adjunto_agregado';
    v_detalle := jsonb_build_object('nombre', new.nombre);
  elsif tg_table_name = 'adjuntos' and tg_op = 'DELETE' then
    v_accion := 'adjunto_eliminado';
    v_detalle := jsonb_build_object('nombre', old.nombre);
  else
    return coalesce(new, old);
  end if;

  insert into public.historial (tablero_id, tarea_id, actor, accion, detalle)
  values (v_tablero, v_tarea, auth.uid(), v_accion, v_detalle);
  return coalesce(new, old);
end;
$$;

drop trigger if exists comentarios_bitacora on public.comentarios;
create trigger comentarios_bitacora
  after insert on public.comentarios
  for each row execute function public.anotar_hijo();

drop trigger if exists adjuntos_bitacora on public.adjuntos;
create trigger adjuntos_bitacora
  after insert or delete on public.adjuntos
  for each row execute function public.anotar_hijo();

-- =====================================================================
-- 13. SEGURIDAD A NIVEL DE FILA (RLS)
--
-- Esta es la protección real de la app: aunque alguien tome la clave
-- pública (anon) del navegador, solo verá los tableros a los que
-- pertenece, y solo escribirá donde su rol se lo permita.
-- =====================================================================
alter table public.perfiles           enable row level security;
alter table public.tableros           enable row level security;
alter table public.tablero_miembros   enable row level security;
alter table public.tareas             enable row level security;
alter table public.subtareas          enable row level security;
alter table public.comentarios        enable row level security;
alter table public.adjuntos           enable row level security;
alter table public.historial          enable row level security;
alter table public.suscripciones_push enable row level security;
alter table public.invitaciones       enable row level security;

-- ---- perfiles -------------------------------------------------------
drop policy if exists "ver perfiles de mis tableros" on public.perfiles;
drop policy if exists "editar mi perfil"             on public.perfiles;

-- Se ve el perfil propio y el de quien comparte algún tablero conmigo.
create policy "ver perfiles de mis tableros"
  on public.perfiles for select
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.tablero_miembros mio
      join public.tablero_miembros suyo on suyo.tablero_id = mio.tablero_id
      where mio.user_id = auth.uid() and suyo.user_id = perfiles.id
    )
  );

create policy "editar mi perfil"
  on public.perfiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---- tableros -------------------------------------------------------
drop policy if exists "ver mis tableros"      on public.tableros;
drop policy if exists "crear tableros"        on public.tableros;
drop policy if exists "editar mis tableros"   on public.tableros;
drop policy if exists "eliminar mis tableros" on public.tableros;

create policy "ver mis tableros"
  on public.tableros for select
  to authenticated
  using (public.es_miembro(id));

create policy "crear tableros"
  on public.tableros for insert
  to authenticated
  with check (propietario = auth.uid());

create policy "editar mis tableros"
  on public.tableros for update
  to authenticated
  using (public.es_propietario(id))
  with check (public.es_propietario(id));

create policy "eliminar mis tableros"
  on public.tableros for delete
  to authenticated
  using (propietario = auth.uid());

-- ---- miembros -------------------------------------------------------
drop policy if exists "ver miembros"     on public.tablero_miembros;
drop policy if exists "agregar miembros" on public.tablero_miembros;
drop policy if exists "cambiar miembros" on public.tablero_miembros;
drop policy if exists "quitar miembros"  on public.tablero_miembros;

create policy "ver miembros"
  on public.tablero_miembros for select
  to authenticated
  using (public.es_miembro(tablero_id));

create policy "agregar miembros"
  on public.tablero_miembros for insert
  to authenticated
  with check (public.es_propietario(tablero_id));

create policy "cambiar miembros"
  on public.tablero_miembros for update
  to authenticated
  using (public.es_propietario(tablero_id))
  with check (public.es_propietario(tablero_id));

-- El propietario expulsa a quien quiera; cualquiera puede salirse solo.
create policy "quitar miembros"
  on public.tablero_miembros for delete
  to authenticated
  using (public.es_propietario(tablero_id) or user_id = auth.uid());

-- ---- tareas ---------------------------------------------------------
drop policy if exists "leer tareas del tablero"     on public.tareas;
drop policy if exists "crear tareas del tablero"    on public.tareas;
drop policy if exists "editar tareas del tablero"   on public.tareas;
drop policy if exists "eliminar tareas del tablero" on public.tareas;
drop policy if exists "leer mis tareas"             on public.tareas;
drop policy if exists "crear mis tareas"            on public.tareas;
drop policy if exists "editar mis tareas"           on public.tareas;
drop policy if exists "eliminar mis tareas"         on public.tareas;

create policy "leer tareas del tablero"
  on public.tareas for select
  to authenticated
  using (public.es_miembro(tablero_id));

create policy "crear tareas del tablero"
  on public.tareas for insert
  to authenticated
  with check (public.puede_editar(tablero_id));

create policy "editar tareas del tablero"
  on public.tareas for update
  to authenticated
  using (public.puede_editar(tablero_id))
  with check (public.puede_editar(tablero_id));

create policy "eliminar tareas del tablero"
  on public.tareas for delete
  to authenticated
  using (public.puede_editar(tablero_id));

-- ---- subtareas ------------------------------------------------------
drop policy if exists "leer subtareas"     on public.subtareas;
drop policy if exists "escribir subtareas" on public.subtareas;
drop policy if exists "editar subtareas"   on public.subtareas;
drop policy if exists "borrar subtareas"   on public.subtareas;

create policy "leer subtareas"
  on public.subtareas for select
  to authenticated
  using (public.es_miembro(public.tablero_de(tarea_id)));

create policy "escribir subtareas"
  on public.subtareas for insert
  to authenticated
  with check (public.puede_editar(public.tablero_de(tarea_id)));

create policy "editar subtareas"
  on public.subtareas for update
  to authenticated
  using (public.puede_editar(public.tablero_de(tarea_id)))
  with check (public.puede_editar(public.tablero_de(tarea_id)));

create policy "borrar subtareas"
  on public.subtareas for delete
  to authenticated
  using (public.puede_editar(public.tablero_de(tarea_id)));

-- ---- comentarios ----------------------------------------------------
-- Comentar es un derecho de lectura: hasta un rol "lector" puede opinar.
-- Editar o borrar un comentario, en cambio, solo su autor.
drop policy if exists "leer comentarios"     on public.comentarios;
drop policy if exists "escribir comentarios" on public.comentarios;
drop policy if exists "editar mi comentario" on public.comentarios;
drop policy if exists "borrar mi comentario" on public.comentarios;

create policy "leer comentarios"
  on public.comentarios for select
  to authenticated
  using (public.es_miembro(public.tablero_de(tarea_id)));

create policy "escribir comentarios"
  on public.comentarios for insert
  to authenticated
  with check (autor = auth.uid() and public.es_miembro(public.tablero_de(tarea_id)));

create policy "editar mi comentario"
  on public.comentarios for update
  to authenticated
  using (autor = auth.uid())
  with check (autor = auth.uid());

create policy "borrar mi comentario"
  on public.comentarios for delete
  to authenticated
  using (autor = auth.uid() or public.es_propietario(public.tablero_de(tarea_id)));

-- ---- adjuntos -------------------------------------------------------
drop policy if exists "leer adjuntos"   on public.adjuntos;
drop policy if exists "subir adjuntos"  on public.adjuntos;
drop policy if exists "borrar adjuntos" on public.adjuntos;

create policy "leer adjuntos"
  on public.adjuntos for select
  to authenticated
  using (public.es_miembro(public.tablero_de(tarea_id)));

create policy "subir adjuntos"
  on public.adjuntos for insert
  to authenticated
  with check (subido_por = auth.uid() and public.puede_editar(public.tablero_de(tarea_id)));

create policy "borrar adjuntos"
  on public.adjuntos for delete
  to authenticated
  using (public.puede_editar(public.tablero_de(tarea_id)));

-- ---- historial ------------------------------------------------------
-- Solo lectura desde la app: lo escriben los disparadores, que corren
-- como `security definer` y no pasan por estas políticas.
drop policy if exists "leer historial" on public.historial;

create policy "leer historial"
  on public.historial for select
  to authenticated
  using (public.es_miembro(tablero_id));

-- ---- suscripciones push ---------------------------------------------
drop policy if exists "ver mis suscripciones"     on public.suscripciones_push;
drop policy if exists "crear mis suscripciones"   on public.suscripciones_push;
drop policy if exists "borrar mis suscripciones"  on public.suscripciones_push;

create policy "ver mis suscripciones"
  on public.suscripciones_push for select
  to authenticated
  using (user_id = auth.uid());

create policy "crear mis suscripciones"
  on public.suscripciones_push for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "borrar mis suscripciones"
  on public.suscripciones_push for delete
  to authenticated
  using (user_id = auth.uid());

-- ---- invitaciones ---------------------------------------------------
drop policy if exists "ver invitaciones del tablero"    on public.invitaciones;
drop policy if exists "borrar invitaciones del tablero" on public.invitaciones;

create policy "ver invitaciones del tablero"
  on public.invitaciones for select
  to authenticated
  using (public.es_miembro(tablero_id));

create policy "borrar invitaciones del tablero"
  on public.invitaciones for delete
  to authenticated
  using (public.es_propietario(tablero_id));

-- =====================================================================
-- 14. REALTIME
-- Para que un cambio en el celular aparezca solo en el computador —y en
-- el de la persona con quien compartes el tablero.
-- =====================================================================
do $$
declare
  t text;
begin
  foreach t in array array['tareas','subtareas','comentarios','adjuntos','historial','tablero_miembros','tableros']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- =====================================================================
-- 15. ELIMINAR MI CUENTA
--
-- Habeas data (Ley 1581 de 2012): la persona debe poder irse. Al borrar
-- la fila de auth.users, el `on delete cascade` se lleva perfiles,
-- tableros propios, membresías y suscripciones.
-- =====================================================================
create or replace function public.eliminar_mi_cuenta()
returns void
language sql
security definer
set search_path = public
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.eliminar_mi_cuenta() from public;
grant execute on function public.eliminar_mi_cuenta() to authenticated;
