/**
 * Paneles de la ficha de tarea y del tablero.
 *
 * Igual que views.js: funciones puras. Reciben datos y devuelven marcado;
 * no hablan con el servidor ni guardan estado. Viven en su propio archivo
 * porque la ficha de tarea creció hasta tener vida propia —subtareas,
 * comentarios, adjuntos e historial— y mezclarla con el tablero habría
 * dejado un views.js imposible de leer.
 */

import { esc, ETIQ_ESTADO, ETIQ_PRIO, fechaCorta } from "./views.js";

const ETIQ_ROL = {
  propietario: "Propietario",
  editor: "Editor",
  lector: "Solo lectura",
};

/* ===================== utilidades ===================== */

/** "hace 3 min", "ayer", "12 mar". Lo cercano en relativo, lo lejano en fecha. */
export function tiempoRelativo(iso) {
  if (!iso) return "";
  const cuando = new Date(iso);
  if (Number.isNaN(cuando.getTime())) return "";

  const seg = Math.round((Date.now() - cuando.getTime()) / 1000);
  if (seg < 45) return "hace un momento";
  if (seg < 3600) return "hace " + Math.round(seg / 60) + " min";
  if (seg < 86400) {
    const h = Math.round(seg / 3600);
    return "hace " + h + (h === 1 ? " hora" : " horas");
  }
  if (seg < 172800) return "ayer";
  if (seg < 604800) return "hace " + Math.round(seg / 86400) + " días";

  const iso10 = cuando.getFullYear() + "-" +
    String(cuando.getMonth() + 1).padStart(2, "0") + "-" +
    String(cuando.getDate()).padStart(2, "0");
  const esteAnio = cuando.getFullYear() === new Date().getFullYear();
  return esteAnio ? fechaCorta(iso10) : fechaCorta(iso10) + " " + cuando.getFullYear();
}

/** Bytes en algo que una persona pueda leer de un vistazo. */
export function pesoLegible(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * Un ícono por familia de archivo, en SVG inline.
 *
 * Antes eran emoji. Se cambiaron porque cada sistema operativo los dibuja
 * a su manera —y a todo color— y rompían la línea del resto de la interfaz,
 * que es de trazo fino y hereda el color del texto.
 */
const TRAZO = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';

const ICONOS = {
  imagen: `<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 4.5-4.5 3.5 3.5 3-3L20 17"/>`,
  pdf: `<path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5l-5-5Z"/><path d="M14 2.5v5h5"/><path d="M9 13h6M9 16.5h4"/>`,
  video: `<rect x="2.5" y="5.5" width="14" height="13" rx="2.5"/><path d="m16.5 10 5-3v10l-5-3"/>`,
  audio: `<path d="M9 17.5V5l10-2v12.5"/><circle cx="6.5" cy="17.5" r="2.8"/><circle cx="16.5" cy="15.5" r="2.8"/>`,
  hoja: `<rect x="3" y="3.5" width="18" height="17" rx="2.5"/><path d="M3 9h18M9 9v11.5M15 9v11.5"/>`,
  texto: `<path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5l-5-5Z"/><path d="M14 2.5v5h5M8.5 12.5h7M8.5 16h5"/>`,
  comprimido: `<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M11 3v2m2 1v2m-2 1v2m2 1v2m-2 1v3.5h2V15"/>`,
  generico: `<path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5l-5-5Z"/><path d="M14 2.5v5h5"/>`,
};

function iconoArchivo(tipo, nombre) {
  const t = String(tipo || "").toLowerCase();
  const ext = String(nombre || "").split(".").pop().toLowerCase();

  let clave = "generico";
  if (t.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(ext)) clave = "imagen";
  else if (t === "application/pdf" || ext === "pdf") clave = "pdf";
  else if (t.startsWith("video/")) clave = "video";
  else if (t.startsWith("audio/")) clave = "audio";
  else if (["xlsx", "xls", "csv", "ods"].includes(ext)) clave = "hoja";
  else if (["docx", "doc", "odt", "txt", "md", "rtf"].includes(ext)) clave = "texto";
  else if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) clave = "comprimido";

  return `<svg width="18" height="18" viewBox="0 0 24 24" ${TRAZO} aria-hidden="true">${ICONOS[clave]}</svg>`;
}

function avatarDe(nombre, color) {
  const n = String(nombre || "?").trim();
  const partes = n.split(/\s+/);
  const ini = ((partes[0][0] || "?") + (partes[1] ? partes[1][0] : "")).toUpperCase();
  return `<span class="avatar" style="background:${color || colorDe(n)}">${esc(ini)}</span>`;
}

