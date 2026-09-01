"use client";

import { useEffect, useState } from "react";
import LectoresPicker from "./LectoresPicker.jsx";

/**
 * «¿Quién tiene que leer este documento?» desde el ARCHIVO (01/09/2026, Rodrigo).
 *
 * La otra puerta del mismo encargo: en el modal de un bloqueo se elige a los
 * lectores al subir el acta; aquí se le pide la lectura a algo que ya está
 * subido. Las dos escriben en la misma tabla (`document_reads`) por el mismo
 * endpoint, así que no hay dos comportamientos que mantener.
 *
 * Carga PRIMERO a quién se le había pedido ya: guardar una lista nueva sin ver
 * la vieja se llevaría por delante a los que estaban, y quien lo hiciera no se
 * enteraría. Los que ya leyeron salen marcados y el servidor los conserva
 * aunque se desmarquen (`lib/documents/lecturas.js`).
 */
export default function PedirLecturaModal({ doc, onClose, onSaved }) {
  const [lectores, setLectores] = useState([]);
  const [leidos, setLeidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!doc?.id) return;
    let cancelado = false;
    setCargando(true); setErr(null);
    fetch(`/api/documents/lecturas?documentId=${doc.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelado) return;
        if (j.ok) {
          const lista = j.data.lectores ?? [];
          setLectores(lista.map((l) => l.teamMemberId));
          setLeidos(lista.filter((l) => l.leido).map((l) => l.teamMemberId));
        } else setErr(j.error);
      })
      .catch((e) => { if (!cancelado) setErr(e.message); })
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, [doc?.id]);

  async function guardar() {
    setGuardando(true); setErr(null);
    try {
      const r = await fetch("/api/documents/lecturas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: doc.id, teamMemberIds: lectores }),
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

  if (!doc) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !guardando && onClose()} />
      {/* top-14 lg:top-0: la barra móvil, como todos los modales del CRM. */}
      <div className="fixed top-14 lg:top-0 inset-x-0 bottom-0 z-50 flex items-start justify-center pt-16 px-4 overflow-y-auto pointer-events-none">
        <div className="bg-white rounded-xl shadow-pop w-full max-w-sm pointer-events-auto">
          <div className="px-5 pt-4 pb-3 border-b border-neutral-100">
            <div className="eyebrow">Pedir lectura</div>
            <h3 className="font-display text-lg text-neutral-900 mt-0.5 truncate">{doc.fileName || doc.name}</h3>
          </div>
          <div className="px-5 py-4 space-y-2">
            {cargando ? (
              <p className="text-[11px] text-neutral-400">Cargando…</p>
            ) : (
              <>
                <LectoresPicker valor={lectores} leidos={leidos} onChange={setLectores} disabled={guardando} />
                <p className="text-[10px] text-neutral-400">
                  A quien marques le saldrá el aviso en su pantalla de inicio hasta que abra el documento. A quien
                  ya lo ha leído no se le puede retirar el acuse.
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
