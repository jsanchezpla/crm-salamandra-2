"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PreviewBanner from "./_components/PreviewBanner.jsx";

const SHORTCUTS = [
  {
    href: "/clinica/informes",
    title: "Informes",
    desc: "Evolutivos, admisiones y altas.",
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
  {
    href: "/clinica/productividad",
    title: "Productividad",
    desc: "Horas de intervención directa sobre las disponibles, por profesional.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m5-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    href: "/clinica/incidencias",
    title: "Incidencias",
    desc: "Registro y seguimiento de incidencias del equipo por categoría.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
  },
  {
    href: "/clinica/bandeja",
    title: "Bandeja de trabajo",
    desc: "Lo tuyo pendiente: informes, incidencias y citas de hoy.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z" />
      </svg>
    ),
  },
];

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : "—");

// Accesos SOLO de dirección (admin): desempeño/incentivos y vistas de gestión.
// Se ocultan por defecto y solo aparecen cuando /api/auth/me confirma admin,
// para que una terapeuta no los vea ni un instante.
const ADMIN_ONLY_HREFS = new Set(["/clinica/mi-desempeno", "/clinica/direccion", "/clinica/productividad"]);

export default function ClinicaLanding() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/clinica/overview", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setData(j.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setIsAdmin(["admin", "superadmin"].includes(j.data?.role));
      })
      .catch(() => {});
  }, []);

  const shortcuts = SHORTCUTS.filter((s) => isAdmin || !ADMIN_ONLY_HREFS.has(s.href));

  const k = data?.kpis;
  const recent = data?.recentPatients ?? [];
  const dash = loading ? "—" : "0";

  const kpis = [
    { label: "Sesiones este mes", value: k ? k.sessionsMonth : dash, sub: "Mes en curso" },
    { label: "Informes pendientes", value: k ? k.reportsPending : dash, sub: k?.reportsOverdue ? `${k.reportsOverdue} con entrega vencida` : "Al día" },
    { label: "Coordinaciones", value: k ? k.coordinationsTotal : dash, sub: "Familia, colegio, externos" },
    {
      label: "Próxima entrega",
      value: k?.nextDelivery ? fmtDate(k.nextDelivery.dueDate) : "—",
      sub: k?.nextDelivery?.patientName ? `Informe · ${k.nextDelivery.patientName}` : "Sin entregas próximas",
    },
  ];

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <PreviewBanner />

      <div className="flex flex-col gap-2">
        <div className="eyebrow">Clínica · Resumen</div>
        <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight">Área clínica</h1>
        <p className="text-xs text-neutral-400">
          Equipo activo · {loading ? "—" : (k?.therapistCount ?? 0)} terapeutas · {loading ? "—" : (k?.patientsActive ?? 0)} pacientes en seguimiento
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((kp) => (
          <div key={kp.label} className="bg-white border border-neutral-100 rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">{kp.label}</div>
            <div className="font-display text-2xl text-[var(--ink-900)] mt-1 tabular">{kp.value}</div>
            <div className="text-[11px] text-neutral-500 mt-0.5">{kp.sub}</div>
          </div>
        ))}
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {shortcuts.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group bg-white border border-neutral-100 rounded-xl p-5 hover:border-[var(--color-primary,#1B3A2D)] hover:shadow-sm transition-all"
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 text-white" style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}>
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
          <span className="text-[10px] text-neutral-400">Por última sesión</span>
        </div>
        {loading ? (
          <p className="text-xs text-neutral-400">Cargando…</p>
        ) : recent.length === 0 ? (
          <p className="text-xs text-neutral-400">Aún no hay sesiones registradas.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {recent.map((p) => (
              <Link
                key={p.id}
                href={`/pacientes/${p.id}`}
                className="flex items-center gap-3 rounded-lg border border-neutral-100 hover:border-neutral-200 p-3 bg-neutral-50/50"
              >
                <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white font-display text-sm" style={{ backgroundColor: p.therapist?.color ?? p.color }}>
                  {p.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--ink-900)] font-medium truncate">
                    {p.name} <span className="text-neutral-400 font-normal">· {p.age ?? "—"} años</span>
                  </div>
                  <div className="text-[11px] text-neutral-500 truncate">{p.focus}</div>
                  <div className="text-[10px] text-neutral-400 mt-0.5 tabular">
                    {p.therapist?.name ?? "—"} · {fmtDate(p.lastSession)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
