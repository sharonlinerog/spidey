/**
 * Capa de datos.
 *
 * Responsabilidades:
 *  - leer y escribir en Supabase (siempre dentro del tablero activo, con
 *    RLS del lado del servidor como garantía real),
 *  - mantener una copia local para que la app abra al instante y funcione
 *    sin conexión,
 *  - encolar los cambios hechos sin internet y enviarlos al reconectar,
 *  - avisar a la interfaz cada vez que los datos cambian.
 *
 * Qué funciona sin conexión y qué no:
 *  - Tareas y subtareas: sí. Se pintan al instante y se encolan.
 *  - Comentarios, adjuntos, miembros e historial: no. Son hechos
 *    compartidos entre varias personas; fingir que se guardaron sería
 *    mentirle a quien está del otro lado del tablero.
 */

import { supabase, mensajeError } from "./supabase.js";

const CAMPOS_TAREA =
  "id,tablero_id,titulo,notas,estado,prioridad,responsable,etiquetas,vence,posicion,creada,completada,creada_por";

const ESTADOS_VALIDOS = ["por_hacer", "en_curso", "en_revision", "hecho"];
const PRIORIDADES_VALIDAS = ["alta", "media", "baja"];
const ROLES_VALIDOS = ["propietario", "editor", "lector"];

// Los mismos límites que imponen las restricciones CHECK de la base de datos.
// Aplicarlos también aquí evita dos cosas: que el servidor rechace la fila con
// un error críptico, y que un dato manipulado en la caché local llegue al DOM.
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_COLOR = /^#[0-9A-Fa-f]{6}$/;
const MAX_TITULO = 140;
const MAX_NOTAS = 1200;
const MAX_RESPONSABLE = 60;
const MAX_ETIQUETA = 40;
const MAX_ETIQUETAS = 12;
const MAX_SUBTAREA = 160;
const MAX_COMENTARIO = 2000;
const MAX_NOMBRE_TABLERO = 60;
export const MAX_ADJUNTO = 25 * 1024 * 1024;

let usuario = null;
let tableros = [];
let tableroId = null;
let tareas = [];
let subtareas = [];
let miembros = [];
let invitaciones = [];
let conteos = { comentarios: {}, adjuntos: {} };
let detalle = { tareaId: null, comentarios: [], adjuntos: [], historial: [] };
let actividad = [];
let visto = null;
let miPerfil = null;
let canal = null;

let alCambiar = () => {};
let alEstado = () => {};
let alCambiarTableros = () => {};
let alCambiarDetalle = () => {};

/* ==================== almacenamiento local ==================== */

const claveTableros = () => "spidey:tableros:" + (usuario ? usuario.id : "anon");
const claveActivo = () => "spidey:tablero:" + (usuario ? usuario.id : "anon");
const claveCache = (t) => "spidey:cache:" + (usuario ? usuario.id : "anon") + ":" + (t || tableroId);
const claveSubtareas = (t) => "spidey:subtareas:" + (usuario ? usuario.id : "anon") + ":" + (t || tableroId);
const claveSalida = () => "spidey:salida:" + (usuario ? usuario.id : "anon");
const claveVisto = () => "spidey:visto:" + (usuario ? usuario.id : "anon");
const claveSaludo = () => "spidey:saludo:" + (usuario ? usuario.id : "anon");

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
function borrarLocal(clave) {
  try {
    localStorage.removeItem(clave);
  } catch {
    /* ignorado */
  }
}

/* ==================== normalización ==================== */

const idValido = (v) => (RE_UUID.test(String(v || "")) ? String(v) : null);

export function normalizar(fila) {
  const id = String(fila.id || "");
  const titulo = String(fila.titulo || "").trim().slice(0, MAX_TITULO);
  const vence = String(fila.vence || "");
  return {
    // Un id que no sea un UUID no existe en el servidor (la columna es uuid),
    // así que sólo puede venir de una caché manipulada: se descarta.
    id: RE_UUID.test(id) ? id : crypto.randomUUID(),
    tablero_id: idValido(fila.tablero_id) || tableroId,
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
    creada_por: idValido(fila.creada_por),
  };
}

function normalizarSubtarea(fila) {
  const id = String(fila.id || "");
  return {
    id: RE_UUID.test(id) ? id : crypto.randomUUID(),
    tarea_id: idValido(fila.tarea_id) || "",
    texto: String(fila.texto || "").trim().slice(0, MAX_SUBTAREA) || "Sin texto",
    hecha: fila.hecha === true,
    posicion: Number.isFinite(fila.posicion) ? fila.posicion : 0,
    creada: fila.creada || new Date().toISOString(),
  };
}

