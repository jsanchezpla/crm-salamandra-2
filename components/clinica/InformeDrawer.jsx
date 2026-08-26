"use client";

/**
 * InformeDrawer — el informe clínico se ESCRIBE aquí (31/07/2026).
 *
 * Hasta hoy este cajón solo mostraba lo que hubiera y, cuando no había nada,
 * decía que la redacción asistida por IA llegaría «en una fase posterior»: es
 * decir, que un informe no se podía redactar dentro del CRM. Ahora la
 * profesional escribe cada apartado y, si quiere, VUELCA el contenido de las
 * sesiones que elija (`/api/clinica/reports/[id]/desde-sesiones`).
 *
 * La IA llegará y partirá de esto mismo: primero se junta lo que dicen las
 * sesiones y luego, si acaso, se le pide que lo pula. Lo que no puede pasar es
 * que el CRM no sepa hacer un informe sin ella.
 *
 * (Componente propio y no dentro de la página: lo comparten la pantalla de
 * Informes y, en cuanto haga falta, la ficha del paciente.)
 */

import { useEffect, useState } from "react";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const STATUS_STYLES = {
  draft: { bg: "bg-neutral-100", text: "text-neutral-600", dot: "bg-neutral-400" },
  reviewed: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  delivered: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
};

const TA = "w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed";

/**
 * Los cinco apartados que salen del volcado de sesiones y que, por tanto, puede
 * redactar la IA. Los otros dos —motivo de intervención y propuesta de
 * continuidad— los escribe la profesional y NI SIQUIERA se le mandan al modelo
 * (ver lib/clinica/pulirInforme.js).
 */
const CLAVES_IA = ["objectives", "evolution", "achievements", "persistentDifficulties", "recommendations"];
const NOMBRES_IA = {
  objectives: "Objetivos de trabajo",
  evolution: "Evolución",
  achievements: "Logros",
  persistentDifficulties: "Dificultades que persisten",
  recommendations: "Recomendaciones",
};

function Campo({ label, ayuda, children }) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      {ayuda && <p className="text-[10px] text-neutral-400 mb-1.5">{ayuda}</p>}
      {children}
    </div>
  );
}

