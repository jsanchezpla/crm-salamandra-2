"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import TaskCard from "./TaskCard.jsx";

/**
 * BoardColumn — columna del Kanban. Wrap de un SortableContext vertical para
 * las TaskCards. Header con nombre + count + color.
 *
 * Si la columna tiene wipLimit definido, muestra "N/LIMIT". Visual warning
 * cuando supera el límite (apuntado al backlog para Sprint 3).
 */
export default function BoardColumn({ column, onSelectTask, onCreateTask }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col-${column.id}`,
    data: { type: "column", columnId: column.id },
  });

  const taskIds = column.tasks.map((t) => t.id);
  const count = column.tasks.length;
  const overLimit = column.wipLimit != null && count > column.wipLimit;

  return (
    <div
      className="flex-shrink-0 w-72 bg-neutral-50 rounded-xl border border-neutral-200 flex flex-col max-h-full"
    >
      <header className="px-3 py-2.5 border-b border-neutral-200/70 flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: column.color || "#94A3B8" }}
        />
        <h3 className="text-sm font-medium text-neutral-800 truncate flex-1">
          {column.name}
        </h3>
        <span
          className={
            "text-[11px] px-2 py-0.5 rounded-full " +
            (overLimit
              ? "bg-rose-50 text-rose-700 border border-rose-100"
              : "bg-white text-neutral-600 border border-neutral-200")
          }
        >
          {column.wipLimit != null ? `${count}/${column.wipLimit}` : count}
        </span>
        {column.isDoneColumn && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
            Hecho
          </span>
        )}
      </header>

      <div
        ref={setNodeRef}
        className={
          "flex-1 overflow-y-auto p-2 space-y-2 transition-colors " +
          (isOver ? "bg-sky-50/40" : "")
        }
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {column.tasks.map((task) => (
            <TaskCard key={task.id} task={task} onSelect={onSelectTask} />
          ))}
        </SortableContext>

        {column.tasks.length === 0 && (
          <div className="py-6 text-center text-xs text-neutral-400">
            Sin tareas
          </div>
        )}
      </div>

      <button
        onClick={() => onCreateTask?.(column.id)}
        className="w-full px-3 py-2 text-xs font-medium text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 rounded-b-xl transition-colors border-t border-neutral-200/70"
      >
        + Añadir tarea
      </button>
    </div>
  );
}