function normalizarTablero(fila) {
  const id = String(fila.id || "");
  return {
    id: RE_UUID.test(id) ? id : "",
    nombre: String(fila.nombre || "").trim().slice(0, MAX_NOMBRE_TABLERO) || "Tablero",
    descripcion: String(fila.descripcion || "").slice(0, 300),
    color: RE_COLOR.test(String(fila.color || "")) ? fila.color : "#D30000",
    posicion: Number.isFinite(fila.posicion) ? fila.posicion : 0,
    propietario: idValido(fila.propietario),
    archivado: fila.archivado === true,
    creado: fila.creado || new Date().toISOString(),
    rol: ROLES_VALIDOS.includes(fila.rol) ? fila.rol : "lector",
  };
}

function paraServidor(t) {
  return {
    id: t.id,
    tablero_id: t.tablero_id || tableroId,
    titulo: t.titulo,
    notas: t.notas,
    estado: t.estado,
    prioridad: t.prioridad,
    responsable: t.responsable,
    etiquetas: t.etiquetas,
    vence: t.vence || null,
    posicion: t.posicion,
    creada: t.creada,
    creada_por: t.creada_por || (usuario ? usuario.id : null),
    completada: t.estado === "hecho" ? t.completada || new Date().toISOString() : null,
  };
}

/* ==================== suscripciones de la interfaz ==================== */

export const alActualizar = (fn) => { alCambiar = fn; };
export const alCambiarEstado = (fn) => { alEstado = fn; };
export const alCambiarListaTableros = (fn) => { alCambiarTableros = fn; };
export const alCambiarDetalleDe = (fn) => { alCambiarDetalle = fn; };

/* ==================== lecturas sincrónicas ==================== */

export const lista = () => tareas;
export const listaTableros = () => tableros;
export const listaMiembros = () => miembros;
export const listaInvitaciones = () => invitaciones;
export const detalleActual = () => detalle;
export const tableroActual = () => tableros.find((t) => t.id === tableroId) || null;
export const rolActual = () => (tableroActual() ? tableroActual().rol : "lector");
export const puedoEditar = () => ["propietario", "editor"].includes(rolActual());
export const soyPropietario = () => rolActual() === "propietario";
export const yo = () => usuario;

export const subtareasDe = (tareaId) =>
  subtareas.filter((s) => s.tarea_id === tareaId).sort((a, b) => a.posicion - b.posicion);

export function avanceSubtareas(tareaId) {
  const s = subtareas.filter((x) => x.tarea_id === tareaId);
  if (!s.length) return null;
  return { hechas: s.filter((x) => x.hecha).length, total: s.length };
}

export const cuantosComentarios = (tareaId) => conteos.comentarios[tareaId] || 0;
export const cuantosAdjuntos = (tareaId) => conteos.adjuntos[tareaId] || 0;

/* ---------------- actividad del tablero (la campanita) ---------------- */

/**
 * Lo que hicieron LOS DEMÁS en el tablero. Lo propio se excluye: nadie
 * necesita que le avisen de lo que acaba de hacer.
 */
export const listaActividad = () => actividad;

/** Cuántas de esas son posteriores a la última vez que abriste la campana. */
export const actividadSinVer = () =>
  actividad.filter((a) => !visto || a.creado > visto).length;

export const esNueva = (fila) => !visto || fila.creado > visto;

/**
 * Se llama al abrir la campana, no al pintarla: si se marcara al pintar,
 * el contador se borraría solo antes de que nadie lo hubiera mirado.
 */
export function marcarActividadVista() {
  visto = new Date().toISOString();
  escribirLocal(claveVisto(), visto);
}

async function cargarActividad() {
  if (!tableroId || !usuario || !navigator.onLine) return;
  const { data, error } = await supabase
    .from("historial")
    .select("id,tarea_id,actor,accion,detalle,creado")
    .eq("tablero_id", tableroId)
    .neq("actor", usuario.id)
    .order("creado", { ascending: false })
    .limit(25);
  if (error) return;
  actividad = data || [];
}

/* ---------------- mi perfil ---------------- */

export const miPerfilActual = () => miPerfil;

/** Nombre para saludar. Si no puso uno, se usa lo que va antes de la arroba. */
export function miNombre() {
  if (miPerfil && miPerfil.nombre) return miPerfil.nombre;
  if (usuario && usuario.email) return usuario.email.split("@")[0];
  return "";
}

export async function cargarMiPerfil() {
  if (!usuario || !navigator.onLine) return;
  const { data, error } = await supabase
    .from("perfiles")
    .select("id,nombre,email")
    .eq("id", usuario.id)
    .maybeSingle();
  if (!error && data) miPerfil = data;
}

