import "./styles.css";
import { supabase, configurado, mensajeError } from "./supabase.js";
import * as store from "./store.js";
import * as push from "./push.js";
import {
  ESTADOS, ETIQ_ESTADO, ETIQ_PRIO,
  tablero, listaTabla, calendario, indicadores,
  personas, etiquetas, porColumna, filtrar, esc, hoyISO,
  agruparPendientes, bandeja,
} from "./views.js";
import {
  selectorTableros, chapaTablero, panelMiembros,
  panelSubtareas, panelComentarios, panelAdjuntos, panelHistorial,
  fraseHistorial, tiempoRelativo,
} from "./detalle.js";

const el = (id) => document.getElementById(id);
const $$ = (s) => document.querySelectorAll(s);

/* ===================== estado de la interfaz ===================== */

let usuario = null;
let tareas = [];
let cargado = false;
let vista = "tablero";
let filtros = { q: "", responsable: "", etiqueta: "", prioridad: "" };
let cursorMes = new Date();
let ordenLista = { campo: "vence", dir: "asc" };
let editandoId = null;
let ficha = "detalles";
let modoAcceso = "entrar";
let promesaInstalacion = null;

/**
 * Lo que las vistas necesitan saber de cada tarea y no está en su fila.
 * Se pasa como parámetro para que views.js no tenga que importar el store.
 */
const meta = {
  avance: (id) => store.avanceSubtareas(id),
  comentarios: (id) => store.cuantosComentarios(id),
  adjuntos: (id) => store.cuantosAdjuntos(id),
};

/* ===================== avisos ===================== */

let temporizadorBrindis;
function brindis(texto, mal) {
  const b = el("brindis");
  b.textContent = texto;
  b.className = "brindis" + (mal ? " mal" : "");
  b.hidden = false;
  clearTimeout(temporizadorBrindis);
  temporizadorBrindis = setTimeout(() => { b.hidden = true; }, 3600);
}

function nube(clase, texto) {
  el("punto").className = "punto" + (clase ? " " + clase : "");
  el("texto-nube").textContent = texto;
}

/** Muestra el mensaje de un resultado { ok, mensaje } del store. */
function reportar(r, exito) {
  if (!r) return false;
  if (!r.ok) { brindis(r.mensaje, true); return false; }
  if (r.encolado) brindis("Guardado en tu dispositivo. Se enviará al recuperar la conexión.");
  else if (exito) brindis(exito);
  return true;
}

/* ===================== arranque ===================== */

async function arrancar() {
  aplicarTemaGuardado();

  if (!configurado) {
    document.body.innerHTML =
      `<div class="portada"><div class="portada-marca">
        <h1>Falta configurar Spidey</h1>
        <p>La app no encuentra las credenciales de Supabase. Copia <code>.env.example</code> como <code>.env</code>, pon ahí la URL y la clave <em>anon</em> de tu proyecto, y vuelve a compilar.</p>
        <p>Si ya la desplegaste, agrega <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> en las variables de entorno del hosting y vuelve a desplegar.</p>
      </div></div>`;
    return;
  }

  const { data } = await supabase.auth.getSession();
  await aplicarSesion(data.session);

  supabase.auth.onAuthStateChange((evento, sesion) => {
    if (evento === "PASSWORD_RECOVERY") {
      const nueva = prompt("Escribe tu nueva contraseña (mínimo 8 caracteres):");
      if (nueva && nueva.length >= 8) {
        supabase.auth.updateUser({ password: nueva }).then(({ error }) =>
          brindis(error ? mensajeError(error) : "Contraseña actualizada.", !!error)
        );
      }
      return;
    }
    aplicarSesion(sesion);
  });
}

async function aplicarSesion(sesion) {
  const nuevo = sesion ? sesion.user : null;
  if (usuario && !nuevo) {
    store.terminarSesionDeDatos();
    tareas = []; cargado = false;
  }
  // Un refresco de token no debe recargar todo el tablero.
  const mismaPersona = usuario && nuevo && usuario.id === nuevo.id;
  usuario = nuevo;

  el("portada").hidden = !!usuario;
  el("app").hidden = !usuario;

  if (!usuario || mismaPersona) return;

  el("menu-correo").textContent = usuario.email || "";
  store.alActualizar((lista) => { tareas = lista; cargado = true; pintar(); });
  store.alCambiarEstado((clase, texto) => nube(clase, texto));
  store.alCambiarListaTableros(pintarTableros);
  store.alCambiarDetalleDe(() => pintarPanelesDetalle());

  nube("", "Conectando…");
  await store.iniciarSesionDeDatos(usuario);
  await store.vaciarSalida();
  await refrescarBotonRecordatorios();
}

/* ===================== pantalla de acceso ===================== */

$$(".pestanas-acceso button").forEach((b) =>
  b.addEventListener("click", () => {
    modoAcceso = b.dataset.modo;
    $$(".pestanas-acceso button").forEach((x) =>
      x.setAttribute("aria-selected", String(x.dataset.modo === modoAcceso))
    );
    el("btn-acceso-texto").textContent = modoAcceso === "crear" ? "Crear cuenta" : "Entrar";
    el("ayuda-clave").hidden = modoAcceso !== "crear";
    el("form-acceso").password.autocomplete =
      modoAcceso === "crear" ? "new-password" : "current-password";
    avisoAcceso("");
  })
);

