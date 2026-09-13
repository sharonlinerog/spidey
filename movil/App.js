/**
 * Spidey para Android — cascarón nativo en React Native.
 *
 * Qué hace este archivo y qué NO hace:
 *
 * La interfaz de Spidey (tablero, lista, calendario, indicadores, fichas de
 * tarea) vive en la web y se renderiza dentro de un WebView. Reescribirla en
 * componentes nativos serían miles de líneas duplicadas que se separarían de
 * la web a la primera corrección, y el Kanban con arrastre habría que
 * reinventarlo entero.
 *
 * Lo que sí aporta esta capa nativa, y que un navegador no da:
 *   - un APK instalable y distribuible,
 *   - pantalla de arranque propia, sin barra de direcciones,
 *   - el botón físico "atrás" de Android navegando dentro de la app en vez
 *     de cerrarla de golpe,
 *   - una pantalla honesta cuando no hay internet, con botón de reintentar,
 *   - los enlaces externos y los adjuntos abriéndose en el navegador del
 *     sistema, no dentro de la app.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import NetInfo from "@react-native-community/netinfo";
import Constants from "expo-constants";
import * as SplashScreen from "expo-splash-screen";

/* La paleta de la web, para que el arranque no parpadee en blanco. */
const COLOR = {
  papel: "#101010",
  hoja: "#141414",
  tinta: "#EDEDED",
  tinta2: "#C8C8C8",
  tinta3: "#8F8F8F",
  sello: "#D30000",
  linea: "rgba(211,0,0,.28)",
};

const APP_URL =
  (Constants.expoConfig &&
    Constants.expoConfig.extra &&
    Constants.expoConfig.extra.appUrl) ||
  "https://spidey.vercel.app";

const DOMINIO = (() => {
  try {
    return new URL(APP_URL).hostname;
  } catch {
    return "";
  }
})();

// La pantalla de arranque se queda hasta que la web haya pintado algo.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const webview = useRef(null);
  const [puedeVolver, setPuedeVolver] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  const [hayRed, setHayRed] = useState(true);

  /* ---------------- conexión ---------------- */

  useEffect(() => {
    return NetInfo.addEventListener((estado) => {
      // `isInternetReachable` puede venir en null mientras se averigua; en
      // ese caso no hay que declarar la app sin conexión todavía.
      const conectado =
        estado.isConnected && estado.isInternetReachable !== false;
      setHayRed(!!conectado);
    });
  }, []);

  /* ---------------- botón atrás de Android ---------------- */

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (puedeVolver && webview.current) {
        webview.current.goBack();
        return true; // consumido: no se cierra la app
      }
      return false; // sin historial: que Android haga lo suyo
    });
    return () => sub.remove();
  }, [puedeVolver]);

  /* ---------------- navegación ---------------- */

  /**
   * Todo lo que no sea nuestro dominio sale al navegador del sistema: los
   * adjuntos (que llegan como URL firmada de Supabase Storage), los enlaces
   * que alguien pegue en una nota y los correos de confirmación.
   */
  const decidirNavegacion = useCallback((peticion) => {
    const url = peticion.url || "";

    if (url.startsWith("about:") || url.startsWith("data:")) return true;

    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      return true; // rutas relativas y demás: adentro
    }

    if (host === DOMINIO || host.endsWith("." + DOMINIO)) return true;

    Linking.openURL(url).catch(() => {});
    return false;
  }, []);

  const recargar = useCallback(() => {
    setFallo(null);
    setCargando(true);
    if (webview.current) webview.current.reload();
  }, []);

  const alRefrescar = useCallback(() => {
    setRefrescando(true);
    if (webview.current) webview.current.reload();
    // El indicador se retira solo: si la recarga falla, dejarlo girando para
    // siempre sería peor que quitarlo un momento antes de tiempo.
    setTimeout(() => setRefrescando(false), 1200);
  }, []);

  const alTerminarCarga = useCallback(() => {
    setCargando(false);
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  /* ---------------- pantallas de error ---------------- */

  if (!hayRed || fallo) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor={COLOR.papel} />
        <SafeAreaView style={estilos.fondo}>
          <ScrollView
            contentContainerStyle={estilos.centro}
            refreshControl={
              <RefreshControl
                refreshing={refrescando}
                onRefresh={alRefrescar}
                tintColor={COLOR.sello}
                colors={[COLOR.sello]}
              />
            }
          >
            <View style={estilos.marca}>
              <Text style={estilos.marcaTexto}>SPIDEY</Text>
            </View>
            <Text style={estilos.tituloError}>
              {hayRed ? "No se pudo abrir Spidey" : "Sin conexión"}
            </Text>
            <Text style={estilos.textoError}>
              {hayRed
                ? "El servidor no respondió. Puede ser algo pasajero."
                : "Revisa tu internet. Spidey vuelve solo en cuanto haya señal."}
            </Text>
            <TouchableOpacity
              style={estilos.boton}
              onPress={recargar}
              accessibilityRole="button"
            >
              <Text style={estilos.botonTexto}>Reintentar</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  /* ---------------- la app ---------------- */

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor={COLOR.papel} />
      <SafeAreaView style={estilos.fondo} edges={["top", "left", "right"]}>
        <WebView
          ref={webview}
          source={{ uri: APP_URL }}
          style={estilos.web}
          // Fondo del color de la app: sin esto el WebView destella en
          // blanco durante el primer cuadro, y duele en modo oscuro.
          containerStyle={estilos.fondo}
          // La sesión de Supabase vive en localStorage; sin esto habría que
          // entrar con la contraseña en cada arranque.
          domStorageEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          javaScriptEnabled
          // Los enlaces con target="_blank" —así abre Spidey los adjuntos—
          // se convierten en navegación normal y los atrapa
          // onShouldStartLoadWithRequest, en vez de abrir una ventana ciega.
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={decidirNavegacion}
          onNavigationStateChange={(e) => setPuedeVolver(e.canGoBack)}
          onLoadEnd={alTerminarCarga}
          onError={(e) => setFallo(e.nativeEvent.description || "error")}
          onHttpError={(e) => {
            // Un 404 en un recurso suelto no debe tumbar la app entera;
            // solo importa si falla el documento principal.
            if (e.nativeEvent.url === APP_URL) setFallo("http");
          }}
          // Estas dos solo hacen algo en iOS; en Android son inocuas.
          pullToRefreshEnabled
          allowsBackForwardNavigationGestures
          // Para adjuntar archivos desde la ficha de tarea.
          allowFileAccess
          mediaPlaybackRequiresUserAction
          originWhitelist={["https://*"]}
        />

        {cargando && (
          <View style={estilos.cargando} pointerEvents="none">
            <ActivityIndicator size="large" color={COLOR.sello} />
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const estilos = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: COLOR.papel },
  web: { flex: 1, backgroundColor: COLOR.papel },
  cargando: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLOR.papel,
  },
  centro: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  marca: { marginBottom: 28 },
  marcaTexto: {
    color: COLOR.sello,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 6,
  },
  tituloError: {
    color: COLOR.tinta,
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 10,
  },
  textoError: {
    color: COLOR.tinta3,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 28,
    maxWidth: 320,
  },
  boton: {
    backgroundColor: COLOR.sello,
    paddingVertical: 14,
    paddingHorizontal: 34,
    borderRadius: 12,
  },
  botonTexto: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
});
