"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Select from "@/components/ui/Select.jsx";
import SelectorPaciente from "@/components/citas/SelectorPaciente.jsx";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import PreviewBanner from "../_components/PreviewBanner.jsx";
import InformeDrawer from "@/components/clinica/InformeDrawer.jsx";
import { REPORT_TYPES_NUEVOS, REPORT_TYPE_LABEL } from "@/lib/clinica/serialize.js";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

// Opciones del desplegable derivadas del catálogo compartido: añadir un tipo
// nuevo (como "Derivación") no debe obligar a tocar cada pantalla. Son los
// tipos que se pueden CREAR: la entrevista inicial ya no está (03/09/2026),
// es un registro de sesión con su plantilla (lib/clinica/serialize.js).
const TYPE_OPTIONS = REPORT_TYPES_NUEVOS.map((value) => ({ value, label: REPORT_TYPE_LABEL[value] }));

const STATUS_STYLES = {
  draft: { bg: "bg-neutral-100", text: "text-neutral-600", dot: "bg-neutral-400" },
  reviewed: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  delivered: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
};
// Un color por tipo. Sin el suyo, un tipo cae al del evolutivo y dos chips
// distintos se pintan iguales: le pasaba a la beca desde el 26/08/2026 y se ve
// al añadir el asesoramiento (04/09/2026), que es cuando se arregla.
const TYPE_STYLES = {
  evolution: { bg: "bg-sky-50", text: "text-sky-700" },
  admission: { bg: "bg-violet-50", text: "text-violet-700" },
  discharge: { bg: "bg-emerald-50", text: "text-emerald-700" },
  referral: { bg: "bg-amber-50", text: "text-amber-700" },
  beca: { bg: "bg-rose-50", text: "text-rose-700" },
  asesoramiento: { bg: "bg-teal-50", text: "text-teal-700" },
  diagnostico: { bg: "bg-indigo-50", text: "text-indigo-700" },
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—");

// La fecha del informe se elige AL CREARLO (04/09/2026, Rodrigo: «la pantalla
// inicial de creación de un informe tras elegir fecha, paciente y tipo»). Antes
// era siempre hoy y no se preguntaba, así que un informe que se escribía el
// lunes con fecha del viernes había que corregirlo después.
const hoy = () => new Date().toISOString().slice(0, 10);
const EMPTY_FORM = { patientId: "", reportType: "evolution", reportDate: hoy(), dueDate: "" };

export default function InformesPage() {
  const router = useRouter();
  const [reports, setReports] = useState([]);
  // El paciente ELEGIDO, no la lista de pacientes (01/09/2026, Rodrigo). Antes
  // esta pantalla se bajaba `/api/pacientes` al abrirse y montaba el desplegable
  // encima; ese endpoint corta en 300 y Aumenta tiene 1.178, así que 878 —el
  // 75%— no salían, y no salir se lee igual que no existir. Es el mismo agujero
  // que se tapó en el alta de citas (28/08), en las incidencias (31/08) y en el
  // modal de la cita (01/09); esta se había quedado atrás. Ahora se pregunta al
  // servidor según se escribe y solo se guarda el que se elige, que es de quien
  // hace falta el terapeuta para crear el informe.
  const [pacienteElegido, setPacienteElegido] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = () => {
    setLoading(true);
    fetch("/api/clinica/reports", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "Error");
        setReports(j.data.reports ?? []);
      })
      .catch((e) => setErrorMsg(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const overdueCount = useMemo(() => reports.filter((r) => r.overdue).length, [reports]);
  const filtered = reports.filter((r) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "overdue") return r.overdue;
    return r.status === statusFilter;
  });
  const selected = reports.find((r) => r.id === selectedId) ?? null;

  const deliver = async (id) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      // El endpoint genera el PDF y lo publica en el área privada de la
      // familia; el estado "entregado" lo pone él, no la pantalla.
      const r = await fetch(`/api/clinica/reports/${id}/enviar`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo enviar el informe");
      load();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async (e) => {
    e.preventDefault();
    // El paciente viene del selector, no de una lista descargada: lo trae
    // entero al elegirlo, y de él sale el terapeuta que lleva el informe.
    const patient = pacienteElegido && pacienteElegido.id === form.patientId ? pacienteElegido : null;
    if (!patient) {
      setFormError("Elige un paciente");
      return;
    }
    if (!patient.mainTherapistId) {
      setFormError("El paciente no tiene terapeuta asignado");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        patientId: patient.id,
        therapistId: patient.mainTherapistId,
        reportType: form.reportType,
        reportDate: form.reportDate || null,
        dueDate: form.dueDate || null,
      };
      const r = await fetch("/api/clinica/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo crear");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      setPacienteElegido(null);
      // Y SE ABRE PARA ESCRIBIRLO (04/09/2026, Rodrigo). Antes el informe se
      // creaba y la pantalla se quedaba en el listado: había que buscarlo en la
      // tabla y abrir el cajón lateral, que además es el de repasar. Ahora se
      // entra en su pantalla, que es a lo que se venía.
      if (j?.data?.id) {
        router.push(`/clinica/informes/${j.data.id}`);
        return;
      }
      load();
    } catch (e2) {
      setFormError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const chip = (key, label) => (
    <button
      onClick={() => setStatusFilter(key)}
      className={`px-2.5 py-1 rounded-full ${statusFilter === key ? "bg-[var(--color-primary,#1B3A2D)] text-white" : "border border-neutral-200 text-neutral-600 hover:border-neutral-400"}`}
    >
      {label}
    </button>
  );
  const inputCls = "w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400";

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      <Link href="/clinica" className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] transition-colors w-fit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Volver a Clínica
      </Link>

      <PreviewBanner />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Clínica · Informes</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">Informes clínicos</h1>
          <p className="text-xs text-neutral-400 mt-1">Evolutivos, de admisión y de alta</p>
        </div>
        <button
          onClick={() => {
            setForm(EMPTY_FORM);
            setPacienteElegido(null);
            setFormError(null);
            setShowCreate(true);
          }}
          className="self-start lg:self-auto text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Nuevo informe
        </button>
      </div>

      {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-neutral-400 uppercase tracking-wider">Filtrar:</span>
        {chip("all", "Todos")}
        {chip("draft", "Borradores")}
        {chip("reviewed", "Revisados")}
        {chip("delivered", "Entregados")}
        <button
          onClick={() => setStatusFilter("overdue")}
          className={`px-2.5 py-1 rounded-full ${statusFilter === "overdue" ? "bg-amber-500 text-white" : "border border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-400"}`}
        >
          Entrega vencida ({overdueCount})
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
                <th className="px-4 py-3 font-medium">
                  Entrega
                  <HelpTooltip title="Entrega" className="ml-1">
                    Es la fecha en la que toca entregar el informe, no el día en que se envió.
                    Y es opcional: un informe sin ella no cuenta nunca como{" "}
                    <strong className="text-white">entrega vencida</strong>, por antiguo que sea.
                    Si quieres que te avise, ponla al crear el informe.
                  </HelpTooltip>
                </th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-neutral-400">Cargando…</td></tr>
              )}
              {!loading && filtered.map((r) => {
                const p = r.patient ?? { name: "—", age: null, focus: "" };
                const t = r.therapist ?? { name: "—", initials: "?", color: "#666" };
                const s = STATUS_STYLES[r.status];
                const ts = TYPE_STYLES[r.type] ?? TYPE_STYLES.evolution;
                return (
                  <tr key={r.id} className="border-t border-neutral-100 hover:bg-neutral-50/40 cursor-pointer" onClick={() => setSelectedId(r.id)}>
                    <td className="px-4 py-3">
                      <div className="text-[var(--ink-900)] font-medium">{p.name}</div>
                      <div className="text-[10px] text-neutral-400">{p.age != null ? `${p.age} años` : ""} {p.focus ? `· ${p.focus}` : ""}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-display" style={{ backgroundColor: t.color ?? "#1B3A2D" }}>{t.initials}</div>
                        <span className="text-neutral-700">{t.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded ${ts.bg} ${ts.text}`}>{r.typeLabel}</span>
                    </td>
                    <td className="px-4 py-3 tabular text-neutral-600">{fmtDate(r.reportDate)}</td>
                    <td className="px-4 py-3 tabular">
                      <span className={r.overdue ? "text-red-600 font-medium" : "text-neutral-600"}>
                        {fmtDate(r.dueDate)}
                        {r.overdue && <span className="block text-[9px] uppercase tracking-wider">Vencida</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 ${s.bg} ${s.text} text-[10px] font-medium px-2 py-0.5 rounded-full`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                        {r.statusLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline" onClick={(e) => { e.stopPropagation(); setSelectedId(r.id); }}>Ver</button>
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-neutral-400">Sin informes para ese filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <InformeDrawer
          report={selected}
          onClose={() => setSelectedId(null)}
          onDeliver={deliver}
          onGuardado={load}
          // Borrado desde el cajón (02/09/2026): se cierra y la lista se relee.
          onBorrado={() => { setSelectedId(null); load(); }}
          busy={busy}
        />
      )}

      {/* Modal nuevo informe */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setShowCreate(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-xl text-[var(--ink-900)] mb-3">Nuevo informe</h3>
            <form onSubmit={submitCreate} className="space-y-3">
              <SelectorPaciente
                value={form.patientId}
                onChange={(v, paciente) => {
                  setForm((f) => ({ ...f, patientId: v }));
                  setPacienteElegido(paciente ?? null);
                }}
                disabled={saving}
                aria-label="Paciente del informe"
                placeholder="— Paciente —"
                className={inputCls}
              />
              <Select
                value={form.reportType}
                onChange={(v) => setForm({ ...form, reportType: v })}
                options={TYPE_OPTIONS}
                className={inputCls}
              />
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Fecha del informe</span>
                  <input type="date" className={inputCls} value={form.reportDate} onChange={(e) => setForm({ ...form, reportDate: e.target.value })} />
                </label>
                <label className="block">
                  <span className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Entrega (opcional)</span>
                  <input type="date" className={inputCls} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} title="Fecha de entrega" />
                </label>
              </div>
              <p className="text-[11px] text-neutral-400">
                Se crea como borrador y se abre para escribirlo: con su audio, sus notas y sus apartados.
              </p>
              {/* La entrevista inicial NO es un informe (03/09/2026, Rodrigo):
                  es un registro de sesión con sus 15 apartados, que se rellena
                  desde el bloc de notas o el audio con IA. Se dice aquí porque
                  aquí es donde se venía a buscarla. */}
              <p className="text-[11px] text-neutral-400">
                ¿Una entrevista inicial? No es un informe: se escribe como registro de sesión desde la ficha del paciente
                (botón «Nueva entrevista inicial») o desde su cita de valoración inicial.
              </p>
              {formError && <p className="text-xs text-rose-600">{formError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowCreate(false)} disabled={saving} className="px-4 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>{saving ? "Creando…" : "Crear informe"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