el("btn-ojo").addEventListener("click", () => {
  const campo = el("acceso-clave");
  const seVe = campo.type === "text";
  campo.type = seVe ? "password" : "text";
  const b = el("btn-ojo");
  b.setAttribute("aria-pressed", String(!seVe));
  b.setAttribute("aria-label", seVe ? "Mostrar la contraseña" : "Ocultar la contraseña");
  campo.focus();
});

function avisoAcceso(texto, bien) {
  const a = el("aviso-acceso");
  a.textContent = texto;
  a.className = "aviso-acceso" + (bien ? " bien" : "");
  a.hidden = !texto;
}

el("form-acceso").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const email = f.email.value.trim();
  const password = f.password.value;
  if (!email || !password) return avisoAcceso("Escribe tu correo y tu contraseña.");
  if (modoAcceso === "crear" && password.length < 8)
    return avisoAcceso("La contraseña debe tener al menos 8 caracteres.");

  el("btn-acceso").disabled = true;
  el("btn-acceso-texto").textContent = "Un momento…";
  avisoAcceso("");

  const { data, error } =
    modoAcceso === "crear"
      ? await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin },
        })
      : await supabase.auth.signInWithPassword({ email, password });

  el("btn-acceso").disabled = false;
  el("btn-acceso-texto").textContent = modoAcceso === "crear" ? "Crear cuenta" : "Entrar";

  if (error) return avisoAcceso(mensajeError(error));
  if (modoAcceso === "crear" && data.user && !data.session)
    return avisoAcceso("Te enviamos un correo para confirmar la cuenta. Ábrelo y vuelve aquí.", true);
});

el("btn-olvide").addEventListener("click", async () => {
  const email = el("form-acceso").email.value.trim();
  if (!email) return avisoAcceso("Escribe primero tu correo y vuelve a tocar el enlace.");
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  avisoAcceso(
    error ? mensajeError(error) : "Te enviamos un enlace para restablecer la contraseña.",
    !error
  );
});

/* ===================== pintado ===================== */

function pintar() {
  ["tablero", "lista", "calendario", "indicadores"].forEach((v) => {
    el("vista-" + v).hidden = v !== vista;
  });
  $$(".pestanas button").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.vista === vista))
  );
  el("btn-limpiar").hidden = !(filtros.q || filtros.responsable || filtros.etiqueta || filtros.prioridad);
  sincronizarSelects();

  if (vista === "tablero") el("vista-tablero").innerHTML = tablero(tareas, filtros, cargado, meta);
  else if (vista === "lista") el("vista-lista").innerHTML = listaTabla(tareas, filtros, ordenLista, meta);
  else if (vista === "calendario") el("vista-calendario").innerHTML = calendario(tareas, filtros, cursorMes);
  else el("vista-indicadores").innerHTML = indicadores(tareas, filtros);

  pintarBandeja();
  pintarSaludo();

  // Las subtareas viven en la misma lista que refresca el tablero, así que
  // su panel tiene que repintarse aquí y no solo al cargar el detalle.
  if (!el("telon").hidden && editandoId) pintarPanelSubtareas();
}

/* La campanita se recalcula en cada pintado: siempre refleja el estado real,
   no un contador de "no leídas" que podría mentir.

   Es el único sitio donde viven las notificaciones. Junta dos cosas: lo que
   se te vence (sale de tus tareas) y lo que hicieron los demás en el tablero
   (sale de la bitácora). */
function pintarBandeja() {
  const g = agruparPendientes(tareas);

  // La bitácora guarda datos crudos; aquí se convierten en frases. Se hace
  // en main y no en views para que views.js no tenga que importar detalle.js
  // —que a su vez importa views.js— y quedar los dos abrazados.
  const actividad = store.listaActividad().map((f) => ({
    id: f.id,
    tareaId: f.tarea_id,
    html: `<b>${esc(store.nombreDe(f.actor))}</b> ${fraseHistorial(f, false)}`,
    cuando: tiempoRelativo(f.creado),
    nueva: store.esNueva(f),
  }));

  const total = g.total + store.actividadSinVer();
  const cuenta = el("bandeja-cuenta");
  cuenta.textContent = total > 9 ? "9+" : String(total);
  cuenta.hidden = total === 0;
  el("btn-bandeja").classList.toggle("con-pendientes", total > 0);
  el("bandeja-panel").innerHTML = bandeja(g, actividad);
}

/* ===================== saludo de bienvenida ===================== */

/**
 * Saludo al entrar, pensado para el celular: ahí la pantalla arranca en el
 * tablero y no hay espacio para ver de un vistazo cómo viene el día. En el
 * escritorio se oculta por CSS, porque allí esa información ya está a la vista.
 *
 * Se muestra una vez al día por dispositivo, no en cada recarga: un saludo
 * que aparece cada vez que tocas "actualizar" deja de ser un saludo.
 */
function saludoDelDia() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