function colorDe(n) {
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
  return `hsl(${h} 42% 42%)`;
}

/* ===================== selector de tableros ===================== */

/**
 * Panel de tableros.
 *
 * Se agrupan en tres: los que fijaste, los que compartes con alguien y los
 * que son solo tuyos. Con dos tableros la agrupación sobra, así que solo
 * aparece cuando hay suficientes para que valga la pena.
 *
 * `opciones`: { busqueda, fijados:Set, resumenDe(id) }
 */
export function selectorTableros(tableros, activoId, opciones = {}) {
  if (!tableros.length) return "";

  const fijados = opciones.fijados || new Set();
  const resumenDe = opciones.resumenDe || (() => ({ tareas: 0, miembros: 0 }));
  const q = (opciones.busqueda || "").toLowerCase().trim();

  const visibles = q
    ? tableros.filter((t) => t.nombre.toLowerCase().includes(q))
    : tableros;

  const item = (t) => {
    const activo = t.id === activoId;
    const r = resumenDe(t.id);
    const meta = [];
    if (r.tareas) meta.push(r.tareas + (r.tareas === 1 ? " tarea" : " tareas"));
    if (r.miembros > 1) meta.push(r.miembros + " miembros");
    if (t.rol !== "propietario") meta.push(ETIQ_ROL[t.rol]);

    return `<div class="tb-fila${activo ? " activo" : ""}">
      <button type="button" class="tb-item" data-tablero="${t.id}" ${activo ? 'aria-current="true"' : ""}>
        <span class="tb-color" style="background:${esc(t.color)}"></span>
        <span class="tb-txt">
          <span class="tb-nombre">${esc(t.nombre)}</span>
          ${meta.length ? `<span class="tb-meta">${esc(meta.join(" · "))}</span>` : ""}
        </span>
      </button>
      <button type="button" class="tb-fijar${fijados.has(t.id) ? " puesto" : ""}" data-fijar="${t.id}"
              aria-pressed="${String(fijados.has(t.id))}"
              aria-label="${fijados.has(t.id) ? "Quitar de fijados" : "Fijar"} ${esc(t.nombre)}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="${fijados.has(t.id) ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3.5l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.9l6.1-.8L12 3.5Z"/>
        </svg>
      </button>
    </div>`;
  };

  let cuerpo;
  if (!visibles.length) {
    cuerpo = `<p class="tb-vacio">Ningún tablero se llama así.</p>`;
  } else if (visibles.length < 4 && !fijados.size) {
    // Pocos tableros: agruparlos sería más ruido que ayuda.
    cuerpo = `<div class="tb-lista">${visibles.map(item).join("")}</div>`;
  } else {
    const grupos = [
      { et: "Fijados", lista: visibles.filter((t) => fijados.has(t.id)) },
      { et: "Equipos", lista: visibles.filter((t) => !fijados.has(t.id) && resumenDe(t.id).miembros > 1) },
      { et: "Personal", lista: visibles.filter((t) => !fijados.has(t.id) && resumenDe(t.id).miembros <= 1) },
    ];
    cuerpo = grupos
      .filter((g) => g.lista.length)
      .map((g) => `<div class="tb-grupo">${g.et}</div><div class="tb-lista">${g.lista.map(item).join("")}</div>`)
      .join("");
  }

  return `${
    tableros.length > 4
      ? `<div class="tb-buscar">
           <input class="campo" id="tb-busqueda" type="search" placeholder="Buscar tablero…"
                  aria-label="Buscar entre tus tableros" value="${esc(opciones.busqueda || "")}">
         </div>`
      : ""
  }
    ${cuerpo}
    <div class="tb-pie">
      <button type="button" class="tb-nuevo" data-accion="nuevo-tablero">+ Nuevo tablero</button>
    </div>`;
}

/**
 * Nombre del tablero activo más su contexto: en qué papel estás y con
 * cuánta gente lo compartes. Antes solo iba el nombre, y con varios
 * tableros abiertos no había forma de saber en cuál puedes escribir.
 */
export function chapaTablero(tablero, miembros = 0) {
  if (!tablero) return `<span class="tb-actual-nombre">Sin tablero</span>`;

  const meta = [ETIQ_ROL[tablero.rol]];
  if (miembros > 1) meta.push(miembros + " miembros");

  return `<span class="tb-color" style="background:${esc(tablero.color)}"></span>
    <span class="tb-actual-txt">
      <b class="tb-actual-nombre">${esc(tablero.nombre)}</b>
      <small class="tb-actual-meta">${meta.join(" · ")}</small>
    </span>`;
}

/* ===================== miembros ===================== */

