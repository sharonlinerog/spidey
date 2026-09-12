// =====================================================================
// Spidey — recordatorios push de vencimientos
//
// Función de borde (Deno) que corre una vez al día y envía a cada persona
// UN resumen de lo que vence hoy y de lo que ya venció, en todos los
// tableros a los que pertenece.
//
// Se manda un solo aviso por persona, no uno por tarea: diez tareas
// vencidas no deben producir diez vibraciones del teléfono.
//
// Desplegar:
//   supabase functions deploy notificar-vencimientos
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_ASUNTO=mailto:tu@correo.com
//
// Se invoca desde pg_cron (ver supabase/cron.sql) o manualmente.
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const URL_SUPABASE = Deno.env.get("SUPABASE_URL")!;
const LLAVE_SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLICA = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVADA = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_ASUNTO = Deno.env.get("VAPID_ASUNTO") ?? "mailto:spidey@example.com";

interface Tarea {
  id: string;
  titulo: string;
  vence: string;
  tablero_id: string;
}

interface Suscripcion {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Fecha de hoy en ISO, en la zona horaria que se le indique. */
function hoyEn(zona: string): string {
  // en-CA formatea como AAAA-MM-DD, que es justo lo que guarda la columna `vence`.
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(new Date());
}

function plural(n: number, singular: string, plural_: string): string {
  return n === 1 ? `1 ${singular}` : `${n} ${plural_}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (!VAPID_PUBLICA || !VAPID_PRIVADA) {
    return Response.json(
      { error: "Faltan VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en los secretos." },
      { status: 500 },
    );
  }

  webpush.setVapidDetails(VAPID_ASUNTO, VAPID_PUBLICA, VAPID_PRIVADA);

  // Zona horaria configurable por si la app se usa fuera de Colombia.
  const zona = Deno.env.get("ZONA_HORARIA") ?? "America/Bogota";
  const hoy = hoyEn(zona);

  // service_role: esta función necesita ver las tareas de todo el mundo
  // para saber a quién avisar. Nunca se expone al navegador.
  const db = createClient(URL_SUPABASE, LLAVE_SERVICIO, {
    auth: { persistSession: false },
  });

  // ---- 1. Tareas activas que vencen hoy o antes ----------------------
  const { data: tareas, error: errTareas } = await db
    .from("tareas")
    .select("id,titulo,vence,tablero_id")
    .neq("estado", "hecho")
    .not("vence", "is", null)
    .lte("vence", hoy);

  if (errTareas) {
    return Response.json({ error: errTareas.message }, { status: 500 });
  }
  if (!tareas || tareas.length === 0) {
    return Response.json({ ok: true, avisos: 0, nota: "Nada pendiente hoy." });
  }

  // ---- 2. Miembros de los tableros involucrados ----------------------
  const tableros = [...new Set((tareas as Tarea[]).map((t) => t.tablero_id))];
  const { data: miembros, error: errMiembros } = await db
    .from("tablero_miembros")
    .select("tablero_id,user_id")
    .in("tablero_id", tableros);

  if (errMiembros) {
    return Response.json({ error: errMiembros.message }, { status: 500 });
  }

  const porTablero = new Map<string, string[]>();
  for (const m of miembros ?? []) {
    const lista = porTablero.get(m.tablero_id) ?? [];
    lista.push(m.user_id);
    porTablero.set(m.tablero_id, lista);
  }

  // ---- 3. Agrupar por persona ----------------------------------------
  type Resumen = { hoy: Tarea[]; vencidas: Tarea[] };
  const porPersona = new Map<string, Resumen>();

  for (const t of tareas as Tarea[]) {
    for (const usuario of porTablero.get(t.tablero_id) ?? []) {
      const r = porPersona.get(usuario) ?? { hoy: [], vencidas: [] };
      if (t.vence === hoy) r.hoy.push(t);
      else r.vencidas.push(t);
      porPersona.set(usuario, r);
    }
  }

  // ---- 4. Suscripciones de esas personas ------------------------------
  const { data: subs, error: errSubs } = await db
    .from("suscripciones_push")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", [...porPersona.keys()]);

  if (errSubs) {
    return Response.json({ error: errSubs.message }, { status: 500 });
  }

  // ---- 5. Enviar -------------------------------------------------------
  let enviados = 0;
  const caducadas: string[] = [];

  for (const s of (subs ?? []) as Suscripcion[]) {
    const r = porPersona.get(s.user_id);
    if (!r) continue;

    const partes: string[] = [];
    if (r.vencidas.length) partes.push(`${plural(r.vencidas.length, "tarea vencida", "tareas vencidas")}`);
    if (r.hoy.length) partes.push(`${plural(r.hoy.length, "vence hoy", "vencen hoy")}`);

    const primera = (r.vencidas[0] ?? r.hoy[0])?.titulo ?? "";
    const total = r.vencidas.length + r.hoy.length;

    const carga = JSON.stringify({
      titulo: "Spidey",
      cuerpo: partes.join(" · ") + (total === 1 && primera ? `: ${primera}` : ""),
      etiqueta: "spidey-vencimientos",
      url: "/",
      total,
    });

    try {
      await webpush.sendNotification(
        {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        },
        carga,
      );
      enviados++;
    } catch (e) {
      const codigo = (e as { statusCode?: number }).statusCode;
      // 404/410: el navegador desechó la suscripción. Se limpia para no
      // reintentarla eternamente.
      if (codigo === 404 || codigo === 410) caducadas.push(s.id);
    }
  }

  if (caducadas.length) {
    await db.from("suscripciones_push").delete().in("id", caducadas);
  }

  if (enviados) {
    await db
      .from("suscripciones_push")
      .update({ usada: new Date().toISOString() })
      .in("user_id", [...porPersona.keys()]);
  }

  return Response.json({
    ok: true,
    fecha: hoy,
    personas: porPersona.size,
    enviados,
    caducadas: caducadas.length,
  });
});
