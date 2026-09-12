# Spidey para Android

App nativa en **React Native + Expo** que renderiza Spidey. Produce un **APK instalable** sin que tengas que instalar Android Studio: el build corre en los servidores de Expo.

---

## Qué es y qué no es

La interfaz de Spidey —tablero Kanban con arrastre, lista, calendario, indicadores, fichas de tarea— vive en la web. Esta app la renderiza dentro de un `WebView` de React Native.

**Por qué así y no reescrita en componentes nativos:** serían varios miles de líneas duplicadas que se separarían de la web a la primera corrección, y el arrastre de tarjetas entre columnas habría que reinventarlo. Una sola base de código, dos formas de instalarla.

**Lo que sí aporta la capa nativa** (y un navegador no da):

| | |
|---|---|
| APK instalable | Se comparte por WhatsApp, correo o se sube a Google Play |
| Arranque propio | Pantalla de carga con la marca, sin barra de direcciones |
| Botón atrás de Android | Navega dentro de la app en vez de cerrarla de golpe |
| Sin conexión | Pantalla honesta con botón de reintentar, no un error del navegador |
| Adjuntos y enlaces | Se abren en el navegador del sistema, no atrapados dentro |
| Sesión persistente | Entras una vez; no pide la contraseña en cada arranque |

**Lo que pierdes frente a la PWA instalada:** los **recordatorios push no llegan** dentro del WebView. El Web Push de Android no funciona ahí; haría falta Firebase Cloud Messaging y un envío aparte desde el servidor. Si los recordatorios te importan, la PWA instalada desde Chrome («Agregar a pantalla de inicio») sigue siendo la mejor opción — o dímelo y lo monto con FCM.

---

## Antes de compilar

1. **Publica primero la web.** El APK no lleva la app dentro: apunta a tu URL. Sin la web desplegada no hay nada que mostrar.
2. **Pon tu URL** en `app.json` → `expo.extra.appUrl`. Es lo único obligatorio de cambiar:

   ```json
   "appUrl": "https://spidey.tudominio.com"
   ```

3. **Pon tu identificador de paquete** en `app.json` → `expo.android.package`. Debe ser único en todo Google Play y **no se puede cambiar después de publicar**. Usa un dominio tuyo al revés:

   ```json
   "package": "co.rbcol.spidey"
   ```

---

## Compilar el APK

Necesitas Node 18+ y una cuenta gratuita en [expo.dev](https://expo.dev).

```bash
cd movil
npm install
npm install -g eas-cli
eas login
eas build:configure      # solo la primera vez: crea el projectId
npm run apk              # compila en la nube (~10-15 min)
```

Al terminar te da un enlace de descarga y un código QR. Abres ese enlace desde el celular Android, descargas el `.apk` y lo instalas. Android pedirá permiso para «instalar apps de orígenes desconocidos» — es normal en un APK que no viene de Play Store.

### Probarlo antes de compilar

```bash
npm start
```

Escanea el QR con la app **Expo Go** del celular. Recarga en caliente, sin esperar el build.

### Para publicarlo en Google Play

```bash
npm run aab
```

Genera un `.aab` firmado, que es el formato que exige Play. Necesitas la cuenta de desarrollador de Google (pago único de 25 USD).

---

## Actualizar la app

Aquí está lo bueno del enfoque: **si cambias la web, el APK se actualiza solo**. La app carga tu URL en cada arranque, así que un `git push` a Vercel llega a todos los teléfonos sin recompilar ni volver a instalar nada.

Solo hay que generar un APK nuevo si cambias algo de esta carpeta: el ícono, la pantalla de arranque, el nombre, la URL o el comportamiento nativo. En ese caso sube `expo.version` y `expo.android.versionCode` en `app.json` antes de compilar.

---

## Si algo falla

```bash
npm run doctor           # revisa que las versiones encajen entre sí
npx expo install --fix   # alinea las dependencias con el SDK instalado
```

Estas versiones están fijadas al **SDK 51 de Expo**. Si al compilar EAS te dice que ese SDK ya no tiene soporte:

```bash
npx expo install expo@latest
npx expo install --fix
```

**Pantalla en blanco al abrir:** casi siempre es `appUrl` mal escrita o la web sin desplegar. Ábrela primero en el navegador del celular.

**Error de conexión y la web sí carga en el navegador:** revisa el `Content-Security-Policy` de `vercel.json` — tiene la URL de Supabase escrita a mano y debe ser la de tu proyecto.
