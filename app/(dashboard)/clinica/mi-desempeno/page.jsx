"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Select from "@/components/ui/Select.jsx";
import PreviewBanner from "../_components/PreviewBanner.jsx";

const SEMAFORO = {
  green: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  amber: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  red: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
  gray: { bg: "bg-neutral-100", text: "text-neutral-500", dot: "bg-neutral-400" },
};
const sc = (level) => SEMAFORO[level] ?? SEMAFORO.gray;

function ScoreCircle({ value }) {
  const radius = 38;
  const circ = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const dash = (pct / 100) * circ;
  return (
    <div className="relative w-24 h-24 lg:w-28 lg:h-28 shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={radius} stroke="rgba(255,255,255,0.18)" strokeWidth="8" fill="none" />
        <circle cx="50" cy="50" r={radius} stroke="#ffffff" strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl lg:text-3xl text-white tabular">{value ?? "—"}</span>
        <span className="text-[10px] text-white/60">/100</span>
      </div>
    </div>
  );
}

function AreaCard({ area }) {
  const c = sc(area.level);
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-[10px] uppercase tracking-wider text-neutral-400">Área {area.n}</div>
        <div className={`inline-flex items-center gap-1.5 ${c.bg} ${c.text} text-[10px] font-medium px-2 py-0.5 rounded-full`}>
          <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
          {area.score ?? "—"}
        </div>
      </div>
      <div className="font-display text-sm text-[var(--ink-900)] mb-3 leading-tight">{area.name}</div>
      <ul className="space-y-1.5 mb-1 flex-1">
        {area.indicators.map((ind, i) => {
          const ic = sc(ind.status);
          return (
            <li key={i} className="flex items-start gap-2 text-[11px]">
              <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${ic.dot}`} />
              <span className="flex-1 text-neutral-600 leading-snug">{ind.label}</span>
              <span className={`shrink-0 tabular ${ic.text} font-medium`}>{ind.value}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HistoryChart({ data }) {
  if (!data?.length) return <p className="text-xs text-neutral-400">Sin histórico.</p>;
  const max = Math.max(...data.map((d) => d.value), 100);
  return (
    <div className="flex items-end gap-2 h-32">
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        const isLast = i === data.length - 1;
        return (
          <div key={i} className="flex flex-col items-center gap-1 flex-1 min-w-0">
            <span className={`text-[10px] tabular ${isLast ? "text-[var(--ink-900)] font-semibold" : "text-neutral-400"}`}>{d.value}</span>
            <div className="w-full bg-neutral-100 rounded-t-sm overflow-hidden relative" style={{ height: 88 }}>
              <div className="absolute bottom-0 w-full rounded-t-sm transition-all" style={{ height: `${pct}%`, background: isLast ? "var(--color-primary, #1B3A2D)" : "#9CA3AF" }} />
            </div>
            <span className="text-[10px] text-neutral-500">{d.month}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function MiDesempenoPage() {
  const [data, setData] = useState(null);
  const [therapistId, setTherapistId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const qs = therapistId ? `?therapistId=${therapistId}` : "";
    fetch(`/api/clinica/performance/me${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j.ok) setData(j.data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [therapistId]);

  const m = data?.metric;
  const therapists = data?.therapists ?? [];
  const totalLevel = m?.totalLevel ?? "gray";
  const tc = sc(totalLevel);
  const avg = m?.teamAverage;
  const cmp = m?.complements ?? {};

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <Link href="/clinica" className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] transition-colors w-fit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Volver a Clínica
      </Link>

      <PreviewBanner />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Clínica · Mi desempeño</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">{loading ? "…" : (m?.therapist?.name ?? "—")}</h1>
          <p className="text-xs text-neutral-400 mt-1">{m?.therapist?.position ?? "—"} · Periodo de {m?.period?.label ?? "—"}</p>
        </div>
        {therapists.length > 1 && (
          <Select
            value={therapistId || (m?.therapistId ?? "")}
            onChange={setTherapistId}
            options={therapists.map((t) => ({ value: t.id, label: t.name }))}
            className="self-start lg:self-auto text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer"
          />
        )}
      </div>

      {loading ? (
        <div className="text-sm text-neutral-400">Cargando desempeño…</div>
      ) : !m ? (
        <div className="bg-white border border-dashed border-neutral-200 rounded-xl p-10 text-center text-sm text-neutral-600">Sin métricas de desempeño para este terapeuta.</div>
      ) : (
        <>
          {/* Resumen + complementos */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-3">
            <div className="rounded-xl p-5 flex items-center gap-4" style={{ background: "var(--color-primary, #1B3A2D)" }}>
              <ScoreCircle value={m.totalScore} />
              <div className="flex-1 min-w-0">
                <div className="text-white/60 eyebrow mb-1">Puntuación total</div>
                <div className="text-white text-sm leading-snug">
                  {avg != null ? (m.totalScore >= avg ? `Por encima de la media del equipo (${avg}).` : `Por debajo de la media del equipo (${avg}).`) : "Puntuación del periodo."}
                </div>
                <div className={`inline-flex items-center gap-1.5 mt-3 ${tc.bg} ${tc.text} text-[10px] font-medium px-2 py-0.5 rounded-full`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${tc.dot}`} />
                  {totalLevel === "green" ? "Excelente" : totalLevel === "amber" ? "Mejorable" : "Crítico"}
                </div>
              </div>
            </div>

            <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
              <div className="eyebrow mb-3">Complementos</div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Ocupación</div>
                  <div className="font-display text-xl text-[var(--ink-900)] tabular">{cmp.occupation ?? "—"}%</div>
                  <div className={`text-[10px] font-medium ${(cmp.occupation ?? 0) >= 90 ? "text-emerald-600" : "text-neutral-400"}`}>{(cmp.occupation ?? 0) >= 90 ? "✓ Sobre estándar" : "Por debajo"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Antigüedad</div>
                  <div className="font-display text-xl text-[var(--ink-900)] tabular">{cmp.seniority ?? "—"} años</div>
                  <div className={`text-[10px] font-medium ${(cmp.seniority ?? 0) >= 3 ? "text-emerald-600" : "text-neutral-400"}`}>{(cmp.seniority ?? 0) >= 3 ? "✓ Consolidada" : "En curso"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Asistencia</div>
                  <div className="font-display text-xl text-[var(--ink-900)] tabular">{cmp.attendance ? "Sí" : "No"}</div>
                  <div className={`text-[10px] font-medium ${cmp.attendance ? "text-emerald-600" : "text-neutral-400"}`}>{cmp.attendance ? "✓ Sin faltas" : "Con faltas"}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Áreas */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="eyebrow">Por áreas</h2>
              <span className="text-[10px] text-neutral-400">{m.areas.length} áreas evaluadas</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {m.areas.map((area) => <AreaCard key={area.key} area={area} />)}
            </div>
          </div>

          {/* Histórico */}
          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="eyebrow">Evolución últimos 6 meses</h2>
              <span className="text-[10px] text-neutral-400">Puntuación total</span>
            </div>
            <HistoryChart data={m.history} />
          </div>
        </>
      )}
    </div>
  );
}
