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
let filtros = { q: "", responsable: "", etiqueta: "", prioridad: "", vencidas: false };
let cursorMes = new Date();
let ordenLista = { campo: "vence", dir: "asc" };
let agrupaLista = leerAjuste("spidey-agrupamiento", "estado");
let modoCalendario = leerAjuste("spidey-calendario", "mes");
let bandejaSoloMias = false;
let busquedaTablero = "";
let fijados = new Set(leerAjuste("spidey-tableros-fijados", "").split(",").filter(Boolean));
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
  // Se lee en cada pintado, no se guarda: el rol puede cambiar mientras
  // tienes la app abierta si alguien te asciende o te quita permisos.
  get puedeEditar() {
    return store.puedoEditar();
  },
};

/* ===================== preferencias de la vista ===================== */

/**
 * Ajustes de interfaz que viven solo en este dispositivo: cómo agrupas la
 * lista, si ves el calendario por mes o por semana. No son datos de la
 * persona, así que no tienen por qué viajar al servidor.
 */
function leerAjuste(clave, porDefecto) {
  try {
    const v = localStorage.getItem(clave);
    return v === null ? porDefecto : v;
  } catch {
    return porDefecto;
  }
}

function guardarAjuste(clave, valor) {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    /* sin almacenamiento: el ajuste dura lo que dure la pestaña */
  }
}

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
      dialogo({
        titulo: "Elige tu nueva contraseña",
        texto: "Al menos 8 caracteres. Mézclala con mayúsculas, números y algún símbolo.",
        ok: "Cambiar contraseña",
        campo: { etiqueta: "Nueva contraseña", tipo: "password", requerido: true, placeholder: "••••••••" },
      }).then(async (nueva) => {
        if (nueva === null) return;
        if (nueva.length < 8) return brindis("La contraseña debe tener al menos 8 caracteres.", true);
        const { error } = await supabase.auth.updateUser({ password: nueva });
        brindis(error ? mensajeError(error) : "Contraseña actualizada.", !!error);
      });
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
    el("clave-fuerza").hidden = modoAcceso !== "crear";
    el("form-acceso").password.autocomplete =
      modoAcceso === "crear" ? "new-password" : "current-password";
    avisoAcceso("");
  })
);

/**
 * Fortaleza de la contraseña, de 0 a 4. No bloquea nada —el mínimo real
 * son 8 caracteres y lo impone el servidor—; solo enseña que una clave
 * más larga y variada es más difícil de adivinar.
 */
function fuerzaClave(v) {
  let p = 0;
  if (v.length >= 8) p++;
  if (v.length >= 12) p++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) p++;
  if (/\d/.test(v) && /[^\w\s]/.test(v)) p++;
  return Math.min(p, 4);
}

el("acceso-clave").addEventListener("input", (e) => {
  el("clave-fuerza").dataset.n = e.target.value ? fuerzaClave(e.target.value) : 0;
});

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
  el("btn-limpiar").hidden = !(filtros.q || filtros.responsable || filtros.etiqueta || filtros.prioridad || filtros.vencidas);
  sincronizarSelects();
  pintarChipsFiltro();
  pintarContadorTareas();

  if (vista === "tablero") el("vista-tablero").innerHTML = tablero(tareas, filtros, cargado, meta);
  else if (vista === "lista") el("vista-lista").innerHTML = listaTabla(tareas, filtros, ordenLista, meta, agrupaLista);
  else if (vista === "calendario") el("vista-calendario").innerHTML = calendario(tareas, filtros, cursorMes, modoCalendario);
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
  // "Mías" se resuelve por el nombre con el que apareces: el responsable
  // de una tarea es texto libre, no una cuenta.
  const yo = store.miNombre().toLowerCase();
  const visibles = bandejaSoloMias
    ? tareas.filter((t) => (t.responsable || "").toLowerCase() === yo)
    : tareas;

  const g = agruparPendientes(visibles);

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

  // El contador de la campana no se filtra: lo que hay pendiente, hay,
  // aunque estés mirando solo lo tuyo.
  const total = agruparPendientes(tareas).total + store.actividadSinVer();
  const cuenta = el("bandeja-cuenta");
  cuenta.textContent = total > 9 ? "9+" : String(total);
  cuenta.hidden = total === 0;
  el("btn-bandeja").classList.toggle("con-pendientes", total > 0);
  el("bandeja-panel").innerHTML = bandeja(g, actividad, {
    soloMias: bandejaSoloMias,
    conFiltro: store.listaMiembros().length > 1,
  });
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

/** Lo que vence de aquí al domingo, y cuánto de eso ya está cerrado. */
function progresoSemanal() {
  const hoy = new Date();
  const finSemana = new Date(hoy);
  finSemana.setDate(hoy.getDate() + (7 - ((hoy.getDay() + 6) % 7) - 1));
  const p = (n) => (n < 10 ? "0" : "") + n;
  const limite =
    finSemana.getFullYear() + "-" + p(finSemana.getMonth() + 1) + "-" + p(finSemana.getDate());

  const deLaSemana = tareas.filter((t) => t.vence && t.vence <= limite);
  const hechas = deLaSemana.filter((t) => t.estado === "hecho").length;
  return { hechas, total: deLaSemana.length };
}

