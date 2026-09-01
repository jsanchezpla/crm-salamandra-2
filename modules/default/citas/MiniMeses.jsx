"use client";

/**
 * MiniMeses — la columna de meses de la agenda (31/08/2026, Rodrigo).
 *
 * «Tipo Organízate»: dos meses en miniatura —el que se está mirando y el
 * siguiente— pegados a la izquierda del calendario, con cada día clicable
 * para saltar la agenda allí. Con una diferencia querida: en Organízate la
 * columna está SIEMPRE; aquí se abre y se cierra (botón «Meses» de la
 * botonera del calendario), porque cuando no hace falta se prefiere el
 * calendario a todo lo ancho.
 *
 * No es otra instancia de FullCalendar a propósito: dos rejillas de números
 * no justifican cargar y sincronizar dos calendarios más, y así los estilos
 * son los del CRM sin pelearse con los de la librería.
 */

import { useMemo, useState } from "react";

const DIAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];

/** Fecha → "septiembre 2026", con la inicial en mayúscula. */
function nombreDelMes(y, m) {
  const s = new Date(y, m, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  const limpio = s.replace(" de ", " ");
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

/** Las celdas de un mes: huecos hasta el lunes + los días. */
function celdasDelMes(y, m) {
  const primerDia = new Date(y, m, 1);
  const huecos = (primerDia.getDay() + 6) % 7; // lunes = 0
  const dias = new Date(y, m + 1, 0).getDate();
  return [...Array(huecos).fill(null), ...Array.from({ length: dias }, (_, i) => i + 1)];
}

function Mes({ y, m, hoyMs, vista, alPulsarDia }) {
  const celdas = useMemo(() => celdasDelMes(y, m), [y, m]);
  return (
    <div>
      <div className="text-[12px] font-semibold text-[var(--ink-700)] mb-1.5">{nombreDelMes(y, m)}</div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {DIAS_SEMANA.map((d, i) => (
          <span key={`h${i}`} className="text-center text-[10px] font-medium text-[var(--ink-400)]">
            {d}
          </span>
        ))}
        {celdas.map((dia, i) => {
          if (dia === null) return <span key={`v${i}`} />;
          const ms = new Date(y, m, dia).getTime();
          const esHoy = ms === hoyMs;
          // ¿Está este día dentro de lo que enseña el calendario grande?
          const enVista = vista && ms >= vista.start && ms < vista.end;
          return (
            <button
              key={dia}
              type="button"
              onClick={() => alPulsarDia(new Date(y, m, dia))}
              className={`h-6 w-6 mx-auto rounded-full text-[11px] leading-none transition-colors ${
                esHoy
                  ? "bg-[var(--color-primary,#1B3A2D)] text-white font-bold"
                  : enVista
                    ? "bg-[var(--ink-150)] text-[var(--ink-900)] font-semibold"
                    : "text-[var(--ink-600)] hover:bg-[var(--ink-100)]"
              }`}
            >
              {dia}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * `vista` = { start, end, current } en milisegundos, lo que enseña el
 * calendario grande (datesSet). Los meses pintados siguen a la vista; las
 * flechas de arriba los adelantan o atrasan por si hay que saltar más lejos,
 * y ese adelanto se olvida en cuanto el calendario grande cambia de mes.
 */
export default function MiniMeses({ vista, alPulsarDia }) {
  const base = new Date(vista?.current ?? 0);
  const claveBase = `${base.getFullYear()}-${base.getMonth()}`;
  // El adelanto de las flechas va atado al mes al que se le aplicó: en cuanto
  // el calendario grande cambia de mes, la clave ya no casa y vale 0 otra vez.
  const [desfase, setDesfase] = useState({ clave: claveBase, offset: 0 });
  const offset = desfase.clave === claveBase ? desfase.offset : 0;
  const mover = (paso) => setDesfase({ clave: claveBase, offset: offset + paso });
  // Hasta el primer datesSet no se sabe qué mes se mira: nada que pintar.
  if (!vista) return null;

  const hoy = new Date();
  const hoyMs = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
  const meses = [0, 1].map((n) => {
    const d = new Date(base.getFullYear(), base.getMonth() + offset + n, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  return (
    <div className="w-52 shrink-0 overflow-y-auto flex flex-col gap-4 pr-3 border-r border-[var(--ink-150)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-[var(--ink-400)]">Ir a un día</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Meses anteriores"
            onClick={() => mover(-1)}
            className="h-5 w-5 rounded text-[var(--ink-500)] hover:bg-[var(--ink-100)] leading-none"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Meses siguientes"
            onClick={() => mover(1)}
            className="h-5 w-5 rounded text-[var(--ink-500)] hover:bg-[var(--ink-100)] leading-none"
          >
            ›
          </button>
        </div>
      </div>
      {meses.map(({ y, m }) => (
        <Mes key={`${y}-${m}`} y={y} m={m} hoyMs={hoyMs} vista={vista} alPulsarDia={alPulsarDia} />
      ))}
    </div>
  );
}
