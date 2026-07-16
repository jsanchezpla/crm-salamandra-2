"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TaskDrawer from "./TaskDrawer.jsx";
import { priorityMeta, priorityRank } from "@/lib/projects/taskPriority.js";

/**
 * ProjectListView — Vista de Lista del proyecto (alternativa al Kanban).
 *
 * Muestra TODAS las tareas del proyecto (incluidas las sin columna) en una
 * tabla ordenada de forma multinivel. Convive con el Kanban: no lo modifica.
 * Reutiliza el mismo TaskDrawer para ver/editar al pulsar una fila.
 *
 * Orden (multinivel — direcciones ajustables en SORT_LEVELS):
 *   1. Fecha de entrega (dueDate) ascendente; las tareas SIN fecha van al final.
 *   2. Prioridad de mayor a menor (urgent → high → medium → low).
 *   3. Estado: mismo orden de columnas del Kanban (por board_column.order).
 * Ante empate en un nivel, desempata por el siguiente.
 */

// Niveles de ordenación, en orden de prioridad. `dir` y `nullsLast` sueltos
// para poder ajustar el criterio sin tocar el comparador.
const SORT_LEVELS = [
  { key: "dueDate", dir: "asc", nullsLast: true },
  { key: "priority", dir: "asc" }, // asc sobre el rango (0=urgent) = mayor→menor
  { key: "status", dir: "asc", nullsLast: true }, // asc sobre board_column.order; sin columna → al final
];

function fmtDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  return dt.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}
function isOverdue(d) {
  if (!d) return false;
  const dt = new Date(d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dt < today;
}
function initials(name) {
  if (!name) return "??";
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
}

// Valor comparable de una tarea para un nivel. `null` = ausente (para nullsLast).
function levelValue(task, key) {
  if (key === "dueDate") return task.dueDate ?? null; // "YYYY-MM-DD" ordena como fecha
  if (key === "priority") return priorityRank(task.priority);
  if (key === "status") return task.boardColumn?.order ?? null; // sin columna = ausente
  return null;
}

function compareTasks(a, b) {
  for (const lvl of SORT_LEVELS) {
    const va = levelValue(a, lvl.key);
    const vb = levelValue(b, lvl.key);
    const aNull = va === null || va === undefined;
    const bNull = vb === null || vb === undefined;
    if (aNull || bNull) {
      if (aNull && bNull) continue; // ambos ausentes → empate en este nivel
      if (lvl.nullsLast) return aNull ? 1 : -1; // ausente siempre al final
      return aNull ? -1 : 1;
    }
    let cmp = 0;
    if (va < vb) cmp = -1;
    else if (va > vb) cmp = 1;
    if (cmp !== 0) return lvl.dir === "desc" ? -cmp : cmp;
  }
  // Desempate final estable por título.
  return (a.title ?? "").localeCompare(b.title ?? "", "es");
}

export default function ProjectListView({ projectId, filters = {}, teamMembers = [] }) {
  const [tasks, setTasks] = useState(null);
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState(null);
  // Ids de tareas con un /move en vuelo → evita doble disparo por doble-click.
  const inFlight = useRef(new Set());

  // Auto-oculta el aviso de error de acción tras unos segundos.
  useEffect(() => {
    if (!actionError) return undefined;
    const t = setTimeout(() => setActionError(null), 4000);
    return () => clearTimeout(t);
  }, [actionError]);

  useEffect(() => {
    // setState solo en callbacks async (no en el cuerpo del efecto). En un
    // refetch (reloadKey) no se limpia la tabla: se sustituye al llegar los datos.
    let alive = true;
    Promise.all([
      // /tasks devuelve TODAS las tareas del proyecto (incluidas las sin columna).
      fetch(`/api/projects/${projectId}/tasks`).then((r) => r.json()),
      // /board da la lista completa de columnas (para el selector del drawer).
      fetch(`/api/projects/${projectId}/board`).then((r) => r.json()).catch(() => null),
    ])
      .then(([tRes, bRes]) => {
        if (!alive) return;
        if (!tRes?.ok) throw new Error(tRes?.error || "Error cargando tareas");
        setTasks(tRes.data.tasks ?? []);
        setColumns(bRes?.ok ? bRes.data.columns ?? [] : []);
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [projectId, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  // Columnas ordenadas + resolución de "Hecho" / primera "no-hecha".
  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [columns]
  );
  const doneColumn = useMemo(() => sortedColumns.find((c) => c.isDoneColumn) ?? null, [sortedColumns]);
  const firstOpenColumn = useMemo(() => sortedColumns.find((c) => !c.isDoneColumn) ?? null, [sortedColumns]);

  // Checkbox HECHA: mueve la tarea a la columna done / a la primera no-done.
  // Reutiliza el MISMO endpoint /move que el drag&drop del Kanban (targetOrder:0
  // = al principio de la columna destino, siempre en rango). Optimista + refresh.
  const toggleDone = useCallback(
    async (task) => {
      // Guard de reentrada: ignora clics extra mientras el /move de ESTA tarea
      // sigue en vuelo (doble-click → un solo movimiento, sin parpadeo).
      if (inFlight.current.has(task.id)) return;
      const isDone = !!task.boardColumn?.isDoneColumn;
      const target = isDone ? firstOpenColumn : doneColumn;
      if (!target) return;
      inFlight.current.add(task.id);
      setActionError(null);
      setTasks((prev) =>
        (prev ?? []).map((t) =>
          t.id === task.id
            ? {
                ...t,
                boardColumnId: target.id,
                boardColumn: { id: target.id, name: target.name, order: target.order, color: target.color, isDoneColumn: target.isDoneColumn },
              }
            : t
        )
      );
      try {
        const r = await fetch(`/api/tasks/${task.id}/move`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetBoardColumnId: target.id, targetOrder: 0 }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => null);
          throw new Error(j?.error || "No se pudo mover la tarea");
        }
      } catch (e) {
        // Feedback: el /move requiere admin o lead del proyecto; sin esto la
        // marca optimista revertía en silencio al recargar.
        setActionError(e.message || "No se pudo mover la tarea");
      } finally {
        inFlight.current.delete(task.id);
        refresh();
      }
    },
    [firstOpenColumn, doneColumn, refresh]
  );

  // Filtro (cliente, mismo criterio que el Kanban) + orden multinivel.
  const rows = useMemo(() => {
    if (!tasks) return [];
    const { search, assigneeId, tag } = filters;
    const filtered = tasks.filter((t) => {
      if (search) {
        const q = search.toLowerCase();
        if (!(t.title.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q))) return false;
      }
      if (assigneeId && !(t.assignees ?? []).some((a) => (a.id ?? a.teamMemberId) === assigneeId)) return false;
      if (tag && !(t.tags ?? []).includes(tag)) return false;
      return true;
    });
    return [...filtered].sort(compareTasks);
  }, [tasks, filters]);

  if (loading) return <div className="p-6 text-sm text-neutral-400">Cargando lista...</div>;
  if (error) return <div className="p-6 text-sm text-rose-700">{error}</div>;

  return (
    <>
      {actionError && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 max-w-xs rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-medium text-white shadow-lg"
        >
          {actionError}
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-neutral-400">{rows.length} tarea{rows.length === 1 ? "" : "s"}</span>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Añadir tarea
        </button>
      </div>

      <div className="h-full overflow-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm border-collapse min-w-[680px]">
          <thead className="sticky top-0 z-10 bg-neutral-50 text-xs text-neutral-500">
            <tr className="border-b border-neutral-200">
              <th className="w-10 px-3 py-2.5" aria-label="Hecha" />
              <th className="text-left font-medium px-4 py-2.5">Tarea</th>
              <th className="text-left font-medium px-4 py-2.5 w-44">Fecha de entrega</th>
              <th className="text-left font-medium px-4 py-2.5 w-28">Prioridad</th>
              <th className="text-left font-medium px-4 py-2.5 w-48">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const prio = priorityMeta(t.priority);
              const visibleAssignees = (t.assignees ?? []).slice(0, 3);
              const extra = Math.max(0, (t.assignees ?? []).length - 3);
              return (
                <tr
                  key={t.id}
                  onClick={() => setSelectedTaskId(t.id)}
                  className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 cursor-pointer"
                >
                  <td className="w-10 px-3 py-2.5 align-middle" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={!!t.boardColumn?.isDoneColumn}
                      onChange={() => toggleDone(t)}
                      disabled={t.boardColumn?.isDoneColumn ? !firstOpenColumn : !doneColumn}
                      title={t.boardColumn?.isDoneColumn ? "Marcar como no hecha" : "Marcar como hecha"}
                      className="w-4 h-4 rounded border-neutral-300 accent-emerald-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`font-medium truncate ${t.boardColumn?.isDoneColumn ? "line-through text-neutral-400" : "text-neutral-800"}`}>{t.title}</span>
                      {(t.tags ?? []).slice(0, 2).map((tag) => (
                        <span key={tag} className="hidden sm:inline px-1.5 py-0.5 rounded-full text-[10px] bg-neutral-50 text-neutral-500 border border-neutral-100 shrink-0">
                          {tag}
                        </span>
                      ))}
                      {visibleAssignees.length > 0 && (
                        <span className="ml-auto flex -space-x-1.5 shrink-0">
                          {visibleAssignees.map((a) => (
                            <span
                              key={a.id ?? a.teamMemberId}
                              title={a.displayName}
                              className="w-5 h-5 rounded-full bg-neutral-200 ring-2 ring-white flex items-center justify-center text-[9px] font-semibold text-neutral-700"
                              style={a.avatarColor ? { background: a.avatarColor, color: "white" } : undefined}
                            >
                              {initials(a.displayName)}
                            </span>
                          ))}
                          {extra > 0 && (
                            <span className="w-5 h-5 rounded-full bg-neutral-100 ring-2 ring-white flex items-center justify-center text-[9px] font-semibold text-neutral-500">
                              +{extra}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {t.dueDate ? (
                      <span className={isOverdue(t.dueDate) ? "text-rose-600 font-medium" : "text-neutral-600"}>
                        {fmtDate(t.dueDate)}
                      </span>
                    ) : (
                      <span className="text-neutral-300">Sin fecha</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium ${prio.badgeClass}`}>
                      {prio.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {t.boardColumn ? (
                      <span className="inline-flex items-center gap-1.5 text-neutral-600">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.boardColumn.color || "#a3a3a3" }} />
                        <span className="truncate">{t.boardColumn.name}</span>
                      </span>
                    ) : (
                      <span className="text-neutral-300">Sin estado</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-8 text-center text-sm text-neutral-400">No hay tareas que mostrar.</div>
        )}
      </div>

      {selectedTaskId && (
        <TaskDrawer
          projectId={projectId}
          taskId={selectedTaskId}
          mode="view"
          columns={columns}
          teamMembers={teamMembers}
          onClose={() => setSelectedTaskId(null)}
          onSaved={refresh}
          onDeleted={() => {
            setSelectedTaskId(null);
            refresh();
          }}
        />
      )}

      {creating && (
        <TaskDrawer
          projectId={projectId}
          mode="create"
          createInColumnId={firstOpenColumn?.id ?? sortedColumns[0]?.id}
          columns={columns}
          teamMembers={teamMembers}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
    </>
  );
}
