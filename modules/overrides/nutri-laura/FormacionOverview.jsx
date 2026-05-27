"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Override del overview del módulo Formación para nutri_laura.
//
// Diferencias vs. el default:
// - Copy adaptado a nutrición (sin "WordPress" / "TutorLMS" / "empresas
//   cliente" como protagonistas).
// - Solo se muestran las 3 secciones que aplican a Laura hoy:
//   Cursos, Alumnos, Matrículas.
//
// El backend (tablas companies/company_courses/quiz_attempts y los
// endpoints correspondientes) está activo para soportar B2B y
// cuestionarios en el futuro sin migración adicional. Cuando Laura
// active B2B o conecte TutorLMS, descomenta las secciones marcadas
// con TODO abajo (es un cambio cosmético, no de schema).

const SECTIONS = [
  {
    href: "/formacion/cursos",
    label: "Cursos",
    desc: "Catálogo de cursos online de nutrición",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    href: "/formacion/usuarios",
    label: "Alumnos",
    desc: "Alumnos privados y, en el futuro, alumnos de empresa",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-4.5 0 2.625 2.625 0 014.5 0z" />
      </svg>
    ),
  },
  {
    href: "/formacion/alumnos",
    label: "Matrículas",
    desc: "Inscripciones de alumnos en cursos",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
      </svg>
    ),
  },
  // TODO B2B — descomentar cuando Laura active alumnos de empresa:
  // {
  //   href: "/formacion/empresas",
  //   label: "Empresas",
  //   desc: "Centros y gimnasios con cursos contratados",
  //   icon: (...),
  // },
  // TODO TutorLMS — descomentar cuando Laura conecte WordPress + TutorLMS:
  // {
  //   href: "/formacion/cuestionarios",
  //   label: "Cuestionarios",
  //   desc: "Intentos de quiz desde la plataforma",
  //   icon: (...),
  // },
];

function MetricCard({ label, value, loading }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-5">
      <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-widest mb-2">{label}</p>
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

export default function NutriLauraFormacionOverview() {
  const [stats, setStats] = useState({ courses: null, users: null, enrollments: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/training/courses?active=true").then((r) => r.json()),
      fetch("/api/training/users?limit=1").then((r) => r.json()),
      fetch("/api/training/enrollments?limit=1").then((r) => r.json()),
    ])
      .then(([courses, users, enrollments]) => {
        setStats({
          courses: courses.ok ? courses.data.length : 0,
          users: users.ok ? users.data.total : 0,
          enrollments: enrollments.ok ? enrollments.data.total : 0,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 lg:p-10 max-w-6xl mx-auto bg-[var(--color-accent)] min-h-full">
      {/* Header */}
      <div className="mb-7 lg:mb-10">
        <div className="eyebrow mb-1.5 lg:mb-2">Conocimiento · Formación</div>
        <h1 className="font-display text-[26px] lg:text-[40px] leading-[1.05] text-[var(--ink-900)] tracking-tight mb-3">
          Formación{" "}
          <span className="font-display-italic text-[var(--ink-400)]">
            — cursos, alumnos, matrículas
          </span>
        </h1>
        <p className="text-[14px] lg:text-[15px] text-[var(--ink-500)] max-w-xl leading-relaxed">
          Tu catálogo de cursos online de nutrición, los alumnos inscritos y el
          seguimiento de sus matrículas.
        </p>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <MetricCard label="Cursos activos" value={stats.courses} loading={loading} />
        <MetricCard label="Alumnos" value={stats.users} loading={loading} />
        <MetricCard label="Matrículas" value={stats.enrollments} loading={loading} />
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group bg-white border border-neutral-100 rounded-xl p-5 flex items-start gap-4 transition-all hover:shadow-md hover:border-neutral-200"
          >
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors"
              style={{ background: "color-mix(in srgb, var(--color-primary) 10%, white)" }}
            >
              <span style={{ color: "var(--color-primary)" }}>{s.icon}</span>
            </div>
            <div>
              <p
                className="text-sm font-bold text-neutral-900 mb-0.5"
                style={{ fontFamily: "'Syne', sans-serif" }}
              >
                {s.label}
              </p>
              <p className="text-xs text-neutral-400">{s.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
