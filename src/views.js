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

export function tablero(tareas, filtros, cargado) {
  const base = filtrar(tareas, filtros);
  if (!cargado) return vacio("Cargando tu tablero…", "Un momento mientras traemos las tareas guardadas.", false);
  if (!tareas.length)
    return vacio("Tu tablero está vacío", "Crea la primera tarea y arrástrala entre columnas a medida que avanza.", true);

  return `<div class="tablero">${ESTADOS.map((e) => {
    const col = porColumna(e.id, base);
    return `<div class="columna" data-estado="${e.id}">
      <div class="col-cab"><span class="raya ${e.id}"></span><h2>${e.label}</h2><span class="cuenta">${col.length}</span></div>
      <div class="lista-col" data-drop="${e.id}">${col.map(tarjeta).join("")}</div>
      <button class="agregar-col" data-nueva data-estado="${e.id}">+ Añadir aquí</button>
    </div>`;
  }).join("")}</div>`;
}

function tarjeta(t) {
  const i = ESTADOS.findIndex((e) => e.id === t.estado);
  const d = diasHasta(t.vence);
  const esVenc = vencida(t);
  const textoFecha = t.vence
    ? esVenc
      ? "Venció " + fechaCorta(t.vence)
      : d === 0
      ? "Vence hoy"
      : d === 1
      ? "Vence mañana"
      : "Vence " + fechaCorta(t.vence)
    : "";

  return `<article class="tarjeta${esVenc ? " urgente" : ""}${t.estado === "hecho" ? " lista-hecho" : ""}" draggable="true" data-id="${t.id}" tabindex="0">
    <div class="t-titulo">${esc(t.titulo)}</div>
    <div class="t-meta">
      <span class="chip ${t.prioridad}">${ETIQ_PRIO[t.prioridad]}</span>
      ${t.vence ? `<span class="chip fecha${esVenc ? " vencida" : ""}">${textoFecha}</span>` : ""}
      ${(t.etiquetas || []).slice(0, 3).map((e) => `<span class="chip etiqueta">${esc(e)}</span>`).join("")}
    </div>
    <div class="t-pie">
      <span class="quien">${
        t.responsable
          ? `<span class="avatar" style="background:${colorPersona(t.responsable)}">${esc(iniciales(t.responsable))}</span><span>${esc(t.responsable)}</span>`
          : '<span style="color:var(--tinta-3);font-size:12px">Sin responsable</span>'
      }</span>
      <button class="mover" data-mover="-1" data-id="${t.id}" ${i <= 0 ? "disabled" : ""} aria-label="Mover a la columna anterior">‹</button>
      <button class="mover" data-mover="1" data-id="${t.id}" ${i >= ESTADOS.length - 1 ? "disabled" : ""} aria-label="Mover a la columna siguiente">›</button>
    </div></article>`;
}

/* ---------------- lista ---------------- */

export function listaTabla(tareas, filtros, orden) {
  const base = [...filtrar(tareas, filtros)];
  if (!base.length)
    return vacio("Nada por aquí", "Ninguna tarea coincide con los filtros activos.", !tareas.length);

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

  const flecha = (k) => (orden.campo === k ? (orden.dir === "asc" ? " ↑" : " ↓") : "");
  const guion = '<span style="color:var(--tinta-3)">—</span>';

  return `<div class="envoltura-tabla"><table><thead><tr>
    <th data-orden="titulo">Tarea${flecha("titulo")}</th>
    <th data-orden="estado">Estado${flecha("estado")}</th>
    <th data-orden="prioridad">Prioridad${flecha("prioridad")}</th>
    <th data-orden="responsable">Responsable${flecha("responsable")}</th>
    <th data-orden="vence">Fecha límite${flecha("vence")}</th>
    <th>Etiquetas</th><th></th></tr></thead><tbody>${base
      .map((t) => {
        const v = vencida(t);
        return `<tr><td class="col-titulo">${esc(t.titulo)}</td>
        <td><span class="marca-estado"><span class="raya ${t.estado}"></span>${ETIQ_ESTADO[t.estado]}</span></td>
        <td><span class="chip ${t.prioridad}">${ETIQ_PRIO[t.prioridad]}</span></td>
        <td>${t.responsable ? `<span class="quien"><span class="avatar" style="background:${colorPersona(t.responsable)}">${esc(iniciales(t.responsable))}</span><span>${esc(t.responsable)}</span></span>` : guion}</td>
        <td>${t.vence ? `<span class="chip fecha${v ? " vencida" : ""}">${fechaCorta(t.vence)}</span>` : guion}</td>
        <td>${(t.etiquetas || []).map((e) => `<span class="chip etiqueta">${esc(e)}</span>`).join(" ") || guion}</td>
        <td><button class="editar" data-editar="${t.id}">Editar</button></td></tr>`;
      })
      .join("")}</tbody></table></div>`;
}

/* ---------------- calendario ---------------- */

