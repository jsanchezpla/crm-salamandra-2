/**
 * Back-office interno de Salamandra.
 *
 * Deliberadamente NO comparte el aspecto del CRM de clientes. El CRM es cálido y
 * de cara al cliente; esto es la sala de máquinas: oscuro, denso y de lectura
 * rápida. Que se distingan de un vistazo es una medida de seguridad barata —
 * saber en qué pantalla estás antes de tocar nada.
 *
 * Solo se sirve desde ADMIN_HOST (ver middleware.js); en el host de los clientes
 * estas rutas dan 404.
 */
import { Instrument_Serif, IBM_Plex_Mono } from "next/font/google";

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--admin-display",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--admin-mono",
  display: "swap",
});

export const metadata = {
  title: "Custodia — Salamandra",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }) {
  return (
    <div
      className={`${serif.variable} ${mono.variable} min-h-screen`}
      style={{
        // Negro CÁLIDO, no el gris azulado de siempre.
        "--bg": "#0C0B0A",
        "--panel": "#131110",
        "--panel-alto": "#191614",
        "--line": "#272220",
        "--line-suave": "#1C1917",
        "--text": "#E9E4DC",
        "--dim": "#8A8078",
        "--tenue": "#5A534D",
        // Verde salvia: guiña al verde de Salamandra sin usarlo como relleno.
        "--ok": "#7BA98D",
        // Ámbar: el único color que grita. Se reserva para "sin cifrar".
        "--alerta": "#D08A3C",
        "--apagado": "#332E2B",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "var(--admin-mono), ui-monospace, monospace",
        // Retícula finísima de fondo: textura de panel, no decoración.
        backgroundImage:
          "linear-gradient(var(--line-suave) 1px, transparent 1px), linear-gradient(90deg, var(--line-suave) 1px, transparent 1px)",
        backgroundSize: "56px 56px",
      }}
    >
      {children}
    </div>
  );
}
