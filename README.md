# Spidey

App web instalable (PWA) para seguimiento de tareas en equipo: tableros compartidos con Kanban, lista, calendario e indicadores. Cada tarea puede tener subtareas, comentarios, archivos adjuntos e historial de cambios, y Spidey avisa por notificación cuando algo está por vencer.

- **Frontend:** Vite + JavaScript sin framework (sin React, sin build pesado)
- **Backend:** Supabase (autenticación + PostgreSQL + realtime + Storage + funciones de borde)
- **Hosting:** Vercel (funciona igual en Netlify o Cloudflare Pages)
- **Peso:** ~80 KB comprimidos

---

## 1. Qué necesitas antes de empezar

| Cuenta | Para qué | Costo |
|---|---|---|
| [GitHub](https://github.com) | Guardar el código | Gratis |
| [Supabase](https://supabase.com) | Base de datos, cuentas y archivos | Gratis (plan Free) |
| [Vercel](https://vercel.com) | Publicar el sitio | Gratis (plan Hobby) |

También necesitas [Node.js 18 o superior](https://nodejs.org) si vas a correrla en tu computador.

---

## 2. Configurar Supabase

1. Entra a [supabase.com](https://supabase.com) → **New project**. Elige la región más cercana (para Colombia, `us-east-1`) y guarda la contraseña de la base de datos.
2. Ve a **SQL Editor → New query** y ejecuta, **en este orden**:
   - Todo el contenido de **`supabase/schema.sql`** — tablas, restricciones, índices, disparadores, realtime y las políticas de seguridad.
   - Todo el contenido de **`supabase/storage.sql`** — el bucket privado de adjuntos y sus permisos.

   Ambos son idempotentes: puedes volver a correrlos sin romper nada.
3. Ve a **Project Settings → API** y copia dos valores:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public** key → `VITE_SUPABASE_ANON_KEY`

   > La clave `anon` es pública por diseño: viaja al navegador y no es un secreto. La que **nunca** debe salir del servidor es la `service_role`.
4. Ve a **Authentication → Providers → Email** y decide:
   - **Confirm email activado** (recomendado en producción): cada persona confirma su correo antes de entrar.
   - **Desactivado**: entran de una, útil mientras pruebas.
5. Ve a **Authentication → URL Configuration** y pon tu dominio real en **Site URL** y en **Redirect URLs** (por ejemplo `https://spidey.tudominio.com`). Sin esto, los enlaces de confirmación y de recuperar contraseña no vuelven a tu app.

### ¿Vienes de la versión 1?

`schema.sql` **migra tus datos solo**. Al detectar la columna vieja `user_id` en `tareas`:

1. le crea a cada persona un tablero llamado **«Mis tareas»**,
2. mete ahí todas sus tareas,
3. la deja como propietaria de ese tablero,
4. y retira la columna vieja.

No se pierde nada y no hay que hacer nada a mano. Aun así, antes de correrlo haz un respaldo desde **Database → Backups** (o con el botón «Descargar respaldo» de la app).

---

## 3. Correrlo en tu computador

```bash
cp .env.example .env      # en Windows: copy .env.example .env
# abre .env y pega tu URL y tu anon key
npm install
npm run dev
```

Queda en `http://localhost:5173`.

Para revisar la versión de producción (con service worker activo, que es como se comporta instalada):

```bash
npm run build
npm run preview
```

> El service worker solo se activa en la versión compilada. Las notificaciones push **no funcionan** con `npm run dev`.

---

## 4. Publicarlo en Vercel

1. Entra a [vercel.com/new](https://vercel.com/new) e importa el repositorio de GitHub.
2. Vercel detecta Vite solo. Antes de dar **Deploy**, abre **Environment Variables** y agrega:

   ```
   VITE_SUPABASE_URL      = https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY = eyJhbGciOi...
   VITE_VAPID_PUBLIC_KEY  = (opcional, ver sección 6)
   ```

   Márcalas para **Production**, **Preview** y **Development**.
3. **Deploy**. En ~40 segundos tienes una URL tipo `spidey.vercel.app`.
4. Vuelve a Supabase → **Authentication → URL Configuration** y pon esa URL como Site URL.

> ⚠️ **`vercel.json` trae la URL de un proyecto de Supabase escrita a mano** dentro de la cabecera `Content-Security-Policy` (`connect-src`). Si tu proyecto es otro, cámbiala ahí o el navegador bloqueará todas las llamadas y la app se verá vacía sin decir por qué.

> Si cambias una variable de entorno después, hay que **volver a desplegar**: Vite las incrusta al compilar, no se leen en tiempo de ejecución.

### Dominio propio

En Vercel: **Settings → Domains → Add**. Te da los registros DNS (un `CNAME` o un `A`) para pegar donde compraste el dominio. El certificado HTTPS lo emite Vercel solo. Luego actualiza otra vez la Site URL en Supabase.

---

## 5. Tableros compartidos

Cada tablero es un proyecto independiente, con sus propias tareas y sus propios miembros. Cambias de tablero desde el selector que está junto al logo.

**Roles:**

| Rol | Puede |
|---|---|
| **Propietario** | Todo: renombrar el tablero, invitar, cambiar roles, expulsar y eliminar el tablero |
| **Editor** | Crear y modificar tareas, subtareas, comentarios y adjuntos |
| **Solo lectura** | Ver el tablero y comentar. No puede tocar tareas |

**Para invitar:** menú **⋯ → Miembros y permisos → Invitar**. Si esa persona ya tiene cuenta, entra de inmediato. Si no, la invitación queda guardada y se aplica sola en cuanto se registre con ese correo.

La seguridad **no** está en el JavaScript: está en las políticas RLS de PostgreSQL. Aunque alguien manipule el navegador, la base de datos no le entrega filas de un tablero al que no pertenece.

---

## 6. Recordatorios push (opcional)

Una vez al día Spidey envía **un solo aviso por persona** con lo que vence hoy y lo que ya venció, en todos sus tableros. Llega aunque la app esté cerrada.

Requiere tres cosas: un par de llaves VAPID, una función de borde desplegada y un cron que la dispare.

**1. Generar las llaves** (una sola vez):

```bash
npm run vapid
```

Pon la **pública** en `VITE_VAPID_PUBLIC_KEY` (`.env` y variables de Vercel). La **privada** nunca va al navegador.

**2. Desplegar la función** (necesitas la [CLI de Supabase](https://supabase.com/docs/guides/cli)):

```bash
supabase link --project-ref TU-PROJECT-REF
supabase functions deploy notificar-vencimientos
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_ASUNTO=mailto:tu@correo.com
```

**3. Programar el envío diario:** abre `supabase/cron.sql`, lee los comentarios de arriba (hay que registrar la URL y la clave de servicio con `alter database` antes de correrlo) y ejecútalo en el SQL Editor. Queda a las 8:00 a. m. hora de Colombia.

Para probarlo sin esperar al día siguiente:

```sql
select public.disparar_recordatorios();
```

**Activarlos como usuario:** menú **⋯ → Recordatorios → Activar en este dispositivo**. Es **por dispositivo**: activarlos en el celular no los activa en el computador. En iPhone solo funcionan con la app instalada en la pantalla de inicio.

Si dejas `VITE_VAPID_PUBLIC_KEY` vacía, la app funciona igual y el botón queda apagado con una explicación.

---

## 7. Instalarla en el celular

Hay dos caminos, y conviene saber en qué se diferencian:

| | PWA (desde el navegador) | APK (carpeta `movil/`) |
|---|---|---|
| Cómo se instala | «Agregar a pantalla de inicio» | Se descarga e instala el `.apk` |
| Se puede compartir por WhatsApp | No | Sí |
| Google Play | No | Sí (como `.aab`) |
| **Recordatorios push** | **Sí** | **No** (haría falta Firebase) |
| Se actualiza sola al desplegar la web | Sí | Sí |
| iPhone | Sí | No (habría que compilar para iOS) |

**Si los recordatorios te importan, la PWA es mejor.** Si lo que quieres es repartir un archivo instalable, usa el APK. Los detalles del APK están en [`movil/README.md`](movil/README.md).

### Como PWA

La app cumple los requisitos de PWA (manifest, service worker, HTTPS), así que:

- **Android / Chrome:** al abrir la página aparece "Instalar aplicación", o desde el menú ⋮ → *Agregar a la pantalla principal*. También aparece el botón **Instalar** dentro de la app.
- **iPhone / Safari:** botón Compartir → *Agregar a pantalla de inicio*. (iOS no muestra aviso automático; hay que hacerlo a mano.)
- **Escritorio / Chrome o Edge:** ícono de instalar en la barra de direcciones.

Una vez instalada abre a pantalla completa, sin barra del navegador, y funciona sin conexión.

**Qué funciona sin internet:** ver los tableros, crear y editar tareas y subtareas. Los cambios se guardan en el dispositivo y se envían solos al reconectar.

**Qué no:** comentarios, adjuntos, invitaciones e historial. Son hechos compartidos con otras personas; fingir que se guardaron sería mentirle a quien está del otro lado del tablero. La app lo dice en vez de fallar en silencio.

---

## 8. Cómo está organizado el código

```
├─ index.html                   Estructura: acceso + app + ficha de tarea + hoja genérica
├─ vite.config.js               Build y PWA (manifest + service worker propio)
├─ vercel.json                  Rewrites de SPA, caché y cabeceras de seguridad
├─ scripts/vapid.mjs            Genera el par de llaves de las notificaciones
├─ supabase/
│  ├─ schema.sql                Tablas, permisos, disparadores, realtime y migración
│  ├─ storage.sql               Bucket privado de adjuntos y sus políticas
│  ├─ cron.sql                  Programación diaria del recordatorio
│  └─ functions/notificar-vencimientos/index.ts   Quien envía los avisos
├─ src/
│  ├─ main.js                   Arranque, sesión, eventos, arrastrar y soltar, exportar
│  ├─ store.js                  Datos: Supabase + caché local + cola sin conexión
│  ├─ supabase.js               Cliente y traducción de errores a lenguaje humano
│  ├─ push.js                   Permiso y suscripción a notificaciones
│  ├─ sw.js                     Service worker: caché sin conexión y evento `push`
│  ├─ views.js                  Render de tablero, lista, calendario e indicadores
│  ├─ detalle.js                Render de subtareas, comentarios, adjuntos, historial y miembros
│  └─ styles.css                Todo el diseño, con tema claro y oscuro
├─ movil/                       App Android (React Native + Expo) que renderiza Spidey
│  ├─ App.js                    Cascarón nativo: arranque, botón atrás, sin conexión
│  ├─ app.json                  Nombre, íconos, paquete y la URL a la que apunta
│  └─ eas.json                  Perfiles de compilación (APK y AAB)
└─ public/icons/                Íconos de la app (incluye versión "maskable" de Android)
```

**Decisiones que vale la pena conocer:**

- `views.js` y `detalle.js` no tocan el servidor ni guardan estado: reciben datos y devuelven HTML. Por eso agregar una vista nueva es un archivo aparte, no una cirugía.
- `store.js` escribe primero en pantalla y después en el servidor. Si falla o no hay internet, el cambio queda en una cola en el dispositivo y se reintenta al reconectar.
- **Las funciones de permiso de `schema.sql` son `security definer` a propósito.** Si una política sobre `tablero_miembros` consultara `tablero_miembros` con RLS activo, Postgres entraría en recursión infinita. `es_miembro()` y `puede_editar()` rompen ese ciclo.
- **El historial lo escriben disparadores, no la app.** Si lo llenara el navegador, bastaría con no llamar a la función para que un cambio no quedara registrado.
- **La campana es el único sitio de las notificaciones.** Junta dos cosas que a la persona le importan por igual: lo que se le vence (sale de sus tareas) y lo que hicieron los demás en el tablero (sale de la bitácora). El contador se marca como visto al **abrir** la campana, no al pintarla: si se marcara al pintar, se borraría solo antes de que nadie lo hubiera mirado.
- **El saludo de bienvenida solo existe en el celular** (`@media (max-width:760px)`). En el escritorio esa información ya está a la vista y sobraría. Se muestra una vez al día por dispositivo: un saludo que aparece en cada recarga deja de ser un saludo.
- Un arrastre entre columnas mueve `posicion` en cada suelta; registrar eso llenaría el historial de ruido, así que un cambio de sola posición se ignora.
- **La ruta de cada adjunto empieza por el id del tablero** (`<tablero_id>/<tarea_id>/<archivo>`). No es decorativo: las políticas de Storage leen ese primer segmento para decidir quién puede abrir el archivo.
- El bucket de adjuntos es **privado**. La app pide una URL firmada que caduca en un minuto cada vez que alguien abre un archivo.
- El orden de las tarjetas usa un número flotante (`posicion`). Al soltar una tarjeta entre otras dos se guarda el promedio: se reordena escribiendo una sola fila, no toda la columna.

---

## 9. Antes de abrirla al público

Como cualquier persona podrá registrarse, revisa esto:

- [ ] **Confirmación de correo activada** en Supabase, para evitar registros basura.
- [ ] **Correo propio (SMTP)**: el correo por defecto de Supabase tiene límite de ~4 mensajes por hora y sirve solo para pruebas. Configura Resend, SendGrid o Amazon SES en *Authentication → Emails → SMTP Settings*.
- [ ] **Protección anti-abuso**: activa el CAPTCHA en *Authentication → Attack Protection*.
- [ ] **CSP de `vercel.json`** apuntando a **tu** proyecto de Supabase (ver sección 4).
- [ ] **Cuota de almacenamiento**: el plan Free de Supabase da 1 GB de Storage. Con adjuntos de hasta 25 MB se llena rápido si el equipo es grande. Vigílalo en *Storage → Usage*.
- [ ] **Respaldos**: el plan Free no incluye respaldo automático. La app trae "Descargar respaldo" (JSON, con subtareas) para cada tablero; para el respaldo completo, programa un `pg_dump` o sube al plan Pro.
- [ ] **Datos personales**: si recoges correos de personas en Colombia, la Ley 1581 de 2012 (habeas data) pide política de tratamiento de datos y una forma de solicitar eliminación. La app ya trae **Eliminar mi cuenta** en el menú. Esto es orientación general, no asesoría legal.
- [ ] **Costos**: el plan Free de Supabase pausa los proyectos sin actividad por una semana. Si esperas uso real, considera el plan Pro (25 USD/mes).

---

## 10. Ideas para la siguiente versión

- Buscar en todos los tableros a la vez, no solo en el activo
- Menciones (`@alguien`) en los comentarios, con aviso push al mencionado
- Vista previa de las imágenes adjuntas sin salir de la app
- Plantillas de tarea y tareas que se repiten
- Dependencias entre tareas («esta no empieza hasta que termine aquella»)

---

Hecho para Sharon. Licencia libre para uso y modificación.
