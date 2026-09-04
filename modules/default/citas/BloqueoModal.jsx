"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import LectoresPicker from "@/components/documents/LectoresPicker.jsx";
import { inputCls, toDateInput, toTimeInput } from "./chips.jsx";
import { leerRespuestaApi } from "@/lib/utils/respuestaApi.js";

/**
 * El modal pequeño de un bloqueo pulsado en el calendario (31/08/2026,
 * Rodrigo): cambiar la categoría, el concepto, la fecha y la duración sin ir a
 * la pestaña de Bloqueos. Se apoya en el PATCH de /api/citas/bloqueos, que ya
 * pone las vallas (cada cual toca lo suyo, los cierres del centro solo
 * dirección): aquí un 403 solo se enseña.
 *
 * `categorias` son las del centro (01/09/2026), tal como las devuelve el
 * listado de bloqueos. Vacías —el centro no las usa— y el desplegable no se
 * enseña: el modal se queda exactamente como estaba.
 *
 * ── Y LOS DOCUMENTOS DEL TRAMO (01/09/2026, Rodrigo) ───────────────────────
 * «Quiero poder aparejarlo a un bloqueo concreto, por ejemplo el miércoles 2 en
 * la Reunión de equipo de 12:00-13:00, para que si entran en la cita del
 * bloqueo vean el documento aparejado. También se tiene que poder hacer a la
 * inversa, subir el documento a través del modal de ese bloqueo concreto.»
 *
 * Esta es la parte de abajo: lo que cuelga del tramo, con quién tiene que
 * leerlo. Se sube AQUÍ mismo, eligiendo a la vez a los lectores — que es lo que
 * evita el paso que nadie da: subirlo y luego acordarse de avisar.
 *
 * Los documentos van al ARCHIVO CENTRAL como todos los demás; este modal es
 * solo la puerta del bloqueo (ver `/api/citas/bloqueos/[id]/documents`).
 */

