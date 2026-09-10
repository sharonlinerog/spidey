import "./styles.css";
import { supabase, configurado, mensajeError } from "./supabase.js";
import * as store from "./store.js";
import {
  ESTADOS, ETIQ_ESTADO, ETIQ_PRIO,
  tablero, listaTabla, calendario, indicadores,
  personas, etiquetas, porColumna, filtrar, esc, hoyISO,
  agruparPendientes, bandeja,
} from "./views.js";

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
let modoAcceso = "entrar";
let promesaInstalacion = null;

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
  usuario = nuevo;

  el("portada").hidden = !!usuario;
  el("app").hidden = !usuario;

  if (!usuario) return;

  el("menu-correo").textContent = usuario.email || "";
  store.alActualizar((lista) => { tareas = lista; cargado = true; pintar(); });
  store.alCambiarEstado((clase, texto) => nube(clase, texto));
  nube("", "Conectando…");
  await store.iniciarSesionDeDatos(usuario);
  await store.vaciarSalida();
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

  if (vista === "tablero") el("vista-tablero").innerHTML = tablero(tareas, filtros, cargado);
  else if (vista === "lista") el("vista-lista").innerHTML = listaTabla(tareas, filtros, ordenLista);
  else if (vista === "calendario") el("vista-calendario").innerHTML = calendario(tareas, filtros, cursorMes);
  else el("vista-indicadores").innerHTML = indicadores(tareas, filtros);

  pintarBandeja();
}

/* La campanita se recalcula en cada pintado: siempre refleja el estado real,
   no un contador de "no leídas" que podría mentir. */
function pintarBandeja() {
  const g = agruparPendientes(tareas);
  const cuenta = el("bandeja-cuenta");
  cuenta.textContent = g.total > 9 ? "9+" : String(g.total);
  cuenta.hidden = g.total === 0;
  el("btn-bandeja").classList.toggle("con-pendientes", g.total > 0);
  el("bandeja-panel").innerHTML = bandeja(g);
}

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

/* ===================== formulario de tarea ===================== */

function abrir(id, estadoPorDefecto) {
  const f = el("form");
  const t = tareas.find((x) => x.id === id) || null;
  editandoId = t ? id : null;
  el("form-titulo").textContent = t ? "Editar tarea" : "Nueva tarea";
  el("btn-borrar").hidden = !t;
  f.titulo.value = t ? t.titulo : "";
  f.notas.value = t ? t.notas || "" : "";
  f.estado.value = t ? t.estado : estadoPorDefecto || "por_hacer";
  f.prioridad.value = t ? t.prioridad : "media";
  f.responsable.value = t ? t.responsable || "" : "";
  f.vence.value = t ? t.vence || "" : "";
  f.etiquetas.value = t ? (t.etiquetas || []).join(", ") : "";
  el("telon").hidden = false;
  setTimeout(() => f.titulo.focus(), 30);
}
const cerrar = () => { el("telon").hidden = true; editandoId = null; };

el("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const prev = tareas.find((t) => t.id === editandoId);
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
  cerrar();
  const r = await store.guardar(tarea);
  if (!r.ok) brindis(r.mensaje, true);
  else if (r.encolado) brindis("Guardado en tu dispositivo. Se enviará al recuperar la conexión.");
});

el("btn-cancelar").addEventListener("click", cerrar);
el("btn-borrar").addEventListener("click", async () => {
  if (!editandoId) return;
  const id = editandoId;
  cerrar();
  const r = await store.eliminar(id);
  if (!r.ok) brindis(r.mensaje, true);
});
el("telon").addEventListener("mousedown", (e) => { if (e.target === el("telon")) cerrar(); });

/* ===================== interacción general ===================== */

document.addEventListener("click", (e) => {
  const campana = e.target.closest("#btn-bandeja");
  if (campana) {
    const abrirAhora = el("bandeja-panel").hidden;
    el("bandeja-panel").hidden = !abrirAhora;
    campana.setAttribute("aria-expanded", String(abrirAhora));
    el("menu-lista").hidden = true;
    return;
  }
  if (!e.target.closest(".bandeja")) el("bandeja-panel").hidden = true;

  const menu = e.target.closest("#btn-menu");
  if (menu) {
    const abiertoAhora = el("menu-lista").hidden;
    el("menu-lista").hidden = !abiertoAhora;
    menu.setAttribute("aria-expanded", String(abiertoAhora));
    return;
  }
  if (!e.target.closest(".menu")) el("menu-lista").hidden = true;

  const accion = e.target.closest("[data-accion]");
  if (accion) { el("menu-lista").hidden = true; ejecutarAccion(accion.dataset.accion); return; }

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

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el("bandeja-panel").hidden) el("bandeja-panel").hidden = true;
  if (e.key === "Escape" && !el("telon").hidden) cerrar();
  if (e.key === "Enter" && e.target.classList && e.target.classList.contains("tarjeta")) {
    e.preventDefault(); abrir(e.target.dataset.id);
  }
  if (e.key === "n" && !e.metaKey && !e.ctrlKey && usuario && el("telon").hidden &&
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
  const r = await store.guardar(copia);
  if (!r.ok) brindis(r.mensaje, true);
}

/* ---------- arrastrar y soltar ---------- */

let arrastrado = null;
document.addEventListener("dragstart", (e) => {
  const c = e.target.closest(".tarjeta");
  if (!c) return;
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

/* ---------- menú de cuenta ---------- */

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement("a");
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ejecutarAccion(accion) {
  if (accion === "salir") { supabase.auth.signOut(); return; }

  if (accion === "json") {
    descargar(
      "spidey-respaldo-" + hoyISO() + ".json",
      JSON.stringify({ exportado: new Date().toISOString(), tareas }, null, 2),
      "application/json"
    );
    brindis("Respaldo descargado.");
    return;
  }

  if (accion === "csv") {
    const comilla = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const filas = [
      ["Tarea", "Estado", "Prioridad", "Responsable", "Fecha límite", "Etiquetas", "Notas"].map(comilla).join(","),
    ];
    filtrar(tareas, filtros).forEach((t) => {
      filas.push([
        comilla(t.titulo), comilla(ETIQ_ESTADO[t.estado]), comilla(ETIQ_PRIO[t.prioridad]),
        comilla(t.responsable), comilla(t.vence), comilla((t.etiquetas || []).join(" | ")), comilla(t.notas),
      ].join(","));
    });
    // BOM inicial para que Excel abra bien los acentos.
    descargar("spidey-" + hoyISO() + ".csv", "﻿" + filas.join("\r\n"), "text/csv;charset=utf-8");
    brindis("CSV descargado.");
  }
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