export async function cambiarMiNombre(nombre) {
  const limpio = String(nombre || "").trim().slice(0, 80);
  if (!limpio) return { ok: false, mensaje: "El nombre no puede quedar vacío." };
  if (!navigator.onLine) return { ok: false, mensaje: "Cambiar el nombre necesita conexión." };

  const { error } = await supabase.from("perfiles").update({ nombre: limpio }).eq("id", usuario.id);
  if (error) return { ok: false, mensaje: mensajeError(error) };

  miPerfil = { ...(miPerfil || { id: usuario.id, email: usuario.email }), nombre: limpio };
  await cargarMiembros();
  alCambiar(tareas, { desdeCache: false });
  return { ok: true };
}

/* ---------------- saludo ---------------- */

/** ¿Toca saludar? Una vez al día por dispositivo, no en cada recarga. */
export function tocaSaludar() {
  const hoy = new Date().toISOString().slice(0, 10);
  return leerLocal(claveSaludo(), null) !== hoy;
}

export function saludoMostrado() {
  escribirLocal(claveSaludo(), new Date().toISOString().slice(0, 10));
}

/** Nombre legible de una persona, resuelto desde los miembros del tablero. */
export function nombreDe(userId) {
  if (usuario && userId === usuario.id) return "Tú";
  const m = miembros.find((x) => x.user_id === userId);
  if (!m) return "Alguien";
  return m.nombre || m.email || "Alguien";
}

/* ==================== ciclo de vida ==================== */

export async function iniciarSesionDeDatos(u) {
  usuario = u;
  visto = leerLocal(claveVisto(), null);

  // Primero lo que hay en el dispositivo: la app se ve completa antes de
  // que llegue la primera respuesta del servidor.
  tableros = leerLocal(claveTableros(), []).map(normalizarTablero).filter((t) => t.id);
  tableroId = leerLocal(claveActivo(), null);
  if (!tableros.some((t) => t.id === tableroId)) tableroId = tableros.length ? tableros[0].id : null;
  if (tableroId) {
    tareas = leerLocal(claveCache(), []).map(normalizar);
    subtareas = leerLocal(claveSubtareas(), []).map(normalizarSubtarea);
    alCambiarTableros(tableros, tableroId);
    alCambiar(tareas, { desdeCache: true });
  }

  await cargarMiPerfil();
  await cargarTableros();
  window.addEventListener("online", alVolverLaConexion);
  window.addEventListener("offline", () =>
    alEstado("offline", "Sin conexión — los cambios se guardan al volver")
  );
}

export function terminarSesionDeDatos() {
  desuscribir();
  window.removeEventListener("online", alVolverLaConexion);
  tableros = [];
  tareas = [];
  subtareas = [];
  miembros = [];
  invitaciones = [];
  conteos = { comentarios: {}, adjuntos: {} };
  detalle = { tareaId: null, comentarios: [], adjuntos: [], historial: [] };
  actividad = [];
  miPerfil = null;
  visto = null;
  tableroId = null;
  usuario = null;
}

function alVolverLaConexion() {
  vaciarSalida().then(sincronizar);
}

/* ==================== tableros ==================== */

/**
 * `elegir:false` refresca la lista y los roles sin volver a entrar al
 * tablero activo. Lo usa el aviso de cambio de miembros: si te cambian el
 * rol hay que repintar los permisos, pero no recargar todas las tareas ni
 * rehacer la suscripción de tiempo real desde dentro de su propio aviso.
 */
export async function cargarTableros(opciones = {}) {
  if (!usuario) return;
  if (!navigator.onLine) {
    alEstado("offline", "Sin conexión — mostrando la copia local");
    return;
  }

  // El rol vive en la tabla de membresías, así que se consulta desde ahí y
  // el tablero viene embebido. Una sola ida al servidor.
  const { data, error } = await supabase
    .from("tablero_miembros")
    .select("rol, tableros(id,nombre,descripcion,color,posicion,propietario,archivado,creado)")
    .eq("user_id", usuario.id);

  if (error) {
    alEstado("mal", mensajeError(error));
    return;
  }

  tableros = (data || [])
    .filter((f) => f.tableros)
    .map((f) => normalizarTablero({ ...f.tableros, rol: f.rol }))
    .filter((t) => t.id && !t.archivado)
    .sort((a, b) => a.posicion - b.posicion || (a.creado < b.creado ? -1 : 1));

  escribirLocal(claveTableros(), tableros);

  // Cuenta recién creada, o la última del usuario borrada: se le da uno.
  if (!tableros.length) {
    const r = await crearTablero("Mis tareas");
    if (!r.ok) alEstado("mal", r.mensaje);
    return;
  }

  // Si te expulsaron del tablero activo, hay que mudarse a otro sí o sí.
  const perdido = !tableros.some((t) => t.id === tableroId);
  if (perdido) tableroId = tableros[0].id;

  alCambiarTableros(tableros, tableroId);
  if (opciones.elegir !== false || perdido) await elegirTablero(tableroId, { forzar: true });
}