function pintarSaludo() {
  const caja = el("saludo");
  if (!store.tocaSaludar()) { caja.hidden = true; return; }

  const nombre = store.miNombre();
  const g = agruparPendientes(tareas);
  const activas = tareas.filter((t) => t.estado !== "hecho").length;
  const novedades = store.actividadSinVer();

  el("saludo-hola").textContent = saludoDelDia() + (nombre ? ", " + nombre : "") + ".";

  let resumen;
  if (!tareas.length) resumen = "Este tablero está vacío. Crea tu primera tarea cuando quieras.";
  else if (g.vencidas.length) resumen = "Hay cosas atrasadas: empieza por ahí.";
  else if (g.hoy.length) resumen = "Esto es lo que vence hoy.";
  else if (activas) resumen = "Nada vence hoy. Buen momento para adelantar.";
  else resumen = "Todo cerrado. Disfruta el día.";
  el("saludo-resumen").textContent = resumen;

  // Solo se muestran las cifras que no son cero: un tablero al día no
  // necesita cuatro ceros en pantalla para decir que está al día.
  const cifras = [
    { n: g.vencidas.length, et: g.vencidas.length === 1 ? "vencida" : "vencidas", aviso: true },
    { n: g.hoy.length, et: "para hoy" },
    { n: activas, et: activas === 1 ? "activa" : "activas" },
    { n: novedades, et: novedades === 1 ? "novedad" : "novedades" },
  ].filter((c) => c.n > 0);

  el("saludo-cifras").innerHTML = cifras
    .map((c) => `<span class="saludo-cifra${c.aviso ? " aviso" : ""}"><b>${c.n}</b> ${c.et}</span>`)
    .join("");

  caja.hidden = false;
}

el("btn-cerrar-saludo").addEventListener("click", () => {
  store.saludoMostrado();
  el("saludo").hidden = true;
});

function sincronizarSelects() {
  llenar("f-responsable", personas(tareas), filtros.responsable, "Todos los responsables");
  llenar("f-etiqueta", etiquetas(tareas), filtros.etiqueta, "Todas las etiquetas");
  el("lista-personas").innerHTML = personas(tareas).map((p) => `<option value="${esc(p)}">`).join("");
  el("lista-etiquetas").innerHTML = etiquetas(tareas).map((p) => `<option value="${esc(p)}">`).join("");
}

function llenar(id, items, valor, textoVacio) {
  const s = el(id);
  s.innerHTML =
    `<option value="">${textoVacio}</option>` +
    items.map((i) => `<option value="${esc(i)}"${i === valor ? " selected" : ""}>${esc(i)}</option>`).join("");
  s.value = items.includes(valor) ? valor : "";
}

/* ===================== tableros ===================== */

function pintarTableros(tableros, activoId) {
  const activo = tableros.find((t) => t.id === activoId) || null;

  el("tb-chapa").innerHTML = chapaTablero(activo);
  el("tb-panel").innerHTML = selectorTableros(tableros, activoId);

  const propietario = activo && activo.rol === "propietario";
  const puedeEditar = store.puedoEditar();

  el("mi-editar-tablero").hidden = !propietario;
  el("mi-borrar-tablero").hidden = !propietario;
  el("mi-salir-tablero").hidden = !!propietario || !activo;
  el("btn-nueva").hidden = !puedeEditar;
  el("aviso-lectura").hidden = puedeEditar || !activo;

  // Destino para "mover a otro tablero": solo donde se pueda escribir.
  const otros = tableros.filter((t) => t.id !== activoId && t.rol !== "lector");
  el("campo-mover").hidden = !otros.length || !editandoId || !puedeEditar;
  el("mover-tablero").innerHTML =
    `<option value="">Dejarla en este tablero</option>` +
    otros.map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join("");
}

/* ===================== ficha de tarea ===================== */

function abrir(id, estadoPorDefecto) {
  const f = el("form");
  const t = tareas.find((x) => x.id === id) || null;
  const puedeEditar = store.puedoEditar();

  if (!t && !puedeEditar) return brindis("Solo puedes mirar este tablero.", true);

  editandoId = t ? id : null;
  ficha = "detalles";

  el("form-titulo").textContent = t ? (puedeEditar ? "Editar tarea" : "Ver tarea") : "Nueva tarea";
  el("btn-borrar").hidden = !t || !puedeEditar;
  el("btn-guardar").hidden = !puedeEditar;

  f.titulo.value = t ? t.titulo : "";
  f.notas.value = t ? t.notas || "" : "";
  f.estado.value = t ? t.estado : estadoPorDefecto || "por_hacer";
  f.prioridad.value = t ? t.prioridad : "media";
  f.responsable.value = t ? t.responsable || "" : "";
  f.vence.value = t ? t.vence || "" : "";
  f.etiquetas.value = t ? (t.etiquetas || []).join(", ") : "";

  // En modo lectura los campos se ven, pero no se tocan.
  [f.titulo, f.notas, f.estado, f.prioridad, f.responsable, f.vence, f.etiquetas].forEach((c) => {
    c.disabled = !puedeEditar;
  });

  el("fichas-tarea").hidden = !t;
  pintarTableros(store.listaTableros(), store.tableroActual() ? store.tableroActual().id : null);
  pintarFichas();

  el("telon").hidden = false;
  setTimeout(() => { if (puedeEditar) f.titulo.focus(); }, 30);

  if (t) {
    pintarPanelSubtareas();
    store.cargarDetalle(t.id);
  } else {
    store.cerrarDetalle();
  }
}

