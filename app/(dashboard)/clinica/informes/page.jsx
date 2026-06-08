"use client";

import { useState } from "react";
import PreviewBanner from "../_components/PreviewBanner.jsx";
import {
  REPORTS,
  REPORT_CONTENT,
  findTherapist,
  findPatient,
} from "../_components/dummyData.js";

const STATUS_STYLES = {
  draft: { bg: "bg-neutral-100", text: "text-neutral-600", dot: "bg-neutral-400" },
  reviewed: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  delivered: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
};

const TYPE_STYLES = {
  evolution: { bg: "bg-sky-50", text: "text-sky-700" },
  admission: { bg: "bg-violet-50", text: "text-violet-700" },
  discharge: { bg: "bg-emerald-50", text: "text-emerald-700" },
};

function ReportDrawer({ report, onClose }) {
  const patient = findPatient(report.patientId);
  const therapist = findTherapist(report.therapistId);
  const content = REPORT_CONTENT[report.id];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer — top-14 lg:top-0 (regla #13: respeta barra hamburguesa móvil) */}
      <aside className="fixed right-0 top-14 lg:top-0 bottom-0 z-50 w-full sm:w-[640px] bg-white shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-neutral-100 px-5 lg:px-7 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <div className="eyebrow">Informe {report.typeLabel.toLowerCase()}</div>
            <h2 className="font-display text-xl text-[var(--ink-900)] mt-1 leading-tight">
              {patient.name} <span className="text-neutral-400 font-normal">· {patient.age} años</span>
            </h2>
            <p className="text-[11px] text-neutral-500 mt-1">
              {therapist.name} · {report.reportDate}
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
          {/* Banner IA */}
          <div className="bg-sky-50 border border-sky-100 rounded-lg px-3 py-2.5 flex items-start gap-2.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 text-sky-700 mt-0.5 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            <p className="text-[11px] text-sky-900 leading-relaxed flex-1">
              <span className="font-semibold">Generado por IA</span> · Revisa cada sección antes de entregar a la familia. Editable en cualquier momento.
            </p>
          </div>

          {/* CTA generación */}
          <button
            className="w-full text-sm font-medium py-2.5 rounded-lg text-white hover:opacity-90 transition-opacity inline-flex items-center justify-center gap-2"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            Regenerar con IA a partir de las últimas {patient.sessionsCount ?? 8} sesiones
          </button>

          {content ? (
            <>
              <Section title="Motivo de intervención">
                <p>{content.motiveOfIntervention}</p>
              </Section>

              <Section title="Objetivos terapéuticos">
                <ul className="list-disc list-outside ml-4 space-y-1">
                  {content.objectives.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              </Section>

              <Section title="Evolución observada">
                {content.evolution.map((p, i) => (
                  <p key={i} className={i > 0 ? "mt-2" : ""}>
                    {p}
                  </p>
                ))}
              </Section>

              <Section title="Logros alcanzados">
                <ul className="list-disc list-outside ml-4 space-y-1">
                  {content.achievements.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </Section>

              <Section title="Dificultades persistentes">
                <ul className="list-disc list-outside ml-4 space-y-1">
                  {content.persistentDifficulties.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </Section>

              <Section title="Recomendaciones">
                <ul className="list-disc list-outside ml-4 space-y-1">
                  {content.recommendations.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </Section>

              <Section title="Propuesta de continuidad">
                <p>{content.continuityProposal}</p>
              </Section>
            </>
          ) : (
            <div className="bg-neutral-50 border border-dashed border-neutral-200 rounded-lg px-5 py-12 text-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 mx-auto text-neutral-300">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm text-neutral-600 mt-2">Informe no generado todavía.</p>
              <p className="text-[11px] text-neutral-400 mt-1">
                Pulsa &laquo;Regenerar con IA&raquo; para crear el contenido a partir del historial de sesiones.
              </p>
            </div>
          )}

          {/* Acciones */}
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
              Marcar como entregado
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

export default function InformesPage() {
  const [selectedId, setSelectedId] = useState(null);
  const selected = REPORTS.find((r) => r.id === selectedId);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <PreviewBanner />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Clínica · Informes</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">
            Informes clínicos
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Evolutivos, de admisión y de alta · Generados por IA a partir de las sesiones
          </p>
        </div>
        <button
          className="self-start lg:self-auto text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Nuevo informe
        </button>
      </div>

      {/* Mini filtros decorativos */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-neutral-400 uppercase tracking-wider">Filtrar:</span>
        <button className="px-2.5 py-1 rounded-full bg-[var(--color-primary,#1B3A2D)] text-white">Todos</button>
        <button className="px-2.5 py-1 rounded-full border border-neutral-200 text-neutral-600 hover:border-neutral-400">Borradores</button>
        <button className="px-2.5 py-1 rounded-full border border-neutral-200 text-neutral-600 hover:border-neutral-400">Revisados</button>
        <button className="px-2.5 py-1 rounded-full border border-neutral-200 text-neutral-600 hover:border-neutral-400">Entregados</button>
        <button className="px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-400">
          Entrega vencida (2)
        </button>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50/50">
              <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-400">
                <th className="px-4 py-3 font-medium">Paciente</th>
                <th className="px-4 py-3 font-medium">Terapeuta</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Entrega</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {REPORTS.map((r) => {
                const p = findPatient(r.patientId);
                const t = findTherapist(r.therapistId);
                const s = STATUS_STYLES[r.status];
                const ts = TYPE_STYLES[r.type];
                const overdue =
                  r.status !== "delivered" && new Date(r.dueDate) < new Date("2026-06-08");
                return (
                  <tr
                    key={r.id}
                    className="border-t border-neutral-100 hover:bg-neutral-50/40 cursor-pointer"
                    onClick={() => setSelectedId(r.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-[var(--ink-900)] font-medium">{p.name}</div>
                      <div className="text-[10px] text-neutral-400">{p.age} años · {p.focus}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-display"
                          style={{ backgroundColor: t.color ?? "#1B3A2D" }}
                        >
                          {t.initials}
                        </div>
                        <span className="text-neutral-700">{t.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded ${ts.bg} ${ts.text}`}>
                        {r.typeLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular text-neutral-600">{r.reportDate}</td>
                    <td className="px-4 py-3 tabular">
                      <span className={overdue ? "text-red-600 font-medium" : "text-neutral-600"}>
                        {r.dueDate}
                        {overdue && <span className="block text-[9px] uppercase tracking-wider">Vencida</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 ${s.bg} ${s.text} text-[10px] font-medium px-2 py-0.5 rounded-full`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                        {r.statusLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(r.id);
                        }}
                      >
                        Ver
                      </button>
                      <button
                        className="text-[11px] text-neutral-500 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        PDF
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <ReportDrawer report={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
