"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { TrainingTable, Tr, Td } from "../../../../components/training/TrainingTable.jsx";

export default function CursosPage() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toggling, setToggling] = useState(null);

  // Modal nuevo curso
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: "", wpCourseId: "", wcProductId: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/training/courses");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al cargar cursos");
      setCourses(json.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggleActive(course) {
    setToggling(course.id);
    try {
      const res = await fetch(`/api/training/courses/${course.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !course.active }),
      });
      if (res.ok) {
        setCourses((prev) => prev.map((c) => c.id === course.id ? { ...c, active: !c.active } : c));
      }
    } finally {
      setToggling(null);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/training/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          wpCourseId: form.wpCourseId ? parseInt(form.wpCourseId) : null,
          wcProductId: form.wcProductId ? parseInt(form.wcProductId) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al crear curso");
      setModalOpen(false);
      setForm({ name: "", wpCourseId: "", wcProductId: "" });
      load();
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-neutral-900" style={{ fontFamily: "'Syne', sans-serif" }}>
            Cursos
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">{courses.length} cursos</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/formacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
            ← Volver
          </Link>
          <button
            onClick={() => setModalOpen(true)}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-80"
            style={{ background: "var(--color-primary)" }}
          >
            + Nuevo curso
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{error}</div>
      )}

      <TrainingTable
        headers={["Nombre", "ID WordPress", "ID WooCommerce", "Activo", ""]}
        loading={loading}
        empty="No hay cursos registrados"
      >
        {courses.map((c) => (
          <Tr key={c.id}>
            <Td><span className="font-semibold text-neutral-900">{c.name}</span></Td>
            <Td>{c.wpCourseId ?? <span className="text-neutral-300">—</span>}</Td>
            <Td>{c.wcProductId ?? <span className="text-neutral-300">—</span>}</Td>
            <Td>
              {/* Toggle activo/inactivo */}
              <button
                onClick={() => toggleActive(c)}
                disabled={toggling === c.id}
                className="flex items-center gap-1.5 disabled:opacity-50"
                title={c.active ? "Desactivar" : "Activar"}
              >
                <div
                  className={`w-8 h-4 rounded-full transition-colors relative ${c.active ? "" : "bg-neutral-200"}`}
                  style={c.active ? { background: "var(--color-primary)" } : {}}
                >
                  <div
                    className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${c.active ? "translate-x-4" : "translate-x-0.5"}`}
                  />
                </div>
                <span className="text-[11px] text-neutral-500">{c.active ? "Activo" : "Inactivo"}</span>
              </button>
            </Td>
            <Td className="text-right">
              <span className="text-[10px] text-neutral-300">
                {new Date(c.createdAt).toLocaleDateString("es-ES")}
              </span>
            </Td>
          </Tr>
        ))}
      </TrainingTable>

      {/* Modal nuevo curso */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-base font-bold text-neutral-900 mb-4" style={{ fontFamily: "'Syne', sans-serif" }}>
              Nuevo curso
            </h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-neutral-600 block mb-1">Nombre *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Nombre del curso"
                  className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-600 block mb-1">ID WordPress (TutorLMS)</label>
                <input
                  type="number"
                  value={form.wpCourseId}
                  onChange={(e) => setForm((f) => ({ ...f, wpCourseId: e.target.value }))}
                  placeholder="ej: 1042"
                  className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-600 block mb-1">ID WooCommerce</label>
                <input
                  type="number"
                  value={form.wcProductId}
                  onChange={(e) => setForm((f) => ({ ...f, wcProductId: e.target.value }))}
                  placeholder="ej: 2089"
                  className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
                />
              </div>
              {saveError && <p className="text-xs text-red-500">{saveError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setModalOpen(false); setSaveError(null); }}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || !form.name.trim()}
                  className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity disabled:opacity-50"
                  style={{ background: "var(--color-primary)" }}
                >
                  {saving ? "Guardando…" : "Crear curso"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
