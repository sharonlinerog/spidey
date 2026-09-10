/**
 * Capa de datos.
 *
 * Responsabilidades:
 *  - leer y escribir tareas en Supabase (siempre filtradas por el usuario en sesión,
 *    con RLS del lado del servidor como garantía real),
 *  - mantener una copia local para que la app abra al instante y funcione sin conexión,
 *  - encolar los cambios hechos sin internet y enviarlos al recuperar la conexión,
 *  - avisar a la interfaz cada vez que los datos cambian.
 */

import { supabase, mensajeError } from "./supabase.js";

const CAMPOS =
  "id,titulo,notas,estado,prioridad,responsable,etiquetas,vence,posicion,creada,completada";

const ESTADOS_VALIDOS = ["por_hacer", "en_curso", "en_revision", "hecho"];
const PRIORIDADES_VALIDAS = ["alta", "media", "baja"];

// Los mismos límites que imponen las restricciones CHECK de la base de datos.
// Aplicarlos también aquí evita dos cosas: que el servidor rechace la fila con
// un error críptico, y que un dato manipulado en la caché local llegue al DOM.
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITULO = 140;
const MAX_NOTAS = 1200;
const MAX_RESPONSABLE = 60;
const MAX_ETIQUETA = 40;
const MAX_ETIQUETAS = 12;

let usuario = null;
let tareas = [];
let canal = null;
let alCambiar = () => {};
let alEstado = () => {};

/* ---------------- almacenamiento local ---------------- */

function claveCache() {
  return "spidey:cache:" + (usuario ? usuario.id : "anon");
}
function claveSalida() {
  return "spidey:salida:" + (usuario ? usuario.id : "anon");
}
function leerLocal(clave, porDefecto) {
  try {
    const crudo = localStorage.getItem(clave);
    return crudo ? JSON.parse(crudo) : porDefecto;
  } catch {
    return porDefecto;
  }
}
function escribirLocal(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    /* almacenamiento lleno o bloqueado: la app sigue funcionando en memoria */
  }
}

/* ---------------- normalización ---------------- */

export function normalizar(fila) {
  const id = String(fila.id || "");
  const titulo = String(fila.titulo || "").trim().slice(0, MAX_TITULO);
  const vence = String(fila.vence || "");
  return {
    // Un id que no sea un UUID no existe en el servidor (la columna es uuid),
    // así que sólo puede venir de una caché manipulada: se descarta.
    id: RE_UUID.test(id) ? id : crypto.randomUUID(),
    titulo: titulo || "Tarea sin título",
    notas: String(fila.notas || "").slice(0, MAX_NOTAS),
    estado: ESTADOS_VALIDOS.includes(fila.estado) ? fila.estado : "por_hacer",
    prioridad: PRIORIDADES_VALIDAS.includes(fila.prioridad) ? fila.prioridad : "media",
    responsable: String(fila.responsable || "").slice(0, MAX_RESPONSABLE),
    etiquetas: Array.isArray(fila.etiquetas)
      ? fila.etiquetas
          .filter((e) => typeof e === "string" && e.trim())
          .map((e) => e.trim().slice(0, MAX_ETIQUETA))
          .slice(0, MAX_ETIQUETAS)
      : [],
    vence: RE_FECHA.test(vence) ? vence : "",
    posicion: Number.isFinite(fila.posicion) ? fila.posicion : 0,
    creada: fila.creada || new Date().toISOString(),
    completada: fila.completada || null,
  };
}

function paraServidor(t) {
  return {
    id: t.id,
    user_id: usuario.id,
    titulo: t.titulo,
    notas: t.notas,
    estado: t.estado,
    prioridad: t.prioridad,
    responsable: t.responsable,
    etiquetas: t.etiquetas,
    vence: t.vence || null,
    posicion: t.posicion,
    creada: t.creada,
    completada: t.estado === "hecho" ? t.completada || new Date().toISOString() : null,
  };
}

/* ---------------- ciclo de vida ---------------- */

export function alActualizar(fn) {
  alCambiar = fn;
}
export function alCambiarEstado(fn) {
  alEstado = fn;
}
export function lista() {
  return tareas;
}

export async function iniciarSesionDeDatos(u) {
  usuario = u;
  tareas = leerLocal(claveCache(), []).map(normalizar);
  alCambiar(tareas, { desdeCache: true });

  await sincronizar();
  suscribir();
  window.addEventListener("online", alVolverLaConexion);
  window.addEventListener("offline", () => alEstado("offline", "Sin conexión — los cambios se guardan al volver"));
}

