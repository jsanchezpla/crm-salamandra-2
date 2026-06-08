"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import PreviewBanner from "../../clinica/_components/PreviewBanner.jsx";
import {
  findPatient,
  findTherapist,
  statusStyles,
  sessionStatusStyles,
  DIEGO_SESSIONS,
  DIEGO_REPORTS,
  DIEGO_COORDINATIONS,
  DIEGO_UPCOMING,
  DIEGO_DOCS,
} from "../_components/dummyData.js";

const TABS = [
  { key: "resumen", label: "Resumen" },
  { key: "sesiones", label: "Sesiones" },
  { key: "informes", label: "Informes" },
  { key: "coordinaciones", label: "Coordinaciones" },
];

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SessionDrawer({ session, patient, therapist, onClose }) {
  const ss = sessionStatusStyles(session.status);
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />
      <aside className="fixed right-0 top-14 lg:top-0 bottom-0 z-50 w-full sm:w-[640px] bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-neutral-100 px-5 lg:px-7 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <div className="eyebrow">Sesión</div>
            <h2 className="font-display text-xl text-[var(--ink-900)] mt-1 leading-tight">
              {formatDateTime(session.sessionDate)}
            </h2>
            <p className="text-[11px] text-neutral-500 mt-1">
              {patient.firstName} {patient.lastName} · {therapist.name} · {session.duration} min
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-neutral-400 hover:text-neutral-700 p-1 -m-1"
            aria-label="Cerrar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 lg:px-7 py-5 space-y-5">
          {/* Estado + Audio simulado */}
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 ${ss.bg} ${ss.text} text-[11px] font-medium px-2.5 py-1 rounded-full`}>
              <span className={`w-1.5 h-1.5 rounded-full ${ss.dot}`} />
              {session.statusLabel}
            </span>
            <div className="flex-1 flex items-center gap-2.5 bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2 min-w-0">
              <button className="shrink-0 w-7 h-7 rounded-full text-white flex items-center justify-center" style={{ background: "var(--color-primary, #1B3A2D)" }}>
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 ml-0.5">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
              <div className="flex-1 flex items-center gap-0.5 min-w-0">
                {Array.from({ length: 24 }).map((_, i) => {
                  const h = 4 + Math.abs(Math.sin(i * 1.3)) * 16;
                  return <span key={i} className="block w-0.5 bg-neutral-300" style={{ height: h }} />;
                })}
              </div>
              <span className="shrink-0 text-[10px] tabular text-neutral-500">0:{String(session.audioDurationSec).padStart(2, "0")}</span>
            </div>
          </div>

          {/* Banner IA */}
          {session.aiReviewedAt && (
            <div className="bg-sky-50 border border-sky-100 rounded-lg px-3 py-2.5 flex items-start gap-2.5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 text-sky-700 mt-0.5 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              <p className="text-[11px] text-sky-900 leading-relaxed flex-1">
                <span className="font-semibold">Transcrito y estructurado automáticamente por IA.</span> Revisado el {new Date(session.aiReviewedAt).toLocaleDateString("es-ES")}.
              </p>
            </div>
          )}

          <button
            className="w-full text-sm font-medium py-2.5 rounded-lg text-white hover:opacity-90 inline-flex items-center justify-center gap-2"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            Regenerar con IA
          </button>

          <Section title="Objetivos trabajados">
            <div className="flex flex-wrap gap-1.5">
              {session.objectives.map((o) => (
                <span key={o} className="text-[11px] bg-neutral-100 text-neutral-700 px-2 py-0.5 rounded-full">
                  {o}
                </span>
              ))}
            </div>
          </Section>

          <Section title="Actividades realizadas">
            <p>{session.activities}</p>
          </Section>

          <Section title="Desempeño del paciente">
            <p>{session.performance}</p>
          </Section>

          <Section title="Observaciones">
            <div className="space-y-3">
              <SubField label="Comentarios familiares" value={session.observations.familyComments} />
              <SubField label="Próximas sesiones" value={session.observations.nextSessionNotes} />
              <SubField label="Tareas para casa" value={session.observations.homeworkTasks} />
              <SubField label="Incidencias" value={session.observations.incidents} />
            </div>
          </Section>

          <div className="border-t border-neutral-100 pt-4 flex flex-wrap gap-2">
            <button className="text-xs px-3 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 text-neutral-700">
              Editar
            </button>
            <button className="text-xs px-3 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 text-neutral-700">
              Descargar PDF
            </button>
            <button
              className="text-xs px-3 py-2 rounded-lg text-white hover:opacity-90 ml-auto"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              Marcar como publicada
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="eyebrow mb-2">{title}</div>
      <div className="text-xs text-neutral-700 leading-relaxed">{children}</div>
    </div>
  );
}

function SubField({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-0.5">{label}</div>
      <div className="text-xs text-neutral-700">{value}</div>
    </div>
  );
}

function ResumenTab({ patient, therapist, isDiego }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
        <div className="eyebrow mb-2">Motivo de derivación</div>
        <p className="text-xs text-neutral-700 leading-relaxed">{patient.referralReason}</p>
        <div className="text-[10px] text-neutral-400 mt-3">Derivado por: {patient.referredBy}</div>
      </div>

      <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
        <div className="eyebrow mb-2">Objetivos terapéuticos actuales</div>
        <div className="flex flex-wrap gap-1.5">
          {patient.objectives.map((o) => (
            <span key={o} className="text-[11px] bg-neutral-100 text-neutral-700 px-2 py-0.5 rounded-full">
              {o}
            </span>
          ))}
        </div>
      </div>

      <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
        <div className="eyebrow mb-3">Próximas citas</div>
        {isDiego ? (
          <ul className="space-y-2">
            {DIEGO_UPCOMING.map((u, i) => (
              <li key={i} className="flex items-center justify-between text-xs">
                <div>
                  <div className="text-[var(--ink-900)] font-medium tabular">
                    {u.date} · {u.time}
                  </div>
                  <div className="text-[10px] text-neutral-400">{u.type}</div>
                </div>
                <span className="text-[11px] text-neutral-500">{findTherapist(u.therapistId).name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-neutral-400">Sin citas programadas en esta demo.</p>
        )}
      </div>

      <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
        <div className="eyebrow mb-3">Documentos adjuntos</div>
        {isDiego ? (
          <ul className="space-y-1.5">
            {DIEGO_DOCS.map((d, i) => (
              <li key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5 text-neutral-400 shrink-0">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-neutral-700 truncate">{d.name}</span>
                </div>
                <span className="text-[10px] text-neutral-400 shrink-0 ml-2 tabular">{d.size}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-neutral-400">Sin documentos adjuntos en esta demo.</p>
        )}
      </div>
    </div>
  );
}

function SesionesTab({ patient, isDiego, onOpenSession }) {
  if (!isDiego) {
    return (
      <div className="bg-white border border-dashed border-neutral-200 rounded-xl p-10 text-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 mx-auto text-neutral-300">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm text-neutral-600 mt-2">Sin sesiones registradas en esta demo</p>
        <p className="text-[11px] text-neutral-400 mt-1">
          Solo el paciente {patient.firstName} {patient.lastName} usa esta ficha para mostrar el flujo completo de sesiones.
        </p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-neutral-100 rounded-xl divide-y divide-neutral-100">
      {DIEGO_SESSIONS.map((s) => {
        const ss = sessionStatusStyles(s.status);
        const therapist = findTherapist(s.therapistId);
        return (
          <button
            key={s.id}
            onClick={() => onOpenSession(s)}
            className="w-full text-left p-4 lg:p-5 hover:bg-neutral-50/50 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 flex flex-col items-center pt-0.5">
                <div className="text-[10px] uppercase tracking-wider text-neutral-400 tabular">
                  {new Date(s.sessionDate).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                </div>
                <div className="text-[10px] text-neutral-400 tabular">
                  {new Date(s.sessionDate).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display text-sm text-[var(--ink-900)]">
                    {therapist.name}
                  </span>
                  <span className={`inline-flex items-center gap-1 ${ss.bg} ${ss.text} text-[9px] font-medium px-1.5 py-0.5 rounded-full`}>
                    <span className={`w-1 h-1 rounded-full ${ss.dot}`} />
                    {s.statusLabel}
                  </span>
                  <span className="text-[10px] text-neutral-400">{s.duration} min</span>
                </div>
                <p className="text-[11px] text-neutral-600 mt-1 line-clamp-2">{s.preview}</p>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 text-neutral-300 shrink-0 mt-1">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function InformesTab({ isDiego }) {
  if (!isDiego) {
    return (
      <div className="bg-white border border-dashed border-neutral-200 rounded-xl p-10 text-center">
        <p className="text-sm text-neutral-600">Sin informes generados en esta demo</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-neutral-100 rounded-xl divide-y divide-neutral-100">
      {DIEGO_REPORTS.map((r) => (
        <div key={r.id} className="p-4 flex items-center justify-between gap-3 hover:bg-neutral-50/50">
          <div className="min-w-0">
            <div className="font-medium text-[var(--ink-900)] text-sm">Informe {r.typeLabel.toLowerCase()}</div>
            <div className="text-[10px] text-neutral-400 tabular">
              {r.reportDate} · Entrega {r.dueDate}
            </div>
          </div>
          <span className="text-[10px] font-medium text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded-full">
            {r.statusLabel}
          </span>
        </div>
      ))}
    </div>
  );
}

function CoordinacionesTab({ isDiego }) {
  if (!isDiego) {
    return (
      <div className="bg-white border border-dashed border-neutral-200 rounded-xl p-10 text-center">
        <p className="text-sm text-neutral-600">Sin coordinaciones registradas en esta demo</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {DIEGO_COORDINATIONS.map((c) => (
        <div key={c.id} className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">
                {c.typeLabel}
              </span>
              <span className="text-[10px] text-neutral-400 tabular">{c.date}</span>
            </div>
          </div>
          <div className="text-[11px] text-neutral-500 mb-1">Participantes: {c.participants}</div>
          <p className="text-xs text-neutral-700 leading-relaxed">{c.topics}</p>
        </div>
      ))}
    </div>
  );
}

export default function PacienteFichaPage() {
  const params = useParams();
  const patient = findPatient(params.id);
  const [activeTab, setActiveTab] = useState("resumen");
  const [openSession, setOpenSession] = useState(null);

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

  const therapist = findTherapist(patient.mainTherapistId);
  const s = statusStyles(patient.status);
  const isDiego = patient.id === "p-1";

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <Link
        href="/pacientes"
        className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] transition-colors w-fit"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Pacientes
      </Link>

      <PreviewBanner />

      {/* Cabecera */}
      <div className="bg-white border border-neutral-100 rounded-xl p-5 lg:p-6">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
          <div
            className="shrink-0 w-16 h-16 lg:w-20 lg:h-20 rounded-full flex items-center justify-center text-white font-display text-2xl"
            style={{ backgroundColor: patient.color }}
          >
            {patient.initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] tracking-tight">
                {patient.firstName} {patient.lastName}
              </h1>
              <span className={`inline-flex items-center gap-1.5 ${s.bg} ${s.text} text-[11px] font-medium px-2.5 py-0.5 rounded-full`}>
                <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                {patient.statusLabel}
              </span>
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">
              {patient.age} años · {patient.educationLevel}
            </p>
            <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="Centro escolar" value={patient.educationCenter} />
              <Field label="Terapeuta principal" value={therapist.name} />
              <Field label="Fecha alta" value={patient.enrollmentDate} />
              <Field label="Frecuencia" value={patient.attendanceFrequency} />
            </div>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <Link
              href={`/pacientes/${patient.id}/sesiones/nueva`}
              className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 7.5m0 0L7.5 12m4.5-4.5v13.5" />
              </svg>
              Subir audio
            </Link>
            <button className="text-xs font-medium px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 text-neutral-700 inline-flex items-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Nuevo informe
            </button>
            <button className="text-xs font-medium px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 text-neutral-700">
              Editar ficha
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-neutral-200">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`text-xs font-medium px-4 py-2.5 border-b-2 transition-colors whitespace-nowrap ${
                activeTab === t.key
                  ? "border-[var(--color-primary,#1B3A2D)] text-[var(--ink-900)]"
                  : "border-transparent text-neutral-500 hover:text-neutral-700"
              }`}
            >
              {t.label}
              {t.key === "sesiones" && isDiego && (
                <span className="ml-1.5 text-[10px] bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded-full tabular">
                  {DIEGO_SESSIONS.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Contenido tabs */}
      <div>
        {activeTab === "resumen" && <ResumenTab patient={patient} therapist={therapist} isDiego={isDiego} />}
        {activeTab === "sesiones" && (
          <SesionesTab patient={patient} isDiego={isDiego} onOpenSession={setOpenSession} />
        )}
        {activeTab === "informes" && <InformesTab isDiego={isDiego} />}
        {activeTab === "coordinaciones" && <CoordinacionesTab isDiego={isDiego} />}
      </div>

      {openSession && (
        <SessionDrawer
          session={openSession}
          patient={patient}
          therapist={findTherapist(openSession.therapistId)}
          onClose={() => setOpenSession(null)}
        />
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-400">{label}</div>
      <div className="text-xs text-[var(--ink-900)] font-medium mt-0.5">{value}</div>
    </div>
  );
}
