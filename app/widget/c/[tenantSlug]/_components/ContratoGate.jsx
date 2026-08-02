"use client";

/**
 * ContratoGate — la pantalla del Contrato del Centro en el portal de la familia
 * (sprint Aumenta 2026-07, punto 2.1).
 *
 * Es lo primero que ve la familia al entrar: tapa el portal entero hasta que
 * firma. Hay un «Lo firmo más tarde» que deja pasar —no se le cierra la puerta
 * a quien viene a mirar sus citas— pero «Mis documentos» sigue cerrado hasta
 * que firmen TODOS los tutores.
 *
 * La firma se dibuja con el dedo sobre un canvas y se manda como PNG. Lo que
 * tiene valor no es el dibujo sino lo que se guarda con él: quién, cuándo,
 * desde qué IP y con qué navegador.
 */

import { useEffect, useState } from "react";
import SignaturePad from "./SignaturePad.jsx";

const headingStyle = { fontFamily: "var(--widget-font-display)", fontWeight: 500 };


export default function ContratoGate({ estado, authFetch, tenantSlug, profesional, onFirmado, onMasTarde }) {
  const [firma, setFirma] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [abriendo, setAbriendo] = useState(false);

  const nombre = profesional || "el centro";

  async function abrirContrato() {
    setAbriendo(true);
    setError(null);
    try {
      const res = await authFetch("/citas-portal/contract/documento");
      if (res.status === 401) return;
      if (!res.ok) throw new Error("No pudimos abrir el contrato. Inténtalo de nuevo.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      // Sin revoke inmediato: la pestaña nueva todavía lo está leyendo.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err.message);
    } finally {
      setAbriendo(false);
    }
  }

  async function firmar() {
    if (!firma || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await authFetch("/citas-portal/contract/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: firma }),
      });
      if (res.status === 401) return;
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j?.error || "No pudimos guardar tu firma");
      onFirmado(j.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  const faltanOtros = (estado?.pendientes?.length ?? 0) > 1;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--widget-bg)]">
      <div className="min-h-full flex items-start sm:items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg bg-[var(--widget-card)] rounded-2xl border border-[var(--widget-border)] p-6 lg:p-8 shadow-sm">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)] mb-2">
            Antes de entrar
          </div>
          <h1 className="text-[24px] lg:text-[28px] leading-tight text-[var(--widget-text)] tracking-tight mb-3" style={headingStyle}>
            Firma el contrato de {nombre}
          </h1>
          <p className="text-[14px] text-[var(--widget-text-muted)] leading-relaxed mb-5">
            Necesitamos tu firma para poder compartir contigo los informes y la documentación
            {estado?.firmanteNombre ? ` de tu familia` : ""}. Se firma una sola vez.
            {faltanOtros && " El otro progenitor también tendrá que firmar el suyo."}
          </p>

          {estado?.documentoDisponible ? (
            <button
              type="button"
              onClick={abrirContrato}
              disabled={abriendo}
              className="w-full mb-5 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[14px] font-medium rounded-lg border border-[var(--widget-border)] text-[var(--widget-text)] hover:bg-[var(--widget-bg)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              {abriendo ? "Abriendo…" : "Leer el contrato antes de firmar"}
            </button>
          ) : (
            <p className="text-[12px] text-[var(--widget-text-faint)] mb-5">
              El centro todavía no ha subido el PDF del contrato. Si prefieres leerlo antes de
              firmar, escríbeles y te lo envían.
            </p>
          )}

          <SignaturePad onChange={setFirma} disabled={enviando} />

          {error && (
            <div className="mt-3 text-[13px] text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={firmar}
              disabled={!firma || enviando}
              className="w-full px-5 py-3 text-sm font-semibold rounded-xl text-white transition bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              {enviando ? "Guardando tu firma…" : "Firmar y entrar"}
            </button>
            <button
              type="button"
              onClick={onMasTarde}
              disabled={enviando}
              className="w-full px-5 py-2.5 text-sm font-medium rounded-xl border border-[var(--widget-border)] text-[var(--widget-text)] hover:bg-[var(--widget-bg)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              Lo firmo más tarde
            </button>
          </div>

          <p className="mt-4 text-[11px] text-[var(--widget-text-faint)] leading-relaxed">
            Si lo dejas para más tarde podrás ver tus citas, pero tus documentos seguirán
            cerrados hasta que el contrato esté firmado. Al firmar guardamos la fecha y hora
            como constancia.
          </p>
        </div>
      </div>
    </div>
  );
}
