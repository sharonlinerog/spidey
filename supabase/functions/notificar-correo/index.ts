// =====================================================================
// Spidey — resumen diario por correo
//
// Corre una vez al día y le manda a cada persona UN correo con lo que
// vence en los tableros a los que pertenece. Quien está en un tablero
// recibe lo de ese tablero, como en Notion.
//
// Un solo correo por persona, no uno por tarea: diez vencimientos no
// deben producir diez correos. Y una sola vez al día: la tabla
// avisos_enviados lo garantiza aunque el cron se dispare de más.
//
// Se envía por SMTP de Gmail con una contraseña de aplicación. No hace
// falta OAuth ni un proyecto de Google Console para esto.
//
// Desplegar:
//   supabase functions deploy notificar-correo
//   supabase secrets set \
//     GMAIL_USUARIO=tucorreo@gmail.com \
//     GMAIL_CLAVE_APP="abcd efgh ijkl mnop" \
//     APP_URL=https://spidey-six-pi.vercel.app
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// nodemailer y no denomailer: con este último, Gmail rechazaba la conexión
// con "534 5.7.9 WebLoginRequired" incluso con una contraseña de aplicación
// válida y la verificación en dos pasos activa. nodemailer es el cliente
// SMTP con el que Gmail lleva años probado.
import nodemailer from "npm:nodemailer@6.9.16";

const URL_SUPABASE = Deno.env.get("SUPABASE_URL")!;
const LLAVE_SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Brevo envía por HTTP, no por SMTP. Es lo que acabó funcionando: Gmail
// rechaza las conexiones SMTP que salen de los servidores de Supabase con
// "534 5.7.9 WebLoginRequired", aunque la contraseña de aplicación sea
// correcta y la cuenta esté desbloqueada. No es algo que el código pueda
// arreglar: Google no confía en esa IP y punto.
//
// Si BREVO_API_KEY está puesta se usa Brevo; si no, se intenta Gmail.
const BREVO_API_KEY = (Deno.env.get("BREVO_API_KEY") ?? "").trim();
const REMITENTE = (Deno.env.get("CORREO_REMITENTE") ?? "").trim();

const GMAIL_USUARIO = (Deno.env.get("GMAIL_USUARIO") ?? "").trim();

// Google muestra la contraseña de aplicación en cuatro grupos de cuatro
// letras, y así es como se copia. Pero SMTP la quiere seguida: con los
// espacios, Gmail responde "534 5.7.14 Please log in via your web browser",
// que no dice nada de espacios y manda a buscar por el lado equivocado.
const GMAIL_CLAVE_APP = (Deno.env.get("GMAIL_CLAVE_APP") ?? "").replace(/\s+/g, "");
const APP_URL = Deno.env.get("APP_URL") ?? "";
const ZONA = Deno.env.get("ZONA_HORARIA") ?? "America/Bogota";

interface Tarea {
  id: string;
  titulo: string;
  vence: string;
  prioridad: string;
  responsable: string;
  tablero_id: string;
}

