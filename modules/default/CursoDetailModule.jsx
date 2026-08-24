"use client";

/**
 * CursoDetailModule — página de detalle de un Course con dos tabs:
 *   - Información: ficha read-only del curso + botón "Editar" que abre
 *     el EditCourseDrawer compartido.
 *   - Registros del curso: Stats + Lista + Detail drawer. Visible solo si
 *     el usuario tiene 'training' en su moduleAccess.
 *
 * Permisos: fetch /api/auth/me al montar. Si el usuario no tiene
 * 'training' en enabledModules → mensaje + botón "Volver al dashboard".
 *
 * Responsive: tabs ocupan ancho completo en mobile, cards de stats apilan
 * en 2 cols en sm, 4 en lg. Drawers son fullscreen <sm.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EditCourseDrawer } from "../../components/training/EditCourseDrawer.jsx";
import { CourseRegistrationStats } from "./CourseRegistrationStats.jsx";
import { CourseRegistrationsList } from "./CourseRegistrationsList.jsx";
import { CourseRegistrationDetail } from "./CourseRegistrationDetail.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

export default function CursoDetailModule({ courseId }) {
  const [me, setMe] = useState(null);
  const [meLoading, setMeLoading] = useState(true);
  const [course, setCourse] = useState(null);
  const [courseError, setCourseError] = useState(null);
  const [tab, setTab] = useState("info");
  const [editing, setEditing] = useState(false);
  const [selectedRegistration, setSelectedRegistration] = useState(null);

  // /api/auth/me — permisos
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => setMe(j?.ok ? j.data : null))
      .catch(() => setMe(null))
      .finally(() => setMeLoading(false));
  }, []);

  const loadCourse = useCallback(async () => {
    setCourseError(null);
    try {
      const r = await fetch(`/api/training/courses/${courseId}`);
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setCourse(j.data);
    } catch (e) {
      setCourseError(e.message);
    }
  }, [courseId]);

  useEffect(() => { loadCourse(); }, [loadCourse]);

  // Permisos
  if (meLoading) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="h-8 w-64 bg-neutral-100 rounded animate-pulse mb-4" />
        <div className="h-4 w-40 bg-neutral-100 rounded animate-pulse" />
      </div>
    );
  }

  const hasTraining = Array.isArray(me?.enabledModules)
    ? me.enabledModules.includes("training")
    : (Array.isArray(me?.moduleAccess) ? me.moduleAccess.includes("training") || me.moduleAccess.includes("all") : false);

  if (!hasTraining) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center">
        <div className="text-3xl mb-3">🔒</div>
        <h1 className="text-lg font-bold text-neutral-900 mb-2" style={{ fontFamily: "'Syne', sans-serif" }}>
          Sin acceso al módulo de Formación
        </h1>
        <p className="text-sm text-neutral-600 leading-relaxed mb-5">
          No tienes acceso al módulo de Formación. Si crees que es un error, contacta con el administrador.
        </p>
        <Link
          href="/"
          className="inline-block text-xs font-bold text-white px-4 py-2 rounded-lg transition-opacity hover:opacity-90"
          style={{ background: "var(--color-primary)" }}
        >
          Volver al dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className={anchoPantalla("listado")}>
      {/* Cabecera */}
      <div className="mb-5">
        <Link
          href="/formacion/cursos"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors mb-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Cursos
        </Link>
        {courseError ? (
          <div className="mt-2 px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700 flex items-center justify-between gap-2">
            <span>Error al cargar el curso: {courseError}</span>
            <button
              type="button"
              onClick={loadCourse}
              className="text-[11px] font-semibold underline hover:no-underline"
            >
              Reintentar
            </button>
          </div>
        ) : course ? (
          <div className="flex items-center gap-3 flex-wrap">
            <h1
              className="text-xl lg:text-2xl font-extrabold text-neutral-900"
              style={{ fontFamily: "'Syne', sans-serif" }}
            >
              {course.name}
            </h1>
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                course.active
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-neutral-100 text-neutral-500"
              }`}
            >
              {course.active ? "Activo" : "Inactivo"}
            </span>
          </div>
        ) : (
          <div className="h-7 w-64 bg-neutral-100 rounded animate-pulse" />
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-neutral-200 mb-5">
        <div className="flex items-center gap-1 overflow-x-auto">
          <TabButton active={tab === "info"} onClick={() => setTab("info")}>
            Información
          </TabButton>
          <TabButton active={tab === "registrations"} onClick={() => setTab("registrations")}>
            Registros del curso
          </TabButton>
        </div>
      </div>

      {/* Contenido tabs */}
      {tab === "info" && (
        <InfoTab course={course} onEdit={() => setEditing(true)} />
      )}

      {tab === "registrations" && (
        <RegistrationsTab
          courseId={courseId}
          onSelectRegistration={(r) => setSelectedRegistration(r.id)}
        />
      )}

      {/* EditCourseDrawer compartido */}
      {editing && course && (
        <EditCourseDrawer
          course={course}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); loadCourse(); }}
        />
      )}

      {/* Detail drawer */}
      {selectedRegistration && (
        <CourseRegistrationDetail
          registrationId={selectedRegistration}
          onClose={() => setSelectedRegistration(null)}
        />
      )}
    </div>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-sm font-semibold px-3 lg:px-4 py-2.5 border-b-2 transition-colors whitespace-nowrap ${
        active
          ? "border-[var(--color-primary)] text-neutral-900"
          : "border-transparent text-neutral-400 hover:text-neutral-700"
      }`}
    >
      {children}
    </button>
  );
}

