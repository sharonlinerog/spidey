/**
 * Genera el par de llaves VAPID que firma los recordatorios push.
 *
 *   npm run vapid
 *
 * Se corre UNA sola vez. Si las cambias después, todas las suscripciones
 * existentes dejan de funcionar y cada persona tiene que volver a activar
 * los recordatorios en su dispositivo.
 */

import webpush from "web-push";

const llaves = webpush.generateVAPIDKeys();

console.log(`
Llaves VAPID generadas. Guárdalas ahora: no se pueden recuperar.

1) En tu .env local y en las variables de entorno del hosting (Vercel):

   VITE_VAPID_PUBLIC_KEY=${llaves.publicKey}

2) En los secretos de Supabase (nunca en el navegador):

   supabase secrets set \\
     VAPID_PUBLIC_KEY=${llaves.publicKey} \\
     VAPID_PRIVATE_KEY=${llaves.privateKey} \\
     VAPID_ASUNTO=mailto:tu@correo.com

La llave privada firma los envíos desde el servidor. Si se filtra,
cualquiera podría mandar notificaciones a tus usuarios: trátala como
una contraseña.
`);