function pintarSaludo() {
  const caja = el("saludo");
  if (!store.tocaSaludar()) { caja.hidden = true; return; }

  const nombre = store.miNombre();
  const g = agruparPendientes(tareas);
  const activas = tareas.filter((t) => t.estado !== "hecho").length;
  const novedades = store.actividadSinVer();

  const hoy = new Date();
  const DIAS_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const MESES_LARGO = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  el("saludo-fecha").textContent =
    `${DIAS_LARGO[hoy.getDay()]} ${hoy.getDate()} de ${MESES_LARGO[hoy.getMonth()]}`;

  el("saludo-hola").textContent = saludoDelDia() + (nombre ? ", " + nombre : "") + ".";

  // Barra de la semana: sólo tiene sentido si hay algo con fecha.
  const sem = progresoSemanal();
  el("saludo-semana").hidden = sem.total === 0;
  if (sem.total) {
    const pct = Math.round((sem.hechas / sem.total) * 100);
    el("saludo-progreso").style.width = pct + "%";
    el("saludo-semana-txt").textContent =
      `${sem.hechas} de ${sem.total} de esta semana` + (pct === 100 ? " · completa" : "");
  }

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

/* ===================== filtros como chips ===================== */

/**
 * Un filtro sin usar se ve como una invitación de borde punteado
 * («+ responsable»); uno aplicado, como un chip pleno con su × para
 * quitarlo. Debajo sigue habiendo un <select> nativo: es lo que mejor
 * funciona con teclado y en el celular.
 */
function pintarChipsFiltro() {
  [
    ["responsable", "+ responsable"],
    ["etiqueta", "+ etiqueta"],
    ["prioridad", "+ prioridad"],
  ].forEach(([campo, vacio]) => {
    const chip = document.querySelector(`[data-chip="${campo}"]`);
    if (!chip) return;
    const puesto = !!filtros[campo];
    chip.classList.toggle("aplicado", puesto);
    chip.classList.toggle("sin-poner", !puesto);
    chip.querySelector(".chip-x").hidden = !puesto;
    const primera = chip.querySelector("select option[value='']");
    if (primera) primera.textContent = vacio;
  });

  document.querySelector('[data-chip="vencidas"]').hidden = !filtros.vencidas;
}

/** "12 tareas · 3 vencen hoy" junto al estado de conexión. */
function pintarContadorTareas() {
  const activas = tareas.filter((t) => t.estado !== "hecho");
  const hoy = hoyISO();
  const deHoy = activas.filter((t) => t.vence === hoy).length;

  const partes = [activas.length + (activas.length === 1 ? " tarea" : " tareas")];
  if (deHoy) partes.push(deHoy + (deHoy === 1 ? " vence hoy" : " vencen hoy"));
  el("contador-tareas").textContent = tareas.length ? partes.join(" · ") : "";
}

function sincronizarSelects() {
  llenar("f-responsable", personas(tareas), filtros.responsable, "+ responsable");
  llenar("f-etiqueta", etiquetas(tareas), filtros.etiqueta, "+ etiqueta");
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

  el("tb-chapa").innerHTML = chapaTablero(activo, store.listaMiembros().length);
  el("tb-panel").innerHTML = selectorTableros(tableros, activoId, {
    busqueda: busquedaTablero,
    fijados,
    resumenDe: store.resumenDe,
  });
  pintarMenuCuenta();

  const propietario = activo && activo.rol === "propietario";
  const puedeEditar = store.puedoEditar();

  el("mi-editar-tablero").hidden = !propietario;
  el("mi-borrar-tablero").hidden = !propietario;
  el("mi-salir-tablero").hidden = !!propietario || !activo;
  el("btn-nueva").hidden = !puedeEditar;
  el("fab-nueva").hidden = !puedeEditar;
  el("aviso-lectura").hidden = puedeEditar || !activo;

  // Destino para "mover a otro tablero": solo donde se pueda escribir.
  const otros = tableros.filter((t) => t.id !== activoId && t.rol !== "lector");
  el("campo-mover").hidden = !otros.length || !editandoId || !puedeEditar;
  el("mover-tablero").innerHTML =
    `<option value="">Dejarla en este tablero</option>` +
    otros.map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join("");
}

/** Cabecera del menú de cuenta: quién eres y cómo te ven. */
function pintarMenuCuenta() {
  if (!usuario) return;
  const nombre = store.miNombre();
  el("menu-nombre").textContent = nombre;
  el("menu-correo").textContent = usuario.email || "";

  const partes = nombre.trim().split(/\s+/);
  const ini = ((partes[0] || "?")[0] + (partes[1] ? partes[1][0] : "")).toUpperCase();
  el("menu-avatar").textContent = ini;
  el("menu-avatar").style.background = colorDeNombre(nombre);
}

/** El mismo tono estable por nombre que usan los avatares de las tarjetas. */
function colorDeNombre(n) {
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
  return `hsl(${h} 42% 42%)`;
}

/* ===================== ficha de tarea ===================== */

function abrir(id, estadoPorDefecto) {
  const f = el("form");
  const t = tareas.find((x) => x.id === id) || null;
  const puedeEditar = store.puedoEditar();

  if (!t && !puedeEditar) return brindis("Solo puedes mirar este tablero.", true);

  clearTimeout(temporizadorGuardado);
  editandoId = t ? id : null;
  ficha = "detalles";

  el("form-titulo").textContent = t ? (puedeEditar ? "Editar tarea" : "Ver tarea") : "Nueva tarea";

  f.titulo.value = t ? t.titulo : "";
  f.notas.value = t ? t.notas || "" : "";
  f.estado.value = t ? t.estado : estadoPorDefecto || "por_hacer";
  f.prioridad.value = t ? t.prioridad : "media";
  f.responsable.value = t ? t.responsable || "" : "";
  f.vence.value = t ? t.vence || "" : "";
  f.etiquetas.value = t ? (t.etiquetas || []).join(", ") : "";

  // En modo lectura los campos se ven, pero no se tocan.
  camposFicha().forEach((c) => { c.disabled = !puedeEditar; });

  pintarCabezalFicha(t);
  pintarPieFicha(t, puedeEditar);
  pintarPildoras();

  el("fichas-tarea").hidden = !t;
  el("bloque-subtareas").hidden = !t;
  pintarTableros(store.listaTableros(), store.tableroActual() ? store.tableroActual().id : null);
  pintarFichas();

  el("telon").hidden = false;
  setTimeout(() => { if (puedeEditar) f.titulo.focus(); }, 30);

  if (t) {
    pintarPanelSubtareas();
    store.cargarDetalle(t.id);
  } else {
    store.cerrarDetalle();
    pintarContadoresFicha();
  }
}

/** Todos los controles de la ficha, estén dentro del <form> o asociados a él. */
function camposFicha() {
  const f = el("form");
  return [f.titulo, f.notas, f.estado, f.prioridad, f.responsable, f.vence, f.etiquetas];
}

function cerrar() {
  // Un cambio pendiente no puede perderse por cerrar rápido.
  if (temporizadorGuardado) {
    clearTimeout(temporizadorGuardado);
    temporizadorGuardado = null;
    if (editandoId) guardarFicha();
  }
  el("telon").hidden = true;
  editandoId = null;
  store.cerrarDetalle();
}

/** De dónde viene la tarea: su número, su tablero y quién la creó. */
function pintarCabezalFicha(t) {
  const tb = store.tableroActual();
  el("ficha-tablero").textContent = tb ? tb.nombre : "";

  // Un uuid completo no le dice nada a nadie; sus primeros seis caracteres
  // bastan para reconocer una tarea y caben en la cabecera.
  const corto = t ? "#" + t.id.slice(0, 6) : "";
  el("ficha-id").textContent = corto;
  el("ficha-id").hidden = !t;
  el("ficha-sep-1").hidden = !t;

  const origen = t && t.creada
    ? "creada " + tiempoRelativo(t.creada) + (t.creada_por ? " por " + store.nombreDe(t.creada_por) : "")
    : "";
  el("ficha-origen").textContent = origen;
  el("ficha-origen").hidden = !origen;
  el("ficha-sep-2").hidden = !origen;
}

/**
 * El pie cambia según lo que estés haciendo. Al crear hace falta un botón
 * explícito: si se guardara solo, abrir la ficha y cerrarla dejaría una
 * tarea vacía por ahí. Al editar no hace falta, porque ya existe.
 */
function pintarPieFicha(t, puedeEditar) {
  const editando = !!t;
  el("btn-borrar").hidden = !editando || !puedeEditar;
  el("btn-guardar").hidden = editando || !puedeEditar;
  el("btn-hecha").hidden = !editando || !puedeEditar;
  el("ficha-guardado").hidden = true;

  if (editando && puedeEditar) {
    const hecha = t.estado === "hecho";
    el("btn-hecha-txt").textContent = hecha ? "Reabrir" : "Marcar hecha";
    el("btn-hecha").classList.toggle("btn-p", !hecha);
    el("ficha-pie-texto").textContent = "Los cambios se guardan solos";
  } else if (editando) {
    el("ficha-pie-texto").textContent = "Solo lectura";
  } else {
    el("ficha-pie-texto").textContent = "";
  }
}

/** Colorea la píldora de estado y marca la de etiquetas si tiene contenido. */
function pintarPildoras() {
  const f = el("form");
  el("pildora-raya").className = "raya " + f.estado.value;
  document.querySelector('[data-campo="prioridad"]').dataset.valor = f.prioridad.value;
  document.querySelector('[data-campo="etiquetas"]').classList.toggle("punteada", !f.etiquetas.value.trim());
  document.querySelector('[data-campo="vence"]').classList.toggle("punteada", !f.vence.value);
  document.querySelector('[data-campo="responsable"]').classList.toggle("punteada", !f.responsable.value.trim());
}

function pintarFichas() {
  $$("#fichas-tarea button").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.ficha === ficha))
  );
  $$(".hoja-form .ficha").forEach((s) => { s.hidden = s.dataset.ficha !== ficha; });
}

