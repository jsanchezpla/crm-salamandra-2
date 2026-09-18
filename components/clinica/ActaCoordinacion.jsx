"use client";

/**
 * ActaCoordinacion — la tarjeta de un acta de coordinación (18/09/2026, AV-0102
 * de Aumenta).
 *
 * ── DE QUÉ QUEJA NACE ──────────────────────────────────────────────────────
 * «El apartado de coordinaciones sigue estando un poco regular… acabo de
 * registrar una y no se visualiza» (Silvia). El acta estaba guardada entera: lo
 * que pasaba es que la pestaña Coordinaciones de la FICHA del paciente pintaba
 * una versión recortada —tipo, fecha, participantes y temas— y se dejaba fuera
 * los acuerdos, los próximos pasos, con quién fue la reunión, el reparto de
 * asistentes y la firma. El acta que ella escribió tenía once acuerdos y un
 * solo tema: en la ficha se veía una línea.
 *
 * No era un caso raro: de las 701 actas de Aumenta, 593 tienen contenido que la
 * ficha no pintaba. Por eso esto también explica su queja del 09/09 («en un
 * paciente las veo enteras y en otro no»): dependía de en qué campo hubiera
 * caído el texto al importarlo de Organízate, no del paciente.
 *
 * Así que la tarjeta se escribe UNA vez y la usan las dos pantallas —el listado
 * general `/clinica/coordinaciones` y la pestaña de la ficha—. Dos copias de un
 * acta acaban enseñando cosas distintas, que es exactamente lo que pasó.
 *
 * `mostrarPaciente` solo lo pide el listado general: dentro de la ficha, el
 * enlace al paciente es el paciente que ya estás mirando.
 */

import Link from "next/link";

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

const persona = (p) => [p.name, p.role].filter(Boolean).join(" · ");

export default function ActaCoordinacion({ acta: c, mostrarPaciente = false, onEditar = null }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">{c.typeLabel}</span>
        {c.scopeLabel && (
          <span className="text-[10px] uppercase tracking-wider text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-full">{c.scopeLabel}</span>
        )}
        <span className="text-[10px] text-neutral-400 tabular">{fmtDate(c.date)}</span>
        {mostrarPaciente && c.relatedPatientId && (
          <Link href={`/pacientes/${c.relatedPatientId}`} className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline">
            {c.patientName || "Ver paciente"}
          </Link>
        )}
        {/* La firma NO va aquí arriba: va al pie del acta, que es donde se
            firma. Ver el bloque «Firmado por» al final de la tarjeta. */}
        {onEditar && (
          <button
            onClick={() => onEditar(c)}
            className="ml-auto text-[11px] text-neutral-500 hover:text-neutral-800 underline underline-offset-2"
          >
            Editar
          </button>
        )}
      </div>
      {c.externalEntity && <div className="text-[11px] text-neutral-600 mb-1">Con: {c.externalEntity}</div>}
      {/* Quién estuvo, separando el centro de la gente de fuera. Las actas
          antiguas guardan los asistentes como texto suelto y no dicen de qué
          lado está cada uno: esas caen a la línea de siempre en vez de
          repartirse a ojo. */}
      {(c.participantsInternal?.length > 0 || c.participantsExternal?.length > 0) ? (
        <div className="text-[11px] text-neutral-500 mb-1 space-y-0.5">
          {c.participantsInternal?.length > 0 && <div>Del centro: {c.participantsInternal.map(persona).join(", ")}</div>}
          {c.participantsExternal?.length > 0 && <div>De fuera: {c.participantsExternal.map(persona).join(", ")}</div>}
        </div>
      ) : (
        <div className="text-[11px] text-neutral-500 mb-1">Participantes: {c.participants || "—"}</div>
      )}
      {/* Un tema por línea (13/09/2026): unidos con comas volvía la ambigüedad
          de la coma, ahora al pintar. */}
      <p className="text-xs text-neutral-700 leading-relaxed whitespace-pre-line">
        {(c.topicsList?.length ? c.topicsList.filter(Boolean).join("\n") : c.topics) || "—"}
      </p>
      {c.agreements?.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-0.5">Acuerdos</div>
          <ul className="list-disc list-outside ml-4 text-xs text-neutral-700 space-y-0.5">
            {c.agreements.map((a, i) => <li key={i} className="whitespace-pre-line">{a}</li>)}
          </ul>
        </div>
      )}
      {c.nextActions?.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-0.5">Próximos pasos</div>
          <ul className="list-disc list-outside ml-4 text-xs text-neutral-700 space-y-0.5">
            {c.nextActions.map((a, i) => <li key={i} className="whitespace-pre-line">{a}</li>)}
          </ul>
        </div>
      )}
      {/* La firma, al pie y en todas: un acta la escribe alguien y eso no se
          pierde aunque esa persona ya no trabaje en el centro (Rodrigo,
          02/08/2026). `createdByLabel` resuelve el orden en el servidor —ficha
          de equipo primero, nombre suelto si no la hay—. */}
      {c.createdByLabel && (
        <div className="mt-3 pt-2 border-t border-neutral-100 text-[10px] text-neutral-400">
          Firmado por {c.createdByLabel}
        </div>
      )}
    </div>
  );
}