export async function elegirTablero(id, opciones = {}) {
  if (!id) return;
  if (id === tableroId && !opciones.forzar) return;
  if (!tableros.some((t) => t.id === id)) return;

  tableroId = id;
  escribirLocal(claveActivo(), id);

  // Pinta ya con la copia local del tablero elegido; el servidor confirma después.
  tareas = leerLocal(claveCache(id), []).map(normalizar);
  subtareas = leerLocal(claveSubtareas(id), []).map(normalizarSubtarea);
  detalle = { tareaId: null, comentarios: [], adjuntos: [], historial: [] };
  actividad = [];
  alCambiarTableros(tableros, tableroId);
  alCambiar(tareas, { desdeCache: true });

  desuscribir();
  await sincronizar();
  await cargarMiembros();
  suscribir();
}

export async function crearTablero(nombre, color) {
  if (!usuario) return { ok: false, mensaje: "No hay sesión." };
  const limpio = String(nombre || "").trim().slice(0, MAX_NOMBRE_TABLERO);
  if (!limpio) return { ok: false, mensaje: "Escribe un nombre para el tablero." };
  if (!navigator.onLine)
    return { ok: false, mensaje: "Crear un tablero necesita conexión." };

  const { data, error } = await supabase
    .from("tableros")
    .insert({
      propietario: usuario.id,
      nombre: limpio,
      color: RE_COLOR.test(String(color || "")) ? color : "#D30000",
      posicion: tableros.length ? Math.max(...tableros.map((t) => t.posicion)) + 1 : 0,
    })
    .select("id,nombre,descripcion,color,posicion,propietario,archivado,creado")
    .single();

  if (error) return { ok: false, mensaje: mensajeError(error) };

  const nuevo = normalizarTablero({ ...data, rol: "propietario" });
  tableros.push(nuevo);
  escribirLocal(claveTableros(), tableros);
  alCambiarTableros(tableros, tableroId);
  await elegirTablero(nuevo.id, { forzar: true });
  return { ok: true, id: nuevo.id };
}

export async function renombrarTablero(id, nombre, color) {
  const limpio = String(nombre || "").trim().slice(0, MAX_NOMBRE_TABLERO);
  if (!limpio) return { ok: false, mensaje: "El nombre no puede quedar vacío." };

  const cambios = { nombre: limpio };
  if (RE_COLOR.test(String(color || ""))) cambios.color = color;

  const { error } = await supabase.from("tableros").update(cambios).eq("id", id);
  if (error) return { ok: false, mensaje: mensajeError(error) };

  const i = tableros.findIndex((t) => t.id === id);
  if (i >= 0) tableros[i] = { ...tableros[i], ...cambios };
  escribirLocal(claveTableros(), tableros);
  alCambiarTableros(tableros, tableroId);
  return { ok: true };
}

export async function eliminarTablero(id) {
  const { error } = await supabase.from("tableros").delete().eq("id", id);
  if (error) return { ok: false, mensaje: mensajeError(error) };
  await olvidarTablero(id);
  return { ok: true };
}

/** Salirse de un tablero ajeno: se borra la propia membresía, nada más. */
export async function salirDelTablero(id) {
  if (!usuario) return { ok: false, mensaje: "No hay sesión." };
  const { error } = await supabase
    .from("tablero_miembros")
    .delete()
    .eq("tablero_id", id)
    .eq("user_id", usuario.id);
  if (error) return { ok: false, mensaje: mensajeError(error) };
  await olvidarTablero(id);
  return { ok: true };
}

async function olvidarTablero(id) {
  borrarLocal(claveCache(id));
  borrarLocal(claveSubtareas(id));
  tableros = tableros.filter((t) => t.id !== id);
  escribirLocal(claveTableros(), tableros);
  if (tableroId === id) {
    desuscribir();
    tableroId = tableros.length ? tableros[0].id : null;
  }
  if (tableroId) await elegirTablero(tableroId, { forzar: true });
  else await cargarTableros();
}

/* ==================== miembros e invitaciones ==================== */

export async function cargarMiembros() {
  if (!tableroId || !navigator.onLine) return;

  const { data, error } = await supabase
    .from("tablero_miembros")
    .select("user_id, rol, creado, perfiles:user_id(nombre,email)")
    .eq("tablero_id", tableroId);

  if (error) {
    // No es fatal: el tablero se puede usar sin la lista de miembros.
    miembros = [];
    return;
  }

  miembros = (data || []).map((m) => ({
    user_id: m.user_id,
    rol: ROLES_VALIDOS.includes(m.rol) ? m.rol : "lector",
    creado: m.creado,
    nombre: (m.perfiles && m.perfiles.nombre) || "",
    email: (m.perfiles && m.perfiles.email) || "",
  }));

  const { data: inv } = await supabase
    .from("invitaciones")
    .select("id,email,rol,creada")
    .eq("tablero_id", tableroId);
  invitaciones = inv || [];
}

