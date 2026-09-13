/**
 * Vistas: convierten el arreglo de tareas en HTML.
 * Ninguna función de este archivo habla con el servidor ni guarda estado;
 * reciben datos y devuelven marcado. Eso las hace fáciles de razonar y probar.
 */

export const ESTADOS = [
  { id: "por_hacer", label: "Por hacer" },
  { id: "en_curso", label: "En curso" },
  { id: "en_revision", label: "En revisión" },
  { id: "hecho", label: "Hecho" },
];
export const ETIQ_ESTADO = Object.fromEntries(ESTADOS.map((e) => [e.id, e.label]));
export const ETIQ_PRIO = { alta: "Alta", media: "Media", baja: "Baja" };
const COLOR_ESTADO = {
  por_hacer: "var(--tinta-3)",
  en_curso: "var(--sello)",
  en_revision: "var(--media)",
  hecho: "var(--ok)",
};
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/* ---------------- utilidades ---------------- */

export const pad = (n) => (n < 10 ? "0" : "") + n;

export function hoyISO() {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

export function vencida(t) {
  return !!t.vence && t.estado !== "hecho" && t.vence < hoyISO();
}

export function diasHasta(iso) {
  if (!iso) return null;
  const a = new Date(hoyISO() + "T00:00:00");
  const b = new Date(iso + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

/**
 * Fecha en relación a hoy: "Hoy", "Mañana", "Ayer", "-3d", "+5d" o la
 * fecha corta si queda lejos. Lo cercano es lo que urge, y "en 3 días"
 * se entiende sin hacer la cuenta que pide un "15 de septiembre".
 */
export function fechaRelativa(iso) {
  if (!iso) return "";
  const dias = diasHasta(iso);
  if (dias === null || Number.isNaN(dias)) return "";
  if (dias === 0) return "Hoy";
  if (dias === 1) return "Mañana";
  if (dias === -1) return "Ayer";
  if (dias < 0 && dias > -7) return dias + "d";
  if (dias > 0 && dias < 7) return "+" + dias + "d";
  return fechaCorta(iso);
}

export function fechaCorta(iso) {
  if (!iso) return "";
  const p = iso.split("-");
  return parseInt(p[2], 10) + " " + MESES[parseInt(p[1], 10) - 1].slice(0, 3);
}

function iniciales(n) {
  const p = n.trim().split(/\s+/);
  return (p[0][0] + (p[1] ? p[1][0] : "")).toUpperCase();
}

function colorPersona(n) {
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
  return `hsl(${h} 42% 42%)`;
}

export function personas(tareas) {
  return [...new Set(tareas.map((t) => t.responsable).filter(Boolean))].sort();
}
export function etiquetas(tareas) {
  return [...new Set(tareas.flatMap((t) => t.etiquetas || []))].sort();
}

export function filtrar(tareas, f) {
  const q = (f.q || "").toLowerCase().trim();
  return tareas.filter((t) => {
    if (f.vencidas && !vencida(t)) return false;
    if (f.responsable && t.responsable !== f.responsable) return false;
    if (f.prioridad && t.prioridad !== f.prioridad) return false;
    if (f.etiqueta && !(t.etiquetas || []).includes(f.etiqueta)) return false;
    if (q) {
      const heno = `${t.titulo} ${t.notas || ""} ${(t.etiquetas || []).join(" ")} ${t.responsable || ""}`.toLowerCase();
      if (!heno.includes(q)) return false;
    }
    return true;
  });
}

export function porColumna(id, base) {
  return base.filter((t) => t.estado === id).sort((a, b) => a.posicion - b.posicion);
}

function vacio(titulo, texto, conBoton) {
  return `<div class="vacio"><h3>${titulo}</h3><p>${texto}</p>${
    conBoton ? '<button class="btn btn-p" data-nueva>+ Crear la primera tarea</button>' : ""
  }</div>`;
}

/* ---------------- tablero ---------------- */

/**
 * `meta` trae lo que no vive en la fila de la tarea: avance de subtareas y
 * cuántos comentarios y adjuntos tiene. Se pasa como parámetro en vez de
 * importarlo del store para que este archivo siga siendo funciones puras.
 */
const SIN_META = { avance: () => null, comentarios: () => 0, adjuntos: () => 0 };

export function tablero(tareas, filtros, cargado, meta = SIN_META) {
  const base = filtrar(tareas, filtros);
  if (!cargado) return vacio("Cargando tu tablero…", "Un momento mientras traemos las tareas guardadas.", false);
  if (!tareas.length)
    return vacio("Este tablero está vacío", "Crea la primera tarea y arrástrala entre columnas a medida que avanza.", true);

  return `<div class="tablero">${ESTADOS.map((e) => {
    const col = porColumna(e.id, base);

    // "Urgente" es lo que ya venció o vence hoy. La barra fina bajo el
    // cabezal dice de un vistazo qué proporción de la columna lo es, y se
    // pone roja cuando pasa de un tercio: ahí ya no es un detalle.
    const urgentes = col.filter((t) => {
      const d = diasHasta(t.vence);
      return t.estado !== "hecho" && d !== null && d <= 0;
    }).length;
    const pct = col.length ? Math.round((urgentes / col.length) * 100) : 0;

    return `<div class="columna" data-estado="${e.id}">
      <div class="col-cab">
        <span class="raya ${e.id}"></span>
        <h2>${e.label}</h2>
        <span class="cuenta">${col.length}</span>
        ${urgentes ? `<span class="cuenta urgente" title="${urgentes} urgente${urgentes === 1 ? "" : "s"}">${urgentes}</span>` : ""}
      </div>
      ${col.length ? `<div class="col-salud"><span class="col-salud-relleno${pct > 30 ? " alerta" : ""}" style="width:${pct}%"></span></div>` : ""}
      <div class="lista-col" data-drop="${e.id}">${col.map((t) => tarjeta(t, meta)).join("")}</div>
      <button class="agregar-col" data-nueva data-estado="${e.id}">+ Añadir aquí</button>
    </div>`;
  }).join("")}</div>`;
}

/** Insignias discretas: solo aparecen cuando hay algo que contar. */
function insignias(t, meta) {
  const nc = meta.comentarios(t.id);
  const na = meta.adjuntos(t.id);
  if (!nc && !na) return "";
  return `<span class="insignias">${
    nc ? `<span class="insignia" title="${nc} comentario${nc === 1 ? "" : "s"}">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 21l1.9-5A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z"/></svg>${nc}</span>` : ""
  }${
    na ? `<span class="insignia" title="${na} adjunto${na === 1 ? "" : "s"}">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.19 5.19l-9.2 9.19a1.83 1.83 0 0 1-2.59-2.6l8.49-8.48"/></svg>${na}</span>` : ""
  }</span>`;
}

/** Barra de avance de subtareas. Nula si la tarea no tiene ninguna. */
function avanceHTML(t, meta) {
  const a = meta.avance(t.id);
  if (!a) return "";
  const pct = Math.round((a.hechas / a.total) * 100);
  return `<div class="avance${a.hechas === a.total ? " completo" : ""}" title="${a.hechas} de ${a.total} subtareas">
    <span class="avance-pista"><span class="avance-relleno" style="width:${pct}%"></span></span>
    <span class="avance-texto">${a.hechas}/${a.total}</span>
  </div>`;
}

function tarjeta(t, meta = SIN_META) {
  const i = ESTADOS.findIndex((e) => e.id === t.estado);
  const esVenc = vencida(t);
  // El texto largo se queda en el atributo title; en la tarjeta va la forma
  // corta, que es la que cabe junto a la prioridad y las etiquetas.
  const textoFecha = fechaRelativa(t.vence);
  const tituloFecha = t.vence
    ? (esVenc ? "Venció el " : "Vence el ") + fechaCorta(t.vence)
    : "";

  return `<article class="tarjeta${esVenc ? " urgente" : ""}${t.estado === "hecho" ? " lista-hecho" : ""}" draggable="true" data-id="${t.id}" tabindex="0">
    <div class="t-titulo">${esc(t.titulo)}</div>
    <div class="t-meta">
      <span class="chip ${t.prioridad}">${ETIQ_PRIO[t.prioridad]}</span>
      ${t.vence ? `<span class="chip fecha${esVenc ? " vencida" : ""}" title="${esc(tituloFecha)}">${textoFecha}</span>` : ""}
      ${(t.etiquetas || []).slice(0, 3).map((e) => `<span class="chip etiqueta">${esc(e)}</span>`).join("")}
    </div>
    ${avanceHTML(t, meta)}
    <div class="t-pie">
      <span class="quien">${
        t.responsable
          ? `<span class="avatar" style="background:${colorPersona(t.responsable)}">${esc(iniciales(t.responsable))}</span><span>${esc(t.responsable)}</span>`
          : '<span style="color:var(--tinta-3);font-size:12px">Sin responsable</span>'
      }</span>
      ${insignias(t, meta)}
      <button class="mover" data-mover="-1" data-id="${t.id}" ${i <= 0 ? "disabled" : ""} aria-label="Mover a la columna anterior">‹</button>
      <button class="mover" data-mover="1" data-id="${t.id}" ${i >= ESTADOS.length - 1 ? "disabled" : ""} aria-label="Mover a la columna siguiente">›</button>
    </div></article>`;
}

/* ---------------- lista ---------------- */

/** Cómo se agrupa la lista, y con qué encabezado se anuncia cada grupo. */
const AGRUPAMIENTOS = [
  { id: "estado", label: "Estado" },
  { id: "responsable", label: "Responsable" },
  { id: "prioridad", label: "Prioridad" },
  { id: "", label: "Ninguno" },
];

/** Devuelve la clave de grupo de una tarea, ya lista para mostrarse. */
function grupoDe(t, por) {
  if (por === "estado") return { clave: t.estado, label: ETIQ_ESTADO[t.estado], raya: t.estado };
  if (por === "prioridad") return { clave: t.prioridad, label: ETIQ_PRIO[t.prioridad], raya: "" };
  if (por === "responsable")
    return { clave: t.responsable || "", label: t.responsable || "Sin responsable", raya: "" };
  return { clave: "", label: "", raya: "" };
}

export function listaTabla(tareas, filtros, orden, meta = SIN_META, agrupar = "estado") {
  const base = [...filtrar(tareas, filtros)];

  const barra = `<div class="lista-agrupar">
    <span class="lista-agrupar-et">Agrupar por</span>
    ${AGRUPAMIENTOS.map(
      (a) => `<button type="button" class="chip agrupar" data-agrupar="${a.id}" aria-selected="${String(a.id === agrupar)}">${a.label}</button>`
    ).join("")}
  </div>`;

  if (!base.length)
    return barra + vacio("Nada por aquí", "Ninguna tarea coincide con los filtros activos.", !tareas.length);

  const dir = orden.dir === "asc" ? 1 : -1;
  const pesoP = { alta: 0, media: 1, baja: 2 };
  const pesoE = { por_hacer: 0, en_curso: 1, en_revision: 2, hecho: 3 };
  base.sort((a, b) => {
    let x, y;
    if (orden.campo === "prioridad") { x = pesoP[a.prioridad]; y = pesoP[b.prioridad]; }
    else if (orden.campo === "estado") { x = pesoE[a.estado]; y = pesoE[b.estado]; }
    else if (orden.campo === "vence") { x = a.vence || "9999-12-31"; y = b.vence || "9999-12-31"; }
    else { x = (a[orden.campo] || "").toLowerCase(); y = (b[orden.campo] || "").toLowerCase(); }
    return x < y ? -dir : x > y ? dir : 0;
  });

  // Agrupar es reordenar: primero por grupo, y dentro de cada grupo se
  // respeta el orden de columna que la persona eligió.
  if (agrupar) {
    const peso = (t) => {
      if (agrupar === "estado") return pesoE[t.estado];
      if (agrupar === "prioridad") return pesoP[t.prioridad];
      return (t.responsable || "￿").toLowerCase();
    };
    base.sort((a, b) => {
      const x = peso(a), y = peso(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }

  const flecha = (k) => (orden.campo === k ? (orden.dir === "asc" ? " ↑" : " ↓") : "");
  const guion = '<span class="guion">—</span>';
  const COLUMNAS = 8;

  let grupoActual = null;
  const filas = base
    .map((t) => {
      let cabecera = "";
      if (agrupar) {
        const g = grupoDe(t, agrupar);
        if (g.clave !== grupoActual) {
          grupoActual = g.clave;
          const cuantas = base.filter((x) => grupoDe(x, agrupar).clave === g.clave).length;
          cabecera = `<tr class="grupo-cab"><td colspan="${COLUMNAS}">
            ${g.raya ? `<span class="raya ${g.raya}"></span>` : ""}${esc(g.label)}
            <span class="grupo-cuenta">${cuantas}</span>
          </td></tr>`;
        }
      }

      const v = vencida(t);
      const a = meta.avance(t.id);
      const hecha = t.estado === "hecho";

      return `${cabecera}<tr${hecha ? ' class="fila-hecha"' : ""}>
        <td class="col-marca">
          <input type="checkbox" class="marca-hecha" data-marcar="${t.id}" ${hecha ? "checked" : ""}
                 aria-label="Marcar «${esc(t.titulo)}» como hecha">
        </td>
        <td class="col-titulo">${esc(t.titulo)}
          ${a ? `<span class="mini-avance${a.hechas === a.total ? " completo" : ""}">${a.hechas}/${a.total} subtareas</span>` : ""}
          ${insignias(t, meta)}</td>
        <td><span class="marca-estado"><span class="raya ${t.estado}"></span>${ETIQ_ESTADO[t.estado]}</span></td>
        <td><span class="chip ${t.prioridad}">${ETIQ_PRIO[t.prioridad]}</span></td>
        <td>${t.responsable ? `<span class="quien"><span class="avatar" style="background:${colorPersona(t.responsable)}">${esc(iniciales(t.responsable))}</span><span>${esc(t.responsable)}</span></span>` : guion}</td>
        <td>${t.vence ? `<span class="chip fecha${v ? " vencida" : ""}" title="${esc(fechaCorta(t.vence))}">${fechaRelativa(t.vence)}</span>` : guion}</td>
        <td>${(t.etiquetas || []).map((e) => `<span class="chip etiqueta">${esc(e)}</span>`).join(" ") || guion}</td>
        <td><div class="acciones-fila">
          <button type="button" data-editar="${t.id}">Editar</button>
          <button type="button" data-duplicar="${t.id}">Duplicar</button>
          <button type="button" class="peligro" data-eliminar="${t.id}">Eliminar</button>
        </div></td></tr>`;
    })
    .join("");

  return `${barra}<div class="envoltura-tabla"><table><thead><tr>
    <th class="col-marca"><span class="sr-solo">Hecha</span></th>
    <th data-orden="titulo">Tarea${flecha("titulo")}</th>
    <th data-orden="estado">Estado${flecha("estado")}</th>
    <th data-orden="prioridad">Prioridad${flecha("prioridad")}</th>
    <th data-orden="responsable">Responsable${flecha("responsable")}</th>
    <th data-orden="vence">Fecha límite${flecha("vence")}</th>
    <th>Etiquetas</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`;
}

/* ---------------- calendario ---------------- */

/** Color de la franja según la prioridad, para el resumen de una celda llena. */
const COLOR_PRIO = { alta: "var(--alta)", media: "var(--media)", baja: "var(--baja)" };

/**
 * Cuando en una celda no caben todas las tareas, en vez de recortarlas y
 * mentir, se muestran las primeras y al pie una franja con el color de
 * cada una de las restantes. Así el día "lleno" se sigue leyendo como lleno.
 */
function franjaPrioridades(tareas) {
  if (!tareas.length) return "";
  const trozo = 100 / tareas.length;
  const partes = tareas.map((t, i) => {
    const c = COLOR_PRIO[t.prioridad] || "var(--baja)";
    return `${c} ${i * trozo}%, ${c} ${(i + 1) * trozo}%`;
  });
  return `<div class="celda-franja" style="background:linear-gradient(90deg,${partes.join(",")})"></div>`;
}

/** Lunes de la semana en que cae una fecha. La semana empieza en lunes. */
function lunesDe(fecha) {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export function calendario(tareas, filtros, cursor, modo = "mes") {
  const base = filtrar(tareas, filtros);
  const y = cursor.getFullYear();
  const m = cursor.getMonth();

  const porFecha = {};
  base.forEach((t) => {
    if (t.vence) (porFecha[t.vence] = porFecha[t.vence] || []).push(t);
  });
  const sinFecha = base.filter((t) => !t.vence && t.estado !== "hecho");

  // En la vista de semana caben muchas más tareas por día; en la de mes,
  // tres y el resto se resume en una franja.
  const TOPE = modo === "semana" ? 12 : 3;

  /** Una casilla del calendario. `fuera` = día de otro mes. */
  const celda = (fecha, fuera) => {
    const iso = `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}`;
    const del = porFecha[iso] || [];
    const finde = fecha.getDay() === 0 || fecha.getDay() === 6;
    const visibles = del.slice(0, TOPE);
    const resto = del.slice(TOPE);

    return `<div class="celda${fuera ? " fuera" : ""}${iso === hoyISO() ? " hoy" : ""}${finde ? " finde" : ""}">
      <span class="num">${fecha.getDate()}</span>
      ${visibles
        .map((t) => `<button class="mini ${t.prioridad}${t.estado === "hecho" ? " completa" : ""}" data-editar="${t.id}" title="${esc(t.titulo)}">${esc(t.titulo)}</button>`)
        .join("")}
      ${resto.length ? `<span class="celda-mas">+${resto.length}</span>${franjaPrioridades(resto)}` : ""}
    </div>`;
  };

  let celdas = "";
  let titulo;

  if (modo === "semana") {
    const lunes = lunesDe(cursor);
    titulo = `Semana del ${lunes.getDate()} de ${MESES[lunes.getMonth()]}`;
    for (let i = 0; i < 7; i++) {
      const d = new Date(lunes);
      d.setDate(lunes.getDate() + i);
      celdas += celda(d, d.getMonth() !== m);
    }
  } else {
    // Se capitaliza aquí y no con text-transform: en CSS `capitalize`
    // pone mayúscula a cada palabra y dejaría "Semana Del 7 De Septiembre".
    titulo = MESES[m].charAt(0).toUpperCase() + MESES[m].slice(1) + " " + y;
    const inicio = (new Date(y, m, 1).getDay() + 6) % 7;
    const dias = new Date(y, m + 1, 0).getDate();

    for (let i = inicio; i > 0; i--) celdas += celda(new Date(y, m, 1 - i), true);
    for (let i = 1; i <= dias; i++) celdas += celda(new Date(y, m, i), false);
    const resto = (7 - ((inicio + dias) % 7)) % 7;
    for (let i = 1; i <= resto; i++) celdas += celda(new Date(y, m + 1, i), true);
  }

  const paso = modo === "semana" ? "semana" : "mes";

  return `<div class="cal-cab">
      <button class="btn btn-icono" data-mes="-1" aria-label="${paso === "semana" ? "Semana anterior" : "Mes anterior"}">‹</button>
      <h2>${titulo}</h2>
      <button class="btn btn-icono" data-mes="1" aria-label="${paso === "semana" ? "Semana siguiente" : "Mes siguiente"}">›</button>
      <button class="btn" data-mes="0">Hoy</button>
      <div class="vista-toggle" role="group" aria-label="Escala del calendario">
        <button type="button" data-cal="mes" aria-selected="${String(modo !== "semana")}">Mes</button>
        <button type="button" data-cal="semana" aria-selected="${String(modo === "semana")}">Semana</button>
      </div>
    </div>
    <div class="rejilla${modo === "semana" ? " semana" : ""}">${DIAS.map((d) => `<div class="dia-nombre">${d}</div>`).join("")}${celdas}</div>
    ${
      sinFecha.length
        ? `<div class="panel" style="margin-top:14px"><h3>Sin fecha límite</h3>
           <p class="sub">${sinFecha.length} tarea${sinFecha.length === 1 ? "" : "s"} activa${sinFecha.length === 1 ? "" : "s"} que aún no aparecen en el calendario.</p>
           <div class="t-meta">${sinFecha.map((t) => `<button class="mini ${t.prioridad}" data-editar="${t.id}">${esc(t.titulo)}</button>`).join("")}</div></div>`
        : ""
    }`;
}

/* ---------------- indicadores ---------------- */

/* ---------------- series temporales ---------------- */

/** Clave AAAA-MM-DD de una fecha local (no UTC: un día se acaba a medianoche de aquí). */
function claveDia(fecha) {
  return fecha.getFullYear() + "-" + pad(fecha.getMonth() + 1) + "-" + pad(fecha.getDate());
}

/**
 * Cuántas tareas se completaron cada uno de los últimos `dias` días.
 * Se mira `completada`, que es cuando de verdad se cerró, no `vence`.
 */
export function serieUltimosDias(tareas, dias) {
  const cuenta = {};
  tareas.forEach((t) => {
    if (!t.completada) return;
    const d = new Date(t.completada);
    if (!Number.isNaN(d.getTime())) {
      const k = claveDia(d);
      cuenta[k] = (cuenta[k] || 0) + 1;
    }
  });

  const serie = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = claveDia(d);
    serie.push({ fecha: k, n: cuenta[k] || 0 });
  }
  return serie;
}

/** Lo mismo pero por semanas, para ver el ritmo de varios meses. */
function serieUltimasSemanas(tareas, semanas) {
  const serie = [];
  for (let i = semanas - 1; i >= 0; i--) {
    const fin = new Date();
    fin.setDate(fin.getDate() - i * 7);
    const ini = new Date(fin);
    ini.setDate(ini.getDate() - 6);
    const a = claveDia(ini), b = claveDia(fin);
    const n = tareas.filter((t) => {
      if (!t.completada) return false;
      const k = claveDia(new Date(t.completada));
      return k >= a && k <= b;
    }).length;
    serie.push({ desde: a, hasta: b, n });
  }
  return serie;
}

/**
 * Barritas verticales. Sin ejes ni números: no es un gráfico para leer
 * valores, es para ver la forma —si el ritmo sube, baja o se detuvo—.
 */
function chispa(serie, etiqueta) {
  if (!serie.length) return "";
  const max = Math.max(1, ...serie.map((s) => s.n));
  return `<div class="spark" role="img" aria-label="${esc(etiqueta)}">${serie
    .map((s) => {
      const alto = s.n ? Math.max(8, Math.round((s.n / max) * 100)) : 3;
      return `<span class="${s.n === max && s.n > 0 ? "pico" : ""}" style="height:${alto}%" title="${s.n}"></span>`;
    })
    .join("")}</div>`;
}

export function indicadores(tareas, filtros) {
  const base = filtrar(tareas, filtros);
  if (!base.length)
    return vacio("Aún no hay datos", "Crea tareas para ver aquí el avance, la carga por persona y lo que está por vencer.", !tareas.length);

  const activas = base.filter((t) => t.estado !== "hecho");
  const hechas = base.filter((t) => t.estado === "hecho");
  const venc = base.filter(vencida);
  const pronto = activas
    .filter((t) => { const d = diasHasta(t.vence); return d !== null && d >= 0 && d <= 7; })
    .sort((a, b) => (a.vence < b.vence ? -1 : 1));
  const avance = Math.round((hechas.length / base.length) * 100);
  const conFecha = base.filter((t) => !!t.vence).length;

  const porEstado = ESTADOS.map((e) => ({ ...e, n: base.filter((t) => t.estado === e.id).length }));

  // Carga por persona, desglosada: no es lo mismo tener ocho tareas al día
  // que ocho con la mitad vencidas, y una barra sola no distingue los casos.
  const desglose = (suyas) => ({
    vencidas: suyas.filter(vencida).length,
    curso: suyas.filter((t) => t.estado !== "hecho" && !vencida(t)).length,
    hechas: suyas.filter((t) => t.estado === "hecho").length,
  });

  const carga = personas(base)
    .map((p) => {
      const suyas = base.filter((t) => t.responsable === p);
      const d = desglose(suyas);
      return { nom: p, ...d, total: suyas.length, n: d.vencidas + d.curso };
    })
    .filter((c) => c.total > 0)
    .sort((a, b) => b.n - a.n || b.total - a.total)
    .slice(0, 8);

  const sinDuenio = base.filter((t) => !t.responsable);
  if (sinDuenio.length) {
    const d = desglose(sinDuenio);
    carga.push({ nom: "Sin asignar", ...d, total: sinDuenio.length, n: d.vencidas + d.curso });
  }
  const maxCarga = Math.max(1, ...carga.map((c) => c.total));

  const etq = etiquetas(base)
    .map((e) => ({ nom: e, n: base.filter((t) => (t.etiquetas || []).includes(e)).length }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 7);
  const maxEtq = Math.max(1, ...etq.map((e) => e.n));

  const proximas = activas.filter((t) => t.vence).sort((a, b) => (a.vence < b.vence ? -1 : 1)).slice(0, 6);

  // Ritmo: cuánto se cerró esta semana frente a la anterior.
  const serie14 = serieUltimosDias(base, 14);
  const estaSemana = serie14.slice(7).reduce((s, x) => s + x.n, 0);
  const semanaPrevia = serie14.slice(0, 7).reduce((s, x) => s + x.n, 0);
  const delta = estaSemana - semanaPrevia;
  const textoDelta = semanaPrevia === 0 && estaSemana === 0
    ? ""
    : delta === 0
    ? "igual que la semana pasada"
    : (delta > 0 ? "▲ " : "▼ ") + Math.abs(delta) + " vs. semana pasada";

  const kpi = (n, et, nota, extra = {}) =>
    `<div class="kpi${extra.aviso ? " aviso" : ""}">
      <span class="n">${n}</span>
      <span class="et">${et}</span>
      <span class="nota">${esc(nota)}</span>
      ${extra.delta ? `<span class="kpi-delta${extra.deltaMal ? " mal" : ""}">${esc(extra.delta)}</span>` : ""}
      ${extra.spark || ""}
      ${extra.accion || ""}
    </div>`;

  return `<div class="kpis">
    ${kpi(activas.length, "Tareas activas", `${hechas.length} completadas de ${base.length}`)}
    ${kpi(venc.length, "Vencidas", venc.length ? "Requieren atención inmediata" : "Todo al día", {
      aviso: venc.length > 0,
      accion: venc.length
        ? `<button type="button" class="kpi-accion" data-ver-vencidas>Ver todas →</button>`
        : "",
    })}
    ${kpi(pronto.length, "Vencen en 7 días", pronto.length ? "Próxima: " + fechaCorta(pronto[0].vence) : "Semana despejada")}
    ${kpi(estaSemana, "Cerradas esta semana", `${hechas.length} completadas en total`, {
      delta: textoDelta,
      deltaMal: delta < 0,
      spark: chispa(serie14.slice(7), `Tareas cerradas cada día de los últimos 7 días`),
    })}
  </div>
  <div class="paneles">
    <div class="panel"><h3>Flujo del tablero</h3><p class="sub">Dónde está detenido el trabajo ahora mismo.</p>
      <div class="tramos">${porEstado.filter((e) => e.n > 0).map((e) =>
        `<div class="tramo" style="flex:${e.n};background:${COLOR_ESTADO[e.id]}" title="${e.label}: ${e.n}">${e.n / base.length > 0.07 ? e.n : ""}</div>`).join("")}</div>
      <div class="leyenda">${porEstado.map((e) => `<span><i style="background:${COLOR_ESTADO[e.id]}"></i>${e.label} · ${e.n}</span>`).join("")}</div>
      <div class="barras" style="margin-top:16px;border-top:1px solid var(--linea);padding-top:14px">
        <div class="fila-barra"><span class="nom">Completado</span>
          <span class="pista"><span class="relleno" style="width:${avance}%;background:var(--ok)"></span></span>
          <span class="val">${avance}%</span></div>
        <div class="fila-barra"><span class="nom">Con fecha límite</span>
          <span class="pista"><span class="relleno" style="width:${Math.round((conFecha / base.length) * 100)}%"></span></span>
          <span class="val">${conFecha}</span></div>
      </div>
    </div>

    <div class="panel"><h3>Carga por responsable</h3><p class="sub">Qué tiene cada persona entre manos, y en qué estado.</p>
      <div class="barras">${carga
        .map((c) => {
          const ancho = Math.round((c.total / maxCarga) * 100);
          const tramo = (n, color, nombre) =>
            n ? `<span style="flex:${n};background:${color}" title="${nombre}: ${n}"></span>` : "";
          return `<div class="fila-barra"><span class="nom">${esc(c.nom)}</span>
            <span class="pista" style="background:transparent">
              <span class="barra-segmentada" style="width:${ancho}%">
                ${tramo(c.vencidas, "var(--alerta)", "Vencidas")}
                ${tramo(c.curso, "var(--sello)", "En curso")}
                ${tramo(c.hechas, "var(--ok)", "Hechas")}
              </span>
            </span>
            <span class="val">${c.total}</span></div>`;
        })
        .join("")}</div>
      <div class="leyenda">
        <span><i style="background:var(--alerta)"></i>Vencidas</span>
        <span><i style="background:var(--sello)"></i>En curso</span>
        <span><i style="background:var(--ok)"></i>Hechas</span>
      </div>
    </div>

    <div class="panel"><h3>Ritmo de completado</h3><p class="sub">Tareas cerradas por semana en los últimos tres meses.</p>
      ${(() => {
        const semanas = serieUltimasSemanas(base, 12);
        const max = Math.max(1, ...semanas.map((s) => s.n));
        if (!semanas.some((s) => s.n))
          return '<p class="panel-vacio">Todavía no se ha cerrado ninguna tarea.</p>';
        return `<div class="histograma">${semanas
          .map((s) => {
            const alto = s.n ? Math.max(6, Math.round((s.n / max) * 100)) : 2;
            return `<span class="histo-barra" title="${fechaCorta(s.desde)} – ${fechaCorta(s.hasta)}: ${s.n}">
              <span style="height:${alto}%"></span>
            </span>`;
          })
          .join("")}</div>
          <div class="histo-pie"><span>${fechaCorta(semanas[0].desde)}</span><span>hoy</span></div>`;
      })()}
    </div>

    <div class="panel"><h3>Próximos vencimientos</h3><p class="sub">Las seis fechas límite más cercanas.</p>
      ${proximas.length
        ? `<div class="barras">${proximas.map((t) => {
            const d = diasHasta(t.vence);
            const txt = d < 0 ? "vencida" : d === 0 ? "hoy" : d === 1 ? "mañana" : "en " + d + " d";
            return `<div class="fila-barra" style="grid-template-columns:1fr auto auto">
              <span class="nom">${esc(t.titulo)}</span>
              <span class="chip ${t.prioridad}">${ETIQ_PRIO[t.prioridad]}</span>
              <span class="val" style="width:64px;color:${d < 0 ? "var(--alerta)" : "var(--tinta-2)"}">${txt}</span></div>`;
          }).join("")}</div>`
        : '<p style="color:var(--tinta-3)">Ninguna tarea activa tiene fecha límite.</p>'}
    </div>

    ${etq.length
      ? `<div class="panel"><h3>Etiquetas más usadas</h3><p class="sub">Dónde se concentra el trabajo por proyecto o área.</p>
        <div class="barras">${etq.map((e) =>
          `<div class="fila-barra"><span class="nom">${esc(e.nom)}</span>
            <span class="pista"><span class="relleno" style="width:${Math.round((e.n / maxEtq) * 100)}%"></span></span>
            <span class="val">${e.n}</span></div>`).join("")}</div></div>`
      : ""}
  </div>`;
}

/* ===================== Bandeja de notificaciones ===================== */

/**
 * Agrupa lo que pide atención hoy. Es la misma lógica que usa el correo
 * diario, para que la campanita y el buzón nunca digan cosas distintas.
 *
 * Devuelve { vencidas, hoy, pronto, total } donde `total` cuenta solo lo
 * accionable ahora (vencidas + de hoy). Lo de la próxima semana informa,
 * no urge, así que no infla el contador.
 */
export function agruparPendientes(tareas) {
  const hoy = hoyISO();
  const limite = (() => {
    const d = new Date(hoy + "T00:00:00");
    d.setDate(d.getDate() + 7);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  })();

  const activas = tareas.filter((t) => t.estado !== "hecho" && t.vence);
  const vencidas = activas.filter((t) => t.vence < hoy).sort((a, b) => a.vence < b.vence ? -1 : 1);
  const deHoy = activas.filter((t) => t.vence === hoy);
  const pronto = activas
    .filter((t) => t.vence > hoy && t.vence <= limite)
    .sort((a, b) => (a.vence < b.vence ? -1 : 1));

  return { vencidas, hoy: deHoy, pronto, total: vencidas.length + deHoy.length };
}

function filaBandeja(t, cuando, urgente) {
  return `<button type="button" class="bandeja-item${urgente ? " urgente" : ""}" data-editar="${t.id}">
    <span class="bi-punto ${t.prioridad}"></span>
    <span class="bi-texto">${esc(t.titulo)}</span>
    <span class="bi-cuando">${cuando}</span>
  </button>`;
}

/**
 * Una línea de "lo que hizo otra persona".
 *
 * El texto llega ya redactado desde fuera. Es a propósito: redactarlo aquí
 * obligaría a views.js a importar detalle.js, que a su vez importa views.js,
 * y ese abrazo entre módulos es justo lo que no queremos.
 */
function filaActividad(a) {
  return `<button type="button" class="bandeja-item actividad${a.nueva ? " nueva" : ""}"${
    a.tareaId ? ` data-editar="${a.tareaId}"` : ""
  }>
    <span class="bi-punto ${a.nueva ? "alta" : "baja"}"></span>
    <span class="bi-texto">${a.html}</span>
    <span class="bi-cuando">${esc(a.cuando)}</span>
  </button>`;
}

/**
 * Panel de la campanita: el único sitio donde viven las notificaciones.
 *
 * Junta dos cosas distintas que a la persona le importan por igual: lo que
 * se le vence (calculado de sus tareas) y lo que hicieron los demás en el
 * tablero (venido de la bitácora). `actividad` llega ya redactada.
 */
export function bandeja(g, actividad = []) {
  const nuevas = actividad.filter((a) => a.nueva).length;
  const hayAlgo = g.vencidas.length || g.hoy.length || g.pronto.length || actividad.length;

  if (!hayAlgo) {
    return `<div class="bandeja-cab"><b>Notificaciones</b></div>
      <p class="bandeja-vacia">Nada pendiente. Todo al día.</p>`;
  }

  const grupo = (titulo, items, render, extra) =>
    items.length
      ? `<div class="bandeja-grupo"><h4>${titulo}${extra || ""}</h4>${items.map(render).join("")}</div>`
      : "";

  const resumen = [];
  if (g.total) resumen.push(g.total + (g.total === 1 ? " pendiente" : " pendientes"));
  if (nuevas) resumen.push(nuevas + (nuevas === 1 ? " novedad" : " novedades"));

  return `<div class="bandeja-cab">
      <b>Notificaciones</b>
      <span>${resumen.length ? resumen.join(" · ") : "sin urgencias"}</span>
    </div>
    ${grupo("Vencidas", g.vencidas, (t) => {
      const d = Math.abs(diasHasta(t.vence));
      return filaBandeja(t, d === 1 ? "ayer" : "hace " + d + " días", true);
    })}
    ${grupo("Hoy", g.hoy, (t) => filaBandeja(t, "vence hoy", true))}
    ${grupo("Esta semana", g.pronto, (t) => {
      const d = diasHasta(t.vence);
      return filaBandeja(t, d === 1 ? "mañana" : "en " + d + " días", false);
    })}
    ${grupo(
      "En el tablero",
      actividad,
      filaActividad,
      nuevas ? `<span class="bandeja-nuevas">${nuevas} sin ver</span>` : ""
    )}`;
}
