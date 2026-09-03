/**
 * Calendario global de Salamandra (03/09/2026, Rodrigo).
 *
 * Una sola pantalla en su propio host (calendar.salamandrasolutions.com):
 * los calendarios de varios clientes a la vez. No cuelga del layout del
 * dashboard a propósito: aquel monta el menú de UN tenant, su marca y el
 * reinicio de la demo, y aquí nada de eso pinta. Lo único que se comparte
 * es el mantenimiento de la sesión (SessionKeeper) y el botón de salir.
 *
 * Solo se sirve desde CALENDAR_HOST (ver middleware.js); en el resto de
 * hosts esta ruta da 404.
 */
import SalirBoton from "../../components/admin/SalirBoton.jsx";
import SessionKeeper from "../../components/auth/SessionKeeper.jsx";

export const metadata = {
  title: "Calendario global — Salamandra",
  robots: { index: false, follow: false, nocache: true },
};

export default function CalendarioGlobalLayout({ children }) {
  return (
    <div className="min-h-dvh flex flex-col bg-[#FAFAF8] text-neutral-900" style={{ fontFamily: "var(--font-poppins), system-ui, sans-serif" }}>
      <SessionKeeper />
      <header className="h-12 shrink-0 flex items-center justify-between px-4 lg:px-6 bg-[#1B3A2D] text-white">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <span className="text-[15px] font-semibold tracking-tight">Salamandra</span>
          <span className="text-[12px] text-white/70 truncate">calendario global</span>
        </div>
        <SalirBoton className="text-[12px] text-white/80 hover:text-white px-2 py-1" />
      </header>
      <main className="flex-1 min-h-0 flex flex-col">{children}</main>
    </div>
  );
}
