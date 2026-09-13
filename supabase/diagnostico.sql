-- =====================================================================
-- Spidey — diagnóstico
--
-- Pégalo entero en Supabase -> SQL Editor -> New query y dale Run.
-- No cambia nada y NO PUEDE FALLAR: solo le pregunta al catálogo del
-- sistema qué existe, sin tocar ninguna tabla. Da igual en qué estado
-- esté la base de datos.
--
-- Sirve para saber qué hay realmente antes de escribir una reparación.
-- `create table if not exists` no modifica una tabla que ya existe, así
-- que una tabla vieja con otra forma sobrevive intacta y el código nuevo
-- no la entiende.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Qué tablas de Spidey existen y cuáles faltan
-- ---------------------------------------------------------------------
select
  esperada as tabla,
  case when c.table_name is null then 'FALTA' else 'existe' end as estado
from (values
  ('tareas'), ('tableros'), ('tablero_miembros'), ('perfiles'),
  ('subtareas'), ('comentarios'), ('adjuntos'), ('historial'),
  ('invitaciones'), ('suscripciones_push')
) as e(esperada)
left join information_schema.tables c
  on c.table_schema = 'public' and c.table_name = e.esperada
order by estado desc, tabla;

-- ---------------------------------------------------------------------
-- 2. TODAS las tablas que hay en public, con sus columnas.
--    Aquí es donde se ve si la versión anterior dejó tablas con otro
--    nombre (miembros, colaboradores, boards…) o con otra forma.
-- ---------------------------------------------------------------------
select
  c.table_name as tabla,
  string_agg(c.column_name || ' ' || c.data_type, ', ' order by c.ordinal_position) as columnas
from information_schema.columns c
join information_schema.tables t
  on t.table_schema = c.table_schema and t.table_name = c.table_name
where c.table_schema = 'public'
  and t.table_type = 'BASE TABLE'
group by c.table_name
order by c.table_name;

-- ---------------------------------------------------------------------
-- 3. Cuántas filas tiene cada tabla (estimado del planificador, sin leerlas)
-- ---------------------------------------------------------------------
select
  relname as tabla,
  greatest(n_live_tup, 0) as filas_aprox
from pg_stat_user_tables
where schemaname = 'public'
order by filas_aprox desc;

-- ---------------------------------------------------------------------
-- 4. Qué funciones de Spidey existen
-- ---------------------------------------------------------------------
select
  esperada as funcion,
  case when r.routine_name is null then 'FALTA' else 'existe' end as estado
from (values
  ('es_miembro'), ('puede_editar'), ('es_propietario'), ('tablero_de'),
  ('invitar_a_tablero'), ('eliminar_mi_cuenta'), ('uuid_o_nulo'),
  ('crear_perfil'), ('anotar_tarea')
) as e(esperada)
left join information_schema.routines r
  on r.routine_schema = 'public' and r.routine_name = e.esperada
order by estado desc, funcion;

-- ---------------------------------------------------------------------
-- 5. Qué políticas de seguridad hay, y sobre qué tablas
-- ---------------------------------------------------------------------
select tablename as tabla, policyname as politica, cmd as operacion
from pg_policies
where schemaname = 'public'
order by tabla, politica;

-- ---------------------------------------------------------------------
-- 6. Buckets de almacenamiento
-- ---------------------------------------------------------------------
select id, public as es_publico from storage.buckets;
