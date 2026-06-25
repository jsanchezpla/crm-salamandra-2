"use client";

/**
 * CourseRegistrationStats — panel formato Retorika para el diagnóstico
 * inicial de un curso. Grid de bloques (1 col mobile, 2 cols desktop)
 * con un bloque por escala:
 *
 *   - 6 escalas Likert (motivationCurrent, motivationVsStart,
 *     centerEnvironment, stressLevel, hasResources, socialRecognition):
 *       · gráfico de barras verticales 1-5 con count encima
 *       · estrellas (5 SVG) coloreadas proporcionalmente a la media
 *       · media X.XX / 5 en grande
 *       · total de encuestados al pie
 *     motivationVsStart añade breakdown 3-categorías (menos / igual / más).
 *
 *   - 2 escalas categóricas (workloadFrequency, weeklyExtraHours):
 *       · barras horizontales por slug, ordenadas según ORDER del dict
 *       · etiqueta humana vía labelOr (con fallback al slug crudo)
 *       · count + porcentaje a la derecha
 *
 * Sin librerías de gráficos. Todo CSS + SVG inline (stars). Animación de
 * entrada en barras (transition-[width/height] 500ms).
 *
 * Empty states:
 *   - Global (totalRegistrations === 0): placeholder amistoso (📋).
 *   - Por escala (scale.total === 0): "Sin datos en el filtro actual".
 *
 * Props:
 *   - stats   objeto devuelto por GET /api/training/course-registrations/stats
 *   - loading bool
 */

import { useState, useEffect } from "react";
import {
  DIAGNOSIS_FULL_QUESTIONS,
  WORKLOAD_FREQUENCY,
  WORKLOAD_FREQUENCY_ORDER,
  WEEKLY_EXTRA_HOURS,
  WEEKLY_EXTRA_HOURS_ORDER,
  labelOr,
} from "../../lib/training/registrationLabels.js";

const LIKERT_ORDER = [
  "motivationCurrent",
  "motivationVsStart",
  "centerEnvironment",
  "stressLevel",
  "hasResources",
  "socialRecognition",
];

const CATEGORICAL_CONFIG = {
  workloadFrequency: { order: WORKLOAD_FREQUENCY_ORDER, dict: WORKLOAD_FREQUENCY },
  weeklyExtraHours: { order: WEEKLY_EXTRA_HOURS_ORDER, dict: WEEKLY_EXTRA_HOURS },
};

const CATEGORICAL_ORDER = ["workloadFrequency", "weeklyExtraHours"];

export function CourseRegistrationStats({ stats, loading }) {
  // Trigger de animación: las barras arrancan a 0 y transicionan al valor
  // real cuando cambia el dataset.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (!stats) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnimate(false);
    const t = setTimeout(() => setAnimate(true), 60);
    return () => clearTimeout(t);
  }, [stats]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white border border-neutral-100 rounded-xl p-5 animate-pulse">
            <div className="h-4 w-3/4 bg-neutral-100 rounded mb-4" />
            <div className="h-28 bg-neutral-100 rounded mb-4" />
            <div className="h-6 w-1/2 bg-neutral-100 rounded" />
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

  const { scales } = stats;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
      {LIKERT_ORDER.map((k) => (
        <LikertBlock
          key={k}
          scaleKey={k}
          scale={scales?.[k]}
          question={DIAGNOSIS_FULL_QUESTIONS[k]}
          animate={animate}
        />
      ))}
      {CATEGORICAL_ORDER.map((k) => (
        <CategoricalBlock
          key={k}
          scale={scales?.[k]}
          question={DIAGNOSIS_FULL_QUESTIONS[k]}
          order={CATEGORICAL_CONFIG[k].order}
          dict={CATEGORICAL_CONFIG[k].dict}
          animate={animate}
        />
      ))}
    </div>
  );
}

// ── Bloques ────────────────────────────────────────────────────────────────

