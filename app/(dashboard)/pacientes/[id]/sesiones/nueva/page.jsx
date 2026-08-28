"use client";

/**
 * /pacientes/[id]/sesiones/nueva — «Nuevo registro» de sesión (26/08/2026,
 * Rodrigo: «en lugar de Subir audio, Nuevo registro; que se pueda hacer todo
 * el registro en texto, y el audio dentro y opcional»).
 *
 * Hasta hoy el camino principal era el audio: la página abría con la zona de
 * soltar el fichero y el formulario solo aparecía DESPUÉS de que la IA lo
 * estructurara (o como preparación-borrador). Ahora es al revés:
 *
 *   - La página abre con el REGISTRO COMPLETO en texto, las tres partes del
 *     sprint 2026-07: 1·Preparación (con adjuntos), 2·Informe (objetivos,
 *     actividades, desempeño, observaciones) y 3·Devolución de la familia.
 *   - El audio es un bloque OPCIONAL dentro: si se sube y procesa, la IA
 *     rellena SOLO los apartados vacíos del informe — lo escrito a mano no se
 *     pisa (la regla de la casa, la misma que el volcado de informes).
 *
 * «Preparar la sesión» (borrador antes de darla, 26/08 por la mañana) sigue
 * igual: se llega con ?preparar=1 desde el modal de la cita o con su enlace de
 * abajo, y no ha cambiado nada de ese flujo.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import useZonaSoltar, { useEvitarSoltarFuera } from "@/components/ui/useZonaSoltar.js";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";
import {
  fechaDePreparacion,
  paraInputLocal,
  payloadDePreparacion,
  pidePreparar,
} from "@/lib/clinica/prepararSesion.js";

const STATE = { FORM: "form", PROCESSING: "processing", PREPARING: "preparing" };

// Lo que admite cada campo de fichero. En una constante porque ahora lo leen
// DOS sitios: el `accept` del input (filtra el explorador) y la zona de soltar
// (filtra lo que llega arrastrado, que el navegador no filtra por su cuenta).
const ACEPTA_AUDIO = "audio/*,.m4a,.mp3,.wav,.ogg,.webm,.mp4";
const ACEPTA_PREP = "image/*,audio/*,application/pdf";
const MAX_PREP = 10;

const PROCESSING_STEPS = [
  "Subiendo audio…",
  "Transcribiendo con Whisper…",
  "Identificando objetivos trabajados…",
  "Estructurando observaciones…",
];

const FORM_VACIO = {
  objectives: "",
  activities: "",
  performance: "",
  familyComments: "",
  nextSessionNotes: "",
  homeworkTasks: "",
  incidents: "",
  prepText: "",
  parentFeedback: "",
};

const fmtSize = (b) => (b == null ? "" : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`);
const fmtDur = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

export default function NuevaSesionPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id;
  const query = useSearchParams();

  const [patient, setPatient] = useState(null);
  const [loadingPatient, setLoadingPatient] = useState(true);
  // Quien llega desde una cita («Preparar sesión») entra DIRECTO al formulario
  // de preparación: el enlace ya dijo a qué venía. Va en el estado inicial y no
  // en un efecto, para que volver al registro a mano no se deshaga solo.
  const [state, setState] = useState(() => (pidePreparar(query.get("preparar")) ? STATE.PREPARING : STATE.FORM));
  // La fecha de la cita, si viene; si no, ahora. Se acota en `fechaDePreparacion`
  // porque llega por la barra de direcciones. La comparten el registro y la
  // preparación: es «cuándo es (o fue) la sesión».
  const [fecha, setFecha] = useState(() => paraInputLocal(fechaDePreparacion(query.get("fecha")) ?? new Date()));
  const [prepSolo, setPrepSolo] = useState("");
  const [form, setForm] = useState(FORM_VACIO);
  const [file, setFile] = useState(null);
  const [processingStep, setProcessingStep] = useState(0);
  const [result, setResult] = useState(null); // { transcription, structured, audioDurationSec, demo }
  const [avisoAudio, setAvisoAudio] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  // Adjuntos de la PREPARACIÓN (punto 4 del sprint). Se quedan en memoria hasta
  // que la sesión existe: el endpoint de adjuntos necesita su id.
  const [prepFiles, setPrepFiles] = useState([]);
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

  /**
   * Procesa el audio y rellena SOLO los apartados vacíos del informe: lo que la
   * profesional ya haya escrito a mano no se pisa (misma regla que el volcado
   * de sesiones en los informes). La transcripción se queda a la vista.
   */
  async function procesarAudio() {
    if (!file) return;
    setState(STATE.PROCESSING);
    setErrorMsg(null);
    setAvisoAudio(null);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const r = await fetch("/api/clinica/sessions/transcribe", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo procesar el audio");
      const s = j.data.structured;
      const propuesta = {
        objectives: (s.objectives ?? []).join(", "),
        activities: s.activities ?? "",
        performance: s.performance ?? "",
        familyComments: s.observations?.familyComments ?? "",
        nextSessionNotes: s.observations?.nextSessionNotes ?? "",
        homeworkTasks: s.observations?.homeworkTasks ?? "",
        incidents: s.observations?.incidents ?? "",
      };
      let rellenados = 0;
      let respetados = 0;
      setForm((f) => {
        const n = { ...f };
        for (const [k, v] of Object.entries(propuesta)) {
          if (!String(v).trim()) continue;
          if (String(n[k] ?? "").trim()) { respetados++; continue; }
          n[k] = v;
          rellenados++;
        }
        return n;
      });
      setResult(j.data);
      setAvisoAudio(
        `El audio ha rellenado ${rellenados} apartado(s) vacío(s)` +
          (respetados ? `; ${respetados} ya tenían texto tuyo y no se han tocado.` : ".") +
          " Revisa y edita antes de guardar."
      );
      setState(STATE.FORM);
    } catch (e) {
      setErrorMsg(e.message);
      setState(STATE.FORM);
    }
  }

  function quitarAudio() {
    setFile(null);
    setResult(null);
    setAvisoAudio(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  /**
   * Guardar una sesión que TODAVÍA NO SE HA DADO (flujo de la mañana del 26/08,
   * intacto). El cuerpo lo arma `payloadDePreparacion`, que NO manda los campos
   * de la IA: una sesión preparada no ha pasado por Whisper ni por Claude.
   */
  async function guardarPreparacion() {
    if (!patient?.mainTherapistId) {
      setErrorMsg("El paciente no tiene terapeuta asignado. Asígnale uno en su ficha antes de guardar.");
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      // El input de fecha manda hora LOCAL sin zona y `new Date` la lee como
      // local: es exactamente la hora que ve quien la escribe.
      const escrita = fecha ? new Date(fecha) : new Date();
      const payload = payloadDePreparacion({
        patientId: id,
        therapistId: patient.mainTherapistId,
        fecha: Number.isNaN(escrita.getTime()) ? new Date() : escrita,
        prepText: prepSolo,
      });
      const r = await fetch("/api/clinica/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar la preparación");
      await subirAdjuntos(j.data.id, "Preparación guardada");
    } catch (e) {
      setErrorMsg(e.message);
      setSaving(false);
    }
  }

  // Los adjuntos van DESPUÉS del POST: necesitan el id de la sesión recién
  // creada. Si alguno falla no se pierde la sesión: se avisa y se queda aquí.
  async function subirAdjuntos(sessionId, etiquetaOk) {
    const fallidos = [];
    for (const f of prepFiles) {
      const fd = new FormData();
      fd.append("file", f, f.name);
      const up = await fetch(`/api/clinica/sessions/${sessionId}/prep-files`, { method: "POST", body: fd });
      if (!up.ok) fallidos.push(f.name);
    }
    if (fallidos.length) {
      setErrorMsg(`${etiquetaOk}, pero no se pudieron subir: ${fallidos.join(", ")}. Puedes añadirlos desde la ficha.`);
      setSaving(false);
      return;
    }
    router.push(`/pacientes/${id}`);
  }

  // Un registro sin NADA escrito no es un registro: algo tiene que llevar.
  const hayContenido = Object.values(form).some((v) => String(v ?? "").trim());

  async function guardarRegistro() {
    if (!patient?.mainTherapistId) {
      setErrorMsg("El paciente no tiene terapeuta asignado. Asígnale uno en su ficha antes de guardar.");
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      const escrita = fecha ? new Date(fecha) : new Date();
      const payload = {
        patientId: id,
        therapistId: patient.mainTherapistId,
        sessionDate: (Number.isNaN(escrita.getTime()) ? new Date() : escrita).toISOString(),
        objectives: form.objectives.split(",").map((s) => s.trim()).filter(Boolean),
        activities: form.activities,
        performance: form.performance,
        observations: {
          familyComments: form.familyComments,
          nextSessionNotes: form.nextSessionNotes,
          homeworkTasks: form.homeworkTasks,
          incidents: form.incidents,
        },
        prepText: form.prepText,
        parentFeedback: form.parentFeedback,
        status: "registered",
        // Solo si hubo audio: transcripción, estructura cruda y duración. Un
        // registro escrito a mano no ha pasado por la IA y no debe decir que sí.
        ...(result
          ? {
              aiTranscription: result.transcription,
              aiStructured: result.structured,
              audioDurationSec: result.audioDurationSec,
              aiReviewedAt: new Date().toISOString(),
            }
          : {}),
      };
      const r = await fetch("/api/clinica/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar la sesión");
      await subirAdjuntos(j.data.id, "Sesión guardada");
    } catch (e) {
      setErrorMsg(e.message);
      setSaving(false);
    }
  }

  /*
   * ── ARRASTRAR Y SOLTAR (28/08/2026, Lau de Aumenta) ───────────────────────
   * El audio le llega por WhatsApp y lo descarga: le queda a la vista en la
   * barra de descargas del navegador. Pulsar «Añadir audio» abría el explorador
   * de Windows y la obligaba a ir a buscar en Descargas el fichero que ya tenía
   * delante. Ahora se puede soltar encima de la tarjeta (y pegar con Ctrl+V),
   * sin quitar el clic de siempre para quien lo prefiera.
   *
   * Los ganchos van AQUÍ, antes de los `return` de carga: son hooks.
   */
  useEvitarSoltarFuera();

  const zonaAudio = useZonaSoltar({
    accept: ACEPTA_AUDIO,
    queSeEspera: "un audio de la sesión",
    // Con el audio ya procesado no se admite otro: primero hay que quitarlo.
    apagada: state !== STATE.FORM || !!result,
    pegar: true,
    onFicheros: ([f]) => {
      setFile(f);
      setErrorMsg(null);
    },
    onAviso: setErrorMsg,
  });

  const zonaPrep = useZonaSoltar({
    accept: ACEPTA_PREP,
    varios: true,
    queSeEspera: "fotos, audios o PDF",
    onFicheros: (nuevos) => {
      setPrepFiles((prev) => [...prev, ...nuevos].slice(0, MAX_PREP));
      setErrorMsg(null);
    },
    onAviso: setErrorMsg,
  });

  const therapistName = patient?.therapist?.name ?? "—";
  const ta = "w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed";

  if (loadingPatient) return <div className="p-4 lg:p-8 text-sm text-neutral-400">Cargando…</div>;
  if (!patient) {
    return (
      <div className={anchoPantalla("listado")}>
        <div className="bg-white border border-neutral-100 rounded-xl p-10 text-center mt-5">
          <p className="text-sm text-neutral-600">Paciente no encontrado.</p>
          <Link href="/pacientes" className="text-xs text-[var(--color-primary,#1B3A2D)] hover:underline mt-2 inline-block">← Volver al listado</Link>
        </div>
      </div>
    );
  }

  const adjuntosPrep = (
    <div
      {...zonaPrep.props}
      className={`-mx-2 px-2 py-1.5 rounded-lg border border-dashed transition-colors ${
        zonaPrep.arrastrando ? "border-[var(--color-primary,#1B3A2D)] bg-neutral-50" : "border-transparent"
      }`}
    >
      <label className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline cursor-pointer">
        {zonaPrep.arrastrando ? "Suelta aquí los archivos" : "+ Adjuntar fotos, audio o PDF (o arrástralos aquí)"}
        <input
          type="file"
          multiple
          accept={ACEPTA_PREP}
          className="hidden"
          onChange={(e) => {
            const nuevos = Array.from(e.target.files ?? []);
            e.target.value = "";
            setPrepFiles((prev) => [...prev, ...nuevos].slice(0, MAX_PREP));
          }}
        />
      </label>
      {prepFiles.length > 0 && (
        <ul className="mt-2 space-y-1">
          {prepFiles.map((f, i) => (
            <li key={`${f.name}-${i}`} className="text-[11px] text-neutral-600 flex items-center gap-2">
              <span className="truncate">{f.name}</span>
              <span className="text-neutral-400 shrink-0">{fmtSize(f.size)}</span>
              <button
                onClick={() => setPrepFiles((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-rose-500 hover:text-rose-700 shrink-0"
              >
                quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-neutral-400 mt-1">
        Material interno del equipo: no se comparte con la familia.
      </p>
    </div>
  );

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      <nav className="flex items-center gap-1.5 text-xs text-neutral-500">
        <Link href="/pacientes" className="hover:text-[var(--color-primary,#1B3A2D)]">Pacientes</Link>
        <span className="text-neutral-300">/</span>
        <Link href={`/pacientes/${id}`} className="hover:text-[var(--color-primary,#1B3A2D)]">{patient.firstName} {patient.lastName}</Link>
        <span className="text-neutral-300">/</span>
        <span className="text-neutral-700">Nuevo registro</span>
      </nav>

      <input
        ref={fileRef}
        type="file"
        accept={ACEPTA_AUDIO}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setErrorMsg(null); } }}
      />

      {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}

      {/* ── FORM: el registro completo, en texto y con el audio opcional ── */}
      {state === STATE.FORM && (
        <>
          <div className="bg-white border border-neutral-100 rounded-xl p-5 lg:p-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="eyebrow mb-1">Nuevo registro de sesión</div>
                <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] tracking-tight">{patient.firstName} {patient.lastName}</h1>
                <p className="text-xs text-neutral-500 mt-1">{therapistName}</p>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">Día y hora de la sesión</div>
                <input type="datetime-local" className={ta} value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Audio, opcional. Dentro del registro y no como puerta de entrada
              (26/08/2026, Rodrigo): el registro se escribe; el audio, si lo
              hay, lo adelanta. */}
          <div
            {...zonaAudio.props}
            className={`bg-white rounded-xl p-4 lg:p-5 border transition-colors ${
              zonaAudio.arrastrando
                ? "border-2 border-dashed border-[var(--color-primary,#1B3A2D)] bg-neutral-50"
                : "border-neutral-100"
            }`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-white" style={{ background: "var(--color-primary, #1B3A2D)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-[var(--ink-900)]">
                  ¿Tienes audio de la sesión? <span className="font-normal text-neutral-400">(opcional)</span>
                  <HelpTooltip title="El audio no se guarda" className="ml-1.5 tracking-normal normal-case">
                    Sirve para sacar el texto y se descarta. En la sesión quedan la transcripción y la
                    duración, no la grabación: si quieres conservarla, guárdala tú. Lo que adjuntes en
                    «Preparación», en cambio, sí se queda con la sesión.
                  </HelpTooltip>
                </div>
                {!file ? (
                  <p className="text-[11px] text-neutral-500 mt-0.5">
                    {zonaAudio.arrastrando
                      ? "Suéltalo aquí."
                      : "Arrastra el audio aquí, pégalo con Ctrl+V o búscalo. La IA lo transcribe y rellena por ti los apartados vacíos del informe. m4a, mp3, wav, ogg, webm · máx. 25 MB."}
                  </p>
                ) : (
                  <p className="text-[11px] text-neutral-600 mt-0.5 truncate">
                    {file.name} · {fmtSize(file.size)}{result?.audioDurationSec != null ? ` · ${fmtDur(result.audioDurationSec)}` : ""}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                {!file && (
                  <button type="button" onClick={() => fileRef.current?.click()} className="text-xs font-medium px-3 py-2 rounded-lg border border-neutral-200 bg-white hover:border-neutral-400 text-neutral-700">
                    Añadir audio
                  </button>
                )}
                {file && !result && (
                  <>
                    <button type="button" onClick={quitarAudio} className="text-xs px-3 py-2 text-neutral-500 hover:underline">Quitar</button>
                    <button type="button" onClick={procesarAudio} className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2" style={{ background: "var(--color-primary, #1B3A2D)" }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                      Procesar con IA
                    </button>
                  </>
                )}
                {file && result && (
                  <button type="button" onClick={quitarAudio} className="text-xs px-3 py-2 text-neutral-500 hover:underline">Quitar audio</button>
                )}
              </div>
            </div>

            {avisoAudio && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-[11px] text-emerald-800">
                {avisoAudio}{result?.demo ? " (datos de demostración)" : ""}
              </div>
            )}
            {result?.transcription && (
              <div className="mt-3 border-t border-neutral-100 pt-3">
                <div className="eyebrow mb-1.5">Transcripción literal</div>
                <p className="text-xs text-neutral-600 leading-relaxed italic">«{result.transcription}»</p>
              </div>
            )}
          </div>

          {/* 1 · Preparación */}
          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 space-y-3">
            <div className="eyebrow">1 · Preparación</div>
            <p className="text-[10px] text-neutral-400 -mt-2">
              Lo que preparaste antes de la sesión. Se guarda con ella y sirve para redactar el informe.
            </p>
            <textarea
              className={ta}
              rows={3}
              placeholder="Material previsto, hipótesis de trabajo, qué observar…"
              value={form.prepText}
              onChange={(e) => setForm({ ...form, prepText: e.target.value })}
            />
            {adjuntosPrep}
          </div>

          {/* 2 · Informe */}
          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 space-y-4">
            <div className="eyebrow">2 · Informe de la sesión</div>
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

          {/* 3 · Devolución de la familia */}
          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 space-y-3">
            <div className="eyebrow">3 · Devolución de la familia</div>
            <p className="text-[10px] text-neutral-400 -mt-2">
              Lo que te han contado los padres al recoger: cómo ha ido la semana, qué han notado en casa.
            </p>
            <textarea
              className={ta}
              rows={3}
              placeholder="Qué dice la familia…"
              value={form.parentFeedback}
              onChange={(e) => setForm({ ...form, parentFeedback: e.target.value })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-end">
            <p className="text-[11px] text-neutral-500 mr-auto">
              ¿Todavía no la has dado?{" "}
              <button
                type="button"
                onClick={() => setState(STATE.PREPARING)}
                className="font-medium text-[var(--color-primary,#1B3A2D)] hover:underline"
              >
                Guárdala solo como preparación
              </button>
            </p>
            <button onClick={() => router.push(`/pacientes/${id}`)} disabled={saving} className="text-xs px-4 py-2 text-neutral-500 hover:underline disabled:opacity-50">Cancelar</button>
            <button
              onClick={guardarRegistro}
              disabled={saving || !hayContenido}
              title={!hayContenido ? "Escribe algo del registro (o procesa un audio) para poder guardarlo" : undefined}
              className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-50"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              {saving ? "Guardando…" : "Guardar registro"}
            </button>
          </div>
        </>
      )}

      {/* ── PREPARING: la sesión que aún no se ha dado (flujo intacto) ────── */}
      {state === STATE.PREPARING && (
        <div className="bg-white border border-neutral-100 rounded-xl p-6 lg:p-10">
          <div className="text-center mb-6">
            <div className="eyebrow mb-2">Preparar la sesión</div>
            <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] tracking-tight">{patient.firstName} {patient.lastName}</h1>
            <p className="text-xs text-neutral-500 mt-1">{therapistName}</p>
          </div>

          <div className="max-w-2xl mx-auto space-y-4">
            <p className="text-[11px] text-neutral-600 leading-relaxed bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2.5">
              Se guarda como <strong>borrador</strong>: queda apuntada en la ficha con lo que
              prepares, y el día de la sesión se completa encima —escribiéndola o con el audio.
              Mientras su fecha no haya llegado no cuenta como sesión dada.
            </p>

            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">Día y hora de la sesión</div>
              <input
                type="datetime-local"
                className={ta}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">Preparación</div>
              <textarea
                className={ta}
                rows={6}
                placeholder="Material previsto, hipótesis de trabajo, qué observar…"
                value={prepSolo}
                onChange={(e) => setPrepSolo(e.target.value)}
              />
            </div>

            {adjuntosPrep}

            <div className="flex flex-wrap gap-2 justify-end pt-1">
              <button onClick={() => router.push(`/pacientes/${id}`)} disabled={saving} className="text-xs px-4 py-2 text-neutral-500 hover:underline disabled:opacity-50">Cancelar</button>
              <button onClick={() => setState(STATE.FORM)} disabled={saving} className="text-xs px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 text-neutral-700 disabled:opacity-50">Hacer el registro completo</button>
              <button
                onClick={guardarPreparacion}
                disabled={saving || !prepSolo.trim()}
                title={!prepSolo.trim() ? "Escribe la preparación para poder guardarla" : undefined}
                className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-50"
                style={{ background: "var(--color-primary, #1B3A2D)" }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                {saving ? "Guardando…" : "Guardar preparación"}
              </button>
            </div>
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