function InfoTab({ course, onEdit }) {
  if (!course) {
    return (
      <div className="space-y-3">
        <div className="h-4 w-1/2 bg-neutral-100 rounded animate-pulse" />
        <div className="h-4 w-1/3 bg-neutral-100 rounded animate-pulse" />
      </div>
    );
  }
  return (
    <div className="bg-white border border-neutral-100 rounded-xl">
      <div className="px-4 lg:px-5 py-3 border-b border-neutral-100 flex items-center justify-between">
        <h2 className="text-sm font-bold text-neutral-900" style={{ fontFamily: "'Syne', sans-serif" }}>
          Información del curso
        </h2>
        <button
          type="button"
          onClick={onEdit}
          className="text-[11px] font-semibold text-neutral-600 hover:text-neutral-900 transition-colors px-2.5 py-1.5 rounded-md hover:bg-neutral-100 flex items-center gap-1.5"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
          </svg>
          Editar
        </button>
      </div>
      <dl className="px-4 lg:px-5 py-2">
        <DefRow label="Nombre" value={course.name} />
        <DefRow label="WP Course ID" value={course.wpCourseId} mono />
        <DefRow label="WC Product ID" value={course.wcProductId} mono />
        <DefRow label="Estado" value={course.active ? "Activo" : "Inactivo"} />
        <DefRow
          label="Creado"
          value={course.createdAt ? new Date(course.createdAt).toLocaleString("es-ES", {
            day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
          }) : "—"}
        />
      </dl>
    </div>
  );
}

function DefRow({ label, value, mono }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2.5 border-b border-neutral-50 last:border-0">
      <dt className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">
        {label}
      </dt>
      <dd className={`col-span-2 text-sm text-neutral-700 ${mono ? "font-mono" : ""}`}>
        {value ?? <span className="text-neutral-300">—</span>}
      </dd>
    </div>
  );
}

function RegistrationsTab({ courseId, onSelectRegistration }) {
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(null);

  // Filtros sincronizados con la lista. La List es la fuente única; este
  // parent solo los observa para refetchar stats coherentes con la tabla.
  const [filters, setFilters] = useState({ search: "", companyId: "", from: null, to: null });

  const loadStats = useCallback(() => {
    setStatsLoading(true);
    setStatsError(null);
    const params = new URLSearchParams({ courseId });
    if (filters.search) params.set("search", filters.search);
    if (filters.companyId) params.set("companyId", filters.companyId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    fetch(`/api/training/course-registrations/stats?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) throw new Error(j?.error || "Error al cargar stats");
        setStats(j.data);
      })
      .catch((e) => setStatsError(e.message))
      .finally(() => setStatsLoading(false));
  }, [courseId, filters.search, filters.companyId, filters.from, filters.to]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadStats(); }, [loadStats]);

  return (
    <div>
      {statsError && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700 flex items-center justify-between gap-2">
          <span>Stats no disponibles: {statsError}</span>
          <button type="button" onClick={loadStats} className="text-[11px] font-semibold underline hover:no-underline">
            Reintentar
          </button>
        </div>
      )}

      <CourseRegistrationStats stats={stats} loading={statsLoading} />

      <CourseRegistrationsList
        courseId={courseId}
        onSelect={onSelectRegistration}
        onFiltersChange={setFilters}
        onCountChange={() => { /* el List ya maneja su contador internamente */ }}
      />
    </div>
  );
}