function cerrar() {
  el("telon").hidden = true;
  editandoId = null;
  store.cerrarDetalle();
}

function pintarFichas() {
  $$("#fichas-tarea button").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.ficha === ficha))
  );
  $$(".hoja-form .ficha").forEach((s) => { s.hidden = s.dataset.ficha !== ficha; });
}

function pintarPanelSubtareas() {
  if (!editandoId) return;
  el("panel-subtareas").innerHTML = panelSubtareas(
    store.subtareasDe(editandoId),
    store.puedoEditar()
  );
}

function pintarPanelesDetalle() {
  if (!editandoId) return;
  const d = store.detalleActual();
  const nombreDe = (id) => store.nombreDe(id);

  el("panel-comentarios").innerHTML = panelComentarios(d, nombreDe, usuario ? usuario.id : null, true);
  el("panel-adjuntos").innerHTML = panelAdjuntos(d, nombreDe, store.puedoEditar());
  el("panel-historial").innerHTML = panelHistorial(
    d.historial,
    nombreDe,
    { cargando: d.cargando, sinConexion: d.sinConexion },
    usuario ? usuario.id : null
  );
}

el("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const prev = tareas.find((t) => t.id === editandoId);
  const destino = el("mover-tablero").value;

  const tarea = {
    id: editandoId || crypto.randomUUID(),
    titulo: f.titulo.value.trim() || "Tarea sin título",
    notas: f.notas.value.trim(),
    estado: f.estado.value,
    prioridad: f.prioridad.value,
    responsable: f.responsable.value.trim(),
    vence: f.vence.value,
    etiquetas: f.etiquetas.value.split(",").map((s) => s.trim()).filter(Boolean),
    posicion: prev ? prev.posicion : Date.now(),
    creada: prev ? prev.creada : new Date().toISOString(),
    completada: prev ? prev.completada : null,
  };

  const id = tarea.id;
  cerrar();

  const r = await store.guardar(tarea);
  if (!reportar(r)) return;

  // El cambio de tablero se hace después de guardar el resto, para que la
  // tarea llegue al destino ya con sus datos nuevos.
  if (destino) {
    const m = await store.moverATablero(id, destino);
    if (m.ok) brindis("Movida a «" + m.nombre + "».");
    else brindis(m.mensaje, true);
  }
});

el("btn-cancelar").addEventListener("click", cerrar);
el("btn-cerrar-form").addEventListener("click", cerrar);
el("btn-borrar").addEventListener("click", async () => {
  if (!editandoId) return;
  const t = tareas.find((x) => x.id === editandoId);
  if (!confirm(`¿Eliminar «${t ? t.titulo : "esta tarea"}»? También se borran sus subtareas, comentarios y adjuntos.`)) return;
  const id = editandoId;
  cerrar();
  reportar(await store.eliminar(id));
});
el("telon").addEventListener("mousedown", (e) => { if (e.target === el("telon")) cerrar(); });

/* ===================== hoja genérica ===================== */

function abrirHoja(titulo, html) {
  el("hoja-titulo").textContent = titulo;
  el("hoja-cuerpo").innerHTML = html;
  el("telon-hoja").hidden = false;
}
const cerrarHoja = () => { el("telon-hoja").hidden = true; };

el("btn-cerrar-hoja").addEventListener("click", cerrarHoja);
el("telon-hoja").addEventListener("mousedown", (e) => { if (e.target === el("telon-hoja")) cerrarHoja(); });

function pintarHojaMiembros() {
  abrirHoja(
    "Miembros y permisos",
    panelMiembros(
      store.tableroActual(),
      store.listaMiembros(),
      store.listaInvitaciones(),
      usuario ? usuario.id : null
    )
  );
}

/* ===================== interacción general ===================== */

