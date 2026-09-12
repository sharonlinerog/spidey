-- =====================================================================
-- Spidey — almacenamiento de adjuntos
--
-- Ejecútalo DESPUÉS de schema.sql, en el mismo SQL Editor.
-- Crea el bucket privado "adjuntos" y sus políticas.
--
-- La ruta de cada archivo es:  <tablero_id>/<tarea_id>/<uuid>-<nombre>
-- El primer segmento no es decorativo: las políticas de abajo lo leen
-- para saber a qué tablero pertenece el archivo y aplicar el mismo
-- permiso que ya rige las tareas.
-- =====================================================================

-- Bucket privado. Los archivos no se sirven por URL pública: la app pide
-- una URL firmada de corta duración cada vez que alguien quiere abrirlos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('adjuntos', 'adjuntos', false, 26214400, null)
on conflict (id) do update
  set public = false,
      file_size_limit = 26214400;

-- ---------------------------------------------------------------------
-- Un texto que no sea un UUID no puede convertirse, y un error dentro de
-- una política tumba la consulta entera. Esta función devuelve null en
-- vez de reventar, de modo que una ruta con forma rara simplemente no
-- concede permiso.
-- ---------------------------------------------------------------------
create or replace function public.uuid_o_nulo(p text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Políticas del bucket
-- ---------------------------------------------------------------------
drop policy if exists "adjuntos: leer"   on storage.objects;
drop policy if exists "adjuntos: subir"  on storage.objects;
drop policy if exists "adjuntos: borrar" on storage.objects;

create policy "adjuntos: leer"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'adjuntos'
    and public.es_miembro(public.uuid_o_nulo((storage.foldername(name))[1]))
  );

create policy "adjuntos: subir"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'adjuntos'
    and public.puede_editar(public.uuid_o_nulo((storage.foldername(name))[1]))
  );

create policy "adjuntos: borrar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'adjuntos'
    and public.puede_editar(public.uuid_o_nulo((storage.foldername(name))[1]))
  );
