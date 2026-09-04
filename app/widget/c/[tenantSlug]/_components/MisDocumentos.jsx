"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { leerRespuestaApi } from "@/lib/utils/respuestaApi.js";

/**
 * "Mis documentos" del portal del paciente.
 *
 * Muestra dos cosas mezcladas por fecha:
 *   - lo que la profesional ha compartido con ella (pautas, informes…),
 *   - lo que ella misma ha subido (analíticas, informes de otro especialista…).
 *
 * Todo pasa por la sesión del portal (`authFetch`), así que solo puede ver y
 * descargar lo suyo. La subida es opcional: si el CRM dice que no puede subir
 * (tope alcanzado o ficha aún sin crear), se explica en vez de fallar.
 */

const headingStyle = { fontFamily: "var(--widget-font-display)", fontWeight: 500 };

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

export default function MisDocumentos({ tenantSlug, authFetch, profesional, onFirmar }) {
  const [docs, setDocs] = useState([]);
  const [canUpload, setCanUpload] = useState(false);
  // Firmas que faltan cuando el bloqueo es por contrato (2026-07, punto 2.2).
  const [contrato, setContrato] = useState(null);
  // Meses cuyos documentos están retenidos por un cobro pendiente (punto 2.3).
  const [mesesBloqueados, setMesesBloqueados] = useState([]);
  // Por qué no se puede subir: "sin-ficha" | "limite" | "sesion" | null.
  // Nunca dejamos el botón gris "porque sí": si está deshabilitado, hay motivo
  // escrito debajo.
  const [blockedReason, setBlockedReason] = useState(null);
  // Email de la sesión cuando no hay ficha: la causa habitual es que la ficha
  // del CRM tenga OTRO correo, y enseñándolo se ve al instante.
  const [sessionEmail, setSessionEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [justUploaded, setJustUploaded] = useState(null);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await authFetch("/citas-portal/documents", { cache: "no-store" });
      if (res.status === 401) {
        // El hook del portal pasa a "expired" y pinta su propia pantalla, pero
        // dejamos constancia por si esta sección se queda visible.
        setBlockedReason("sesion");
        return;
      }
      if (!res.ok) throw new Error("No pudimos cargar tus documentos");
      const j = await res.json();
      setDocs(j.data?.documents ?? []);
      setCanUpload(!!j.data?.canUpload);
      setBlockedReason(j.data?.canUpload ? null : (j.data?.blockedReason ?? "limite"));
      setSessionEmail(j.data?.sessionEmail ?? null);
      setContrato(j.data?.contrato ?? null);
      setMesesBloqueados(j.data?.mesesBloqueados ?? []);
    } catch (err) {
      setLoadError(err.message);
      setBlockedReason("error");
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  async function onPick(e) {
    const file = e.target.files?.[0];
    // Se limpia el input siempre: si no, elegir el MISMO archivo dos veces
    // seguidas no dispara el evento y parece que la subida no responde.
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    setJustUploaded(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await authFetch("/citas-portal/documents", { method: "POST", body: fd });
      if (res.status === 401) return;
      const j = await leerRespuestaApi(res);
      if (!res.ok || !j.ok) throw new Error(j?.error || "No pudimos subir el archivo");
      setJustUploaded(j.data?.name ?? file.name);
      await load();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function descargar(doc) {
    // La descarga necesita la cabecera de sesión, así que se pide por fetch y
    // se entrega como blob (un <a href> directo iría sin autorización).
    authFetch(`/citas-portal/documents/${doc.id}`)
      .then((res) => {
        if (!res.ok) throw new Error("No pudimos abrir el documento");
        return res.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = doc.name || "documento";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      })
      .catch((err) => setLoadError(err.message));
  }

  const nombreProfesional = profesional || "tu profesional";

  // Contrato sin firmar: aquí no se enseña nada ni se deja subir. Se explica
  // POR QUÉ y, si quien mira es quien tiene que firmar, se le ofrece hacerlo.
  if (!loading && blockedReason === "contrato") {
    const faltan = contrato?.pendientes?.length ? contrato.pendientes.join(" y ") : null;
    return (
      <section>
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)] mb-3">
          Mis documentos
        </div>
        <div className="bg-[var(--widget-card)] rounded-xl border border-[var(--widget-border)] p-6 text-center">
          <h3 className="text-[18px] text-[var(--widget-text)] tracking-tight mb-2" style={headingStyle}>
            Pendiente de firmar el contrato
          </h3>
          <p className="text-[13px] text-[var(--widget-text-muted)] leading-relaxed mb-4">
            En cuanto esté firmado, aquí verás lo que {nombreProfesional} comparta contigo y podrás
            enviarle documentos.
            {faltan && ` Falta la firma de ${faltan}.`}
          </p>
          {onFirmar && (
            <button
              type="button"
              onClick={onFirmar}
              className="inline-flex items-center px-4 py-2.5 text-sm font-medium rounded-md text-white bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              Firmar el contrato
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)] mb-3">
        Mis documentos
      </div>

      <div className="bg-[var(--widget-card)] rounded-xl border border-[var(--widget-border)] overflow-hidden">
        {/* Subida */}
        <div className="px-4 lg:px-5 py-4 border-b border-[var(--widget-border)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[14px] text-[var(--widget-text)] font-medium">
                ¿Tienes algo que enviarle a {nombreProfesional}?
              </div>
              <div className="text-[12px] text-[var(--widget-text-faint)] mt-0.5">
                Analíticas, informes de otro especialista… Solo lo veréis {nombreProfesional} y tú.
              </div>
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading || loading || !canUpload}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md text-white bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              {uploading ? "Subiendo…" : loading ? "Cargando…" : "Subir un documento"}
            </button>
            <input ref={inputRef} type="file" onChange={onPick} className="hidden" />
          </div>

          {/* Si el botón está apagado, aquí SIEMPRE se dice por qué. */}
          {!canUpload && !loading && blockedReason && (
            <p className="text-[12px] text-[var(--widget-text-faint)] mt-2">
              {blockedReason === "sin-ficha" &&
                `Todavía no podemos asociar tus documentos a tu ficha${sessionEmail ? ` (tu cuenta: ${sessionEmail})` : ""}. Escríbele a ${nombreProfesional} y lo soluciona en un momento.`}
              {blockedReason === "limite" &&
                `Has alcanzado el máximo de documentos que puedes subir. Si necesitas enviar algo más, escríbele a ${nombreProfesional}.`}
              {blockedReason === "sesion" &&
                "Tu sesión ha caducado. Vuelve a entrar desde tu cuenta en la web para subir documentos."}
              {blockedReason === "error" &&
                "No hemos podido comprobar si puedes subir documentos. Recarga la página e inténtalo de nuevo."}
            </p>
          )}
          {uploadError && (
            <div className="mt-2 text-[13px] text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {uploadError}
            </div>
          )}
          {justUploaded && !uploadError && (
            <div className="mt-2 text-[13px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-md px-3 py-2">
              Hemos recibido «{justUploaded}». ¡Gracias!
            </div>
          )}
        </div>

        {/* Documentos retenidos por un mes sin cobrar. Se dice: que un informe
            desaparezca sin explicación es peor que nombrar el mes pendiente. */}
        {mesesBloqueados.length > 0 && (
          <div className="px-4 lg:px-5 py-3 border-b border-[var(--widget-border)] bg-amber-50/60">
            <p className="text-[13px] text-amber-900">
              Tienes documentos guardados de{" "}
              <span className="font-medium">
                {mesesBloqueados
                  .map((m) => {
                    const [a, mm] = m.mes.split("-").map(Number);
                    return new Date(a, mm - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
                  })
                  .join(", ")}
              </span>
              {mesesBloqueados.length === 1 ? ", pendientes del pago de ese mes." : ", pendientes del pago de esos meses."}
              {" En cuanto conste el cobro, aparecen aquí."}
            </p>
          </div>
        )}

        {/* Listado */}
        <div className="px-4 lg:px-5 py-2">
          {loading ? (
            <p className="py-6 text-[13px] text-[var(--widget-text-muted)]">Cargando tus documentos…</p>
          ) : loadError ? (
            <div className="my-3 text-[13px] text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {loadError}
            </div>
          ) : docs.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-[var(--widget-text-muted)]">
              Todavía no hay documentos. Aquí verás lo que {nombreProfesional} comparta contigo y lo que tú subas.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--widget-border)]">
              {docs.map((d) => (
                <li key={d.id} className="py-3 flex items-center gap-3">
                  <span className="text-[var(--widget-text-faint)]">
                    <DocIcon />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] text-[var(--widget-text)] truncate">{d.name}</div>
                    <div className="text-[12px] text-[var(--widget-text-faint)]">
                      {d.mine ? "Lo subiste tú" : `Compartido por ${nombreProfesional}`}
                      {" · "}
                      {fmtDate(d.createdAt)}
                      {d.fileSize ? ` · ${fmtSize(d.fileSize)}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => descargar(d)}
                    className="shrink-0 inline-flex items-center px-3 py-1.5 text-[13px] font-medium rounded-md border border-[var(--widget-border)] text-[var(--widget-text)] hover:bg-[var(--widget-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
                  >
                    Descargar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
