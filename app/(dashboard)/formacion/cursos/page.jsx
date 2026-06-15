"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { TrainingTable, Tr, Td } from "../../../../components/training/TrainingTable.jsx";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export default function CursosPage() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [syncStatus, setSyncStatus] = useState(null);
  const [syncStatusLoading, setSyncStatusLoading] = useState(true);

  const [editingCourse, setEditingCourse] = useState(null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  const loadCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/training/courses");
      const json = await r.json();
      if (!r.ok || !json.data) throw new Error(json.error || "Error al cargar cursos");
      setCourses(json.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSyncStatus = useCallback(async () => {
    setSyncStatusLoading(true);
    try {
      const r = await fetch("/api/training/sync-status");
      const json = await r.json();
      if (r.ok && json.data) setSyncStatus(json.data);
      else setSyncStatus(null);
    } catch {
      setSyncStatus(null);
    } finally {
      setSyncStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCourses();
    loadSyncStatus();
  }, [loadCourses, loadSyncStatus]);

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-neutral-900" style={{ fontFamily: "'Syne', sans-serif" }}>
            Cursos
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">{courses.length} cursos</p>
        </div>
        <Link href="/formacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
          ← Volver
        </Link>
      </div>

      {!syncStatusLoading && syncStatus?.syncEnabled && (
        <SyncBanner
          lastSync={syncStatus.lastSync}
          onOpenInstructions={() => setInstructionsOpen(true)}
        />
      )}

      {error && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{error}</div>
      )}

      <TrainingTable
        headers={["Nombre", "ID WooCommerce", "Estado", "Fecha", ""]}
        loading={loading}
        empty="No hay cursos registrados"
      >
        {courses.map((c) => (
          <Tr key={c.id}>
            <Td><span className="font-semibold text-neutral-900">{c.name}</span></Td>
            <Td>{c.wcProductId ?? <span className="text-neutral-300">—</span>}</Td>
            <Td>
              <span className={`text-[11px] font-medium ${c.active ? "text-emerald-600" : "text-neutral-400"}`}>
                {c.active ? "Activo" : "Inactivo"}
              </span>
            </Td>
            <Td>
              <span className="text-[10px] text-neutral-300">
                {new Date(c.createdAt).toLocaleDateString("es-ES")}
              </span>
            </Td>
            <Td className="text-right">
              <button
                onClick={() => setEditingCourse(c)}
                className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-900 transition-colors px-2 py-1 rounded-md hover:bg-neutral-100"
              >
                Editar
              </button>
            </Td>
          </Tr>
        ))}
      </TrainingTable>

      {editingCourse && (
        <EditCourseDrawer
          course={editingCourse}
          onClose={() => setEditingCourse(null)}
          onSaved={() => { setEditingCourse(null); loadCourses(); }}
        />
      )}

      {instructionsOpen && syncStatus?.syncEnabled && (
        <SyncInstructionsModal
          syncUrl={syncStatus.syncUrl}
          onClose={() => setInstructionsOpen(false)}
        />
      )}
    </div>
  );
}

// ───────────────────────── SyncBanner ─────────────────────────────────────

function SyncBanner({ lastSync, onOpenInstructions }) {
  if (!lastSync) {
    return (
      <div className="mb-4 px-4 py-3 rounded-lg border border-neutral-200 bg-neutral-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p className="text-xs text-neutral-600 leading-snug">
          Los cursos aún no se han sincronizado con WordPress. Configura los cursos manualmente o sincroniza desde Retorika.
        </p>
        <button
          onClick={onOpenInstructions}
          className="shrink-0 text-[11px] font-semibold text-neutral-700 underline decoration-dotted hover:text-neutral-900 transition-colors whitespace-nowrap"
        >
          ¿Cómo sincronizar?
        </button>
      </div>
    );
  }

  const ageMs = Date.now() - new Date(lastSync.lastSyncAt).getTime();
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const stale = ageMs >= SEVEN_DAYS_MS;

  const relative = relativeDays(ageMs);

  if (stale) {
    return (
      <div className="mb-4 px-4 py-3 rounded-lg border border-amber-200 bg-amber-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p className="text-xs text-amber-800 leading-snug">
          Última sincronización: <strong>hace {days} días</strong>. Los cursos podrían estar desactualizados.
        </p>
        <button
          onClick={onOpenInstructions}
          className="shrink-0 px-3 py-1.5 rounded-md text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 transition-colors whitespace-nowrap"
        >
          Sincronizar ahora
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 px-4 py-2.5 rounded-lg border border-emerald-100 bg-emerald-50/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <p className="text-xs text-emerald-800 leading-snug">
        Última sincronización: <strong>{relative}</strong> ({lastSync.itemsSynced} cursos sincronizados
        {lastSync.itemsDeactivated > 0 ? `, ${lastSync.itemsDeactivated} desactivados` : ""}).
      </p>
      <button
        onClick={onOpenInstructions}
        className="shrink-0 text-[11px] font-semibold text-emerald-800 underline decoration-dotted hover:text-emerald-900 transition-colors whitespace-nowrap"
      >
        Sincronizar de nuevo
      </button>
    </div>
  );
}

function relativeDays(ms) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return minutes <= 1 ? "hace un momento" : `hace ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "hace 1 hora" : `hace ${hours} horas`;
  const days = Math.floor(hours / 24);
  if (days === 0) return "hoy";
  if (days === 1) return "hace 1 día";
  return `hace ${days} días`;
}

// ─────────────────────── SyncInstructionsModal ───────────────────────────

function SyncInstructionsModal({ syncUrl, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-bold text-neutral-900 mb-3" style={{ fontFamily: "'Syne', sans-serif" }}>
          Sincronizar cursos desde Retorika
        </h2>
        <div className="text-xs text-neutral-600 leading-relaxed space-y-2">
          <p>Para sincronizar los cursos publicados en TutorLMS con el CRM:</p>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>Accede como administrador a <code className="bg-neutral-100 px-1 rounded">retorika.es/wp-admin</code>.</li>
            <li>Abre la siguiente URL en tu navegador:
              <div className="mt-1 bg-neutral-50 border border-neutral-200 rounded-md px-2 py-1.5 text-[11px] font-mono text-neutral-700 break-all">
                {syncUrl}
              </div>
            </li>
            <li>Verás el resumen de la sincronización en pantalla.</li>
            <li>Vuelve aquí y recarga la página para ver los cursos actualizados.</li>
          </ol>
        </div>
        <div className="flex justify-end gap-2 pt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition"
          >
            Cerrar
          </button>
          <a
            href={syncUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-80"
            style={{ background: "var(--color-primary)" }}
          >
            Abrir URL de sincronización
          </a>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────── EditCourseDrawer ───────────────────────────────

function EditCourseDrawer({ course, onClose, onSaved }) {
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