/** Los números junto al nombre de cada pestaña. Vacíos si no hay nada. */
function pintarContadoresFicha() {
  const a = editandoId ? store.avanceSubtareas(editandoId) : null;
  const d = store.detalleActual();
  el("cont-subtareas").textContent = a ? `${a.hechas}/${a.total}` : "";
  el("cont-comentarios").textContent = d.comentarios.length || "";
  el("cont-adjuntos").textContent = d.adjuntos.length || "";
}

function pintarPanelSubtareas() {
  if (!editandoId) return;
  el("panel-subtareas").innerHTML = panelSubtareas(
    store.subtareasDe(editandoId),
    store.puedoEditar()
  );
  pintarContadoresFicha();
}

/* ---------- autoguardado ---------- */

let temporizadorGuardado = null;

function marcarGuardado(estado) {
  const caja = el("ficha-guardado");
  if (!editandoId || !store.puedoEditar()) { caja.hidden = true; return; }
  caja.hidden = false;
  caja.classList.toggle("guardando", estado === "guardando");
  el("ficha-guardado-txt").textContent = estado === "guardando" ? "Guardando…" : "Guardado";
}

/**
 * Al editar, los cambios se envían solos medio segundo después de la
 * última tecla. Ese respiro evita mandar una escritura por carácter sin
 * que llegue a notarse la espera.
 */
