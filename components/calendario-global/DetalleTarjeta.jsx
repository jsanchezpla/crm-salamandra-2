"use client";

import { useId, useState } from "react";
import PanelDetalle from "./PanelDetalle.jsx";
import BotonAbrirCrm from "./BotonAbrirCrm.jsx";
import Chip from "./Chip.jsx";
import { BOTON_FANTASMA, BOTON_PRIMARIO } from "./estilos.js";
import { FECHA, diaCorto, hoyMadrid, prioridad } from "./formato.js";

/**
 * DetalleTarjeta — la ficha de una tarjeta del tablero de la pestaña
 * Proyectos del calendario global (12/09/2026).
 *
 * Rodrigo decidió «ver y mover, editar en el CRM»: desde aquí se ve la tarjeta
 * y se cambia (o se quita) su FECHA LÍMITE, que es lo mismo que se hace
 * arrastrándola en el calendario. Moverla de columna es arrastrarla en el
 * tablero. Título, asignados, fase y lo demás se editan en el CRM del cliente,
 * con el botón de abajo.
 *
 * ── LA FECHA SE GUARDA CON UN BOTÓN ─────────────────────────────────────────
 * Guardar al cambiar el `<input type="date">` parece más rápido, pero al
 * escribir la fecha a mano el navegador va dando fechas a medias (el año
 * «0002» mientras se teclea «2026»), y cada una sería un cambio en el CRM del
 * cliente y una línea en su Actividad. Con «Guardar» se manda la fecha acabada.
 *
 * Props:
 *   tarea      la tarjeta (`serializeTask`), viva: si cambia fuera, se repinta
 *   columna    { name, color, isDoneColumn } de su columna
 *   fase       { name, color } | null
 *   cliente    la ficha del cliente (`{ slug, nombre, color, saltoComo, saltoEmail }`)
 *   projectId  para el salto al tablero del CRM
 *   onCerrar
 *   onCambiarFecha  (taskId, "YYYY-MM-DD" | null) => Promise<{ id, dueDate }>;
 *              `null` = SOLO LECTURA: la fecha se enseña, sin campo ni botones
 *              (12/09/2026: en un proyecto cancelado el servidor rechaza
 *              cualquier cambio, y ofrecer el campo era invitar a un error)
 *   avisoSoloLectura  la frase que lo explica, p. ej. «Proyecto cancelado:
 *              solo lectura»; solo cuenta sin `onCambiarFecha`
 *
 * Quien la monte debe darle `key={tarea.id}`, como a `DetalleEvento`.
 */