export async function invitar(email, rol) {
  if (!tableroId) return { ok: false, mensaje: "No hay tablero activo." };
  const { data, error } = await supabase.rpc("invitar_a_tablero", {
    p_tablero: tableroId,
    p_email: String(email || "").trim(),
    p_rol: rol === "lector" ? "lector" : "editor",
  });
  if (error) return { ok: false, mensaje: mensajeError(error) };
  await cargarMiembros();
  return { ok: true, resultado: data };
}

export async function cambiarRol(userId, rol) {
  if (!ROLES_VALIDOS.includes(rol)) return { ok: false, mensaje: "Ese rol no existe." };
  const { error } = await supabase
    .from("tablero_miembros")
    .update({ rol })
    .eq("tablero_id", tableroId)
    .eq("user_id", userId);
  if (error) return { ok: false, mensaje: mensajeError(error) };
  await cargarMiembros();
  return { ok: true };
}

export async function quitarMiembro(userId) {
  const { error } = await supabase
    .from("tablero_miembros")
    .delete()
    .eq("tablero_id", tableroId)
    .eq("user_id", userId);
  if (error) return { ok: false, mensaje: mensajeError(error) };
  await cargarMiembros();
  return { ok: true };
}

export async function cancelarInvitacion(id) {
  const { error } = await supabase.from("invitaciones").delete().eq("id", id);
  if (error) return { ok: false, mensaje: mensajeError(error) };
  await cargarMiembros();
  return { ok: true };
}

/* ==================== sincronización ==================== */

export async function sincronizar() {
  if (!usuario || !tableroId) return;
  if (!navigator.onLine) {
    alEstado("offline", "Sin conexión — mostrando la copia local");
    return;
  }

  const { data, error } = await supabase
    .from("tareas")
    .select(CAMPOS_TAREA)
    .eq("tablero_id", tableroId)
    .order("posicion", { ascending: true });

  if (error) {
    alEstado("mal", mensajeError(error));
    return;
  }

  tareas = (data || []).map(normalizar);
  escribirLocal(claveCache(), tareas);

  await cargarSubtareas();
  await cargarConteos();
  await cargarActividad();

  const pendientes = leerLocal(claveSalida(), []).length;
  alEstado(
    pendientes ? "offline" : "on",
    pendientes ? pendientes + " cambio(s) por enviar" : "Guardado en la nube"
  );
  alCambiar(tareas, { desdeCache: false });
}

/**
 * Las subtareas se traen todas de una vez, no tarea por tarea: son filas
 * diminutas y así la barra de avance aparece en cada tarjeta del tablero
 * sin una consulta por tarjeta.
 */
async function cargarSubtareas() {
  const ids = tareas.map((t) => t.id);
  if (!ids.length) {
    subtareas = [];
    escribirLocal(claveSubtareas(), subtareas);
    return;
  }
  const { data, error } = await supabase
    .from("subtareas")
    .select("id,tarea_id,texto,hecha,posicion,creada")
    .in("tarea_id", ids);
  if (error) return;
  subtareas = (data || []).map(normalizarSubtarea);
  escribirLocal(claveSubtareas(), subtareas);
}

/**
 * Para las insignias de las tarjetas sólo hace falta saber cuántos
 * comentarios y adjuntos hay, no su contenido. Se piden las columnas
 * mínimas; el texto completo se carga al abrir la tarea.
 */
async function cargarConteos() {
  const ids = tareas.map((t) => t.id);
  conteos = { comentarios: {}, adjuntos: {} };
  if (!ids.length) return;

  const [c, a] = await Promise.all([
    supabase.from("comentarios").select("tarea_id").in("tarea_id", ids),
    supabase.from("adjuntos").select("tarea_id").in("tarea_id", ids),
  ]);

  for (const fila of c.data || [])
    conteos.comentarios[fila.tarea_id] = (conteos.comentarios[fila.tarea_id] || 0) + 1;
  for (const fila of a.data || [])
    conteos.adjuntos[fila.tarea_id] = (conteos.adjuntos[fila.tarea_id] || 0) + 1;
}

/* ==================== tiempo real ==================== */

function desuscribir() {
  if (canal) {
    supabase.removeChannel(canal);
    canal = null;
  }
}

