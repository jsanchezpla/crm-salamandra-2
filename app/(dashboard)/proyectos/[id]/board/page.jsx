"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import KanbanBoard from "../../../../../components/projects/KanbanBoard.jsx";
import ProjectListView from "../../../../../components/projects/ProjectListView.jsx";
import Select from "@/components/ui/Select.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

export default function ProyectoBoardPage() {
  const { id } = useParams();
  const router = useRouter();

  const [project, setProject] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [filters, setFilters] = useState({ search: "", assigneeId: "", tag: "" });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [view, setView] = useState("kanban"); // "kanban" | "list"

  // ── Cargar proyecto + team members + tags conocidos ───────────────────
  useEffect(() => {
    (async () => {
      try {
        const [pRes, tmRes] = await Promise.all([
          fetch(`/api/projects/${id}`).then((r) => r.json()),
          fetch(`/api/team?limit=200`).then((r) => r.json()).catch(() => null),
        ]);
        if (pRes?.ok) setProject(pRes.data);
        const members = tmRes?.data?.members ?? tmRes?.data ?? [];
        setTeamMembers(members);
      } catch {}
    })();
  }, [id]);

  // ── Recopilar tags únicos del tablero (cuando esté cargado) ───────────
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/projects/${id}/board`).then((r) => r.json());
        if (r?.ok) {
          const tags = new Set();
          for (const col of r.data.columns) {
            for (const t of col.tasks) {
              for (const tag of t.tags ?? []) tags.add(tag);
            }
          }
          setAllTags([...tags].sort());
        }
      } catch {}
    })();
  }, [id]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  const effective = {
    search: debouncedSearch || undefined,
    assigneeId: filters.assigneeId || undefined,
    tag: filters.tag || undefined,
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] lg:h-screen">
      {/* Header */}
      <header className="px-4 lg:px-8 py-3 lg:py-4 border-b border-neutral-200 bg-white">
        <div className="text-xs text-neutral-400 mb-1">
          <Link href="/proyectos" className="hover:text-neutral-600">Proyectos</Link>
          {" / "}
          <Link href={`/proyectos/${id}`} className="hover:text-neutral-600">
            {project?.name ?? "..."}
          </Link>
          {" / Tablero"}
        </div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-[Fraunces] text-xl lg:text-2xl text-neutral-800 truncate">
            {project?.name ?? "..."}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            {/* Toggle Kanban | Lista — dos vistas del proyecto: el Kanban solo llega a las
                tareas con columna; la Lista las trae todas. */}
            <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5" role="tablist" aria-label="Vista del tablero">
              {[
                { key: "kanban", label: "Kanban" },
                { key: "list", label: "Lista" },
              ].map((v) => (
                <button
                  key={v.key}
                  role="tab"
                  aria-selected={view === v.key}
                  onClick={() => setView(v.key)}
                  className={
                    "px-3 py-1.5 rounded-md text-xs font-medium transition-colors " +
                    (view === v.key ? "bg-neutral-800 text-white" : "text-neutral-600 hover:bg-neutral-100")
                  }
                >
                  {v.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => router.push(`/proyectos/${id}`)}
              className="hidden sm:inline-flex px-3 py-1.5 rounded-lg text-xs text-neutral-600 hover:bg-neutral-100 border border-neutral-200"
            >
              ← Volver al proyecto
            </button>
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="px-4 lg:px-8 py-2 border-b border-neutral-200 bg-neutral-50 flex flex-wrap items-center gap-2">
        <input
          className={inputCls + " w-48"}
          placeholder="Buscar tareas..."
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
        />
        <Select
          className={inputCls + " w-44"}
          value={filters.assigneeId}
          onChange={(v) => setFilters((f) => ({ ...f, assigneeId: v }))}
          options={[
            { value: "", label: "Todos los asignados" },
            ...teamMembers.map((tm) => ({ value: tm.id, label: tm.displayName })),
          ]}
        />
        <Select
          className={inputCls + " w-40"}
          value={filters.tag}
          onChange={(v) => setFilters((f) => ({ ...f, tag: v }))}
          options={[
            { value: "", label: "Todas las etiquetas" },
            ...allTags.map((t) => ({ value: t, label: t })),
          ]}
        />
        {(filters.search || filters.assigneeId || filters.tag) && (
          <button
            onClick={() => setFilters({ search: "", assigneeId: "", tag: "" })}
            className="text-xs text-neutral-500 hover:text-neutral-800 px-2 py-1"
          >
            Limpiar filtros
          </button>
        )}
        <Link
          href={`/proyectos/${id}?tab=settings`}
          className="ml-auto text-xs text-neutral-500 hover:text-neutral-800 px-3 py-1.5 border border-neutral-200 rounded-lg"
        >
          Editar columnas
        </Link>
      </div>

      {/* Vista activa: Kanban o Lista. Mismos filtros, pero NO el mismo conjunto:
          el Kanban sale de /board (tareas colgadas de una columna) y la Lista de
          /tasks (todas, incluidas las que no tienen columna). */}
      <div className="flex-1 overflow-hidden px-4 lg:px-8 py-4">
        {view === "kanban" ? (
          <KanbanBoard projectId={id} filters={effective} teamMembers={teamMembers} />
        ) : (
          <ProjectListView projectId={id} filters={effective} teamMembers={teamMembers} />
        )}
      </div>
    </div>
  );
}
