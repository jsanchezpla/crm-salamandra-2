"use client";

/**
 * DatosGate — «Completa tus datos», el paso previo a firmar (04/08/2026).
 *
 * Va DELANTE del contrato y solo pide lo que le FALTA a la ficha de esa
 * persona. Quien la tenga completa no ve esta pantalla en su vida.
 *
 * Por qué antes y no dentro del contrato, que es donde estaba:
 *   · los datos tienen que acabar en la FICHA, que es donde los busca la
 *     nutricionista, no enterrados dentro de una firma;
 *   · y la fecha de nacimiento decide si además hace falta el consentimiento
 *     de su tutor legal. Preguntándola dentro del contrato, ese consentimiento
 *     aparecía a mitad de firmar; preguntándola antes, sale en su sitio.
 */

import { useMemo, useState } from "react";

const headingStyle = { fontFamily: "var(--widget-font-display)", fontWeight: 500 };

const INPUT =
  "w-full px-3 py-2.5 text-[15px] rounded-lg border border-[var(--widget-border)] bg-[var(--widget-card)] " +
  "text-[var(--widget-text)] placeholder:text-[var(--widget-text-faint)] focus:outline-none " +
  "focus:ring-2 focus:ring-[var(--widget-focus)] focus:border-transparent";

// El tipo decide el teclado del móvil: un teléfono con teclado de letras se
// rellena fatal con una mano.
const HTML_TYPE = { email: "email", tel: "tel", date: "date", dni: "text", text: "text" };

export default function DatosGate({ campos, profesional, enviando, error, onGuardar, onMasTarde }) {
  const [datos, setDatos] = useState(() => Object.fromEntries(campos.map((c) => [c.key, ""])));

  const grupos = useMemo(() => {
    const out = [];
    for (const campo of campos) {
      const titulo = campo.group ?? null;
      const ultimo = out[out.length - 1];
      if (ultimo && ultimo.titulo === titulo) ultimo.campos.push(campo);
      else out.push({ titulo, campos: [campo] });
    }
    return out;
  }, [campos]);

  const faltan = campos.filter((c) => !String(datos[c.key] ?? "").trim());
  const listo = faltan.length === 0;

  function enviar(e) {
    e.preventDefault();
    if (!listo || enviando) return;
    onGuardar(datos);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--widget-bg)]">
      <div className="min-h-full flex items-start sm:items-center justify-center px-4 py-8">
        <form
          onSubmit={enviar}
          className="w-full max-w-lg bg-[var(--widget-card)] rounded-2xl border border-[var(--widget-border)] p-6 lg:p-8 shadow-sm"
        >
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)] mb-2">
            Antes de entrar
          </div>
          <h1
            className="text-[24px] lg:text-[28px] leading-tight text-[var(--widget-text)] tracking-tight mb-3"
            style={headingStyle}
          >
            Completa tus datos
          </h1>
          <p className="text-[14px] text-[var(--widget-text-muted)] leading-relaxed mb-6">
            Nos faltan {campos.length === 1 ? "un dato" : "unos datos"} para poder preparar tu documentación
            {profesional ? ` con ${profesional}` : ""}. Es solo una vez.
          </p>

          {grupos.map((grupo, i) => (
            <div key={grupo.titulo ?? i} className={i > 0 ? "mt-5" : ""}>
              {grupo.titulo && (
                <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--widget-text-faint)] mb-2.5">
                  {grupo.titulo}
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {grupo.campos.map((campo) => (
                  <div key={campo.key} className={campo.type === "textarea" ? "sm:col-span-2" : undefined}>
                    <label
                      htmlFor={`dato-${campo.key}`}
                      className="block text-[13px] font-medium text-[var(--widget-text)] mb-1.5"
                    >
                      {campo.label}
                    </label>
                    {campo.type === "select" ? (
                      <select
                        id={`dato-${campo.key}`}
                        value={datos[campo.key] ?? ""}
                        onChange={(e) => setDatos((d) => ({ ...d, [campo.key]: e.target.value }))}
                        disabled={enviando}
                        className={INPUT}
                      >
                        <option value="">Selecciona…</option>
                        {(campo.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`dato-${campo.key}`}
                        type={HTML_TYPE[campo.type] ?? "text"}
                        value={datos[campo.key] ?? ""}
                        onChange={(e) => setDatos((d) => ({ ...d, [campo.key]: e.target.value }))}
                        disabled={enviando}
                        placeholder={campo.placeholder ?? undefined}
                        className={INPUT}
                      />
                    )}
                    {campo.help && (
                      <p className="mt-1 text-[12px] text-[var(--widget-text-faint)]">{campo.help}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {error && (
            <div className="mt-4 text-[13px] text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2">
            <button
              type="submit"
              disabled={!listo || enviando}
              className="w-full px-5 py-3 text-sm font-semibold rounded-xl text-white transition bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              {enviando ? "Guardando…" : "Continuar"}
            </button>
            {onMasTarde && (
              <button
                type="button"
                onClick={onMasTarde}
                disabled={enviando}
                className="w-full px-5 py-2.5 text-sm font-medium rounded-xl border border-[var(--widget-border)] text-[var(--widget-text)] hover:bg-[var(--widget-bg)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
              >
                Lo hago más tarde
              </button>
            )}
          </div>

          <p className="mt-4 text-[11px] text-[var(--widget-text-faint)] leading-relaxed">
            Solo te pedimos lo que nos falta. Lo que ya tenemos no te lo preguntamos, y esto no cambia nada de
            lo que ya nos hayas dado.
          </p>
        </form>
      </div>
    </div>
  );
}