function programarGuardado() {
  if (!editandoId || !store.puedoEditar()) return;
  marcarGuardado("guardando");
  clearTimeout(temporizadorGuardado);
  temporizadorGuardado = setTimeout(() => {
    temporizadorGuardado = null;
    guardarFicha();
  }, 500);
}

async function guardarFicha() {
  if (!editandoId || !store.puedoEditar()) return;
  const r = await store.guardar(tareaDelFormulario(editandoId));
  if (!r.ok) { brindis(r.mensaje, true); marcarGuardado("guardado"); return; }
  marcarGuardado("guardado");
}

/** Lee el formulario y devuelve la tarea lista para el store. */
function tareaDelFormulario(id) {
  const f = el("form");
  const prev = tareas.find((t) => t.id === id);
  return {
    id: id || crypto.randomUUID(),
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
    creada_por: prev ? prev.creada_por : (usuario ? usuario.id : null),
  };
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
  pintarContadoresFicha();
}

/* Crear una tarea nueva: aquí sí hay botón y sí se cierra la ficha. */
el("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (editandoId) return; // editando se guarda solo; el submit no aplica

  const tarea = tareaDelFormulario(null);
  const destino = el("mover-tablero").value;
  cerrar();

  const r = await store.guardar(tarea);
  if (!reportar(r)) return;

  // El cambio de tablero se hace después de guardar el resto, para que la
  // tarea llegue al destino ya con sus datos nuevos.
  if (destino) {
    const m = await store.moverATablero(tarea.id, destino);
    if (m.ok) brindis("Movida a «" + m.nombre + "».");
    else brindis(m.mensaje, true);
  }
});

/* Cualquier cambio en la ficha de una tarea existente se guarda solo. */
["input", "change"].forEach((evento) =>
  el("form").addEventListener(evento, (ev) => {
    if (ev.target.id === "mover-tablero") return; // eso se decide al cerrar
    pintarPildoras();
    programarGuardado();
  })
);

el("btn-hecha").addEventListener("click", async () => {
  const f = el("form");
  f.estado.value = f.estado.value === "hecho" ? "por_hacer" : "hecho";
  pintarPildoras();
  clearTimeout(temporizadorGuardado);
  temporizadorGuardado = null;
  marcarGuardado("guardando");
  await guardarFicha();
  const t = tareas.find((x) => x.id === editandoId);
  if (t) pintarPieFicha(t, store.puedoEditar());
});

/* El destino de "mover a otro tablero" se aplica al cerrar la ficha: así
   la tarea llega al otro tablero ya con todos sus cambios guardados. */
el("mover-tablero").addEventListener("change", async (ev) => {
  const destino = ev.target.value;
  if (!destino || !editandoId) return;
  const id = editandoId;
  ev.target.value = "";
  cerrar();
  const m = await store.moverATablero(id, destino);
  brindis(m.ok ? "Movida a «" + m.nombre + "»." : m.mensaje, !m.ok);
});

