"use client";

import PreviewBanner from "../_components/PreviewBanner.jsx";
import {
  MY_PERFORMANCE,
  PERFORMANCE_AREAS,
  THERAPISTS,
  scoreToSemaforo,
  semaforoClasses,
} from "../_components/dummyData.js";

function ScoreCircle({ value }) {
  const radius = 38;
  const circ = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * circ;
  return (
    <div className="relative w-24 h-24 lg:w-28 lg:h-28 shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={radius} stroke="#E5E7EB" strokeWidth="8" fill="none" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          stroke="var(--color-primary, #1B3A2D)"
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] tabular">{value}</span>
        <span className="text-[10px] text-neutral-400">/100</span>
      </div>
    </div>
  );
}

function AreaCard({ area, score }) {
  const level = scoreToSemaforo(score);
  const c = semaforoClasses(level);
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-[10px] uppercase tracking-wider text-neutral-400">Área {area.n}</div>
        <div className={`inline-flex items-center gap-1.5 ${c.bg} ${c.text} text-[10px] font-medium px-2 py-0.5 rounded-full`}>
          <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
          {score}
        </div>
      </div>
      <div className="font-display text-sm text-[var(--ink-900)] mb-3 leading-tight">{area.name}</div>
      <ul className="space-y-1.5 mb-3 flex-1">
        {area.indicators.map((ind, i) => {
          const ic = semaforoClasses(ind.status);
          return (
            <li key={i} className="flex items-start gap-2 text-[11px]">
              <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${ic.dot}`} />
              <span className="flex-1 text-neutral-600 leading-snug">{ind.label}</span>
              <span className={`shrink-0 tabular ${ic.text} font-medium`}>{ind.value}</span>
            </li>
          );
        })}
      </ul>
      <button className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline text-left">
        Ver evidencias →
      </button>
    </div>
  );
}

function HistoryChart({ data }) {
  const max = Math.max(...data.map((d) => d.value), 100);
  return (
    <div className="flex items-end gap-2 h-32">
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        const isLast = i === data.length - 1;
        return (
          <div key={d.month} className="flex flex-col items-center gap-1 flex-1 min-w-0">
            <span className={`text-[10px] tabular ${isLast ? "text-[var(--ink-900)] font-semibold" : "text-neutral-400"}`}>
              {d.value}
            </span>
            <div className="w-full bg-neutral-100 rounded-t-sm overflow-hidden relative" style={{ height: 88 }}>
              <div
                className="absolute bottom-0 w-full rounded-t-sm transition-all"
                style={{
                  height: `${pct}%`,
                  background: isLast ? "var(--color-primary, #1B3A2D)" : "#9CA3AF",
                }}
              />
            </div>
            <span className="text-[10px] text-neutral-500">{d.month}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function MiDesempenoPage() {
  const me = THERAPISTS.find((t) => t.id === MY_PERFORMANCE.therapistId);
  const total = MY_PERFORMANCE.totalScore;
  const totalLevel = scoreToSemaforo(total);
  const totalC = semaforoClasses(totalLevel);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <PreviewBanner />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Clínica · Mi desempeño</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">
            {me.name}
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            {me.position} · Periodo de Mayo 2026
          </p>
        </div>
        <div className="inline-flex items-center gap-2 self-start lg:self-auto">
          <select
            defaultValue="2026-05"
            className="text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer"
          >
            <option value="2026-05">Mayo 2026</option>
            <option value="2026-04">Abril 2026</option>
            <option value="2026-03">Marzo 2026</option>
          </select>
        </div>
      </div>

      {/* Resumen + complementos */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-3">
        {/* Puntuación total */}
        <div
          className="rounded-xl p-5 flex items-center gap-4"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          <ScoreCircle value={total} />
          <div className="flex-1 min-w-0">
            <div className="text-white/60 eyebrow mb-1">Puntuación total</div>
            <div className="text-white text-sm leading-snug">
              Por encima de la media del equipo (84). Tu mejor mes desde diciembre.
            </div>
            <div className={`inline-flex items-center gap-1.5 mt-3 ${totalC.bg} ${totalC.text} text-[10px] font-medium px-2 py-0.5 rounded-full`}>
              <span className={`w-1.5 h-1.5 rounded-full ${totalC.dot}`} />
              {totalLevel === "green" ? "Excelente" : totalLevel === "amber" ? "Mejorable" : "Crítico"}
            </div>
          </div>
        </div>

        {/* Complementos */}
        <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
          <div className="eyebrow mb-3">Complementos</div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Ocupación</div>
              <div className="font-display text-xl text-[var(--ink-900)] tabular">
                {MY_PERFORMANCE.complements.occupation}%
              </div>
              <div className="text-[10px] text-emerald-600 font-medium">✓ Sobre estándar</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Antigüedad</div>
              <div className="font-display text-xl text-[var(--ink-900)] tabular">
                {MY_PERFORMANCE.complements.seniority} años
              </div>
              <div className="text-[10px] text-emerald-600 font-medium">✓ Consolidada</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Asistencia</div>
              <div className="font-display text-xl text-[var(--ink-900)] tabular">
                {MY_PERFORMANCE.complements.attendance ? "Sí" : "No"}
              </div>
              <div className="text-[10px] text-emerald-600 font-medium">✓ Sin faltas</div>
            </div>
          </div>
        </div>
      </div>

      {/* Áreas */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="eyebrow">Por áreas</h2>
          <span className="text-[10px] text-neutral-400">7 áreas evaluadas</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {PERFORMANCE_AREAS.map((area) => (
            <AreaCard key={area.key} area={area} score={MY_PERFORMANCE.areas[area.key]} />
          ))}
        </div>
      </div>

      {/* Histórico */}
      <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="eyebrow">Evolución últimos 6 meses</h2>
          <span className="text-[10px] text-neutral-400">Puntuación total</span>
        </div>
        <HistoryChart data={MY_PERFORMANCE.history} />
      </div>
    </div>
  );
}
