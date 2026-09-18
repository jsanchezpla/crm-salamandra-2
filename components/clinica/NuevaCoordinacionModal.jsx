"use client";

/**
 * NuevaCoordinacionModal — alta de una coordinación (sprint Aumenta 2026-07,
 * punto 7). Lo comparten las DOS puertas de entrada que pidió Rodrigo:
 * el módulo «Coordinaciones» (con selector de paciente) y la ficha del paciente
 * (con el paciente ya fijado).
 *
 * Interna = entre el propio equipo. Externa = con el colegio, el psiquiatra, el
 * EOEP… y entonces se pregunta CON QUIÉN (`externalEntity`), que es lo que se
 * busca después: «¿qué hablamos con el colegio de este niño?».
 *
 * `createdById` no se manda: lo resuelve el servidor con el usuario de la
 * sesión. La pantalla no tiene por qué saber ids de fichas de equipo. Sí hay un
 * campo de NOMBRE libre («La registró»), para la reunión que llevó alguien sin
 * ficha de equipo; si se deja vacío manda el usuario de la sesión.
 *
 * Desde el 18/09/2026 (AV-0102) el mismo formulario CORRIGE un acta ya
 * registrada: con `coordinacion` puesta, se rellena con lo que hay y manda un
 * PATCH a `/api/clinica/coordinations/[id]` en vez de un POST. Se reutiliza y
 * no se escribe un editor aparte porque los campos son exactamente los mismos,
 * y dos formularios para la misma acta acaban admitiendo cosas distintas.
 *
 * Temas, acuerdos y próximos pasos se mandan como TEXTO y los trocea el
 * servidor por líneas (`lib/clinica/actaCoordinacion.js`, 13/09/2026): la coma
 * no parte la frase.
 */

import { useEffect, useRef, useState } from "react";

const TIPOS = [
  { key: "family", label: "Familia" },
  { key: "school", label: "Colegio" },
  { key: "psychiatrist", label: "Psiquiatría" },
  { key: "neuropediatrician", label: "Neuropediatría" },
  { key: "other_therapist", label: "Otro terapeuta" },
  { key: "orientator", label: "Orientación" },
  { key: "other", label: "Otro" },
];

const VACIO = {
  coordinationType: "school",
  scope: "external",
  externalEntity: "",
  // Contacto de la agenda del paciente con el que se coordina. Vacío = sin
  // especificar; el enlace es opcional.
  externalContactId: "",
  coordinationDate: new Date().toISOString().slice(0, 10),
  relatedPatientId: "",
  participants: "",
  topics: "",
  agreements: "",
  nextActions: "",
  // Vacío = lo registra quien está usando el CRM. Ver el campo en el formulario.
  createdByName: "",
};

/**
 * Del acta guardada al formulario. El servidor devuelve listas (`agreements`,
 * `nextActions`, `topicsList`) y el formulario escribe texto con una línea por
 * punto: es el troceo del alta al revés, así que corregir un acta no reescribe
 * lo que no se toca.
 */
