"use client";

/**
 * PropuestaIA — lo que Claude ha sacado de la transcripción, apartado por
 * apartado, para que la profesional ELIJA (01/09/2026, Rodrigo).
 *
 * (Componente propio y no dentro de cada pantalla, regla #2 de /lib llevada a
 * /components: lo comparten las DOS puertas del mismo botón —el formulario de
 * «Nuevo registro», donde la sesión todavía no existe, y el cajón de la ficha,
 * donde ya está guardada—. Con una copia en cada sitio, «sustituir» y «añadir
 * al final» acabarían haciendo cosas distintas según por dónde entres.)
 *
 * ── POR QUÉ SE ELIGE Y NO SE RELLENA SOLO ──────────────────────────────────
 * Antes, el audio rellenaba los apartados VACÍOS y no tocaba los que ya tenían
 * texto. Era prudente pero cojo: lo que la IA proponía para un apartado ya
 * escrito se tiraba sin que nadie lo llegara a ver, y muchas veces era mejor —o
 * traía un dato del audio que faltaba. Rodrigo lo pidió al revés: que proponga
 * en todos y que decida ella.
 *
 * Así que aquí no hay ningún automatismo silencioso. Cada apartado enseña LO
 * TUYO y LO PROPUESTO, y tiene tres salidas:
 *
 *   · Mantener lo tuyo   — no se toca (es lo que viene marcado si ya escribiste)
 *   · Sustituir          — entra la propuesta en lugar de lo tuyo
 *   · Añadir al final    — se conservan las dos, la tuya primero
 *
 * En un apartado vacío no hay nada que decidir salvo usarla o no, y viene
 * marcada: es el caso normal y obligar a 12 clics para lo evidente sería peor.
 *
 * Nada de esto guarda: `onAplicar` devuelve solo los apartados elegidos y quien
 * llama decide si eso va al formulario o a un PATCH.
 */

import { useMemo, useState } from "react";

const MANTENER = "mantener";
const SUSTITUIR = "sustituir";
const ANADIR = "anadir";

/** Cómo se pega lo propuesto detrás de lo escrito, según el tipo de apartado. */
function unir(actual, propuesto, tipo) {
  const a = String(actual ?? "").trim();
  const p = String(propuesto ?? "").trim();
  if (!a) return p;
  if (!p) return a;
  // En una lista cada línea es una viñeta, así que basta un salto; en un
  // párrafo hace falta la línea en blanco o se leerían pegados.
  return tipo === "lista" ? `${a}\n${p}` : `${a}\n\n${p}`;
}

/** El texto de un apartado tal como se enseña aquí (las listas, con viñetas). */
function Cuerpo({ valor, tipo, apagado = false }) {
  const v = String(valor ?? "").trim();
  if (!v) return <p className="text-[11px] text-neutral-400 italic">Vacío</p>;
  const clase = `text-[11px] leading-relaxed whitespace-pre-line ${apagado ? "text-neutral-400" : "text-neutral-700"}`;
  if (tipo === "lista") {
    return (
      <ul className={`${clase} list-disc pl-4 space-y-0.5`}>
        {v.split("\n").map((linea, i) => (
          <li key={i}>{linea}</li>
        ))}
      </ul>
    );
  }
  return <p className={clase}>{v}</p>;
}

