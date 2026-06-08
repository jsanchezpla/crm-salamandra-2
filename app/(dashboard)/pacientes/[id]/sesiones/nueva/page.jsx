"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import PreviewBanner from "../../../../clinica/_components/PreviewBanner.jsx";
import { findPatient, findTherapist } from "../../../_components/dummyData.js";

// Estados de la pantalla — gestionados con React state. Sin lógica real.
const STATE = {
  IDLE: "idle",
  UPLOADED: "uploaded",
  PROCESSING: "processing",
  STRUCTURED: "structured",
};

// Transcripción literal de ejemplo (la del documento de Aumenta)
const TRANSCRIPTION = `Hoy hemos trabajado atención con un memory. También hemos trabajado toma de decisiones, velocidad de procesamiento y trabajo de flexibilidad cognitiva. Hemos hecho varios ejercicios con escenarios escolares para que tuviera que decidir entre dos opciones. Le he visto bastante concentrado, mejor que la semana pasada, y ha completado el memory con menos distracciones. La madre me ha comentado al recoger que ha mejorado bastante con los deberes en casa. Para casa le he puesto que haga ejercicios de atención cinco minutos antes del estudio.`;

const STRUCTURED = {
  objectives: ["Atención sostenida", "Toma de decisiones", "Velocidad de procesamiento", "Flexibilidad cognitiva"],
  activities:
    "Memory con piezas progresivas. Ejercicios de toma de decisiones con escenarios escolares. Laberintos y orientación en mapas para trabajar flexibilidad cognitiva.",
  performance:
    "Diego ha mostrado mayor concentración respecto a sesiones anteriores. Ha completado las actividades de memory con menor número de distracciones.",
  observations: {
    familyComments: "La madre refiere mejora notable en la realización de los deberes.",
    nextSessionNotes: "Continuar con ejercicios de flexibilidad cognitiva. Introducir actividades de planificación.",
    homeworkTasks: "Realizar ejercicios de atención durante 5 minutos antes del estudio.",
    incidents: "Ninguna.",
  },
};

const DUMMY_FILE = { name: "sesion-diego-5jun.m4a", duration: 47, size: "1.2 MB" };

const PROCESSING_STEPS = [
  "Subiendo audio…",
  "Transcribiendo con Whisper…",
  "Identificando objetivos trabajados…",
  "Estructurando observaciones…",
  "Listo.",
];

