/**
 * Back-office interno de Salamandra.
 *
 * MISMA TIPOGRAFÍA Y MISMOS COLORES QUE EL CRM (06/08/2026, a petición de
 * Jorge). Antes era una sala de máquinas oscura, distinta a propósito para que
 * se notara de un vistazo en qué pantalla estabas. Se cambia porque mantener dos
 * lenguajes visuales cuesta el doble y envejece mal: cada arreglo del CRM había
 * que traducirlo aquí a mano.
 *
 * PERO la propiedad que aquella decisión protegía sigue haciendo falta: este
 * panel toca la configuración de TODOS los clientes a la vez, y confundirlo con
 * el CRM de uno solo es exactamente el error caro. Ahora eso lo dice la franja
 * superior —«panel interno», con el nombre delante— en vez del color de fondo.
 * Si algún día se quita esa franja, hay que poner otra señal en su sitio.
 *
 * Solo se sirve desde ADMIN_HOST (ver middleware.js); en el host de los clientes
 * estas rutas dan 404.
 */
import { Fraunces, Poppins } from "next/font/google";

const display = Fraunces({
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  variable: "--admin-display",
  display: "swap",
});

const texto = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--admin-mono",
  display: "swap",
});

export const metadata = {
  title: "Custodia — Salamandra",
  robots: { index: false, follow: false, nocache: true },
};

const SECCIONES = [
  // El tablero va primero: es lo que se mira al empezar el día.
  { href: "/admin/tablero", texto: "Tablero" },
  { href: "/admin", texto: "Custodia" },
  { href: "/admin/modulos", texto: "Módulos" },
  { href: "/admin/clientes", texto: "Alta de clientes" },
];

export default function AdminLayout({ children }) {
  return (
    <div
      className={`${display.variable} ${texto.variable} min-h-screen`}
      style={{
        // Los mismos tonos del CRM (app/globals.css). Se mapean a los nombres
        // que ya usaban estas pantallas para no reescribirlas enteras.
        "--bg": "#FAF8F5",
        "--panel": "#FFFFFF",
        "--panel-alto": "#F4F0EA",
        "--line": "#E0DACE",
        "--line-suave": "#ECE7DE",
        "--text": "#15140F",
        "--dim": "#4F4942",
        "--tenue": "#6E665B",
        // El verde de Salamandra, el mismo que el CRM usa como primario.
        "--ok": "#1B3A2D",
        // El único color que grita. Se reserva para "sin cifrar".
        "--alerta": "#B45309",
        "--apagado": "#C5BDAE",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "var(--admin-mono), ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <nav
        className="flex items-center gap-1 px-6 lg:px-12 h-12"
        style={{ borderBottom: "1px solid var(--line)", background: "var(--panel)" }}
      >
        {/* La señal de "no estás en el CRM de un cliente". Antes lo decía el
            fondo negro; ahora lo dice esto, y por eso va en color pleno y no
            como un rótulo más de la barra. */}
        <span
          className="text-[11px] uppercase tracking-[0.16em] mr-5 px-2.5 py-1 rounded font-semibold text-white"
          style={{ background: "var(--ok)" }}
        >
          Salamandra · panel interno
        </span>
        {SECCIONES.map((s) => (
          <a
            key={s.href}
            href={s.href}
            className="text-[12px] px-3 py-1.5 rounded transition-colors"
            style={{ color: "var(--dim)" }}
          >
            {s.texto}
          </a>
        ))}
        <a
          href="/api/auth/logout"
          className="ml-auto text-[11px] uppercase tracking-[0.16em]"
          style={{ color: "var(--tenue)" }}
        >
          salir
        </a>
      </nav>
      {children}
    </div>
  );
}
