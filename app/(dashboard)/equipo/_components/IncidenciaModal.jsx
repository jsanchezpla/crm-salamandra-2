"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Select from "@/components/ui/Select.jsx";
import SelectorPaciente from "@/components/citas/SelectorPaciente.jsx";
import TextareaCrece from "@/components/ui/TextareaCrece.jsx";
import { INCIDENCIA_CATEGORIES, INCIDENCIA_PRIORITY, INCIDENCIA_VERIFICATIONS, exigeSubcategoria } from "@/lib/clinica/incidencias.js";
import { RESPUESTAS_FALTA } from "@/lib/clinica/faltas.js";
import { leerRespuestaApi } from "@/lib/utils/respuestaApi.js";

/**
 * Un solo control para el resultado: la VERIFICACIÓN, que arrastra el estado
 * (Aumenta, 04/08/2026). Antes había tres botones de estado sin sitio para «a
 * medias», que es el resultado más común de una incidencia organizativa.
 */
const VERIF_BTN = [
  { key: "", label: "Sin verificar", on: "bg-neutral-500 text-white", off: "bg-neutral-100 text-neutral-600" },
  ...INCIDENCIA_VERIFICATIONS.map((v) => ({
    key: v.key,
    label: v.label,
    on: v.level === "green" ? "bg-emerald-500 text-white" : v.level === "amber" ? "bg-amber-500 text-white" : "bg-rose-500 text-white",
    off: v.level === "green" ? "bg-emerald-50 text-emerald-700" : v.level === "amber" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700",
  })),
];
const fmt = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtDT = (d) => (d ? new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const catOf = (k) => INCIDENCIA_CATEGORIES.find((c) => c.key === k);
const fmtSize = (n) => {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Desplegable multi-selección de responsables. Sustituye a los chips sueltos
 * (26/08/2026, Aumenta): con 15 personas los chips desbordaban la columna y el
 * control se veía cortado. El PRIMERO que se marca sigue siendo el responsable
 * principal, que es el que sale en los listados.
 */
function ResponsablesDropdown({ therapists, assigneeIds, onToggle, inputCls }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const nombres = assigneeIds.map((id) => therapists.find((t) => t.id === id)?.name).filter(Boolean);
  const resumen = nombres.length === 0 ? "Sin asignar" : nombres.length === 1 ? nombres[0] : `${nombres[0]} +${nombres.length - 1}`;

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`${inputCls} bg-white text-left flex items-center justify-between gap-2 cursor-pointer`}
      >
        <span className={`truncate ${nombres.length ? "text-neutral-800" : "text-neutral-400"}`}>{resumen}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-3.5 h-3.5 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full min-w-56 max-h-60 overflow-y-auto bg-white border border-neutral-200 rounded-lg shadow-lg py-1" role="listbox">
          {therapists.length === 0 && <p className="px-3 py-2 text-xs text-neutral-400">No hay profesionales activos.</p>}
          {therapists.map((t) => {
            const puesto = assigneeIds.indexOf(t.id);
            const marcado = puesto >= 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onToggle(t.id)}
                role="option"
                aria-selected={marcado}
                className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-neutral-50"
              >
                <span
                  className={`shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center ${marcado ? "border-transparent text-white" : "border-neutral-300"}`}
                  style={marcado ? { background: "var(--color-primary, #1B3A2D)" } : undefined}
                >
                  {marcado && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-2.5 h-2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                <span className="flex-1 truncate text-neutral-700">{t.name}</span>
                {puesto === 0 && assigneeIds.length > 1 && <span className="shrink-0 text-[10px] text-neutral-400">principal</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Modal de incidencia — crea una nueva o gestiona una existente
 * (editar campos, cambiar estado, comentar, borrar).
 */
export default function IncidenciaModal({ mode = "create", incidencia = null, therapists = [], patients = [], isAdmin = false, yoSoy = null, onClose, onSaved }) {
  const [inc, setInc] = useState(incidencia); // se refresca tras cada PATCH
  const isNew = mode === "create" && !inc;
  // Borrar (02/09/2026, Aumenta AV-0013; 03/09/2026, AV-0039): dirección
  // cualquiera; el resto, la que registró o de la que es responsable —las que
  // abre sola una falta se le asignan a administración—. Misma regla que el
  // DELETE del endpoint (`lib/clinica/alcanceIncidencias.js`).
  const soyResponsable =
    Boolean(yoSoy) &&
    (inc?.assignedToId === yoSoy || (Array.isArray(inc?.assignees) && inc.assignees.some((a) => a?.id === yoSoy)));
  const puedeBorrar = !isNew && (isAdmin || (Boolean(yoSoy) && (inc?.reportedById === yoSoy || soyResponsable)));

  const [title, setTitle] = useState(inc?.title ?? "");
  const [category, setCategory] = useState(inc?.category ?? "terapeutica");
  const [subcategory, setSubcategory] = useState(inc?.subcategory ?? "");
  const [priority, setPriority] = useState(inc?.priority ?? "medium");
  const [date, setDate] = useState(inc?.date ?? new Date().toISOString().slice(0, 10));
  const [patientId, setPatientId] = useState(inc?.patientId ?? "");
  // El nombre del paciente elegido en el buscador (31/08/2026): la lista de
  // `patients` corta en 1.000 y con 1.174 el elegido puede no estar en ella.
  const [pacienteNombre, setPacienteNombre] = useState(null);
  // Multi-responsable: se parte de `assignees` (nuevo) y se cae al legacy
  // `assignedToId` para las incidencias creadas antes del cambio.
  const [assigneeIds, setAssigneeIds] = useState(() => {
    if (Array.isArray(inc?.assignees) && inc.assignees.length) return inc.assignees.map((a) => a.id);
    return inc?.assignedToId ? [inc.assignedToId] : [];
  });
  const toggleAssignee = (id) =>
    setAssigneeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const [description, setDescription] = useState(inc?.description ?? "");
  const [resolution, setResolution] = useState(inc?.resolution ?? "");
  const [verification, setVerification] = useState(inc?.verification ?? "");
  const [reportedById, setReportedById] = useState(inc?.reportedById ?? "");
  // La FALTA (03/09/2026, AV-0038): solo la llevan las incidencias que abre
  // sola la agenda. `null` = incidencia de las de siempre, sin ese bloque.
  const [falta, setFalta] = useState(inc?.falta ?? null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Ficha FRESCA al abrir (02/09/2026): el listado puede llevar un rato cargado
  // y un compañero ha podido comentar entre medias; abrirla desde la copia del
  // listado enseñaba el hilo viejo. Si el servidor la trae más nueva que la
  // copia, se vuelcan también los campos editables: aún no ha dado tiempo a
  // tocar nada.
  const volcarCampos = (d) => {
    setTitle(d.title ?? "");
    setCategory(d.category ?? "terapeutica");
    setSubcategory(d.subcategory ?? "");
    setPriority(d.priority ?? "medium");
    setDate(d.date ?? new Date().toISOString().slice(0, 10));
    setPatientId(d.patientId ?? "");
    setAssigneeIds(Array.isArray(d.assignees) && d.assignees.length ? d.assignees.map((a) => a.id) : d.assignedToId ? [d.assignedToId] : []);
    setDescription(d.description ?? "");
    setResolution(d.resolution ?? "");
    setVerification(d.verification ?? "");
    setReportedById(d.reportedById ?? "");
    setFalta(d.falta ?? null);
  };
  useEffect(() => {
    if (!inc?.id) return;
    let vivo = true;
    fetch(`/api/clinica/incidencias/${inc.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!vivo || !j.ok) return;
        const fresca = j.data;
        const cambio = fresca.updatedAt !== inc.updatedAt
          || (fresca.comments?.length ?? 0) !== (inc.comments?.length ?? 0);
        setInc(fresca);
        if (cambio) volcarCampos(fresca);
      })
      .catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inc?.id]);

  // ── Documentos adjuntos (26/08/2026, Aumenta) ─────────────────────────────
  // En una incidencia existente se suben al momento; en una NUEVA se dejan en
  // cola y se suben justo después de crearla (el documento necesita el id).
  const [docs, setDocs] = useState([]);
  const [queuedDocs, setQueuedDocs] = useState([]); // [{ file, name }]
  const [pendingDoc, setPendingDoc] = useState(null); // { file } → modal de nombre
  const [pendingName, setPendingName] = useState("");
  const [docBusy, setDocBusy] = useState(false);
  const [docErr, setDocErr] = useState(null);
  const docFileRef = useRef(null);

  const loadDocs = useCallback(() => {
    if (!inc?.id) return;
    fetch(`/api/clinica/incidencias/${inc.id}/documents`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setDocs(j.data.documents || []); })
      .catch(() => {});
  }, [inc?.id]);
  useEffect(() => { loadDocs(); }, [loadDocs]);

  const pickDocFile = () => {
    const f = docFileRef.current?.files?.[0];
    if (!f) return;
    setPendingDoc({ file: f });
    setPendingName(f.name.replace(/\.[^.]+$/, ""));
    setDocErr(null);
  };

  const resetDocInput = () => { if (docFileRef.current) docFileRef.current.value = ""; };

  const subirDoc = async (incidenciaId, file, name) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", name);
    const r = await fetch(`/api/clinica/incidencias/${incidenciaId}/documents`, { method: "POST", body: fd });
    const j = await leerRespuestaApi(r, { siGrande: "El archivo pesa demasiado. El tope son 25 MB por documento." });
    if (!r.ok) throw new Error(j.error || "No se pudo subir el documento");
    return j.data;
  };

  const confirmDocUpload = async () => {
    if (!pendingDoc) return;
    const name = pendingName.trim();
    if (!name) { setDocErr("El nombre es obligatorio"); return; }
    if (isNew) {
      // Aún no hay incidencia a la que colgarlo: a la cola.
      setQueuedDocs((q) => [...q, { file: pendingDoc.file, name }]);
      setPendingDoc(null); setPendingName(""); resetDocInput();
      return;
    }
    setDocBusy(true); setDocErr(null);
    try {
      await subirDoc(inc.id, pendingDoc.file, name);
      setPendingDoc(null); setPendingName("");
      loadDocs();
    } catch (e) {
      setDocErr(e.message);
    } finally {
      setDocBusy(false);
      resetDocInput();
    }
  };

  // Reintento de un documento que quedó en cola (solo pasa si falló su subida
  // al crear la incidencia).
  const retryQueuedDoc = async (i) => {
    const qd = queuedDocs[i];
    if (!qd || !inc?.id) return;
    setDocBusy(true); setDocErr(null);
    try {
      await subirDoc(inc.id, qd.file, qd.name);
      setQueuedDocs((q) => q.filter((_, x) => x !== i));
      loadDocs();
    } catch (e) {
      setDocErr(e.message);
    } finally {
      setDocBusy(false);
    }
  };

  const delDoc = async (docId) => {
    if (!window.confirm("¿Quitar este documento? Se elimina del archivo (y de la ficha del paciente si estaba en ella).")) return;
    setDocBusy(true); setDocErr(null);
    try {
      const r = await fetch(`/api/clinica/incidencias/${inc.id}/documents/${docId}`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "No se pudo eliminar");
      }
      loadDocs();
    } catch (e) {
      setDocErr(e.message);
    } finally {
      setDocBusy(false);
    }
  };

  const subs = catOf(category)?.subcategories ?? [];

  const patch = async (bodyObj) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/clinica/incidencias/${inc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo actualizar");
      setInc(j.data);
      onSaved?.();
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createOrSaveFields = async () => {
    setErr(null);
    if (!title.trim()) { setErr("El título es obligatorio."); return; }
    // «Otros» sin decir cuál no informa de nada: la categoría existe para que
    // quepa lo que no encaja, no para esconderlo (Aumenta, 29/08/2026).
    if (exigeSubcategoria(category) && !subcategory.trim()) {
      setErr("En «Otros» hay que especificar de qué se trata en la subcategoría.");
      return;
    }
    const fields = {
      title: title.trim(), category, subcategory: subcategory || null, priority,
      incidenceDate: date, patientId: patientId || null, assigneeIds,
      description: description || null,
      resolution: resolution || null,
      verification: verification || null,
    };
    // Vacío = «lo registro yo»: el servidor resuelve al usuario logueado. Si se
    // mandara `null` se perdería ese automático y la incidencia quedaría sin
    // autor, que es justo el dato que Aumenta quiere ver.
    if (reportedById) fields.reportedById = reportedById;
    if (isNew) {
      setBusy(true);
      try {
        const r = await fetch("/api/clinica/incidencias", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...fields, date }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "No se pudo crear");
        // Documentos en cola: se suben AHORA, que ya hay incidencia. Si alguno
        // falla, el modal pasa a modo edición (la incidencia YA existe) con el
        // fallo a la vista, en vez de cerrarse y perder el documento en silencio.
        const fallidos = [];
        for (const qd of queuedDocs) {
          try {
            await subirDoc(j.data.id, qd.file, qd.name);
          } catch {
            fallidos.push(qd);
          }
        }
        onSaved?.();
        if (fallidos.length) {
          setInc(j.data);
          setQueuedDocs(fallidos);
          setDocErr(`No se ${fallidos.length === 1 ? "pudo subir 1 documento" : `pudieron subir ${fallidos.length} documentos`}. La incidencia sí se ha creado; vuelve a intentarlo.`);
        } else {
          onClose?.();
        }
      } catch (e) {
        setErr(e.message);
      } finally {
        setBusy(false);
      }
    } else {
      const okp = await patch(fields);
      if (okp) setErr(null);
    }
  };

  const delIncidencia = async () => {
    if (!window.confirm("¿Eliminar esta incidencia del todo? No se puede deshacer.")) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/clinica/incidencias/${inc.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo eliminar");
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addComment = async () => {
    // Guard de busy también aquí: el botón se deshabilita, pero Enter en el
    // input llamaba directo y un doble Enter duplicaba el comentario.
    if (busy || !comment.trim()) return;
    const okp = await patch({ comment: comment.trim() });
    if (okp) setComment("");
  };

  const inputCls = "w-full px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400";

  // items-start SIEMPRE (31/08/2026): con lg:items-center, un modal más alto
  // que la ventana se centraba y su cabecera quedaba POR ENCIMA del área de
  // scroll — imposible de alcanzar sin hacer zoom. Es el patrón de
  // TiendaModule: arriba y con scroll del wrapper.
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => !busy && onClose?.()}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-lg text-[var(--ink-900)]">{isNew ? "Nueva incidencia" : "Incidencia"}</h3>
            {!isNew && <p className="text-[11px] text-neutral-400 mt-0.5">Registrada por {inc?.reportedBy?.name ?? "—"} · {fmt(inc?.createdAt)}</p>}
          </div>
          <button onClick={() => !busy && onClose?.()} className="p-1.5 text-neutral-400 hover:text-neutral-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Incidencia <span className="normal-case tracking-normal text-neutral-300">· descripción breve</span></label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={`mt-1 ${inputCls}`} placeholder="Qué ha pasado, en una línea" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Categoría</label>
              <Select value={category} onChange={(v) => { setCategory(v); setSubcategory(""); }}
                options={INCIDENCIA_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
                className={`mt-1 ${inputCls} bg-white`} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">
                Subcategoría
                {exigeSubcategoria(category) && (
                  <span className="normal-case tracking-normal text-neutral-300"> · especifica cuál</span>
                )}
              </label>
              {subs.length ? (
                <Select value={subcategory} onChange={setSubcategory}
                  options={[{ value: "", label: "—" }, ...subs.map((s) => ({ value: s, label: s }))]}
                  className={`mt-1 ${inputCls} bg-white`} />
              ) : (
                <input value={subcategory} onChange={(e) => setSubcategory(e.target.value)} className={`mt-1 ${inputCls}`}
                  placeholder={exigeSubcategoria(category) ? "De qué se trata" : "Opcional"} />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Prioridad</label>
              <Select value={priority} onChange={setPriority}
                options={Object.values(INCIDENCIA_PRIORITY).map((p) => ({ value: p.key, label: p.label }))}
                className={`mt-1 ${inputCls} bg-white`} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Fecha</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`mt-1 ${inputCls}`} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">
                Responsables
                {assigneeIds.length > 1 && <span className="ml-1 text-neutral-300">· {assigneeIds.length}</span>}
              </label>
              {/* Varias personas pueden estar al cargo de una misma incidencia
                  (sprint 2026-07-29). Desplegable desde el 26/08/2026: los
                  chips desbordaban la columna con equipos grandes. */}
              <div className="mt-1">
                <ResponsablesDropdown
                  therapists={therapists}
                  assigneeIds={assigneeIds}
                  onToggle={toggleAssignee}
                  inputCls={inputCls}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Paciente (si procede)</label>
              {/* Buscador que pregunta al SERVIDOR (31/08/2026): el desplegable
                  cargaba como mucho 1.000 y con los 1.174 de Aumenta unos 174
                  no salían — el mismo agujero ya arreglado en el alta de citas.
                  El selector de Citas vale tal cual (el parámetro es `q`). */}
              <SelectorPaciente
                value={patientId}
                onChange={setPatientId}
                onPaciente={(p) => setPacienteNombre(p?.name ?? null)}
                opcionesFijas={[{ value: "", label: "Ninguno" }]}
                placeholder="Ninguno"
                className={`mt-1 ${inputCls} bg-white`}
              />
            </div>
            <div>
              {/* Quién la registra sale relleno con quien está usando el CRM,
                  pero recepción apunta cosas que le cuenta otra persona. */}
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Quién la registra</label>
              <Select value={reportedById} onChange={setReportedById}
                options={[{ value: "", label: inc?.reportedBy?.name ?? "Yo" }, ...therapists.map((t) => ({ value: t.id, label: t.name }))]}
                className={`mt-1 ${inputCls} bg-white`} />
            </div>
          </div>

          {/* ── La FALTA (03/09/2026, AV-0038 de Aumenta) ──────────────────
              Solo en las incidencias que abre sola la agenda. Aquí se lleva su
              ciclo: qué huecos se le ofrecieron a la familia, qué contestó y
              cuándo recupera. Aceptar o rechazar cierra la incidencia. */}
          {!isNew && falta && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-wider text-amber-800">
                  Falta {falta.justificada ? "justificada" : "sin justificar"}
                </div>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                  falta.respuesta === "aceptada" ? "bg-emerald-50 text-emerald-700" : falta.respuesta === "rechazada" ? "bg-neutral-100 text-neutral-500" : "bg-amber-100 text-amber-800"
                }`}>
                  {RESPUESTAS_FALTA[falta.respuesta]?.label ?? RESPUESTAS_FALTA.pendiente.label}
                </span>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-neutral-400">Huecos ofrecidos a la familia</label>
                <TextareaCrece
                  value={falta.huecosOfrecidos ?? ""}
                  onChange={(e) => setFalta({ ...falta, huecosOfrecidos: e.target.value })}
                  rows={2}
                  className={`mt-1 ${inputCls}`}
                  placeholder="Ej.: lunes 8 a las 17:00, miércoles 10 a las 18:00, viernes 12 a las 16:30"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-neutral-400">Respuesta de la familia</label>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {Object.entries(RESPUESTAS_FALTA).map(([k, v]) => (
                      <button
                        key={k}
                        type="button"
                        disabled={busy}
                        onClick={() => setFalta({ ...falta, respuesta: k })}
                        className={`text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                          falta.respuesta === k
                            ? k === "aceptada" ? "bg-emerald-500 text-white" : k === "rechazada" ? "bg-neutral-500 text-white" : "bg-amber-500 text-white"
                            : "bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-300"
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-neutral-400">Cita de recuperación</label>
                  <input
                    type="date"
                    value={falta.fechaRecuperacion ?? ""}
                    onChange={(e) => setFalta({ ...falta, fechaRecuperacion: e.target.value || null })}
                    className={`mt-1 ${inputCls}`}
                    disabled={falta.respuesta === "rechazada"}
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-neutral-400">Nota</label>
                <TextareaCrece
                  value={falta.nota ?? ""}
                  onChange={(e) => setFalta({ ...falta, nota: e.target.value })}
                  rows={2}
                  className={`mt-1 ${inputCls}`}
                  placeholder="Lo que haya que recordar de esta falta…"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-neutral-400">
                  Aceptada o rechazada cierran la falta; «Sin respuesta» la deja pendiente.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => patch({ falta: { huecosOfrecidos: falta.huecosOfrecidos ?? "", respuesta: falta.respuesta, fechaRecuperacion: falta.fechaRecuperacion ?? null, nota: falta.nota ?? "" } })}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}
                >
                  Guardar falta
                </button>
              </div>
            </div>
          )}

          <div>
            {/* La columna existía desde el principio; el formulario no la
                enseñaba, así que no había forma de escribirla (04/08/2026). */}
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Acción realizada</label>
            {/* Crece con el texto (03/09/2026, AV-0036): quien la RECIBE leía
                doce líneas por una ranura de dos. */}
            <TextareaCrece value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} className={`mt-1 ${inputCls}`} placeholder="Qué se ha hecho para resolverla…" />
          </div>

          {/* Verificación: en las existentes se guarda al pulsar (es lo que se
              toca a diario); en una nueva viaja con el resto del formulario. */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Verificación</label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {VERIF_BTN.map((v) => {
                const actual = (isNew ? verification : (inc?.verification ?? "")) === v.key;
                return (
                  <button key={v.key || "sin"} type="button" disabled={busy}
                    onClick={() => {
                      setVerification(v.key);
                      if (!isNew) patch({ verification: v.key || null });
                    }}
                    className={`text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${actual ? v.on : v.off}`}>
                    {v.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-neutral-400 mt-1.5">
              Mueve sola el estado: resuelta la cierra, parcial y no resuelta la dejan en proceso.
            </p>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Observaciones</label>
            <TextareaCrece value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={`mt-1 ${inputCls}`} placeholder="Contexto, detalle, lo que haga falta recordar…" />
          </div>

          {/* Documentos adjuntos (26/08/2026, Aumenta): justificantes, fotos,
              informes. Con paciente, el documento se ve también en su ficha;
              sin él, queda como interno en el archivo de Documentos. */}
          <div className="border-t border-neutral-100 pt-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400">
                Documentos
                {docs.length > 0 && <span className="ml-1 text-neutral-300">· {docs.length}</span>}
              </div>
              <input ref={docFileRef} type="file" className="hidden" onChange={pickDocFile} />
              <button
                type="button"
                onClick={() => docFileRef.current?.click()}
                disabled={docBusy}
                className="text-[11px] font-medium px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
              >
                Adjuntar documento
              </button>
            </div>
            <p className="text-[10px] text-neutral-400 mb-2">
              {patientId
                ? `Se guarda también en la ficha de ${pacienteNombre ?? patients.find((p) => p.id === patientId)?.name ?? "su paciente"}.`
                : "Sin paciente, queda como documento interno en el archivo de Documentos."}
            </p>
            {docs.length === 0 && queuedDocs.length === 0 && <p className="text-[11px] text-neutral-400">Sin documentos.</p>}
            {docs.length > 0 && (
              <ul className="space-y-1.5 mb-2">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 rounded-lg bg-neutral-50 border border-neutral-100 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-neutral-700 truncate">{d.name}</div>
                      <div className="text-[10px] text-neutral-400">
                        {fmtSize(d.fileSize)}
                        {d.patientId ? " · en la ficha del paciente" : ""}
                      </div>
                    </div>
                    <a
                      href={`/api/clinica/incidencias/${inc?.id}/documents/${d.id}/download`}
                      className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline shrink-0"
                    >
                      Descargar
                    </a>
                    <button type="button" onClick={() => delDoc(d.id)} disabled={docBusy} className="text-[11px] text-rose-500 hover:underline shrink-0 disabled:opacity-50">
                      Eliminar
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {queuedDocs.length > 0 && (
              <ul className="space-y-1.5">
                {queuedDocs.map((qd, i) => (
                  <li key={`${qd.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-dashed border-neutral-200 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-neutral-700 truncate">{qd.name}</div>
                      <div className="text-[10px] text-neutral-400">
                        {fmtSize(qd.file.size)}
                        {isNew ? " · se subirá al crear la incidencia" : ""}
                      </div>
                    </div>
                    {!isNew && (
                      <button type="button" disabled={docBusy} onClick={() => retryQueuedDoc(i)} className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline shrink-0 disabled:opacity-50">
                        Subir
                      </button>
                    )}
                    <button type="button" onClick={() => setQueuedDocs((q) => q.filter((_, x) => x !== i))} className="text-[11px] text-neutral-400 hover:underline shrink-0">
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {docErr && <div className="mt-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{docErr}</div>}
          </div>

          {/* Comentarios (solo existentes) */}
          {!isNew && (
            <div className="border-t border-neutral-100 pt-3">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-2">Comentarios</div>
              <div className="space-y-2 mb-2 max-h-40 overflow-y-auto">
                {(inc?.comments ?? []).length === 0 && <p className="text-[11px] text-neutral-400">Sin comentarios.</p>}
                {(inc?.comments ?? []).map((c, i) => (
                  <div key={i} className="rounded-lg bg-neutral-50 border border-neutral-100 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-neutral-700">{c.authorName}</span>
                      <span className="text-[10px] text-neutral-400">{fmtDT(c.at)}</span>
                    </div>
                    <p className="text-xs text-neutral-600 mt-0.5 whitespace-pre-wrap">{c.text}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addComment()} className={inputCls} placeholder="Escribe un comentario y pulsa Enter" />
                <button disabled={busy || !comment.trim()} onClick={addComment} className="text-[11px] px-3 py-2 rounded-lg text-white disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>Añadir</button>
              </div>
            </div>
          )}

          {err && <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{err}</div>}
        </div>

        <div className="px-5 py-4 border-t border-neutral-100 flex items-center justify-between gap-2">
          <div>
            {puedeBorrar && (
              <button onClick={delIncidencia} disabled={busy} title="Borra la incidencia del todo (por ejemplo, una abierta por error)" className="text-[11px] font-medium text-rose-600 border border-rose-200 rounded-lg px-3 py-1.5 hover:bg-rose-50 disabled:opacity-50">Eliminar incidencia</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => !busy && onClose?.()} disabled={busy} className="px-4 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">Cerrar</button>
            <button onClick={createOrSaveFields} disabled={busy} className="px-4 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>
              {busy ? "Guardando…" : isNew ? "Crear incidencia" : "Guardar cambios"}
            </button>
          </div>
        </div>

        {/* Modal de NOMBRE obligatorio al adjuntar (mismo patrón que la ficha
            de paciente: el buscador del archivo filtra por este nombre). */}
        {pendingDoc && (
          <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center p-4 overflow-y-auto" style={{ background: "rgba(0,0,0,0.45)" }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5">
              <div className="text-sm font-semibold text-neutral-800 mb-1">Nombre del documento</div>
              <div className="text-xs text-neutral-500 mb-3 truncate">Archivo: {pendingDoc.file.name}</div>
              <input
                autoFocus
                value={pendingName}
                onChange={(e) => setPendingName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") confirmDocUpload(); }}
                placeholder="Ej. Justificante, foto del material…"
                className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm"
              />
              {docErr && <div className="text-xs text-rose-600 mt-2">{docErr}</div>}
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => { setPendingDoc(null); setPendingName(""); setDocErr(null); resetDocInput(); }}
                  disabled={docBusy}
                  className="text-xs font-medium px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-600"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmDocUpload}
                  disabled={docBusy}
                  className="text-xs font-medium px-3 py-1.5 rounded-md text-white disabled:opacity-50"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}
                >
                  {docBusy ? "Subiendo…" : isNew ? "Añadir" : "Subir"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