export default function NuevaSesionPage() {
  const params = useParams();
  const router = useRouter();
  const patient = findPatient(params.id);
  const therapist = patient ? findTherapist(patient.mainTherapistId) : null;

  const [state, setState] = useState(STATE.IDLE);
  const [processingStep, setProcessingStep] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Avance fake del procesamiento (~3s total)
  useEffect(() => {
    if (state !== STATE.PROCESSING) return;
    setProcessingStep(0);
    const stepInterval = setInterval(() => {
      setProcessingStep((s) => {
        if (s >= PROCESSING_STEPS.length - 1) {
          clearInterval(stepInterval);
          setTimeout(() => setState(STATE.STRUCTURED), 400);
          return s;
        }
        return s + 1;
      });
    }, 650);
    return () => clearInterval(stepInterval);
  }, [state]);

  if (!patient) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <PreviewBanner />
        <div className="bg-white border border-neutral-100 rounded-xl p-10 text-center mt-5">
          <p className="text-sm text-neutral-600">Paciente no encontrado.</p>
          <Link href="/pacientes" className="text-xs text-[var(--color-primary,#1B3A2D)] hover:underline mt-2 inline-block">
            ← Volver al listado
          </Link>
        </div>
      </div>
    );
  }

  function handlePickFile() {
    setState(STATE.UPLOADED);
  }
  function handleProcess() {
    setState(STATE.PROCESSING);
  }
  function reset() {
    setState(STATE.IDLE);
    setProcessingStep(0);
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <nav className="flex items-center gap-1.5 text-xs text-neutral-500">
        <Link href="/pacientes" className="hover:text-[var(--color-primary,#1B3A2D)]">
          Pacientes
        </Link>
        <span className="text-neutral-300">/</span>
        <Link href={`/pacientes/${patient.id}`} className="hover:text-[var(--color-primary,#1B3A2D)]">
          {patient.firstName} {patient.lastName}
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="text-neutral-700">Nueva sesión</span>
      </nav>

      <PreviewBanner />

      {/* ── Estado IDLE ──────────────────────────────────────────────────── */}
      {state === STATE.IDLE && (
        <div className="bg-white border border-neutral-100 rounded-xl p-6 lg:p-10">
          <div className="text-center mb-6">
            <div className="eyebrow mb-2">Nueva sesión</div>
            <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] tracking-tight">
              {patient.firstName} {patient.lastName}
            </h1>
            <p className="text-xs text-neutral-500 mt-1">
              {therapist.name} · {new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}
            </p>
          </div>

          {/* Zona de subida */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); handlePickFile(); }}
            onClick={handlePickFile}
            className={`max-w-2xl mx-auto rounded-xl border-2 border-dashed cursor-pointer transition-all p-10 text-center ${
              isDragging
                ? "border-[var(--color-primary,#1B3A2D)] bg-[color-mix(in_srgb,var(--color-primary,#1B3A2D)_5%,white)]"
                : "border-neutral-200 hover:border-neutral-300 bg-neutral-50/30"
            }`}
          >
            <div
              className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center text-white mb-4"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 7.5m0 0L7.5 12m4.5-4.5v13.5" />
              </svg>
            </div>
            <p className="font-display text-lg text-[var(--ink-900)]">Subir audio de la sesión</p>
            <p className="text-xs text-neutral-500 mt-1 max-w-md mx-auto leading-relaxed">
              Sube el audio grabado con tu móvil. La IA lo transcribirá y estructurará en apartados (objetivos, actividades, observaciones).
            </p>
            <button
              type="button"
              className="mt-4 inline-flex items-center gap-2 text-xs font-medium px-4 py-2 rounded-lg border border-neutral-200 bg-white hover:border-neutral-400 text-neutral-700"
            >
              Seleccionar archivo
            </button>
            <p className="text-[10px] text-neutral-400 mt-4">
              Formatos admitidos: m4a, mp3, wav, ogg · Máx. 100 MB
            </p>
          </div>

          <div className="text-center mt-6">
            <button className="text-xs text-neutral-500 hover:underline">
              O escribir manualmente
            </button>
          </div>
        </div>
      )}

      {/* ── Estado UPLOADED ──────────────────────────────────────────────── */}
      {state === STATE.UPLOADED && (
        <div className="bg-white border border-neutral-100 rounded-xl p-6 lg:p-10">
          <div className="text-center mb-6">
            <div className="eyebrow mb-2">Audio subido</div>
            <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] tracking-tight">
              {patient.firstName} {patient.lastName}
            </h1>
            <p className="text-xs text-neutral-500 mt-1">
              {therapist.name} · {new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}
            </p>
          </div>

          <div className="max-w-2xl mx-auto bg-neutral-50 border border-neutral-100 rounded-xl p-4 flex items-center gap-3">
            <div
              className="shrink-0 w-12 h-12 rounded-lg flex items-center justify-center text-white"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[var(--ink-900)] truncate">{DUMMY_FILE.name}</div>
              <div className="text-[10px] text-neutral-400 tabular">
                0:{String(DUMMY_FILE.duration).padStart(2, "0")} · {DUMMY_FILE.size}
              </div>
            </div>
            <button className="shrink-0 w-8 h-8 rounded-full bg-white border border-neutral-200 hover:border-neutral-400 flex items-center justify-center text-neutral-500">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 ml-0.5">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
            <button onClick={reset} className="shrink-0 text-neutral-400 hover:text-neutral-700">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="max-w-2xl mx-auto mt-6 flex flex-wrap gap-2 justify-end">
            <button onClick={reset} className="text-xs px-4 py-2 text-neutral-500 hover:underline">
              Cambiar archivo
            </button>
            <button
              onClick={handleProcess}
              className="text-xs font-medium px-5 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              Procesar con IA
            </button>
          </div>
        </div>
      )}

      {/* ── Estado PROCESSING ───────────────────────────────────────────── */}
      {state === STATE.PROCESSING && (
        <div className="bg-white border border-neutral-100 rounded-xl p-8 lg:p-12 text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center text-white mb-5" style={{ background: "var(--color-primary, #1B3A2D)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 animate-spin">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </div>
          <h2 className="font-display text-xl lg:text-2xl text-[var(--ink-900)]">Procesando audio con IA</h2>
          <p className="text-xs text-neutral-500 mt-1">{DUMMY_FILE.name}</p>

          <ul className="mt-8 max-w-md mx-auto space-y-2 text-left">
            {PROCESSING_STEPS.map((step, i) => {
              const done = i < processingStep;
              const current = i === processingStep;
              return (
                <li key={i} className="flex items-center gap-2.5 text-xs">
                  <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${
                    done ? "bg-emerald-500 text-white" : current ? "bg-neutral-100" : "bg-neutral-50"
                  }`}>
                    {done && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-2.5 h-2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {current && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary,#1B3A2D)] animate-pulse" />}
                  </span>
                  <span className={done ? "text-neutral-500 line-through" : current ? "text-[var(--ink-900)] font-medium" : "text-neutral-400"}>
                    {step}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Estado STRUCTURED ───────────────────────────────────────────── */}
      {state === STATE.STRUCTURED && (
        <>
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 flex items-start gap-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <div className="text-xs font-semibold text-emerald-900">Sesión transcrita y estructurada por IA</div>
              <p className="text-[11px] text-emerald-700 mt-0.5">
                Revisa cada apartado antes de guardar. Cada bloque es editable.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-3">
            {/* Audio subido + transcripción literal */}
            <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
              <div className="eyebrow mb-3">Audio subido</div>
              <div className="flex items-center gap-2.5 bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2 mb-4">
                <button
                  className="shrink-0 w-7 h-7 rounded-full text-white flex items-center justify-center"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 ml-0.5">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
                <div className="flex-1 flex items-center gap-0.5 min-w-0">
                  {Array.from({ length: 28 }).map((_, i) => {
                    const h = 4 + Math.abs(Math.sin(i * 0.9)) * 16;
                    return <span key={i} className="block w-0.5 bg-neutral-300" style={{ height: h }} />;
                  })}
                </div>
                <span className="shrink-0 text-[10px] tabular text-neutral-500">
                  0:{String(DUMMY_FILE.duration).padStart(2, "0")}
                </span>
              </div>
              <p className="text-[10px] text-neutral-400 mb-3">{DUMMY_FILE.name} · {DUMMY_FILE.size}</p>

              <div className="eyebrow mb-2">Transcripción literal</div>
              <p className="text-xs text-neutral-600 leading-relaxed italic">
                &laquo;{TRANSCRIPTION}&raquo;
              </p>
            </div>

            {/* Registro estructurado */}
            <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 space-y-5">
              <div className="flex items-center justify-between">
                <div className="eyebrow">Registro clínico estructurado</div>
                <button className="text-[10px] text-neutral-400 hover:text-neutral-700">Modo edición</button>
              </div>

              <Block label="Objetivos trabajados">
                <div className="flex flex-wrap gap-1.5">
                  {STRUCTURED.objectives.map((o) => (
                    <span key={o} className="text-[11px] bg-neutral-100 text-neutral-700 px-2 py-0.5 rounded-full">
                      {o}
                    </span>
                  ))}
                </div>
              </Block>

              <Block label="Actividades realizadas">
                <p className="text-xs text-neutral-700 leading-relaxed">{STRUCTURED.activities}</p>
              </Block>

              <Block label="Desempeño del paciente">
                <p className="text-xs text-neutral-700 leading-relaxed">{STRUCTURED.performance}</p>
              </Block>

              <Block label="Observaciones">
                <div className="space-y-2.5">
                  <SubField label="Comentarios familiares" value={STRUCTURED.observations.familyComments} />
                  <SubField label="Próximas sesiones" value={STRUCTURED.observations.nextSessionNotes} />
                  <SubField label="Tareas para casa" value={STRUCTURED.observations.homeworkTasks} />
                  <SubField label="Incidencias" value={STRUCTURED.observations.incidents} />
                </div>
              </Block>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={() => router.push(`/pacientes/${patient.id}`)} className="text-xs px-4 py-2 text-neutral-500 hover:underline">
              Cancelar
            </button>
            <button onClick={reset} className="text-xs px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 text-neutral-700 inline-flex items-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              Regenerar con IA
            </button>
            <button
              className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Guardar sesión
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Block({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function SubField({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-0.5">{label}</div>
      <div className="text-xs text-neutral-700 leading-relaxed">{value}</div>
    </div>
  );
}
