"use client";

/**
 * CourseRegistrationDetail — drawer lateral derecho con el detalle de un
 * registro previo. Tabs internas: Centro / Docente / Diagnóstico.
 *
 * Renderiza slugs con diccionarios de lib/training/registrationLabels.js.
 * Las preguntas 1-5 del diagnóstico se muestran como barras horizontales
 * 0-100% animadas.
 *
 * Respeta regla #13 — drawer arranca debajo de la barra superior móvil
 * (`top-14 lg:top-0 ... bottom-0`). En mobile, full-width.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CENTER_TYPE,
  POSITIONS,
  COURSES_TEACHING,
  SUBJECTS,
  TOPICS_OF_INTEREST,
  CENTER_FIELD_LABELS,
  TEACHER_FIELD_LABELS,
  DIAGNOSIS_QUESTION_LABELS,
  labelOr,
} from "../../lib/training/registrationLabels.js";

const SCALE_QUESTIONS = ["motivationCurrent", "motivationVsStart", "centerEnvironment", "stressLevel", "hasResources", "socialRecognition"];
const TEXTAREA_QUESTIONS = ["mainDifficulties", "courseGoals"];
const CATEGORICAL_QUESTIONS = ["workloadFrequency", "weeklyExtraHours"];

const WORKLOAD_LABELS = {
  nunca: "Nunca",
  raramente: "Raramente",
  algunas_veces: "Algunas veces",
  frecuente: "Frecuentemente",
  constante: "Constantemente",
};
const HOURS_LABELS = {
  "0": "0 horas",
  "1_4": "1-4 horas",
  "5_10": "5-10 horas",
  "11_20": "11-20 horas",
  "20+": "Más de 20 horas",
};

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CourseRegistrationDetail({ registrationId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("center");
  const [animate, setAnimate] = useState(false);

  // Cerrar con Escape
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!registrationId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setAnimate(false);
    fetch(`/api/training/course-registrations/${registrationId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (!j?.ok) throw new Error(j?.error || "Error desconocido");
        setData(j.data);
        // Trigger animación de barras tras render
        setTimeout(() => setAnimate(true), 60);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [registrationId]);

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        className="fixed inset-x-0 top-14 lg:top-0 bottom-0 z-40 bg-black/40"
        aria-hidden="true"
      />
      {/* Drawer */}
      <aside
        role="dialog"
        aria-label="Detalle del registro"
        className="fixed right-0 top-14 lg:top-0 bottom-0 z-50 w-full sm:max-w-lg bg-white shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-1">
              Registro previo
            </p>
            {loading ? (
              <div className="h-5 w-48 bg-neutral-100 rounded animate-pulse" />
            ) : data ? (
              <>
                <h2 className="text-base font-bold text-neutral-900 truncate" style={{ fontFamily: "'Syne', sans-serif" }}>
                  {data.trainingUser?.name || data.email}
                </h2>
                <p className="text-[11px] text-neutral-500 truncate">
                  {data.email}
                  {data.company && (
                    <>
                      {" · "}
                      <span className="inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white align-middle" style={{ background: "var(--color-primary)" }}>
                        {data.company.name}
                      </span>
                    </>
                  )}
                </p>
              </>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-neutral-400 hover:text-neutral-700 transition-colors"
            aria-label="Cerrar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        {data && (
          <div className="px-5 pt-3 border-b border-neutral-100">
            <div className="flex gap-1">
              <TabButton active={tab === "center"} onClick={() => setTab("center")}>Centro</TabButton>
              <TabButton active={tab === "teacher"} onClick={() => setTab("teacher")}>Docente</TabButton>
              <TabButton active={tab === "diagnosis"} onClick={() => setTab("diagnosis")}>Diagnóstico</TabButton>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="space-y-3">
              <div className="h-4 bg-neutral-100 rounded animate-pulse w-1/3" />
              <div className="h-3 bg-neutral-100 rounded animate-pulse w-2/3" />
              <div className="h-3 bg-neutral-100 rounded animate-pulse w-1/2" />
            </div>
          )}

          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700">
              {error}
            </div>
          )}

          {!loading && !error && data && (
            <>
              {tab === "center" && <CenterPanel data={data} />}
              {tab === "teacher" && <TeacherPanel data={data} />}
              {tab === "diagnosis" && <DiagnosisPanel data={data} animate={animate} />}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-neutral-100 flex items-center justify-between gap-2">
          <div className="text-[11px] text-neutral-400">
            {data && (
              <>
                Recibido {fmtDate(data.submittedAt)}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {data?.company?.id && (
              <Link
                href={`/formacion/empresas/${data.company.id}`}
                className="text-[11px] font-medium px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition-colors"
              >
                Ver empresa →
              </Link>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 rounded-md transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ── Sub-componentes de panel ────────────────────────────────────────────────

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-semibold uppercase tracking-wider px-3 py-2 border-b-2 transition-colors ${
        active
          ? "border-[var(--color-primary)] text-neutral-900"
          : "border-transparent text-neutral-400 hover:text-neutral-700"
      }`}
    >
      {children}
    </button>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2 border-b border-neutral-50 last:border-0">
      <dt className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">
        {label}
      </dt>
      <dd className={`col-span-2 text-sm text-neutral-700 ${mono ? "font-mono" : ""}`}>
        {value || <span className="text-neutral-300">—</span>}
      </dd>
    </div>
  );
}

function Tags({ items, dict }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <span className="text-neutral-300">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((slug) => (
        <span
          key={slug}
          className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-700"
        >
          {labelOr(dict, slug)}
        </span>
      ))}
    </div>
  );
}

function ScaleBar({ value, animate, tone = "positive" }) {
  const pct = ((Number(value) || 0) / 5) * 100;
  const color = tone === "inverse"
    ? value <= 2 ? "#10B981" : value === 3 ? "#F59E0B" : "#EF4444"
    : value <= 2 ? "#EF4444" : value === 3 ? "#F59E0B" : "#10B981";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-neutral-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: animate ? `${pct}%` : "0%", background: color }}
        />
      </div>
      <span className="text-xs font-semibold text-neutral-700 tabular-nums shrink-0 w-8 text-right">
        {value ?? "—"}/5
      </span>
    </div>
  );
}

function CenterPanel({ data }) {
  const c = data.centerData ?? {};
  const addr = c.address ?? {};
  return (
    <dl>
      <Row label={CENTER_FIELD_LABELS.type} value={labelOr(CENTER_TYPE, c.type)} />
      <Row label={CENTER_FIELD_LABELS.name} value={c.name || data.centerName} />
      {c.otherName && <Row label={CENTER_FIELD_LABELS.otherName} value={c.otherName} />}
      <Row label={CENTER_FIELD_LABELS.nif} value={data.centerNif || c.nif} mono />
      <Row label={CENTER_FIELD_LABELS["address.street"]} value={addr.street} />
      {addr.apartment && <Row label={CENTER_FIELD_LABELS["address.apartment"]} value={addr.apartment} />}
      <Row label={CENTER_FIELD_LABELS["address.city"]} value={addr.city} />
      <Row label={CENTER_FIELD_LABELS["address.state"]} value={addr.state} />
      <Row label={CENTER_FIELD_LABELS["address.postalCode"]} value={addr.postalCode} mono />
      <Row label={CENTER_FIELD_LABELS["address.country"]} value={addr.country} mono />
    </dl>
  );
}

function TeacherPanel({ data }) {
  const t = data.teacherData ?? {};
  return (
    <dl className="space-y-1">
      <Row
        label={TEACHER_FIELD_LABELS.yearsOfExperience}
        value={t.yearsOfExperience != null ? `${t.yearsOfExperience} años` : null}
        mono
      />
      <div className="py-2 border-b border-neutral-50">
        <dt className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-1.5">
          {TEACHER_FIELD_LABELS.positions}
        </dt>
        <Tags items={t.positions} dict={POSITIONS} />
      </div>
      <div className="py-2 border-b border-neutral-50">
        <dt className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-1.5">
          {TEACHER_FIELD_LABELS.coursesTeaching}
        </dt>
        <Tags items={t.coursesTeaching} dict={COURSES_TEACHING} />
      </div>
      <div className="py-2 border-b border-neutral-50">
        <dt className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-1.5">
          {TEACHER_FIELD_LABELS.subjects}
        </dt>
        <Tags items={t.subjects} dict={SUBJECTS} />
      </div>
      <div className="py-2">
        <dt className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-1.5">
          {TEACHER_FIELD_LABELS.topicsOfInterest}
        </dt>
        <Tags items={t.topicsOfInterest} dict={TOPICS_OF_INTEREST} />
      </div>
    </dl>
  );
}

function DiagnosisPanel({ data, animate }) {
  const d = data.diagnosisData ?? {};
  return (
    <div className="space-y-4">
      {SCALE_QUESTIONS.map((q) => {
        // stressLevel: alto = malo → tono invertido. El resto: alto = bueno.
        const tone = q === "stressLevel" ? "inverse" : "positive";
        return (
          <div key={q}>
            <p className="text-[11px] text-neutral-500 mb-1.5 leading-snug">
              {DIAGNOSIS_QUESTION_LABELS[q]}
            </p>
            <ScaleBar value={d[q]} animate={animate} tone={tone} />
          </div>
        );
      })}

      {CATEGORICAL_QUESTIONS.map((q) => {
        const dict = q === "workloadFrequency" ? WORKLOAD_LABELS : HOURS_LABELS;
        const val = d[q];
        return (
          <div key={q}>
            <p className="text-[11px] text-neutral-500 mb-1.5 leading-snug">
              {DIAGNOSIS_QUESTION_LABELS[q]}
            </p>
            {val ? (
              <span className="inline-block px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-100 text-neutral-700">
                {labelOr(dict, val)}
              </span>
            ) : (
              <span className="text-neutral-300 text-xs">—</span>
            )}
          </div>
        );
      })}

      {TEXTAREA_QUESTIONS.map((q) => (
        <div key={q}>
          <p className="text-[11px] text-neutral-500 mb-1.5 leading-snug">
            {DIAGNOSIS_QUESTION_LABELS[q]}
          </p>
          {d[q] ? (
            <blockquote className="text-sm text-neutral-700 bg-neutral-50 border-l-2 border-neutral-300 px-3 py-2 rounded-r-md whitespace-pre-wrap">
              {d[q]}
            </blockquote>
          ) : (
            <span className="text-neutral-300 text-xs">—</span>
          )}
        </div>
      ))}

      {/* Cualquier otra clave que el form mande y no esté en los listados */}
      {Object.keys(d)
        .filter((k) => !SCALE_QUESTIONS.includes(k) && !CATEGORICAL_QUESTIONS.includes(k) && !TEXTAREA_QUESTIONS.includes(k))
        .map((k) => (
          <div key={k}>
            <p className="text-[11px] text-neutral-500 mb-1.5 leading-snug">
              {DIAGNOSIS_QUESTION_LABELS[k] || k}
            </p>
            <span className="text-sm text-neutral-700 break-words">
              {typeof d[k] === "object" ? JSON.stringify(d[k]) : String(d[k])}
            </span>
          </div>
        ))}
    </div>
  );
}
