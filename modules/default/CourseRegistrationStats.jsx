"use client";

/**
 * CourseRegistrationStats — cards de stats + sección colapsable con
 * gráficos CSS para el módulo de Registros previos al curso.
 *
 * No introduce librerías de gráficos. Todas las visualizaciones son barras
 * horizontales (`<div style={{ width }}>`) o columnas verticales (12 meses)
 * implementadas con flex+CSS. Animación de entrada de las barras:
 * transition-[width] 500ms.
 *
 * Si totalRegistrations === 0 renderiza un placeholder amable y no
 * intenta pintar gráficos.
 *
 * Props:
 *   - stats   objeto devuelto por GET /api/training/course-registrations/stats
 *   - loading bool
 */

import { useState, useEffect } from "react";

export function CourseRegistrationStats({ stats, loading }) {
  // Trigger de animación: al montar (o cuando cambian los datos), las barras
  // arrancan a width:0 y transicionan a su valor real.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (!stats) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnimate(false);
    const t = setTimeout(() => setAnimate(true), 60);
    return () => clearTimeout(t);
  }, [stats]);

  const [showMore, setShowMore] = useState(false);

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white border border-neutral-100 rounded-xl p-4 animate-pulse">
            <div className="h-3 w-20 bg-neutral-100 rounded mb-3" />
            <div className="h-6 w-12 bg-neutral-200 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!stats) return null;

  if (stats.totalRegistrations === 0) {
    return (
      <div className="bg-white border border-neutral-100 rounded-xl p-8 text-center mb-5">
        <div className="text-3xl mb-2">📋</div>
        <p className="text-sm text-neutral-600 font-medium">
          Aún no hay registros para este curso.
        </p>
        <p className="text-xs text-neutral-400 mt-1">
          Las estadísticas aparecerán aquí cuando lleguen los primeros formularios.
        </p>
      </div>
    );
  }

  const topCompany = stats.distributionByCompany?.[0];
  const motivationPct = ((stats.averageMotivation || 0) / 5) * 100;
  const stressPct = ((stats.averageStress || 0) / 5) * 100;

  return (
    <div className="mb-5">
      {/* Cards arriba */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total registros">
          <div className="text-2xl lg:text-3xl font-bold text-neutral-900">
            {stats.totalRegistrations}
          </div>
        </StatCard>

        <StatCard label="Motivación media">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl lg:text-3xl font-bold text-neutral-900">
              {stats.averageMotivation.toFixed(1)}
            </span>
            <span className="text-xs text-neutral-400">/5</span>
          </div>
          <ScaleBar pct={animate ? motivationPct : 0} tone="positive" />
        </StatCard>

        <StatCard label="Estrés medio">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl lg:text-3xl font-bold text-neutral-900">
              {stats.averageStress.toFixed(1)}
            </span>
            <span className="text-xs text-neutral-400">/5</span>
          </div>
          <ScaleBar pct={animate ? stressPct : 0} tone="warning" />
        </StatCard>

        <StatCard label="Top empresa">
          {topCompany ? (
            <>
              <div className="text-sm font-semibold text-neutral-900 truncate" title={topCompany.companyName}>
                {topCompany.companyName}
              </div>
              <div className="text-xs text-neutral-500 mt-1">
                {topCompany.count} ({topCompany.percentage}%)
              </div>
            </>
          ) : (
            <span className="text-sm text-neutral-300">—</span>
          )}
        </StatCard>
      </div>

      {/* Toggle "Ver más estadísticas" */}
      <button
        onClick={() => setShowMore((v) => !v)}
        className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-900 transition-colors uppercase tracking-wider flex items-center gap-1"
      >
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
          className={`w-3 h-3 transition-transform ${showMore ? "rotate-180" : ""}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
        {showMore ? "Ocultar estadísticas avanzadas" : "Ver más estadísticas"}
      </button>

      {showMore && (
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
          <DistributionChart
            title="Distribución motivación (1-5)"
            distribution={stats.motivationDistribution}
            total={stats.totalRegistrations}
            animate={animate}
            toneFn={motivationTone}
          />
          <DistributionChart
            title="Distribución estrés (1-5)"
            distribution={stats.stressDistribution}
            total={stats.totalRegistrations}
            animate={animate}
            toneFn={stressTone}
          />

          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:col-span-2">
            <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-3 font-semibold">
              Top 10 empresas
            </div>
            {stats.distributionByCompany?.length > 0 ? (
              <ul className="space-y-2">
                {stats.distributionByCompany.map((c) => (
                  <li key={c.companyName}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-neutral-700 truncate pr-2" title={c.companyName}>
                        {c.companyName}
                      </span>
                      <span className="text-neutral-500 shrink-0 tabular-nums">
                        {c.count} · {c.percentage}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-[width] duration-500 ease-out"
                        style={{
                          width: animate ? `${c.percentage}%` : "0%",
                          background: "var(--color-primary)",
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-neutral-400">Sin datos.</p>
            )}
          </div>

          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:col-span-2">
            <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-3 font-semibold">
              Registros por mes (últimos 12 meses)
            </div>
            <MonthlyChart points={stats.registrationsByMonth} animate={animate} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function StatCard({ label, children }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-4">
      <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">
        {label}
      </div>
      {children}
    </div>
  );
}

function ScaleBar({ pct, tone }) {
  const color = tone === "warning" ? "#F59E0B" : "var(--color-primary)";
  return (
    <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

function motivationTone(v) {
  if (v <= 2) return "bg-red-200";
  if (v === 3) return "bg-yellow-200";
  return "bg-green-200";
}
function stressTone(v) {
  // En estrés, valores ALTOS son malos → invertimos paleta.
  if (v <= 2) return "bg-green-200";
  if (v === 3) return "bg-yellow-200";
  return "bg-red-200";
}

function DistributionChart({ title, distribution, total, animate, toneFn }) {
  const values = [1, 2, 3, 4, 5];
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-4">
      <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-3 font-semibold">
        {title}
      </div>
      <div className="space-y-2">
        {values.map((v) => {
          const count = distribution[v] ?? 0;
          const pct = total ? Math.round((count / total) * 100) : 0;
          return (
            <div key={v} className="flex items-center gap-2 text-xs">
              <span className="text-neutral-500 w-3 shrink-0 tabular-nums">{v}</span>
              <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ease-out ${toneFn(v)}`}
                  style={{ width: animate ? `${pct}%` : "0%" }}
                />
              </div>
              <span className="text-neutral-500 w-12 text-right shrink-0 tabular-nums">
                {count} · {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthlyChart({ points, animate }) {
  if (!points || points.length === 0) {
    return <p className="text-xs text-neutral-400">Sin datos de los últimos 12 meses.</p>;
  }
  const max = Math.max(...points.map((p) => p.count), 1);
  return (
    <div className="flex items-end justify-between gap-1 h-24" role="img" aria-label="Registros por mes">
      {points.map((p) => {
        const pct = (p.count / max) * 100;
        const [, mm] = p.month.split("-");
        const label = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"][parseInt(mm, 10)] ?? mm;
        return (
          <div key={p.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div className="w-full flex items-end h-20" title={`${p.month}: ${p.count}`}>
              <div
                className="w-full rounded-t transition-[height] duration-500 ease-out"
                style={{
                  height: animate ? `${pct}%` : "0%",
                  background: "var(--color-primary)",
                  minHeight: p.count > 0 ? "2px" : 0,
                }}
              />
            </div>
            <div className="text-[9px] text-neutral-400 uppercase tabular-nums truncate w-full text-center">
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
