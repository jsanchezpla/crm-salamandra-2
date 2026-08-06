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
import { campoEsObligatorio } from "../../../../../lib/clients/datosFicha.js";
import { edadDesde } from "../../../../../lib/clients/formularioAlta.js";

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

  /**
   * Qué es obligatorio depende de la EDAD QUE SE ESTÁ ESCRIBIENDO (05/08/2026).
   *
   * Antes esta pantalla exigía TODOS los campos, y funcionaba porque solo pedía
   * la fecha de nacimiento. Al juntar aquí el DNI y el domicilio —para quitar
   * una pantalla del recorrido— eso se convertía en una trampa: **los menores
   * de 14 años no tienen DNI obligatorio**, así que una paciente de 12 se
   * quedaba con el botón apagado pidiéndole un documento que no existe, sin
   * poder firmar ni pedir cita.
   *
   * Se recalcula con cada tecla: en cuanto escribe una fecha de menor, el DNI
   * deja de bloquear. El servidor hace exactamente esta misma cuenta con el
   * mismo dato (`validarDatos` busca la fecha en lo que llega antes que en la
   * ficha), así que pantalla y servidor no pueden discrepar.
   */
  const campoFecha = campos.find((c) => c.ficha === "cliente.birthDate");
  const fechaNacimiento = campoFecha ? String(datos[campoFecha.key] ?? "").trim() || null : null;

  const esObligatorio = (campo) => campoEsObligatorio(campo, fechaNacimiento);

  /*
   * AVISO DEL CONSENTIMIENTO PARENTAL, EN EL MOMENTO EN QUE SE ESCRIBE LA FECHA
   * (06/08/2026, Rodrigo).
   *
   * Hasta ahora el consentimiento del tutor aparecía sin avisar, ya dentro de la
   * firma. Quien lo descubría allí eran dos personas distintas y las dos mal:
   * la menor, que no había avisado a nadie y se quedaba encallada; y su madre o
   * su padre, a quien le llegaba de golpe un documento legal que hay que firmar
   * sin haber visto nada de lo anterior.
   *
   * Diciéndolo aquí —debajo de la fecha, en cuanto la escribe— las dos van sobre
   * aviso y llegan a la firma sabiendo lo que van a firmar.
   */
  const edad = edadDesde(fechaNacimiento);
  const avisoTutor = edad != null && edad < 18;

  const faltan = campos.filter((c) => esObligatorio(c) && !String(datos[c.key] ?? "").trim());
  const listo = faltan.length === 0;

  function enviar(e) {
    e.preventDefault();
    if (!listo || enviando) return;
    onGuardar(datos);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--widget-bg)]">
      <div className="min-h-full flex items-start justify-center px-4 py-8 sm:py-10">
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
                      {/*
                        Se dice cuál NO hace falta en vez de dejarla adivinando
                        por qué el botón se ha encendido sin rellenarlo todo.

                        El DNI —lo único que hoy depende de la edad— lo avisa
                        SIEMPRE, escriba lo que escriba (06/08/2026, Rodrigo).
                        Antes el «(opcional)» aparecía solo después de teclear
                        una fecha de menor: hasta ese momento, una familia sin
                        DNI veía un campo obligatorio y se paraba ahí, sin llegar
                        nunca a la fecha que se lo habría desbloqueado.
                      */}
                      {campo.requiredDesdeEdad != null ? (
                        <span className="ml-1.5 font-normal text-[var(--widget-text-faint)]">
                          (opcional si es menor)
                        </span>
                      ) : !esObligatorio(campo) ? (
                        <span className="ml-1.5 font-normal text-[var(--widget-text-faint)]">
                          (opcional)
                        </span>
                      ) : null}
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
                    {/* Justo debajo de la fecha, no al final del formulario: el
                        aviso tiene que salir pegado al dato que lo provoca. */}
                    {campo.ficha === "cliente.birthDate" && avisoTutor && (
                      <p className="mt-2 text-[12px] leading-relaxed text-[var(--widget-text-muted)] bg-[var(--widget-bg)] border border-[var(--widget-border)] rounded-lg px-3 py-2">
                        Con {edad} años, más adelante te pediremos el <strong>consentimiento de tu madre, padre
                        o tutor legal</strong>: tendrán que rellenar sus datos y firmar. Puedes avisarles ya para
                        que estén contigo cuando llegue ese paso.
                      </p>
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