document.addEventListener("click", async (e) => {
  // --- selector de tableros ---
  const chapa = e.target.closest("#btn-tablero");
  if (chapa) {
    const abrirAhora = el("tb-panel").hidden;
    el("tb-panel").hidden = !abrirAhora;
    chapa.setAttribute("aria-expanded", String(abrirAhora));
    el("menu-lista").hidden = true;
    el("bandeja-panel").hidden = true;
    return;
  }
  const elegido = e.target.closest("[data-tablero]");
  if (elegido) {
    el("tb-panel").hidden = true;
    cerrar();
    await store.elegirTablero(elegido.dataset.tablero);
    return;
  }
  if (!e.target.closest(".tb")) el("tb-panel").hidden = true;

  // --- campanita ---
  const campana = e.target.closest("#btn-bandeja");
  if (campana) {
    const abrirAhora = el("bandeja-panel").hidden;
    el("bandeja-panel").hidden = !abrirAhora;
    campana.setAttribute("aria-expanded", String(abrirAhora));
    el("menu-lista").hidden = true;
    // Se marca al abrir, no al pintar: si se marcara al pintar, el contador
    // se borraría solo antes de que nadie lo hubiera mirado. El panel ya
    // abierto conserva el resaltado de "nuevo" hasta el siguiente pintado.
    if (abrirAhora) store.marcarActividadVista();
    return;
  }
  if (!e.target.closest(".bandeja")) el("bandeja-panel").hidden = true;

  // --- menú de cuenta ---
  const menu = e.target.closest("#btn-menu");
  if (menu) {
    const abiertoAhora = el("menu-lista").hidden;
    el("menu-lista").hidden = !abiertoAhora;
    menu.setAttribute("aria-expanded", String(abiertoAhora));
    return;
  }
  if (!e.target.closest(".menu")) el("menu-lista").hidden = true;

  const accion = e.target.closest("[data-accion]");
  if (accion) { el("menu-lista").hidden = true; el("tb-panel").hidden = true; await ejecutarAccion(accion.dataset.accion); return; }

  // --- fichas de la tarea ---
  const fh = e.target.closest("[data-ficha]");
  if (fh && fh.tagName === "BUTTON") { ficha = fh.dataset.ficha; pintarFichas(); return; }

  // --- subtareas, comentarios, adjuntos ---
  const bs = e.target.closest("[data-borrar-subtarea]");
  if (bs) { reportar(await store.eliminarSubtarea(bs.dataset.borrarSubtarea)); return; }

  const bc = e.target.closest("[data-borrar-comentario]");
  if (bc) {
    if (!confirm("¿Eliminar este comentario?")) return;
    reportar(await store.eliminarComentario(bc.dataset.borrarComentario, editandoId));
    return;
  }

  const aa = e.target.closest("[data-abrir-adjunto]");
  if (aa) {
    const r = await store.urlAdjunto(aa.dataset.abrirAdjunto);
    if (!r.ok) return brindis(r.mensaje, true);
    window.open(r.url, "_blank", "noopener");
    return;
  }

  const ba = e.target.closest("[data-borrar-adjunto]");
  if (ba) {
    if (!confirm("¿Eliminar este archivo? No se puede deshacer.")) return;
    reportar(await store.eliminarAdjunto(ba.dataset.borrarAdjunto, ba.dataset.ruta, editandoId));
    return;
  }

  // --- miembros ---
  const qm = e.target.closest("[data-quitar-miembro]");
  if (qm) {
    if (!confirm("¿Quitar a esta persona del tablero? Dejará de ver las tareas.")) return;
    if (reportar(await store.quitarMiembro(qm.dataset.quitarMiembro), "Listo.")) pintarHojaMiembros();
    return;
  }

  const ci = e.target.closest("[data-cancelar-invitacion]");
  if (ci) {
    if (reportar(await store.cancelarInvitacion(ci.dataset.cancelarInvitacion), "Invitación cancelada.")) pintarHojaMiembros();
    return;
  }

  // --- vistas y tareas ---
  const v = e.target.closest("[data-vista]");
  if (v) { vista = v.dataset.vista; pintar(); return; }

  const nueva = e.target.closest("[data-nueva]");
  if (nueva) { abrir(null, nueva.dataset.estado); return; }

  const ed = e.target.closest("[data-editar]");
  if (ed) { el("bandeja-panel").hidden = true; abrir(ed.dataset.editar); return; }

  const mv = e.target.closest("[data-mover]");
  if (mv) { moverRelativo(mv.dataset.id, parseInt(mv.dataset.mover, 10)); return; }

  const th = e.target.closest("th[data-orden]");
  if (th) {
    const c = th.dataset.orden;
    if (ordenLista.campo === c) ordenLista.dir = ordenLista.dir === "asc" ? "desc" : "asc";
    else ordenLista = { campo: c, dir: "asc" };
    pintar(); return;
  }

  const ms = e.target.closest("[data-mes]");
  if (ms) {
    const n = parseInt(ms.dataset.mes, 10);
    cursorMes = n === 0 ? new Date() : new Date(cursorMes.getFullYear(), cursorMes.getMonth() + n, 1);
    pintar(); return;
  }

  const tj = e.target.closest(".tarjeta");
  if (tj && !e.target.closest("button")) abrir(tj.dataset.id);
});

/* Formularios inyectados: viven dentro de HTML que se repinta, así que no
   se les puede colgar un listener propio. Se atienden por delegación. */
document.addEventListener("submit", async (e) => {
  const f = e.target;

  if (f.id === "form-subtarea") {
    e.preventDefault();
    const texto = f.texto.value;
    f.texto.value = "";
    const r = await store.agregarSubtarea(editandoId, texto);
    if (!r.ok) brindis(r.mensaje, true);
    // El repintado borra el campo y su foco: hay que devolverlo para poder
    // escribir varios pasos seguidos sin tocar el ratón.
    const campo = document.querySelector("#form-subtarea [name=texto]");
    if (campo) campo.focus();
    return;
  }

  if (f.id === "form-comentario") {
    e.preventDefault();
    const texto = f.texto.value;
    const boton = f.querySelector("button");
    boton.disabled = true;
    const r = await store.comentar(editandoId, texto);
    boton.disabled = false;
    if (!r.ok) brindis(r.mensaje, true);
    return;
  }

  if (f.id === "form-invitar") {
    e.preventDefault();
    const boton = f.querySelector("button");
    boton.disabled = true;
    const r = await store.invitar(f.email.value, f.rol.value);
    boton.disabled = false;
    if (!r.ok) return brindis(r.mensaje, true);
    brindis(
      r.resultado === "pendiente"
        ? "Invitación guardada. Se aplicará cuando esa persona cree su cuenta."
        : r.resultado === "ya_estaba"
        ? "Esa persona ya estaba en el tablero."
        : "Listo, ya tiene acceso al tablero."
    );
    pintarHojaMiembros();
    return;
  }

  if (f.id === "form-tablero") {
    e.preventDefault();
    const boton = f.querySelector("button[type=submit]");
    boton.disabled = true;
    const r = f.dataset.editar
      ? await store.renombrarTablero(f.dataset.editar, f.nombre.value, f.color.value)
      : await store.crearTablero(f.nombre.value, f.color.value);
    boton.disabled = false;
    if (!r.ok) return brindis(r.mensaje, true);
    cerrarHoja();
    brindis(f.dataset.editar ? "Tablero actualizado." : "Tablero creado.");
    return;
  }
});

