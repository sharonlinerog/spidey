-- =====================================================================
-- Spidey — programar el recordatorio diario
--
-- Ejecútalo DESPUÉS de desplegar la función de borde:
--   supabase functions deploy notificar-vencimientos
--
-- Antes de correrlo, reemplaza los dos valores marcados con << >>.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- La clave de servicio NO se escribe dentro del cron: quedaría legible
-- en cron.job para cualquiera con acceso a la consola. Se guarda una vez
-- en la configuración de la base y se lee por nombre.
--
-- Ejecuta esta línea aparte, con tus valores reales:
--
--   alter database postgres set app.url_funciones = 'https://<<TU-PROYECTO>>.supabase.co/functions/v1';
--   alter database postgres set app.llave_servicio = '<<TU SERVICE ROLE KEY>>';
--
-- Después de un `alter database ... set`, hay que reconectar la sesión
-- del SQL Editor (recarga la página) para que los valores se vean.
-- ---------------------------------------------------------------------

-- Una sola función para las dos: la única diferencia es a qué función de
-- borde se llama, así que se pasa por parámetro.
create or replace function public.disparar_funcion(p_nombre text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text := current_setting('app.url_funciones', true);
  v_llave  text := current_setting('app.llave_servicio', true);
  v_id     bigint;
begin
  if v_url is null or v_llave is null then
    raise exception 'Faltan app.url_funciones o app.llave_servicio. Configúralos con alter database.';
  end if;

  select net.http_post(
    url     := v_url || '/' || p_nombre,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_llave
               ),
    body    := '{}'::jsonb
  ) into v_id;

  return v_id;
end;
$$;

-- Avisos por correo: a todo el que pertenezca al tablero.
create or replace function public.disparar_correos()
returns bigint
language sql
security definer
set search_path = public
as $$
  select public.disparar_funcion('notificar-correo');
$$;

-- Avisos push: solo a quien los haya activado en su dispositivo.
create or replace function public.disparar_recordatorios()
returns bigint
language sql
security definer
set search_path = public
as $$
  select public.disparar_funcion('notificar-vencimientos');
$$;

revoke all on function public.disparar_funcion(text) from public;
revoke all on function public.disparar_correos() from public;
revoke all on function public.disparar_recordatorios() from public;

-- ---------------------------------------------------------------------
-- Programación: todos los días a las 13:00 UTC = 8:00 a. m. en Colombia.
-- Si cambias de país, ajusta la hora: pg_cron siempre razona en UTC.
--
-- Los dos avisos van a la misma hora pero con cinco minutos de diferencia,
-- para no abrir dos conexiones pesadas a la vez.
-- ---------------------------------------------------------------------
select cron.unschedule('spidey-correos')
where exists (select 1 from cron.job where jobname = 'spidey-correos');

select cron.schedule(
  'spidey-correos',
  '0 13 * * *',
  $$select public.disparar_correos();$$
);

select cron.unschedule('spidey-recordatorios')
where exists (select 1 from cron.job where jobname = 'spidey-recordatorios');

select cron.schedule(
  'spidey-recordatorios',
  '5 13 * * *',
  $$select public.disparar_recordatorios();$$
);

-- Para revisar que quedaron programados:
--   select jobname, schedule, active from cron.job;
-- Para ver las últimas corridas:
--   select * from cron.job_run_details order by start_time desc limit 10;
-- Para probar el correo ahora mismo sin esperar:
--   select public.disparar_correos();
--
-- Ojo al probar: solo se escribe una vez por persona y día. Si ya recibiste
-- el de hoy y quieres repetirlo, hay que borrar la marca primero:
--   delete from public.avisos_enviados where fecha = current_date;