/**
 * `opciones`: { tareasDe(userId) } para decir cuánto tiene asignado cada
 * persona. Sin eso, la lista dice quién entra pero no quién trabaja.
 */
export function panelMiembros(tablero, miembros, invitaciones, yoId, opciones = {}) {
  if (!tablero) return "";
  const propietario = tablero.rol === "propietario";
  const tareasDe = opciones.tareasDe || (() => 0);

  const filas = [...miembros]
    .sort((a, b) => {
      const peso = { propietario: 0, editor: 1, lector: 2 };
      return peso[a.rol] - peso[b.rol] || (a.nombre || a.email).localeCompare(b.nombre || b.email);
    })
    .map((m) => {
      const soyYo = m.user_id === yoId;
      const nombre = m.nombre || m.email || "Sin nombre";
      const n = tareasDe(nombre);
      const meta = [m.email];
      if (n) meta.push(n === 1 ? "1 tarea asignada" : n + " tareas asignadas");

      return `<li class="miembro">
        ${avatarDe(nombre)}
        <span class="miembro-datos">
          <b>${esc(nombre)}${soyYo ? ' <span class="chip tu">Tú</span>' : ""}</b>
          <small class="miembro-meta">${esc(meta.join(" · "))}</small>
        </span>
        ${
          propietario && !soyYo && m.rol !== "propietario"
            ? `<select class="campo campo-mini" data-rol-de="${m.user_id}" aria-label="Rol de ${esc(nombre)}">
                 <option value="editor"${m.rol === "editor" ? " selected" : ""}>Editor</option>
                 <option value="lector"${m.rol === "lector" ? " selected" : ""}>Solo lectura</option>
               </select>
               <button type="button" class="icono-quitar" data-quitar-miembro="${m.user_id}" aria-label="Quitar a ${esc(nombre)}">×</button>`
            : `<span class="chip rol ${m.rol}">${ETIQ_ROL[m.rol]}</span>`
        }
      </li>`;
    })
    .join("");

  const pendientes = invitaciones.length
    ? `<h4 class="mini-titulo">Invitaciones sin aceptar</h4>
       <ul class="miembros">${invitaciones
         .map(
           (i) => `<li class="miembro pendiente">
             <span class="avatar avatar-vacio">?</span>
             <span class="miembro-datos">
               <b>${esc(i.email)}</b>
               <small class="miembro-meta">Esperando que se registre · ${ETIQ_ROL[i.rol]}</small>
             </span>
             ${propietario ? `<button type="button" class="icono-quitar" data-cancelar-invitacion="${i.id}" aria-label="Cancelar la invitación de ${esc(i.email)}">×</button>` : ""}
           </li>`
         )
         .join("")}</ul>`
    : "";

  const cuenta = [
    miembros.length + (miembros.length === 1 ? " activa" : " activas"),
    invitaciones.length ? invitaciones.length + " pendiente" + (invitaciones.length === 1 ? "" : "s") : "",
  ].filter(Boolean).join(" · ");

  return `<h3 class="miembros-titulo">Personas con acceso</h3>
    <p class="miembros-sub">${esc(cuenta)} en «${esc(tablero.nombre)}»</p>

    <ul class="miembros">${filas}</ul>
    ${pendientes}

    ${
      propietario
        ? `<div class="invitar-card">
             <h4 class="mini-titulo">Invitar por correo</h4>
             <form class="invitar" id="form-invitar">
               <input class="campo" name="email" placeholder="correo@ejemplo.com, otro@ejemplo.com"
                      required aria-label="Correos de quienes invitas">
               <select class="campo" name="rol" aria-label="Rol con el que entran">
                 <option value="editor">Editor</option>
                 <option value="lector">Solo lectura</option>
               </select>
               <button type="submit" class="btn btn-p">Invitar</button>
             </form>
             <p class="ayuda">Puedes escribir varios correos separados por comas. Si alguien aún no tiene cuenta, la invitación queda guardada y se aplica sola cuando se registre.</p>
           </div>`
        : `<p class="ayuda">Solo el propietario del tablero puede invitar o quitar personas.</p>`
    }

    <div class="roles-resumen">
      <div><b>Propietario</b>Renombra, invita, cambia permisos y elimina el tablero.</div>
      <div><b>Editor</b>Crea y modifica tareas, subtareas, comentarios y adjuntos.</div>
      <div><b>Solo lectura</b>Ve el tablero y comenta. No toca las tareas.</div>
    </div>`;
}

/* ===================== subtareas ===================== */