/* Casillas de subtarea y selectores de rol: cambian, no se "clican". */
document.addEventListener("change", async (e) => {
  const cb = e.target.closest("[data-subtarea]");
  if (cb) {
    const r = await store.alternarSubtarea(cb.dataset.subtarea);
    if (!r.ok) brindis(r.mensaje, true);
    return;
  }

  const rol = e.target.closest("[data-rol-de]");
  if (rol) {
    if (reportar(await store.cambiarRol(rol.dataset.rolDe, rol.value), "Permiso actualizado.")) pintarHojaMiembros();
    return;
  }

  const archivo = e.target.closest("#archivo-adjunto");
  if (archivo && archivo.files && archivo.files[0]) {
    const f = archivo.files[0];
    archivo.value = "";
    brindis("Subiendo «" + f.name + "»…");
    reportar(await store.subirAdjunto(editandoId, f), "Archivo adjuntado.");
    return;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!el("tb-panel").hidden) { el("tb-panel").hidden = true; return; }
    if (!el("bandeja-panel").hidden) { el("bandeja-panel").hidden = true; return; }
    if (!el("telon-hoja").hidden) { cerrarHoja(); return; }
    if (!el("telon").hidden) { cerrar(); return; }
  }
  if (e.key === "Enter" && e.target.classList && e.target.classList.contains("tarjeta")) {
    e.preventDefault(); abrir(e.target.dataset.id);
  }
  if (e.key === "n" && !e.metaKey && !e.ctrlKey && usuario &&
      el("telon").hidden && el("telon-hoja").hidden &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    e.preventDefault(); abrir();
  }
});

async function moverRelativo(id, paso) {
  const t = tareas.find((x) => x.id === id);
  if (!t) return;
  const i = ESTADOS.findIndex((e) => e.id === t.estado) + paso;
  if (i < 0 || i >= ESTADOS.length) return;
  await cambiarEstado(t, ESTADOS[i].id, Date.now());
}

async function cambiarEstado(t, estado, posicion) {
  const copia = { ...t, estado, posicion };
  copia.completada = estado === "hecho" ? t.completada || new Date().toISOString() : null;
  reportar(await store.guardar(copia));
}

/* ---------- arrastrar y soltar ---------- */

let arrastrado = null;
document.addEventListener("dragstart", (e) => {
  const c = e.target.closest(".tarjeta");
  if (!c || !store.puedoEditar()) return;
  arrastrado = c.dataset.id;
  c.classList.add("arrastrando");
  e.dataTransfer.effectAllowed = "move";
  try { e.dataTransfer.setData("text/plain", arrastrado); } catch { /* Safari */ }
});
document.addEventListener("dragend", (e) => {
  const c = e.target.closest(".tarjeta");
  if (c) c.classList.remove("arrastrando");
  $$(".columna.recibe").forEach((x) => x.classList.remove("recibe"));
  arrastrado = null;
});
document.addEventListener("dragover", (e) => {
  const col = e.target.closest(".columna");
  if (!col || !arrastrado) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  $$(".columna.recibe").forEach((x) => { if (x !== col) x.classList.remove("recibe"); });
  col.classList.add("recibe");
});
document.addEventListener("drop", async (e) => {
  const col = e.target.closest(".columna");
  if (!col || !arrastrado) return;
  e.preventDefault();
  col.classList.remove("recibe");
  const t = tareas.find((x) => x.id === arrastrado);
  arrastrado = null;
  if (!t) return;

  const destino = col.dataset.estado;
  const vecina = e.target.closest(".tarjeta");
  let posicion = Date.now();
  if (vecina && vecina.dataset.id !== t.id) {
    const col2 = porColumna(destino, tareas);
    const j = col2.findIndex((x) => x.id === vecina.dataset.id);
    if (j >= 0) {
      const antes = j > 0 ? col2[j - 1].posicion : col2[j].posicion - 2000;
      posicion = (antes + col2[j].posicion) / 2;
    }
  }
  if (t.estado === destino && !vecina) return;
  await cambiarEstado(t, destino, posicion);
});

/* ---------- filtros ---------- */

