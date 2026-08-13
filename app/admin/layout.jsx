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

import CampanaBuzon from "../../components/admin/CampanaBuzon.jsx";
import SalirBoton from "../../components/admin/SalirBoton.jsx";
import SessionKeeper from "../../components/auth/SessionKeeper.jsx";

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
  // Va primero: es lo que se mira al empezar el día.
  //
  // La RUTA sigue siendo /admin/tablero a propósito (Jorge, 10/08/2026, pidió
  // cambiar el rótulo). Renombrarla obligaría a tocar enlaces y rompería
  // cualquier marcador ya guardado, y lo que se lee es esta palabra.
  { href: "/admin/tablero", texto: "Registro" },
  // Justo detrás del Registro porque es la otra bandeja de entrada del día, y
  // la única que la escribe gente de fuera: aquí caen los avisos que los
  // clientes nos mandan desde su propio CRM (13/08/2026).
  { href: "/admin/buzon", texto: "Buzón" },
  { href: "/admin", texto: "Custodia" },
  { href: "/admin/modulos", texto: "Módulos" },
  // Va pegada a Módulos porque son la misma pregunta en dos pasos: qué tiene
  // cada cliente, y qué se hablan entre sí las cosas que tiene.
  { href: "/admin/integraciones", texto: "Integraciones" },
  // Justo antes de «Alta de clientes» porque es lo que la alimenta: un paquete
  // no es más que un atajo para marcar casillas ahí.
  { href: "/admin/paquetes", texto: "Paquetes" },
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
        <div className="ml-auto flex items-center gap-4">
          {/* Lo que nos han escrito los clientes y no hemos mirado. Va en la
              BARRA y no dentro del buzón porque el buzón es la única pantalla
              donde ya se veía, y es justo la que no estás mirando cuando entra
              algo (Jorge, 13/08/2026). */}
          <CampanaBuzon />
          {/* Era un <a> a /api/auth/logout, o sea un GET, y ese endpoint solo
              entiende POST: daba 405 y no cerraba sesión. El porqué de que sea
              un botón y no un enlace está en el propio componente. */}
          <SalirBoton
            className="text-[11px] uppercase tracking-[0.16em] cursor-pointer hover:opacity-70 transition-opacity disabled:opacity-40"
            style={{ color: "var(--tenue)" }}
          />
        </div>
      </nav>
      {/* La sesión del panel duraba 15 MINUTOS y la del CRM 7 días, y no era
          una decisión: es que esto solo estaba montado en el layout del
          dashboard. El access token vive 15 min y quien lo renueva es este
          componente llamando a `/api/auth/refresh` cada 12; aquí no lo llamaba
          nadie, así que a los 15 minutos el middleware te mandaba a /login en
          mitad de lo que estuvieras haciendo.

          Que la puerta ya estaba preparada para el panel se ve en el propio
          endpoint (`app/api/auth/refresh/route.js`): comprueba que la cuenta
          corresponde al host y ARRASTRA el sello `bo`, con un comentario que
          describe exactamente este fallo. Estaba todo hecho menos llamarlo.
          (13/08/2026, lo pidió Jorge.) */}
      <SessionKeeper />
      {children}
    </div>
  );
}