export function panelSubtareas(subtareas, puedeEditar) {
  const hechas = subtareas.filter((s) => s.hecha).length;
  const pct = subtareas.length ? Math.round((hechas / subtareas.length) * 100) : 0;

  const cabecera = subtareas.length
    ? `<div class="avance grande${hechas === subtareas.length ? " completo" : ""}">
         <span class="avance-pista"><span class="avance-relleno" style="width:${pct}%"></span></span>
         <span class="avance-texto">${hechas}/${subtareas.length}</span>
       </div>`
    : "";

  const filas = subtareas.length
    ? `<ul class="subtareas">${subtareas
        .map(
          (s) => `<li class="subtarea${s.hecha ? " hecha" : ""}">
            <label>
              <input type="checkbox" data-subtarea="${s.id}" ${s.hecha ? "checked" : ""} ${
            puedeEditar ? "" : "disabled"
          }>
              <span>${esc(s.texto)}</span>
            </label>
            ${
              puedeEditar
                ? `<button type="button" class="icono-quitar" data-borrar-subtarea="${s.id}" aria-label="Eliminar subtarea">×</button>`
                : ""
            }
          </li>`
        )
        .join("")}</ul>`
    : `<p class="panel-vacio">Sin subtareas todavía. Divide la tarea en pasos y márcalos a medida que avanzas.</p>`;

  return `${cabecera}${filas}${
    puedeEditar
      ? `<form class="agregar-subtarea" id="form-subtarea">
           <input class="campo" name="texto" maxlength="160" placeholder="Añadir un paso…" aria-label="Nueva subtarea" autocomplete="off">
           <button type="submit" class="btn">Añadir</button>
         </form>`
      : ""
  }`;
}

/* ===================== comentarios ===================== */

export function panelComentarios(detalle, nombreDe, yoId, puedeComentar) {
  if (detalle.sinConexion)
    return `<p class="panel-vacio">Los comentarios necesitan conexión. Vuelve cuando tengas internet.</p>`;
  if (detalle.cargando) return `<p class="panel-vacio">Cargando…</p>`;

  const lista = detalle.comentarios.length
    ? `<ul class="comentarios">${detalle.comentarios
        .map((c) => {
          const quien = nombreDe(c.autor);
          return `<li class="comentario">
            ${avatarDe(quien)}
            <div class="comentario-cuerpo">
              <div class="comentario-cab">
                <b>${esc(quien)}</b>
                <time datetime="${esc(c.creado)}">${tiempoRelativo(c.creado)}</time>
                ${
                  c.autor === yoId
                    ? `<button type="button" class="icono-quitar" data-borrar-comentario="${c.id}" aria-label="Eliminar comentario">×</button>`
                    : ""
                }
              </div>
              <p>${esc(c.texto)}</p>
            </div>
          </li>`;
        })
        .join("")}</ul>`
    : `<p class="panel-vacio">Nadie ha comentado esta tarea todavía.</p>`;

  return `${lista}${
    puedeComentar
      ? `<form class="agregar-comentario" id="form-comentario">
           <textarea class="campo" name="texto" maxlength="2000" rows="2" placeholder="Escribe un comentario…" aria-label="Nuevo comentario"></textarea>
           <button type="submit" class="btn btn-p">Comentar</button>
         </form>`
      : ""
  }`;
}

/* ===================== adjuntos ===================== */

export function panelAdjuntos(detalle, nombreDe, puedeEditar) {
  if (detalle.sinConexion)
    return `<p class="panel-vacio">Los adjuntos necesitan conexión. Vuelve cuando tengas internet.</p>`;
  if (detalle.cargando) return `<p class="panel-vacio">Cargando…</p>`;

  const lista = detalle.adjuntos.length
    ? `<ul class="adjuntos">${detalle.adjuntos
        .map(
          (a) => `<li class="adjunto">
            <span class="adjunto-icono" aria-hidden="true">${iconoArchivo(a.tipo, a.nombre)}</span>
            <button type="button" class="adjunto-datos" data-abrir-adjunto="${esc(a.ruta)}" title="Abrir ${esc(a.nombre)}">
              <b>${esc(a.nombre)}</b>
              <small>${pesoLegible(a.tamano)} · ${esc(nombreDe(a.subido_por))} · ${tiempoRelativo(a.creado)}</small>
            </button>
            ${
              puedeEditar
                ? `<button type="button" class="icono-quitar" data-borrar-adjunto="${a.id}" data-ruta="${esc(a.ruta)}" aria-label="Eliminar ${esc(a.nombre)}">×</button>`
                : ""
            }
          </li>`
        )
        .join("")}</ul>`
    : `<p class="panel-vacio">Sin archivos adjuntos.</p>`;

  return `${lista}${
    puedeEditar
      ? `<div class="subir">
           <input type="file" id="archivo-adjunto" hidden>
           <button type="button" class="btn" data-accion="elegir-archivo">Adjuntar archivo</button>
           <span class="ayuda">Hasta 25 MB por archivo.</span>
         </div>`
      : ""
  }`;
}

