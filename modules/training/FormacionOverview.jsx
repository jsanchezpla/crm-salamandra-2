"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import HelpTooltip from "../../components/ui/HelpTooltip.jsx";

const SECTIONS = [
  {
    href: "/formacion/empresas",
    label: "Empresas",
    desc: "Gestión de empresas cliente y cursos asignados",
    help: "Aquí ves todas las empresas que tienen alumnos en tu plataforma de formación. Puedes crear una nueva empresa, abrir cada ficha para ver sus empleados y qué cursos tienen asignados. IMPORTANTE: los alumnos de empresa se importan desde aquí — entra en la ficha de la empresa y usa «Importar empleados» con un Excel.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
      </svg>
    ),
  },
  {
    href: "/formacion/cursos",
    label: "Cursos",
    desc: "Catálogo de cursos sincronizados con WordPress",
    help: "El listado completo de cursos que ofreces. Pulsa cualquier curso para abrir su ficha: ahí ves toda la información del curso y los registros del curso (los alumnos apuntados con sus datos). También puedes editar el nombre, activar o desactivar un curso y ver cuándo se sincronizó por última vez con tu academia online.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    href: "/formacion/usuarios",
    label: "Usuarios",
    desc: "Alumnos privados y de empresa",
    help: "Todas las personas registradas en tu plataforma: tanto alumnos particulares como empleados que vienen de una empresa. Puedes buscar por nombre o email, filtrar por empresa, exportar la lista a Excel e importar empleados de una empresa de golpe.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-4.5 0 2.625 2.625 0 014.5 0z" />
      </svg>
    ),
  },
  {
    href: "/formacion/alumnos",
    label: "Alumnos por curso",
    desc: "Matrículas y registros de alumnos",
    help: "Aquí ves quién está apuntado a qué curso. Cada fila es una matrícula: el alumno, el curso al que se apuntó y la fecha. Puedes filtrar por curso o por empresa para saber, por ejemplo, qué empleados de una empresa están haciendo un curso concreto.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
      </svg>
    ),
  },
  {
    href: "/formacion/cuestionarios",
    label: "Cuestionarios",
    desc: "Intentos de quiz sincronizados con TutorLMS",
    help: "Los exámenes que han hecho tus alumnos. Cada línea es un intento: ves quién lo hizo, en qué curso, cuántas preguntas acertó y si aprobó o suspendió. Al abrir uno verás todas las preguntas con la respuesta del alumno y la correcta.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
      </svg>
    ),
  },
];

const METRIC_HELP = {
  Empresas: "Número total de empresas dadas de alta en tu plataforma de formación.",
  "Cursos activos": "Cursos que actualmente están visibles para los alumnos. Los cursos desactivados no cuentan aquí.",
  Usuarios: "Total de personas registradas: alumnos particulares + empleados de empresa.",
  Matrículas: "Total de inscripciones a cursos. Si un alumno está apuntado a 3 cursos, cuenta 3 veces.",
};

function MetricCard({ label, value, loading }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-5">
      <div className="flex items-center gap-1.5 mb-2">
        <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-widest">{label}</p>
        {METRIC_HELP[label] && (
          <HelpTooltip title={label} placement="bottom">
            {METRIC_HELP[label]}
          </HelpTooltip>
        )}
      </div>
      {loading ? (
        <div className="h-8 w-16 bg-neutral-100 rounded animate-pulse" />
      ) : (
        <p
          className="text-3xl font-extrabold"
          style={{ fontFamily: "'Syne', sans-serif", color: "var(--color-primary)" }}
        >
          {value ?? "—"}
        </p>
      )}
    </div>
  );
}

export default function FormacionOverview() {
  const [stats, setStats] = useState({ companies: null, courses: null, users: null, enrollments: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/training/companies").then((r) => r.json()),
      fetch("/api/training/courses?active=true").then((r) => r.json()),
      fetch("/api/training/users?limit=1").then((r) => r.json()),
      fetch("/api/training/enrollments?limit=1").then((r) => r.json()),
    ])
      .then(([companies, courses, users, enrollments]) => {
        setStats({
          companies: companies.ok ? companies.data.length : 0,
          courses: courses.ok ? courses.data.length : 0,
          users: users.ok ? users.data.total : 0,
          enrollments: enrollments.ok ? enrollments.data.total : 0,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    // Dimensionado 2026-07-27: antes p-10 + hero de 40px + banda bg-accent de
    // 72rem (copiado del workspace de Clientes) — en esta landing casi vacía se
    // veía todo demasiado ancho. Ahora sigue el patrón estándar de las páginas
    // del CRM (p-4 lg:p-8 max-w-5xl, h1 text-2xl lg:text-4xl, sin banda).
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6 lg:mb-8">
        <div className="eyebrow mb-1.5 lg:mb-2">Conocimiento · Formación</div>
        <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mb-3 flex items-center gap-2">
          <span>
            Formación <span className="font-display-italic text-[var(--ink-400)]">— empresas, cursos, alumnos</span>
          </span>
          <HelpTooltip title="Módulo de Formación" placement="bottom">
            Es el centro de control de tu academia online. Desde aquí gestionas las empresas que compran formación,
            tu catálogo de cursos, los alumnos inscritos y los exámenes que han hecho. Los datos llegan
            automáticamente desde tu WordPress, no tienes que meterlos a mano.
          </HelpTooltip>
        </h1>
        <p className="text-sm text-[var(--ink-500)] max-w-xl leading-relaxed">
          Gestión centralizada de empresas cliente, catálogo de cursos y matrículas de alumnos.
        </p>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Empresas" value={stats.companies} loading={loading} />
        <MetricCard label="Cursos activos" value={stats.courses} loading={loading} />
        <MetricCard label="Usuarios" value={stats.users} loading={loading} />
        <MetricCard label="Matrículas" value={stats.enrollments} loading={loading} />
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SECTIONS.map((s) => (
          <div
            key={s.href}
            className="group bg-white border border-neutral-100 rounded-xl p-5 flex items-start gap-4 transition-all hover:shadow-md hover:border-neutral-200 relative"
          >
            <Link href={s.href} className="absolute inset-0 rounded-xl" aria-label={s.label} />
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors"
              style={{ background: "color-mix(in srgb, var(--color-primary) 10%, white)" }}
            >
              <span style={{ color: "var(--color-primary)" }}>{s.icon}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <p
                  className="text-sm font-bold text-neutral-900"
                  style={{ fontFamily: "'Syne', sans-serif" }}
                >
                  {s.label}
                </p>
                {/* z-10 para que el botón quede por encima del Link absoluto */}
                <span className="relative z-10">
                  <HelpTooltip title={s.label} placement="bottom">
                    {s.help}
                  </HelpTooltip>
                </span>
              </div>
              <p className="text-xs text-neutral-400">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
