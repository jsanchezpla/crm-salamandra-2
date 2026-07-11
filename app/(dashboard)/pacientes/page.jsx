"use client";

import { useState } from "react";
import Link from "next/link";
import Select from "@/components/ui/Select.jsx";
import PreviewBanner from "../clinica/_components/PreviewBanner.jsx";
import {
  PATIENTS,
  THERAPISTS,
  DIEGO_SESSIONS,
  findTherapist,
  statusStyles,
} from "./_components/dummyData.js";

const ACTIVE_COUNT = PATIENTS.filter((p) => p.status === "active").length;
const PAUSED_COUNT = PATIENTS.filter((p) => p.status === "paused").length;
const DISCHARGED_COUNT = PATIENTS.filter((p) => p.status === "discharged").length;

const KPIS = [
  { label: "Pacientes activos", value: String(ACTIVE_COUNT), sub: `${PATIENTS.length} en seguimiento` },
  { label: "En pausa", value: String(PAUSED_COUNT), sub: PAUSED_COUNT === 0 ? "Sin pausas" : "Revisar continuidad" },
  { label: "Altas", value: String(DISCHARGED_COUNT), sub: DISCHARGED_COUNT === 0 ? "Ninguna este periodo" : "Ver detalle" },
  { label: "Sesiones registradas", value: String(DIEGO_SESSIONS.length), sub: "Últimas 4 semanas" },
];

export default function PacientesPage() {
  const [search, setSearch] = useState("");
  const [therapistFilter, setTherapistFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = PATIENTS.filter((p) => {
    const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
    if (search && !fullName.includes(search.toLowerCase())) return false;
    if (therapistFilter !== "all" && p.mainTherapistId !== therapistFilter) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <PreviewBanner />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Aumenta · Clínica</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">
            Pacientes
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Pacientes activos del centro · {PATIENTS.length} en seguimiento
          </p>
        </div>
        <button
          className="self-start lg:self-auto text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Nuevo paciente
        </button>
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

      {/* Filtros */}
      <div className="bg-white border border-neutral-100 rounded-xl p-3 flex flex-col lg:flex-row gap-2">
        <div className="relative flex-1">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Buscar por nombre…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400"
          />
        </div>
        <Select
          value={therapistFilter}
          onChange={(v) => setTherapistFilter(v)}
          options={[
            { value: "all", label: "Todas las terapeutas" },
            ...THERAPISTS.map((t) => ({ value: t.id, label: t.name })),
          ]}
          className="text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer"
        />
        <Select
          value={statusFilter}
          onChange={(v) => setStatusFilter(v)}
          options={[
            { value: "all", label: "Todos los estados" },
            { value: "active", label: "Activo" },
            { value: "paused", label: "En pausa" },
            { value: "discharged", label: "Alta" },
          ]}
          className="text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer"
        />
      </div>

      {/* Tabla */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50/50">
              <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-400">
                <th className="px-4 py-3 font-medium">Paciente</th>
                <th className="px-4 py-3 font-medium">Centro / curso</th>
                <th className="px-4 py-3 font-medium">Motivo</th>
                <th className="px-4 py-3 font-medium">Terapeuta</th>
                <th className="px-4 py-3 font-medium">Última sesión</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const t = findTherapist(p.mainTherapistId);
                const s = statusStyles(p.status);
                return (
                  <tr key={p.id} className="border-t border-neutral-100 hover:bg-neutral-50/40">
                    <td className="px-4 py-3">
                      <Link href={`/pacientes/${p.id}`} className="flex items-center gap-2.5 group">
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[11px] font-display shrink-0"
                          style={{ backgroundColor: p.color }}
                        >
                          {p.initials}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[var(--ink-900)] font-medium leading-tight group-hover:underline">
                            {p.firstName} {p.lastName}
                          </div>
                          <div className="text-[10px] text-neutral-400">{p.age} años</div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-neutral-700 truncate max-w-[180px]">{p.educationCenter}</div>
                      <div className="text-[10px] text-neutral-400">{p.educationLevel}</div>
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      <div className="text-neutral-600 truncate" title={p.referralReason}>
                        {p.referralReason}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-1.5 bg-neutral-50 border border-neutral-100 rounded-full px-2 py-0.5">
                        <div
                          className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-white text-[7px] font-display"
                          style={{ backgroundColor: t.color }}
                        >
                          {t.initials}
                        </div>
                        <span className="text-[11px] text-neutral-700">{t.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular text-neutral-600">{p.lastSession}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 ${s.bg} ${s.text} text-[10px] font-medium px-2 py-0.5 rounded-full`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                        {p.statusLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Link
                        href={`/pacientes/${p.id}`}
                        className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline"
                      >
                        Ver ficha
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-neutral-400 text-xs">
                    Sin resultados para esos filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
