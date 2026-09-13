-- =====================================================================
-- Spidey — respaldo manual
--
-- Para el plan Free de Supabase, que no trae respaldos descargables.
--
-- Pégalo en SQL Editor -> New query -> Run. Devuelve UNA celda con todos
-- tus datos en JSON. Haz clic en ella, copia el contenido y pégalo en un
-- archivo de texto que guardes en tu computador. Eso es tu respaldo.
--
-- No cambia nada: solo lee.
--
-- Funciona aunque falten tablas: cada una se consulta solo si existe, así
-- que sirve igual antes y después de actualizar el esquema.
-- =====================================================================

do $$
declare
  v_sql   text := '';
  v_tabla text;
begin
  -- Se arma la consulta sobre la marcha con las tablas que de verdad
  -- existen. Nombrarlas a mano haría fallar el respaldo justo cuando más
  -- falta hace: cuando la base no está como uno espera.
  for v_tabla in
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  loop
    v_sql := v_sql || format(
      ', %L, (select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x)',
      v_tabla, v_tabla
    );
  end loop;

  if v_sql = '' then
    raise exception 'No hay ninguna tabla en el esquema public.';
  end if;

  -- Se deja el resultado en una tabla temporal para poder verlo después.
  execute format(
    'create temp table respaldo_spidey as
     select jsonb_pretty(jsonb_build_object(%L, now()::text %s)) as respaldo',
    'exportado', v_sql
  );
end
$$;

select * from respaldo_spidey;