export default function InformeDrawer({ report, onClose, onDeliver, onGuardado, busy }) {
  const patient = report.patient ?? { name: "—", age: null };
  const therapist = report.therapist ?? { name: "—" };
  const c = report.contentSections ?? {};
  const entregado = report.status === "delivered";

  // El informe de beca (NEAE) solo lleva tres apartados y la firma: motivo de
  // consulta (el mismo dato que «motivo de intervención», con el rótulo de la
  // convocatoria), objetivos y metodología. El resto de campos y el bloque de
  // volcado/IA se esconden en ese tipo (lib/clinica/beca.js).
  const esBeca = report.type === "beca";

  const [form, setForm] = useState({
    motiveOfIntervention: c.motiveOfIntervention ?? "",
    objectives: (c.objectives ?? []).join("\n"),
    evolution: (c.evolution ?? []).join("\n"),
    achievements: (c.achievements ?? []).join("\n"),
    persistentDifficulties: (c.persistentDifficulties ?? []).join("\n"),
    recommendations: (c.recommendations ?? []).join("\n"),
    continuityProposal: c.continuityProposal ?? "",
    referralSpecialty: c.referralSpecialty ?? "",
    methodology: c.methodology ?? "",
    // Anexar al PDF los registros literales de las sesiones (26/08/2026,
    // Rodrigo): apagado por defecto — el informe es la redacción; de las
    // sesiones, el PDF solo dice las fechas.
    anexarRegistros: c.anexarRegistros === true,
  });
  const [sesiones, setSesiones] = useState([]);
  const [elegidas, setElegidas] = useState(new Set(c.sourceSessionIds ?? []));
  const [derivaciones, setDerivaciones] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  // La propuesta de la IA vive SOLO aquí hasta que la profesional la acepta: el
  // endpoint no guarda nada (ver app/api/clinica/reports/[id]/pulir/route.js).
  const [puliendo, setPuliendo] = useState(false);
  const [propuesta, setPropuesta] = useState(null);
  const [avisosIa, setAvisosIa] = useState([]);
  const [simulado, setSimulado] = useState(false);

  // Solo tiene sentido pulir lo que ya está volcado: la IA redacta anotaciones,
  // no las inventa. Con los cinco apartados vacíos el botón no hace nada útil.
  const hayQuePulir = CLAVES_IA.some((k) => (form[k] ?? "").trim().length > 0);

  useEffect(() => {
    // Solo las sesiones COMPLETADAS: un borrador a medias no es material para
    // un informe que firma la profesional.
    fetch(`/api/clinica/sessions?patientId=${report.patientId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setSesiones((j?.data?.sessions ?? []).filter((s) => s.status === "registered" || s.status === "published")))
      .catch(() => {});
    if (report.type === "referral") {
      fetch("/api/clinica/derivaciones", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => setDerivaciones(j?.data?.especialidades ?? []))
        .catch(() => {});
    }
  }, [report.patientId, report.type]);

  const lineas = (v) => v.split("\n").map((x) => x.trim()).filter(Boolean);

  async function guardar() {
    setGuardando(true);
    setErrorMsg(null);
    setAviso(null);
    try {
      const r = await fetch(`/api/clinica/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentSections: {
            ...c,
            motiveOfIntervention: form.motiveOfIntervention.trim(),
            objectives: lineas(form.objectives),
            evolution: lineas(form.evolution),
            achievements: lineas(form.achievements),
            persistentDifficulties: lineas(form.persistentDifficulties),
            recommendations: lineas(form.recommendations),
            continuityProposal: form.continuityProposal.trim(),
            referralSpecialty: form.referralSpecialty || "",
            methodology: form.methodology.trim(),
            anexarRegistros: !!form.anexarRegistros,
            sourceSessionIds: [...elegidas],
          },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar");
      setAviso("Informe guardado.");
      onGuardado?.();
      return true;
    } catch (e) {
      setErrorMsg(e.message);
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function volcarSesiones() {
    if (elegidas.size === 0) {
      setErrorMsg("Marca las sesiones que quieres volcar al informe.");
      return;
    }
    setGuardando(true);
    setErrorMsg(null);
    setAviso(null);
    try {
      const r = await fetch(`/api/clinica/reports/${report.id}/desde-sesiones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionIds: [...elegidas] }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo redactar");
      const nc = j.data.contentSections ?? {};
      setForm((f) => ({
        ...f,
        objectives: (nc.objectives ?? []).join("\n"),
        evolution: (nc.evolution ?? []).join("\n"),
        achievements: (nc.achievements ?? []).join("\n"),
        persistentDifficulties: (nc.persistentDifficulties ?? []).join("\n"),
        recommendations: (nc.recommendations ?? []).join("\n"),
      }));
      const a = j.data.aporte ?? {};
      // Decir QUÉ ha traído: si no, se pulsa el botón, la pantalla cambia poco
      // y parece que no ha hecho nada.
      setAviso(
        `Volcadas ${a.sesiones} sesiones: ${a.evolucion ?? 0} líneas de evolución, ${a.objetivos ?? 0} objetivos, ` +
          `${a.dificultades ?? 0} dificultades y ${a.recomendaciones ?? 0} recomendaciones. Repásalo antes de enviarlo.`
      );
      onGuardado?.();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setGuardando(false);
    }
  }

  /**
   * Pide la redacción asistida. Lo que vuelve NO se guarda ni se mete en el
   * formulario: se enseña aparte para que la profesional compare. Se le manda
   * lo que hay en pantalla ahora mismo —no lo último guardado— para que pula lo
   * que está viendo.
   */
  async function pulirConIa() {
    setPuliendo(true);
    setErrorMsg(null);
    setAviso(null);
    try {
      // Si tiene cambios sin guardar, se guardan primero: el endpoint lee el
      // informe de la base de datos, y pulir la versión de ayer confunde más
      // que ayuda. Si el guardado falla, no se sigue: se pediría la redacción
      // de un texto que no es el que ella está viendo.
      if (!(await guardar())) return;
      const r = await fetch(`/api/clinica/reports/${report.id}/pulir`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo redactar");
      setPropuesta(j.data.propuesta ?? null);
      setAvisosIa(j.data.avisos ?? []);
      setSimulado(!!j.data.simulado);
      setAviso(null);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setPuliendo(false);
    }
  }

  /** Acepta un apartado: pasa al formulario, y de ahí solo sale con «Guardar». */
  function aceptarApartado(clave) {
    const lineas = propuesta?.[clave];
    if (!Array.isArray(lineas)) return;
    setForm((f) => ({ ...f, [clave]: lineas.join("\n") }));
    setPropuesta((p) => {
      const resto = { ...p };
      delete resto[clave];
      return Object.keys(resto).length ? resto : null;
    });
    setAviso(`«${NOMBRES_IA[clave] ?? clave}» actualizado con la propuesta. Recuerda guardar.`);
  }

  function aceptarTodo() {
    if (!propuesta) return;
    setForm((f) => {
      const n = { ...f };
      for (const [clave, lineas] of Object.entries(propuesta)) {
        if (Array.isArray(lineas)) n[clave] = lineas.join("\n");
      }
      return n;
    });
    setPropuesta(null);
    setAviso("Informe actualizado con la propuesta. Repásalo y guarda.");
  }

  const st = STATUS_STYLES[report.status] ?? STATUS_STYLES.draft;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />
      <aside className="fixed right-0 top-14 lg:top-0 bottom-0 z-50 w-full sm:w-[720px] bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-neutral-100 px-5 lg:px-7 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <div className="eyebrow">Informe {String(report.typeLabel ?? "").toLowerCase()}</div>
            <h2 className="font-display text-xl text-[var(--ink-900)] mt-1 leading-tight">
              {patient.name} <span className="text-neutral-400 font-normal">· {patient.age ?? "—"} años</span>
            </h2>
            <p className="text-[11px] text-neutral-500 mt-1">{therapist.name} · {fmtDate(report.reportDate)}</p>
          </div>
          <button onClick={onClose} className="shrink-0 text-neutral-400 hover:text-neutral-700 p-1 -m-1" aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 lg:px-7 py-5 space-y-5">
          {entregado && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2.5 text-[11px] text-emerald-900">
              Este informe ya está en el área privada de la familia. Si lo cambias, vuelve a
              enviarlo para que tengan la versión buena.
            </div>
          )}

          {esBeca && (
            <div className="bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2.5 text-[11px] text-neutral-600">
              Este informe es el de la <span className="font-medium">beca de apoyo educativo</span>: lleva
              solo motivo de consulta, objetivos y metodología, y en el PDF la cabecera dice el
              servicio con su nombre oficial («Reeducación del lenguaje» o «Reeducación pedagógica
              y habilidades sociales») y la firma del terapeuta al pie.
            </div>
          )}

          {/* ── Volcar el contenido de las sesiones (en la beca no aplica) ── */}
          {!esBeca && (
          <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4">
            <div className="eyebrow mb-1">Redactar con las sesiones</div>
            <p className="text-[11px] text-neutral-500 mb-3">
              Marca las sesiones y el informe se rellena con lo que se escribió en ellas: objetivos,
              evolución con su fecha, incidencias y tareas. No pisa lo que ya hayas escrito.
            </p>

            {sesiones.length === 0 ? (
              <p className="text-[11px] text-neutral-400">Este paciente todavía no tiene sesiones registradas.</p>
            ) : (
              <div className="max-h-44 overflow-y-auto border border-neutral-200 rounded-lg bg-white divide-y divide-neutral-50">
                {sesiones.map((se) => {
                  const marcada = elegidas.has(se.id);
                  return (
                    <label key={se.id} className="flex items-start gap-2 px-2.5 py-2 cursor-pointer hover:bg-neutral-50">
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={() =>
                          setElegidas((prev) => {
                            const n = new Set(prev);
                            if (n.has(se.id)) n.delete(se.id);
                            else n.add(se.id);
                            return n;
                          })
                        }
                        className="mt-0.5 w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]"
                      />
                      <span className="min-w-0">
                        <span className="block text-[11px] text-neutral-700">
                          {fmtDate(se.sessionDate)} · {se.statusLabel}
                        </span>
                        <span className="block text-[10px] text-neutral-400 truncate">{se.preview || "Sin resumen"}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={volcarSesiones}
                disabled={guardando || entregado || sesiones.length === 0}
                className="text-xs font-medium px-3 py-2 rounded-lg text-white disabled:opacity-40"
                style={{ background: "var(--color-primary, #1B3A2D)" }}
              >
                {guardando ? "Trabajando…" : `Volcar ${elegidas.size || "las"} sesion${elegidas.size === 1 ? "" : "es"} al informe`}
              </button>
              <button
                onClick={pulirConIa}
                disabled={guardando || puliendo || entregado || !hayQuePulir}
                title={hayQuePulir ? "" : "Vuelca antes las sesiones: la IA redacta lo volcado, no lo inventa"}
                className="text-xs font-medium px-3 py-2 rounded-lg border border-neutral-300 text-neutral-700 hover:border-neutral-500 disabled:opacity-40"
              >
                {puliendo ? "Redactando…" : "Redactar con IA"}
              </button>
            </div>
            <p className="text-[10px] text-neutral-400 mt-2">
              Cada línea sale literal de un registro de sesión, con su fecha delante: aquí no se
              inventa nada. «Redactar con IA» convierte ese volcado en prosa y te lo enseña al
              lado para que decidas apartado por apartado — no escribe nada por su cuenta.
              El volcado es material de trabajo: <span className="font-medium text-neutral-500">al
              PDF va lo que dejes escrito en los apartados</span>, y de las sesiones solo sus
              fechas (periodo y en cuáles se basa).
            </p>

            {/* El anexo literal, opt-in (26/08/2026, Rodrigo): el informe
                principal es la redacción; los registros completos, solo si se
                piden, en páginas aparte al final del PDF. */}
            <label className="mt-3 flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.anexarRegistros}
                onChange={(e) => setForm((f) => ({ ...f, anexarRegistros: e.target.checked }))}
                className="mt-0.5 w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]"
              />
              <span className="text-[11px] text-neutral-600 leading-snug">
                <span className="font-medium">Anexar al PDF los registros literales</span> de las
                sesiones marcadas, en páginas aparte al final. La preparación no va: es material
                interno.
              </span>
            </label>
          </div>
          )}

          {/* ── La propuesta de la IA, al lado de lo que hay ── */}
          {propuesta && (
            <div className="border border-neutral-300 rounded-lg overflow-hidden">
              <div className="bg-neutral-100 px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="eyebrow">Propuesta de redacción{simulado ? " (simulada — demo)" : ""}</div>
                  <p className="text-[10px] text-neutral-500 mt-0.5">
                    Nada de esto está guardado. Acepta lo que te sirva y repásalo antes de enviarlo.
                  </p>
                </div>
                <button
                  onClick={() => setPropuesta(null)}
                  className="shrink-0 text-[11px] text-neutral-500 hover:text-neutral-800"
                >
                  Descartar
                </button>
              </div>

              {avisosIa.length > 0 && (
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-[10px] text-amber-800 space-y-0.5">
                  {avisosIa.map((a, i) => <p key={i}>{a}</p>)}
                </div>
              )}

              <div className="divide-y divide-neutral-100">
                {Object.entries(propuesta).map(([clave, lineas]) => (
                  <div key={clave} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <span className="text-[11px] font-medium text-neutral-700">{NOMBRES_IA[clave] ?? clave}</span>
                      <button
                        onClick={() => aceptarApartado(clave)}
                        className="shrink-0 text-[11px] font-medium px-2 py-1 rounded-md border border-neutral-300 text-neutral-700 hover:border-neutral-500"
                      >
                        Usar este texto
                      </button>
                    </div>
                    <div className="text-[11px] text-neutral-600 leading-relaxed space-y-1">
                      {lineas.map((l, i) => <p key={i}>{l}</p>)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-4 py-2.5 bg-neutral-50 border-t border-neutral-100 flex justify-end">
                <button
                  onClick={aceptarTodo}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-lg text-white"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}
                >
                  Usar todos los apartados
                </button>
              </div>
            </div>
          )}

          {/* ── El informe ── */}
          {report.type === "referral" && derivaciones.length > 0 && (
            <Campo label="Especialidad de destino">
              <select
                className={TA}
                value={form.referralSpecialty}
                onChange={(e) => setForm((f) => ({ ...f, referralSpecialty: e.target.value }))}
              >
                <option value="">Sin especificar</option>
                {derivaciones.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            </Campo>
          )}

          <Campo label={esBeca ? "Motivo de consulta" : "Motivo de intervención"}>
            <textarea rows={3} className={TA} value={form.motiveOfIntervention}
              onChange={(e) => setForm((f) => ({ ...f, motiveOfIntervention: e.target.value }))} />
          </Campo>
          <Campo label={esBeca ? "Objetivos" : "Objetivos terapéuticos"} ayuda="Uno por línea.">
            <textarea rows={3} className={TA} value={form.objectives}
              onChange={(e) => setForm((f) => ({ ...f, objectives: e.target.value }))} />
          </Campo>
          {esBeca && (
            <Campo label="Metodología" ayuda="Cómo se trabaja con el paciente: enfoque, técnicas y frecuencia.">
              <textarea rows={5} className={TA} value={form.methodology}
                onChange={(e) => setForm((f) => ({ ...f, methodology: e.target.value }))} />
            </Campo>
          )}
          {!esBeca && (
            <>
              <Campo label="Evolución observada" ayuda="Un párrafo por línea; lo volcado viene con su fecha delante.">
                <textarea rows={7} className={TA} value={form.evolution}
                  onChange={(e) => setForm((f) => ({ ...f, evolution: e.target.value }))} />
              </Campo>
              <Campo label="Logros alcanzados" ayuda="Uno por línea.">
                <textarea rows={3} className={TA} value={form.achievements}
                  onChange={(e) => setForm((f) => ({ ...f, achievements: e.target.value }))} />
              </Campo>
              <Campo label="Dificultades que persisten" ayuda="Una por línea.">
                <textarea rows={3} className={TA} value={form.persistentDifficulties}
                  onChange={(e) => setForm((f) => ({ ...f, persistentDifficulties: e.target.value }))} />
              </Campo>
              <Campo label="Recomendaciones" ayuda="Una por línea.">
                <textarea rows={3} className={TA} value={form.recommendations}
                  onChange={(e) => setForm((f) => ({ ...f, recommendations: e.target.value }))} />
              </Campo>
              <Campo label="Propuesta de continuidad">
                <textarea rows={3} className={TA} value={form.continuityProposal}
                  onChange={(e) => setForm((f) => ({ ...f, continuityProposal: e.target.value }))} />
              </Campo>
            </>
          )}

          {aviso && <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{aviso}</div>}
          {errorMsg && <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{errorMsg}</div>}

          <div className="border-t border-neutral-100 pt-4 flex flex-wrap gap-2 items-center">
            <span className={`inline-flex items-center gap-1.5 ${st.bg} ${st.text} text-[10px] font-medium px-2 py-0.5 rounded-full`}>
              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
              {report.statusLabel}
            </span>
            {/*
              VER EL PDF SIN MANDÁRSELO A NADIE (26/08/2026, Jorge).

              Hasta hoy el PDF solo nacía al pulsar «Enviar al paciente», que
              además lo publica en el área privada de la familia: la única forma
              de ver cómo queda un informe era entregárselo a alguien de verdad.
              Se nota en los números — en Aumenta hay 22.045 sesiones y CERO
              informes, y pidieron rediseñar un PDF que allí no ha visto nadie.

              Va ANTES de «Guardar» y de «Enviar», que es el orden en que se
              usan: mirar, corregir, mandar. Y abre en pestaña nueva para no
              perder lo que se esté escribiendo en este cajón.
            */}
            <a
              href={`/api/clinica/reports/${report.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              title="Abre el PDF de lo ÚLTIMO GUARDADO, en una pestaña nueva. No lo envía a nadie."
              className="ml-auto text-xs px-3 py-2 rounded-lg border border-neutral-200 text-neutral-700 hover:border-neutral-400"
            >
              Ver PDF
            </a>
            <button
              onClick={guardar}
              disabled={guardando}
              className="text-xs px-3 py-2 rounded-lg border border-neutral-200 text-neutral-700 hover:border-neutral-400 disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar informe"}
            </button>
            <button
              onClick={() => onDeliver(report.id)}
              disabled={busy || guardando}
              className="text-xs px-3 py-2 rounded-lg text-white hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              {busy ? "Enviando…" : entregado ? "Volver a enviar" : "Enviar al paciente"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