function suscribir() {
  if (!usuario || !tableroId || canal) return;

  const mias = (id) => tareas.some((t) => t.id === id);

  canal = supabase
    .channel("tablero-" + tableroId)
    // --- tareas: el servidor ya filtra por tablero ---
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tareas", filter: "tablero_id=eq." + tableroId },
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
    // --- subtareas: no tienen tablero_id, así que se filtran aquí ---
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "subtareas" },
      (evento) => {
        const id = String((evento.new || evento.old).tarea_id || "");
        if (!mias(id)) return;
        if (evento.eventType === "DELETE") {
          subtareas = subtareas.filter((s) => s.id !== String(evento.old.id));
        } else {
          const fila = normalizarSubtarea(evento.new);
          const i = subtareas.findIndex((s) => s.id === fila.id);
          if (i >= 0) subtareas[i] = fila;
          else subtareas.push(fila);
        }
        escribirLocal(claveSubtareas(), subtareas);
        alCambiar(tareas, { desdeCache: false });
      }
    )
    // --- comentarios y adjuntos: refrescan conteo y, si está abierta, el detalle ---
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "comentarios" },
      (evento) => refrescarHijo(evento, "comentarios")
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "adjuntos" },
      (evento) => refrescarHijo(evento, "adjuntos")
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "historial", filter: "tablero_id=eq." + tableroId },
      (evento) => {
        if (detalle.tareaId && String(evento.new.tarea_id) === detalle.tareaId) {
          detalle.historial = [evento.new, ...detalle.historial].slice(0, 60);
          alCambiarDetalle(detalle);
        }
        // A la campana solo va lo ajeno, y sin duplicar si el aviso llega dos veces.
        if (evento.new.actor && evento.new.actor !== usuario.id &&
            !actividad.some((a) => a.id === evento.new.id)) {
          actividad = [evento.new, ...actividad].slice(0, 25);
          alCambiar(tareas, { desdeCache: false });
        }
      }
    )
    // --- membresías: si te expulsan o te cambian el rol, se nota al momento ---
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tablero_miembros", filter: "tablero_id=eq." + tableroId },
      () => {
        cargarMiembros().then(() => cargarTableros({ elegir: false }));
      }
    )
    .subscribe();
}

function refrescarHijo(evento, tabla) {
  const id = String((evento.new || evento.old).tarea_id || "");
  if (!tareas.some((t) => t.id === id)) return;

  const delta = evento.eventType === "DELETE" ? -1 : evento.eventType === "INSERT" ? 1 : 0;
  if (delta) conteos[tabla][id] = Math.max(0, (conteos[tabla][id] || 0) + delta);

  if (detalle.tareaId === id) cargarDetalle(id);
  else alCambiar(tareas, { desdeCache: false });
}

/* ==================== cola de cambios sin conexión ==================== */

