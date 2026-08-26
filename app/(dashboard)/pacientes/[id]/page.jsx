"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import Select from "@/components/ui/Select.jsx";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import PatientBillingSection from "@/components/billing/PatientBillingSection.jsx";
import SpecialtyPicker from "@/components/clinica/SpecialtyPicker.jsx";
import TerapeutasPicker from "@/components/clinica/TerapeutasPicker.jsx";
import NuevaCoordinacionModal from "../../../../components/clinica/NuevaCoordinacionModal.jsx";
import PatientDocumentsSection from "@/components/clinica/PatientDocumentsSection.jsx";
import PatientExternalContactsSection from "@/components/clinica/PatientExternalContactsSection.jsx";
import InterventionPlanSection from "@/components/clinica/InterventionPlanSection.jsx";
import PreviewBanner from "../../clinica/_components/PreviewBanner.jsx";
import { REPORT_TYPES, REPORT_TYPE_LABEL } from "@/lib/clinica/serialize.js";
import { SPECIALTY_LABEL } from "@/lib/clinica/specialties.js";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";
import { enlaceDeVuelta } from "@/lib/clients/volver.js";

const REPORT_TYPE_OPTIONS = REPORT_TYPES.map((value) => ({ value, label: REPORT_TYPE_LABEL[value] }));

/**
 * El formulario de «Nuevo informe», vacío. UNA SOLA COPIA, a propósito.
 *
 * Los TRES sitios que lo reinician —el estado inicial, el botón de la cabecera y
 * el «después de crear»— tienen que dejarlo con los MISMOS campos. Cuando no fue
 * así, del 31/07/2026 al 26/08/2026, el botón lo dejaba con dos de los cuatro, el
 * modal leía sourceSessionIds.length sobre un undefined y la ficha ENTERA se caía
 * con el cartel de fábrica de Next, «This page couldn't load». Estuvo roto 26
 * días: en ese tiempo Aumenta no consiguió crear ni un informe, con 22.045
 * sesiones registradas.
 *
 * Es una función y no un objeto suelto porque sourceSessionIds es un array que el
 * modal muta: compartir la misma instancia arrastraría la selección de un informe
 * al siguiente.
 *
 * Lo vigila scripts/_smoke-informe-formulario.mjs.
 */
const informeVacio = () => ({ reportType: "evolution", dueDate: "", sourceSessionIds: [], referralSpecialty: "" });

const TABS = [
  { key: "resumen", label: "Resumen" },
  { key: "plan", label: "Plan" },
  { key: "sesiones", label: "Sesiones" },
  { key: "informes", label: "Informes" },
  { key: "coordinaciones", label: "Coordinaciones" },
  { key: "documentos", label: "Documentos" },
];

