"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import BoardColumn from "../../../../../components/projects/BoardColumn.jsx";
import TaskCard from "../../../../../components/projects/TaskCard.jsx";
import Aviso, { useAviso } from "../../../../../components/calendario-global/Aviso.jsx";
import Chip from "../../../../../components/calendario-global/Chip.jsx";
import BarraAvance from "../../../../../components/calendario-global/BarraAvance.jsx";
import BotonAbrirCrm from "../../../../../components/calendario-global/BotonAbrirCrm.jsx";
import DetalleTarjeta from "../../../../../components/calendario-global/DetalleTarjeta.jsx";
import ListaHitos from "../../../../../components/calendario-global/ListaHitos.jsx";
import { pedirJson } from "../../../../../components/calendario-global/api.js";
import { BOTON_SECUNDARIO, FOCO } from "../../../../../components/calendario-global/estilos.js";
import { ESTADO_PROYECTO, UUID, diaCorto, hoyMadrid } from "../../../../../components/calendario-global/formato.js";
import {
  cambiarTarjeta,
  destinoDelArrastre,
  moverEnColumnas,
  normalizarTablero,
  ordenarHitos,
} from "../../../../../components/calendario-global/tablero.js";

/**
 * El tablero de un proyecto de un cliente, desde el calendario global
 * (12/09/2026, Rodrigo: «Proyectos → ver y mover, editar en el CRM»).
 *
 * Aquí se VE el proyecto (estado, avance, fechas, columnas, hitos) y se MUEVE:
 * una tarjeta de columna o de posición arrastrándola, su fecha límite desde su
 * ficha, y la fecha de un hito pendiente. Todo lo demás se edita en el CRM del
 * cliente con «Abrir tablero en el CRM».
 *
 * ── LAS PIEZAS DEL KANBAN DEL CRM, SIN SU KANBAN ────────────────────────────
 * `KanbanBoard` no sirve tal cual: pide `/api/projects/...` y `/api/tasks/...`,
 * que en este host no existen (lista blanca de middleware.js) y resolverían el
 * tenant de quien mira, no el del cliente; y monta el cajón de edición entero.
 * Se reutilizan `BoardColumn` y `TaskCard` (la tarjeta se ve igual que en el
 * CRM) con un `DndContext` propio, uno por tablero: los ids de dnd-kit son los
 * UUID de las tarjetas, y un proyecto es de un solo cliente, así que no chocan.
 *
 * ── MOVER: POSICIÓN VISIBLE, OPTIMISTA Y DE UNO EN UNO ──────────────────────
 *   - El destino se manda como POSICIÓN en la columna tal como se ve, no como
 *     el `order` guardado (tiene huecos; ver `components/calendario-global/
 *     tablero.js`).
 *   - La tarjeta se coloca al soltar, sin esperar. Si el servidor dice que no,
 *     vuelve a su sitio y se avisa en la franja (el Kanban del CRM lo deshacía
 *     callado y parecía que el tablero «no hacía caso»).
 *   - Mientras se guarda un movimiento no se acepta otro: dos PATCH cruzados
 *     reordenan la misma columna a la vez y el resultado no es el que se ve.
 *   - Al guardar, el tablero se vuelve a leer en silencio: el avance cambia si
 *     la tarjeta entra o sale de la columna de hecho, y así la pantalla dice
 *     el orden que de verdad ha quedado guardado.
 *
 * ── UN PROYECTO QUE NO SE PUEDE TOCAR, SE VE QUIETO (12/09/2026) ────────────
 * La pestaña Proyectos, con «Todos», lista también los cancelados, y el
 * servidor rechaza cualquier cambio en ellos (`proyectoTocable`). La revisión
 * lo vio: el tablero dejaba arrastrar y abrir las fechas, y todo acababa en
 * error. Ahora manda `proyecto.editable` del GET (y, si no llega, «no está
 * cancelado»): sin él no hay sensores de arrastre (el `DndContext` se queda,
 * que `BoardColumn` y `TaskCard` lo necesitan), la ficha y los hitos enseñan
 * la fecha sin campo, y la tira de datos dice «solo lectura».
 *
 * En el móvil la tarjeta se arrastra con una pulsación larga (así el dedo
 * puede desplazar el tablero de lado sin coger tarjetas) y la fecha se cambia
 * desde la ficha. El tablero se desplaza en horizontal dentro de su caja; la
 * página nunca.
 *
 * Next 16: los parámetros de una página cliente se leen con `useParams()`.
 */

