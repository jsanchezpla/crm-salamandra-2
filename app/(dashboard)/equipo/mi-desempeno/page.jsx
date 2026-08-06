"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Select from "@/components/ui/Select.jsx";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import { AreaIcon } from "../_components/performanceIcons.jsx";

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

// Tarjeta de área: icono + semáforo; la META del rol se muestra como subtítulo
// (y tooltip). Los `indicators` solo existen en las áreas legacy de terapia.
function AreaCard({ area, index }) {
  const c = sc(area.level);
  const indicators = area.indicators ?? [];
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-neutral-400">
          <AreaIcon icon={area.icon} className="w-4 h-4" />
          <span className="text-[10px] uppercase tracking-wider">Área {area.n ?? index + 1}</span>
        </div>
        <div className={`inline-flex items-center gap-1.5 ${c.bg} ${c.text} text-[10px] font-medium px-2 py-0.5 rounded-full`}>
          <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
          {area.score ?? "—"}
        </div>
      </div>
      <div className="font-display text-sm text-[var(--ink-900)] mb-1 leading-tight">{area.name}</div>
      {area.goal ? (
        <p className="text-[11px] text-neutral-500 leading-snug mb-3" title={area.goal}>Meta: {area.goal}</p>
      ) : (
        <div className="mb-2" />
      )}
      {indicators.length > 0 && (
        <ul className="space-y-1.5 mb-1 flex-1">
          {indicators.map((ind, i) => {
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
      )}
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
  // Bloque `roles` de la config (viene en el GET me): para el chip del rol.
  const rolesList = Array.isArray(data?.roles) ? data.roles : (data?.roles?.roles ?? []);
  const roleName = m?.roleName ?? rolesList.find((r) => r.key === m?.roleKey)?.name ?? null;

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <Link href="/equipo" className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] transition-colors w-fit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Volver a Equipo
      </Link>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Equipo · Mi desempeño</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">{loading ? "…" : (m?.therapist?.name ?? "—")}</h1>
          <p className="text-xs text-neutral-400 mt-1">{m?.therapist?.position ?? "—"} · Periodo de {m?.period?.label ?? "—"}</p>
        </div>
        <div className="flex items-center gap-2 self-start lg:self-auto">
          {roleName && (
            <span className="inline-flex items-center gap-1.5 bg-neutral-100 text-neutral-600 text-[10px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap" title="Rol de desempeño con el que se evalúa a esta persona">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
              {roleName}
            </span>
          )}
          {therapists.length > 1 && (
            <Select
              value={therapistId || (m?.therapistId ?? "")}
              onChange={setTherapistId}
              options={therapists.map((t) => ({ value: t.id, label: t.name }))}
              className="text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer"
            />
          )}
          <Link
            href="/equipo/desempeno-config"
            className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 transition-colors whitespace-nowrap"
            title="Configurar roles y áreas de desempeño"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            Configurar
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-neutral-400">Cargando desempeño…</div>
      ) : !m ? (
        <div className="bg-white border border-dashed border-neutral-200 rounded-xl p-10 text-center text-sm text-neutral-600">Sin métricas de desempeño para este miembro del equipo.</div>
      ) : (
        <>
          {/* Resumen + complementos */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-3">
            <div className="rounded-xl p-5 flex items-center gap-4" style={{ background: "var(--color-primary, #1B3A2D)" }}>
              <ScoreCircle value={m.totalScore} />
              <div className="flex-1 min-w-0">
                <div className="text-white/60 eyebrow mb-1">
                  Puntuación total
                  <HelpTooltip title="Puntuación total" className="ml-1.5" label="Cómo sale la puntuación total">
                    Media de las áreas de abajo, cada una con su peso.{" "}
                    <strong className="text-white">Un área sin puntuar no baja el total</strong>: no entra
                    en la media, así que una evaluación a medias sale igual de alta que una completa.
                    La media del equipo cuenta solo a quien ya tenga evaluación de ese mes, con el puesto
                    que tenga; si no hay nadie más, se compara con su propia puntuación.
                  </HelpTooltip>
                </div>
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

          {/* Áreas (las del ROL de la persona) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="eyebrow">Por áreas</h2>
              <span className="text-[10px] text-neutral-400">{m.areas.length} áreas evaluadas</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {m.areas.map((area, i) => <AreaCard key={area.key} area={area} index={i} />)}
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