/* ===================== historial ===================== */

const ETIQ_CAMPO = {
  titulo: "el título",
  estado: "el estado",
  prioridad: "la prioridad",
  responsable: "el responsable",
  vence: "la fecha límite",
  notas: "las notas",
  etiquetas: "las etiquetas",
  tablero: "el tablero",
};

/** Traduce un valor crudo al texto que ve la persona. */
function valor(campo, v) {
  if (v === null || v === undefined || v === "") return "vacío";
  if (campo === "estado") return ETIQ_ESTADO[v] || v;
  if (campo === "prioridad") return ETIQ_PRIO[v] || v;
  if (campo === "vence") return fechaCorta(String(v)) || String(v);
  return String(v);
}

/**
 * Una línea de bitácora convertida en una frase en español.
 *
 * `esYo` no es un adorno: el sujeto de la frase lo pone panelHistorial, y
 * con "Tú" delante el verbo tiene que ir en segunda persona. Sin esto se
 * leería "Tú cambió el estado", que es justo lo que nadie escribiría.
 */
export function fraseHistorial(fila, esYo) {
  const d = fila.detalle || {};
  const v = (tercera, segunda) => (esYo ? segunda : tercera);

  switch (fila.accion) {
    case "tarea_creada":
      return `${v("creó", "creaste")} la tarea <b>${esc(d.titulo || "")}</b>`;
    case "tarea_eliminada":
      return `${v("eliminó", "eliminaste")} la tarea <b>${esc(d.titulo || "")}</b>`;
    case "comentario_agregado":
      return `${v("comentó", "comentaste")}: <i>«${esc(d.extracto || "")}»</i>`;
    case "subtarea_agregada":
      return `${v("añadió", "añadiste")} el paso <b>${esc(d.texto || "")}</b>`;
    case "subtarea_hecha":
      return `${v("completó", "completaste")} <b>${esc(d.texto || "")}</b>`;
    case "subtarea_reabierta":
      return `${v("reabrió", "reabriste")} <b>${esc(d.texto || "")}</b>`;
    case "adjunto_agregado":
      return `${v("adjuntó", "adjuntaste")} <b>${esc(d.nombre || "")}</b>`;
    case "adjunto_eliminado":
      return `${v("quitó", "quitaste")} el adjunto <b>${esc(d.nombre || "")}</b>`;
    case "miembro_agregado":
      return `${v("agregó", "agregaste")} a <b>${esc(d.email || "")}</b> como ${esc(d.rol || "")}`;
    case "tarea_editada": {
      const campos = d.campos || {};
      const partes = Object.keys(campos).map((k) => {
        const etiqueta = ETIQ_CAMPO[k] || k;
        // Las notas cambian por dentro; mostrar el texto viejo y el nuevo
        // llenaría la bitácora de párrafos. Basta con decir que cambiaron.
        if (k === "notas") return `${v("actualizó", "actualizaste")} las notas`;
        const [antes, ahora] = campos[k];
        return `${v("cambió", "cambiaste")} ${etiqueta} de <b>${esc(valor(k, antes))}</b> a <b>${esc(valor(k, ahora))}</b>`;
      });
      if (!partes.length) return v("editó", "editaste") + " la tarea";
      return partes.join(" y ");
    }
    default:
      return esc(fila.accion);
  }
}

export function panelHistorial(filas, nombreDe, opciones = {}, yoId = null) {
  if (opciones.sinConexion)
    return `<p class="panel-vacio">El historial necesita conexión.</p>`;
  if (opciones.cargando) return `<p class="panel-vacio">Cargando…</p>`;
  if (!filas || !filas.length)
    return `<p class="panel-vacio">Todavía no hay movimientos registrados.</p>`;

  return `<ol class="historial">${filas
    .map((f) => {
      const esYo = !!yoId && f.actor === yoId;
      const quien = nombreDe(f.actor);
      return `<li class="hito">
        <span class="hito-punto" aria-hidden="true"></span>
        <div class="hito-cuerpo">
          <p><b>${esc(quien)}</b> ${fraseHistorial(f, esYo)}</p>
          <time datetime="${esc(f.creado)}">${tiempoRelativo(f.creado)}</time>
        </div>
      </li>`;
    })
    .join("")}</ol>`;
}
