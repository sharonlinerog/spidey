/**
 * Recordatorios push.
 *
 * El navegador entrega la notificación aunque la app esté cerrada, pero
 * quien decide enviarla es el servidor: una función de borde que corre una
 * vez al día (supabase/functions/notificar-vencimientos). Aquí solo se
 * gestiona el permiso y la suscripción de este dispositivo.
 *
 * La suscripción es por dispositivo, no por cuenta: activar los avisos en
 * el celular no los activa en el computador, y eso es lo esperable.
 */

import { supabase, vapidPublica } from "./supabase.js";

/** ¿Este navegador puede recibir push? Safari en iOS solo si está instalada. */
export function soportado() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    !!vapidPublica
  );
}

/** Por qué no se puede, en lenguaje humano. Devuelve "" si sí se puede. */
export function motivoNoDisponible() {
  if (typeof window === "undefined") return "No disponible aquí.";
  if (!("Notification" in window) || !("PushManager" in window))
    return "Este navegador no admite notificaciones push.";
  if (!("serviceWorker" in navigator)) return "Este navegador no admite apps instalables.";
  if (!vapidPublica)
    return "Faltan las llaves VAPID. Revisa VITE_VAPID_PUBLIC_KEY en el hosting.";
  if (Notification.permission === "denied")
    return "Bloqueaste las notificaciones para este sitio. Habilítalas desde el candado de la barra de direcciones.";
  return "";
}

/**
 * La clave VAPID viaja en base64url y PushManager la quiere en bytes.
 * Es una conversión mecánica, no hay nada que decidir aquí.
 */
function llaveABytes(base64url) {
  const relleno = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const crudo = atob(base64);
  const bytes = new Uint8Array(crudo.length);
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
  return bytes;
}

async function registro() {
  return await navigator.serviceWorker.ready;
}

/** ¿Están activos los recordatorios en ESTE dispositivo? */
export async function activos() {
  if (!soportado() || Notification.permission !== "granted") return false;
  try {
    const reg = await registro();
    return !!(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/**
 * Pide permiso, se suscribe y guarda la suscripción en el servidor.
 * Devuelve { ok, mensaje }.
 */
export async function activar(usuario) {
  const motivo = motivoNoDisponible();
  if (motivo) return { ok: false, mensaje: motivo };
  if (!usuario) return { ok: false, mensaje: "No hay sesión." };

  // El permiso debe pedirse desde un gesto del usuario; por eso esta función
  // se llama únicamente desde el clic del botón.
  const permiso = await Notification.requestPermission();
  if (permiso !== "granted")
    return { ok: false, mensaje: "No diste permiso para notificaciones." };

  let sub;
  try {
    const reg = await registro();
    sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: llaveABytes(vapidPublica),
      });
    }
  } catch (e) {
    // El caso típico: la clave VAPID cambió y la suscripción vieja ya no sirve.
    return {
      ok: false,
      mensaje: "El navegador rechazó la suscripción. Si cambiaste las llaves VAPID, desactiva y vuelve a activar.",
    };
  }

  const json = sub.toJSON();
  if (!json.keys || !json.keys.p256dh || !json.keys.auth)
    return { ok: false, mensaje: "El navegador entregó una suscripción incompleta." };

  const { error } = await supabase.from("suscripciones_push").upsert(
    {
      user_id: usuario.id,
      endpoint: sub.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      agente: navigator.userAgent.slice(0, 200),
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    await sub.unsubscribe().catch(() => {});
    return { ok: false, mensaje: "No se pudo guardar la suscripción en el servidor." };
  }

  return { ok: true, mensaje: "Recordatorios activados en este dispositivo." };
}

/** Cancela la suscripción de este dispositivo y la borra del servidor. */
export async function desactivar() {
  if (!soportado()) return { ok: true };
  try {
    const reg = await registro();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true, mensaje: "Ya estaban desactivados." };

    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await supabase.from("suscripciones_push").delete().eq("endpoint", endpoint);
    return { ok: true, mensaje: "Recordatorios desactivados en este dispositivo." };
  } catch {
    return { ok: false, mensaje: "No se pudieron desactivar. Inténtalo otra vez." };
  }
}

/**
 * Aviso de prueba, mostrado por el service worker local. No pasa por el
 * servidor: sirve para comprobar el permiso y cómo se ve, no el envío real.
 */
export async function probar() {
  if (Notification.permission !== "granted")
    return { ok: false, mensaje: "Primero activa los recordatorios." };
  try {
    const reg = await registro();
    await reg.showNotification("Spidey", {
      body: "Así se verán tus recordatorios de vencimientos.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "spidey-prueba",
    });
    return { ok: true };
  } catch {
    return { ok: false, mensaje: "El navegador no pudo mostrar la notificación." };
  }
}
