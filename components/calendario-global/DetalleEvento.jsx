"use client";

import { useState } from "react";
import Link from "next/link";
import PanelDetalle from "./PanelDetalle.jsx";
import BotonAbrirCrm from "./BotonAbrirCrm.jsx";
import Chip from "./Chip.jsx";
import { BOTON_SECUNDARIO } from "./estilos.js";
import {
  ESTADO_EVENTO,
  ESTADO_HITO,
  diaCorto,
  fechaDeEvento,
  nombreDeProyecto,
  parteFecha,
  prioridad,
  tituloDeEvento,
} from "./formato.js";

/**
 * DetalleEvento — la ficha de un evento del calendario global, según de qué
 * es (12/09/2026).
 *
 * Desde el 12/09 el calendario global mezcla tres cosas, y cada una se toca
 * distinto (`extendedProps.kind`, que pone el servidor):
 *   - `calendarTask`: un evento del Calendario del cliente. Se mueve, se
 *     estira y se marca hecha. Lo de dentro se edita en su CRM.
 *   - `projectTask`: la fecha límite de una tarjeta de Proyectos. Se arrastra
 *     de día; «Ver tablero» lleva a la pestaña Proyectos, aquí mismo.
 *   - `projectMilestone`: un hito. Se arrastra si está pendiente.
 * Todo lo demás (título, notas, asignados) se cambia en el CRM del cliente:
 * es la regla de Rodrigo del 03/09/2026, «aquí se ve y se mueve».
 *
 * Props:
 *   evento     instantánea del evento de FullCalendar
 *              `{ id, title, startStr, endStr, allDay, extendedProps }`
 *   ficha      la ficha del cliente (`useClientes().clientes`), para el salto
 *   onCerrar
 *   onCambiarEstado  (status) => Promise — solo `calendarTask`; si falla,
 *              el error se enseña dentro de la ficha
 *
 * Quien la monte debe darle `key={evento.id}`: así el «ocupado» y el error de
 * un evento no se quedan pegados al abrir otro.
 */
export default function DetalleEvento({ evento, ficha, onCerrar, onCambiarEstado }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);

  const ep = evento?.extendedProps ?? {};
  const kind = ep.kind ?? "calendarTask";
  const cliente = ep.calendario ?? (ficha ? { nombre: ficha.nombre, color: ficha.color } : null);
  const slug = ep.calendario?.slug ?? ficha?.slug;
  const titulo = tituloDeEvento(evento);
  const dia = parteFecha(evento?.startStr).date;

  async function cambiarEstado(status) {
    if (ocupado || !onCambiarEstado) return;
    setOcupado(true);
    setError(null);
    try {
      await onCambiarEstado(status);
    } catch (e) {
      setError(e?.message || "No se ha podido guardar.");
    } finally {
      setOcupado(false);
    }
  }

  const enlaceTablero =
    slug && ep.projectId ? (
      <Link
        href={`/calendario-global/proyectos/${encodeURIComponent(slug)}/${encodeURIComponent(ep.projectId)}`}
        className={BOTON_SECUNDARIO}
      >
        Ver tablero
      </Link>
    ) : null;

  if (kind === "projectTask") {
    const prio = prioridad(ep.priority);
    return (
      <PanelDetalle
        onCerrar={onCerrar}
        cliente={cliente}
        tipo="Tarea de proyecto"
        titulo={titulo}
        chips={
          <Chip punto={prio.color} tono="neutral">
            Prioridad {prio.etiqueta.toLowerCase()}
          </Chip>
        }
        filas={[
          { etiqueta: "Proyecto", valor: nombreDeProyecto(ep) },
          { etiqueta: "Columna", valor: ep.columnName },
          { etiqueta: "Fecha límite", valor: diaCorto(dia, { conAnio: true }) },
        ]}
        error={error}
        acciones={
          <>
            {enlaceTablero}
            <BotonAbrirCrm ficha={ficha} destino={{ tipo: "tablero", projectId: ep.projectId }} onError={setError} />
          </>
        }
      >
        <p className="mt-4 text-[12px] leading-relaxed text-[#8A918E]">
          Arrástrala en el calendario para cambiar la fecha límite.
        </p>
      </PanelDetalle>
    );
  }

  if (kind === "projectMilestone") {
    const estado = ESTADO_HITO[ep.status] ?? ESTADO_HITO.pending;
    const pendiente = (ep.status ?? "pending") === "pending";
    return (
      <PanelDetalle
        onCerrar={onCerrar}
        cliente={cliente}
        tipo="Hito"
        titulo={titulo}
        chips={<Chip tono={estado.tono}>{estado.etiqueta}</Chip>}
        filas={[
          { etiqueta: "Proyecto", valor: nombreDeProyecto(ep) },
          { etiqueta: "Estado", valor: estado.etiqueta },
          { etiqueta: "Fecha", valor: diaCorto(dia, { conAnio: true }) },
        ]}
        error={error}
        acciones={
          <>
            {enlaceTablero}
            <BotonAbrirCrm ficha={ficha} destino={{ tipo: "proyecto", projectId: ep.projectId }} onError={setError} />
          </>
        }
      >
        <p className="mt-4 text-[12px] leading-relaxed text-[#8A918E]">
          {pendiente
            ? "Arrástralo en el calendario para cambiar la fecha."
            : "Solo se mueven los hitos pendientes."}
        </p>
      </PanelDetalle>
    );
  }

  // calendarTask (y cualquier evento sin `kind`, como los de antes del 12/09).
  const status = ep.status ?? "pending";
  const estado = ESTADO_EVENTO[status] ?? ESTADO_EVENTO.pending;
  const prio = prioridad(ep.priority);
  return (
    <PanelDetalle
      onCerrar={onCerrar}
      cliente={cliente}
      tipo="Evento"
      titulo={titulo}
      chips={
        <>
          <Chip tono={estado.tono}>{estado.etiqueta}</Chip>
          <Chip punto={prio.color} tono="neutral">
            Prioridad {prio.etiqueta.toLowerCase()}
          </Chip>
          {ep.categoryName && (
            <Chip punto={ep.colorCategoria ?? "#A3A3A3"} tono="neutral">
              {ep.categoryName}
            </Chip>
          )}
        </>
      }
      filas={[
        { etiqueta: "Cuándo", valor: fechaDeEvento(evento) },
        { etiqueta: "Cliente final", valor: ep.clientName },
        { etiqueta: "Responsable", valor: ep.teamMemberName },
        {
          etiqueta: "Videollamada",
          valor: ep.meetUrl ? (
            <a href={ep.meetUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all hover:text-[#3E5C57]">
              {ep.meetUrl}
            </a>
          ) : null,
        },
        { etiqueta: "Notas", valor: ep.notes ? <span className="whitespace-pre-wrap text-[#3F4845]">{ep.notes}</span> : null },
      ]}
      error={error}
      acciones={
        <>
          <button
            type="button"
            onClick={() => cambiarEstado(status === "done" ? "pending" : "done")}
            disabled={ocupado || !onCambiarEstado}
            className={BOTON_SECUNDARIO}
          >
            {ocupado ? "Guardando…" : status === "done" ? "Reabrir" : "Marcar hecha"}
          </button>
          <BotonAbrirCrm
            ficha={ficha}
            destino={{ tipo: "calendario", taskId: ep.taskId ?? null, fecha: dia || null }}
            onError={setError}
          />
        </>
      }
    >
      <p className="mt-4 text-[12px] leading-relaxed text-[#8A918E]">
        Aquí se mueve y se marca. El contenido se cambia en su CRM.
      </p>
    </PanelDetalle>
  );
}