function Opcion({ activa, onClick, children, tono = "neutro" }) {
  const base = "text-[11px] px-2.5 py-1 rounded-lg border transition-colors";
  if (activa) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} text-white border-transparent`}
        style={{ background: tono === "aviso" ? "#b45309" : "var(--color-primary, #1B3A2D)" }}
      >
        {children}
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} className={`${base} bg-white border-neutral-200 text-neutral-600 hover:border-neutral-400`}>
      {children}
    </button>
  );
}

export default function PropuestaIA({
  bloques,
  escrito = {},
  propuesta = {},
  onAplicar,
  onCerrar,
  guardando = false,
  // El TEXTO del que salió todo: la transcripción del audio, las notas pegadas,
  // o las dos. Se enseña plegado: es la prueba de que la propuesta no se ha
  // inventado nada, y quien duda de un apartado va a querer leerlo sin salir
  // de aquí.
  transcription = "",
  titulo = "Lo que ha sacado la IA",
  textoAplicar = "Aplicar lo elegido",
}) {
  // Solo se decide sobre apartados con propuesta: uno del que la IA no ha dicho
  // nada no es una decisión, es una fila de ruido.
  const filas = useMemo(
    () =>
      (Array.isArray(bloques) ? bloques : [])
        .map((b) => ({ ...b, actual: String(escrito?.[b.key] ?? "").trim(), sugerido: String(propuesta?.[b.key] ?? "").trim() }))
        .filter((b) => b.sugerido),
    [bloques, escrito, propuesta]
  );

  // Lo vacío entra; lo escrito a mano se respeta salvo que ella diga otra cosa.
  const [decision, setDecision] = useState(() =>
    Object.fromEntries(filas.map((f) => [f.key, f.actual ? MANTENER : SUSTITUIR]))
  );
  const [verTranscripcion, setVerTranscripcion] = useState(false);

  /**
   * La decisión vigente de una fila, con su valor por defecto.
   *
   * El `?? por defecto` no sobra: `decision` se inicializa una vez y las filas
   * se recalculan cuando cambian las props (en «Nuevo registro», `escrito` es el
   * formulario y cambia al teclear). Sin esto, una fila sin entrada en el mapa
   * se CONTARÍA como elegida en el pie y luego no se aplicaría — el pie diría
   * «se van a escribir 3» y se escribirían 2.
   */
  const decidir = (f) => decision[f.key] ?? (f.actual ? MANTENER : SUSTITUIR);

  /**
   * Marca UNA fila, con la forma funcional de `setState` y no con una copia del
   * mapa del render en curso.
   *
   * No es purismo: React agrupa los cambios de estado, así que dos clics
   * seguidos antes de que vuelva a pintar leerían los DOS el mismo `decision`
   * viejo y el segundo borraría al primero. Se vio en la prueba del 01/09/2026:
   * marcadas dos filas, el pie decía «se va a escribir 1 apartado».
   */
  const marcar = (clave, valor) => setDecision((prev) => ({ ...prev, [clave]: valor }));

  const elegidos = filas.filter((f) => decidir(f) !== MANTENER);
  const conTexto = filas.filter((f) => f.actual).length;

  function aplicar() {
    const cambios = {};
    for (const f of filas) {
      const d = decidir(f);
      if (d === SUSTITUIR) cambios[f.key] = f.sugerido;
      else if (d === ANADIR) cambios[f.key] = unir(f.actual, f.sugerido, f.tipo);
    }
    onAplicar?.(cambios);
  }

  function todos(d) {
    setDecision(Object.fromEntries(filas.map((f) => [f.key, d])));
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={guardando ? undefined : onCerrar} aria-hidden="true" />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl my-8">
        {/* ── Cabecera ─────────────────────────────────────────────────────── */}
        <div className="sticky top-0 bg-white border-b border-neutral-100 rounded-t-xl px-5 lg:px-6 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">Propuesta de la IA</div>
            <h3 className="font-display text-xl text-[var(--ink-900)] mt-1 leading-tight">{titulo}</h3>
            <p className="text-[11px] text-neutral-500 mt-1">
              {filas.length} apartado{filas.length === 1 ? "" : "s"} con propuesta
              {conTexto > 0 && ` · ${conTexto} ya ten${conTexto === 1 ? "ía" : "ían"} texto tuyo`}. Nada se guarda hasta que lo apliques.
            </p>
          </div>
          <button onClick={onCerrar} disabled={guardando} className="shrink-0 text-neutral-400 hover:text-neutral-700 p-1 -m-1 disabled:opacity-40" aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 lg:px-6 py-5 space-y-4">
          {filas.length === 0 ? (
            <p className="text-xs text-neutral-500">
              La IA no ha sacado nada que repartir de esta transcripción. Léela y escribe el registro a mano.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                <span>Marcar todos:</span>
                <button type="button" onClick={() => todos(SUSTITUIR)} className="text-[var(--color-primary,#1B3A2D)] hover:underline">
                  usar la propuesta
                </button>
                <span className="text-neutral-300">·</span>
                <button type="button" onClick={() => todos(MANTENER)} className="text-[var(--color-primary,#1B3A2D)] hover:underline">
                  mantener lo mío
                </button>
              </div>

              {filas.map((f) => {
                const d = decidir(f);
                return (
                  <div
                    key={f.key}
                    className={`border rounded-lg p-3.5 ${f.interno ? "border-amber-200 bg-amber-50/40" : "border-neutral-200"}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                      <div className={`eyebrow ${f.interno ? "text-amber-700" : ""}`}>
                        {f.label}
                        {f.interno && (
                          <span className="normal-case tracking-normal text-amber-600/80"> · no lo ve la familia</span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {f.actual ? (
                          <>
                            <Opcion activa={d === MANTENER} onClick={() => marcar(f.key, MANTENER)}>
                              Mantener lo mío
                            </Opcion>
                            <Opcion activa={d === ANADIR} onClick={() => marcar(f.key, ANADIR)}>
                              Añadir al final
                            </Opcion>
                            <Opcion
                              activa={d === SUSTITUIR}
                              tono="aviso"
                              onClick={() => marcar(f.key, SUSTITUIR)}
                            >
                              Sustituir
                            </Opcion>
                          </>
                        ) : (
                          <>
                            <Opcion activa={d === MANTENER} onClick={() => marcar(f.key, MANTENER)}>
                              Dejar vacío
                            </Opcion>
                            <Opcion activa={d === SUSTITUIR} onClick={() => marcar(f.key, SUSTITUIR)}>
                              Usar
                            </Opcion>
                          </>
                        )}
                      </div>
                    </div>

                    {f.actual ? (
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div className={`rounded-lg p-2.5 border ${d === MANTENER || d === ANADIR ? "border-neutral-200 bg-white" : "border-neutral-100 bg-neutral-50"}`}>
                          <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Lo tuyo</div>
                          <Cuerpo valor={f.actual} tipo={f.tipo} apagado={d === SUSTITUIR} />
                        </div>
                        <div className={`rounded-lg p-2.5 border ${d === MANTENER ? "border-neutral-100 bg-neutral-50" : "border-neutral-200 bg-white"}`}>
                          <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Propuesta</div>
                          <Cuerpo valor={f.sugerido} tipo={f.tipo} apagado={d === MANTENER} />
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg p-2.5 border border-neutral-200 bg-white">
                        <Cuerpo valor={f.sugerido} tipo={f.tipo} apagado={d === MANTENER} />
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* ── La transcripción, plegada ───────────────────────────────────── */}
          {transcription && (
            <div className="border-t border-neutral-100 pt-3">
              <button
                type="button"
                onClick={() => setVerTranscripcion((v) => !v)}
                className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline"
              >
                {/* «El texto» y no «la transcripción»: desde el 01/09/2026
                    esto puede ser lo que se dictó, lo que se pegó a mano, o las
                    dos cosas seguidas. */}
                {verTranscripcion ? "Ocultar el texto" : "Ver el texto del que ha salido"}
              </button>
              {verTranscripcion && (
                <p className="mt-2 text-[11px] text-neutral-600 leading-relaxed italic bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2.5">
                  «{transcription}»
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Pie ──────────────────────────────────────────────────────────── */}
        <div className="sticky bottom-0 bg-white border-t border-neutral-100 rounded-b-xl px-5 lg:px-6 py-3.5 flex flex-wrap items-center justify-end gap-2">
          <p className="text-[11px] text-neutral-500 mr-auto">
            {elegidos.length === 0
              ? "No has elegido ningún apartado."
              : `Se van a escribir ${elegidos.length} apartado${elegidos.length === 1 ? "" : "s"}.`}
          </p>
          <button onClick={onCerrar} disabled={guardando} className="text-xs px-4 py-2 text-neutral-500 hover:underline disabled:opacity-40">
            Cancelar
          </button>
          <button
            onClick={aplicar}
            disabled={guardando || elegidos.length === 0}
            className="text-xs font-medium px-4 py-2 rounded-lg text-white disabled:opacity-40"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            {guardando ? "Guardando…" : textoAplicar}
          </button>
        </div>
      </div>
    </div>
  );
}