el("btn-cancelar").addEventListener("click", cerrar);
el("btn-cerrar-form").addEventListener("click", cerrar);
el("btn-borrar").addEventListener("click", async () => {
  if (!editandoId) return;
  const t = tareas.find((x) => x.id === editandoId);
  const ok = await confirmarPeligro(
    "¿Eliminar esta tarea?",
    `«${t ? t.titulo : "Esta tarea"}» se borra junto con sus subtareas, comentarios y adjuntos. No se puede deshacer.`
  );
  if (!ok) return;
  const id = editandoId;
  cerrar();
  reportar(await store.eliminar(id));
});
el("telon").addEventListener("mousedown", (e) => { if (e.target === el("telon")) cerrar(); });

/* ===================== diálogos propios ===================== */

/**
 * Sustituye a confirm() y prompt() del navegador.
 *
 * Los del navegador se pintan con el estilo del sistema operativo —que no
 * se parece en nada a esto—, no se pueden traducir, y bloquean la página
 * entera mientras están abiertos. Este vive dentro del diseño y devuelve
 * una promesa, que además se lee mejor en el sitio donde se usa.
 *
 * Sin `campo` devuelve true o false. Con `campo`, devuelve el texto escrito
 * o null si se canceló.
 */
let resolverDialogo = null;

function dialogo({ titulo, texto, ok = "Confirmar", peligro = false, campo = null }) {
  el("dialogo-titulo").textContent = titulo;
  el("dialogo-texto").textContent = texto || "";
  el("dialogo-texto").hidden = !texto;
  el("dialogo-error").hidden = true;

  const caja = el("dialogo-campo");
  const input = el("dialogo-input");
  caja.hidden = !campo;
  if (campo) {
    el("dialogo-etiqueta").textContent = campo.etiqueta || "";
    input.type = campo.tipo || "text";
    input.value = campo.valor || "";
    input.placeholder = campo.placeholder || "";
  }

  const si = el("dialogo-si");
  si.textContent = ok;
  si.classList.toggle("btn-peligro", peligro);

  el("telon-dialogo").hidden = false;
  setTimeout(() => (campo ? input : si).focus(), 30);

  return new Promise((resolve) => {
    resolverDialogo = { resolve, campo };
  });
}

function cerrarDialogo(valor) {
  if (!resolverDialogo) return;
  const { resolve } = resolverDialogo;
  resolverDialogo = null;
  el("telon-dialogo").hidden = true;
  resolve(valor);
}

el("form-dialogo").addEventListener("submit", (ev) => {
  ev.preventDefault();
  if (!resolverDialogo) return;
  const { campo } = resolverDialogo;

  if (!campo) return cerrarDialogo(true);

  const valor = el("dialogo-input").value.trim();
  // `debeSer` es la salvaguarda de lo irreversible: obliga a escribir algo
  // concreto —el nombre del tablero, la palabra ELIMINAR— para que borrar
  // no pueda ser un clic de más.
  if (campo.debeSer !== undefined && valor !== campo.debeSer) {
    const e = el("dialogo-error");
    e.textContent = campo.errorSiNoCoincide || "Lo escrito no coincide. No se hizo nada.";
    e.hidden = false;
    return;
  }
  if (campo.requerido && !valor) {
    const e = el("dialogo-error");
    e.textContent = "Escribe algo primero.";
    e.hidden = false;
    return;
  }
  cerrarDialogo(valor);
});

el("dialogo-no").addEventListener("click", () => cerrarDialogo(resolverDialogo && resolverDialogo.campo ? null : false));
el("telon-dialogo").addEventListener("mousedown", (e) => {
  if (e.target === el("telon-dialogo")) cerrarDialogo(resolverDialogo && resolverDialogo.campo ? null : false);
});

