"use client";

/**
 * ComunicacionesGate — el segundo paso al entrar en el área privada
 * (01/08/2026): por dónde quiere la familia que se le escriba.
 *
 * Va DESPUÉS de firmar el contrato del centro, y **no bloquea**: se puede
 * guardar con todo desmarcado y entrar igual. Si aceptar novedades fuera el
 * peaje para ver tus documentos, ese consentimiento no valdría nada — y es
 * justo el consentimiento lo que se está pidiendo aquí.
 *
 * Sin firma: son casillas. Lo que da valor a esto es la traza que guarda el
 * servidor (fecha, IP y navegador de cuando LA FAMILIA lo marcó).
 */

import { useEffect, useState } from "react";

const headingStyle = { fontFamily: "var(--widget-font-display)", fontWeight: 500 };

export default function ComunicacionesGate({ authFetch, profesional, onGuardado, onMasTarde }) {
  const [canales, setCanales] = useState([]);
  const [valores, setValores] = useState({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vivo = true;
    authFetch("/citas-portal/comunicaciones", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!vivo || !j?.data?.disponible) return;
        setCanales(j.data.canales ?? []);
        setValores(Object.fromEntries((j.data.canales ?? []).map((c) => [c.canal, c.aceptado])));
      })
      .catch(() => {})
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [authFetch]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const res = await authFetch("/citas-portal/comunicaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(valores),
      });
      if (res.status === 401) return;
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j?.error || "No pudimos guardar tus preferencias");
      onGuardado(j.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  const nombre = profesional || "el centro";
  const sinNingunAviso = !valores.citasEmail && !valores.citasWhatsapp;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--widget-bg)]">
      <div className="min-h-full flex items-start justify-center px-4 py-8 sm:py-10">
        <div className="w-full max-w-lg bg-[var(--widget-card)] rounded-2xl border border-[var(--widget-border)] p-6 lg:p-8 shadow-sm">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)] mb-2">
            Un último paso
          </div>
          <h1 className="text-[24px] lg:text-[28px] leading-tight text-[var(--widget-text)] tracking-tight mb-3" style={headingStyle}>
            ¿Cómo quieres que te escribamos?
          </h1>
          <p className="text-[14px] text-[var(--widget-text-muted)] leading-relaxed mb-5">
            Marca lo que te venga bien. Puedes cambiarlo cuando quieras desde aquí mismo, y no
            marcar nada es una respuesta perfectamente válida.
          </p>

          {cargando ? (
            <p className="text-[13px] text-[var(--widget-text-muted)]">Cargando…</p>
          ) : (
            <div className="space-y-3">
              {canales.map((c) => (
                <label
                  key={c.canal}
                  className="flex items-start gap-3 p-3 rounded-lg border border-[var(--widget-border)] cursor-pointer hover:bg-[var(--widget-bg)]"
                >
                  <input
                    type="checkbox"
                    checked={!!valores[c.canal]}
                    onChange={(e) => setValores((v) => ({ ...v, [c.canal]: e.target.checked }))}
                    className="mt-0.5 w-4 h-4 rounded border-[var(--widget-border)] accent-[var(--brand-primary,var(--widget-button))]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[14px] text-[var(--widget-text)]">{c.label}</span>
                    <span className="block text-[12px] text-[var(--widget-text-faint)] mt-0.5">{c.ayuda}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {sinNingunAviso && !cargando && (
            <p className="mt-3 text-[12px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Sin ningún aviso marcado no te escribiremos por tus citas: ni confirmaciones, ni
              recordatorios, ni si hay que cambiar una hora. Podrás verlo todo entrando aquí.
            </p>
          )}

          {error && (
            <div className="mt-3 text-[13px] text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">{error}</div>
          )}

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={guardar}
              disabled={guardando || cargando}
              className="w-full px-5 py-3 text-sm font-semibold rounded-xl text-white transition bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              {guardando ? "Guardando…" : "Guardar y entrar"}
            </button>
            <button
              type="button"
              onClick={onMasTarde}
              disabled={guardando}
              className="w-full px-5 py-2.5 text-sm font-medium rounded-xl border border-[var(--widget-border)] text-[var(--widget-text)] hover:bg-[var(--widget-bg)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              Ahora no
            </button>
          </div>

          <p className="mt-4 text-[11px] text-[var(--widget-text-faint)] leading-relaxed">
            Los avisos los manda {nombre}, responsable de tus datos. Si eliges WhatsApp, tu número
            y el mensaje pasan por Meta, que es quien presta ese servicio. Guardamos la fecha de tu
            respuesta como constancia y puedes retirarla cuando quieras desde esta misma pantalla.
          </p>
        </div>
      </div>
    </div>
  );
}
