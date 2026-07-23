"use client";

/**
 * PatientDocumentsSection — panel "Documentos" de la ficha de un paciente.
 *
 * Dos secciones:
 *   1. Contrato ESTÁNDAR de la clínica (uno para todos; se sube una vez).
 *   2. Documentos DEL paciente: buscador (escribe el nombre y filtra) + subir.
 *
 * Al subir cualquier documento, un modal pide el NOMBRE (obligatorio).
 */

import { useCallback, useEffect, useRef, useState } from "react";

function fmtSize(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PatientDocumentsSection({ patientId }) {
  const [docs, setDocs] = useState([]);
  const [q, setQ] = useState("");
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Modal de nombre al subir. `pending` = { file, target: 'paciente'|'contrato' }.
  const [pending, setPending] = useState(null);
  const [pendingName, setPendingName] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const templateFileRef = useRef(null);

  const loadDocs = useCallback(
    (query = "") => {
      const url = `/api/pacientes/${patientId}/documents${query ? `?q=${encodeURIComponent(query)}` : ""}`;
      fetch(url, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { if (j.ok) setDocs(j.data.documents || []); })
        .catch(() => {});
    },
    [patientId]
  );

  const loadTemplate = useCallback(() => {
    fetch(`/api/pacientes/contract-template`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setTemplate(j.data.template); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadDocs(), loadTemplate()]);
    setLoading(false);
  }, [loadDocs, loadTemplate]);

  // Buscador con pequeño debounce.
  useEffect(() => {
    const t = setTimeout(() => loadDocs(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q, loadDocs]);

  function pickFile(target, ref) {
    const f = ref.current?.files?.[0];
    if (!f) return;
    // Nombre por defecto = nombre del fichero sin extensión.
    const base = f.name.replace(/\.[^.]+$/, "");
    setPending({ file: f, target });
    setPendingName(target === "contrato" ? "Contrato estándar" : base);
    setError(null);
  }

  async function confirmUpload() {
    if (!pending) return;
    const name = pendingName.trim();
    if (!name) { setError("El nombre es obligatorio"); return; }
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", pending.file);
      fd.append("name", name);
      const url =
        pending.target === "contrato"
          ? `/api/pacientes/contract-template`
          : `/api/pacientes/${patientId}/documents`;
      const r = await fetch(url, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo subir el documento");
      setPending(null);
      setPendingName("");
      if (fileRef.current) fileRef.current.value = "";
      if (templateFileRef.current) templateFileRef.current.value = "";
      if (pending.target === "contrato") loadTemplate();
      else loadDocs(q.trim());
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteDoc(docId) {
    if (!window.confirm("¿Eliminar este documento?")) return;
    try {
      const r = await fetch(`/api/pacientes/${patientId}/documents/${docId}`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) throw new Error("No se pudo eliminar");
      loadDocs(q.trim());
    } catch (e) {
      setError(e.message);
    }
  }

  const btn = "text-xs font-medium px-3 py-1.5 rounded-md";

  return (
    <div className="space-y-6">
      {/* 1. Contrato estándar de la clínica */}
      <div className="bg-white border border-neutral-200 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold text-neutral-800">Contrato estándar de la clínica</div>
            <div className="text-xs text-neutral-500 mt-0.5">
              El mismo para todos los pacientes. No hace falta subirlo en cada ficha.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {template ? (
              <a
                href={`/api/pacientes/contract-template/download`}
                className={`${btn} bg-neutral-100 text-neutral-700 hover:bg-neutral-200`}
              >
                Descargar
              </a>
            ) : (
              <span className="text-xs text-neutral-400 italic">Aún no configurado</span>
            )}
            <input ref={templateFileRef} type="file" className="hidden" onChange={() => pickFile("contrato", templateFileRef)} />
            <button
              onClick={() => templateFileRef.current?.click()}
              className={`${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-50`}
            >
              {template ? "Reemplazar" : "Subir contrato"}
            </button>
          </div>
        </div>
      </div>

      {/* 2. Documentos del paciente */}
      <div className="bg-white border border-neutral-200 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-sm font-semibold text-neutral-800">Documentos del paciente</div>
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre…"
              className="text-sm rounded-md border border-neutral-300 px-2.5 py-1.5 w-48"
            />
            <input ref={fileRef} type="file" className="hidden" onChange={() => pickFile("paciente", fileRef)} />
            <button
              onClick={() => fileRef.current?.click()}
              className={`${btn} text-white`}
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              Subir documento
            </button>
          </div>
        </div>

        {error && !pending && <div className="text-xs text-rose-600 mb-2">{error}</div>}

        {loading ? (
          <div className="text-sm text-neutral-400">Cargando…</div>
        ) : docs.length === 0 ? (
          <div className="text-sm text-neutral-400 italic">
            {q ? "Ningún documento con ese nombre." : "Este paciente no tiene documentos todavía."}
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {docs.map((d) => (
              <li key={d.id} className="py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-neutral-800 truncate">{d.name}</div>
                  <div className="text-[11px] text-neutral-400">{fmtSize(d.fileSize)}</div>
                </div>
                <a
                  href={`/api/pacientes/${patientId}/documents/${d.id}/download`}
                  className="text-xs text-[var(--color-primary)] hover:underline shrink-0"
                >
                  Descargar
                </a>
                <button onClick={() => deleteDoc(d.id)} className="text-xs text-rose-500 hover:underline shrink-0">
                  Eliminar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Modal de NOMBRE obligatorio al subir */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5">
            <div className="text-sm font-semibold text-neutral-800 mb-1">Nombre del documento</div>
            <div className="text-xs text-neutral-500 mb-3 truncate">Archivo: {pending.file.name}</div>
            <input
              autoFocus
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmUpload(); }}
              placeholder="Ej. Contrato firmado, Informe inicial…"
              className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm"
            />
            {error && <div className="text-xs text-rose-600 mt-2">{error}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setPending(null); setPendingName(""); setError(null); }}
                disabled={busy}
                className={`${btn} border border-neutral-200 text-neutral-600`}
              >
                Cancelar
              </button>
              <button
                onClick={confirmUpload}
                disabled={busy}
                className={`${btn} text-white disabled:opacity-50`}
                style={{ background: "var(--color-primary, #1B3A2D)" }}
              >
                {busy ? "Subiendo…" : "Subir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
