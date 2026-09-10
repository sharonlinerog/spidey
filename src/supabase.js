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
  if (codigo === "23514")
    return "Algún dato de la tarea no es válido. Revisa el título y las fechas.";
  if (codigo === "42501" || texto.includes("row-level security"))
    return "No tienes permiso para modificar esa tarea.";
  return "Algo falló al hablar con el servidor. Inténtalo otra vez.";
}