el("buscar").addEventListener("input", (e) => { filtros.q = e.target.value; pintar(); });
el("f-responsable").addEventListener("change", (e) => { filtros.responsable = e.target.value; pintar(); });
el("f-etiqueta").addEventListener("change", (e) => { filtros.etiqueta = e.target.value; pintar(); });
el("f-prioridad").addEventListener("change", (e) => { filtros.prioridad = e.target.value; pintar(); });
el("btn-limpiar").addEventListener("click", () => {
  filtros = { q: "", responsable: "", etiqueta: "", prioridad: "" };
  el("buscar").value = ""; pintar();
});
el("btn-nueva").addEventListener("click", () => abrir());

/* ---------- tema ---------- */

function aplicarTemaGuardado() {
  // Spidey nace oscuro: se deja el atributo puesto siempre para que el
  // botón de tema alterne de forma predecible, venga de donde venga.
  let guardado = null;
  try { guardado = localStorage.getItem("spidey:tema"); } catch { /* sin almacenamiento */ }
  document.documentElement.setAttribute("data-theme", guardado === "light" ? "light" : "dark");
}
el("btn-tema").addEventListener("click", () => {
  const r = document.documentElement;
  const siguiente = r.getAttribute("data-theme") === "light" ? "dark" : "light";
  r.setAttribute("data-theme", siguiente);
  try { localStorage.setItem("spidey:tema", siguiente); } catch { /* ignorado */ }
});

/* ===================== recordatorios ===================== */

async function refrescarBotonRecordatorios() {
  const b = el("mi-recordatorios");
  if (!push.soportado()) { b.textContent = "Recordatorios (no disponibles)"; return; }
  b.textContent = (await push.activos()) ? "Recordatorios: activados" : "Recordatorios: desactivados";
}

async function hojaRecordatorios() {
  const disponible = push.soportado();
  const motivo = push.motivoNoDisponible();
  const encendidos = disponible && (await push.activos());

  abrirHoja(
    "Recordatorios",
    `<p class="hoja-texto">Una vez al día, Spidey te avisa de lo que vence hoy y de lo que ya venció en todos tus tableros. El aviso llega aunque la app esté cerrada.</p>
     ${motivo ? `<p class="aviso-acceso">${esc(motivo)}</p>` : ""}
     <p class="hoja-texto"><b>Estado en este dispositivo:</b> ${encendidos ? "activados" : "desactivados"}.</p>
     <div class="hoja-botones">
       ${
         disponible && !motivo
           ? encendidos
             ? `<button type="button" class="btn" data-accion="push-probar">Enviar prueba</button>
                <button type="button" class="btn btn-borrar" data-accion="push-off">Desactivar</button>`
             : `<button type="button" class="btn btn-p" data-accion="push-on">Activar en este dispositivo</button>`
           : ""
       }
     </div>
     <p class="ayuda">Se configura por dispositivo: activarlos en el celular no los activa en el computador. En iPhone solo funcionan con la app instalada en la pantalla de inicio.</p>`
  );
}

