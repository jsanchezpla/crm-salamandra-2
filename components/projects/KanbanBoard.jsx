"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import BoardColumn from "./BoardColumn.jsx";
import TaskCard from "./TaskCard.jsx";
import TaskDrawer from "./TaskDrawer.jsx";

/**
 * KanbanBoard — wrapper del tablero del proyecto.
 *
 * Responsabilidades:
 *   - Fetch GET /api/projects/[id]/board y mantiene { project, columns }.
 *   - Estado local: columnas + tareas; reordena en cliente al instante y
 *     persiste con PATCH /api/tasks/[id]/move tras drop. Si el PATCH falla
 *     se hace re-fetch para deshacer el optimistic update.
 *   - Drawer con TaskDrawer cuando hay tarea seleccionada.
 *   - Filtros (search/assigneeId/tag) propagados desde el padre.
 *
 * Solo DnD vertical (intra-columna y entre columnas). El reorden de
 * columnas no se hace por DnD aquí — se delega al editor de columnas en
 * la pestaña Configuración (Sprint 1).
 */
export default function KanbanBoard({
  projectId,
  filters = {},
  phases = [],
  teamMembers = [],
}) {
  const [data, setData] = useState(null); // { project, columns }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [drawerMode, setDrawerMode] = useState("view"); // view | create
  const [createInColumnId, setCreateInColumnId] = useState(null);
  const [activeId, setActiveId] = useState(null); // id de la task siendo arrastrada

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const fetchBoard = useCallback(async () => {
    try {
      setError(null);
      const r = await fetch(`/api/projects/${projectId}/board`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error cargando tablero");
      setData(j.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  // La fase de cada tarjeta se pinta por id: el /board manda `phaseId`, no el
  // nombre, y bajar la fase entera en cada tarea sería repetirla cien veces.
  const phasePorId = useMemo(() => new Map(phases.map((p) => [p.id, p])), [phases]);

  // ── Filtros (cliente — sobre la respuesta del /board) ─────────────────
  const filteredColumns = useMemo(() => {
    if (!data) return [];
    const { search, assigneeId, tag, phaseId } = filters;
    return data.columns.map((col) => ({
      ...col,
      tasks: col.tasks.filter((t) => {
        if (search) {
          const q = search.toLowerCase();
          const hit = t.title.toLowerCase().includes(q) ||
            (t.description ?? "").toLowerCase().includes(q);
          if (!hit) return false;
        }
        if (assigneeId) {
          const has = (t.assignees ?? []).some(
            (a) => (a.id ?? a.teamMemberId) === assigneeId
          );
          if (!has) return false;
        }
        if (tag) {
          if (!(t.tags ?? []).includes(tag)) return false;
        }
        // "sin" = las que no cuelgan de ninguna fase (ver la barra del tablero).
        if (phaseId) {
          if (phaseId === "sin" ? t.phaseId : t.phaseId !== phaseId) return false;
        }
        return true;
      }),
    }));
  }, [data, filters]);

  // ── Drag handlers ────────────────────────────────────────────────────
  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };
  const handleDragCancel = () => {
    setActiveId(null);
  };
  const handleDragEnd = async (event) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || !data) return;
    if (active.id === over.id) return;

    // active.data: { type: "task", boardColumnId, order }
    // over puede ser otra task O un droppable de columna (id: `col-<uuid>`).
    const draggedTaskId = active.id;
    let targetColumnId;
    let targetOrder;

    const overData = over.data?.current;
    if (overData?.type === "column") {
      targetColumnId = overData.columnId;
      // Soltar en la columna vacía o al final
      const col = data.columns.find((c) => c.id === targetColumnId);
      if (!col) return;
      // Si la dragged ya está en esta columna, su posición final es el final − 1.
      const sameColumn = data.columns
        .find((c) => c.tasks.some((t) => t.id === draggedTaskId))?.id === targetColumnId;
      targetOrder = sameColumn ? Math.max(col.tasks.length - 1, 0) : col.tasks.length;
    } else if (overData?.type === "task") {
      targetColumnId = overData.boardColumnId;
      targetOrder = overData.order;
    } else {
      return;
    }

    // ── Optimistic update ──────────────────────────────────────────────
    setData((prev) => {
      if (!prev) return prev;
      const clone = JSON.parse(JSON.stringify(prev));
      let dragged;
      // Quitar de la columna origen
      for (const col of clone.columns) {
        const idx = col.tasks.findIndex((t) => t.id === draggedTaskId);
        if (idx >= 0) {
          [dragged] = col.tasks.splice(idx, 1);
          // Reindex origen
          col.tasks.forEach((t, i) => (t.order = i));
          break;
        }
      }
      if (!dragged) return prev;
      // Insertar en destino
      const target = clone.columns.find((c) => c.id === targetColumnId);
      if (!target) return prev;
      dragged.boardColumnId = targetColumnId;
      target.tasks.splice(Math.min(targetOrder, target.tasks.length), 0, dragged);
      target.tasks.forEach((t, i) => (t.order = i));
      return clone;
    });

    // ── Persistir ──────────────────────────────────────────────────────
    try {
      const r = await fetch(`/api/tasks/${draggedTaskId}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetBoardColumnId: targetColumnId,
          targetOrder,
        }),
      });
      if (!r.ok) throw new Error((await r.json())?.error || "Error moviendo tarea");
    } catch (e) {
      console.error("[Kanban] move failed:", e.message);
      await fetchBoard(); // revertir desde server
    }
  };

  // ── Drawer handlers ─────────────────────────────────────────────────
  const openCreateInColumn = (columnId) => {
    setCreateInColumnId(columnId);
    setDrawerMode("create");
    setSelectedTaskId(null);
  };
  const openTask = (taskId) => {
    setSelectedTaskId(taskId);
    setDrawerMode("view");
    setCreateInColumnId(null);
  };
  const closeDrawer = () => {
    setSelectedTaskId(null);
    setCreateInColumnId(null);
    setDrawerMode("view");
  };
  const onTaskSaved = async () => {
    await fetchBoard();
  };
  const onTaskCreated = async (newId) => {
    await fetchBoard();
    if (newId) setSelectedTaskId(newId);
    setDrawerMode("view");
    setCreateInColumnId(null);
  };
  const onTaskDeleted = async () => {
    closeDrawer();
    await fetchBoard();
  };

  if (loading) return <div className="p-6 text-sm text-neutral-400">Cargando tablero...</div>;
  if (error) return <div className="p-6 text-sm text-rose-700">{error}</div>;
  if (!data) return null;

  // Task activa (para el DragOverlay) — buscar en data.columns, no en filteredColumns,
  // así el ghost sobrevive aunque el filtro deje la card fuera de vista.
  const activeTask = activeId
    ? data.columns.flatMap((c) => c.tasks).find((t) => t.id === activeId) ?? null
    : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 h-full">
          {filteredColumns.map((col) => (
            <BoardColumn
              key={col.id}
              column={col}
              phasePorId={phasePorId}
              onSelectTask={openTask}
              onCreateTask={openCreateInColumn}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTask ? <TaskCard task={activeTask} isDragOverlay /> : null}
        </DragOverlay>
      </DndContext>

      {(selectedTaskId || drawerMode === "create") && (
        <TaskDrawer
          projectId={projectId}
          taskId={selectedTaskId}
          mode={drawerMode}
          createInColumnId={createInColumnId}
          phases={[]} // se cargan dentro del drawer
          milestones={[]}
          teamMembers={teamMembers}
          columns={data.columns}
          onClose={closeDrawer}
          onSaved={onTaskSaved}
          onCreated={onTaskCreated}
          onDeleted={onTaskDeleted}
        />
      )}
    </>
  );
}
