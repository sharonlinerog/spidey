// =====================================================================
// Spidey — avisos por correo en el momento
//
// Al estilo de Notion: cuando pasa algo que te concierne, te llega un
// correo. No al día siguiente, no en un resumen: en ese momento.
//
// Se dispara con webhooks de base de datos de Supabase. Escucha dos tablas:
//
//   historial      — todo lo que ocurre dentro de un tablero. La escriben
//                    disparadores de Postgres, y ya traen QUIÉN lo hizo,
//                    que es el dato que un webhook normal no da: en el
//                    webhook solo viaja la fila, no el autor del cambio.
//   invitaciones   — invitar a alguien que todavía no tiene cuenta.
//
// A QUIÉN SE AVISA
//
// La regla que evita que esto se vuelva ruido: se avisa a los interesados
// en la tarea —su responsable, quien la creó y quien ya comentó en ella—,
// nunca a todo el tablero. La excepción es una tarea nueva, que sí va a
// todos, porque es la única forma de enterarse de que existe.
//
// Y nunca a quien hizo el cambio. Nadie necesita un correo contándole lo
// que acaba de hacer.
//
// Desplegar:
//   npx supabase functions deploy notificar-evento
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_SUPABASE = Deno.env.get("SUPABASE_URL")!;
const LLAVE_SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BREVO_API_KEY = (Deno.env.get("BREVO_API_KEY") ?? "").trim();
const REMITENTE = (Deno.env.get("CORREO_REMITENTE") ?? "").trim();
const APP_URL = (Deno.env.get("APP_URL") ?? "").trim();
const SECRETO = (Deno.env.get("WEBHOOK_SECRETO") ?? "").trim();

const COLOR = {
  papel: "#101010", hoja: "#18181A", tinta: "#EDEDED",
  tinta2: "#C8C8C8", tinta3: "#8F8F8F", sello: "#D30000", linea: "#2A1414",
};

const ETIQ_ESTADO: Record<string, string> = {
  por_hacer: "Por hacer", en_curso: "En curso",
  en_revision: "En revisión", hecho: "Hecho",
};
const ETIQ_PRIO: Record<string, string> = { alta: "Alta", media: "Media", baja: "Baja" };

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** El mismo sobre para todos los avisos: marca, cuerpo, botón y pie. */
function sobre(titulo: string, cuerpo: string, textoBoton = "Abrir Spidey"): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${COLOR.papel};">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${COLOR.papel};padding:28px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"
 style="max-width:560px;background:${COLOR.hoja};border:1px solid ${COLOR.linea};border-radius:16px;
        padding:28px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
  <tr><td style="padding-bottom:14px;">
    <span style="color:${COLOR.sello};font-size:15px;font-weight:700;letter-spacing:5px;">SPIDEY</span>
  </td></tr>
  <tr><td style="color:${COLOR.tinta};font-size:20px;font-weight:700;line-height:1.35;padding-bottom:14px;">
    ${titulo}
  </td></tr>
  <tr><td style="color:${COLOR.tinta2};font-size:15px;line-height:1.6;">${cuerpo}</td></tr>
  ${APP_URL ? `<tr><td style="padding-top:24px;">
    <a href="${esc(APP_URL)}" style="display:inline-block;background:${COLOR.sello};color:#FFFFFF;
       text-decoration:none;font-size:15px;font-weight:600;padding:13px 26px;border-radius:10px;">
      ${esc(textoBoton)}</a>
  </td></tr>` : ""}
  <tr><td style="padding-top:26px;border-top:1px solid ${COLOR.linea};">
    <div style="color:${COLOR.tinta3};font-size:11px;line-height:1.6;padding-top:16px;">
      Recibes este aviso porque participas en un tablero de Spidey.
    </div>
  </td></tr>