export function terminarSesionDeDatos() {
  if (canal) {
    supabase.removeChannel(canal);
    canal = null;
  }
  window.removeEventListener("online", alVolverLaConexion);
  tareas = [];
  usuario = null;
}

function alVolverLaConexion() {
  vaciarSalida().then(sincronizar);
}

/* ---------------- sincronización ---------------- */

export async function sincronizar() {
  if (!usuario) return;
  if (!navigator.onLine) {
    alEstado("offline", "Sin conexión — mostrando la copia local");
    return;
  }
  const { data, error } = await supabase
    .from("tareas")
    .select(CAMPOS)
    .eq("user_id", usuario.id)
    .order("posicion", { ascending: true });

  if (error) {
    alEstado("mal", mensajeError(error));
    return;
  }
  tareas = (data || []).map(normalizar);
  escribirLocal(claveCache(), tareas);
  const pendientes = leerLocal(claveSalida(), []).length;
  alEstado(
    pendientes ? "offline" : "on",
    pendientes ? pendientes + " cambio(s) por enviar" : "Guardado en la nube"
  );
  alCambiar(tareas, { desdeCache: false });
}

function suscribir() {
  if (!usuario || canal) return;
  canal = supabase
    .channel("tareas-" + usuario.id)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "tareas",
        filter: "user_id=eq." + usuario.id,
      },
      (evento) => {
        if (evento.eventType === "DELETE") {
          tareas = tareas.filter((t) => t.id !== String(evento.old.id));
        } else {
          const fila = normalizar(evento.new);
          const i = tareas.findIndex((t) => t.id === fila.id);
          if (i >= 0) tareas[i] = fila;
          else tareas.push(fila);
        }
        escribirLocal(claveCache(), tareas);
        alCambiar(tareas, { desdeCache: false });
      }
    )
    .subscribe();
}

/* ---------------- cola de cambios sin conexión ---------------- */

function encolar(operacion) {
  const salida = leerLocal(claveSalida(), []);
  // Una sola entrada por tarea: la última versión gana.
  const filtrada = salida.filter((o) => o.id !== operacion.id);
  filtrada.push(operacion);
  escribirLocal(claveSalida(), filtrada);
  alEstado("offline", filtrada.length + " cambio(s) por enviar");
}

export async function vaciarSalida() {
  if (!usuario || !navigator.onLine) return;
  const salida = leerLocal(claveSalida(), []);
  if (!salida.length) return;

  const restantes = [];
  for (const op of salida) {
    const { error } =
      op.tipo === "borrar"
        ? await supabase.from("tareas").delete().eq("id", op.id).eq("user_id", usuario.id)
        : await supabase.from("tareas").upsert(op.datos, { onConflict: "id" });
    if (error) restantes.push(op);
  }
  escribirLocal(claveSalida(), restantes);
  alEstado(
    restantes.length ? "mal" : "on",
    restantes.length
      ? "No se pudieron enviar " + restantes.length + " cambio(s)"
      : "Guardado en la nube"
  );
}

/* ---------------- escrituras ---------------- */

export async function guardar(tarea) {
  const t = normalizar(tarea);
  const i = tareas.findIndex((x) => x.id === t.id);
  if (i >= 0) tareas[i] = t;
  else tareas.push(t);
  escribirLocal(claveCache(), tareas);
  alCambiar(tareas, { desdeCache: false });

  const datos = paraServidor(t);
  if (!navigator.onLine) {
    encolar({ tipo: "guardar", id: t.id, datos });
    return { ok: true, encolado: true };
  }
  const { error } = await supabase.from("tareas").upsert(datos, { onConflict: "id" });
  if (error) {
    encolar({ tipo: "guardar", id: t.id, datos });
    return { ok: false, mensaje: mensajeError(error) };
  }
  alEstado("on", "Guardado en la nube");
  return { ok: true };
}

export async function eliminar(id) {
  tareas = tareas.filter((t) => t.id !== id);
  escribirLocal(claveCache(), tareas);
  alCambiar(tareas, { desdeCache: false });

  if (!navigator.onLine) {
    encolar({ tipo: "borrar", id });
    return { ok: true, encolado: true };
  }
  const { error } = await supabase
    .from("tareas")
    .delete()
    .eq("id", id)
    .eq("user_id", usuario.id);
  if (error) {
    encolar({ tipo: "borrar", id });
    return { ok: false, mensaje: mensajeError(error) };
  }
  alEstado("on", "Guardado en la nube");
  return { ok: true };
}
