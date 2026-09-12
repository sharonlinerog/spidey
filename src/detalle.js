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

/** Un ícono por familia de archivo. Sin librerías: son cuatro casos. */
function iconoArchivo(tipo, nombre) {
  const t = String(tipo || "").toLowerCase();
  const ext = String(nombre || "").split(".").pop().toLowerCase();
  if (t.startsWith("image/")) return "🖼";
  if (t === "application/pdf" || ext === "pdf") return "📕";
  if (t.startsWith("video/")) return "🎬";
  if (t.startsWith("audio/")) return "🎵";
  if (["xlsx", "xls", "csv"].includes(ext)) return "📊";
  if (["docx", "doc", "odt"].includes(ext)) return "📝";
  if (["zip", "rar", "7z"].includes(ext)) return "🗜";
  return "📄";
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

export function selectorTableros(tableros, activoId) {
  if (!tableros.length) return "";

  return `<div class="tb-lista">${tableros
    .map((t) => {
      const activo = t.id === activoId;
      return `<button type="button" class="tb-item${activo ? " activo" : ""}" data-tablero="${t.id}" ${
        activo ? 'aria-current="true"' : ""
      }>
        <span class="tb-color" style="background:${esc(t.color)}"></span>
        <span class="tb-nombre">${esc(t.nombre)}</span>
        ${t.rol !== "propietario" ? `<span class="tb-rol">${ETIQ_ROL[t.rol]}</span>` : ""}
      </button>`;
    })
    .join("")}</div>
    <div class="tb-pie">
      <button type="button" class="btn btn-p btn-ancho-suave" data-accion="nuevo-tablero">+ Nuevo tablero</button>
    </div>`;
}

/** Nombre y color del tablero activo, para la cabecera. */
export function chapaTablero(tablero) {
  if (!tablero) return "Sin tablero";
  return `<span class="tb-color" style="background:${esc(tablero.color)}"></span>
    <span class="tb-actual-nombre">${esc(tablero.nombre)}</span>
    ${tablero.rol !== "propietario" ? `<span class="tb-rol">${ETIQ_ROL[tablero.rol]}</span>` : ""}`;
}

/* ===================== miembros ===================== */

export function panelMiembros(tablero, miembros, invitaciones, yoId) {
  if (!tablero) return "";
  const propietario = tablero.rol === "propietario";

  const filas = [...miembros]
    .sort((a, b) => {
      const peso = { propietario: 0, editor: 1, lector: 2 };
      return peso[a.rol] - peso[b.rol] || (a.nombre || a.email).localeCompare(b.nombre || b.email);
    })
    .map((m) => {
      const soyYo = m.user_id === yoId;
      const nombre = m.nombre || m.email || "Sin nombre";
      return `<li class="miembro">
        ${avatarDe(nombre)}
        <span class="miembro-datos">
          <b>${esc(nombre)}${soyYo ? " (tú)" : ""}</b>
          <small>${esc(m.email)}</small>
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
             <span class="miembro-datos"><b>${esc(i.email)}</b><small>Esperando que se registre · ${ETIQ_ROL[i.rol]}</small></span>
             ${propietario ? `<button type="button" class="icono-quitar" data-cancelar-invitacion="${i.id}" aria-label="Cancelar invitación">×</button>` : ""}
           </li>`
         )
         .join("")}</ul>`
    : "";

  return `<h4 class="mini-titulo">Quién entra a «${esc(tablero.nombre)}»</h4>
    <ul class="miembros">${filas}</ul>
    ${pendientes}
    ${
      propietario
        ? `<form class="invitar" id="form-invitar">
             <input class="campo" name="email" type="email" placeholder="correo@ejemplo.com" required aria-label="Correo de quien invitas">
             <select class="campo" name="rol" aria-label="Rol">
               <option value="editor">Editor</option>
               <option value="lector">Solo lectura</option>
             </select>
             <button type="submit" class="btn btn-p">Invitar</button>
           </form>
           <p class="ayuda">Si aún no tiene cuenta, la invitación queda guardada y se aplica sola cuando se registre con ese correo.</p>`
        : `<p class="ayuda">Solo el propietario del tablero puede invitar o quitar personas.</p>`
    }`;
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