</table></td></tr></table></body></html>`;
}

/** Una caja gris con el nombre de la tarea, para dar contexto. */
const caja = (texto: string) =>
  `<div style="margin:16px 0;padding:14px 16px;background:${COLOR.papel};
       border:1px solid ${COLOR.linea};border-radius:10px;color:${COLOR.tinta};font-size:15px;">
     ${texto}</div>`;

async function enviar(para: string, nombre: string, asunto: string, html: string) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: "Spidey", email: REMITENTE },
      to: [{ email: para, name: nombre }],
      subject: asunto,
      htmlContent: html,
    }),
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
}

interface Perfil { id: string; nombre: string; email: string }

Deno.serve(async (req: Request): Promise<Response> => {
  // Sin esto, cualquiera que conozca la URL podría fabricar eventos y
  // provocar correos. El secreto lo pone Supabase en la cabecera del
  // webhook; nadie más lo sabe.
  if (SECRETO && req.headers.get("x-spidey-secreto") !== SECRETO) {
    return Response.json({ error: "Secreto no válido." }, { status: 401 });
  }
  if (!BREVO_API_KEY || !REMITENTE) {
    return Response.json({ error: "Faltan BREVO_API_KEY y CORREO_REMITENTE." }, { status: 500 });
  }

  const cuerpo = await req.json().catch(() => null);
  if (!cuerpo?.record) return Response.json({ error: "Sin datos." }, { status: 400 });

  const { table, record } = cuerpo as { table: string; record: Record<string, any> };
  const db = createClient(URL_SUPABASE, LLAVE_SERVICIO, { auth: { persistSession: false } });

  const perfilDe = async (id: string | null): Promise<Perfil | null> => {
    if (!id) return null;
    const { data } = await db.from("perfiles").select("id,nombre,email").eq("id", id).maybeSingle();
    return data as Perfil | null;
  };
  const comoSeLlama = (p: Perfil | null) =>
    p ? (p.nombre || p.email.split("@")[0]) : "Alguien";

  /* ---------------- invitación a quien no tiene cuenta ---------------- */
  if (table === "invitaciones") {
    const [{ data: tablero }, quien] = await Promise.all([
      db.from("tableros").select("nombre").eq("id", record.tablero_id).maybeSingle(),
      perfilDe(record.invitado_por),
    ]);

    await enviar(
      record.email,
      record.email.split("@")[0],
      `Te invitaron al tablero «${tablero?.nombre ?? "Spidey"}»`,
      sobre(
        `${esc(comoSeLlama(quien))} te invitó a un tablero`,
        `Te sumaron a <b style="color:${COLOR.tinta}">${esc(tablero?.nombre ?? "un tablero")}</b> en Spidey.` +
        caja(`Todavía no tienes cuenta. Créala con <b>${esc(record.email)}</b> y el tablero aparecerá solo.`),
        "Crear mi cuenta",
      ),
    );
    return Response.json({ ok: true, aviso: "invitacion_sin_cuenta" });
  }

  /* ---------------- todo lo que pasa dentro de un tablero ---------------- */
  if (table !== "historial") return Response.json({ ok: true, aviso: "ignorado" });

  const { accion, actor, tarea_id, tablero_id, detalle } = record;

  const [{ data: tablero }, quien] = await Promise.all([
    db.from("tableros").select("nombre").eq("id", tablero_id).maybeSingle(),
    perfilDe(actor),
  ]);
  const nombreTablero = tablero?.nombre ?? "un tablero";
  const autor = comoSeLlama(quien);

  // Miembros del tablero, que hacen falta para todo lo demás.
  const { data: miembros } = await db
    .from("tablero_miembros").select("user_id").eq("tablero_id", tablero_id);
  const idsMiembros = (miembros ?? []).map((m) => m.user_id);

  const { data: perfiles } = await db
    .from("perfiles").select("id,nombre,email").in("id", idsMiembros.length ? idsMiembros : [""]);
  const listaPerfiles = (perfiles ?? []) as Perfil[];

  /**
   * Los interesados en una tarea: su responsable, quien la creó y quien ya
   * comentó. Es la diferencia entre un aviso útil y una bandeja llena.
   *
   * El responsable es texto libre, así que se cruza por nombre o correo
   * contra los miembros del tablero.
   */
  async function interesados(): Promise<Perfil[]> {
    if (!tarea_id) return [];
    const [{ data: tarea }, { data: comentarios }] = await Promise.all([
      db.from("tareas").select("responsable,creada_por").eq("id", tarea_id).maybeSingle(),
      db.from("comentarios").select("autor").eq("tarea_id", tarea_id),
    ]);

    const ids = new Set<string>();
    if (tarea?.creada_por) ids.add(tarea.creada_por);
    for (const c of comentarios ?? []) ids.add(c.autor);

    const resp = (tarea?.responsable ?? "").trim().toLowerCase();
    if (resp) {
      const p = listaPerfiles.find(
        (x) => x.email.toLowerCase() === resp || (x.nombre ?? "").toLowerCase() === resp,
      );
      if (p) ids.add(p.id);
    }
    return listaPerfiles.filter((p) => ids.has(p.id));
  }

  const titulo = detalle?.titulo ?? "una tarea";
  let destinos: Perfil[] = [];
  let asunto = "";
  let html = "";

  switch (accion) {
    case "tarea_creada": {
      // La única que va a todo el tablero: es cómo te enteras de que existe.
      destinos = listaPerfiles;
      asunto = `Nueva tarea en ${nombreTablero}`;
      html = sobre(`${esc(autor)} creó una tarea`, caja(`<b>${esc(titulo)}</b>`) +
        `<span style="color:${COLOR.tinta3};font-size:13px;">En ${esc(nombreTablero)}</span>`, "Ver la tarea");
      break;
    }

    case "tarea_editada": {
      const campos = detalle?.campos ?? {};
      const partes: string[] = [];

      if (campos.estado) {
        partes.push(`Estado: <b>${esc(ETIQ_ESTADO[campos.estado[0]] ?? campos.estado[0])}</b> → ` +
          `<b style="color:${COLOR.sello}">${esc(ETIQ_ESTADO[campos.estado[1]] ?? campos.estado[1])}</b>`);
      }
      if (campos.responsable) {
        partes.push(`Responsable: <b>${esc(campos.responsable[1] || "sin asignar")}</b>`);
      }
      if (campos.vence) {
        partes.push(`Fecha límite: <b>${esc(campos.vence[1] || "sin fecha")}</b>`);
      }
      if (campos.prioridad) {
        partes.push(`Prioridad: <b>${esc(ETIQ_PRIO[campos.prioridad[1]] ?? campos.prioridad[1])}</b>`);
      }

      // Cambiar el título o las notas no merece un correo: son retoques.
      if (!partes.length) return Response.json({ ok: true, aviso: "cambio_menor" });

      destinos = await interesados();

      // Si te acaban de asignar la tarea, te enteras aunque no fueras parte.
      if (campos.responsable?.[1]) {
        const nuevo = String(campos.responsable[1]).trim().toLowerCase();
        const p = listaPerfiles.find(
          (x) => x.email.toLowerCase() === nuevo || (x.nombre ?? "").toLowerCase() === nuevo,
        );
        if (p && !destinos.some((d) => d.id === p.id)) destinos.push(p);
      }

      asunto = campos.responsable?.[1]
        ? `Te asignaron: ${titulo}`
        : `${titulo} — ${campos.estado ? "cambió de estado" : "se actualizó"}`;
      html = sobre(`${esc(autor)} actualizó una tarea`,
        caja(`<b>${esc(titulo)}</b>`) +
        partes.map((p) => `<div style="padding:3px 0;">${p}</div>`).join("") +
        `<div style="color:${COLOR.tinta3};font-size:13px;padding-top:10px;">En ${esc(nombreTablero)}</div>`,
        "Ver la tarea");
      break;
    }

    case "comentario_agregado": {
      destinos = await interesados();
      asunto = `${autor} comentó en ${titulo === "una tarea" ? "una tarea" : titulo}`;
      html = sobre(`${esc(autor)} dejó un comentario`,
        caja(`<i style="color:${COLOR.tinta2}">«${esc(detalle?.extracto ?? "")}»</i>`) +
        `<div style="color:${COLOR.tinta3};font-size:13px;">En ${esc(nombreTablero)}</div>`,
        "Responder");
      break;
    }

    case "subtarea_agregada":
    case "subtarea_hecha": {
      destinos = await interesados();
      const hecha = accion === "subtarea_hecha";
      asunto = hecha
        ? `Paso completado en ${titulo === "una tarea" ? nombreTablero : titulo}`
        : `Nuevo paso en ${titulo === "una tarea" ? nombreTablero : titulo}`;
      html = sobre(
        `${esc(autor)} ${hecha ? "completó un paso" : "añadió un paso"}`,
        caja(
          hecha
            ? `<span style="text-decoration:line-through;color:${COLOR.tinta3}">${esc(detalle?.texto ?? "")}</span>`
            : `<b>${esc(detalle?.texto ?? "")}</b>`,
        ) + `<div style="color:${COLOR.tinta3};font-size:13px;">En ${esc(nombreTablero)}</div>`,
        "Ver la tarea",
      );
      break;
    }

    case "adjunto_agregado": {
      destinos = await interesados();
      asunto = `${autor} adjuntó un archivo`;
      html = sobre(`${esc(autor)} adjuntó un archivo`,
        caja(`<b>${esc(detalle?.nombre ?? "")}</b>`) +
        `<div style="color:${COLOR.tinta3};font-size:13px;">En ${esc(nombreTablero)}</div>`,
        "Ver el archivo");
      break;
    }

    case "miembro_agregado": {
      const correo = String(detalle?.email ?? "").toLowerCase();
      const p = listaPerfiles.find((x) => x.email.toLowerCase() === correo);
      if (!p) return Response.json({ ok: true, aviso: "sin_perfil" });
      destinos = [p];
      asunto = `Te sumaron al tablero «${nombreTablero}»`;
      html = sobre(`${esc(autor)} te sumó a un tablero`,
        `Ya tienes acceso a <b style="color:${COLOR.tinta}">${esc(nombreTablero)}</b> como ` +
        `<b>${esc(detalle?.rol === "lector" ? "solo lectura" : "editor")}</b>.`,
        "Abrir el tablero");
      break;
    }

    default:
      return Response.json({ ok: true, aviso: "sin_correo_para:" + accion });
  }

  // Nadie necesita un correo contándole lo que acaba de hacer.
  destinos = destinos.filter((p) => p.id !== actor && p.email);

  const fallos: string[] = [];
  let enviados = 0;
  for (const p of destinos) {
    try {
      await enviar(p.email, comoSeLlama(p), asunto, html);
      enviados++;
    } catch (e) {
      fallos.push(`${p.email}: ${(e as Error).message}`);
    }
  }

  return Response.json({ ok: true, accion, enviados, fallos });
});
