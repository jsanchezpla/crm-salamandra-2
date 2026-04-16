"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { ActiveBadge } from "../../../../../components/training/TrainingBadge.jsx";

export default function EmpresaDetailPage({ params }) {
  const { id } = use(params);

  const [company, setCompany] = useState(null);
  const [allCourses, setAllCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [addCourseId, setAddCourseId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [compRes, courseRes] = await Promise.all([
        fetch(`/api/training/companies/${id}`),
        fetch("/api/training/courses?active=true"),
      ]);
      const [compJson, courseJson] = await Promise.all([compRes.json(), courseRes.json()]);
      if (!compRes.ok) throw new Error(compJson.error || "Empresa no encontrada");
      setCompany(compJson.data);
      setAllCourses(courseJson.ok ? courseJson.data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  const assignedIds = new Set((company?.courses ?? []).map((c) => c.id));
  const availableCourses = allCourses.filter((c) => !assignedIds.has(c.id));

  async function handleAssign(e) {
    e.preventDefault();
    if (!addCourseId) return;
    setAssigning(true);
    setAssignError(null);
    try {
      const res = await fetch(`/api/training/companies/${id}/courses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId: addCourseId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al asignar curso");
      setAddCourseId("");
      load();
    } catch (e) {
      setAssignError(e.message);
    } finally {
      setAssigning(false);
    }
  }

  async function handleUnassign(courseId) {
    try {
      await fetch(`/api/training/companies/${id}/courses/${courseId}`, { method: "DELETE" });
      load();
    } catch {
      // silencioso
    }
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <div className="h-8 w-48 bg-neutral-100 rounded animate-pulse mb-4" />
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="bg-white border border-neutral-100 rounded-xl p-6 h-48 animate-pulse" />
          <div className="bg-white border border-neutral-100 rounded-xl p-6 h-48 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">{error}</div>
        <Link href="/formacion/empresas" className="mt-4 inline-block text-xs text-neutral-400 hover:text-neutral-700">← Volver a empresas</Link>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-neutral-900" style={{ fontFamily: "'Syne', sans-serif" }}>
            {company.name}
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">Detalle de empresa</p>
        </div>
        <Link href="/formacion/empresas" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
          ← Volver
        </Link>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Columna izquierda — datos */}
        <div className="bg-white border border-neutral-100 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-bold text-neutral-700 mb-2" style={{ fontFamily: "'Syne', sans-serif" }}>
            Datos de la empresa
          </h2>
          <InfoRow label="Nombre" value={company.name} />
          <InfoRow label="ID externo" value={company.externalId ?? "—"} />
          <InfoRow label="Estado" value={<ActiveBadge active={company.active} />} />
          <InfoRow
            label="Usuarios"
            value={
              <span className="text-sm font-semibold" style={{ color: "var(--color-primary)" }}>
                {(company.courses ?? []).length > 0
                  ? `${company.courses.length} cursos asignados`
                  : "Sin cursos"}
              </span>
            }
          />
        </div>

        {/* Columna derecha — cursos asignados */}
        <div className="bg-white border border-neutral-100 rounded-xl p-6">
          <h2 className="text-sm font-bold text-neutral-700 mb-4" style={{ fontFamily: "'Syne', sans-serif" }}>
            Cursos asignados
          </h2>

          {/* Asignar nuevo */}
          <form onSubmit={handleAssign} className="flex gap-2 mb-4">
            <select
              value={addCourseId}
              onChange={(e) => setAddCourseId(e.target.value)}
              className="flex-1 rounded-lg px-3 py-2 text-xs text-neutral-700 bg-neutral-50 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
            >
              <option value="">Seleccionar curso…</option>
              {availableCourses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={assigning || !addCourseId}
              className="px-3 py-2 rounded-lg text-xs font-bold text-white transition-opacity disabled:opacity-40"
              style={{ background: "var(--color-primary)" }}
            >
              {assigning ? "…" : "Asignar"}
            </button>
          </form>
          {assignError && <p className="text-xs text-red-500 mb-3">{assignError}</p>}

          {/* Lista de cursos */}
          {company.courses?.length === 0 ? (
            <p className="text-xs text-neutral-400 py-4 text-center">Sin cursos asignados</p>
          ) : (
            <ul className="space-y-2">
              {company.courses.map((c) => (
                <li key={c.id} className="flex items-center justify-between bg-neutral-50 rounded-lg px-3 py-2.5">
                  <div>
                    <span className="text-xs font-medium text-neutral-800">{c.name}</span>
                    {c.wpCourseId && (
                      <span className="ml-2 text-[10px] text-neutral-400">WP #{c.wpCourseId}</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleUnassign(c.id)}
                    className="text-neutral-300 hover:text-red-400 transition-colors ml-3"
                    title="Desasignar curso"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-neutral-50 last:border-0">
      <span className="text-xs text-neutral-400">{label}</span>
      <span className="text-xs font-medium text-neutral-700">{value}</span>
    </div>
  );
}