/** Atajo para el caso más común: “¿seguro?” con un botón rojo. */
const confirmarPeligro = (titulo, texto, ok) =>
  dialogo({ titulo, texto, ok: ok || "Eliminar", peligro: true });

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
      usuario ? usuario.id : null,
      {
        // El responsable de una tarea es texto libre, así que se cruza por
        // nombre. Es lo mismo que hace el filtro de responsable.
        tareasDe: (nombre) => {
          const n = nombre.toLowerCase();
          return tareas.filter(
            (t) => t.estado !== "hecho" && (t.responsable || "").toLowerCase() === n
          ).length;
        },
      }
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
  const fijar = e.target.closest("[data-fijar]");
  if (fijar) {
    const id = fijar.dataset.fijar;
    if (fijados.has(id)) fijados.delete(id);
    else fijados.add(id);
    guardarAjuste("spidey-tableros-fijados", [...fijados].join(","));
    pintarTableros(store.listaTableros(), store.tableroActual() ? store.tableroActual().id : null);
    el("tb-panel").hidden = false;
    return;
  }

  const bf = e.target.closest("[data-bandeja]");
  if (bf) {
    bandejaSoloMias = bf.dataset.bandeja === "mias";
    pintarBandeja();
    el("bandeja-panel").hidden = false;
    return;
  }

  const elegido = e.target.closest("[data-tablero]");
  if (elegido) {
    el("tb-panel").hidden = true;
    busquedaTablero = "";
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

  const quitarFiltro = e.target.closest("[data-limpiar-filtro]");
  if (quitarFiltro) {
    const campo = quitarFiltro.dataset.limpiarFiltro;
    filtros[campo] = campo === "vencidas" ? false : "";
    pintar();
    return;
  }

  // "Ver todas" del indicador de vencidas: no basta con contarlas, hay que
  // poder saltar a ellas.
  if (e.target.closest("[data-ver-vencidas]")) {
    filtros.vencidas = true;
    vista = "lista";
    ordenLista = { campo: "vence", dir: "asc" };
    pintar();
    return;
  }

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
    if (!(await confirmarPeligro("¿Eliminar este comentario?", "Desaparecerá para todos los del tablero."))) return;
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
    if (!(await confirmarPeligro("¿Eliminar este archivo?", "Se borra del almacenamiento y no se puede recuperar."))) return;
    reportar(await store.eliminarAdjunto(ba.dataset.borrarAdjunto, ba.dataset.ruta, editandoId));
    return;
  }

  // --- miembros ---
  const qm = e.target.closest("[data-quitar-miembro]");
  if (qm) {
    if (!(await confirmarPeligro("¿Quitar a esta persona?", "Dejará de ver las tareas de este tablero. Puedes volver a invitarla cuando quieras.", "Quitar"))) return;
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

  const ag = e.target.closest("[data-agrupar]");
  if (ag) {
    agrupaLista = ag.dataset.agrupar;
    guardarAjuste("spidey-agrupamiento", agrupaLista);
    pintar();
    return;
  }

  const dup = e.target.closest("[data-duplicar]");
  if (dup) { await duplicar(dup.dataset.duplicar); return; }

  const del = e.target.closest("[data-eliminar]");
  if (del) {
    const t = tareas.find((x) => x.id === del.dataset.eliminar);
    if (!t) return;
    if (!(await confirmarPeligro(
      "¿Eliminar esta tarea?",
      `«${t.titulo}» se borra junto con sus subtareas, comentarios y adjuntos. No se puede deshacer.`
    ))) return;
    reportar(await store.eliminar(t.id));
    return;
  }

  const th = e.target.closest("th[data-orden]");
  if (th) {
    const c = th.dataset.orden;
    if (ordenLista.campo === c) ordenLista.dir = ordenLista.dir === "asc" ? "desc" : "asc";
    else ordenLista = { campo: c, dir: "asc" };
    pintar(); return;
  }

  const cal = e.target.closest("[data-cal]");
  if (cal) {
    modoCalendario = cal.dataset.cal;
    guardarAjuste("spidey-calendario", modoCalendario);
    pintar();
    return;
  }

  const ms = e.target.closest("[data-mes]");
  if (ms) {
    const n = parseInt(ms.dataset.mes, 10);
    if (n === 0) cursorMes = new Date();
    else if (modoCalendario === "semana") {
      // En vista de semana, las flechas mueven siete días, no un mes.
      const d = new Date(cursorMes);
      d.setDate(d.getDate() + n * 7);
      cursorMes = d;
    } else {
      cursorMes = new Date(cursorMes.getFullYear(), cursorMes.getMonth() + n, 1);
    }
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

    // Invitar a un equipo entero de a un correo por vez es tedioso; se
    // aceptan varios separados por comas y se envían uno tras otro.
    const correos = f.email.value.split(",").map((s) => s.trim()).filter(Boolean);
    if (!correos.length) return brindis("Escribe al menos un correo.", true);

    boton.disabled = true;
    const fallos = [];
    let agregados = 0, pendientes = 0;

    for (const correo of correos) {
      const r = await store.invitar(correo, f.rol.value);
      if (!r.ok) fallos.push(correo + ": " + r.mensaje);
      else if (r.resultado === "pendiente") pendientes++;
      else if (r.resultado === "agregado") agregados++;
    }
    boton.disabled = false;

    if (fallos.length === correos.length) return brindis(fallos[0], true);

    const partes = [];
    if (agregados) partes.push(agregados === 1 ? "1 persona añadida" : agregados + " personas añadidas");
    if (pendientes) partes.push(pendientes === 1 ? "1 invitación pendiente" : pendientes + " invitaciones pendientes");
    if (fallos.length) partes.push(fallos.length + " con error");
    brindis(partes.join(" · ") || "Sin cambios.", fallos.length > 0);

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
  // Marcar una tarea como hecha desde la lista, sin abrir su ficha.
  const marca = e.target.closest("[data-marcar]");
  if (marca) {
    const t = tareas.find((x) => x.id === marca.dataset.marcar);
    if (!t) return;
    const destino = marca.checked ? "hecho" : "por_hacer";
    await cambiarEstado(t, destino, t.posicion);
    return;
  }

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

/** ¿El foco está dentro de algo donde la persona está escribiendo? */
function escribiendo() {
  const a = document.activeElement;
  if (!a) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName) || a.isContentEditable;
}

document.addEventListener("keydown", (e) => {
  // Ctrl/⌘+K lleva el foco a la búsqueda desde cualquier parte, incluso
  // mientras se escribe en otro campo: es el atajo que todo el mundo espera.
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    el("buscar").focus();
    el("buscar").select();
    return;
  }

  if (e.key === "Escape") {
    // El diálogo va primero: es el que está encima de todo.
    if (!el("telon-dialogo").hidden) {
      cerrarDialogo(resolverDialogo && resolverDialogo.campo ? null : false);
      return;
    }
    if (!el("tb-panel").hidden) { el("tb-panel").hidden = true; return; }
    if (!el("bandeja-panel").hidden) { el("bandeja-panel").hidden = true; return; }
    if (!el("telon-hoja").hidden) { cerrarHoja(); return; }
    if (!el("telon").hidden) { cerrar(); return; }
  }
  if (e.key === "Enter" && e.target.classList && e.target.classList.contains("tarjeta")) {
    e.preventDefault(); abrir(e.target.dataset.id);
  }
  if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && usuario &&
      el("telon").hidden && el("telon-hoja").hidden && !escribiendo()) {
    e.preventDefault(); abrir();
  }
});

