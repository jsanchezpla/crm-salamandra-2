"use client";

/**
 * EditCourseDrawer — drawer lateral para editar un Course (training).
 *
 * Extraído del listado /formacion/cursos para reutilizar desde la página
 * de detalle /formacion/cursos/[id]. Lógica idéntica a la versión inline;
 * solo cambio de ubicación + imports.
 *
 * Props:
 *   - course   { id, name, wpCourseId, wcProductId, active }
 *   - onClose  () => void
 *   - onSaved  () => void   (se llama tras PATCH exitoso)
 */

import { useEffect, useState } from "react";

export function EditCourseDrawer({ course, onClose, onSaved }) {
  const [name, setName] = useState(course.name);
  const [wpCourseId, setWpCourseId] = useState(course.wpCourseId ?? "");
  const [wcProductId, setWcProductId] = useState(course.wcProductId ?? "");
  const [active, setActive] = useState(!!course.active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dirty =
    name.trim() !== course.name ||
    String(wpCourseId) !== String(course.wpCourseId ?? "") ||
    String(wcProductId) !== String(course.wcProductId ?? "") ||
    active !== course.active;

  async function handleSave(e) {
    e?.preventDefault();
    if (!dirty || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/training/courses/${course.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          wpCourseId: wpCourseId === "" ? null : wpCourseId,
          wcProductId: wcProductId === "" ? null : wcProductId,
          active,
        }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || "Error al guardar");
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-x-0 top-14 lg:top-0 bottom-0 z-40 bg-black/40"
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label={`Editar curso ${course.name}`}
        className="fixed right-0 top-14 lg:top-0 bottom-0 z-50 w-full sm:max-w-md bg-white shadow-2xl flex flex-col"
      >
        <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-neutral-900 truncate" style={{ fontFamily: "'Syne', sans-serif" }}>
              Editar curso
            </h2>
            <p className="text-[11px] text-neutral-500 truncate">{course.name}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-neutral-400 hover:text-neutral-700 transition-colors"
            title="Cerrar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-4">
          <Field label="Nombre">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
              required
            />
          </Field>

          <Field label="WP Course ID (opcional)">
            <input
              type="number"
              value={wpCourseId}
              onChange={(e) => setWpCourseId(e.target.value)}
              min="0"
              placeholder="—"
              className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
            />
            <p className="text-[10px] text-neutral-400 mt-1">
              ID del post en WordPress (TutorLMS). Vacío si el curso no está sincronizado.
            </p>
          </Field>

          <Field label="WC Product ID (opcional)">
            <input
              type="number"
              value={wcProductId}
              onChange={(e) => setWcProductId(e.target.value)}
              min="1"
              placeholder="—"
              className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
            />
            <p className="text-[10px] text-neutral-400 mt-1">
              ID del producto en WooCommerce que vende este curso.
            </p>
          </Field>

          <div className="flex items-center justify-between p-3 rounded-lg border border-neutral-200 bg-neutral-50">
            <div>
              <p className="text-xs font-semibold text-neutral-700">Activo</p>
              <p className="text-[10px] text-neutral-500 mt-0.5">Los cursos inactivos no aparecen en filtros públicos.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={active}
              onClick={() => setActive(!active)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                active ? "" : "bg-neutral-300"
              }`}
              style={active ? { background: "var(--color-primary)" } : undefined}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                active ? "translate-x-4" : "translate-x-0.5"
              }`} />
            </button>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </form>

        <div className="px-5 py-4 border-t border-neutral-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-2 rounded-lg text-xs font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty || !name.trim()}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity disabled:opacity-40"
            style={{ background: "var(--color-primary)" }}
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </aside>
    </>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-neutral-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
