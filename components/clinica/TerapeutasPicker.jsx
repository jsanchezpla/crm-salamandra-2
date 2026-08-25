"use client";

/**
 * TerapeutasPicker — quién lleva a este paciente, ahora que pueden ser varios.
 *
 * Lo pidió Lau (Aumenta, 14/08/2026): «en los pacientes que tienen dos terapias,
 * cómo meter a los 2 terapeutas que tiene, porque me sale la opción solo para
 * seleccionar 1 y lo llama terapeuta principal». Y de paso preguntó si ese
 * nombre se podía cambiar.
 *
 * ── LAS TRES DECISIONES DE LA PIEZA ────────────────────────────────────────
 *
 * · **Cada fila lleva su especialidad.** Lau no pidió «dos nombres»: pidió los
 *   dos de un paciente con DOS TERAPIAS. Sin decir cuál da cada una, la lista no
 *   contesta a lo que preguntó.
 * · **El primero es el de referencia, y se dice con todas las letras.** No es
 *   cosmética: `main_therapist_id` es quien firma por defecto las sesiones y los
 *   informes, y por quien se reparte el cumplimiento de los planes. Que se pueda
 *   cambiar de sitio está bien; que se cambie sin enterarse, no.
 * · **Se ordena arrastrando lo mínimo**: subir a alguien al primer puesto es un
 *   botón, no un drag. Con dos o tres filas —el máximo real medido en producción
 *   es 3— un drag and drop es más código y más formas de romperse.
 *
 * El valor es `[{ id, specialty }]` y el orden IMPORTA: el primero es el de
 * referencia. Es la misma forma que espera `lib/clinica/terapeutas.js`.
 */

import Select from "@/components/ui/Select.jsx";
import { SPECIALTIES } from "@/lib/clinica/specialties.js";

const OPCIONES_ESPECIALIDAD = [
  { value: "", label: "— Sin precisar —" },
  ...SPECIALTIES.map((s) => ({ value: s.key, label: s.label })),
];

const inputCls =
  "w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-800 focus:outline-none focus:border-neutral-400";

export default function TerapeutasPicker({ value = [], onChange, equipo = [], max = 10 }) {
  const lista = Array.isArray(value) ? value : [];
  const usados = new Set(lista.map((t) => t.id).filter(Boolean));

  const cambiar = (i, parche) =>
    onChange(lista.map((t, j) => (j === i ? { ...t, ...parche } : t)));

  const quitar = (i) => onChange(lista.filter((_, j) => j !== i));

  const anadir = () => onChange([...lista, { id: "", specialty: null }]);

  // Subir al primer puesto = pasar a ser el de referencia.
  const hacerReferencia = (i) => {
    if (i === 0) return;
    const copia = [...lista];
    const [uno] = copia.splice(i, 1);
    onChange([uno, ...copia]);
  };

  if (equipo.length === 0) {
    // Sin módulo Equipo no hay a quién asignar. Se dice, en vez de enseñar un
    // desplegable vacío que parece roto.
    return (
      <p className="text-[11px] text-neutral-500">
        Para asignar terapeutas hace falta tener dado de alta al equipo.
      </p>
    );
  }

  return (
    <div>
      <label className="block text-[11px] font-medium text-neutral-500 mb-1.5">
        Terapeutas
      </label>

      {lista.length === 0 && (
        <p className="text-[11px] text-neutral-400 mb-2">Sin terapeuta asignado.</p>
      )}

      <div className="flex flex-col gap-2">
        {lista.map((t, i) => {
          const persona = equipo.find((m) => m.id === t.id) ?? null;
          return (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Select
                  value={t.id ?? ""}
                  onChange={(v) => cambiar(i, { id: v })}
                  className={inputCls}
                  options={[
                    { value: "", label: "— Elegir persona —" },
                    ...equipo
                      // Quien ya está en otra fila no se puede repetir: la tabla
                      // tiene un único por (paciente, persona) y el servidor lo
                      // descartaría en silencio.
                      .filter((m) => m.id === t.id || !usados.has(m.id))
                      .map((m) => ({ value: m.id, label: m.displayName })),
                  ]}
                />
                <Select
                  value={t.specialty ?? ""}
                  onChange={(v) => cambiar(i, { specialty: v || null })}
                  className={inputCls}
                  options={OPCIONES_ESPECIALIDAD}
                />
              </div>

              <div className="flex items-center gap-1 pt-1.5 shrink-0">
                {i === 0 ? (
                  <span
                    className="text-[10px] text-neutral-500 bg-neutral-100 rounded px-1.5 py-0.5 whitespace-nowrap"
                    title="Es quien firma por defecto las sesiones y los informes, y por quien se reparte el cumplimiento del plan."
                  >
                    de referencia
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => hacerReferencia(i)}
                    disabled={!t.id}
                    className="text-[10px] text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] underline underline-offset-2 disabled:opacity-40 whitespace-nowrap"
                    title="Pasa a ser quien firma por defecto"
                  >
                    hacer de referencia
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => quitar(i)}
                  aria-label={`Quitar a ${persona?.displayName ?? "esta persona"}`}
                  className="w-6 h-6 rounded flex items-center justify-center text-neutral-400 hover:text-rose-600 hover:bg-rose-50"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {lista.length < max && lista.length < equipo.length && (
        <button
          type="button"
          onClick={anadir}
          className="mt-2 text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline"
        >
          + Añadir terapeuta
        </button>
      )}
    </div>
  );
}