function comoFormulario(c) {
  const lineas = (v) => (Array.isArray(v) ? v.filter(Boolean).join("\n") : v || "");
  return {
    coordinationType: c.type ?? "school",
    scope: c.scope ?? "external",
    externalEntity: c.externalEntity ?? "",
    externalContactId: c.externalContactId ?? "",
    coordinationDate: c.date ? String(c.date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    relatedPatientId: c.relatedPatientId ?? "",
    // Los asistentes van por comas en el campo, como dice su rótulo. Si el acta
    // los trae estructurados (las importadas de Organízate), se pinta el
    // nombre: el papel de cada uno vive en el contacto, no aquí.
    participants: Array.isArray(c.participantsList)
      ? c.participantsList.map((x) => (x && typeof x === "object" ? x.name : x)).filter(Boolean).join(", ")
      : c.participants ?? "",
    topics: lineas(c.topicsList?.length ? c.topicsList : c.topics),
    agreements: lineas(c.agreements),
    nextActions: lineas(c.nextActions),
    createdByName: c.createdByName ?? "",
  };
}

export default function NuevaCoordinacionModal({ coordinacion = null, patientId = null, patientName = null, onClose, onCreada }) {
  const editando = Boolean(coordinacion?.id);
  const [form, setForm] = useState(
    editando ? comoFormulario(coordinacion) : { ...VACIO, relatedPatientId: patientId ?? "" }
  );
  const [pacientes, setPacientes] = useState([]);
  const [contactos, setContactos] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  // Solo hace falta la lista si no venimos de la ficha de un paciente.
  useEffect(() => {
    if (patientId) return;
    fetch("/api/pacientes?limit=300", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setPacientes(j?.data?.patients ?? []))
      .catch(() => {});
  }, [patientId]);

  // Agenda de contactos externos DEL PACIENTE elegido. Se recarga al cambiar de
  // paciente: enseñar la agenda de otro niño sería, además de inútil, una fuga
  // de datos entre familias.
  const pacienteElegido = form.relatedPatientId;
  // Al CORREGIR, el contacto que ya traía el acta no se pierde: el efecto de
  // abajo corre también en el primer render, y sin esta marca dejaría el
  // desplegable en «Sin especificar» sin que nadie lo hubiera tocado —y el
  // PATCH lo guardaría así—. Solo se respeta la primera vez: si luego se cambia
  // de paciente, el contacto de la agenda del otro niño SÍ tiene que irse.
  const contactoOriginal = useRef(editando ? coordinacion.externalContactId ?? "" : "");
  useEffect(() => {
    setContactos([]);
    // `setForm` directo y no el helper `set`: ese se declara MÁS ABAJO, y
    // aunque en la práctica funcione (el efecto corre después del render, con
    // `set` ya asignado), depender de ese orden es una trampa para el próximo
    // que mueva las líneas.
    setForm((f) => ({ ...f, externalContactId: contactoOriginal.current }));
    contactoOriginal.current = "";
    if (!pacienteElegido) return;
    fetch(`/api/pacientes/${pacienteElegido}/contactos`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setContactos(j?.data?.contactos ?? []))
      .catch(() => {});
  }, [pacienteElegido]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function guardar() {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch(editando ? `/api/clinica/coordinations/${coordinacion.id}` : "/api/clinica/coordinations", {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          relatedPatientId: form.relatedPatientId || null,
          externalEntity: form.scope === "external" ? form.externalEntity : null,
          // En una coordinación interna no hay contacto externo que valga.
          externalContactId: form.scope === "external" ? form.externalContactId || null : null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar la coordinación");
      onCreada?.(j.data);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  const input = "w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-neutral-400";
  const label = "block text-[10px] uppercase tracking-wider text-neutral-400 mb-1";

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={guardando ? undefined : onClose} aria-hidden="true" />
      <div className="fixed inset-x-0 top-14 lg:top-8 bottom-0 lg:bottom-8 z-50 flex items-start justify-center px-4 overflow-y-auto">
        <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl p-5 lg:p-6 my-4">
          <h2 className="font-display text-lg text-[var(--ink-900)] mb-1">{editando ? "Corregir coordinación" : "Nueva coordinación"}</h2>
          <p className="text-[11px] text-neutral-500 mb-4">
            {patientName ? `Sobre ${patientName}.` : "Con quién se ha hablado, qué se acordó y qué queda por hacer."}
          </p>

          <div className="space-y-3">
            {!patientId && (
              <div>
                <label className={label}>Paciente (opcional)</label>
                <select className={input} value={form.relatedPatientId} onChange={(e) => set("relatedPatientId", e.target.value)}>
                  <option value="">Sin paciente (reunión de equipo)</option>
                  {pacientes.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Tipo</label>
                <select className={input} value={form.coordinationType} onChange={(e) => set("coordinationType", e.target.value)}>
                  {TIPOS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Fecha</label>
                <input type="date" className={input} value={form.coordinationDate} onChange={(e) => set("coordinationDate", e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Ámbito</label>
                <select className={input} value={form.scope} onChange={(e) => set("scope", e.target.value)}>
                  <option value="external">Externa</option>
                  <option value="internal">Interna (equipo)</option>
                </select>
              </div>
              {form.scope === "external" && (
                <div>
                  <label className={label}>¿Con quién?</label>
                  <input className={input} placeholder="CEIP Las Acacias, Dra. Pérez…" value={form.externalEntity} onChange={(e) => set("externalEntity", e.target.value)} />
                </div>
              )}
            </div>

            {/* Contacto de la agenda del paciente. Solo aparece si ese paciente
                tiene contactos dados de alta: un desplegable vacío en mitad del
                formulario solo genera la duda de qué falta rellenar. */}
            {form.scope === "external" && contactos.length > 0 && (
              <div>
                <label className={label}>Contacto de referencia</label>
                <select className={input} value={form.externalContactId} onChange={(e) => set("externalContactId", e.target.value)}>
                  <option value="">Sin especificar</option>
                  {contactos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.role ? ` · ${c.role}` : ""}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-neutral-400 mt-1">
                  De la agenda de contactos externos del paciente. Se gestiona en su ficha.
                </p>
              </div>
            )}

            <div>
              <label className={label}>Participantes · separados por comas</label>
              <input className={input} value={form.participants} onChange={(e) => set("participants", e.target.value)} />
            </div>
            <div>
              <label className={label}>Temas tratados · uno por línea</label>
              <textarea
                rows={3}
                className={input}
                placeholder={"Adaptaciones en el aula\nConducta en el recreo"}
                value={form.topics}
                onChange={(e) => set("topics", e.target.value)}
              />
            </div>
            <div>
              <label className={label}>Acuerdos · uno por línea</label>
              <textarea
                rows={3}
                className={input}
                placeholder={"Reforzar pautas en casa, revisar en un mes\nAmpliar el tiempo de los exámenes"}
                value={form.agreements}
                onChange={(e) => set("agreements", e.target.value)}
              />
              <p className="text-[10px] text-neutral-400 mt-1">Cada línea es un punto del acta. Las comas no parten la frase.</p>
            </div>
            <div>
              <label className={label}>Próximos pasos · uno por línea</label>
              <textarea
                rows={3}
                className={input}
                placeholder="Enviar las pautas por escrito al colegio"
                value={form.nextActions}
                onChange={(e) => set("nextActions", e.target.value)}
              />
            </div>
            {/* Quién la registró, en texto libre. Normalmente NO hace falta: el
                servidor pone al usuario de la sesión. Está para la reunión que
                llevó alguien sin ficha de equipo —un sustituto, un profesional
                de fuera— y para las actas traídas de otro programa. */}
            <div>
              <label className={label}>La registró (opcional)</label>
              <input
                className={input}
                placeholder="Se pone tu nombre si lo dejas vacío"
                value={form.createdByName}
                onChange={(e) => set("createdByName", e.target.value)}
              />
            </div>
          </div>

          {error && <div className="mt-3 text-[11px] text-rose-600">{error}</div>}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button onClick={onClose} disabled={guardando} className="text-xs text-neutral-500 px-3 py-2 disabled:opacity-50">Cancelar</button>
            <button
              onClick={guardar}
              disabled={guardando}
              className="text-xs font-medium px-4 py-2 rounded-lg text-white disabled:opacity-50"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Registrar coordinación"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
