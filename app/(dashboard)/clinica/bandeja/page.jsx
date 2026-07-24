"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Select from "@/components/ui/Select.jsx";
import PreviewBanner from "../_components/PreviewBanner.jsx";

const STATUS_PILL = {
  amber: "bg-amber-50 text-amber-700",
  blue: "bg-blue-50 text-blue-700",
  green: "bg-emerald-50 text-emerald-700",
  gray: "bg-neutral-100 text-neutral-500",
};
const PRIORITY_DOT = { high: "bg-red-500", medium: "bg-amber-400", low: "bg-neutral-300" };
const fmt = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : "—");
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—");

function Section({ title, count, children, empty }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
      <div className="px-4 lg:px-5 py-3 flex items-center justify-between border-b border-neutral-100">
        <h2 className="eyebrow">{title}</h2>
        <span className="text-[10px] text-neutral-400">{count}</span>
      </div>
      {count === 0 ? <p className="px-4 py-8 text-center text-xs text-neutral-400">{empty}</p> : <div>{children}</div>}
    </div>
  );
}

export default function BandejaPage() {
  const [therapistId, setTherapistId] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    setLoading(true); setErrorMsg(null);
    const qs = therapistId ? `?therapistId=${therapistId}` : "";
    fetch(`/api/clinica/bandeja${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setData(j.data); else setErrorMsg(j.error); })
      .catch((e) => setErrorMsg(e.message))
      .finally(() => setLoading(false));
  }, [therapistId]);

  const c = data?.counts ?? {};
  const therapists = data?.therapists ?? [];
  const reports = data?.reports ?? [];
  const incidencias = data?.incidencias ?? [];
  const citas = data?.citasToday ?? [];

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-5">
      <Link href="/clinica" className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] transition-colors w-fit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Volver a Clínica
      </Link>

      <PreviewBanner />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Clínica · Bandeja de trabajo</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">{loading ? "…" : `Bandeja de ${data?.therapist?.name ?? "—"}`}</h1>
          <p className="text-xs text-neutral-400 mt-1">Lo tuyo pendiente: informes, incidencias y citas de hoy.</p>
        </div>
        {therapists.length > 1 && (
          <Select
            value={therapistId || (data?.therapist?.id ?? "")}
            onChange={setTherapistId}
            options={therapists.map((t) => ({ value: t.id, label: t.name }))}
            className="self-start lg:self-auto text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer"
          />
        )}
      </div>

      {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-neutral-100 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">Informes</div>
          <div className="font-display text-2xl text-[var(--ink-900)] mt-1 tabular">{loading ? "—" : c.reports ?? 0}</div>
          <div className={`text-[11px] mt-0.5 ${c.reportsOverdue ? "text-red-600 font-medium" : "text-neutral-500"}`}>{c.reportsOverdue ? `${c.reportsOverdue} vencido${c.reportsOverdue > 1 ? "s" : ""}` : "Al día"}</div>
        </div>
        <div className="bg-white border border-neutral-100 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">Incidencias</div>
          <div className="font-display text-2xl text-[var(--ink-900)] mt-1 tabular">{loading ? "—" : c.incidencias ?? 0}</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">Asignadas sin resolver</div>
        </div>
        <div className="bg-white border border-neutral-100 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">Citas hoy</div>
          <div className="font-display text-2xl text-[var(--ink-900)] mt-1 tabular">{loading ? "—" : c.citasToday ?? 0}</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">En tu agenda</div>
        </div>
      </div>

      {!loading && (
        <>
          {/* Informes pendientes */}
          <Section title="Informes pendientes" count={reports.length} empty="Sin informes pendientes. 🎉">
            <ul className="divide-y divide-neutral-100">
              {reports.map((r) => (
                <li key={r.id} className="px-4 lg:px-5 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[var(--ink-900)] font-medium truncate">{r.patientName ?? "—"} <span className="text-neutral-400 font-normal">· {r.typeLabel}</span></div>
                    <div className="text-[11px] text-neutral-400">{r.dueDate ? `Entrega ${fmt(r.dueDate)}` : "Sin fecha de entrega"}</div>
                  </div>
                  {r.overdue && <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700">Vencido</span>}
                  {r.patientId && <Link href={`/pacientes/${r.patientId}`} className="shrink-0 text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline">Abrir</Link>}
                </li>
              ))}
            </ul>
          </Section>

          {/* Mis incidencias */}
          <Section title="Mis incidencias" count={incidencias.length} empty="Sin incidencias asignadas.">
            <ul className="divide-y divide-neutral-100">
              {incidencias.map((i) => (
                <li key={i.id} className="px-4 lg:px-5 py-3 flex items-center gap-3">
                  <span className={`shrink-0 w-2 h-2 rounded-full ${PRIORITY_DOT[i.priority] ?? "bg-neutral-300"}`} title={`Prioridad ${i.priorityLabel}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[var(--ink-900)] font-medium truncate">{i.title}</div>
                    <div className="text-[11px] text-neutral-400 truncate">{i.categoryLabel}{i.patientName ? ` · ${i.patientName}` : ""} · {fmt(i.date)}</div>
                  </div>
                  <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_PILL[i.statusLevel] ?? STATUS_PILL.gray}`}>{i.statusLabel}</span>
                </li>
              ))}
            </ul>
            <div className="px-4 lg:px-5 py-2.5 border-t border-neutral-100 bg-neutral-50/40 text-right">
              <Link href="/clinica/incidencias" className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline">Ver todas las incidencias →</Link>
            </div>
          </Section>

          {/* Citas de hoy */}
          <Section title="Citas de hoy" count={citas.length} empty="No tienes citas hoy.">
            <ul className="divide-y divide-neutral-100">
              {citas.map((b) => (
                <li key={b.id} className="px-4 lg:px-5 py-3 flex items-center gap-3">
                  <span className="shrink-0 font-display text-sm text-[var(--ink-900)] tabular w-12">{fmtTime(b.scheduledAt)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[var(--ink-900)] font-medium truncate">{b.patientName ?? b.clientName}</div>
                    <div className="text-[11px] text-neutral-400 truncate">{b.eventType ?? "Cita"} · {b.duration} min · {b.modality}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="px-4 lg:px-5 py-2.5 border-t border-neutral-100 bg-neutral-50/40 text-right">
              <Link href="/citas" className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline">Ir al calendario →</Link>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
