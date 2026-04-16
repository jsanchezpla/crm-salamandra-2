"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const SECTIONS = [
  {
    href: "/formacion/empresas",
    label: "Empresas",
    desc: "Gestión de empresas cliente y cursos asignados",
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
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
      </svg>
    ),
  },
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

export default function FormacionPage() {
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
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1
          className="text-2xl font-extrabold text-neutral-900"
          style={{ fontFamily: "'Syne', sans-serif" }}
        >
          Formación
        </h1>
        <p className="text-sm text-neutral-400 mt-1">
          Gestión centralizada de empresas, cursos y alumnos
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
