-- =====================================================================
-- Spidey — programar los avisos diarios
--
-- Ejecútalo DESPUÉS de desplegar las funciones de borde:
--   npx supabase functions deploy notificar-correo
--   npx supabase functions deploy notificar-vencimientos   (opcional, push)
--
-- ANTES DE EJECUTAR: reemplaza los dos valores de la sección 1.
-- Los dos son públicos: la URL del proyecto y la clave `anon`, que ya
-- viaja dentro de la app en el navegador. Aquí NO hace falta la
-- service_role: esa cabecera solo sirve para que Supabase deje pasar la
-- llamada, y la función usa su propia clave de servicio por dentro.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- =====================================================================
-- 1. TUS DOS VALORES
--
-- Están en Supabase -> Project Settings -> API:
--   Project URL   -> la primera
--   anon public   -> la segunda
-- =====================================================================
create or replace function public.spidey_url_funciones()
returns text language sql immutable as $$
  select 'https://elyhykjylswkbgichaqt.supabase.co/functions/v1'
$$;

create or replace function public.spidey_clave_anon()
returns text language sql immutable as $$
  select 'PEGA-AQUI-TU-ANON-KEY'
$$;

-- =====================================================================
-- 2. QUIEN HACE LA LLAMADA
-- =====================================================================
create or replace function public.disparar_funcion(p_nombre text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  select net.http_post(
    url     := public.spidey_url_funciones() || '/' || p_nombre,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || public.spidey_clave_anon()
               ),
    body    := '{}'::jsonb
  ) into v_id;

  return v_id;
end;
$$;

-- Avisos por correo: a todo el que pertenezca al tablero.
create or replace function public.disparar_correos()
returns bigint language sql security definer set search_path = public as $$
  select public.disparar_funcion('notificar-correo');
$$;

-- Avisos push: solo a quien los haya activado en su dispositivo.
create or replace function public.disparar_recordatorios()
returns bigint language sql security definer set search_path = public as $$
  select public.disparar_funcion('notificar-vencimientos');
$$;

revoke all on function public.disparar_funcion(text) from public;
revoke all on function public.disparar_correos() from public;
revoke all on function public.disparar_recordatorios() from public;

-- =====================================================================
-- 3. LA PROGRAMACIÓN
--
-- Todos los días a las 13:00 UTC = 8:00 a. m. en Colombia. Si cambias de
-- país, ajusta la hora: pg_cron siempre razona en UTC.
--
-- Los dos avisos van con cinco minutos de diferencia para no abrir dos
-- conexiones pesadas a la vez.
-- =====================================================================
select cron.unschedule('spidey-correos')
where exists (select 1 from cron.job where jobname = 'spidey-correos');

select cron.schedule('spidey-correos', '0 13 * * *', $$select public.disparar_correos();$$);

select cron.unschedule('spidey-recordatorios')
where exists (select 1 from cron.job where jobname = 'spidey-recordatorios');

select cron.schedule('spidey-recordatorios', '5 13 * * *', $$select public.disparar_recordatorios();$$);

-- =====================================================================
-- 4. COMPROBAR
-- =====================================================================
-- Que quedaron programados:
--   select jobname, schedule, active from cron.job;
--
-- Las últimas corridas:
--   select jobname, status, start_time from cron.job_run_details
--   order by start_time desc limit 10;
--
-- Probar el correo ahora mismo:
--   select public.disparar_correos();
--
-- Ojo al probar: solo se escribe una vez por persona y día. Para repetir
-- el envío de hoy hay que borrar la marca primero:
--   delete from public.avisos_enviados where fecha = current_date;
