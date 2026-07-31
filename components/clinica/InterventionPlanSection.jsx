"use client";

/**
 * InterventionPlanSection — plan de intervención del paciente (sprint 2026-07-29).
 *
 * Recoge lo que antes vivía disperso o directamente no existía: diagnóstico,
 * motivo de consulta, información previa, objetivos, tipos de actividad y
 * metodologías. Y la SECUENCIACIÓN: cuántos informes de objetivos y cuántos
 * registros de sesión le tocan a ESTE paciente por trimestre escolar.
 *
 * El cumplimiento (hechos vs. previstos) lo calcula el servidor contando los
 * informes y sesiones reales, así que aquí solo se pinta: no hay contadores
 * que puedan decir una cosa distinta de lo que hay en la ficha.
 */

import { useCallback, useEffect, useState } from "react";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

/** Editor de una lista de textos (objetivos, actividades, metodologías). */
function ListaEditable({ etiqueta, valores, onChange, placeholder }) {
  const [borrador, setBorrador] = useState("");
  const anadir = () => {
    const v = borrador.trim();
    if (!v) return;
    if (!valores.includes(v)) onChange([...valores, v]);
    setBorrador("");
  };
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-neutral-400">{etiqueta}</label>
      <div className="mt-1 flex flex-wrap gap-1.5 mb-2">
        {valores.length === 0 && <span className="text-xs text-neutral-300">Sin definir</span>}
        {valores.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-100 text-[11px] text-neutral-700">
            {v}
            <button
              type="button"
              onClick={() => onChange(valores.filter((x) => x !== v))}
              className="text-neutral-400 hover:text-rose-600"
              aria-label={`Quitar ${v}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={borrador}
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); anadir(); } }}
          placeholder={placeholder}
          className={inputCls}
        />
        <button type="button" onClick={anadir} className="px-3 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 shrink-0">
          Añadir
        </button>
      </div>
    </div>
  );
}

function Cumplimiento({ datos }) {
  if (!datos?.trimestres?.length) return null;
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
          Seguimiento del curso {datos.curso}
        </div>
        <div className="text-[11px] text-neutral-400">
          {datos.previstos.informes} informe(s) y {datos.previstos.registros} registro(s) por trimestre
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {datos.trimestres.map((t) => {
          // `completo === null` = este paciente no tiene secuenciación puesta:
          // "0 de 0" no es un objetivo cumplido, es que no hay objetivo.
          const color =
            t.completo === null ? "border-neutral-200" : t.completo ? "border-emerald-300" : "border-amber-300";
          return (
            <div key={t.key} className={`rounded-lg border ${color} px-3 py-2.5`}>
              <div className="text-xs font-semibold text-neutral-700">{t.label}</div>
              <div className="mt-1.5 text-[11px] text-neutral-600 tabular-nums">
                Informes <strong>{t.informes.hechos}</strong>/{t.informes.previstos}
              </div>
              <div className="text-[11px] text-neutral-600 tabular-nums">
                Registros <strong>{t.registros.hechos}</strong>/{t.registros.previstos}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function InterventionPlanSection({ patientId, canEdit = true }) {
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState(null);
  const [cumplimiento, setCumplimiento] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [form, setForm] = useState({
    diagnosis: "", consultationReasons: "", previousInfo: "",
    objectives: [], activityTypes: [], methodologies: [],
    objectivesReportsPerTrimester: 0, sessionRecordsPerTrimester: 0,
  });

  const cargar = useCallback(() => {
    setCargando(true);
    fetch(`/api/pacientes/${patientId}/plan`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "No se pudo cargar el plan");
        const p = j.data.plan;
        setCumplimiento(j.data.cumplimiento);
        if (p) {
          setForm({
            diagnosis: p.diagnosis ?? "",
            consultationReasons: p.consultationReasons ?? "",
            previousInfo: p.previousInfo ?? "",
            objectives: p.objectives ?? [],
            activityTypes: p.activityTypes ?? [],
            methodologies: p.methodologies ?? [],
            objectivesReportsPerTrimester: p.reportSchedule?.objectivesReportsPerTrimester ?? 0,
            sessionRecordsPerTrimester: p.reportSchedule?.sessionRecordsPerTrimester ?? 0,
          });
        }
      })
      .catch((e) => setErr(e.message))
      .finally(() => setCargando(false));
  }, [patientId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function guardar() {
    setGuardando(true);
    setErr(null);
    setAviso(null);
    try {
      const res = await fetch(`/api/pacientes/${patientId}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          objectivesReportsPerTrimester: Number(form.objectivesReportsPerTrimester) || 0,
          sessionRecordsPerTrimester: Number(form.sessionRecordsPerTrimester) || 0,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar");
      setAviso("Plan guardado.");
      cargar(); // recalcula el cumplimiento con la secuenciación nueva
    } catch (e) {
      setErr(e.message);
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <div className="text-xs text-neutral-400">Cargando el plan…</div>;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-4">
      {err && <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</div>}
      {aviso && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{aviso}</div>}

      <Cumplimiento datos={cumplimiento} />

      <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Diagnóstico</label>
            <textarea rows={2} value={form.diagnosis} onChange={set("diagnosis")} disabled={!canEdit}
              className={`mt-1 ${inputCls}`} placeholder="Diagnóstico o hipótesis de trabajo" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Motivo de consulta</label>
            <textarea rows={2} value={form.consultationReasons} onChange={set("consultationReasons")} disabled={!canEdit}
              className={`mt-1 ${inputCls}`} placeholder="Por qué acude a consulta" />
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-neutral-400">Información previa</label>
          <textarea rows={3} value={form.previousInfo} onChange={set("previousInfo")} disabled={!canEdit}
            className={`mt-1 ${inputCls}`} placeholder="Informes anteriores, valoraciones externas, antecedentes relevantes…" />
        </div>

        <ListaEditable etiqueta="Objetivos" valores={form.objectives} placeholder="Atención sostenida"
          onChange={(v) => setForm({ ...form, objectives: v })} />
        <ListaEditable etiqueta="Tipos de actividad" valores={form.activityTypes} placeholder="Juego de reglas"
          onChange={(v) => setForm({ ...form, activityTypes: v })} />
        <ListaEditable etiqueta="Metodologías" valores={form.methodologies} placeholder="Autoinstrucciones"
          onChange={(v) => setForm({ ...form, methodologies: v })} />

        <div className="pt-2 border-t border-neutral-100">
          <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">
            Secuenciación por trimestre
          </div>
          <p className="text-[11px] text-neutral-400 mb-3 max-w-xl">
            Cuántos informes de objetivos y cuántos registros de sesión le corresponden a este
            paciente en CADA trimestre escolar. El curso va de septiembre a junio; el seguimiento
            de arriba cuenta solo lo que hay registrado de verdad.
          </p>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Informes</label>
              <input type="number" min="0" max="999" value={form.objectivesReportsPerTrimester} disabled={!canEdit}
                onChange={set("objectivesReportsPerTrimester")} className={`mt-1 ${inputCls}`} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Registros de sesión</label>
              <input type="number" min="0" max="999" value={form.sessionRecordsPerTrimester} disabled={!canEdit}
                onChange={set("sessionRecordsPerTrimester")} className={`mt-1 ${inputCls}`} />
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="flex justify-end pt-2">
            <button onClick={guardar} disabled={guardando}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
              style={{ background: "var(--color-primary, #1B3A2D)" }}>
              {guardando ? "Guardando…" : "Guardar plan"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
