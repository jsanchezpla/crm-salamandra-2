"use client";

/**
 * CuestionariosDashboard — panel de estadísticas para /formacion/cuestionarios.
 *
 * Render condicional según `filters.quizId`:
 *
 *   - Modo A (sin quizId): visión global del tenant.
 *       · 4 cards: Total intentos / % Aprobados / Nota media / Top fallo
 *       · 2 paneles: Top 5 cuestionarios por nº intentos / Top 5 con menor
 *         % acierto (panel "alerta" en tono rojo)
 *
 *   - Modo B (con quizId): focus en un cuestionario.
 *       · 3 cards: Intentos / % Aprobados / Nota media
 *       · Lista vertical: % acierto por pregunta (barras horizontales)
 *
 * Empty state global: si `total === 0` (filtros vacían el dataset) muestra
 * placeholder 📋 + texto y NO renderiza cards.
 *
 * Animación 500ms al cambiar dataset (igual que Bloque 2 — Likert dashboard).
 *
 * Endpoint: GET /api/training/quiz-attempts/stats con `search`, `companyName`,
 * `courseId`, `quizId`. Refetch cuando cualquier filtro cambia.
 *
 * Props:
 *   - filters  { search, companyName, courseId, quizId }
 */

import { useState, useEffect } from "react";