/** Fecha de hoy en la zona indicada. en-CA da AAAA-MM-DD, igual que la columna. */
const hoyEn = (zona: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(new Date());

function sumarDias(iso: string, dias: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
function fechaCorta(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${parseInt(d, 10)} ${MESES[parseInt(m, 10) - 1]}`;
}

/** Sin esto, un título con `<` rompería el HTML del correo. */
function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

const COLOR = {
  papel: "#101010",
  hoja: "#18181A",
  tinta: "#EDEDED",
  tinta2: "#C8C8C8",
  tinta3: "#8F8F8F",
  sello: "#D30000",
  alerta: "#FF6B6B",
  media: "#E8B14C",
  linea: "#2A1414",
};

/**
 * El correo se arma con tablas y estilos en línea, no con CSS moderno.
 * Los clientes de correo —Outlook sobre todo— ignoran flexbox, grid y las
 * hojas de estilo externas; las tablas son lo único que se ve igual en
 * todas partes.
 */
function filaTarea(t: Tarea, nota: string, urgente: boolean): string {
  const color = urgente ? COLOR.alerta : COLOR.tinta2;
  return `
  <tr>
    <td style="padding:10px 0;border-bottom:1px solid ${COLOR.linea};">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;
                   background:${t.prioridad === "alta" ? COLOR.alerta : t.prioridad === "media" ? COLOR.media : COLOR.tinta3};
                   margin-right:10px;"></span>
      <span style="color:${COLOR.tinta};font-size:15px;">${esc(t.titulo)}</span>
      ${t.responsable ? `<span style="color:${COLOR.tinta3};font-size:13px;"> · ${esc(t.responsable)}</span>` : ""}
    </td>
    <td align="right" style="padding:10px 0;border-bottom:1px solid ${COLOR.linea};
                             color:${color};font-size:13px;white-space:nowrap;">
      ${esc(nota)}
    </td>
  </tr>`;
}

function seccion(titulo: string, filas: string): string {
  if (!filas) return "";
  return `
  <tr><td style="padding:22px 0 6px;">
    <span style="color:${COLOR.tinta3};font-size:12px;letter-spacing:2px;text-transform:uppercase;">
      ${esc(titulo)}
    </span>
  </td></tr>
  <tr><td colspan="2"><table width="100%" cellpadding="0" cellspacing="0" role="presentation">${filas}</table></td></tr>`;
}

function armarCorreo(
  nombre: string,
  vencidas: Tarea[],
  hoy: Tarea[],
  pronto: Tarea[],
  nombreTablero: (id: string) => string,
): string {
  const conTablero = (t: Tarea, nota: string, urgente: boolean) =>
    filaTarea({ ...t, responsable: t.responsable || nombreTablero(t.tablero_id) }, nota, urgente);

  const hoyISO = hoyEn(ZONA);

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spidey</title></head>
<body style="margin:0;padding:0;background:${COLOR.papel};">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"
       style="background:${COLOR.papel};padding:28px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
           style="max-width:560px;background:${COLOR.hoja};border:1px solid ${COLOR.linea};
                  border-radius:16px;padding:28px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">

      <tr><td style="padding-bottom:6px;">
        <span style="color:${COLOR.sello};font-size:15px;font-weight:700;letter-spacing:5px;">SPIDEY</span>
      </td></tr>

      <tr><td style="padding-bottom:18px;">
        <div style="color:${COLOR.tinta};font-size:21px;font-weight:700;line-height:1.3;">
          ${esc(nombre)}, esto es lo que tienes pendiente
        </div>
        <div style="color:${COLOR.tinta3};font-size:13px;padding-top:4px;">
          ${vencidas.length ? `${vencidas.length} vencida${vencidas.length === 1 ? "" : "s"}` : "nada vencido"}
          · ${hoy.length} para hoy
        </div>
      </td></tr>

      ${seccion("Vencidas", vencidas.map((t) => {
        const dias = Math.round((Date.parse(hoyISO) - Date.parse(t.vence)) / 86400000);
        return conTablero(t, dias === 1 ? "ayer" : `hace ${dias} días`, true);
      }).join(""))}

      ${seccion("Hoy", hoy.map((t) => conTablero(t, "vence hoy", true)).join(""))}

      ${seccion("Esta semana", pronto.map((t) => conTablero(t, fechaCorta(t.vence), false)).join(""))}

      ${APP_URL ? `
      <tr><td style="padding-top:26px;">
        <a href="${esc(APP_URL)}"
           style="display:inline-block;background:${COLOR.sello};color:#FFFFFF;
                  text-decoration:none;font-size:15px;font-weight:600;
                  padding:13px 26px;border-radius:10px;">Abrir Spidey</a>
      </td></tr>` : ""}

      <tr><td style="padding-top:24px;border-top:1px solid ${COLOR.linea};margin-top:18px;">
        <div style="color:${COLOR.tinta3};font-size:11px;line-height:1.6;padding-top:16px;">
          Recibes este resumen porque perteneces a un tablero de Spidey con tareas por vencer.
          Se envía una vez al día y solo cuando hay algo que avisar.
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

/**
 * Los errores de SMTP vienen en inglés, en una sola línea kilométrica y
 * apuntando casi siempre al sitio equivocado. Esto les pone delante una
 * frase que diga qué hacer.
 */
function pista(mensaje: string): string {
  const m = mensaje.toLowerCase();
  if (m.includes("534") || m.includes("log in via your web browser"))
    return "Gmail rechazó la contraseña. Comprueba que sea una CONTRASEÑA DE APLICACIÓN de 16 letras (no la contraseña normal) y que la cuenta tenga la verificación en dos pasos activada. → " + mensaje;
  if (m.includes("535"))
    return "Usuario o contraseña de aplicación incorrectos. → " + mensaje;
  if (m.includes("550") && m.includes("daily"))
    return "Se alcanzó el límite diario de envíos de Gmail (unos 500). → " + mensaje;
  if (m.includes("timeout") || m.includes("connection"))
    return "No se pudo conectar con smtp.gmail.com. → " + mensaje;
  return mensaje;
}

/** Un envío por HTTP contra Brevo. Sin TCP, sin negociación, sin políticas. */
async function enviarPorBrevo(para: string, nombre: string, asunto: string, html: string) {
  const desde = REMITENTE || GMAIL_USUARIO;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Spidey", email: desde },
      to: [{ email: para, name: nombre }],
      subject: asunto,
      htmlContent: html,
    }),
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
}

Deno.serve(async (): Promise<Response> => {
  if (!BREVO_API_KEY && (!GMAIL_USUARIO || !GMAIL_CLAVE_APP)) {
    return Response.json(
      { error: "Falta BREVO_API_KEY (o GMAIL_USUARIO y GMAIL_CLAVE_APP) en los secretos de Supabase." },
      { status: 500 },
    );
  }

  const hoy = hoyEn(ZONA);
  const limite = sumarDias(hoy, 7);

  // service_role: esta función necesita ver las tareas de todos para saber
  // a quién avisar. Nunca se expone al navegador.
  const db = createClient(URL_SUPABASE, LLAVE_SERVICIO, { auth: { persistSession: false } });

  // ---- 1. Tareas activas que vencen de aquí a una semana ----
  const { data: tareas, error: errTareas } = await db
    .from("tareas")
    .select("id,titulo,vence,prioridad,responsable,tablero_id")
    .neq("estado", "hecho")
    .not("vence", "is", null)
    .lte("vence", limite);

  if (errTareas) return Response.json({ error: errTareas.message }, { status: 500 });
  if (!tareas?.length) return Response.json({ ok: true, enviados: 0, nota: "Nada que avisar." });

  // ---- 2. Miembros de los tableros implicados ----
  const tableros = [...new Set((tareas as Tarea[]).map((t) => t.tablero_id))];

  const [{ data: miembros }, { data: nombres }] = await Promise.all([
    db.from("tablero_miembros").select("tablero_id,user_id").in("tablero_id", tableros),
    db.from("tableros").select("id,nombre").in("id", tableros),
  ]);

  const nombreTablero = (id: string) =>
    (nombres ?? []).find((t: { id: string; nombre: string }) => t.id === id)?.nombre ?? "";

  const porTablero = new Map<string, string[]>();
  for (const m of miembros ?? []) {
    porTablero.set(m.tablero_id, [...(porTablero.get(m.tablero_id) ?? []), m.user_id]);
  }

  // ---- 3. Agrupar por persona ----
  type Resumen = { vencidas: Tarea[]; hoy: Tarea[]; pronto: Tarea[] };
  const porPersona = new Map<string, Resumen>();

  for (const t of tareas as Tarea[]) {
    for (const u of porTablero.get(t.tablero_id) ?? []) {
      const r = porPersona.get(u) ?? { vencidas: [], hoy: [], pronto: [] };
      if (t.vence < hoy) r.vencidas.push(t);
      else if (t.vence === hoy) r.hoy.push(t);
      else r.pronto.push(t);
      porPersona.set(u, r);
    }
  }

  // Solo se escribe a quien tiene algo vencido o para hoy. Un correo que
  // dice "nada urgente" es un correo que la gente aprende a ignorar, y con
  // él se pierden los que sí importan.
  for (const [u, r] of porPersona) {
    if (!r.vencidas.length && !r.hoy.length) porPersona.delete(u);
  }
  if (!porPersona.size) return Response.json({ ok: true, enviados: 0, nota: "Nada urgente hoy." });

  // ---- 4. Correos y nombres de esas personas ----
  const { data: perfiles } = await db
    .from("perfiles")
    .select("id,nombre,email")
    .in("id", [...porPersona.keys()]);

  // ---- 5. Enviar ----
  const porBrevo = !!BREVO_API_KEY;
  const cliente = porBrevo
    ? null
    : nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: GMAIL_USUARIO, pass: GMAIL_CLAVE_APP },
      });

  // Se comprueba la sesión una sola vez, antes de empezar. Si la contraseña
  // está mal, da igual cuánta gente haya: el error es el mismo para todos y
  // repetirlo una vez por persona solo hace más difícil leerlo.
  if (cliente) {
    try {
      await cliente.verify();
    } catch (e) {
      return Response.json({
        ok: false,
        via: "gmail",
        error: pista((e as Error).message),
        usuario: GMAIL_USUARIO,
        largoClave: GMAIL_CLAVE_APP.length,
      }, { status: 500 });
    }
  }

  let enviados = 0;
  const saltados: string[] = [];
  const fallos: string[] = [];

  try {
    for (const p of perfiles ?? []) {
      const r = porPersona.get(p.id);
      if (!r || !p.email) continue;

      // La clave primaria (user_id, fecha) es la que impide el duplicado:
      // si ya hay fila de hoy, este insert falla y no se envía nada.
      const total = r.vencidas.length + r.hoy.length;
      const { error: yaEstaba } = await db
        .from("avisos_enviados")
        .insert({ user_id: p.id, fecha: hoy, tareas: total });

      if (yaEstaba) { saltados.push(p.email); continue; }

      const nombre = p.nombre || p.email.split("@")[0];
      const asunto = r.vencidas.length
        ? `${r.vencidas.length} tarea${r.vencidas.length === 1 ? "" : "s"} vencida${r.vencidas.length === 1 ? "" : "s"} en Spidey`
        : `${r.hoy.length} tarea${r.hoy.length === 1 ? "" : "s"} vence${r.hoy.length === 1 ? "" : "n"} hoy`;

      const html = armarCorreo(nombre, r.vencidas, r.hoy, r.pronto, nombreTablero);

      try {
        if (porBrevo) await enviarPorBrevo(p.email, nombre, asunto, html);
        else await cliente!.sendMail({
          from: `Spidey <${GMAIL_USUARIO}>`,
          to: p.email,
          subject: asunto,
          html,
        });
        enviados++;
      } catch (e) {
        // Si el envío falla, se retira la marca para que el intento de
        // mañana —o el reintento de hoy— sí pueda escribirle.
        await db.from("avisos_enviados").delete().eq("user_id", p.id).eq("fecha", hoy);
        fallos.push(`${p.email}: ${pista((e as Error).message)}`);
      }
    }
  } finally {
    if (cliente) cliente.close();
  }

  return Response.json({
    ok: true,
    via: porBrevo ? "brevo" : "gmail",
    fecha: hoy,
    personas: porPersona.size,
    enviados,
    saltados: saltados.length,
    fallos,
  });
});