/* ===================== acciones del menú ===================== */

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement("a");
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function ejecutarAccion(accion) {
  const activo = store.tableroActual();

  switch (accion) {
    case "salir":
      supabase.auth.signOut();
      return;

    /* ---------- tableros ---------- */
    case "nuevo-tablero":
      abrirHoja("Nuevo tablero", formularioTablero());
      return;

    case "editar-tablero":
      if (!activo) return;
      abrirHoja("Renombrar tablero", formularioTablero(activo));
      return;

    case "borrar-tablero": {
      if (!activo) return;
      const n = tareas.length;
      if (!confirm(
        `¿Eliminar «${activo.nombre}»?\n\nSe borran sus ${n} tarea(s) con sus subtareas, comentarios y adjuntos, y todos los miembros pierden el acceso. No se puede deshacer.`
      )) return;
      if (prompt(`Para confirmar, escribe el nombre del tablero:`) !== activo.nombre)
        return brindis("El nombre no coincide. No se eliminó nada.");
      cerrar();
      reportar(await store.eliminarTablero(activo.id), "Tablero eliminado.");
      return;
    }

    case "salir-tablero": {
      if (!activo) return;
      if (!confirm(`¿Salirte de «${activo.nombre}»? Dejarás de ver sus tareas. El propietario tendría que volver a invitarte.`)) return;
      cerrar();
      reportar(await store.salirDelTablero(activo.id), "Saliste del tablero.");
      return;
    }

    case "miembros":
      await store.cargarMiembros();
      pintarHojaMiembros();
      return;

    case "historial-tablero": {
      abrirHoja("Historial del tablero", `<p class="panel-vacio">Cargando…</p>`);
      const filas = await store.historialDelTablero();
      el("hoja-cuerpo").innerHTML = panelHistorial(
        filas,
        (id) => store.nombreDe(id),
        { sinConexion: !navigator.onLine },
        usuario ? usuario.id : null
      );
      return;
    }

    /* ---------- mi nombre ---------- */
    case "mi-nombre": {
      // Antes de los tableros compartidos esto no hacía falta. Ahora tu
      // nombre aparece en los comentarios y en el historial de otras
      // personas, así que conviene que no sea la parte izquierda del correo.
      const actual = store.miPerfilActual();
      const nombre = prompt(
        "¿Con qué nombre quieres aparecer?\n\nSe usa para saludarte y es el que ven tus compañeros en comentarios e historial.",
        (actual && actual.nombre) || store.miNombre()
      );
      if (nombre === null) return;
      if (reportar(await store.cambiarMiNombre(nombre), "Listo, así te verán.")) pintar();
      return;
    }

    /* ---------- recordatorios ---------- */
    case "recordatorios":
      await hojaRecordatorios();
      return;

    case "push-on": {
      const r = await push.activar(usuario);
      brindis(r.mensaje, !r.ok);
      await refrescarBotonRecordatorios();
      await hojaRecordatorios();
      return;
    }

    case "push-off": {
      const r = await push.desactivar();
      brindis(r.mensaje || "Listo.", !r.ok);
      await refrescarBotonRecordatorios();
      await hojaRecordatorios();
      return;
    }

    case "push-probar": {
      const r = await push.probar();
      if (!r.ok) brindis(r.mensaje, true);
      return;
    }

    /* ---------- adjuntos ---------- */
    case "elegir-archivo":
      el("archivo-adjunto").click();
      return;

    /* ---------- cuenta ---------- */
    case "eliminar-cuenta": {
      if (!confirm(
        "¿Eliminar tu cuenta?\n\nSe borran tus tableros propios con todas sus tareas, y sales de los tableros ajenos. No se puede deshacer.\n\nDescarga antes tu respaldo si quieres conservar algo."
      )) return;
      if (prompt("Para confirmar, escribe: ELIMINAR") !== "ELIMINAR")
        return brindis("No se eliminó nada.");
      const { error } = await supabase.rpc("eliminar_mi_cuenta");
      if (error) return brindis(mensajeError(error), true);
      await supabase.auth.signOut();
      brindis("Tu cuenta fue eliminada.");
      return;
    }

    /* ---------- exportar ---------- */
    case "json": {
      const datos = {
        exportado: new Date().toISOString(),
        tablero: activo ? { nombre: activo.nombre, color: activo.color } : null,
        tareas: tareas.map((t) => ({
          ...t,
          subtareas: store.subtareasDe(t.id).map((s) => ({ texto: s.texto, hecha: s.hecha })),
        })),
      };
      descargar(
        "spidey-respaldo-" + hoyISO() + ".json",
        JSON.stringify(datos, null, 2),
        "application/json"
      );
      brindis("Respaldo descargado.");
      return;
    }

    case "csv": {
      const comilla = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      const filas = [
        ["Tarea", "Estado", "Prioridad", "Responsable", "Fecha límite", "Etiquetas", "Subtareas", "Comentarios", "Adjuntos", "Notas"]
          .map(comilla).join(","),
      ];
      filtrar(tareas, filtros).forEach((t) => {
        const a = store.avanceSubtareas(t.id);
        filas.push([
          comilla(t.titulo), comilla(ETIQ_ESTADO[t.estado]), comilla(ETIQ_PRIO[t.prioridad]),
          comilla(t.responsable), comilla(t.vence), comilla((t.etiquetas || []).join(" | ")),
          comilla(a ? a.hechas + "/" + a.total : ""),
          comilla(store.cuantosComentarios(t.id) || ""),
          comilla(store.cuantosAdjuntos(t.id) || ""),
          comilla(t.notas),
        ].join(","));
      });
      // BOM inicial para que Excel abra bien los acentos.
      descargar("spidey-" + hoyISO() + ".csv", "﻿" + filas.join("\r\n"), "text/csv;charset=utf-8");
      brindis("CSV descargado.");
      return;
    }
  }
}

/** Formulario compartido por "nuevo tablero" y "renombrar tablero". */
function formularioTablero(tableroExistente) {
  const t = tableroExistente || { nombre: "", color: "#D30000" };
  const colores = ["#D30000", "#E8B14C", "#5FD08A", "#4C7BD9", "#9B59B6", "#8F8F8F"];
  return `<form id="form-tablero"${tableroExistente ? ` data-editar="${tableroExistente.id}"` : ""}>
    <label>Nombre
      <input class="campo" name="nombre" maxlength="60" required placeholder="Ej. Lanzamiento de marzo" value="${esc(t.nombre)}">
    </label>
    <fieldset class="colores">
      <legend>Color</legend>
      ${colores.map((c, i) => `<label class="color-op">
        <input type="radio" name="color" value="${c}" ${c === t.color || (i === 0 && !colores.includes(t.color)) ? "checked" : ""}>
        <span style="background:${c}"></span>
      </label>`).join("")}
    </fieldset>
    <div class="hoja-botones">
      <button type="submit" class="btn btn-p">${tableroExistente ? "Guardar" : "Crear tablero"}</button>
    </div>
  </form>`;
}

/* ---------- instalación de la PWA ---------- */

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  promesaInstalacion = e;
  el("btn-instalar").hidden = false;
});
el("btn-instalar").addEventListener("click", async () => {
  if (!promesaInstalacion) return;
  promesaInstalacion.prompt();
  await promesaInstalacion.userChoice;
  promesaInstalacion = null;
  el("btn-instalar").hidden = true;
});
window.addEventListener("appinstalled", () => {
  el("btn-instalar").hidden = true;
  brindis("Spidey quedó instalada en tu dispositivo.");
});

/* ---------- arranque ---------- */

el("portada").hidden = false;
arrancar();