const PATIENT_STATUS = {
  active: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  paused: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  discharged: { bg: "bg-neutral-100", text: "text-neutral-500", dot: "bg-neutral-400" },
};
const SESSION_STATUS = {
  draft: { bg: "bg-neutral-100", text: "text-neutral-600", dot: "bg-neutral-400" },
  registered: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  ai_pending: { bg: "bg-sky-50", text: "text-sky-700", dot: "bg-sky-500" },
  published: { bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500" },
};
const pStatus = (s) => PATIENT_STATUS[s] ?? PATIENT_STATUS.discharged;
const sStatus = (s) => SESSION_STATUS[s] ?? SESSION_STATUS.registered;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const inputCls = "w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400";

const CITA_STATUS = { pending: "Pendiente", confirmed: "Confirmada", completed: "Realizada", cancelled: "Cancelada", no_show: "No asistió" };

function Section({ title, children }) {
  return (<div><div className="eyebrow mb-2">{title}</div><div className="text-xs text-neutral-700 leading-relaxed">{children}</div></div>);
}
function SubField({ label, value }) {
  return (<div><div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-0.5">{label}</div><div className="text-xs text-neutral-700">{value || "—"}</div></div>);
}
function Field({ label, value }) {
  return (<div><div className="text-[10px] uppercase tracking-wider text-neutral-400">{label}</div><div className="text-xs text-[var(--ink-900)] font-medium mt-0.5">{value || "—"}</div></div>);
}

function SessionDrawer({ session, patient, onClose, onPublish, onSaved, busy }) {
  const ss = sStatus(session.status);
  // Partes 1 y 3 del registro (sprint 2026-07, punto 4): la preparación se
  // escribe antes de la sesión y la devolución de la familia llega a veces
  // días después, así que se pueden rellenar aquí en cualquier momento.
  const [editando, setEditando] = useState(false);
  const [prepText, setPrepText] = useState(session.prepText ?? "");
  const [parentFeedback, setParentFeedback] = useState(session.parentFeedback ?? "");
  const [guardando, setGuardando] = useState(false);
  const [errorPartes, setErrorPartes] = useState(null);

  async function guardarPartes() {
    setGuardando(true);
    setErrorPartes(null);
    try {
      const r = await fetch(`/api/clinica/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prepText, parentFeedback }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar");
      setEditando(false);
      onSaved?.();
    } catch (e) {
      setErrorPartes(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function subirAdjunto(file) {
    if (!file) return;
    setGuardando(true);
    setErrorPartes(null);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const r = await fetch(`/api/clinica/sessions/${session.id}/prep-files`, { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo subir el archivo");
      onSaved?.();
    } catch (e) {
      setErrorPartes(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function borrarAdjunto(fileId) {
    if (!window.confirm("¿Quitar este adjunto de la preparación?")) return;
    setGuardando(true);
    try {
      const r = await fetch(`/api/clinica/sessions/${session.id}/prep-files/${fileId}`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) throw new Error("No se pudo borrar");
      onSaved?.();
    } catch (e) {
      setErrorPartes(e.message);
    } finally {
      setGuardando(false);
    }
  }

  const ta = "w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed";

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />
      <aside className="fixed right-0 top-14 lg:top-0 bottom-0 z-50 w-full sm:w-[640px] bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-neutral-100 px-5 lg:px-7 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <div className="eyebrow">Sesión</div>
            <h2 className="font-display text-xl text-[var(--ink-900)] mt-1 leading-tight">{fmtDateTime(session.sessionDate)}</h2>
            <p className="text-[11px] text-neutral-500 mt-1">{patient.firstName} {patient.lastName} · {session.therapist?.name ?? "—"} · {session.duration ?? "—"} min</p>
          </div>
          <button onClick={onClose} className="shrink-0 text-neutral-400 hover:text-neutral-700 p-1 -m-1" aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-5 lg:px-7 py-5 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 ${ss.bg} ${ss.text} text-[11px] font-medium px-2.5 py-1 rounded-full`}>
              <span className={`w-1.5 h-1.5 rounded-full ${ss.dot}`} />{session.statusLabel}
            </span>
            {session.audioDurationSec != null && (
              <span className="text-[10px] tabular text-neutral-500 bg-neutral-50 border border-neutral-100 rounded-lg px-2.5 py-1">
                Audio · {Math.floor(session.audioDurationSec / 60)}:{String(session.audioDurationSec % 60).padStart(2, "0")}
              </span>
            )}
          </div>

          {session.aiReviewedAt && (
            <div className="bg-sky-50 border border-sky-100 rounded-lg px-3 py-2.5 flex items-start gap-2.5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 text-sky-700 mt-0.5 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
              <p className="text-[11px] text-sky-900 leading-relaxed flex-1"><span className="font-semibold">Transcrito y estructurado por IA.</span> Revisado el {fmtDate(session.aiReviewedAt)}.</p>
            </div>
          )}

          {session.objectives?.length > 0 && (
            <Section title="Objetivos trabajados"><div className="flex flex-wrap gap-1.5">{session.objectives.map((o) => <span key={o} className="text-[11px] bg-neutral-100 text-neutral-700 px-2 py-0.5 rounded-full">{o}</span>)}</div></Section>
          )}
          {session.activities && <Section title="Actividades realizadas"><p>{session.activities}</p></Section>}
          {session.performance && <Section title="Desempeño del paciente"><p>{session.performance}</p></Section>}
          <Section title="Observaciones">
            <div className="space-y-3">
              <SubField label="Comentarios familiares" value={session.observations.familyComments} />
              <SubField label="Próximas sesiones" value={session.observations.nextSessionNotes} />
              <SubField label="Tareas para casa" value={session.observations.homeworkTasks} />
              <SubField label="Incidencias" value={session.observations.incidents} />
            </div>
          </Section>

          {/* ── Registro en 3 partes: preparación y devolución de la familia ── */}
          <div className="border-t border-neutral-100 pt-4 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="eyebrow">Preparación y devolución</div>
              {!editando && (
                <button onClick={() => setEditando(true)} className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline">
                  {session.prepText || session.parentFeedback ? "Editar" : "Añadir"}
                </button>
              )}
            </div>

            {editando ? (
              <div className="space-y-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Preparación previa</div>
                  <textarea className={ta} rows={3} value={prepText} onChange={(e) => setPrepText(e.target.value)} placeholder="Material previsto, hipótesis de trabajo…" />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Devolución de la familia</div>
                  <textarea className={ta} rows={3} value={parentFeedback} onChange={(e) => setParentFeedback(e.target.value)} placeholder="Qué cuentan los padres…" />
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={guardarPartes} disabled={guardando} className="text-xs font-medium px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>
                    {guardando ? "Guardando…" : "Guardar"}
                  </button>
                  <button
                    onClick={() => { setEditando(false); setPrepText(session.prepText ?? ""); setParentFeedback(session.parentFeedback ?? ""); }}
                    className="text-xs text-neutral-500"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <SubField label="Preparación previa" value={session.prepText} />
                <SubField label="Devolución de la familia" value={session.parentFeedback} />
              </div>
            )}

            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">
                Material de preparación <span className="normal-case tracking-normal">(interno, no lo ve la familia)</span>
              </div>
              {session.prepFiles?.length > 0 ? (
                <ul className="space-y-1 mb-2">
                  {session.prepFiles.map((f) => (
                    <li key={f.id} className="text-[11px] flex items-center gap-2">
                      <a
                        href={`/api/clinica/sessions/${session.id}/prep-files/${f.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--color-primary,#1B3A2D)] hover:underline truncate"
                      >
                        {f.name}
                      </a>
                      <button onClick={() => borrarAdjunto(f.id)} disabled={guardando} className="text-rose-500 hover:text-rose-700 shrink-0 disabled:opacity-40">
                        quitar
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-neutral-400 mb-2">Sin adjuntos.</p>
              )}
              <label className={`text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline cursor-pointer ${guardando ? "opacity-40 pointer-events-none" : ""}`}>
                + Adjuntar foto, audio o PDF
                <input
                  type="file"
                  accept="image/*,audio/*,application/pdf"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; subirAdjunto(f); }}
                />
              </label>
            </div>

            {errorPartes && <div className="text-[11px] text-rose-600">{errorPartes}</div>}
          </div>

          <div className="border-t border-neutral-100 pt-4 flex flex-wrap gap-2">
            {session.status !== "published" && (
              <button onClick={() => onPublish(session.id)} disabled={busy} className="text-xs px-3 py-2 rounded-lg text-white hover:opacity-90 ml-auto disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>
                {busy ? "Guardando…" : "Marcar como publicada"}
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

export default function PacienteFichaPage() {
  const params = useParams();
  const id = params.id;
  // De dónde se llegó a esta ficha, para que la flecha vuelva ahí. Sin "desde"
  // en la URL sale el listado de siempre, así que abrir una ficha por las bravas
  // se comporta igual que hasta hoy.
  const query = useSearchParams();
  const vuelta = enlaceDeVuelta(query.get("desde"), query.get("carpeta"), {
    href: "/pacientes",
    texto: "Pacientes",
  });
  const [patient, setPatient] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [reports, setReports] = useState([]);
  const [coordinations, setCoordinations] = useState([]);
  const [citas, setCitas] = useState([]);
  const [therapists, setTherapists] = useState([]); // equipo, para asignar terapeuta
  // Contrato de la FAMILIA (vive en el cliente pagador desde el sprint 2026-07,
  // punto 1.1). La ficha del paciente solo lo muestra; se sube en la del cliente.
  const [familyContract, setFamilyContract] = useState(null);
  // Alta de coordinación desde la propia ficha (sprint 2026-07, punto 7).
  const [nuevaCoordinacion, setNuevaCoordinacion] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState("resumen");
  const [openSession, setOpenSession] = useState(null);
  const [busy, setBusy] = useState(false);

  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [showReport, setShowReport] = useState(false);
  // `sourceSessionIds`: qué registros de sesión alimentan el informe evolutivo
  // (sprint 2026-07, punto 3.1). Selección LIBRE: el trimestre natural no
  // siempre es el que toca —hubo bajas, se recuperaron sesiones— y quien sabe
  // cuáles cuentan es la terapeuta.
  const [reportForm, setReportForm] = useState(informeVacio());
  // Catálogo de derivación del centro (editable por cliente desde 2026-07-31).
  const [derivaciones, setDerivaciones] = useState([]);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/pacientes/${id}`, { cache: "no-store" }).then((r) => (r.status === 404 ? "404" : r.json())),
      fetch(`/api/clinica/sessions?patientId=${id}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/clinica/reports?patientId=${id}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/clinica/coordinations?patientId=${id}`, { cache: "no-store" }).then((r) => r.json()),
      // Citas del paciente. Resiliente: si el tenant no tiene módulo citas (403)
      // o falla, se ignora y la ficha sigue funcionando.
      fetch(`/api/citas/bookings?patientId=${id}&limit=100`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([pj, sj, rj, cj, bj]) => {
        if (pj === "404" || !pj?.ok) { setNotFound(true); return; }
        setPatient(pj.data);
        setSessions(sj?.data?.sessions ?? []);
        setReports(rj?.data?.reports ?? []);
        setCoordinations(cj?.data?.coordinations ?? []);
        setCitas(bj?.data?.bookings ?? []);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Contrato de la familia. Resiliente: sin cliente pagador enlazado, o si el
  // tenant no tiene el archivo de documentos, se queda en null y la ficha lo dice.
  useEffect(() => {
    const clientId = patient?.clientId;
    if (!clientId) { setFamilyContract(null); return; }
    let alive = true;
    fetch(`/api/clients/${clientId}/contract`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setFamilyContract(j?.data ?? null))
      .catch(() => {});
    return () => { alive = false; };
  }, [patient?.clientId]);

  useEffect(() => {
    fetch("/api/clinica/derivaciones", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setDerivaciones(j?.data?.especialidades ?? []))
      .catch(() => {});
  }, []);

  // Equipo (para asignar/cambiar el terapeuta del paciente). Resiliente: si el
  // tenant no tiene módulo team (403) queda vacío y no se muestra el selector.
  useEffect(() => {
    fetch(`/api/team?status=active&limit=200`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setTherapists(j?.data?.members ?? []))
      .catch(() => {});
  }, []);

  const publishSession = async (sid) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/clinica/sessions/${sid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "published" }) });
      if (!r.ok) throw new Error();
      setOpenSession(null);
      load();
    } catch { /* noop */ } finally { setBusy(false); }
  };


  const openEdit = () => {
    setEditForm({
      firstName: patient.firstName ?? "", lastName: patient.lastName ?? "", age: patient.age ?? "",
      educationCenter: patient.educationCenter ?? "", educationLevel: patient.educationLevel ?? "",
      attendanceFrequency: patient.attendanceFrequency ?? "", referralReason: patient.referralReason ?? "",
      referredBy: patient.referredBy ?? "", objectives: (patient.objectives ?? []).join(", "), status: patient.status ?? "active",
      specialties: patient.specialties ?? [],
      // La lista completa, el de referencia el primero. Si el servidor no la
      // manda (`null` = «no me la han resuelto»), se cae al de siempre para no
      // enseñar «sin terapeuta» sobre un paciente que sí tiene uno.
      therapists: Array.isArray(patient.therapists)
        ? patient.therapists.map((t) => ({ id: t.teamMemberId, specialty: t.specialty ?? null }))
        : patient.mainTherapistId
          ? [{ id: patient.mainTherapistId, specialty: null }]
          : [],
    });
    setModalError(null);
    setShowEdit(true);
  };
  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editForm.firstName.trim() || !editForm.lastName.trim()) { setModalError("Nombre y apellidos obligatorios"); return; }
    setModalBusy(true); setModalError(null);
    try {
      const payload = {
        ...editForm,
        age: editForm.age === "" ? null : Number(editForm.age),
        objectives: editForm.objectives.split(",").map((s) => s.trim()).filter(Boolean),
        // Las filas a medio rellenar (persona sin elegir) no se mandan. El
        // primero de la lista es el de referencia y el servidor pone con él
        // `main_therapist_id`; NO se manda `mainTherapistId` aparte, o serían dos
        // caminos escribiendo lo mismo.
        therapists: (editForm.therapists ?? []).filter((t) => t.id),
      };
      delete payload.mainTherapistId;
      const r = await fetch(`/api/pacientes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar");
      setShowEdit(false); load();
    } catch (e2) { setModalError(e2.message); } finally { setModalBusy(false); }
  };

  const createReport = async (e) => {
    e.preventDefault();
    if (!patient.mainTherapistId) { setModalError("El paciente no tiene terapeuta asignado"); return; }
    setModalBusy(true); setModalError(null);
    try {
      const payload = {
        patientId: id,
        therapistId: patient.mainTherapistId,
        reportType: reportForm.reportType,
        dueDate: reportForm.dueDate || null,
        contentSections:
          reportForm.reportType === "evolution" && reportForm.sourceSessionIds.length
            ? { sourceSessionIds: reportForm.sourceSessionIds }
            : reportForm.reportType === "referral" && reportForm.referralSpecialty
              ? { referralSpecialty: reportForm.referralSpecialty }
              : {},
      };
      const r = await fetch("/api/clinica/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo crear");
      setShowReport(false); setReportForm(informeVacio()); setActiveTab("informes"); load();
    } catch (e2) { setModalError(e2.message); } finally { setModalBusy(false); }
  };

  if (loading) return <div className="p-4 lg:p-8 text-neutral-400 text-sm">Cargando ficha…</div>;
  if (notFound || !patient) {
    return (
      <div className={anchoPantalla("listado")}>
        <PreviewBanner />
        <div className="bg-white border border-neutral-100 rounded-xl p-10 text-center mt-5">
          <p className="text-sm text-neutral-600">Paciente no encontrado.</p>
          <Link href={vuelta.href} className="text-xs text-[var(--color-primary,#1B3A2D)] hover:underline mt-2 inline-block">← Volver a {vuelta.texto}</Link>
        </div>
      </div>
    );
  }

  const s = pStatus(patient.status);

  /*
   * Quién lleva al paciente, para la cabecera. `therapists` viene del servidor
   * con el de referencia el primero; si no viene resuelto (null, que NO es lo
   * mismo que lista vacía), se cae al de siempre.
   *
   * El nombre puede llegar a null si la persona está en la tabla pero no en el
   * equipo cargado: entonces se cruza con la lista que ya tiene la pantalla.
   */
  const terapeutasVisibles = Array.isArray(patient.therapists)
    ? patient.therapists
    : patient.therapist
      ? [{ teamMemberId: patient.mainTherapistId, displayName: patient.therapist.name, specialty: null }]
      : [];
  const textoTerapeutas = terapeutasVisibles
    .map((t) => {
      const nombre = t.displayName ?? therapists.find((m) => m.id === t.teamMemberId)?.displayName;
      if (!nombre) return null;
      const que = t.specialty ? SPECIALTY_LABEL[t.specialty] : null;
      return que ? `${nombre} (${que})` : nombre;
    })
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      {/* La flecha vuelve a DE DÓNDE VINISTE, no siempre al listado (26/08/2026,
          Lau): desde «Fichas a completar» se abren fichas de una en una para
          tapar huecos, y devolver a /pacientes obliga a entrar otra vez por el
          menú y a volver a desplegar la carpeta. La regla, en lib/clients/volver.js. */}
      <Link href={vuelta.href} className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] transition-colors w-fit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        {vuelta.texto}
      </Link>

      <PreviewBanner />

      {/* Cabecera */}
      <div className="bg-white border border-neutral-100 rounded-xl p-5 lg:p-6">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
          <div className="shrink-0 w-16 h-16 lg:w-20 lg:h-20 rounded-full flex items-center justify-center text-white font-display text-2xl" style={{ backgroundColor: patient.color }}>{patient.initials}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] tracking-tight">{patient.firstName} {patient.lastName}</h1>
              <span className={`inline-flex items-center gap-1.5 ${s.bg} ${s.text} text-[11px] font-medium px-2.5 py-0.5 rounded-full`}><span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{patient.statusLabel}</span>
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">{patient.age != null ? `${patient.age} años` : "—"} · {patient.educationLevel ?? "—"}</p>
            <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="Centro escolar" value={patient.educationCenter} />
              {/*
                El rótulo cambia con lo que hay (25/08/2026). Lau preguntó si
                «Terapeuta principal» se podía cambiar: con varios apuntados la
                palabra sobra, y con uno solo hablar de «principal» insinúa que
                hay otro. Así que lo dice la lista, no una etiqueta fija.
              */}
              <Field label={terapeutasVisibles.length > 1 ? "Terapeutas" : "Terapeuta"} value={textoTerapeutas} />
              <Field label="Fecha alta" value={fmtDate(patient.enrollmentDate)} />
              <Field label="Frecuencia" value={patient.attendanceFrequency} />
            </div>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <Link href={`/pacientes/${patient.id}/sesiones/nueva`} className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2" style={{ background: "var(--color-primary, #1B3A2D)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 7.5m0 0L7.5 12m4.5-4.5v13.5" /></svg>
              Subir audio
            </Link>
            <button onClick={() => { setModalError(null); setReportForm(informeVacio()); setShowReport(true); }} className="text-xs font-medium px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 text-neutral-700 inline-flex items-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              Nuevo informe
            </button>
            <button onClick={openEdit} className="text-xs font-medium px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 text-neutral-700">Editar ficha</button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-neutral-200">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const count = t.key === "sesiones" ? sessions.length : t.key === "informes" ? reports.length : t.key === "coordinaciones" ? coordinations.length : null;
            return (
              <button key={t.key} onClick={() => setActiveTab(t.key)} className={`text-xs font-medium px-4 py-2.5 border-b-2 transition-colors whitespace-nowrap ${activeTab === t.key ? "border-[var(--color-primary,#1B3A2D)] text-[var(--ink-900)]" : "border-transparent text-neutral-500 hover:text-neutral-700"}`}>
                {t.label}
                {count != null && count > 0 && <span className="ml-1.5 text-[10px] bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded-full tabular">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Contenido */}
      <div>
        {activeTab === "resumen" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
              <div className="eyebrow mb-2">Motivo de derivación</div>
              <p className="text-xs text-neutral-700 leading-relaxed">{patient.referralReason || "—"}</p>
              <div className="text-[10px] text-neutral-400 mt-3">Derivado por: {patient.referredBy || "—"}</div>
            </div>
            <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
              <div className="eyebrow mb-2 flex items-center gap-1.5">
                Objetivos terapéuticos actuales
                <HelpTooltip title="Objetivos" placement="bottom" className="tracking-normal">
                  Hay tres listas de objetivos y no se copian entre sí: esta (se cambia en
                  «Editar ficha»), la de la pestaña Plan y la que se marca en cada sesión.
                  {" "}
                  <strong className="text-white">Al redactar un informe a partir de sesiones,
                  los que salen son los de las sesiones.</strong>
                </HelpTooltip>
              </div>
              {patient.objectives?.length ? (
                <div className="flex flex-wrap gap-1.5">{patient.objectives.map((o) => <span key={o} className="text-[11px] bg-neutral-100 text-neutral-700 px-2 py-0.5 rounded-full">{o}</span>)}</div>
              ) : <p className="text-[11px] text-neutral-400">Sin objetivos definidos.</p>}
            </div>
            <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
              <div className="eyebrow mb-3 flex items-center gap-1.5">
                Citas del paciente
                <HelpTooltip title="Citas del paciente" placement="bottom" className="tracking-normal">
                  Solo salen las citas que tengan asignado a este paciente. Las que se reservan
                  por internet llegan sin paciente y aquí no se ven hasta que se le asigna,
                  abriendo la cita en la Agenda.
                </HelpTooltip>
              </div>
              {citas.length ? (
                <div className="space-y-2">
                  {[...citas]
                    .sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt))
                    .map((c) => {
                      const d = new Date(c.scheduledAt);
                      const past = d < new Date();
                      return (
                        <div key={c.id} className={`flex items-center justify-between gap-2 ${past ? "opacity-60" : ""}`}>
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-neutral-800 truncate">{c.eventType?.name || "Cita"}</div>
                            <div className="text-[11px] text-neutral-500">
                              {d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}
                              {" · "}
                              {d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                              {c.teamMember?.displayName ? ` · ${c.teamMember.displayName}` : ""}
                            </div>
                          </div>
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
                            {CITA_STATUS[c.status] || c.status}
                          </span>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <p className="text-[11px] text-neutral-400">Sin citas registradas para este paciente.</p>
              )}
            </div>
            <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
              <div className="eyebrow mb-3">Contacto (pagador)</div>
              {patient.client ? (
                <div className="space-y-2">
                  <div className="text-xs">
                    <a href={`/clientes/${patient.client.id}`} className="font-medium text-neutral-800 hover:underline">
                      {patient.client.name}
                    </a>
                    {patient.client.separated && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                        padres separados
                      </span>
                    )}
                  </div>
                  {patient.payerContacts?.length ? (
                    <ul className="space-y-1">
                      {patient.payerContacts.map((c) => (
                        <li key={c.id} className="text-[11px] text-neutral-600 flex items-center gap-2 flex-wrap">
                          <span className="text-neutral-400">{c.kind === "email" ? "✉" : "☎"}</span>
                          <span className="break-all">{c.value}</span>
                          {c.label && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 text-neutral-500">{c.label}</span>}
                          {c.isPrimary && <span className="text-[10px] text-emerald-600">principal</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-neutral-400">Sin contactos registrados en el cliente.</p>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-neutral-400">Este paciente no tiene un cliente pagador enlazado.</p>
              )}
            </div>
            <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
              <div className="eyebrow mb-3">Datos y consentimientos</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] mb-3">
                <div><span className="text-neutral-400">DNI</span><div className="text-neutral-700">{patient.dni || "—"}</div></div>
                <div><span className="text-neutral-400">Parentesco</span><div className="text-neutral-700">{patient.relationship || "—"}</div></div>
                <div className="col-span-2"><span className="text-neutral-400">Domicilio</span><div className="text-neutral-700">{patient.address || "—"}</div></div>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {[["images", "Imágenes"], ["marketing", "Publicidad"], ["whatsapp", "WhatsApp"]].map(([k, lbl]) => {
                  const g = patient.consents?.[k]?.granted;
                  return (
                    <span
                      key={k}
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${g ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-neutral-50 text-neutral-400 border-neutral-200"}`}
                    >
                      {lbl} {g ? "✓" : "✗"}
                    </span>
                  );
                })}
              </div>
              {/* El contrato es de la FAMILIA y vive en la ficha del cliente
                  pagador (sprint 2026-07, punto 1.1): quien firma y quien paga
                  son los padres. Aquí solo se consulta; con dos hermanos en el
                  centro, el contrato es el mismo para los dos. */}
              <div className="text-[11px] flex items-center gap-2 flex-wrap">
                <span className="text-neutral-400">Contrato de la familia:</span>
                {!patient.clientId ? (
                  <span className="text-neutral-400">sin cliente pagador enlazado</span>
                ) : familyContract?.contract ? (
                  <>
                    <span className="text-emerald-600">subido</span>
                    <a href={`/api/clients/${patient.clientId}/contract/download`} className="text-[var(--color-primary,#1B3A2D)] hover:underline">
                      descargar PDF
                    </a>
                  </>
                ) : (
                  <span className="text-neutral-400">pendiente</span>
                )}
                {patient.clientId && (
                  <a href={`/clientes/${patient.clientId}`} className="text-[var(--color-primary,#1B3A2D)] hover:underline">
                    gestionar en la ficha del cliente
                  </a>
                )}
                {familyContract?.firmantes > 0 && (
                  <span className={familyContract.contratoCompleto ? "text-emerald-600" : "text-amber-600"}>
                    · firmas {familyContract.firmas}/{familyContract.firmantes}
                  </span>
                )}
              </div>
              {/* Contrato antiguo, de cuando se subía por paciente. Solo aparece
                  si la migración no lo pudo mover (paciente sin cliente). */}
              {patient.contractFile && (
                <div className="text-[11px] flex items-center gap-2 flex-wrap mt-1.5 text-neutral-400">
                  <span>Contrato antiguo del paciente:</span>
                  <a href={`/api/pacientes/${patient.id}/contract`} className="text-[var(--color-primary,#1B3A2D)] hover:underline">
                    descargar PDF
                  </a>
                </div>
              )}
            </div>
            <PatientBillingSection patientId={patient.id} clientId={patient.clientId} />
          </div>
        )}

        {activeTab === "sesiones" && (
          sessions.length === 0 ? (
            <div className="bg-white border border-dashed border-neutral-200 rounded-xl p-10 text-center">
              <p className="text-sm text-neutral-600">Sin sesiones registradas.</p>
              <p className="text-[11px] text-neutral-400 mt-1">Sube un audio o crea una sesión para empezar el historial.</p>
            </div>
          ) : (
            <div className="bg-white border border-neutral-100 rounded-xl divide-y divide-neutral-100">
              {sessions.map((se) => {
                const ss = sStatus(se.status);
                return (
                  <button key={se.id} onClick={() => setOpenSession(se)} className="w-full text-left p-4 lg:p-5 hover:bg-neutral-50/50 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 flex flex-col items-center pt-0.5">
                        <div className="text-[10px] uppercase tracking-wider text-neutral-400 tabular">{new Date(se.sessionDate).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}</div>
                        <div className="text-[10px] text-neutral-400 tabular">{new Date(se.sessionDate).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-display text-sm text-[var(--ink-900)]">{se.therapist?.name ?? "—"}</span>
                          <span className={`inline-flex items-center gap-1 ${ss.bg} ${ss.text} text-[9px] font-medium px-1.5 py-0.5 rounded-full`}><span className={`w-1 h-1 rounded-full ${ss.dot}`} />{se.statusLabel}</span>
                          <span className="text-[10px] text-neutral-400">{se.duration ?? "—"} min</span>
                        </div>
                        <p className="text-[11px] text-neutral-600 mt-1 line-clamp-2">{se.preview}</p>
                      </div>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 text-neutral-300 shrink-0 mt-1"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </div>
                  </button>
                );
              })}
            </div>
          )
        )}

        {activeTab === "informes" && (
          reports.length === 0 ? (
            <div className="bg-white border border-dashed border-neutral-200 rounded-xl p-10 text-center"><p className="text-sm text-neutral-600">Sin informes generados.</p></div>
          ) : (
            <div className="bg-white border border-neutral-100 rounded-xl divide-y divide-neutral-100">
              {/* La fila ya no es UN enlace: lleva dos destinos. El texto abre
                  el informe donde se edita, y «PDF» abre el documento en una
                  pestaña sin entregárselo a nadie (26/08/2026). Un <a> dentro
                  de un <Link> no es HTML válido, así que la fila pasa a ser un
                  div con los dos enlaces dentro. */}
              {reports.map((r) => (
                <div key={r.id} className="p-4 flex items-center justify-between gap-3 hover:bg-neutral-50/50">
                  <Link href="/clinica/informes" className="min-w-0 flex-1">
                    <div className="font-medium text-[var(--ink-900)] text-sm">Informe {r.typeLabel.toLowerCase()}</div>
                    <div className="text-[10px] text-neutral-400 tabular">{fmtDate(r.reportDate)} · Entrega {fmtDate(r.dueDate)}{r.overdue ? " · vencida" : ""}</div>
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={`/api/clinica/reports/${r.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abre el PDF en una pestaña nueva. No lo envía a nadie."
                      className="text-[10px] font-medium text-neutral-600 border border-neutral-200 hover:border-neutral-400 px-2 py-0.5 rounded-full"
                    >
                      PDF
                    </a>
                    <span className="text-[10px] font-medium text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded-full">{r.statusLabel}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {activeTab === "coordinaciones" && (
          <div className="space-y-3">
            {/* La agenda va ARRIBA, antes de las actas: primero se apunta con
                quién se habla y luego se registra la reunión. Al revés obliga a
                salir a media acta a dar de alta al contacto. */}
            <PatientExternalContactsSection patientId={id} />
            <div className="flex justify-end">
              <button
                onClick={() => setNuevaCoordinacion(true)}
                className="text-xs font-medium px-3 py-2 rounded-lg text-white hover:opacity-90"
                style={{ background: "var(--color-primary, #1B3A2D)" }}
              >
                + Nueva coordinación
              </button>
            </div>
            {coordinations.length === 0 ? (
            <div className="bg-white border border-dashed border-neutral-200 rounded-xl p-10 text-center"><p className="text-sm text-neutral-600">Sin coordinaciones registradas.</p></div>
          ) : (
            <div className="space-y-3">
              {coordinations.map((c) => (
                <div key={c.id} className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] uppercase tracking-wider text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">{c.typeLabel}</span>
                    <span className="text-[10px] text-neutral-400 tabular">{fmtDate(c.date)}</span>
                  </div>
                  <div className="text-[11px] text-neutral-500 mb-1">Participantes: {c.participants || "—"}</div>
                  <p className="text-xs text-neutral-700 leading-relaxed">{c.topics || "—"}</p>
                </div>
              ))}
            </div>
          )}
          </div>
        )}

        {activeTab === "plan" && <InterventionPlanSection patientId={id} />}
        {activeTab === "documentos" && <PatientDocumentsSection patientId={id} />}
      </div>

      {nuevaCoordinacion && (
        <NuevaCoordinacionModal
          patientId={id}
          patientName={`${patient.firstName} ${patient.lastName}`}
          onClose={() => setNuevaCoordinacion(false)}
          onCreada={() => load()}
        />
      )}

      {openSession && (
        <SessionDrawer
          session={openSession}
          patient={patient}
          onClose={() => setOpenSession(null)}
          onPublish={publishSession}
          // Tras tocar la preparación o los adjuntos hay que releer: el cajón
          // enseña la sesión que trajo la lista, y se quedaría con la vieja.
          onSaved={async () => {
            const j = await fetch(`/api/clinica/sessions?patientId=${id}`, { cache: "no-store" })
              .then((r) => r.json())
              .catch(() => null);
            const arr = j?.data?.sessions ?? [];
            if (arr.length) {
              setSessions(arr);
              const actual = arr.find((s) => s.id === openSession.id);
              if (actual) setOpenSession(actual);
            }
          }}
          busy={busy}
        />
      )}

      {/* Modal editar ficha */}
      {showEdit && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !modalBusy && setShowEdit(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-xl text-[var(--ink-900)] mb-3">Editar ficha</h3>
            <form onSubmit={saveEdit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input className={inputCls} placeholder="Nombre *" value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} />
                <input className={inputCls} placeholder="Apellidos *" value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input className={inputCls} type="number" min={0} max={120} placeholder="Edad" value={editForm.age} onChange={(e) => setEditForm({ ...editForm, age: e.target.value })} />
                <input className={inputCls} placeholder="Curso" value={editForm.educationLevel} onChange={(e) => setEditForm({ ...editForm, educationLevel: e.target.value })} />
              </div>
              <input className={inputCls} placeholder="Centro escolar" value={editForm.educationCenter} onChange={(e) => setEditForm({ ...editForm, educationCenter: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <input className={inputCls} placeholder="Frecuencia" value={editForm.attendanceFrequency} onChange={(e) => setEditForm({ ...editForm, attendanceFrequency: e.target.value })} />
                <Select value={editForm.status} onChange={(v) => setEditForm({ ...editForm, status: v })} options={[{ value: "active", label: "Activo" }, { value: "paused", label: "En pausa" }, { value: "discharged", label: "Alta" }]} className={inputCls} />
              </div>
              <textarea className={inputCls} rows={3} placeholder="Motivo de derivación" value={editForm.referralReason} onChange={(e) => setEditForm({ ...editForm, referralReason: e.target.value })} />
              <input className={inputCls} placeholder="Objetivos (separados por comas)" value={editForm.objectives} onChange={(e) => setEditForm({ ...editForm, objectives: e.target.value })} />
              <SpecialtyPicker value={editForm.specialties} onChange={(v) => setEditForm({ ...editForm, specialties: v })} />
              <TerapeutasPicker
                value={editForm.therapists ?? []}
                onChange={(v) => setEditForm({ ...editForm, therapists: v })}
                equipo={therapists}
              />
              {modalError && <p className="text-xs text-rose-600">{modalError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowEdit(false)} disabled={modalBusy} className="px-4 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={modalBusy} className="px-4 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>{modalBusy ? "Guardando…" : "Guardar"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal nuevo informe */}
      {showReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !modalBusy && setShowReport(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-xl text-[var(--ink-900)] mb-1">Nuevo informe</h3>
            <p className="text-[11px] text-neutral-400 mb-3">Para {patient.firstName} {patient.lastName}</p>
            <form onSubmit={createReport} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Select value={reportForm.reportType} onChange={(v) => setReportForm((f) => ({ ...f, reportType: v }))} options={REPORT_TYPE_OPTIONS} className={inputCls} />
                <input type="date" className={inputCls} value={reportForm.dueDate} onChange={(e) => setReportForm((f) => ({ ...f, dueDate: e.target.value }))} title="Fecha de entrega" />
              </div>
              {/* Derivación: a qué especialista externo se manda. El catálogo lo
                  fija cada centro (Configuración → Derivaciones). */}
              {reportForm.reportType === "referral" && derivaciones.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Especialidad de destino</div>
                  <select
                    className={inputCls}
                    value={reportForm.referralSpecialty}
                    onChange={(e) => setReportForm((f) => ({ ...f, referralSpecialty: e.target.value }))}
                  >
                    <option value="">Sin especificar</option>
                    {derivaciones.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                  </select>
                </div>
              )}

              {/* Solo en el evolutivo: el informe se redacta A PARTIR de sesiones
                  concretas, y elegirlas es cosa de quien las dio. */}
              {reportForm.reportType === "evolution" && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">
                    Sesiones en las que se basa {reportForm.sourceSessionIds.length > 0 && `(${reportForm.sourceSessionIds.length})`}
                  </div>
                  {sessions.length === 0 ? (
                    <p className="text-[11px] text-neutral-400">Este paciente aún no tiene sesiones registradas.</p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto border border-neutral-200 rounded-lg divide-y divide-neutral-100">
                      {sessions.map((se) => {
                        const marcada = reportForm.sourceSessionIds.includes(se.id);
                        return (
                          <label key={se.id} className="flex items-start gap-2 px-2.5 py-2 cursor-pointer hover:bg-neutral-50">
                            <input
                              type="checkbox"
                              checked={marcada}
                              onChange={() =>
                                setReportForm((f) => ({
                                  ...f,
                                  sourceSessionIds: marcada
                                    ? f.sourceSessionIds.filter((x) => x !== se.id)
                                    : [...f.sourceSessionIds, se.id],
                                }))
                              }
                              className="mt-0.5 w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]"
                            />
                            <span className="min-w-0">
                              <span className="block text-[11px] text-neutral-700">{fmtDate(se.sessionDate)}</span>
                              <span className="block text-[10px] text-neutral-400 truncate">{se.preview || se.statusLabel}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              <p className="text-[11px] text-neutral-400">Se crea como borrador.</p>
              {modalError && <p className="text-xs text-rose-600">{modalError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowReport(false)} disabled={modalBusy} className="px-4 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={modalBusy} className="px-4 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>{modalBusy ? "Creando…" : "Crear informe"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