const fmtSize = (n) => {
  const kb = Number(n || 0) / 1024;
  return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1)} MB`;
};

export function BloqueoModal({ bloqueo, categorias = [], equipo = [], administracion = [], onClose, onSaved }) {
  const [label, setLabel] = useState(bloqueo.label ?? "");
  const [categoryKey, setCategoryKey] = useState(bloqueo.categoryKey ?? "");
  const [startDate, setStartDate] = useState(toDateInput(bloqueo.start));
  const [startTime, setStartTime] = useState(toTimeInput(bloqueo.start));
  const [endDate, setEndDate] = useState(toDateInput(bloqueo.end));
  const [endTime, setEndTime] = useState(toTimeInput(bloqueo.end));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // ── Documentos aparejados ────────────────────────────────────────────────
  const [docs, setDocs] = useState([]);
  const [docBusy, setDocBusy] = useState(false);
  const [docErr, setDocErr] = useState(null);
  // Un archivo elegido y aún sin subir: se le pone nombre y lectores antes.
  const [pendiente, setPendiente] = useState(null); // { file, nombre, lectores: [] }
  // Qué documento tiene abierto el panel de «¿quién lo lee?».
  const [editandoLectores, setEditandoLectores] = useState(null); // { docId, lectores: [] }
  const fileRef = useRef(null);

  const cargarDocs = useCallback(() => {
    fetch(`/api/citas/bloqueos/${bloqueo.id}/documents`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setDocs(j.data.documents ?? []); })
      .catch(() => {});
  }, [bloqueo.id]);
  useEffect(() => { cargarDocs(); }, [cargarDocs]);

  async function guardar() {
    setErr(null);
    const inicio = new Date(`${startDate}T${startTime || "00:00"}`);
    const fin = new Date(`${endDate}T${endTime || "00:00"}`);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
      setErr("Fecha u hora ilegibles");
      return;
    }
    if (fin <= inicio) {
      setErr("El fin tiene que ser posterior al inicio");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/citas/bloqueos?id=${bloqueo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Vacío se queda vacío (03/09/2026, Aumenta): el motivo es opcional
          // y el CRM no lo rellena por su cuenta con «Vacaciones».
          label: label.trim(),
          // Vacía = quitarle la categoría. El servidor descarta la que no esté
          // dada de alta, así que aquí no hace falta validar nada.
          categoryKey: categoryKey || null,
          // `tallerId` NO viaja: los talleres dejaron de ser bloqueos el
          // 01/09/2026 y este modal ya no lo toca. La columna sigue ahí y lo
          // que hubiera guardado se queda como está, que es lo que hay que
          // hacer con un dato que ya nadie escribe pero alguien pudo escribir.
          startAt: inicio.toISOString(),
          endAt: fin.toISOString(),
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar");
      onSaved();
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  }

  function elegirArchivo() {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    setDocErr(null);
    // El nombre del fichero es el punto de partida, sin extensión: la pone el
    // servidor al guardar, para que la descarga siga teniendo tipo.
    setPendiente({ file: f, nombre: f.name.replace(/\.[^.]+$/, ""), lectores: [] });
  }

  function limpiarInput() {
    if (fileRef.current) fileRef.current.value = "";
  }

  async function subir() {
    if (!pendiente) return;
    const nombre = pendiente.nombre.trim();
    if (!nombre) { setDocErr("El nombre es obligatorio"); return; }
    setDocBusy(true); setDocErr(null);
    try {
      const fd = new FormData();
      fd.append("file", pendiente.file);
      fd.append("name", nombre);
      fd.append("lectores", JSON.stringify(pendiente.lectores));
      const r = await fetch(`/api/citas/bloqueos/${bloqueo.id}/documents`, { method: "POST", body: fd });
      const j = await leerRespuestaApi(r, { siGrande: "El archivo pesa demasiado. El tope son 25 MB por documento." });
      if (!r.ok) throw new Error(j.error || "No se pudo subir el documento");
      setPendiente(null);
      limpiarInput();
      cargarDocs();
    } catch (e) {
      setDocErr(e.message);
    } finally {
      setDocBusy(false);
    }
  }

  async function guardarLectores() {
    if (!editandoLectores) return;
    setDocBusy(true); setDocErr(null);
    try {
      const r = await fetch("/api/documents/lecturas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: editandoLectores.docId, teamMemberIds: editandoLectores.lectores }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "No se pudo guardar quién tiene que leerlo");
      setEditandoLectores(null);
      cargarDocs();
    } catch (e) {
      setDocErr(e.message);
    } finally {
      setDocBusy(false);
    }
  }

  async function quitarDoc(docId) {
    if (!window.confirm("¿Quitar este documento del bloqueo? Se elimina también del archivo.")) return;
    setDocBusy(true); setDocErr(null);
    try {
      const r = await fetch(`/api/citas/bloqueos/${bloqueo.id}/documents/${docId}`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "No se pudo quitar");
      }
      cargarDocs();
    } catch (e) {
      setDocErr(e.message);
    } finally {
      setDocBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !saving && onClose()} />
      {/* items-start + overflow-y-auto, no centrado en alto: la lección del
          modal de incidencias (31/08/2026) — centrado, en pantallas grandes se
          cortaba por arriba. */}
      <div className="fixed top-14 lg:top-0 inset-x-0 bottom-0 z-50 flex items-start justify-center pt-16 px-4 overflow-y-auto pointer-events-none">
        <div className="bg-white rounded-xl shadow-pop w-full max-w-md pointer-events-auto mb-10">
          <div className="px-5 pt-4 pb-3 border-b border-neutral-100">
            <div className="eyebrow">Bloqueo</div>
            {/* En la agenda el bloqueo solo dice su categoría (03/09/2026,
                Aumenta); el motivo y de quién es se leen AQUÍ, en el modal. */}
            <h3 className="font-display text-lg text-neutral-900 mt-0.5 truncate">{bloqueo.titulo}</h3>
            {bloqueo.subtitulo && (
              <p className="text-[11.5px] text-neutral-500 mt-0.5 truncate">{bloqueo.subtitulo}</p>
            )}
          </div>
          <div className="px-5 py-4 space-y-3">
            {categorias.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Categoría</label>
                <select
                  value={categoryKey}
                  onChange={(e) => setCategoryKey(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Sin categoría</option>
                  {categorias.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </div>
            )}
            {/*
              ── UN TALLER YA NO ES UN BLOQUEO (01/09/2026, Rodrigo) ──────────
              Aquí había un desplegable para decir «este tramo es el taller de
              habilidades sociales». Duró un día: «hay que preparar los talleres
              de tal forma que en las citas se pueda seleccionar los talleres.
              **No como bloqueos sino como un tipo más de cita**».

              Y tenía razón. Un bloqueo es una hora tachada: no tiene
              asistentes, no se cobra, no se le pasa lista y no llega a la
              historia de ningún niño. Ahora cada grupo de taller tiene su tipo
              de cita y se apunta en la agenda como cualquier otra.

              Solo se enseña este aviso a quien tenga un bloqueo de los de
              entonces —en producción no hay ninguno—, para que sepa dónde ha
              ido a parar aquello. Cuando no queden, este bloque se cae solo.
            */}
            {bloqueo.tallerId && (
              <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                Este tramo estaba marcado como taller. Los talleres ya no se apuntan como bloqueos: se
                crean como un tipo de cita más desde{" "}
                <a href="/clinica/talleres" className="underline hover:no-underline">Clínica → Talleres</a>.
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-neutral-500 mb-1">Motivo (opcional)</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} placeholder="Sin motivo" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Empieza</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Hora</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Termina</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Hora</label>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
              </div>
            </div>
            {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{err}</div>}

            {/* ── Documentos del tramo ───────────────────────────────────── */}
            <div className="pt-3 border-t border-neutral-100">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[11px] font-medium text-neutral-500">Documentos</label>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={docBusy || !!pendiente}
                  className="text-[11px] font-semibold text-[var(--color-primary,#1B3A2D)] hover:underline disabled:opacity-40"
                >
                  + Adjuntar
                </button>
              </div>
              <input ref={fileRef} type="file" className="hidden" onChange={elegirArchivo} />

              {docs.length === 0 && !pendiente && (
                <p className="text-[11px] text-neutral-400">
                  Nada aparejado a este bloqueo. Lo que subas aquí lo verá quien abra el tramo en la agenda.
                </p>
              )}

              {docs.map((d) => {
                const editando = editandoLectores?.docId === d.id;
                return (
                  <div key={d.id} className="border-t border-neutral-100 py-2 first:border-t-0">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-neutral-800 truncate">{d.name}</div>
                        <div className="text-[10px] text-neutral-400">
                          {fmtSize(d.fileSize)}
                          {d.lectura.total > 0 &&
                            ` · leído por ${d.lectura.leidas} de ${d.lectura.total}`}
                        </div>
                      </div>
                      <a
                        href={`/api/citas/bloqueos/${bloqueo.id}/documents/${d.id}/download`}
                        title="Descargar"
                        className="shrink-0 text-[11px] text-neutral-500 hover:text-neutral-900"
                      >
                        Abrir
                      </a>
                      <button
                        type="button"
                        onClick={() =>
                          setEditandoLectores(
                            editando
                              ? null
                              : { docId: d.id, lectores: d.lectores.map((l) => l.teamMemberId) }
                          )
                        }
                        className="shrink-0 text-[11px] text-neutral-500 hover:text-neutral-900"
                      >
                        Quién lo lee
                      </button>
                      <button
                        type="button"
                        onClick={() => quitarDoc(d.id)}
                        disabled={docBusy}
                        title="Quitar"
                        className="shrink-0 text-[11px] text-neutral-400 hover:text-rose-600 disabled:opacity-40"
                      >
                        ×
                      </button>
                    </div>
                    {d.lectura.total > 0 && !editando && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {d.lectores.map((l) => (
                          <span
                            key={l.teamMemberId}
                            className={`text-[9px] rounded-full px-1.5 py-0.5 ${
                              l.leido ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {l.nombre || "—"}
                          </span>
                        ))}
                      </div>
                    )}
                    {editando && (
                      <div className="mt-2 space-y-2">
                        <LectoresPicker
                          equipo={equipo.length ? equipo : null}
                          administracion={equipo.length ? administracion : null}
                          valor={editandoLectores.lectores}
                          leidos={d.lectores.filter((l) => l.leido).map((l) => l.teamMemberId)}
                          onChange={(ids) => setEditandoLectores((p) => ({ ...p, lectores: ids }))}
                          disabled={docBusy}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditandoLectores(null)}
                            className="text-[11px] text-neutral-400 hover:text-neutral-700"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={guardarLectores}
                            disabled={docBusy}
                            className="text-[11px] font-semibold text-[var(--color-primary,#1B3A2D)] hover:underline disabled:opacity-40"
                          >
                            {docBusy ? "Guardando…" : "Guardar"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* El archivo elegido, antes de subirlo: nombre + a quién se le
                  pide que lo lea. Las dos cosas de una vez, que es lo que evita
                  subirlo y no avisar a nadie. */}
              {pendiente && (
                <div className="mt-2 rounded-lg border border-neutral-200 p-2.5 space-y-2">
                  <div className="text-[10px] text-neutral-400 truncate">Archivo: {pendiente.file.name}</div>
                  <input
                    autoFocus
                    value={pendiente.nombre}
                    onChange={(e) => setPendiente((p) => ({ ...p, nombre: e.target.value }))}
                    placeholder="Nombre del documento"
                    maxLength={200}
                    className={inputCls}
                  />
                  <div>
                    <div className="text-[10px] text-neutral-500 mb-1">¿Quién tiene que leerlo?</div>
                    <LectoresPicker
                      equipo={equipo.length ? equipo : null}
                      administracion={equipo.length ? administracion : null}
                      valor={pendiente.lectores}
                      onChange={(ids) => setPendiente((p) => ({ ...p, lectores: ids }))}
                      disabled={docBusy}
                    />
                    <p className="text-[10px] text-neutral-400 mt-1">
                      A quien marques le saldrá el aviso en su pantalla de inicio hasta que lo abra.
                    </p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => { setPendiente(null); limpiarInput(); }}
                      disabled={docBusy}
                      className="text-[11px] text-neutral-400 hover:text-neutral-700 disabled:opacity-40"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={subir}
                      disabled={docBusy}
                      className="text-[11px] font-semibold text-[var(--color-primary,#1B3A2D)] hover:underline disabled:opacity-40"
                    >
                      {docBusy ? "Subiendo…" : "Subir"}
                    </button>
                  </div>
                </div>
              )}

              {docErr && (
                <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{docErr}</div>
              )}
            </div>
          </div>
          <div className="px-5 py-3 border-t border-neutral-100 flex justify-end gap-2">
            <button type="button" onClick={() => !saving && onClose()}
              className="px-3 py-1.5 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
              Cancelar
            </button>
            <button type="button" onClick={guardar} disabled={saving}
              className="px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50 transition"
              style={{ background: "var(--color-primary, #1B3A2D)" }}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
