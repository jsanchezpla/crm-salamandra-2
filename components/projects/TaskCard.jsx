"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function initials(name) {
  if (!name) return "??";
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
}

function fmtDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  return dt.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

function isOverdue(d) {
  if (!d) return false;
  const dt = new Date(d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dt < today;
}

/**
 * TaskCard — sortable card del tablero Kanban. El "drag handle" es TODO
 * el card (no un handle visible separado). Click sin arrastrar →
 * onSelect(task.id) abre el drawer.
 *
 * Cuando isDragOverlay=true, se renderiza como clon estático (sin
 * useSortable) dentro del <DragOverlay> de @dnd-kit para que el ghost
 * siga al cursor y no desaparezca al cruzar columnas.
 */
export default function TaskCard({ task, onSelect, isDragOverlay = false }) {
  if (isDragOverlay) {
    return (
      <article className="bg-white rounded-lg border border-neutral-300 p-3 shadow-2xl rotate-2 cursor-grabbing">
        <TaskCardBody task={task} />
      </article>
    );
  }
  return <SortableTaskCard task={task} onSelect={onSelect} />;
}

function SortableTaskCard({ task, onSelect }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", boardColumnId: task.boardColumnId, order: task.order },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Card original semi-transparente durante el drag (el ghost lo lleva el DragOverlay).
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // El drag de @dnd-kit dispara el listener pointerdown que termina en
        // click. Si onSelect se llama tras el drag, no queremos abrir drawer.
        // dnd-kit pone isDragging=false al soltar, pero el click llega
        // después. Heurística: si hay un movimiento de transform != null al
        // soltar, fue un drag; si no, fue click puro.
        if (transform && (Math.abs(transform.x) > 4 || Math.abs(transform.y) > 4)) return;
        onSelect?.(task.id);
      }}
      className="group bg-white rounded-lg border border-neutral-200 p-3 cursor-grab active:cursor-grabbing hover:border-neutral-300 transition-colors"
    >
      <TaskCardBody task={task} />
    </article>
  );
}

function TaskCardBody({ task }) {
  const dueOverdue = isOverdue(task.dueDate);
  const checklistDone = Array.isArray(task.checklist)
    ? task.checklist.filter((it) => it.done).length
    : 0;
  const checklistTotal = Array.isArray(task.checklist) ? task.checklist.length : 0;

  const visibleAssignees = (task.assignees ?? []).slice(0, 3);
  const extraAssignees = Math.max(0, (task.assignees ?? []).length - 3);

  return (
    <>
      <h4 className="text-sm font-medium text-neutral-800 leading-snug line-clamp-2">
        {task.title}
      </h4>

      {(task.tags?.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.tags.slice(0, 4).map((t) => (
            <span
              key={t}
              className="px-2 py-0.5 rounded-full text-[10px] bg-neutral-50 text-neutral-600 border border-neutral-100"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      <footer className="mt-3 flex items-center gap-2 text-[11px] text-neutral-500">
        {task.dueDate && (
          <span
            className={
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded " +
              (dueOverdue
                ? "bg-rose-50 text-rose-700"
                : "bg-neutral-50 text-neutral-600")
            }
          >
            {fmtDate(task.dueDate)}
          </span>
        )}
        {task.estimatedHours != null && (
          <span className="inline-flex items-center gap-1 text-neutral-500">
            {Number(task.estimatedHours)}h
          </span>
        )}
        {checklistTotal > 0 && (
          <span className="inline-flex items-center gap-1 text-neutral-500">
            ☑ {checklistDone}/{checklistTotal}
          </span>
        )}

        <div className="ml-auto flex -space-x-1.5">
          {visibleAssignees.map((a) => (
            <div
              key={a.id ?? a.teamMemberId}
              title={a.displayName}
              className="w-6 h-6 rounded-full bg-neutral-200 ring-2 ring-white flex items-center justify-center text-[10px] font-semibold text-neutral-700"
              style={a.avatarColor ? { background: a.avatarColor, color: "white" } : undefined}
            >
              {initials(a.displayName)}
            </div>
          ))}
          {extraAssignees > 0 && (
            <div className="w-6 h-6 rounded-full bg-neutral-100 ring-2 ring-white flex items-center justify-center text-[10px] font-semibold text-neutral-500">
              +{extraAssignees}
            </div>
          )}
        </div>
      </footer>
    </>
  );
}
