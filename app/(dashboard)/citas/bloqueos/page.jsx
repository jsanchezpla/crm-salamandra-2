"use client";

/**
 * Bloqueos — vacaciones y ausencias del equipo, en su propia pantalla.
 *
 * ANTES VIVÍA DEBAJO DEL CATÁLOGO DE TIPOS DE CITA (06/08/2026): Rodrigo lo
 * había pedido como «un tipo de cita especial», así que se puso donde iba a
 * buscarlo. Pero no es un tipo de cita —no lo es por dentro ni por fuera— y
 * dejaba la pantalla de Tipos con dos cosas distintas apiladas: había que
 * bajar por el catálogo entero para llegar a apuntar unas vacaciones.
 *
 * Desde el 12/08/2026 (Rodrigo) es una pantalla más de Citas, y se llega desde
 * el botón «Bloqueos» que está al lado de «Tipos de cita» y «Disponibilidad»
 * en las tres cabeceras del módulo.
 *
 * LO USA TODO EL EQUIPO, no solo dirección: quien se va de vacaciones tiene que
 * poder apuntarlo sin pedírselo a nadie. El detalle de por qué y de las reglas
 * de quién puede poner ausencias a quién está en `PanelVacaciones`.
 */

import Link from "next/link";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import PanelVacaciones from "../../../../components/citas/PanelVacaciones.jsx";

export default function CitasBloqueosPage() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-6 lg:px-10 pt-8 pb-5 flex items-end justify-between shrink-0 border-b border-[var(--ink-200)] gap-6 flex-wrap">
        <div>
          <div className="eyebrow mb-1.5 lg:mb-2">Tiempo · Configuración</div>
          <h1 className="font-display text-[24px] lg:text-[34px] leading-[1.05] text-[var(--ink-900)] tracking-tight flex items-center gap-2 flex-wrap">
            <span>
              Citas <span className="font-display-italic text-[var(--ink-400)]">— bloqueos</span>
            </span>
            <HelpTooltip title="Bloqueos" placement="bottom">
              Tramos en los que alguien no pasa consulta: vacaciones, una tarde de formación, una
              baja. La agenda deja de ofrecer sus huecos mientras dure.
              {" "}
              <strong className="text-white">No es lo mismo que un festivo</strong>: el festivo
              cierra el centro entero un día y se pone desde el calendario; esto es de una persona
              y con hora de inicio y de fin.
            </HelpTooltip>
          </h1>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Link
            href="/citas"
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
          >
            Calendario
          </Link>
          <Link
            href="/citas/tipos"
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
          >
            Tipos de cita
          </Link>
          <Link
            href="/citas/disponibilidad"
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
          >
            Disponibilidad
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 lg:px-10 py-6">
        {/* 7xl y centrado, como el resto del CRM (24/08/2026): dentro hay una
            rejilla de CUATRO columnas que a 4xl salían a 200 px, y además el
            contenedor no llevaba `mx-auto`, así que dejaba 764 px de blanco
            a la derecha en una pantalla de 1920 y nada a la izquierda. */}
        <div className="max-w-7xl mx-auto">
          <PanelVacaciones />
        </div>
      </div>
    </div>
  );
}
