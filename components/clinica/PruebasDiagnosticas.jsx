"use client";

/**
 * components/clinica/PruebasDiagnosticas.jsx — «Resultados de la evaluación»
 * del informe de valoración diagnóstica (05/09/2026, AV-0045 de Aumenta).
 *
 * Isabel Alberca: «un apartado donde pudiéramos seleccionar las pruebas
 * utilizadas en cada paciente. Cada prueba debería abrir automáticamente una
 * estructura con tres subapartados: breve descripción de la prueba,
 * resultados —puntuaciones directas, escalares, típicas, percentiles,
 * índices, clasificaciones— y conclusiones. Lo ideal sería que no aparecieran
 * todas las pruebas en todos los informes, sino que el profesional pudiera
 * seleccionar únicamente las administradas».
 *
 * Eso es exactamente esto: se elige un área, se elige una prueba del catálogo
 * (`/api/clinica/pruebas`: las de fábrica más las del centro) y se abre su
 * tarjeta con los tres subapartados. La descripción viene rellena con lo que
 * evalúa la prueba según el catálogo y se puede retocar. La tabla es de cinco
 * columnas para todas —`pruebasDiagnosticas.js` explica por qué— y las
 * columnas vacías no se imprimen.
 *
 * Es un componente CONTROLADO: `pruebas` y `onChange`. Quien lo monta
 * (`InformeEditor`) guarda la lista en `contentSections.pruebas`.
 */

import { useEffect, useMemo, useState } from "react";
import Select from "@/components/ui/Select.jsx";
import { COLUMNAS_PUNTUACION } from "@/lib/clinica/pruebasDiagnosticas.js";

const INPUT = "w-full px-2 py-1.5 text-xs border border-neutral-200 rounded-md focus:outline-none focus:border-neutral-400";
const TA = "w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed";

const filaVacia = () => Object.fromEntries(COLUMNAS_PUNTUACION.map((c) => [c.key, ""]));

export default function PruebasDiagnosticas({ pruebas = [], onChange, disabled = false }) {
  const [catalogo, setCatalogo] = useState({ pruebas: [], areas: [] });
  const [area, setArea] = useState("");
  const [elegida, setElegida] = useState("");

  useEffect(() => {
    fetch("/api/clinica/pruebas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.ok && setCatalogo({ pruebas: j.data.pruebas ?? [], areas: j.data.areas ?? [] }))
      .catch(() => {});
  }, []);

  const delArea = useMemo(
    () => catalogo.pruebas.filter((p) => !area || p.areas?.includes(area)),
    [catalogo, area]
  );
  const nombreDeArea = (k) => catalogo.areas.find((a) => a.key === k)?.nombre ?? "";

  function anadir() {
    const p = catalogo.pruebas.find((x) => x.key === elegida);
    if (!p) return;
    onChange([
      ...pruebas,
      { key: p.key, nombre: p.nombre, area: area || p.areas?.[0] || "", descripcion: p.uso ?? "", resultados: [filaVacia()], interpretacion: "" },
    ]);
    setElegida("");
  }
  const cambia = (i, cambios) => onChange(pruebas.map((p, idx) => (idx === i ? { ...p, ...cambios } : p)));
  const quita = (i) => onChange(pruebas.filter((_, idx) => idx !== i));
  const cambiaFila = (i, j, campo, v) =>
    cambia(i, { resultados: pruebas[i].resultados.map((f, idx) => (idx === j ? { ...f, [campo]: v } : f)) });

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-4">
      <div>
        <div className="eyebrow">Resultados de la evaluación</div>
        <p className="text-[11px] text-neutral-500 mt-1">
          Elige solo las pruebas administradas. Cada una lleva qué evalúa, su tabla de puntuaciones y tu
          interpretación; en el PDF salen detrás de «Pruebas administradas».
        </p>
      </div>

      {!disabled && (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_auto] gap-2 items-end">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Área</label>
            <Select
              value={area}
              onChange={(v) => { setArea(v); setElegida(""); }}
              options={[{ value: "", label: "Todas las áreas" }, ...catalogo.areas.map((a) => ({ value: a.key, label: a.nombre }))]}
              className={INPUT}
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Prueba</label>
            <Select
              value={elegida}
              onChange={setElegida}
              options={[{ value: "", label: "— Elige una prueba —" }, ...delArea.map((p) => ({ value: p.key, label: `${p.nombre}${p.deFabrica ? "" : " (del centro)"}` }))]}
              className={INPUT}
            />
          </div>
          <button
            type="button"
            onClick={anadir}
            disabled={!elegida}
            className="text-xs font-medium px-3 py-2 rounded-lg text-white disabled:opacity-40"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            Añadir
          </button>
        </div>
      )}

      {pruebas.length === 0 && (
        <p className="text-[11px] text-neutral-400">Todavía no hay ninguna prueba en este informe.</p>
      )}

      {pruebas.map((p, i) => (
        <div key={`${p.key}-${i}`} className="rounded-lg border border-neutral-200 p-3 space-y-2.5 bg-neutral-50/40">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-neutral-800">{p.nombre}</div>
              {p.area && <div className="text-[10px] text-neutral-400">{nombreDeArea(p.area) || p.area}</div>}
            </div>
            {!disabled && (
              <button type="button" onClick={() => quita(i)} className="text-[11px] text-neutral-400 hover:text-rose-600 shrink-0">
                Quitar
              </button>
            )}
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Qué evalúa</label>
            <textarea rows={2} value={p.descripcion} disabled={disabled} onChange={(e) => cambia(i, { descripcion: e.target.value })} className={`mt-0.5 ${TA}`} />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Resultados</label>
            <div className="mt-0.5 overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-neutral-400">
                    {COLUMNAS_PUNTUACION.map((c) => (
                      <th key={c.key} className="font-medium pb-1 pr-2 whitespace-nowrap">{c.label}</th>
                    ))}
                    {!disabled && <th />}
                  </tr>
                </thead>
                <tbody>
                  {p.resultados.map((f, j) => (
                    <tr key={j}>
                      {COLUMNAS_PUNTUACION.map((c) => (
                        <td key={c.key} className="pr-2 pb-1.5">
                          <input value={f[c.key] ?? ""} disabled={disabled} onChange={(e) => cambiaFila(i, j, c.key, e.target.value)} className={INPUT} />
                        </td>
                      ))}
                      {!disabled && (
                        <td className="pb-1.5">
                          <button
                            type="button"
                            onClick={() => cambia(i, { resultados: p.resultados.filter((_, idx) => idx !== j) })}
                            className="text-neutral-300 hover:text-rose-600 text-base leading-none"
                            aria-label="Quitar fila"
                          >
                            ×
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!disabled && (
              <button
                type="button"
                onClick={() => cambia(i, { resultados: [...p.resultados, filaVacia()] })}
                className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline mt-1"
              >
                + Añadir fila
              </button>
            )}
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Interpretación clínica</label>
            <textarea rows={3} value={p.interpretacion} disabled={disabled} onChange={(e) => cambia(i, { interpretacion: e.target.value })} className={`mt-0.5 ${TA}`} placeholder="Qué significan estos resultados para este paciente" />
          </div>
        </div>
      ))}
    </div>
  );
}
