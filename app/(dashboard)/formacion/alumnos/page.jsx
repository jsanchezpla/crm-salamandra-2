"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { TrainingTable, Tr, Td } from "../../../../components/training/TrainingTable.jsx";
import { TypeBadge } from "../../../../components/training/TrainingBadge.jsx";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import Select from "@/components/ui/Select.jsx";

const LIMIT = 50;

export default function AlumnosPage() {
  const [enrollments, setEnrollments] = useState([]);
  const [total, setTotal] = useState(0);
  const [courses, setCourses] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [courseId, setCourseId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page, limit: LIMIT });
      if (courseId) params.set("courseId", courseId);
      if (companyId) params.set("companyId", companyId);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/training/enrollments?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al cargar matrículas");
      setEnrollments(json.data.enrollments);
      setTotal(json.data.total);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [courseId, companyId, search, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    Promise.all([
      fetch("/api/training/courses").then((r) => r.json()),
      fetch("/api/training/companies").then((r) => r.json()),
    ]).then(([cJson, coJson]) => {
      if (cJson.ok) setCourses(cJson.data);
      if (coJson.ok) setCompanies(coJson.data);
    });
  }, []);

  function handleFilterChange(setter) {
    return (e) => { setter(e.target.value); setPage(1); };
  }

  function handleExport() {
    const params = new URLSearchParams();
    if (courseId) params.set("courseId", courseId);
    if (companyId) params.set("companyId", companyId);
    if (search.trim()) params.set("search", search.trim());
    window.location.href = `/api/training/enrollments/export?${params}`;
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-neutral-900 flex items-center gap-2" style={{ fontFamily: "'Syne', sans-serif" }}>
            Alumnos por curso
            <HelpTooltip title="Alumnos por curso">
              Cada línea es una matrícula: un alumno apuntado a un curso. Si una misma persona está
              en tres cursos, aparece tres veces. Es la forma rápida de responder a preguntas como
              «¿qué alumnos tengo en este curso?» o «¿qué cursos está haciendo esta persona?».
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">{total} matrículas</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/formacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
            ← Volver
          </Link>
          <span className="inline-flex items-center gap-1">
            <button
              onClick={handleExport}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-80"
              style={{ background: "var(--color-primary)" }}
            >
              Exportar Excel
            </button>
            <HelpTooltip title="Exportar a Excel">
              Descarga un Excel con todas las matrículas que coinciden con los filtros activos.
              Muy útil para mandarle a una empresa el listado de empleados que están haciendo sus cursos.
            </HelpTooltip>
          </span>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <HelpTooltip title="Filtros" className="mr-1">
          Combina los filtros para ver justo lo que buscas. Por ejemplo: curso «Habilidades comunicativas»
          + empresa «Acme» = empleados de Acme apuntados a ese curso. El buscador acepta nombre,
          apellido o email del alumno.
        </HelpTooltip>
        <Select
          value={courseId}
          onChange={(v) => { setCourseId(v); setPage(1); }}
          options={[{ value: "", label: "Todos los cursos" }, ...courses.map((c) => ({ value: c.id, label: c.name }))]}
          className="rounded-lg px-3 py-2 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
        />
        <Select
          value={companyId}
          onChange={(v) => { setCompanyId(v); setPage(1); }}
          options={[{ value: "", label: "Todas las empresas" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]}
          className="rounded-lg px-3 py-2 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
        />
        <input
          type="text"
          placeholder="Buscar nombre, email…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="rounded-lg px-3 py-2 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition flex-1 min-w-[180px]"
        />
      </div>

      {error && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{error}</div>
      )}

      <TrainingTable
        headers={[
          "Nombre",
          "Email",
          "Username",
          "Empresa",
          "Curso",
          (
            <span key="mat-h" className="inline-flex items-center gap-1">
              Matrícula
              <HelpTooltip title="Fecha de matrícula">
                Día en que el alumno se apuntó al curso.
              </HelpTooltip>
            </span>
          ),
          "NIF",
        ]}
        loading={loading}
        empty="No hay matrículas con los filtros actuales"
      >
        {enrollments.map((e) => {
          const u = e.trainingUser;
          return (
            <Tr key={e.id}>
              <Td>
                <span className="font-semibold text-neutral-900">
                  {u ? [u.name, u.lastName].filter(Boolean).join(" ") || "—" : "—"}
                </span>
              </Td>
              <Td>{u?.email || <span className="text-neutral-300">—</span>}</Td>
              <Td>{u?.username || <span className="text-neutral-300">—</span>}</Td>
              <Td>{u?.company?.name || <span className="text-neutral-300">—</span>}</Td>
              <Td>
                <span className="font-medium text-neutral-800">{e.course?.name || "—"}</span>
              </Td>
              <Td>
                {e.enrolledAt
                  ? new Date(e.enrolledAt).toLocaleDateString("es-ES")
                  : <span className="text-neutral-300">—</span>}
              </Td>
              <Td>{u?.nif || <span className="text-neutral-300">—</span>}</Td>
            </Tr>
          );
        })}
      </TrainingTable>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-neutral-400">
            Página {page} de {totalPages} — {total} matrículas
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-600 bg-white border border-neutral-200 disabled:opacity-40 hover:bg-neutral-50 transition"
            >
              ← Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-600 bg-white border border-neutral-200 disabled:opacity-40 hover:bg-neutral-50 transition"
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
