"use client";

import PreviewBanner from "../_components/PreviewBanner.jsx";
import {
  TEAM_RANKING,
  TEAM_ALERTS,
  TEAM_HISTORY,
  PERFORMANCE_AREAS,
  findTherapist,
  scoreToSemaforo,
  semaforoClasses,
} from "../_components/dummyData.js";

const KPIS = [
  { label: "Equipo activo", value: "6", sub: "Terapeutas" },
  { label: "Puntuación media", value: "84", sub: "/100 · Equipo" },
  { label: "Entregas en plazo", value: "92%", sub: "Informes último mes" },
  { label: "Quejas registradas", value: "0", sub: "Periodo en curso" },
];

function TeamLineChart({ data }) {
  const W = 600;
  const H = 120;
  const P = 16;
  const min = Math.min(...data.map((d) => d.value)) - 5;
  const max = Math.max(...data.map((d) => d.value)) + 5;
  const xStep = (W - P * 2) / (data.length - 1);
  const points = data.map((d, i) => {
    const x = P + i * xStep;
    const y = H - P - ((d.value - min) / (max - min)) * (H - P * 2);
    return { x, y, ...d };
  });
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${H - P} L ${P} ${H - P} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
      <path d={areaPath} fill="var(--color-primary, #1B3A2D)" opacity="0.08" />
      <path d={linePath} fill="none" stroke="var(--color-primary, #1B3A2D)" strokeWidth="2" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3" fill="var(--color-primary, #1B3A2D)" />
          <text x={p.x} y={H - 2} fontSize="9" textAnchor="middle" fill="#9CA3AF">
            {p.month}
          </text>
          <text x={p.x} y={p.y - 7} fontSize="9" textAnchor="middle" fill="#1B3A2D" fontWeight="600">
            {p.value}
          </text>
        </g>
      ))}
    </svg>
  );
}

function SemaforoMini({ areas }) {
  return (
    <div className="inline-flex items-center gap-0.5">
      {PERFORMANCE_AREAS.map((a) => {
        const level = scoreToSemaforo(areas[a.key]);
        const c = semaforoClasses(level);
        return (
          <span
            key={a.key}
            className={`w-2 h-2 rounded-full ${c.dot}`}
            title={`Área ${a.n}: ${a.name} — ${areas[a.key]}/100`}
          />
        );
      })}
    </div>
  );
}