// El atajo se anuncia con el símbolo de la plataforma: en Mac nadie busca "Ctrl".
if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
  el("atajo-buscar").textContent = "⌘K";
}

async function moverRelativo(id, paso) {
  const t = tareas.find((x) => x.id === id);
  if (!t) return;
  const i = ESTADOS.findIndex((e) => e.id === t.estado) + paso;
  if (i < 0 || i >= ESTADOS.length) return;
  await cambiarEstado(t, ESTADOS[i].id, Date.now());
}

/**
 * Duplica una tarea. Copia los campos, no las subtareas ni los comentarios:
 * duplicar sirve para repetir la forma de un trabajo, no su conversación.
 */
async function duplicar(id) {
  const t = tareas.find((x) => x.id === id);
  if (!t) return;
  const copia = {
    ...t,
    id: crypto.randomUUID(),
    titulo: ("Copia de " + t.titulo).slice(0, 140),
    estado: "por_hacer",
    completada: null,
    posicion: Date.now(),
    creada: new Date().toISOString(),
  };
  if (reportar(await store.guardar(copia), "Tarea duplicada.")) abrir(copia.id);
}

async function cambiarEstado(t, estado, posicion) {
  const copia = { ...t, estado, posicion };
  copia.completada = estado === "hecho" ? t.completada || new Date().toISOString() : null;
  reportar(await store.guardar(copia));
}

/* ---------- arrastrar y soltar ---------- */

let arrastrado = null;

/**
 * Hueco de destino: un rectángulo punteado al pie de la columna sobre la
 * que estás. El borde de la columna ya cambiaba de color, pero con cuatro
 * columnas juntas no siempre queda claro en cuál vas a soltar.
 */
function ponerHueco(col) {
  if (col.querySelector(".drop-slot")) return;
  quitarHuecos();
  const hueco = document.createElement("div");
  hueco.className = "drop-slot";
  hueco.textContent = "— soltá aquí —";
  const lista = col.querySelector(".lista-col");
  if (lista) lista.appendChild(hueco);
}