export default function DetalleTarjeta({
  tarea,
  columna = null,
  fase = null,
  cliente,
  projectId,
  onCerrar,
  onCambiarFecha = null,
  avisoSoloLectura = null,
}) {
  const idFecha = useId();
  const actual = tarea?.dueDate ? String(tarea.dueDate).slice(0, 10) : "";
  const [base, setBase] = useState(actual);
  const [borrador, setBorrador] = useState(actual);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [hecho, setHecho] = useState(null);

  // Si la fecha cambia por fuera (el tablero se ha vuelto a leer), el campo la
  // sigue. Es el patrón de React para «estado que depende de una prop».
  if (base !== actual) {
    setBase(actual);
    setBorrador(actual);
  }

  async function guardar(valor) {
    if (guardando || !onCambiarFecha) return;
    if (valor !== null) {
      const anio = Number(String(valor).slice(0, 4));
      if (!FECHA.test(valor) || anio < 2000 || anio > 2999) {
        setError("Esa fecha no es válida.");
        return;
      }
    }
    setGuardando(true);
    setError(null);
    setHecho(null);
    try {
      await onCambiarFecha(tarea.id, valor);
      setHecho(valor ? "Fecha guardada." : "Fecha quitada.");
    } catch (e) {
      setError(e?.message || "No se ha podido guardar.");
    } finally {
      setGuardando(false);
    }
  }

  const prio = prioridad(tarea?.priority);
  const asignados = (tarea?.assignees ?? []).map((a) => a.displayName || a.email).filter(Boolean);
  const vencida = Boolean(actual) && !columna?.isDoneColumn && actual < hoyMadrid();
  const horas = tarea?.estimatedHours != null && tarea.estimatedHours !== "" ? `${Number(tarea.estimatedHours)} h` : null;

  return (
    <PanelDetalle
      onCerrar={onCerrar}
      cliente={cliente}
      tipo="Tarea de proyecto"
      titulo={tarea?.title || "(sin título)"}
      chips={
        <>
          <Chip punto={prio.color} tono="neutral">
            Prioridad {prio.etiqueta.toLowerCase()}
          </Chip>
          {columna?.isDoneColumn && <Chip tono="verde">Hecha</Chip>}
          {vencida && <Chip tono="rojo">Vencida</Chip>}
        </>
      }
      filas={[
        {
          etiqueta: "Columna",
          valor: columna ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0" style={{ background: columna.color || "#94A3B8" }} />
              {columna.name}
            </span>
          ) : null,
        },
        {
          etiqueta: "Fase",
          valor: fase ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0" style={{ background: fase.color || "#A3A3A3" }} />
              {fase.name}
            </span>
          ) : null,
        },
        {
          etiqueta: "Asignada a",
          valor: asignados.length ? asignados.join(", ") : <span className="text-[#8A918E]">Nadie</span>,
        },
        { etiqueta: "Horas estimadas", valor: horas },
      ]}
      error={error}
      acciones={
        <BotonAbrirCrm
          ficha={cliente}
          destino={{ tipo: "tablero", projectId }}
          onError={setError}
          variante="secundario"
        />
      }
    >
      {!onCambiarFecha ? (
        <div className="mt-5 pt-4 border-t border-[#EDEDE8]">
          <p className="mb-1.5 text-[12px] text-[#8A918E]">Fecha límite</p>
          <p className="text-[13px] text-[#1C2B27] tabular-nums">
            {actual ? diaCorto(actual, { conAnio: true }) : <span className="text-[#8A918E]">Sin fecha límite.</span>}
          </p>
          <p className="mt-4 text-[12px] leading-relaxed text-[#8A918E]">
            {avisoSoloLectura || "Solo lectura"}. Se edita en su CRM.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-5 pt-4 border-t border-[#EDEDE8]">
            <label htmlFor={idFecha} className="block mb-1.5 text-[12px] text-[#8A918E]">
              Fecha límite
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={idFecha}
                type="date"
                value={borrador}
                onChange={(e) => {
                  setBorrador(e.target.value);
                  setHecho(null);
                  setError(null);
                }}
                disabled={guardando}
                className="h-8 px-2 rounded-md border border-[#DADAD3] bg-white text-[13px] text-[#1C2B27] tabular-nums focus:border-[#3E5C57] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3E5C57] disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => guardar(borrador)}
                disabled={guardando || !borrador || borrador === actual}
                className={BOTON_PRIMARIO}
              >
                {guardando ? "Guardando…" : "Guardar"}
              </button>
              {actual && (
                <button type="button" onClick={() => guardar(null)} disabled={guardando} className={BOTON_FANTASMA}>
                  Quitar fecha
                </button>
              )}
            </div>
            <p role="status" className="mt-1.5 min-h-4 text-[12px] leading-snug">
              {hecho ? (
                <span className="text-[#2F5A4B]">{hecho}</span>
              ) : actual ? (
                <span className="text-[#8A918E]">{diaCorto(actual, { conAnio: true })}</span>
              ) : (
                <span className="text-[#8A918E]">Sin fecha límite.</span>
              )}
            </p>
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-[#8A918E]">
            Aquí se cambia la fecha y, arrastrando en el tablero, la columna. Lo demás se edita en su CRM.
          </p>
        </>
      )}
    </PanelDetalle>
  );
}
