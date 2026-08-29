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

import useZonaSoltar, { useEvitarSoltarFuera } from "@/components/ui/useZonaSoltar.js";

function fmtSize(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** «junio 2024» a partir de la fecha del documento. */
const MES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
function claveMes(d) {
  const f = d.documentDate ?? d.createdAt;
  const fecha = f ? new Date(f) : null;
  if (!fecha || Number.isNaN(fecha.getTime())) return { anio: "Sin fecha", mes: "" };
  return { anio: String(fecha.getFullYear()), mes: MES[fecha.getMonth()] };
}

export default function PatientDocumentsSection({ patientId }) {
  const [docs, setDocs] = useState([]);
  // Enlaces externos de la ficha (la carpeta de OneDrive con fotos y vídeos,
  // que se quedan allí a propósito: pesan gigas y ya tienen casa).
  const [enlaces, setEnlaces] = useState([]);
  // Años plegados: con veinte años de archivo, la lista entera no se lee.
  const [plegados, setPlegados] = useState(new Set());
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
      return fetch(url, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { if (j.ok) setDocs(j.data.documents || []); })
        .catch(() => {});
    },
    [patientId]
  );

  const loadEnlaces = useCallback(() => {
    return fetch(`/api/pacientes/${patientId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setEnlaces(j.data?.externalLinks ?? j.data?.patient?.externalLinks ?? []); })
      .catch(() => {});
  }, [patientId]);

  const loadTemplate = useCallback(() => {
    return fetch(`/api/pacientes/contract-template`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setTemplate(j.data.template); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([loadDocs(), loadTemplate(), loadEnlaces()]).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [loadDocs, loadTemplate]);

  function resetInputs() {
    if (fileRef.current) fileRef.current.value = "";
    if (templateFileRef.current) templateFileRef.current.value = "";
  }

  // Buscador con pequeño debounce.
  useEffect(() => {
    const t = setTimeout(() => loadDocs(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q, loadDocs]);

  /**
   * Un fichero elegido (por el explorador o soltado) pasa al modal del nombre.
   * Separado de `pickFile` porque ahora hay DOS formas de traerlo.
   */
  function proponer(f, target) {
    if (!f) return;
    // Nombre por defecto = nombre del fichero sin extensión.
    const base = f.name.replace(/\.[^.]+$/, "");
    setPending({ file: f, target });
    setPendingName(target === "contrato" ? "Contrato estándar" : base);
    setError(null);
  }

  function pickFile(target, ref) {
    proponer(ref.current?.files?.[0], target);
  }

  /*
   * Soltar encima (28/08/2026, Lau de Aumenta: «la casilla también en la zona
   * de documentación, para subirlo de una»). Sin `accept`: aquí cabe cualquier
   * documento, igual que al pulsar el botón — quien valida tipo, tamaño y cuota
   * es el backend.
   *
   * La tarjeta del CONTRATO no es zona de soltar a propósito: es el contrato
   * de TODA la clínica, y fallar la puntería con el informe de un paciente lo
   * reemplazaría para todos.
   */
  const zonaDocs = useZonaSoltar({
    onFicheros: ([f]) => proponer(f, "paciente"),
    onAviso: setError,
  });
  // Fallar la puntería al soltar no puede sacar de la ficha para abrir el
  // fichero en una pestaña, que es lo que hace el navegador por defecto.
  useEvitarSoltarFuera();

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
      resetInputs();
      if (pending.target === "contrato") loadTemplate();
      else loadDocs(q.trim());
    } catch (e) {
      setError(e.message);
      resetInputs(); // permite re-elegir el MISMO fichero tras un error
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
      <div
        {...zonaDocs.props}
        className={`bg-white rounded-xl p-4 border transition-colors ${
          zonaDocs.arrastrando
            ? "border-2 border-dashed border-[var(--color-primary,#1B3A2D)] bg-neutral-50"
            : "border-neutral-200"
        }`}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-sm font-semibold text-neutral-800">
            Documentos del paciente
            <span className="ml-2 font-normal text-xs text-neutral-400">
              {zonaDocs.arrastrando ? "suelta aquí el archivo" : "o arrastra un archivo aquí"}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {enlaces.map((e, i) => (
              <a key={i} href={e.url} target="_blank" rel="noreferrer"
                className="text-xs px-3 py-1.5 rounded-md border border-neutral-300 text-neutral-700 hover:border-neutral-500"
                title="Se abre en OneDrive; hace falta la sesión del centro">
                {e.label || "Fotos y vídeos (OneDrive)"}
              </a>
            ))}
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
          <div>
            {(() => {
              // Años → meses → documentos, en el orden en que ya llegan (fecha desc).
              const grupos = [];
              for (const d of docs) {
                const { anio, mes } = claveMes(d);
                let g = grupos[grupos.length - 1];
                if (!g || g.anio !== anio) { g = { anio, meses: [] }; grupos.push(g); }
                let m = g.meses[g.meses.length - 1];
                if (!m || m.mes !== mes) { m = { mes, docs: [] }; g.meses.push(m); }
                m.docs.push(d);
              }
              return grupos.map((g) => (
                <div key={g.anio} className="mb-1">
                  <button type="button"
                    onClick={() => setPlegados((prev) => { const s2 = new Set(prev); s2.has(g.anio) ? s2.delete(g.anio) : s2.add(g.anio); return s2; })}
                    className="w-full flex items-center gap-2 py-1.5 text-left">
                    <span className="text-[11px] text-neutral-400">{plegados.has(g.anio) ? "▸" : "▾"}</span>
                    <span className="text-sm font-semibold text-neutral-800">{g.anio}</span>
                    <span className="text-[11px] text-neutral-400">· {g.meses.reduce((a, m) => a + m.docs.length, 0)} documento{g.meses.reduce((a, m) => a + m.docs.length, 0) === 1 ? "" : "s"}</span>
                  </button>
                  {!plegados.has(g.anio) && g.meses.map((m) => (
                    <div key={g.anio + m.mes} className="pl-5 mb-1">
                      {m.mes && <div className="text-[11px] uppercase tracking-wider text-neutral-400 pt-1">{m.mes}</div>}
                      <ul className="divide-y divide-neutral-100">
                        {m.docs.map((d) => (
              <li key={d.id} className="py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="text-sm text-neutral-800 truncate">{d.name}</div>
                    {d.source === "incidencia" && (
                      <span
                        className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700"
                        title="Adjunto de una incidencia del equipo. Se borra desde la incidencia, no desde aquí."
                      >
                        De incidencia
                      </span>
                    )}
                    {d.source === "sesion" && (
                      <span
                        className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700"
                        title="Registro de sesión enviado a la familia: lo tiene en su área privada. Se retira desde su sesión, no desde aquí."
                      >
                        Enviado a la familia
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-neutral-400">{fmtSize(d.fileSize)}</div>
                </div>
                <a
                  href={`/api/pacientes/${patientId}/documents/${d.id}/download`}
                  className="text-xs text-[var(--color-primary)] hover:underline shrink-0"
                >
                  Descargar
                </a>
                {/* Los adjuntos de incidencia se borran desde SU incidencia:
                    quitarlos desde la ficha dejaría la incidencia sin su
                    justificante sin que nadie lo vea. Y un registro ENVIADO se
                    retira desde su sesión (29/08/2026): borrarlo aquí lo quitaría
                    del área privada de la familia sin que la sesión se entere y
                    seguiría diciendo «Volver a enviar». */}
                {d.source === "paciente" && (
                  <button onClick={() => deleteDoc(d.id)} className="text-xs text-rose-500 hover:underline shrink-0">
                    Eliminar
                  </button>
                )}
              </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ));
            })()}
          </div>
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
                onClick={() => { setPending(null); setPendingName(""); setError(null); resetInputs(); }}
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