function quitarHuecos() {
  $$(".drop-slot").forEach((x) => x.remove());
}

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
  quitarHuecos();
  arrastrado = null;
});
document.addEventListener("dragover", (e) => {
  const col = e.target.closest(".columna");
  if (!col || !arrastrado) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  $$(".columna.recibe").forEach((x) => { if (x !== col) x.classList.remove("recibe"); });
  col.classList.add("recibe");
  ponerHueco(col);
});
// Salir del tablero entero (no de una columna a otra) retira el hueco.
document.addEventListener("dragleave", (e) => {
  if (!arrastrado) return;
  if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".tablero")) return;
  $$(".columna.recibe").forEach((x) => x.classList.remove("recibe"));
  quitarHuecos();
});
document.addEventListener("drop", async (e) => {
  const col = e.target.closest(".columna");
  if (!col || !arrastrado) return;
  e.preventDefault();
  col.classList.remove("recibe");
  quitarHuecos();
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

/* La búsqueda de tableros vive dentro de un panel que se repinta, así que
   se atiende por delegación y hay que devolverle el cursor después. */
document.addEventListener("input", (e) => {
  if (e.target.id !== "tb-busqueda") return;
  busquedaTablero = e.target.value;
  const pos = e.target.selectionStart;
  pintarTableros(store.listaTableros(), store.tableroActual() ? store.tableroActual().id : null);
  el("tb-panel").hidden = false;
  const campo = el("tb-busqueda");
  if (campo) { campo.focus(); campo.setSelectionRange(pos, pos); }
});
el("f-responsable").addEventListener("change", (e) => { filtros.responsable = e.target.value; pintar(); });
el("f-etiqueta").addEventListener("change", (e) => { filtros.etiqueta = e.target.value; pintar(); });
el("f-prioridad").addEventListener("change", (e) => { filtros.prioridad = e.target.value; pintar(); });
el("btn-limpiar").addEventListener("click", () => {
  filtros = { q: "", responsable: "", etiqueta: "", prioridad: "", vencidas: false };
  el("buscar").value = ""; pintar();
});
el("btn-nueva").addEventListener("click", () => abrir());
// El flotante del celular hace exactamente lo mismo que el botón de la barra.
el("fab-nueva").addEventListener("click", () => abrir());

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
  const caja = el("mi-recordatorios");
  const estado = el("mcr-estado");
  const nota = el("mcr-nota");

  if (!push.soportado()) {
    caja.classList.add("inactivo");
    const m = push.motivoNoDisponible();
    estado.textContent = m.includes("VAPID") ? "Recordatorios en el celular" : "Recordatorios no disponibles";
    nota.textContent = m.includes("VAPID") ? "Opcional: los avisos por correo ya funcionan" : (m || "Este navegador no los admite");
    return;
  }

  const puestos = await push.activos();
  caja.classList.toggle("inactivo", !puestos);
  estado.textContent = puestos ? "Recordatorios activados" : "Recordatorios desactivados";
  nota.textContent = puestos
    ? "Un aviso diario de lo que vence, en este dispositivo"
    : "No recibirás avisos de vencimientos";
}

async function hojaRecordatorios() {
  const disponible = push.soportado();
  const motivo = push.motivoNoDisponible();
  const encendidos = disponible && (await push.activos());

  // Sin llaves VAPID esto no está roto: está sin configurar, y además es
  // opcional porque los avisos por correo ya cubren lo mismo. Pintarlo en
  // rojo haría pensar que algo falló.
  const sinConfigurar = motivo.includes("VAPID");

  abrirHoja(
    "Recordatorios en el celular",
    `<p class="hoja-texto">Además del correo diario, Spidey puede avisarte con una notificación en la pantalla, aunque la app esté cerrada.</p>
     ${
       sinConfigurar
         ? `<p class="nota-opcional">Esta opción no está configurada, y no hace falta para nada: <b>los avisos por correo ya funcionan</b> y llegan igual. Activarla requiere generar unas llaves de firma y añadirlas al hosting.</p>`
         : motivo
         ? `<p class="aviso-acceso">${esc(motivo)}</p>`
         : ""
     }
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
      const otros = store.listaMiembros().length - 1;

      // Borrar un tablero se lleva por delante el trabajo de más de una
      // persona, así que no basta con un botón: hay que escribir su nombre.
      const escrito = await dialogo({
        titulo: "¿Eliminar este tablero?",
        texto:
          `Se borran ${n === 1 ? "su única tarea" : `sus ${n} tareas`} con subtareas, comentarios y adjuntos` +
          (otros > 0 ? `, y ${otros === 1 ? "la otra persona pierde" : `las otras ${otros} personas pierden`} el acceso` : "") +
          ". No se puede deshacer.",
        ok: "Eliminar tablero",
        peligro: true,
        campo: {
          etiqueta: `Escribe «${activo.nombre}» para confirmar`,
          placeholder: activo.nombre,
          debeSer: activo.nombre,
          errorSiNoCoincide: "El nombre no coincide. No se eliminó nada.",
        },
      });
      if (escrito === null) return;
      cerrar();
      reportar(await store.eliminarTablero(activo.id), "Tablero eliminado.");
      return;
    }

    case "salir-tablero": {
      if (!activo) return;
      if (!(await dialogo({
        titulo: "¿Salirte de este tablero?",
        texto: `Dejarás de ver las tareas de «${activo.nombre}». Para volver, el propietario tendría que invitarte de nuevo.`,
        ok: "Salirme",
        peligro: true,
      }))) return;
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
      const nombre = await dialogo({
        titulo: "¿Con qué nombre quieres aparecer?",
        texto: "Se usa para saludarte, y es el que ven tus compañeros en los comentarios y en el historial.",
        ok: "Guardar",
        campo: {
          etiqueta: "Tu nombre",
          valor: (actual && actual.nombre) || store.miNombre(),
          placeholder: "Nombre y apellido",
          requerido: true,
        },
      });
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
      const escrito = await dialogo({
        titulo: "¿Eliminar tu cuenta?",
        texto:
          "Se borran los tableros de los que eres propietaria, con todas sus tareas, y sales de los ajenos. " +
          "No se puede deshacer. Si quieres conservar algo, descarga antes tu respaldo desde el menú.",
        ok: "Eliminar mi cuenta",
        peligro: true,
        campo: {
          etiqueta: "Escribe ELIMINAR para confirmar",
          placeholder: "ELIMINAR",
          debeSer: "ELIMINAR",
          errorSiNoCoincide: "No coincide. No se eliminó nada.",
        },
      });
      if (escrito === null) return;
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