export function CuestionariosDashboard({ filters }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [animate, setAnimate] = useState(false);

  const { search, companyName, courseId, quizId } = filters;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (companyName) params.set("companyName", companyName);
    if (courseId) params.set("courseId", String(courseId));
    if (quizId) params.set("quizId", String(quizId));

    fetch(`/api/training/quiz-attempts/stats?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (!active) return;
        if (j?.ok) setStats(j.data);
        else {
          setStats(null);
          setError(j?.error || "Error al cargar estadísticas");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [search, companyName, courseId, quizId]);

  useEffect(() => {
    if (!stats) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnimate(false);
    const t = setTimeout(() => setAnimate(true), 60);
    return () => clearTimeout(t);
  }, [stats]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white border border-neutral-100 rounded-xl p-4 animate-pulse">
            <div className="h-3 w-20 bg-neutral-100 rounded mb-3" />
            <div className="h-6 w-12 bg-neutral-200 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-5 px-4 py-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">
        {error}
      </div>
    );
  }

  if (!stats) return null;

  if (stats.total === 0) {
    return (
      <div className="bg-white border border-neutral-100 rounded-xl p-8 text-center mb-5">
        <div className="text-3xl mb-2">📋</div>
        <p className="text-sm text-neutral-600 font-medium">
          Sin intentos en el filtro actual.
        </p>
        <p className="text-xs text-neutral-400 mt-1">
          Ajusta los filtros o sincroniza desde TutorLMS para ver datos.
        </p>
      </div>
    );
  }

  const isModeB = Array.isArray(stats.questionStats);
  return isModeB
    ? <ModeBDashboard stats={stats} animate={animate} />
    : <ModeADashboard stats={stats} animate={animate} />;
}

// ── Modo A — globales ────────────────────────────────────────────────────────

function ModeADashboard({ stats, animate }) {
  const topFail = stats.topQuizzesByFailRate?.[0];
  return (
    <div className="mb-5 space-y-4">
      {/* 4 cards top */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total intentos">
          <div className="text-2xl md:text-3xl font-bold text-neutral-900 tabular-nums">
            {stats.total}
          </div>
        </StatCard>
        <StatCard label="% Aprobados">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl md:text-3xl font-bold text-neutral-900 tabular-nums">
              {stats.passRate.toFixed(1)}
            </span>
            <span className="text-xs text-neutral-400">%</span>
          </div>
        </StatCard>
        <StatCard label="Nota media">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl md:text-3xl font-bold text-neutral-900 tabular-nums">
              {(stats.avgScorePct / 10).toFixed(1)}
            </span>
            <span className="text-xs text-neutral-400">/ 10</span>
          </div>
        </StatCard>
        <StatCard label="Top fallo">
          {topFail ? (
            <>
              <div
                className="text-sm font-semibold text-neutral-900 truncate"
                title={topFail.quizTitle ?? `Quiz ${topFail.wpQuizId}`}
              >
                {topFail.quizTitle ?? `Quiz ${topFail.wpQuizId}`}
              </div>
              <div className="text-xs text-red-600 font-medium tabular-nums mt-0.5">
                {topFail.passRate.toFixed(1)}% aprobados
              </div>
            </>
          ) : (
            <span className="text-sm text-neutral-300">—</span>
          )}
        </StatCard>
      </div>

      {/* 2 paneles top 5 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TopQuizzesPanel
          title="Top 5 con más intentos"
          items={stats.topQuizzesByAttempts}
          getValue={(it) => it.count}
          getValueLabel={(it) => String(it.count)}
          maxValue={stats.topQuizzesByAttempts?.[0]?.count ?? 1}
          tone="primary"
          animate={animate}
          emptyText="Sin datos"
        />
        <TopQuizzesPanel
          title="Top 5 con menor acierto (alerta)"
          items={stats.topQuizzesByFailRate}
          getValue={(it) => it.passRate}
          getValueLabel={(it) => `${it.passRate.toFixed(1)}%`}
          maxValue={100}
          tone="alert"
          animate={animate}
          emptyText="Sin quizzes con ≥3 intentos"
          subtitle={(it) => `${it.count} intentos`}
        />
      </div>
    </div>
  );
}

// ── Modo B — por cuestionario ────────────────────────────────────────────────

function ModeBDashboard({ stats, animate }) {
  return (
    <div className="mb-5 space-y-4">
      {/* 3 cards top */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Intentos">
          <div className="text-2xl md:text-3xl font-bold text-neutral-900 tabular-nums">
            {stats.total}
          </div>
        </StatCard>
        <StatCard label="% Aprobados">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl md:text-3xl font-bold text-neutral-900 tabular-nums">
              {stats.passRate.toFixed(1)}
            </span>
            <span className="text-xs text-neutral-400">%</span>
          </div>
        </StatCard>
        <StatCard label="Nota media">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl md:text-3xl font-bold text-neutral-900 tabular-nums">
              {(stats.avgScorePct / 10).toFixed(1)}
            </span>
            <span className="text-xs text-neutral-400">/ 10</span>
          </div>
        </StatCard>
      </div>

      {/* Lista % acierto por pregunta */}
      <div className="bg-white border border-neutral-100 rounded-xl p-5">
        <h3
          className="text-sm font-bold text-neutral-900 mb-4"
          style={{ fontFamily: "'Syne', sans-serif" }}
        >
          % acierto por pregunta
        </h3>
        {stats.questionStats.length === 0 ? (
          <p className="text-xs text-neutral-400">
            Los intentos de este cuestionario no incluyen detalle pregunta a pregunta.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {stats.questionStats.map((q, idx) => (
              <li key={`${q.questionId}|${q.no}|${idx}`} className="text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-neutral-400 tabular-nums shrink-0 w-6">
                    {q.no ?? "?"}.
                  </span>
                  <span className="text-neutral-700 truncate flex-1" title={q.question || ""}>
                    {q.question || <span className="text-neutral-300 italic">Sin texto</span>}
                  </span>
                </div>
                <div className="flex items-center gap-2 pl-8">
                  <div className="flex-1 h-2 bg-neutral-100 rounded-full overflow-hidden min-w-0">
                    <div
                      className="h-full rounded-full transition-[width] duration-500 ease-out"
                      style={{
                        width: animate ? `${q.correctRate}%` : "0%",
                        background: "var(--color-primary)",
                      }}
                    />
                  </div>
                  <span className="text-neutral-500 tabular-nums shrink-0 w-12 text-right">
                    {q.correctRate.toFixed(0)}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-neutral-500 pt-3 mt-3 border-t border-neutral-100">
          Total respuestas: <span className="font-semibold text-neutral-700 tabular-nums">{stats.total}</span>
        </p>
      </div>
    </div>
  );
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

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

function TopQuizzesPanel({
  title,
  items,
  getValue,
  getValueLabel,
  maxValue,
  tone,
  animate,
  emptyText,
  subtitle,
}) {
  const color = tone === "alert" ? "#DC2626" : "var(--color-primary)";
  const list = Array.isArray(items) ? items : [];
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-4">
      <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-3 font-semibold">
        {title}
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-neutral-400">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((it) => {
            const value = getValue(it);
            const widthPct = maxValue > 0 ? Math.min(100, (value / maxValue) * 100) : 0;
            const label = it.quizTitle ?? `Quiz ${it.wpQuizId}`;
            return (
              <li key={it.wpQuizId}>
                <div className="flex items-center justify-between text-xs mb-1 gap-2">
                  <span className="text-neutral-700 truncate pr-2" title={label}>
                    {label}
                  </span>
                  <span className="text-neutral-500 shrink-0 tabular-nums whitespace-nowrap">
                    {getValueLabel(it)}
                    {subtitle ? (
                      <span className="text-neutral-300"> · {subtitle(it)}</span>
                    ) : null}
                  </span>
                </div>
                <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-500 ease-out"
                    style={{
                      width: animate ? `${widthPct}%` : "0%",
                      background: color,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
