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
 *
 * Desde el 04/08/2026 hay DOS formas de firmar y este componente decide cuál:
 *   - Con plantilla estructurada (tunutrilaura): primero «Completa tus datos»
 *     si le falta algo en la ficha, y después el documento con sus anexos y una
 *     casilla por cada uno → `DatosGate` + `ContratoFormulario`.
 *   - Sin ella (Aumenta): el PDF del centro y una firma, como estaba.
 * El reparto se hace aquí y no en la página para que quien monta el portal no
 * tenga que saber qué contrato usa cada cliente.
 */

import { useState } from "react";
import SignaturePad from "./SignaturePad.jsx";
import ContratoFormulario from "./ContratoFormulario.jsx";
import DatosGate from "./DatosGate.jsx";
import { useEnfriamiento } from "./useEnfriamiento.js";

const headingStyle = { fontFamily: "var(--widget-font-display)", fontWeight: 500 };


export default function ContratoGate({ estado, authFetch, tenantSlug, profesional, onFirmado, onMasTarde }) {
  // Medio segundo sin poder pulsar: el rebote de un doble clic en la
  // pantalla anterior no puede saltarse esta (ver useEnfriamiento.js).
  const enfriado = useEnfriamiento();

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

  /** Manda la firma. `payload` lo arma quien llama según el tipo de contrato. */
  async function enviarFirma(payload) {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await authFetch("/citas-portal/contract/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  /** Guarda en la FICHA los datos que faltaban. Va antes de firmar nada. */
  async function guardarDatos(datos) {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await authFetch("/citas-portal/mis-datos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datos }),
      });
      if (res.status === 401) return;
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j?.error || "No pudimos guardar tus datos");
      onFirmado(j.data); // mismo camino: refresca el estado y sigue el flujo
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  // Primero los datos que falten en la ficha: sin ellos no se enseña nada que
  // firmar, porque el documento se rellena con lo que hay en la ficha.
  if (estado?.estructurado && (estado?.datosPendientes?.length ?? 0) > 0) {
    return (
      <DatosGate
        campos={estado.datosPendientes}
        profesional={profesional}
        enviando={enviando}
        error={error}
        onGuardar={guardarDatos}
        onMasTarde={onMasTarde}
      />
    );
  }

  // Contrato estructurado: datos + anexos + firma, cada documento por separado.
  if (estado?.estructurado && estado?.plantilla) {
    return (
      <ContratoFormulario
        // Al pasar del contrato al consentimiento parental hay que RESETEAR el
        // formulario entero: sin esto React reutiliza el estado y el segundo
        // documento sale con las casillas del primero ya marcadas.
        key={estado.plantilla.key}
        plantilla={estado.plantilla}
        quedan={estado.documentosPendientes ?? 1}
        profesional={profesional}
        enviando={enviando}
        error={error}
        onFirmar={enviarFirma}
        onMasTarde={onMasTarde}
      />
    );
  }

  const faltanOtros = (estado?.pendientes?.length ?? 0) > 1;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--widget-bg)]">
      <div className="min-h-full flex items-start justify-center px-4 py-8 sm:py-10">
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
              onClick={() => firma && enviarFirma({ signature: firma })}
              disabled={!firma || enviando || !enfriado}
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
