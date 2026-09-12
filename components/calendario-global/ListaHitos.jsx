"use client";

import { useId, useState } from "react";
import Chip from "./Chip.jsx";
import { FOCO } from "./estilos.js";
import { ESTADO_HITO, FECHA, diaCorto, hoyMadrid } from "./formato.js";

/**
 * ListaHitos — los hitos de un proyecto junto a su tablero, en la pestaña
 * Proyectos del calendario global (12/09/2026).
 *
 * Solo se cambia la FECHA, y solo de los pendientes: es lo mismo que se puede
 * hacer arrastrándolos en el calendario, y lo único que el servidor acepta
 * (`cambiarFechaHito`). Un hito completado o no cumplido enseña su fecha
 * quieta: moverla dejaría el estado mintiendo.
 *
 * La fecha se abre con un clic en ella y se guarda con «Guardar», por lo mismo
 * que en `DetalleTarjeta`: al teclear una fecha el navegador da fechas a medias.
 *
 * Props:
 *   hitos           [{ id, name, dueDate, status }] ya ordenados
 *   onCambiarFecha  (milestoneId, "YYYY-MM-DD") => Promise; `null` = solo
 *                   lectura: ninguna fecha se abre (12/09/2026, proyecto
 *                   cancelado: el servidor rechazaría el cambio)
 *   className
 */
export default function ListaHitos({ hitos = [], onCambiarFecha = null, className = "" }) {
  const idTitulo = useId();
  const hoy = hoyMadrid();
  const pendientes = hitos.filter((h) => h.status === "pending").length;

  return (
    <section aria-labelledby={idTitulo} className={className}>
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 id={idTitulo} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8A918E]">
          Hitos
        </h2>
        {hitos.length > 0 && (
          <span className="text-[12px] tabular-nums text-[#8A918E]">
            {pendientes} pendiente{pendientes === 1 ? "" : "s"} de {hitos.length}
          </span>
        )}
      </div>
      {hitos.length === 0 ? (
        <p className="mt-2 px-1 text-[12.5px] text-[#8A918E]">Este proyecto no tiene hitos.</p>
      ) : (
        <ul className="mt-1 divide-y divide-[#F0F0EB]">
          {hitos.map((h) => (
            <FilaHito key={h.id} hito={h} hoy={hoy} onCambiarFecha={onCambiarFecha} />
          ))}
        </ul>
      )}
    </section>
  );
}

const PUNTO = { pending: "#D9B93E", completed: "#3E5C57", missed: "#C2410C" };

// Los botones de `estilos.js` a la altura de una fila de lista (28 px). Aparte
// y enteros, no «BOTON_PRIMARIO + h-7»: dos alturas en la misma clase no
// garantizan cuál gana.
const BOTON_PEQUENO_PRIMARIO =
  "inline-flex items-center justify-center h-7 px-2.5 rounded-md bg-[#1F3B34] text-white text-[12px] font-medium whitespace-nowrap hover:bg-[#2B4B43] disabled:opacity-50 disabled:cursor-not-allowed " +
  FOCO;
const BOTON_PEQUENO_FANTASMA =
  "inline-flex items-center justify-center h-7 px-2 rounded-md text-[#5C6461] text-[12px] whitespace-nowrap hover:bg-[#F2F2EE] hover:text-[#1C2B27] disabled:opacity-50 disabled:cursor-not-allowed " +
  FOCO;

function FilaHito({ hito, hoy, onCambiarFecha }) {
  const idFecha = useId();
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState(hito.dueDate ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const pendiente = hito.status === "pending";
  // Solo se abre la fecha de un pendiente y si hay dónde guardarla.
  const editable = pendiente && Boolean(onCambiarFecha);
  const estado = ESTADO_HITO[hito.status] ?? ESTADO_HITO.pending;
  const vencido = pendiente && typeof hito.dueDate === "string" && hito.dueDate < hoy;
  const fecha = diaCorto(hito.dueDate, { conAnio: true }) || "Sin fecha";

  function abrir() {
    setBorrador(hito.dueDate ?? "");
    setError(null);
    setEditando(true);
  }

  async function guardar() {
    if (guardando || !onCambiarFecha) return;
    const anio = Number(String(borrador).slice(0, 4));
    if (!FECHA.test(borrador) || anio < 2000 || anio > 2999) {
      setError("Esa fecha no es válida.");
      return;
    }
    if (borrador === hito.dueDate) {
      setEditando(false);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await onCambiarFecha(hito.id, borrador);
      setEditando(false);
    } catch (e) {
      setError(e?.message || "No se ha podido guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <li className="px-1 py-2">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-[5px] w-2 h-2 rotate-45 rounded-[1px] shrink-0"
          style={{ background: PUNTO[hito.status] ?? PUNTO.pending }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug text-[#1C2B27] break-words">{hito.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
            {editable && !editando ? (
              <button
                type="button"
                onClick={abrir}
                aria-label={`Cambiar la fecha de «${hito.name}» (${fecha})`}
                className={`rounded-sm tabular-nums underline decoration-dotted decoration-[#B5BAB8] underline-offset-[3px] hover:decoration-solid ${
                  vencido ? "text-[#A33A30] hover:text-[#8A2A24]" : "text-[#5C6461] hover:text-[#1C2B27]"
                } ${FOCO}`}
              >
                {fecha}
              </button>
            ) : (
              !editando && <span className="tabular-nums text-[#8A918E]">{fecha}</span>
            )}
            {!pendiente && <Chip tono={estado.tono}>{estado.etiqueta}</Chip>}
            {vencido && !editando && <span className="text-[#A33A30]">vencido</span>}
          </div>

          {editando && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <label htmlFor={idFecha} className="sr-only">
                Fecha de «{hito.name}»
              </label>
              <input
                id={idFecha}
                type="date"
                value={borrador}
                onChange={(e) => {
                  setBorrador(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") guardar();
                  if (e.key === "Escape") setEditando(false);
                }}
                disabled={guardando}
                className="h-7 px-1.5 rounded-md border border-[#DADAD3] bg-white text-[12.5px] text-[#1C2B27] tabular-nums focus:border-[#3E5C57] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3E5C57] disabled:opacity-60"
              />
              <button
                type="button"
                onClick={guardar}
                disabled={guardando || !borrador}
                className={BOTON_PEQUENO_PRIMARIO}
              >
                {guardando ? "Guardando…" : "Guardar"}
              </button>
              <button
                type="button"
                onClick={() => setEditando(false)}
                disabled={guardando}
                className={BOTON_PEQUENO_FANTASMA}
              >
                Cancelar
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-1 text-[12px] leading-snug text-[#8A2A24]">
              {error}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