function encolar(operacion) {
  const salida = leerLocal(claveSalida(), []);
  // Una sola entrada por objeto: la última versión gana.
  const filtrada = salida.filter((o) => !(o.id === operacion.id && o.tipo === operacion.tipo));
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
    let error = null;
    if (op.tipo === "borrar") {
      ({ error } = await supabase.from("tareas").delete().eq("id", op.id));
    } else if (op.tipo === "guardar") {
      ({ error } = await supabase.from("tareas").upsert(op.datos, { onConflict: "id" }));
    } else if (op.tipo === "subtarea") {
      ({ error } = await supabase.from("subtareas").upsert(op.datos, { onConflict: "id" }));
    } else if (op.tipo === "borrar-subtarea") {
      ({ error } = await supabase.from("subtareas").delete().eq("id", op.id));
    }
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

/* ==================== escrituras: tareas ==================== */

export async function guardar(tarea) {
  if (!puedoEditar())
    return { ok: false, mensaje: "Solo puedes mirar este tablero." };

  const t = normalizar({ ...tarea, tablero_id: tarea.tablero_id || tableroId });
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
  if (!puedoEditar())
    return { ok: false, mensaje: "Solo puedes mirar este tablero." };

  tareas = tareas.filter((t) => t.id !== id);
  subtareas = subtareas.filter((s) => s.tarea_id !== id);
  escribirLocal(claveCache(), tareas);
  escribirLocal(claveSubtareas(), subtareas);
  alCambiar(tareas, { desdeCache: false });

  if (!navigator.onLine) {
    encolar({ tipo: "borrar", id });
    return { ok: true, encolado: true };
  }
  const { error } = await supabase.from("tareas").delete().eq("id", id);
  if (error) {
    encolar({ tipo: "borrar", id });
    return { ok: false, mensaje: mensajeError(error) };
  }
  alEstado("on", "Guardado en la nube");
  return { ok: true };
}

/** Mueve una tarea a otro tablero. Se lleva consigo subtareas, comentarios y adjuntos. */
export async function moverATablero(id, destino) {
  if (!puedoEditar()) return { ok: false, mensaje: "Solo puedes mirar este tablero." };
  const destinoOk = tableros.find((t) => t.id === destino);
  if (!destinoOk) return { ok: false, mensaje: "Ese tablero no existe." };
  if (!["propietario", "editor"].includes(destinoOk.rol))
    return { ok: false, mensaje: "Solo puedes mirar el tablero de destino." };
  if (!navigator.onLine) return { ok: false, mensaje: "Mover de tablero necesita conexión." };

  const { error } = await supabase
    .from("tareas")
    .update({ tablero_id: destino, posicion: Date.now() })
    .eq("id", id);
  if (error) return { ok: false, mensaje: mensajeError(error) };

  tareas = tareas.filter((t) => t.id !== id);
  escribirLocal(claveCache(), tareas);
  alCambiar(tareas, { desdeCache: false });
  return { ok: true, nombre: destinoOk.nombre };
}

/* ==================== escrituras: subtareas ==================== */

export async function agregarSubtarea(tareaId, texto) {
  if (!puedoEditar()) return { ok: false, mensaje: "Solo puedes mirar este tablero." };
  const limpio = String(texto || "").trim().slice(0, MAX_SUBTAREA);
  if (!limpio) return { ok: false, mensaje: "Escribe algo primero." };

  const hermanas = subtareasDe(tareaId);
  const fila = normalizarSubtarea({
    id: crypto.randomUUID(),
    tarea_id: tareaId,
    texto: limpio,
    hecha: false,
    posicion: hermanas.length ? hermanas[hermanas.length - 1].posicion + 1 : 0,
  });

  subtareas.push(fila);
  escribirLocal(claveSubtareas(), subtareas);
  alCambiar(tareas, { desdeCache: false });

  return await enviarSubtarea(fila);
}

export async function alternarSubtarea(id) {
  if (!puedoEditar()) return { ok: false, mensaje: "Solo puedes mirar este tablero." };
  const i = subtareas.findIndex((s) => s.id === id);
  if (i < 0) return { ok: false, mensaje: "Esa subtarea ya no existe." };

  subtareas[i] = { ...subtareas[i], hecha: !subtareas[i].hecha };
  escribirLocal(claveSubtareas(), subtareas);
  alCambiar(tareas, { desdeCache: false });

  return await enviarSubtarea(subtareas[i]);
}

export async function eliminarSubtarea(id) {
  if (!puedoEditar()) return { ok: false, mensaje: "Solo puedes mirar este tablero." };
  subtareas = subtareas.filter((s) => s.id !== id);
  escribirLocal(claveSubtareas(), subtareas);
  alCambiar(tareas, { desdeCache: false });

  if (!navigator.onLine) {
    encolar({ tipo: "borrar-subtarea", id });
    return { ok: true, encolado: true };
  }
  const { error } = await supabase.from("subtareas").delete().eq("id", id);
  if (error) {
    encolar({ tipo: "borrar-subtarea", id });
    return { ok: false, mensaje: mensajeError(error) };
  }
  return { ok: true };
}

async function enviarSubtarea(fila) {
  const datos = {
    id: fila.id,
    tarea_id: fila.tarea_id,
    texto: fila.texto,
    hecha: fila.hecha,
    posicion: fila.posicion,
    creada: fila.creada,
  };
  if (!navigator.onLine) {
    encolar({ tipo: "subtarea", id: fila.id, datos });
    return { ok: true, encolado: true };
  }
  const { error } = await supabase.from("subtareas").upsert(datos, { onConflict: "id" });
  if (error) {
    encolar({ tipo: "subtarea", id: fila.id, datos });
    return { ok: false, mensaje: mensajeError(error) };
  }
  return { ok: true };
}

/* ==================== detalle: comentarios, adjuntos, historial ==================== */

export async function cargarDetalle(tareaId) {
  detalle = { tareaId, comentarios: [], adjuntos: [], historial: [], cargando: true };
  alCambiarDetalle(detalle);

  if (!navigator.onLine) {
    detalle = { ...detalle, cargando: false, sinConexion: true };
    alCambiarDetalle(detalle);
    return;
  }

  const [c, a, h] = await Promise.all([
    supabase
      .from("comentarios")
      .select("id,tarea_id,autor,texto,creado,editado")
      .eq("tarea_id", tareaId)
      .order("creado", { ascending: true }),
    supabase
      .from("adjuntos")
      .select("id,tarea_id,nombre,ruta,tipo,tamano,subido_por,creado")
      .eq("tarea_id", tareaId)
      .order("creado", { ascending: false }),
    supabase
      .from("historial")
      .select("id,tarea_id,actor,accion,detalle,creado")
      .eq("tarea_id", tareaId)
      .order("creado", { ascending: false })
      .limit(60),
  ]);

  // La tarea pudo cerrarse mientras se esperaba: no pisar el detalle nuevo.
  if (detalle.tareaId !== tareaId) return;

  detalle = {
    tareaId,
    comentarios: c.data || [],
    adjuntos: a.data || [],
    historial: h.data || [],
    cargando: false,
  };
  conteos.comentarios[tareaId] = detalle.comentarios.length;
  conteos.adjuntos[tareaId] = detalle.adjuntos.length;
  alCambiarDetalle(detalle);
  alCambiar(tareas, { desdeCache: false });
}

export function cerrarDetalle() {
  detalle = { tareaId: null, comentarios: [], adjuntos: [], historial: [] };
}

export async function comentar(tareaId, texto) {
  if (!usuario) return { ok: false, mensaje: "No hay sesión." };
  const limpio = String(texto || "").trim().slice(0, MAX_COMENTARIO);
  if (!limpio) return { ok: false, mensaje: "Escribe un comentario." };
  if (!navigator.onLine) return { ok: false, mensaje: "Comentar necesita conexión." };

  const { error } = await supabase
    .from("comentarios")
    .insert({ tarea_id: tareaId, autor: usuario.id, texto: limpio });
  if (error) return { ok: false, mensaje: mensajeError(error) };

  await cargarDetalle(tareaId);
  return { ok: true };
}

export async function eliminarComentario(id, tareaId) {
  const { error } = await supabase.from("comentarios").delete().eq("id", id);
  if (error) return { ok: false, mensaje: mensajeError(error) };
  await cargarDetalle(tareaId);
  return { ok: true };
}

/* ---------------- adjuntos ---------------- */

/** Deja el nombre en algo que Storage acepte como ruta, sin perder legibilidad. */
function nombreSeguro(nombre) {
  return String(nombre || "archivo")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "archivo";
}

export async function subirAdjunto(tareaId, archivo) {
  if (!puedoEditar()) return { ok: false, mensaje: "Solo puedes mirar este tablero." };
  if (!archivo) return { ok: false, mensaje: "No se eligió ningún archivo." };
  if (archivo.size > MAX_ADJUNTO)
    return { ok: false, mensaje: "El archivo pesa más de 25 MB." };
  if (!navigator.onLine) return { ok: false, mensaje: "Adjuntar necesita conexión." };

  // El primer segmento de la ruta es el tablero: las políticas de Storage
  // lo leen para decidir quién puede abrir o borrar el archivo.
  const ruta = `${tableroId}/${tareaId}/${crypto.randomUUID()}-${nombreSeguro(archivo.name)}`;

  const { error: errSubida } = await supabase.storage
    .from("adjuntos")
    .upload(ruta, archivo, { cacheControl: "3600", upsert: false, contentType: archivo.type || undefined });
  if (errSubida) return { ok: false, mensaje: mensajeError(errSubida) };

  const { error } = await supabase.from("adjuntos").insert({
    tarea_id: tareaId,
    nombre: String(archivo.name || "archivo").slice(0, 200),
    ruta,
    tipo: archivo.type || "",
    tamano: archivo.size || 0,
    subido_por: usuario.id,
  });

  if (error) {
    // La fila no entró: el archivo quedaría suelto en el bucket, ocupando
    // espacio sin que nadie pueda verlo. Se retira.
    await supabase.storage.from("adjuntos").remove([ruta]);
    return { ok: false, mensaje: mensajeError(error) };
  }

  await cargarDetalle(tareaId);
  return { ok: true };
}

/**
 * El bucket es privado, así que no hay URL fija: se pide una firmada que
 * caduca en un minuto, el tiempo de abrir o descargar el archivo.
 */
export async function urlAdjunto(ruta) {
  const { data, error } = await supabase.storage.from("adjuntos").createSignedUrl(ruta, 60);
  if (error) return { ok: false, mensaje: mensajeError(error) };
  return { ok: true, url: data.signedUrl };
}

export async function eliminarAdjunto(id, ruta, tareaId) {
  if (!puedoEditar()) return { ok: false, mensaje: "Solo puedes mirar este tablero." };

  const { error } = await supabase.from("adjuntos").delete().eq("id", id);
  if (error) return { ok: false, mensaje: mensajeError(error) };

  // Si esto falla el archivo queda huérfano en el bucket, pero ya no es
  // alcanzable desde la app: mejor eso que dejar la fila apuntando a nada.
  await supabase.storage.from("adjuntos").remove([ruta]);

  await cargarDetalle(tareaId);
  return { ok: true };
}

/* ---------------- historial del tablero ---------------- */

export async function historialDelTablero(limite = 80) {
  if (!tableroId || !navigator.onLine) return [];
  const { data, error } = await supabase
    .from("historial")
    .select("id,tarea_id,actor,accion,detalle,creado")
    .eq("tablero_id", tableroId)
    .order("creado", { ascending: false })
    .limit(limite);
  if (error) return [];
  return data || [];
}
