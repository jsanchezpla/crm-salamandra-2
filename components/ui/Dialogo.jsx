"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dialogo — el `confirm` / `alert` / `prompt` del navegador, pero dentro del CRM.
 *
 * POR QUÉ EXISTE (12/08/2026, Rodrigo: «modal para festivos, que ahora es una
 * notificación de navegador extraña»). Los diálogos nativos:
 *
 *   · salen con la cara del navegador y el dominio delante («localhost:3000
 *     dice:»), que en mitad de una pantalla de trabajo se lee como un aviso de
 *     seguridad, no como una pregunta del programa;
 *   · no admiten formato: un aviso de tres frases sale en un churro y los
 *     saltos de línea se escriben a mano con \n;
 *   · en Chrome se pueden silenciar («Impedir que esta página cree diálogos»),
 *     y a partir de ahí `confirm` devuelve `false` SIEMPRE sin enseñar nada:
 *     el botón deja de funcionar y nadie sabe por qué;
 *   · bloquean el hilo, así que ni se pinta un «Guardando…» detrás.
 *
 * ── CÓMO SE USA ────────────────────────────────────────────────────────────
 *
 *   const { confirmar, avisar, pedirTexto, dialogo } = useDialogo();
 *   ...
 *   if (!(await confirmar("¿Eliminar esta cita?"))) return;
 *   const motivo = await pedirTexto({ titulo: "Motivo", obligatorio: false });
 *   ...
 *   return (<div>…{dialogo}</div>);
 *
 * Las tres funciones devuelven una promesa, así que el sitio donde se llaman
 * queda igual que con las del navegador: una línea, sin partir la función en
 * dos ni sacar el estado del modal a mano. `pedirTexto` devuelve `null` si se
 * cancela (como `prompt`) y la cadena escrita si se acepta —cadena vacía
 * incluida, que no es lo mismo que cancelar.
 *
 * Capas según la regla #13 de CLAUDE.md: fondo `z-40`, panel `z-50`.
 */

/** Un texto suelto vale por `{ texto }`: la mayoría de las llamadas son eso. */
function normalizar(opciones) {
  return typeof opciones === "string" ? { texto: opciones } : (opciones ?? {});
}

/** Qué devuelve cada tipo cuando se cancela: lo mismo que su equivalente nativo. */
function valorAlCancelar(tipo) {
  if (tipo === "confirmar") return false;
  if (tipo === "texto" || tipo === "elegir") return null;
  return undefined; // avisar: no hay nada que devolver
}

export function useDialogo() {
  const [peticion, setPeticion] = useState(null);
  // El `resolve` vive en una ref y no en el estado: así cerrar el diálogo es
  // una operación normal y no hay que resolver la promesa dentro de un
  // actualizador de estado (que React puede llamar dos veces).
  const resolverRef = useRef(null);

  const abrir = useCallback(
    (datos) =>
      new Promise((resolver) => {
        resolverRef.current = resolver;
        setPeticion(datos);
      }),
    []
  );

  const cerrar = useCallback((valor) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setPeticion(null);
    resolver?.(valor);
  }, []);

  /** ¿Sí o no? → Promise<boolean> */
  const confirmar = useCallback(
    (opciones) => abrir({ tipo: "confirmar", ...normalizar(opciones) }),
    [abrir]
  );

  /** Solo enterarse. → Promise<void> */
  const avisar = useCallback(
    (opciones) => abrir({ tipo: "avisar", ...normalizar(opciones) }),
    [abrir]
  );

  /** Escribir algo. → Promise<string|null> (null = ha cancelado) */
  const pedirTexto = useCallback(
    (opciones) => abrir({ tipo: "texto", ...normalizar(opciones) }),
    [abrir]
  );

  /**
   * Elegir entre varias. → Promise<valor|null> (null = ha cancelado)
   *
   * Es lo que un `confirm` no puede hacer y se acababa falseando con frases
   * como «Aceptar = justificada · Cancelar = sin justificar»: dos respuestas
   * distintas metidas en un sí/no, donde además cancelar no cancelaba.
   *
   *   elegir({ titulo, texto, opciones: [{ valor, label, tono? }] })
   */
  const elegir = useCallback(
    (opciones) => abrir({ tipo: "elegir", ...normalizar(opciones) }),
    [abrir]
  );

  const dialogo = peticion ? <Dialogo peticion={peticion} onCerrar={cerrar} /> : null;

  return { confirmar, avisar, pedirTexto, elegir, dialogo };
}

