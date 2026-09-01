"use client";

import { useEffect, useState } from "react";
import LectoresPicker from "./LectoresPicker.jsx";

/**
 * «¿Quién ve esta carpeta?» (01/09/2026, Rodrigo: «las carpetas creadas en
 * Documentos tienen que poder ser vistas por quien se quiera. Un selector de
 * equipo»).
 *
 * Monta el MISMO selector que las lecturas de un documento
 * (`LectoresPicker.jsx`), así que los dos botones de arriba —«Todo el equipo» y
 * «Todos menos Administración»— salen aquí sin escribir una línea más. Eso era
 * medio encargo: «debería haber DENTRO DE LOS SELECTORES de equipo dos botones
 * más».
 *
 * Carga primero con quién estaba ya compartida: guardar una lista nueva sin ver
 * la vieja le quitaría el acceso a gente sin que nadie se entere.
 *
 * Lo que se reparte aquí es LECTURA: quien esté en la lista ve la carpeta, sus
 * subcarpetas y sus documentos, y los descarga. Subir, renombrar y borrar
 * siguen siendo de quien la creó, y la pantalla lo dice con todas las letras
 * para que nadie lo suponga al revés.
 */
export default function CompartirCarpetaModal({ carpeta, onClose, onSaved }) {
  const [miembros, setMiembros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!carpeta?.id) return;
    let cancelado = false;
    setCargando(true); setErr(null);
    fetch(`/api/documents/folders/${carpeta.id}/miembros`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelado) return;
        if (j.ok) setMiembros((j.data.miembros ?? []).map((m) => m.teamMemberId));
        else setErr(j.error);
      })
      .catch((e) => { if (!cancelado) setErr(e.message); })
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, [carpeta?.id]);

  async function guardar() {
    setGuardando(true); setErr(null);
    try {
      const r = await fetch(`/api/documents/folders/${carpeta.id}/miembros`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamMemberIds: miembros }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "No se pudo guardar");
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e.message);
      setGuardando(false);
    }
  }

  if (!carpeta) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !guardando && onClose()} />
      {/* top-14 lg:top-0: la barra móvil, como todos los modales del CRM. */}
      <div className="fixed top-14 lg:top-0 inset-x-0 bottom-0 z-50 flex items-start justify-center pt-16 px-4 overflow-y-auto pointer-events-none">
        <div className="bg-white rounded-xl shadow-pop w-full max-w-sm pointer-events-auto">
          <div className="px-5 pt-4 pb-3 border-b border-neutral-100">
            <div className="eyebrow">Quién ve esta carpeta</div>
            <h3 className="font-display text-lg text-neutral-900 mt-0.5 truncate">{carpeta.name}</h3>
          </div>
          <div className="px-5 py-4 space-y-2">
            {cargando ? (
              <p className="text-[11px] text-neutral-400">Cargando…</p>
            ) : (
              <>
                <LectoresPicker valor={miembros} onChange={setMiembros} disabled={guardando} />
                <p className="text-[10px] text-neutral-400">
                  Quien marques podrá ver y descargar esta carpeta, sus subcarpetas y todo lo que haya dentro.
                  Subir, renombrar y borrar siguen siendo solo tuyos. Sin nadie marcado, la carpeta vuelve a
                  ser solo tuya.
                </p>
              </>
            )}
            {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{err}</div>}
          </div>
          <div className="px-5 py-3 border-t border-neutral-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => !guardando && onClose()}
              className="px-3 py-1.5 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={guardar}
              disabled={guardando || cargando}
              className="px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50 transition"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