export function calendario(tareas, filtros, cursor) {
  const base = filtrar(tareas, filtros);
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const inicio = (new Date(y, m, 1).getDay() + 6) % 7;
  const dias = new Date(y, m + 1, 0).getDate();
  const prevDias = new Date(y, m, 0).getDate();

  const porFecha = {};
  base.forEach((t) => {
    if (t.vence) (porFecha[t.vence] = porFecha[t.vence] || []).push(t);
  });
  const sinFecha = base.filter((t) => !t.vence && t.estado !== "hecho");

  let celdas = "";
  for (let i = 0; i < inicio; i++)
    celdas += `<div class="celda fuera"><span class="num">${prevDias - inicio + i + 1}</span></div>`;
  for (let i = 1; i <= dias; i++) {
    const iso = `${y}-${pad(m + 1)}-${pad(i)}`;
    const del = porFecha[iso] || [];
    celdas += `<div class="celda${iso === hoyISO() ? " hoy" : ""}"><span class="num">${i}</span>${del
      .map((t) => `<button class="mini ${t.prioridad}${t.estado === "hecho" ? " completa" : ""}" data-editar="${t.id}" title="${esc(t.titulo)}">${esc(t.titulo)}</button>`)
      .join("")}</div>`;
  }
  const resto = (7 - ((inicio + dias) % 7)) % 7;
  for (let i = 1; i <= resto; i++)
    celdas += `<div class="celda fuera"><span class="num">${i}</span></div>`;

  return `<div class="cal-cab">
      <button class="btn btn-icono" data-mes="-1" aria-label="Mes anterior">‹</button>
      <h2>${MESES[m]} ${y}</h2>
      <button class="btn btn-icono" data-mes="1" aria-label="Mes siguiente">›</button>
      <button class="btn" data-mes="0">Hoy</button>
    </div>
    <div class="rejilla">${DIAS.map((d) => `<div class="dia-nombre">${d}</div>`).join("")}${celdas}</div>
    ${
      sinFecha.length
        ? `<div class="panel" style="margin-top:14px"><h3>Sin fecha límite</h3>
           <p class="sub">${sinFecha.length} tarea${sinFecha.length === 1 ? "" : "s"} activa${sinFecha.length === 1 ? "" : "s"} que aún no aparecen en el calendario.</p>
           <div class="t-meta">${sinFecha.map((t) => `<button class="mini ${t.prioridad}" data-editar="${t.id}">${esc(t.titulo)}</button>`).join("")}</div></div>`
        : ""
    }`;
}

/* ---------------- indicadores ---------------- */

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

  const carga = personas(base)
    .map((p) => {
      const suyas = activas.filter((t) => t.responsable === p);
      return { nom: p, n: suyas.length, venc: suyas.filter(vencida).length };
    })
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const sinDuenio = activas.filter((t) => !t.responsable).length;
  if (sinDuenio) carga.push({ nom: "Sin asignar", n: sinDuenio, venc: 0 });
  const maxCarga = Math.max(1, ...carga.map((c) => c.n));

  const etq = etiquetas(base)
    .map((e) => ({ nom: e, n: base.filter((t) => (t.etiquetas || []).includes(e)).length }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 7);
  const maxEtq = Math.max(1, ...etq.map((e) => e.n));

  const proximas = activas.filter((t) => t.vence).sort((a, b) => (a.vence < b.vence ? -1 : 1)).slice(0, 6);

  const kpi = (n, et, nota, aviso) =>
    `<div class="kpi${aviso ? " aviso" : ""}"><span class="n">${n}</span><span class="et">${et}</span><span class="nota">${esc(nota)}</span></div>`;

  return `<div class="kpis">
    ${kpi(activas.length, "Tareas activas", `${hechas.length} completadas de ${base.length}`)}
    ${kpi(venc.length, "Vencidas", venc.length ? "Requieren atención inmediata" : "Todo al día", venc.length > 0)}
    ${kpi(pronto.length, "Vencen en 7 días", pronto.length ? "Próxima: " + fechaCorta(pronto[0].vence) : "Semana despejada")}
    ${kpi(avance + "%", "Avance", `Sobre ${base.length} tarea${base.length === 1 ? "" : "s"} visible${base.length === 1 ? "" : "s"}`)}
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

    <div class="panel"><h3>Carga por responsable</h3><p class="sub">Tareas activas asignadas a cada persona.</p>
      <div class="barras">${carga.map((c) =>
        `<div class="fila-barra"><span class="nom">${esc(c.nom)}</span>
          <span class="pista"><span class="relleno" style="width:${Math.round((c.n / maxCarga) * 100)}%;background:${c.venc ? "var(--alerta)" : "var(--sello)"}"></span></span>
          <span class="val">${c.n}</span></div>`).join("")}</div>
      ${carga.some((c) => c.venc) ? '<div class="leyenda"><span><i style="background:var(--alerta)"></i>Incluye tareas vencidas</span></div>' : ""}
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

/** Panel de la campanita. Recibe el resultado de agruparPendientes. */
export function bandeja(g) {
  if (!g.vencidas.length && !g.hoy.length && !g.pronto.length) {
    return `<div class="bandeja-cab"><b>Notificaciones</b></div>
      <p class="bandeja-vacia">Nada pendiente. Todo al día.</p>`;
  }

  const grupo = (titulo, items, render) =>
    items.length
      ? `<div class="bandeja-grupo"><h4>${titulo}</h4>${items.map(render).join("")}</div>`
      : "";

  return `<div class="bandeja-cab">
      <b>Notificaciones</b>
      <span>${g.total ? g.total + (g.total === 1 ? " pendiente" : " pendientes") : "sin urgencias"}</span>
    </div>
    ${grupo("Vencidas", g.vencidas, (t) => {
      const d = Math.abs(diasHasta(t.vence));
      return filaBandeja(t, d === 1 ? "ayer" : "hace " + d + " días", true);
    })}
    ${grupo("Hoy", g.hoy, (t) => filaBandeja(t, "vence hoy", true))}
    ${grupo("Esta semana", g.pronto, (t) => {
      const d = diasHasta(t.vence);
      return filaBandeja(t, d === 1 ? "mañana" : "en " + d + " días", false);
    })}`;
}
