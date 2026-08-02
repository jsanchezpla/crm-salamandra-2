"use client";

/**
 * ConsentimientoImagenGate — permiso para usar imágenes del niño (02/08/2026).
 *
 * Sale del sprint 3 de la migración de Aumenta: de 1.178 pacientes, **solo 5**
 * tenían este consentimiento recogido. No estaba en otro sitio: no se pedía.
 *
 * ── Por qué está hecho así ─────────────────────────────────────────────────
 *
 * · **No bloquea.** Se puede decir que no y entrar igual. Un consentimiento que
 *   hay que dar para pasar no es un consentimiento.
 * · **«No autorizo» es un botón de verdad**, del mismo tamaño y sin castigo
 *   visual. Si el «no» estuviera escondido en un enlace pequeño, la respuesta
 *   estaría dirigida.
 * · **Se pregunta por CADA niño.** Con dos hermanos son dos respuestas: no es lo
 *   mismo autorizar las fotos de uno que las del otro.
 * · **Firma solo al aceptar.** Una negativa no se firma; basta con dejar
 *   constancia de quién dijo que no y cuándo.
 */

import { useEffect, useState } from "react";
import SignaturePad from "./SignaturePad.jsx";

const headingStyle = { fontFamily: "var(--widget-font-display)", fontWeight: 500 };

export default function ConsentimientoImagenGate({ authFetch, profesional, onTerminado, onMasTarde }) {
  const [pendientes, setPendientes] = useState([]);
  const [idx, setIdx] = useState(0);
  const [firma, setFirma] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vivo = true;
    authFetch("/citas-portal/consentimiento-imagen", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!vivo) return;
        if (!j?.data?.disponible) return onTerminado?.();
        // Solo se pregunta por quien no ha contestado nunca. A quien ya dijo que
        // no, no se le vuelve a preguntar cada vez que entra.
        const faltan = (j.data.pacientes ?? []).filter((p) => !p.respondido);
        if (!faltan.length) return onTerminado?.();
        setPendientes(faltan);
      })
      .catch(() => {})
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [authFetch, onTerminado]);

  const actual = pendientes[idx];

  async function responder(acepto) {
    if (!actual) return;
    if (acepto && !firma) {
      setError("Dibuja tu firma para poder autorizarlo.");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const res = await authFetch("/citas-portal/consentimiento-imagen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: actual.id, acepto, signature: acepto ? firma : undefined }),
      });
      if (res.status === 401) return;
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j?.error || "No pudimos guardar tu respuesta");
      setFirma(null);
      if (idx + 1 < pendientes.length) setIdx(idx + 1);
      else onTerminado?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  if (cargando || !actual) return null;

  const nombre = profesional || "el centro";

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--widget-bg)]">
      <div className="min-h-full flex items-start sm:items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg bg-[var(--widget-card)] rounded-2xl border border-[var(--widget-border)] p-6 lg:p-8 shadow-sm">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)] mb-2">
            {pendientes.length > 1 ? `${idx + 1} de ${pendientes.length}` : "Un permiso opcional"}
          </div>
          <h1 className="text-[24px] lg:text-[28px] leading-tight text-[var(--widget-text)] tracking-tight mb-3" style={headingStyle}>
            Fotos y vídeos de {actual.nombre}
          </h1>

          <p className="text-[14px] text-[var(--widget-text-muted)] leading-relaxed mb-3">
            A veces hacemos fotos o vídeos en las sesiones y actividades. Queremos tu permiso para
            poder usarlos, y <strong className="text-[var(--widget-text)]">decir que no es una
            respuesta perfectamente válida</strong>: la atención de {actual.nombre} es exactamente
            la misma en los dos casos.
          </p>

          <ul className="text-[13px] text-[var(--widget-text-muted)] leading-relaxed mb-5 space-y-1.5 pl-4 list-disc">
            <li>Material del propio centro: informes, seguimiento y actividades.</li>
            <li>Difusión del centro (web y redes), solo si nos lo autorizas aquí.</li>
            <li>Puedes retirarlo cuando quieras desde esta misma pantalla.</li>
          </ul>

          <div className="mb-4">
            <p className="text-[13px] text-[var(--widget-text)] mb-2">
              Si lo autorizas, firma aquí:
            </p>
            <SignaturePad onChange={setFirma} disabled={enviando} />
          </div>

          {error && (
            <div className="mt-3 text-[13px] text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">{error}</div>
          )}

          {/* Los dos botones pesan lo mismo a propósito: ver cabecera. */}
          <div className="mt-5 flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => responder(true)}
              disabled={enviando}
              className="flex-1 px-5 py-3 text-sm font-semibold rounded-xl text-white transition bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              {enviando ? "Guardando…" : "Sí, lo autorizo"}
            </button>
            <button
              type="button"
              onClick={() => responder(false)}
              disabled={enviando}
              className="flex-1 px-5 py-3 text-sm font-semibold rounded-xl border border-[var(--widget-border)] text-[var(--widget-text)] hover:bg-[var(--widget-bg)] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              No lo autorizo
            </button>
          </div>

          <button
            type="button"
            onClick={onMasTarde}
            disabled={enviando}
            className="mt-2 w-full px-5 py-2.5 text-sm font-medium rounded-xl text-[var(--widget-text-muted)] hover:bg-[var(--widget-bg)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
          >
            Decidirlo más tarde
          </button>

          <p className="mt-4 text-[11px] text-[var(--widget-text-faint)] leading-relaxed">
            Responsable de los datos: {nombre}. Guardamos tu respuesta con su fecha —también si es
            que no— para tener constancia de que te lo preguntamos y no volver a molestarte con
            ello. Si autorizas, guardamos además tu firma como prueba del permiso.
          </p>
        </div>
      </div>
    </div>
  );
}
