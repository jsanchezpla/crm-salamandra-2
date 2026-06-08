"use client";

import Link from "next/link";
import PreviewBanner from "./_components/PreviewBanner.jsx";
import { PATIENTS, findTherapist } from "./_components/dummyData.js";

const KPIS = [
  { label: "Sesiones este mes", value: "247", sub: "Junio 2026" },
  { label: "Informes pendientes", value: "8", sub: "2 con entrega vencida" },
  { label: "Coordinaciones", value: "32", sub: "Familia, colegio, externos" },
  { label: "Próxima entrega", value: "12 jun", sub: "Informe evolutivo Diego M." },
];

const SHORTCUTS = [
  {
    href: "/clinica/informes",
    title: "Informes",
    desc: "Evolutivos, admisiones y altas generados por IA.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    href: "/clinica/mi-desempeno",
    title: "Mi desempeño",
    desc: "Tus 7 áreas + complementos, evolución y propuesta de incentivo.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h3.75l1.5-4.5 3 9 1.5-4.5h8.25" />
      </svg>
    ),
  },
  {
    href: "/clinica/direccion",
    title: "Dirección",
    desc: "Ranking del equipo, alertas y propuesta de incentivos del mes.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v18m16.5-18v18M3.75 9h16.5m-16.5 6h16.5" />
      </svg>
    ),
  },
];

export default function ClinicaLanding() {
  const recent = [...PATIENTS]
    .sort((a, b) => (a.lastSession < b.lastSession ? 1 : -1))
    .slice(0, 6);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <PreviewBanner />

      <div className="flex flex-col gap-2">
        <div className="eyebrow">Clínica · Resumen</div>
        <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight">
          Área clínica
        </h1>
        <p className="text-xs text-neutral-400">
          Equipo activo · 6 terapeutas · Periodo de mayo cerrado el 31. Junio en curso.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {KPIS.map((k) => (
          <div key={k.label} className="bg-white border border-neutral-100 rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">{k.label}</div>
            <div className="font-display text-2xl text-[var(--ink-900)] mt-1 tabular">{k.value}</div>
            <div className="text-[11px] text-neutral-500 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {SHORTCUTS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group bg-white border border-neutral-100 rounded-xl p-5 hover:border-[var(--color-primary,#1B3A2D)] hover:shadow-sm transition-all"
          >
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 text-white"
              style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}
            >
              {s.icon}
            </div>
            <div className="font-display text-base text-[var(--ink-900)]">{s.title}</div>
            <div className="text-xs text-neutral-500 mt-1 leading-relaxed">{s.desc}</div>
            <div className="mt-3 text-[11px] text-[var(--color-primary,#1B3A2D)] inline-flex items-center gap-1 group-hover:gap-1.5 transition-all">
              Abrir
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </Link>
        ))}
      </div>

      {/* Pacientes recientes con sesiones */}
      <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="eyebrow">Pacientes recientes con sesiones</h2>
          <span className="text-[10px] text-neutral-400">Últimos 7 días</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {recent.map((p) => {
            const t = findTherapist(p.therapistId);
            return (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-lg border border-neutral-100 hover:border-neutral-200 p-3 bg-neutral-50/50"
              >
                <div
                  className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white font-display text-sm"
                  style={{ backgroundColor: t.color ?? "#1B3A2D" }}
                >
                  {p.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--ink-900)] font-medium truncate">
                    {p.name} <span className="text-neutral-400 font-normal">· {p.age} años</span>
                  </div>
                  <div className="text-[11px] text-neutral-500 truncate">{p.focus}</div>
                  <div className="text-[10px] text-neutral-400 mt-0.5 tabular">
                    {t.name} · {p.lastSession}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
