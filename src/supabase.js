import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Detecta los valores de ejemplo de .env.example, para no confundirlos con credenciales reales. */
function esPlaceholder(valor) {
  if (typeof valor !== "string") return true;
  const v = valor.trim().toLowerCase();
  if (!v) return true;
  return (
    v.includes("xxxx") ||
    v.includes("reemplaza") ||
    v.includes("tu-proyecto") ||
    v.includes("your-project")
  );
}

/** true cuando las variables de entorno están presentes, con forma válida y no son los valores de ejemplo. */
export const configurado =
  typeof url === "string" &&
  url.startsWith("https://") &&
  url.includes(".supabase.co") &&
  !esPlaceholder(url) &&
  typeof anonKey === "string" &&
  anonKey.length > 40 &&
  !esPlaceholder(anonKey);

/**
 * Clave pública VAPID de los recordatorios push. Es opcional: sin ella la
 * app funciona igual, solo que el botón de recordatorios queda apagado.
 */
const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY;
export const vapidPublica =
  typeof vapid === "string" && vapid.length > 80 && !esPlaceholder(vapid) ? vapid.trim() : "";

export const supabase = configurado
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "spidey.auth",
      },
    })
  : null;

/**
 * Traduce los errores de Supabase a mensajes que una persona entiende.
 * Nunca mostramos el texto crudo del servidor.
 */
export function mensajeError(error) {
  if (!error) return "";
  const codigo = error.code || "";
  const texto = (error.message || "").toLowerCase();

  if (texto.includes("invalid login credentials"))
    return "Correo o contraseña incorrectos.";
  if (texto.includes("email not confirmed"))
    return "Falta confirmar tu correo. Revisa la bandeja de entrada y el correo no deseado.";
  if (texto.includes("user already registered") || codigo === "user_already_exists")
    return "Ese correo ya tiene cuenta. Entra con tu contraseña o recupérala.";
  if (texto.includes("password should be at least"))
    return "La contraseña debe tener al menos 8 caracteres.";
  if (texto.includes("rate limit") || codigo === "over_email_send_rate_limit")
    return "Demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo.";
  if (texto.includes("failed to fetch") || texto.includes("networkerror"))
    return "Sin conexión con el servidor. Revisa tu internet.";

  // --- tableros compartidos ---
  if (texto.includes("solo el propietario"))
    return "Solo el propietario del tablero puede hacer eso.";
  if (texto.includes("correo no válido") || texto.includes("correo no valido"))
    return "Ese correo no tiene una forma válida.";
  if (texto.includes("rol no válido") || texto.includes("rol no valido"))
    return "Ese rol no existe.";
  if (codigo === "23505" && texto.includes("tablero_miembros"))
    return "Esa persona ya está en el tablero.";
  if (codigo === "23505" && texto.includes("invitaciones"))
    return "Ya hay una invitación pendiente para ese correo.";

  // --- almacenamiento de adjuntos ---
  if (texto.includes("bucket not found"))
    return "Falta crear el almacenamiento de adjuntos. Ejecuta supabase/storage.sql.";
  if (texto.includes("payload too large") || texto.includes("exceeded the maximum"))
    return "El archivo pesa más de 25 MB.";
  if (texto.includes("mime type"))
    return "Ese tipo de archivo no está permitido.";

  if (codigo === "23514")
    return "Algún dato no es válido. Revisa el título y las fechas.";
  if (codigo === "42501" || texto.includes("row-level security"))
    return "No tienes permiso para hacer ese cambio en este tablero.";
  if (codigo === "42P01")
    return "Falta actualizar la base de datos. Ejecuta supabase/schema.sql.";
  return "Algo falló al hablar con el servidor. Inténtalo otra vez.";
}
