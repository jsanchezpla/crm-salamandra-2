/**
 * Calendario global de Salamandra (03/09/2026, Rodrigo; ampliado el
 * 12/09/2026).
 *
 * Su propio host (calendar.salamandrasolutions.com): los calendarios y, desde
 * el 12/09, los proyectos de varios clientes a la vez. No cuelga del layout
 * del dashboard a propósito: aquel monta el menú de UN tenant, su marca y el
 * reinicio de la demo, y aquí nada de eso pinta. Lo único que se comparte es
 * el mantenimiento de la sesión (SessionKeeper) y el botón de salir.
 *
 * ── LA CABECERA (12/09/2026) ────────────────────────────────────────────────
 * Marca a la izquierda, pestañas «Calendario | Proyectos» y, a la derecha, la
 * cuenta y «Salir». Las pestañas y la cuenta son componentes cliente
 * (`components/calendario-global/`) porque este layout es de servidor —exporta
 * `metadata`— y no sabe ni la ruta ni quién mira.
 *
 * Alto: en escritorio la página ocupa exactamente la ventana (`lg:h-dvh`) para
 * que la barra de clientes y el contenido se desplacen cada uno por su lado;
 * en el móvil crece y se desplaza entera, que es lo natural con el pulgar.
 *
 * Solo se sirve desde CALENDAR_HOST (ver middleware.js); en el resto de
 * hosts esta ruta da 404.
 */
import SessionKeeper from "../../components/auth/SessionKeeper.jsx";
import Pestanas from "../../components/calendario-global/Pestanas.jsx";
import CabeceraCuenta from "../../components/calendario-global/CabeceraCuenta.jsx";

export const metadata = {
  title: "Salamandra · Calendario y proyectos",
  robots: { index: false, follow: false, nocache: true },
};

export default function CalendarioGlobalLayout({ children }) {
  return (
    <div
      className="min-h-dvh lg:h-dvh flex flex-col bg-[#F7F7F4] text-[#1C2B27]"
      style={{ fontFamily: "var(--font-poppins), system-ui, sans-serif" }}
    >
      <SessionKeeper />
      <header className="h-12 shrink-0 flex items-stretch gap-3 sm:gap-6 px-3 sm:px-5 bg-[#1F3B34] text-white">
        <div className="flex items-center shrink-0">
          <span className="text-[15px] font-semibold tracking-tight">Salamandra</span>
        </div>
        <Pestanas />
        <div className="ml-auto flex items-center min-w-0">
          <CabeceraCuenta />
        </div>
      </header>
      <main className="flex-1 min-h-0 flex flex-col">{children}</main>
    </div>
  );
}