function LikertBlock({ scale, question, scaleKey, animate }) {
  if (!scale || scale.total === 0) {
    return (
      <div className="bg-white border border-neutral-100 rounded-xl p-5">
        <h3
          className="text-sm font-semibold text-neutral-900 mb-3 leading-snug"
          style={{ fontFamily: "'Syne', sans-serif" }}
        >
          {question}
        </h3>
        <p className="text-xs text-neutral-400">Sin datos en el filtro actual.</p>
      </div>
    );
  }

  const max = Math.max(...Object.values(scale.distribution), 1);

  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-5">
      <h3
        className="text-sm font-semibold text-neutral-900 mb-4 leading-snug"
        style={{ fontFamily: "'Syne', sans-serif" }}
      >
        {question}
      </h3>

      {/* Eje Y label */}
      <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">
        Nº profesores
      </div>

      {/* Gráfico barras verticales */}
      <div className="flex items-end justify-between gap-2 h-28 mb-1">
        {[1, 2, 3, 4, 5].map((v) => {
          const count = scale.distribution[v] ?? 0;
          const pct = scale.total ? (count / scale.total) * 100 : 0;
          const height = (count / max) * 100;
          return (
            <div key={v} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div className="text-[11px] font-semibold text-neutral-700 tabular-nums">
                {count}
              </div>
              <div className="w-full flex items-end h-20">
                <div
                  className="w-full rounded-t transition-[height] duration-500 ease-out"
                  style={{
                    height: animate ? `${height}%` : "0%",
                    background: "var(--color-primary)",
                    minHeight: count > 0 ? "2px" : 0,
                  }}
                  title={`${v}: ${count} (${pct.toFixed(2)}%)`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Eje X — números 1 a 5 alineados con cada barra */}
      <div className="flex items-center justify-between gap-2">
        {[1, 2, 3, 4, 5].map((v) => (
          <span
            key={v}
            className="flex-1 text-center text-[11px] text-neutral-500 tabular-nums"
          >
            {v}
          </span>
        ))}
      </div>
      {/* Label del eje, en su propia fila debajo de los números */}
      <div className="text-[10px] uppercase tracking-wider text-neutral-400 text-right mt-1 mb-4">
        Valoración
      </div>

      {/* Estrellas + media */}
      <div className="flex items-center gap-3 mb-1">
        <StarRating value={scale.average} />
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-neutral-900 tabular-nums">
            {scale.average.toFixed(2)}
          </span>
          <span className="text-sm text-neutral-400">/ 5</span>
        </div>
      </div>
      <p className="text-xs text-neutral-500">
        Número total de encuestados: <span className="font-semibold text-neutral-700 tabular-nums">{scale.total}</span>
      </p>

      {/* breakdown3cat — solo motivationVsStart */}
      {scaleKey === "motivationVsStart" && scale.breakdown3cat && (
        <div className="mt-4 pt-3 border-t border-neutral-100 space-y-1.5">
          <BreakdownRow icon="↓" label="Menos motivados" pct={scale.breakdown3cat.lessPct} />
          <BreakdownRow icon="→" label="Igual de motivados" pct={scale.breakdown3cat.equalPct} />
          <BreakdownRow icon="↑" label="Más motivados" pct={scale.breakdown3cat.morePct} />
        </div>
      )}
    </div>
  );
}

function CategoricalBlock({ scale, question, order, dict, animate }) {
  if (!scale || scale.total === 0) {
    return (
      <div className="bg-white border border-neutral-100 rounded-xl p-5">
        <h3
          className="text-sm font-semibold text-neutral-900 mb-3 leading-snug"
          style={{ fontFamily: "'Syne', sans-serif" }}
        >
          {question}
        </h3>
        <p className="text-xs text-neutral-400">Sin datos en el filtro actual.</p>
      </div>
    );
  }

  // Slugs en orden lógico + cualquier slug nuevo que el form envíe y no
  // esté en ORDER (lo apendemos al final con su slug crudo como label).
  const knownSlugs = new Set(order);
  const extraSlugs = Object.keys(scale.distribution).filter((s) => !knownSlugs.has(s));
  const slugs = [...order, ...extraSlugs];

  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-5">
      <h3
        className="text-sm font-semibold text-neutral-900 mb-4 leading-snug"
        style={{ fontFamily: "'Syne', sans-serif" }}
      >
        {question}
      </h3>
      <div className="space-y-2 mb-4">
        {slugs.map((slug) => {
          const count = scale.distribution[slug] ?? 0;
          if (count === 0) return null;
          const pct = scale.total ? (count / scale.total) * 100 : 0;
          const label = labelOr(dict, slug);
          return (
            <div key={slug} className="flex items-center gap-2 text-xs">
              <span
                className="text-neutral-700 shrink-0 truncate w-28 sm:w-32"
                title={label}
              >
                {label}
              </span>
              <div className="flex-1 h-2 bg-neutral-100 rounded-full overflow-hidden min-w-0">
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{
                    width: animate ? `${pct}%` : "0%",
                    background: "var(--color-primary)",
                  }}
                />
              </div>
              <span className="text-neutral-500 shrink-0 text-right tabular-nums whitespace-nowrap text-[11px]">
                {count} ({pct.toFixed(2)}%)
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-neutral-500 pt-2 border-t border-neutral-100">
        Número total de encuestados: <span className="font-semibold text-neutral-700 tabular-nums">{scale.total}</span>
      </p>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function BreakdownRow({ icon, label, pct }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="flex items-center gap-2 text-neutral-700">
        <span
          className="w-4 text-center font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          {icon}
        </span>
        {label}
      </span>
      <span className="text-neutral-500 tabular-nums">{pct.toFixed(2)}%</span>
    </div>
  );
}

function StarSvg({ className = "w-5 h-5 shrink-0" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2L14.6 8.6 22 9.3l-5.5 4.6L18.2 21 12 17.3 5.8 21l1.7-7.1L2 9.3l7.4-.7L12 2z" />
    </svg>
  );
}

function StarRating({ value }) {
  // Dos capas: fondo (estrellas grises) + overlay clipped por width:%
  // (estrellas color primary). Render continuo — 4.45 → 89% filled.
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  const ICON_CLASS = "w-5 h-5 shrink-0";
  return (
    <div className="relative inline-flex" aria-label={`${value.toFixed(2)} de 5 estrellas`}>
      <div className="flex gap-0.5 text-neutral-200">
        {[0, 1, 2, 3, 4].map((i) => <StarSvg key={i} className={ICON_CLASS} />)}
      </div>
      <div
        className="absolute top-0 left-0 flex gap-0.5 overflow-hidden"
        style={{ width: `${pct}%`, color: "var(--color-primary)" }}
      >
        {[0, 1, 2, 3, 4].map((i) => <StarSvg key={i} className={ICON_CLASS} />)}
      </div>
    </div>
  );
}
