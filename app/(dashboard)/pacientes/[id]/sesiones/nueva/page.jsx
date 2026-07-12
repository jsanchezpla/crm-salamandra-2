"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

const STATE = { IDLE: "idle", UPLOADED: "uploaded", PROCESSING: "processing", STRUCTURED: "structured" };

const PROCESSING_STEPS = [
  "Subiendo audio…",
  "Transcribiendo con Whisper…",
  "Identificando objetivos trabajados…",
  "Estructurando observaciones…",
];

const fmtSize = (b) => (b == null ? "" : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`);
const fmtDur = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

export default function NuevaSesionPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id;

  const [patient, setPatient] = useState(null);
  const [loadingPatient, setLoadingPatient] = useState(true);
  const [state, setState] = useState(STATE.IDLE);
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [processingStep, setProcessingStep] = useState(0);
  const [result, setResult] = useState(null); // { transcription, structured, audioDurationSec, demo }
  const [form, setForm] = useState(null); // campos editables
  const [errorMsg, setErrorMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    fetch(`/api/pacientes/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => j.ok && setPatient(j.data))
      .catch(() => {})
      .finally(() => setLoadingPatient(false));
  }, [id]);

  // Animación de los pasos mientras la petición está en vuelo.
  useEffect(() => {
    if (state !== STATE.PROCESSING) return;
    setProcessingStep(0);
    const t = setInterval(() => setProcessingStep((s) => Math.min(s + 1, PROCESSING_STEPS.length - 1)), 700);
    return () => clearInterval(t);
  }, [state]);

  function pickFile(f) {
    if (!f) return;
    setFile(f);
    setErrorMsg(null);
    setState(STATE.UPLOADED);
  }

  async function process() {
    if (!file) return;
    setState(STATE.PROCESSING);
    setErrorMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const r = await fetch("/api/clinica/sessions/transcribe", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo procesar el audio");
      const s = j.data.structured;
      setResult(j.data);
      setForm({
        objectives: (s.objectives ?? []).join(", "),
        activities: s.activities ?? "",
        performance: s.performance ?? "",
        familyComments: s.observations?.familyComments ?? "",
        nextSessionNotes: s.observations?.nextSessionNotes ?? "",
        homeworkTasks: s.observations?.homeworkTasks ?? "",
        incidents: s.observations?.incidents ?? "",
      });
      setState(STATE.STRUCTURED);
    } catch (e) {
      setErrorMsg(e.message);
      setState(STATE.UPLOADED);
    }
  }

  function reset() {
    setState(STATE.IDLE);
    setFile(null);
    setResult(null);
    setForm(null);
    setErrorMsg(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function save() {
    if (!patient?.mainTherapistId) {
      setErrorMsg("El paciente no tiene terapeuta asignado. Asígnale uno en su ficha antes de guardar.");
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      const payload = {
        patientId: id,
        therapistId: patient.mainTherapistId,
        sessionDate: new Date().toISOString(),
        objectives: form.objectives.split(",").map((s) => s.trim()).filter(Boolean),
        activities: form.activities,
        performance: form.performance,
        observations: {
          familyComments: form.familyComments,
          nextSessionNotes: form.nextSessionNotes,
          homeworkTasks: form.homeworkTasks,
          incidents: form.incidents,
        },
        aiTranscription: result.transcription,
        aiStructured: result.structured,
        audioDurationSec: result.audioDurationSec,
        aiReviewedAt: new Date().toISOString(),
        status: "registered",
      };
      const r = await fetch("/api/clinica/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar la sesión");
      router.push(`/pacientes/${id}`);
    } catch (e) {
      setErrorMsg(e.message);
      setSaving(false);
    }
  }

  const therapistName = patient?.therapist?.name ?? "—";
  const today = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  const ta = "w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed";

  if (loadingPatient) return <div className="p-4 lg:p-8 text-sm text-neutral-400">Cargando…</div>;
  if (!patient) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="bg-white border border-neutral-100 rounded-xl p-10 text-center mt-5">
          <p className="text-sm text-neutral-600">Paciente no encontrado.</p>
          <Link href="/pacientes" className="text-xs text-[var(--color-primary,#1B3A2D)] hover:underline mt-2 inline-block">← Volver al listado</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <nav className="flex items-center gap-1.5 text-xs text-neutral-500">
        <Link href="/pacientes" className="hover:text-[var(--color-primary,#1B3A2D)]">Pacientes</Link>
        <span className="text-neutral-300">/</span>
        <Link href={`/pacientes/${id}`} className="hover:text-[var(--color-primary,#1B3A2D)]">{patient.firstName} {patient.lastName}</Link>
        <span className="text-neutral-300">/</span>
        <span className="text-neutral-700">Nueva sesión</span>
      </nav>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.m4a,.mp3,.wav,.ogg,.webm,.mp4"
        className="hidden"
        onChange={(e) => pickFile(e.target.files?.[0])}
      />

      {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}

      {/* ── IDLE ── */}
      {state === STATE.IDLE && (
        <div className="bg-white border border-neutral-100 rounded-xl p-6 lg:p-10">
          <div className="text-center mb-6">
            <div className="eyebrow mb-2">Nueva sesión</div>
            <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] tracking-tight">{patient.firstName} {patient.lastName}</h1>
            <p className="text-xs text-neutral-500 mt-1">{therapistName} · {today}</p>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); pickFile(e.dataTransfer.files?.[0]); }}
            onClick={() => fileRef.current?.click()}
            className={`max-w-2xl mx-auto rounded-xl border-2 border-dashed cursor-pointer transition-all p-10 text-center ${isDragging ? "border-[var(--color-primary,#1B3A2D)] bg-[color-mix(in_srgb,var(--color-primary,#1B3A2D)_5%,white)]" : "border-neutral-200 hover:border-neutral-300 bg-neutral-50/30"}`}
          >
            <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center text-white mb-4" style={{ background: "var(--color-primary, #1B3A2D)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 7.5m0 0L7.5 12m4.5-4.5v13.5" /></svg>
            </div>
            <p className="font-display text-lg text-[var(--ink-900)]">Subir audio de la sesión</p>
            <p className="text-xs text-neutral-500 mt-1 max-w-md mx-auto leading-relaxed">Sube el audio grabado con tu móvil. La IA lo transcribirá (Whisper) y lo estructurará (Claude) en apartados.</p>
            <button type="button" className="mt-4 inline-flex items-center gap-2 text-xs font-medium px-4 py-2 rounded-lg border border-neutral-200 bg-white hover:border-neutral-400 text-neutral-700">Seleccionar archivo</button>
            <p className="text-[10px] text-neutral-400 mt-4">Formatos: m4a, mp3, wav, ogg, webm · Máx. 25 MB</p>
          </div>
        </div>
      )}

      {/* ── UPLOADED ── */}
      {state === STATE.UPLOADED && file && (
        <div className="bg-white border border-neutral-100 rounded-xl p-6 lg:p-10">
          <div className="text-center mb-6">
            <div className="eyebrow mb-2">Audio seleccionado</div>
            <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] tracking-tight">{patient.firstName} {patient.lastName}</h1>
            <p className="text-xs text-neutral-500 mt-1">{therapistName} · {today}</p>
          </div>
          <div className="max-w-2xl mx-auto bg-neutral-50 border border-neutral-100 rounded-xl p-4 flex items-center gap-3">
            <div className="shrink-0 w-12 h-12 rounded-lg flex items-center justify-center text-white" style={{ background: "var(--color-primary, #1B3A2D)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" /></svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[var(--ink-900)] truncate">{file.name}</div>
              <div className="text-[10px] text-neutral-400 tabular">{fmtSize(file.size)}</div>
            </div>
            <button onClick={reset} className="shrink-0 text-neutral-400 hover:text-neutral-700">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="max-w-2xl mx-auto mt-6 flex flex-wrap gap-2 justify-end">
            <button onClick={() => fileRef.current?.click()} className="text-xs px-4 py-2 text-neutral-500 hover:underline">Cambiar archivo</button>
            <button onClick={process} className="text-xs font-medium px-5 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2" style={{ background: "var(--color-primary, #1B3A2D)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
              Procesar con IA
            </button>
          </div>
        </div>
      )}

      {/* ── PROCESSING ── */}
      {state === STATE.PROCESSING && (
        <div className="bg-white border border-neutral-100 rounded-xl p-8 lg:p-12 text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center text-white mb-5" style={{ background: "var(--color-primary, #1B3A2D)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 animate-spin"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
          </div>
          <h2 className="font-display text-xl lg:text-2xl text-[var(--ink-900)]">Procesando audio con IA</h2>
          <p className="text-xs text-neutral-500 mt-1">{file?.name}</p>
          <ul className="mt-8 max-w-md mx-auto space-y-2 text-left">
            {PROCESSING_STEPS.map((step, i) => {
              const done = i < processingStep;
              const current = i === processingStep;
              return (
                <li key={i} className="flex items-center gap-2.5 text-xs">
                  <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${done ? "bg-emerald-500 text-white" : current ? "bg-neutral-100" : "bg-neutral-50"}`}>
                    {done && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-2.5 h-2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    {current && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary,#1B3A2D)] animate-pulse" />}
                  </span>
                  <span className={done ? "text-neutral-500 line-through" : current ? "text-[var(--ink-900)] font-medium" : "text-neutral-400"}>{step}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── STRUCTURED (revisar + editar) ── */}
      {state === STATE.STRUCTURED && form && result && (
        <>
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 flex items-start gap-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div className="flex-1">
              <div className="text-xs font-semibold text-emerald-900">Sesión transcrita y estructurada por IA{result.demo ? " (datos de demostración)" : ""}</div>
              <p className="text-[11px] text-emerald-700 mt-0.5">Revisa y edita cada apartado antes de guardar.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-3">
            {/* Transcripción */}
            <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
              <div className="eyebrow mb-2">Audio</div>
              <p className="text-[10px] text-neutral-400 mb-4">{file?.name} · {fmtSize(file?.size)}{result.audioDurationSec != null ? ` · ${fmtDur(result.audioDurationSec)}` : ""}</p>
              <div className="eyebrow mb-2">Transcripción literal</div>
              <p className="text-xs text-neutral-600 leading-relaxed italic">«{result.transcription}»</p>
            </div>

            {/* Registro estructurado editable */}
            <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 space-y-4">
              <div className="eyebrow">Registro clínico estructurado</div>
              <Block label="Objetivos trabajados (separados por comas)">
                <input className={ta} value={form.objectives} onChange={(e) => setForm({ ...form, objectives: e.target.value })} />
              </Block>
              <Block label="Actividades realizadas">
                <textarea className={ta} rows={3} value={form.activities} onChange={(e) => setForm({ ...form, activities: e.target.value })} />
              </Block>
              <Block label="Desempeño del paciente">
                <textarea className={ta} rows={3} value={form.performance} onChange={(e) => setForm({ ...form, performance: e.target.value })} />
              </Block>
              <Block label="Observaciones">
                <div className="space-y-2">
                  <SubField label="Comentarios familiares" ta={ta} value={form.familyComments} onChange={(v) => setForm({ ...form, familyComments: v })} />
                  <SubField label="Próximas sesiones" ta={ta} value={form.nextSessionNotes} onChange={(v) => setForm({ ...form, nextSessionNotes: v })} />
                  <SubField label="Tareas para casa" ta={ta} value={form.homeworkTasks} onChange={(v) => setForm({ ...form, homeworkTasks: v })} />
                  <SubField label="Incidencias" ta={ta} value={form.incidents} onChange={(v) => setForm({ ...form, incidents: v })} />
                </div>
              </Block>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={() => router.push(`/pacientes/${id}`)} disabled={saving} className="text-xs px-4 py-2 text-neutral-500 hover:underline disabled:opacity-50">Cancelar</button>
            <button onClick={reset} disabled={saving} className="text-xs px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 text-neutral-700 disabled:opacity-50">Empezar de nuevo</button>
            <button onClick={save} disabled={saving} className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              {saving ? "Guardando…" : "Guardar sesión"}
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
function SubField({ label, value, onChange, ta }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-0.5">{label}</div>
      <textarea className={ta} rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
