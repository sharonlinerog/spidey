-- =====================================================================
-- Spidey — diagnóstico
--
-- Pégalo entero en Supabase -> SQL Editor -> New query y dale Run.
-- No cambia nada: solo mira y reporta.
--
-- Sirve para saber si tu base de datos quedó a medio camino entre el
-- esquema de la versión anterior y el de la v2. `create table if not
-- exists` no toca una tabla que ya existe, así que una tabla vieja con
-- otra forma sobrevive intacta y el código nuevo no la entiende.
-- =====================================================================

-- 1. ¿Qué columnas tiene cada tabla, de verdad?
select
  table_name  as tabla,
  string_agg(column_name, ', ' order by ordinal_position) as columnas
from information_schema.columns
where table_schema = 'public'
  and table_name in ('tareas','tableros','tablero_miembros','perfiles',
                     'subtareas','comentarios','adjuntos','historial',
                     'invitaciones','suscripciones_push')
group by table_name
order by table_name;

-- 2. ¿Qué valores de rol hay guardados? Deberían ser exactamente
--    'propietario', 'editor' y 'lector'.
select rol, count(*) as cuantos
from public.tablero_miembros
group by rol
order by cuantos desc;

-- 3. ¿Cuál es TU membresía? Debería decir 'propietario' en tu tablero.
select
  t.nombre       as tablero,
  m.rol          as tu_rol,
  t.propietario = auth.uid() as eres_la_duenia
from public.tablero_miembros m
join public.tableros t on t.id = m.tablero_id
where m.user_id = auth.uid();

-- 4. ¿Están las funciones de permiso que usan las políticas?
select routine_name as funcion
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('es_miembro','puede_editar','es_propietario',
                       'tablero_de','invitar_a_tablero','uuid_o_nulo')
order by routine_name;

-- 5. ¿Quedan tareas sin tablero? (la migración debió dejarlas todas dentro)
select count(*) as tareas_sin_tablero
from public.tareas
where tablero_id is null;

-- 6. ¿Existe el bucket de adjuntos? (lo crea storage.sql)
select id, public as es_publico from storage.buckets where id = 'adjuntos';