export default function DireccionPage() {
  const totalProposed = TEAM_RANKING.reduce((s, r) => s + r.proposedIncentive, 0);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <PreviewBanner />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Clínica · Dirección</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">
            Panel de dirección
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Visión global del equipo · Periodo de Mayo 2026
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            defaultValue="2026-05"
            className="text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer"
          >
            <option value="2026-05">Mayo 2026</option>
            <option value="2026-04">Abril 2026</option>
            <option value="2026-03">Marzo 2026</option>
          </select>
          <select
            defaultValue="all"
            className="text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer"
          >
            <option value="all">Todo el equipo</option>
            <option value="t-1">Lorena Vázquez</option>
            <option value="t-2">Patricia Mendoza</option>
          </select>
        </div>
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

      {/* Ranking de terapeutas */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="px-4 lg:px-5 py-3 flex items-center justify-between border-b border-neutral-100">
          <h2 className="eyebrow">Ranking del equipo</h2>
          <span className="text-[10px] text-neutral-400">Mayo 2026 · Ordenado por puntuación</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50/50">
              <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-400">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Terapeuta</th>
                <th className="px-4 py-2 font-medium tabular text-right">Total</th>
                <th className="px-4 py-2 font-medium">Áreas</th>
                <th className="px-4 py-2 font-medium">Complementos</th>
                <th className="px-4 py-2 font-medium tabular text-right">Incentivo</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {TEAM_RANKING.map((r, idx) => {
                const t = findTherapist(r.therapistId);
                const level = scoreToSemaforo(r.totalScore);
                const c = semaforoClasses(level);
                return (
                  <tr key={r.therapistId} className="border-t border-neutral-100 hover:bg-neutral-50/50">
                    <td className="px-4 py-3 font-display text-base text-neutral-400 tabular w-8">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-display"
                          style={{ backgroundColor: t.color ?? "#1B3A2D" }}
                        >
                          {t.initials}
                        </div>
                        <div>
                          <div className="text-[var(--ink-900)] font-medium leading-tight">{t.name}</div>
                          <div className="text-[10px] text-neutral-400">{t.position}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex items-center gap-1.5 ${c.bg} ${c.text} text-[11px] font-medium px-2 py-0.5 rounded-full tabular`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                        {r.totalScore}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <SemaforoMini areas={r.areas} />
                    </td>
                    <td className="px-4 py-3 text-[11px] text-neutral-600">{r.complements}</td>
                    <td className="px-4 py-3 text-right tabular text-[var(--ink-900)] font-medium">
                      {r.proposedIncentive} €
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline">
                        Ver
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Leyenda áreas */}
        <div className="px-4 lg:px-5 py-3 border-t border-neutral-100 bg-neutral-50/40 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-neutral-500">
          <span className="uppercase tracking-wider text-neutral-400">Leyenda áreas:</span>
          {PERFORMANCE_AREAS.map((a) => (
            <span key={a.key} className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" /> {a.n}. {a.name}
            </span>
          ))}
        </div>
      </div>

      {/* Alertas + Evolución */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-3">
        <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="eyebrow">Alertas</h2>
            <span className="text-[10px] text-neutral-400">{TEAM_ALERTS.length} activas</span>
          </div>
          <div className="space-y-2">
            {TEAM_ALERTS.map((a) => {
              const t = findTherapist(a.therapistId);
              const sev = a.severity === "high" ? "red" : a.severity === "medium" ? "amber" : "amber";
              const c = semaforoClasses(sev);
              return (
                <div
                  key={a.id}
                  className={`flex items-start gap-3 rounded-lg border ${c.ring} ring-1 ${c.bg} p-3`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={`w-4 h-4 mt-0.5 shrink-0 ${c.text}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-medium ${c.text}`}>{t.name}</div>
                    <div className="text-[11px] text-neutral-700 leading-snug mt-0.5">{a.text}</div>
                  </div>
                  <button className={`shrink-0 text-[11px] ${c.text} hover:underline font-medium`}>
                    Revisar
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="eyebrow">Evolución del equipo</h2>
            <span className="text-[10px] text-neutral-400">Últimos 6 meses</span>
          </div>
          <TeamLineChart data={TEAM_HISTORY} />
          <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center justify-between text-[11px] text-neutral-500">
            <span>Tendencia positiva sostenida</span>
            <span className="text-emerald-600 font-medium">+6 pts vs Dic</span>
          </div>
        </div>
      </div>

      {/* Propuesta incentivos */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="px-4 lg:px-5 py-3 flex items-center justify-between border-b border-neutral-100">
          <div>
            <h2 className="eyebrow">Propuesta de incentivos</h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">Mayo 2026 · Generada por IA</p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">Total propuesto</div>
            <div className="font-display text-xl text-[var(--ink-900)] tabular">{totalProposed} €</div>
          </div>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-neutral-50/50">
            <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-400">
              <th className="px-4 py-2 font-medium">Terapeuta</th>
              <th className="px-4 py-2 font-medium tabular text-right">Propuesto</th>
              <th className="px-4 py-2 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {TEAM_RANKING.map((r) => {
              const t = findTherapist(r.therapistId);
              return (
                <tr key={r.therapistId} className="border-t border-neutral-100">
                  <td className="px-4 py-3 text-[var(--ink-900)]">{t.name}</td>
                  <td className="px-4 py-3 text-right tabular font-medium">{r.proposedIncentive} €</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button className="text-[11px] text-emerald-700 hover:underline font-medium">Aprobar</button>
                    <button className="text-[11px] text-neutral-500 hover:underline">Ajustar</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 lg:px-5 py-3 border-t border-neutral-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-neutral-50/40">
          <span className="text-[11px] text-neutral-500">
            Las propuestas se calcularán a partir de puntuación total, complementos y márgenes del centro.
          </span>
          <button
            className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            Aprobar todos ({totalProposed} €)
          </button>
        </div>
      </div>
    </div>
  );
}
