"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TrainingTable, Tr, Td } from "../../../../components/training/TrainingTable.jsx";
import { EditCourseDrawer } from "../../../../components/training/EditCourseDrawer.jsx";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import { anchoPantalla } from "../../../../components/layout/anchoPantalla.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export default function CursosPage() {
  const router = useRouter();
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
    <div className={anchoPantalla("listado")}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-neutral-900 flex items-center gap-2" style={{ fontFamily: "'Syne', sans-serif" }}>
            Cursos
            <HelpTooltip title="Cursos">
              Catálogo completo de cursos de tu academia. Los cursos se importan automáticamente desde tu
              página web (WordPress) cuando los publicas allí. {" "}
              <strong className="text-white">Importante:</strong> pulsa cualquier fila para abrir la
              ficha del curso. Ahí ves toda su información y los <strong className="text-white">registros
              del curso</strong> (los alumnos apuntados con sus datos). El botón «Editar» abre directamente
              el panel de edición sin tener que entrar.
            </HelpTooltip>
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
        headers={[
          "Nombre",
          (
            <span key="wc-h" className="inline-flex items-center gap-1">
              ID WooCommerce
              <HelpTooltip title="ID WooCommerce">
                Es el número que identifica al curso en tu tienda online. Sirve para que el CRM y tu web
                hablen del mismo producto. Si está en blanco, el curso aún no está conectado con la tienda.
              </HelpTooltip>
            </span>
          ),
          (
            <span key="est-h" className="inline-flex items-center gap-1">
              Estado
              <HelpTooltip title="Estado del curso">
                Activo = los alumnos lo ven en el campus y pueden matricularse.
                Inactivo = sigue en tu catálogo pero está oculto para los alumnos.
              </HelpTooltip>
            </span>
          ),
          (
            <span key="fecha-h" className="inline-flex items-center gap-1">
              Fecha
              <HelpTooltip title="Fecha de alta">
                Día en que el curso se dio de alta en el CRM por primera vez.
              </HelpTooltip>
            </span>
          ),
          (
            <span key="abrir-h" className="inline-flex items-center gap-1">
              Abrir ficha
              <HelpTooltip title="Ficha del curso">
                Pulsa cualquier fila para abrir la ficha completa del curso.
                Desde ahí puedes ver <strong className="text-white">toda la información del curso</strong>,
                consultar los <strong className="text-white">registros del curso</strong> (los alumnos
                que se han apuntado con sus datos) y editar el curso. El botón
                «Editar» de aquí abre directamente el panel sin entrar.
              </HelpTooltip>
            </span>
          ),
        ]}
        loading={loading}
        empty="No hay cursos registrados"
      >
        {courses.map((c) => (
          <Tr key={c.id} onClick={() => router.push(`/formacion/cursos/${c.id}`)}>
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
              <div className="inline-flex items-center gap-1.5">
                <button
                  onClick={(e) => { e.stopPropagation(); setEditingCourse(c); }}
                  title="Editar nombre, estado…"
                  aria-label={`Editar curso ${c.name}`}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-600 hover:text-neutral-900 transition-colors px-2 py-1 rounded-md hover:bg-neutral-100"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                  Editar
                </button>
                <span className="text-neutral-300 text-xs pl-1">→</span>
              </div>
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
  // `ageMs` se calcula client-side para evitar hydration mismatch:
  // Date.now() en server vs primer cliente render difiere.
  const [ageMs, setAgeMs] = useState(null);

  useEffect(() => {
    if (!lastSync?.lastSyncAt) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAgeMs(Date.now() - new Date(lastSync.lastSyncAt).getTime());
  }, [lastSync?.lastSyncAt]);

  if (!lastSync) {
    return (
      <div className="mb-4 px-4 py-3 rounded-lg border border-neutral-200 bg-neutral-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p className="text-xs text-neutral-600 leading-snug">
          Los cursos aún no se han sincronizado con WordPress. Configura los cursos manualmente o sincroniza desde tu WordPress.
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

  // Placeholder mientras el cliente aún no calculó la edad (1 tick).
  if (ageMs == null) {
    return (
      <div className="mb-4 px-4 py-2.5 rounded-lg border border-emerald-100 bg-emerald-50/60">
        <div className="h-3 w-48 bg-emerald-100/60 rounded animate-pulse" />
      </div>
    );
  }

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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // wp-admin del propio tenant, derivado del enlace de sync (no hardcodear).
  const wpAdmin = (() => {
    try { return new URL(syncUrl).origin + "/wp-admin"; } catch { return "tu WordPress (wp-admin)"; }
  })();

  async function copiar() {
    try {
      await navigator.clipboard.writeText(syncUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard bloqueado: el usuario puede copiar del cuadro a mano */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-bold text-neutral-900 mb-3" style={{ fontFamily: "'Syne', sans-serif" }}>
          Sincronizar cursos
        </h2>
        <div className="text-xs text-neutral-600 leading-relaxed space-y-2">
          <p>Para traer o actualizar los cursos publicados en TutorLMS al CRM:</p>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>Accede como administrador a <code className="bg-neutral-100 px-1 rounded break-all">{wpAdmin}</code>.</li>
            <li>Abre este enlace en tu navegador (botón «Abrir») o cópialo:
              <div className="mt-1 bg-neutral-50 border border-neutral-200 rounded-md px-2 py-1.5 text-[11px] font-mono text-neutral-700 break-all">
                {syncUrl}
              </div>
            </li>
            <li>Verás el resumen de la sincronización en pantalla.</li>
            <li>Vuelve aquí y recarga la página para ver los cursos actualizados.</li>
          </ol>
          <p className="text-[11px] text-neutral-400">Los cursos nuevos y editados se sincronizan solos; esto es solo para forzar una sincronización.</p>
        </div>
        <div className="flex justify-end gap-2 pt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={copiar}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-neutral-700 border border-neutral-300 hover:bg-neutral-50 transition"
          >
            {copied ? "¡Copiado!" : "Copiar enlace"}
          </button>
          <a
            href={syncUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-80"
            style={{ background: "var(--color-primary)" }}
          >
            Abrir
          </a>
        </div>
      </div>
    </div>
  );
}

// EditCourseDrawer extraído a components/training/EditCourseDrawer.jsx
