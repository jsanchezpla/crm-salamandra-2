"use client";

import { useId, useState } from "react";
import { IconoBuscar, IconoCheck } from "./Iconos.jsx";
import { FOCO } from "./estilos.js";
import { normalizar } from "./formato.js";

/**
 * SelectorClientes — la barra lateral del calendario global (12/09/2026).
 *
 * Una lista de clientes con su casilla del color del cliente (rellena =
 * visible). Sustituye a la «leyenda» de la pantalla de antes, que no dejaba
 * elegir más que ocultando de uno en uno y olvidaba la elección al recargar.
 *
 * Lo comparten las dos pestañas con la MISMA selección (`useClientes`), así
 * que quien acota a tres clientes en Calendario los encuentra acotados en
 * Proyectos.
 *
 * Props:
 *   seleccion    lo que devuelve `useClientes()`
 *   modulo       "calendario" | "proyectos": qué pista sale cuando al cliente
 *                le falta el módulo de esa pestaña («sin calendario»,
 *                «sin proyectos»)
 *   proyectos, onProyectos   interruptor «Tareas de proyectos». Solo se pinta
 *                si llega `onProyectos` (la pestaña Proyectos no lo pasa)
 *   colorPor, onColorPor     «Color por: Cliente | Prioridad». Igual: solo con
 *                `onColorPor`
 *   pie          nodo opcional al final, para lo propio de otra pestaña
 *
 * «Solo este» aparece al pasar el ratón o con el foco en la fila. En pantallas
 * táctiles no hay «pasar el ratón»: ahí se esconde del todo (si no, sería un
 * botón invisible encima de la fila) y se hace con «Ninguno» y un toque.
 */

const PISTA_SIN_MODULO = { calendario: "sin calendario", proyectos: "sin proyectos" };
const BUSCADOR_DESDE = 7; // «si hay más de 6»