const SLUG = /^[a-z0-9_]+$/;

/**
 * Si el proyecto se puede mover desde aquí. Lo decide el servidor
 * (`proyecto.editable`, con la misma regla que sus escrituras); si una
 * respuesta no lo trae, se cae a la regla que se ve: cancelado = no.
 */
function proyectoEditable(proyecto) {
  if (typeof proyecto?.editable === "boolean") return proyecto.editable;
  return proyecto?.status !== "cancelled";
}

function textoSoloLectura(proyecto) {
  if (proyecto?.status === "cancelled") return "Proyecto cancelado: solo lectura";
  if (proyecto?.archivedAt) return "Proyecto archivado: solo lectura";
  return "Proyecto de solo lectura";
}

// Sin sensores, dnd-kit no empieza ningún arrastre (ni ratón, ni dedo, ni teclado).
const SIN_SENSORES = [];

function EsqueletoTablero() {
  return (
    <div aria-label="Cargando tablero" className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 lg:px-5 pt-4 pb-3 border-b border-[#E7E7E1] bg-white">
        <span className="block h-2.5 w-48 rounded bg-[#EDEDE8]" />
        <span className="mt-3 block h-4 w-72 max-w-full rounded bg-[#EDEDE8]" />
        <span className="mt-3 block h-2.5 w-56 rounded bg-[#EDEDE8]" />
      </div>
      <div className="flex gap-3 p-3 lg:p-4 overflow-hidden">
        {[5, 3, 4].map((n, i) => (
          <div key={i} className="w-72 shrink-0 rounded-xl border border-[#E7E7E1] bg-[#FAFAF7] p-2 flex flex-col gap-2">
            <span className="h-2.5 w-24 m-1.5 rounded bg-[#EDEDE8]" />
            {Array.from({ length: n }, (_, j) => (
              <span key={j} className="h-16 rounded-lg bg-white border border-[#EDEDE8]" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Problema({ children, onReintentar = null }) {
  return (
    <div className="flex-1 flex items-start justify-center p-6 sm:p-10">
      <div className="max-w-md w-full flex flex-col gap-3 text-[13.5px] leading-relaxed text-[#3F4845]">
        <p>{children}</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/calendario-global/proyectos" className={BOTON_SECUNDARIO}>
            Volver a Proyectos
          </Link>
          {onReintentar && (
            <button type="button" onClick={onReintentar} className={BOTON_SECUNDARIO}>
              Reintentar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TableroGlobalPage() {
  const params = useParams();
  const slug = String(params?.slug ?? "");
  const projectId = String(params?.id ?? "");
  const valido = SLUG.test(slug) && UUID.test(projectId);
  const base = `/api/calendario-global/proyectos/${encodeURIComponent(slug)}`;
  const urlTablero = `${base}/${encodeURIComponent(projectId)}`;

  const [intento, setIntento] = useState(0);
  const [carga, setCarga] = useState({ clave: null, datos: null, error: null, status: null });
  const [seleccionId, setSeleccionId] = useState(null);
  const [arrastrandoId, setArrastrandoId] = useState(null);
  const [guardandoMovimiento, setGuardandoMovimiento] = useState(false);
  const { aviso, avisar, cerrarAviso } = useAviso();

  // Un movimiento en camino (bloquea el siguiente) y un contador de cambios
  // locales: una relectura en silencio que llega después de otro cambio ya no
  // se aplica, porque traería la foto de antes.
  const enVueloRef = useRef(false);
  const cambiosRef = useRef(0);

  const clave = valido ? `${urlTablero}#${intento}` : null;

  useEffect(() => {
    if (!clave) return undefined;
    const ctrl = new AbortController();
    pedirJson(urlTablero, { signal: ctrl.signal })
      .then((d) => setCarga({ clave, datos: normalizarTablero(d), error: null, status: null }))
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setCarga({ clave, datos: null, error: e?.message || "No se ha podido cargar el tablero.", status: e?.status ?? null });
      });
    return () => ctrl.abort();
  }, [clave, urlTablero]);

  const releer = useCallback(async () => {
    const cambios = cambiosRef.current;
    try {
      const d = await pedirJson(urlTablero);
      if (cambiosRef.current !== cambios || enVueloRef.current) return;
      setCarga((prev) => (prev.datos ? { ...prev, datos: normalizarTablero(d) } : prev));
    } catch {
      // Se queda lo que se ve, que ya es lo guardado salvo el orden fino.
    }
  }, [urlTablero]);

  const sensores = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const datos = carga.clave === clave ? carga.datos : null;
  const editable = proyectoEditable(datos?.proyecto);
  const columnas = datos?.columnas;
  const faseDe = useMemo(() => new Map((datos?.fases ?? []).map((f) => [f.id, f])), [datos?.fases]);

  // ── Arrastrar ───────────────────────────────────────────────────────────
  function alEmpezar({ active }) {
    setArrastrandoId(active.id);
  }

  async function alSoltar({ active, over }) {
    setArrastrandoId(null);
    if (!editable || !columnas || !over) return;
    const encima = over.data?.current;
    const traslado = active.rect?.current?.translated;
    const debajo = Boolean(traslado && over.rect && traslado.top > over.rect.top + over.rect.height / 2);
    const movimiento = destinoDelArrastre(columnas, {
      activeId: active.id,
      over:
        encima?.type === "column"
          ? { tipo: "column", columnId: encima.columnId }
          : encima?.type === "task"
            ? { tipo: "task", id: over.id }
            : null,
      debajo,
    });
    if (!movimiento) return;
    if (enVueloRef.current) {
      avisar("Espera a que se guarde el movimiento anterior.");
      return;
    }

    const taskId = String(active.id);
    enVueloRef.current = true;
    cambiosRef.current += 1;
    setGuardandoMovimiento(true);
    setCarga((prev) =>
      prev.datos
        ? { ...prev, datos: { ...prev.datos, columnas: moverEnColumnas(prev.datos.columnas, taskId, movimiento.destinoId, movimiento.indice) } }
        : prev
    );

    let bien = false;
    try {
      await pedirJson(`${base}/tareas/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: { targetBoardColumnId: movimiento.destinoId, targetOrder: movimiento.indice },
      });
      bien = true;
    } catch (e) {
      cambiosRef.current += 1;
      setCarga((prev) =>
        prev.datos
          ? {
              ...prev,
              datos: {
                ...prev.datos,
                columnas: moverEnColumnas(prev.datos.columnas, taskId, movimiento.origenId, movimiento.indiceOrigen),
              },
            }
          : prev
      );
      avisar(`No se ha movido la tarjeta. ${e?.message || ""}`.trim());
    } finally {
      enVueloRef.current = false;
      setGuardandoMovimiento(false);
    }
    if (bien) releer();
  }

  // ── Fechas ──────────────────────────────────────────────────────────────
  async function cambiarFechaTarjeta(taskId, dueDate) {
    const r = await pedirJson(`${base}/tareas/${encodeURIComponent(taskId)}`, { method: "PATCH", body: { dueDate } });
    cambiosRef.current += 1;
    const nueva = r && "dueDate" in r ? r.dueDate : dueDate;
    setCarga((prev) =>
      prev.datos ? { ...prev, datos: { ...prev.datos, columnas: cambiarTarjeta(prev.datos.columnas, taskId, { dueDate: nueva }) } } : prev
    );
    return r;
  }

  async function cambiarFechaHito(milestoneId, dueDate) {
    const r = await pedirJson(`${base}/hitos/${encodeURIComponent(milestoneId)}`, { method: "PATCH", body: { dueDate } });
    cambiosRef.current += 1;
    setCarga((prev) =>
      prev.datos
        ? {
            ...prev,
            datos: {
              ...prev.datos,
              hitos: ordenarHitos(
                prev.datos.hitos.map((h) =>
                  h.id === milestoneId ? { ...h, dueDate: r?.dueDate ?? dueDate, status: r?.status ?? h.status } : h
                )
              ),
            },
          }
        : prev
    );
    return r;
  }

  // ── Pintar ──────────────────────────────────────────────────────────────
  if (!valido) {
    return <Problema>Esa dirección no corresponde a ningún proyecto.</Problema>;
  }
  if (!datos && carga.clave === clave && carga.error) {
    if (carga.status === 404) return <Problema>Ese proyecto no existe o está archivado.</Problema>;
    if (carga.status === 403) return <Problema>{carga.error}</Problema>;
    return <Problema onReintentar={() => setIntento((n) => n + 1)}>{carga.error}</Problema>;
  }
  if (!datos) return <EsqueletoTablero />;

  const { cliente, proyecto, sinColumna, hitos } = datos;
  const hoy = hoyMadrid();
  const estado = ESTADO_PROYECTO[proyecto?.status] ?? ESTADO_PROYECTO.active;
  const cerrado = proyecto?.status === "completed" || proyecto?.status === "cancelled";
  const vencido = !cerrado && typeof proyecto?.dueDate === "string" && proyecto.dueDate.slice(0, 10) < hoy;
  const nombreCompleto = [proyecto?.code, proyecto?.name].filter(Boolean).join(" · ");
  const inicio = diaCorto(proyecto?.startDate, { conSemana: false, conAnio: true });
  const limite = diaCorto(proyecto?.dueDate, { conSemana: false, conAnio: true });

  const todas = columnas.flatMap((c) => c.tasks);
  const arrastrada = arrastrandoId ? todas.find((t) => t.id === arrastrandoId) ?? null : null;
  const columnaDeArrastrada = arrastrada ? columnas.find((c) => c.tasks.some((t) => t.id === arrastrada.id)) ?? null : null;
  const tarea = seleccionId ? todas.find((t) => t.id === seleccionId) ?? null : null;
  const columnaDeTarea = tarea ? columnas.find((c) => c.tasks.some((t) => t.id === tarea.id)) ?? null : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 px-3 lg:px-5 pt-3 pb-3 border-b border-[#E7E7E1] bg-white">
        <nav aria-label="Ruta" className="flex items-center gap-1.5 min-w-0 text-[12.5px] text-[#8A918E]">
          <Link href="/calendario-global/proyectos" className={`shrink-0 rounded-sm text-[#3E5C57] hover:text-[#1F3B34] hover:underline underline-offset-2 ${FOCO}`}>
            Proyectos
          </Link>
          <span aria-hidden="true" className="text-[#C9CCC9]">/</span>
          <span className="flex items-center gap-1.5 min-w-0 shrink">
            <span aria-hidden="true" className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: cliente?.color || "#94A3B8" }} />
            <span className="truncate">{cliente?.nombre ?? slug}</span>
          </span>
          <span aria-hidden="true" className="text-[#C9CCC9]">/</span>
          <span aria-current="page" className="truncate text-[#3F4845]">
            {nombreCompleto}
          </span>
          {/* Aquí y no en una línea propia: una línea que aparece y desaparece
              con cada arrastre movería el tablero arriba y abajo. */}
          <span role="status" className="ml-auto shrink-0 pl-2 text-[12px] text-[#8A918E]">
            {guardandoMovimiento ? "Guardando…" : ""}
          </span>
        </nav>

        <div className="mt-2 flex flex-col sm:flex-row sm:items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] font-semibold leading-snug text-[#1C2B27] break-words">
              {proyecto?.code && <span className="font-normal text-[#8A918E]">{proyecto.code} · </span>}
              {proyecto?.name}
            </h1>
            <dl className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px] text-[#3F4845]">
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Estado</dt>
                <dd>
                  <Chip tono={estado.tono}>{estado.etiqueta}</Chip>
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-[#8A918E]">Avance</dt>
                <dd className="w-36">
                  <BarraAvance valor={proyecto?.avance} className="w-full" />
                </dd>
              </div>
              {(inicio || limite) && (
                <div className="flex items-center gap-2">
                  <dt className="text-[#8A918E]">Fechas</dt>
                  <dd className="tabular-nums">
                    {inicio || "sin inicio"} <span className="text-[#B5BAB8]">→</span>{" "}
                    <span className={vencido ? "text-[#A33A30]" : ""}>{limite || "sin límite"}</span>
                  </dd>
                </div>
              )}
              {proyecto?.clientName && (
                <div className="flex items-center gap-2 min-w-0">
                  <dt className="text-[#8A918E]">Para</dt>
                  <dd className="truncate">{proyecto.clientName}</dd>
                </div>
              )}
              {!editable && (
                <div className="flex items-center gap-2">
                  <dt className="sr-only">Edición</dt>
                  <dd className="text-[#8A918E]">{textoSoloLectura(proyecto)}</dd>
                </div>
              )}
            </dl>
          </div>
          <BotonAbrirCrm
            ficha={cliente}
            destino={{ tipo: "tablero", projectId }}
            onError={avisar}
            variante="secundario"
            texto="Abrir tablero en el CRM"
            className="sm:items-end sm:text-right sm:max-w-[300px] shrink-0"
          />
        </div>
      </div>

      {(aviso || sinColumna > 0) && (
        <div className="shrink-0 px-3 lg:px-5 pt-2 flex flex-col gap-1.5">
          {aviso && (
            <Aviso tono={aviso.tono} onCerrar={cerrarAviso}>
              {aviso.texto}
            </Aviso>
          )}
          {sinColumna > 0 && (
            <p className="text-[12px] text-[#8A918E]">
              {sinColumna === 1
                ? "1 tarea sin columna no sale en el tablero."
                : `${sinColumna} tareas sin columna no salen en el tablero.`}
            </p>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {columnas.length === 0 ? (
          <p className="flex-1 p-5 text-[13px] text-[#5C6461]">Este proyecto no tiene columnas. Se crean en su CRM.</p>
        ) : (
          <DndContext
            id={`tablero-${projectId}`}
            sensors={editable ? sensores : SIN_SENSORES}
            collisionDetection={closestCorners}
            onDragStart={alEmpezar}
            onDragCancel={() => setArrastrandoId(null)}
            onDragEnd={alSoltar}
          >
            <div
              role="region"
              aria-label="Tablero"
              className={`h-[72dvh] min-h-[420px] lg:h-auto lg:min-h-0 lg:flex-1 min-w-0 flex items-stretch gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain p-3 lg:p-4 ${
                // Sin arrastre, la mano de «coger» mentiría: la tarjeta solo se abre.
                editable ? "" : "[&_article]:cursor-pointer"
              }`}
            >
              {columnas.map((col) => (
                <BoardColumn key={col.id} column={col} phasePorId={faseDe} onSelectTask={setSeleccionId} />
              ))}
              {/* Sin esto, el relleno derecho se pierde al desplazar en horizontal. */}
              <span aria-hidden="true" className="w-px shrink-0" />
            </div>
            <DragOverlay dropAnimation={null}>
              {arrastrada ? (
                <TaskCard
                  task={arrastrada}
                  isDragOverlay
                  fase={faseDe.get(arrastrada.phaseId) ?? null}
                  hecha={Boolean(columnaDeArrastrada?.isDoneColumn)}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        <aside
          aria-label="Hitos del proyecto"
          className="shrink-0 lg:w-72 border-t lg:border-t-0 lg:border-l border-[#E7E7E1] bg-white px-3 lg:px-4 py-3 lg:overflow-y-auto"
        >
          <ListaHitos hitos={hitos} onCambiarFecha={editable ? cambiarFechaHito : null} />
        </aside>
      </div>

      {tarea && (
        <DetalleTarjeta
          key={tarea.id}
          tarea={tarea}
          columna={columnaDeTarea}
          fase={faseDe.get(tarea.phaseId) ?? null}
          cliente={cliente}
          projectId={projectId}
          onCerrar={() => setSeleccionId(null)}
          onCambiarFecha={editable ? cambiarFechaTarjeta : null}
          avisoSoloLectura={editable ? null : textoSoloLectura(proyecto)}
        />
      )}
    </div>
  );
}