function Dialogo({ peticion, onCerrar }) {
  const {
    tipo,
    titulo,
    texto,
    tono = "normal",
    confirmar: rotuloConfirmar,
    cancelar: rotuloCancelar,
    etiqueta,
    placeholder,
    valorInicial = "",
    obligatorio = false,
    multilinea = false,
    opciones = [],
  } = peticion;

  const [valor, setValor] = useState(valorInicial);
  const primeroRef = useRef(null);

  // Enfocar lo que hay que tocar: el campo si lo hay, el botón si no.
  useEffect(() => {
    primeroRef.current?.focus();
    if (tipo === "texto") primeroRef.current?.select?.();
  }, [tipo]);

  // Escape cancela, como en el diálogo del navegador.
  useEffect(() => {
    function alPulsar(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCerrar(valorAlCancelar(tipo));
      }
    }
    document.addEventListener("keydown", alPulsar);
    return () => document.removeEventListener("keydown", alPulsar);
  }, [onCerrar, tipo]);

  const vacio = obligatorio && !valor.trim();

  function aceptar() {
    if (vacio) return;
    onCerrar(tipo === "confirmar" ? true : tipo === "texto" ? valor : undefined);
  }

  function cancelar() {
    onCerrar(valorAlCancelar(tipo));
  }

  const colorPrincipal =
    tono === "peligro"
      ? "bg-red-600 hover:bg-red-700 text-white"
      : "bg-[#0F0F0F] hover:bg-[#222] text-white";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 z-40"
        onClick={cancelar}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-50 w-full max-w-sm bg-white rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="px-5 pt-5 pb-4">
          {titulo && (
            <h2 className="text-sm font-semibold text-neutral-900 mb-1.5">{titulo}</h2>
          )}
          {texto && (
            // `whitespace-pre-line` para que los avisos que vienen con saltos de
            // línea se lean como se escribieron.
            <p className="text-[13px] text-neutral-600 leading-relaxed whitespace-pre-line">
              {texto}
            </p>
          )}

          {tipo === "texto" && (
            <div className="mt-3.5">
              {etiqueta && (
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">
                  {etiqueta}
                </label>
              )}
              {multilinea ? (
                <textarea
                  ref={primeroRef}
                  rows={3}
                  value={valor}
                  placeholder={placeholder}
                  onChange={(e) => setValor(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300"
                />
              ) : (
                <input
                  ref={primeroRef}
                  type="text"
                  value={valor}
                  placeholder={placeholder}
                  onChange={(e) => setValor(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); aceptar(); } }}
                  className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300"
                />
              )}
            </div>
          )}

          {/* Varias respuestas: una debajo de otra y con su frase entera, en
              vez de repartidas entre «Aceptar» y «Cancelar». */}
          {tipo === "elegir" && (
            <div className="mt-4 flex flex-col gap-2">
              {opciones.map((o, i) => (
                <button
                  key={o.valor}
                  type="button"
                  ref={i === 0 ? primeroRef : undefined}
                  onClick={() => onCerrar(o.valor)}
                  className={`w-full text-left text-[13px] font-medium px-3 py-2 rounded-lg border transition-colors ${
                    o.tono === "peligro"
                      ? "border-red-200 text-red-700 hover:bg-red-50"
                      : "border-neutral-200 text-neutral-800 hover:bg-neutral-50"
                  }`}
                >
                  {o.label}
                  {o.pista && (
                    <span className="block text-[11px] font-normal text-neutral-500 mt-0.5">
                      {o.pista}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-neutral-100 flex justify-end gap-2">
          {tipo !== "avisar" && (
            <button
              type="button"
              onClick={cancelar}
              className="text-xs px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
            >
              {rotuloCancelar ?? "Cancelar"}
            </button>
          )}
          {/* En «elegir» los botones son las propias opciones: aquí solo queda
              la salida. */}
          {tipo !== "elegir" && (
            <button
              type="button"
              ref={tipo === "texto" ? undefined : primeroRef}
              onClick={aceptar}
              disabled={vacio}
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors disabled:opacity-40 ${colorPrincipal}`}
            >
              {rotuloConfirmar ?? (tipo === "avisar" ? "Entendido" : "Aceptar")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dialogo;