export default function SelectorClientes({
  seleccion,
  modulo = "calendario",
  proyectos = true,
  onProyectos = null,
  colorPor = "cliente",
  onColorPor = null,
  pie = null,
}) {
  const { yo, clientes, visibles, cargando, error, alternar, soloEste, todos, ninguno, reintentar } = seleccion;
  const [busqueda, setBusqueda] = useState("");
  // El selector se pinta dos veces (barra de escritorio y panel del móvil): ids únicos.
  const idColorPor = useId();

  const visiblesSet = new Set(visibles);
  const aguja = normalizar(busqueda);
  const filtrados = aguja ? clientes.filter((c) => normalizar(c.nombre).includes(aguja)) : clientes;
  const hayControles = Boolean(onProyectos || onColorPor || pie);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-4 pb-2 flex flex-col gap-2">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8A918E]">Clientes</h2>
          {!cargando && clientes.length > 0 && (
            <span className="text-[12px] tabular-nums text-[#8A918E]">
              {visibles.length} de {clientes.length}
            </span>
          )}
        </div>

        {clientes.length >= BUSCADOR_DESDE && (
          <label className="relative block">
            <span className="sr-only">Buscar cliente</span>
            <IconoBuscar className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9AA09D] pointer-events-none" />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar"
              className="w-full h-8 pl-8 pr-2 rounded-md border border-[#E7E7E1] bg-[#F7F7F4] text-[13px] text-[#1C2B27] placeholder:text-[#9AA09D] focus:bg-white focus:border-[#3E5C57] focus:outline-none"
            />
          </label>
        )}

        {!cargando && clientes.length > 0 && (
          <div className="flex items-center gap-1 px-1 text-[12px]">
            <button
              type="button"
              onClick={todos}
              disabled={visibles.length === clientes.length}
              className={`rounded-sm text-[#3E5C57] hover:text-[#1F3B34] hover:underline underline-offset-2 disabled:text-[#B5BAB8] disabled:no-underline disabled:cursor-default ${FOCO}`}
            >
              Todos
            </button>
            <span aria-hidden="true" className="text-[#C9CCC9]">·</span>
            <button
              type="button"
              onClick={ninguno}
              disabled={visibles.length === 0}
              className={`rounded-sm text-[#3E5C57] hover:text-[#1F3B34] hover:underline underline-offset-2 disabled:text-[#B5BAB8] disabled:no-underline disabled:cursor-default ${FOCO}`}
            >
              Ninguno
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
        {cargando && (
          <ul aria-label="Cargando clientes" className="flex flex-col gap-1 px-1 pt-1">
            {[72, 56, 64, 48].map((ancho) => (
              <li key={ancho} className="h-8 flex items-center gap-2.5 px-1">
                <span className="w-3.5 h-3.5 rounded-[4px] bg-[#EDEDE8]" />
                <span className="h-2.5 rounded bg-[#EDEDE8]" style={{ width: `${ancho}%` }} />
              </li>
            ))}
          </ul>
        )}

        {!cargando && error && (
          <div className="px-2 pt-1 text-[12.5px] text-[#8A2A24] leading-snug">
            {error}{" "}
            <button type="button" onClick={reintentar} className={`font-medium underline underline-offset-2 rounded-sm ${FOCO}`}>
              Reintentar
            </button>
          </div>
        )}

        {!cargando && !error && clientes.length === 0 && (
          <p className="px-2 pt-1 text-[12.5px] leading-relaxed text-[#5C6461]">
            Tu cuenta no ve ningún cliente.
            {!yo?.todos && <span className="block text-[#8A918E]">Los clientes se vinculan desde el back-office.</span>}
          </p>
        )}

        {!cargando && aguja && filtrados.length === 0 && clientes.length > 0 && (
          <p className="px-2 pt-1 text-[12.5px] text-[#8A918E]">Ningún cliente con «{busqueda.trim()}».</p>
        )}

        {!cargando && filtrados.length > 0 && (
          <ul className="flex flex-col">
            {filtrados.map((c) => {
              const visible = visiblesSet.has(c.slug);
              const faltaModulo = modulo === "proyectos" ? !c.proyectos : !c.calendario;
              const pista = visible && c.fallo ? "no responde" : faltaModulo ? PISTA_SIN_MODULO[modulo] : null;
              return (
                <li key={c.slug} className="group relative">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={visible}
                    onClick={() => alternar(c.slug)}
                    className={`w-full h-8 flex items-center gap-2.5 pl-2 pr-2 rounded-md text-left text-[13px] hover:bg-[#F2F2EE] ${FOCO}`}
                  >
                    <span
                      aria-hidden="true"
                      className="w-3.5 h-3.5 shrink-0 rounded-[4px] border-[1.5px] flex items-center justify-center"
                      style={{ borderColor: c.color || "#94A3B8", background: visible ? c.color || "#94A3B8" : "transparent" }}
                    >
                      {visible && <IconoCheck className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                    </span>
                    <span className={`truncate ${visible ? "text-[#1C2B27]" : "text-[#8A918E]"}`}>{c.nombre}</span>
                    {pista && (
                      <span
                        className={`ml-auto shrink-0 text-[11px] ${pista === "no responde" ? "text-[#A33A30]" : "text-[#9AA09D]"}`}
                      >
                        {pista}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => soloEste(c.slug)}
                    aria-label={`Ver solo ${c.nombre}`}
                    className={`absolute right-1 top-1/2 -translate-y-1/2 h-6 px-2 rounded-[5px] border border-[#E7E7E1] bg-white text-[11px] text-[#3E5C57] hover:text-[#1F3B34] hover:border-[#D6D6CF] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:hidden ${FOCO}`}
                  >
                    Solo este
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {hayControles && (
        <div className="shrink-0 border-t border-[#E7E7E1] px-2 py-2.5 flex flex-col gap-1">
          {onProyectos && (
            <button
              type="button"
              role="switch"
              aria-checked={proyectos}
              onClick={() => onProyectos(!proyectos)}
              className={`w-full h-8 flex items-center justify-between gap-3 px-2 rounded-md text-[13px] text-[#1C2B27] hover:bg-[#F2F2EE] ${FOCO}`}
            >
              <span>Tareas de proyectos</span>
              <span
                aria-hidden="true"
                className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${proyectos ? "bg-[#1F3B34]" : "bg-[#D6D6CF]"}`}
              >
                <span
                  className={`absolute top-0.5 left-0 h-3 w-3 rounded-full bg-white transition-transform ${proyectos ? "translate-x-3.5" : "translate-x-0.5"}`}
                />
              </span>
            </button>
          )}
          {onColorPor && (
            <div className="h-9 flex items-center justify-between gap-3 px-2">
              <span id={idColorPor} className="text-[13px] text-[#1C2B27]">
                Color por
              </span>
              <div
                role="group"
                aria-labelledby={idColorPor}
                className="inline-flex p-0.5 rounded-md border border-[#E7E7E1] bg-[#F2F2EE]"
              >
                {[
                  ["cliente", "Cliente"],
                  ["prioridad", "Prioridad"],
                ].map(([valor, etiqueta]) => {
                  const puesto = colorPor === valor;
                  return (
                    <button
                      key={valor}
                      type="button"
                      aria-pressed={puesto}
                      onClick={() => onColorPor(valor)}
                      className={`h-6 px-2 rounded-[5px] text-[12px] ${puesto ? "bg-white text-[#1C2B27] font-medium shadow-[0_0_0_1px_#E7E7E1]" : "text-[#5C6461] hover:text-[#1C2B27]"} ${FOCO}`}
                    >
                      {etiqueta}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {pie}
        </div>
      )}
    </div>
  );
}
