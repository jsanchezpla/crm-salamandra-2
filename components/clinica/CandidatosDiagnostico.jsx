"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Select from "../ui/Select.jsx";
import { formatoHoras } from "../../lib/clinica/diagnostico.js";

/**
 * CandidatosDiagnostico — «Empezar desde lo que ya hay»: los pacientes que YA
 * están en diagnóstico y no tienen expediente (12/09/2026, respuesta de
 * Aumenta; Isa por Rodrigo: «hay que poder seleccionar en el módulo las
 * entrevistas iniciales hechas en una tabla con buscador y convertirlas en
 * diagnóstico empezado»).
 *
 * Aumenta tiene seis pacientes con citas de diagnóstico dadas y futuras —y
 * alguno con la entrevista inicial hecha y cobrada como entrevista de
 * terapia— desde antes de que existiera el expediente, y los dan de alta
 * ELLOS. Este bloque es el cómo: una tabla con buscador, una fila por
 * paciente con lo que ya hay (entrevista y su cobro, citas de diagnóstico
 * dadas y reservadas, terapeuta que más se repite) y un botón «Abrir
 * expediente» que abre el panel de alta con todo eso puesto y la casilla de
 * meterlo dentro marcada.
 *
 * ── LO QUE NO SE CALCULA AQUÍ ──────────────────────────────────────────────
 * Cada fila llega del servidor (`GET /api/clinica/diagnosticos/candidatos`)
 * con `resumen` (la frase de la casilla) y `adoptar` (el cuerpo que el alta
 * espera): la pantalla no cuenta horas ni decide qué citas entran; solo se
 * lo pasa al panel. El buscador (`q`) va al servidor con un pequeño retardo,
 * como `SelectorRemoto`: el filtro es por nombre, con palabras y sin tildes.
 *
 * Plegado por defecto, con su recuento en la cabecera: es una tarea de
 * arranque —una vez abiertos los seis, el bloque dirá «0» y estorbará poco—.
 */

const ESPERA_MS = 300;
const VENTANAS = [6, 12, 24, 36];

const fmtFecha = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : null);
const euros = (n) => `${Number(n ?? 0).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`;

/** Cómo va el cobro de la entrevista: «cobrada 50,00 €», «pendiente 47,50 €», «sin cobro». */
function rotuloDeCobro(cobro) {
  if (!cobro) return { texto: "sin cobro", cls: "text-neutral-400" };
  if (cobro.status === "completed") return { texto: `cobrada ${euros(cobro.importe)}`, cls: "text-emerald-700" };
  if (cobro.status === "pending") return { texto: `pendiente ${euros(cobro.importe)}`, cls: "text-amber-700" };
  return { texto: "sin cobro", cls: "text-neutral-400" };
}

export default function CandidatosDiagnostico({ onAbrirExpediente, deshabilitado = false }) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [meses, setMeses] = useState(12);
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  // Cada consulta lleva número: si una lenta contesta después de otra más
  // nueva, se tira (escribir deprisa dejaría en pantalla un resultado viejo).
  const consulta = useRef(0);

  useEffect(() => {
    const mia = ++consulta.current;
    const t = setTimeout(() => {
      setCargando(true);
      const params = new URLSearchParams({ meses: String(meses) });
      if (q.trim()) params.set("q", q.trim());
      fetch(`/api/clinica/diagnosticos/candidatos?${params}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (mia !== consulta.current) return;
          if (!j.ok) throw new Error(j.error || "No se pudieron cargar los pacientes en diagnóstico");
          setData(j.data);
          setErrorMsg(null);
          setCargando(false);
        })
        .catch((e) => {
          if (mia !== consulta.current) return;
          setErrorMsg(e.message);
          setCargando(false);
        });
    }, ESPERA_MS);
    return () => clearTimeout(t);
  }, [q, meses]);

  const filas = data?.candidatos ?? [];
  const total = data?.total ?? 0;
  const recuento = cargando && !data ? "Buscando…" : `${total} ${total === 1 ? "paciente" : "pacientes"} con diagnóstico sin expediente`;

  return (
    <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50/50 transition-colors"
      >
        <div>
          <div className="text-sm font-medium text-neutral-800">Empezar desde lo que ya hay</div>
          <div className="text-[11px] text-neutral-400 mt-0.5">{recuento}{q.trim() ? " que casan con la búsqueda" : ""}</div>
        </div>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className={`w-4 h-4 text-neutral-400 shrink-0 transition-transform ${abierto ? "rotate-180" : ""}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {abierto && (
        <div className="border-t border-neutral-100">
          <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="text-[11px] text-neutral-500 sm:flex-1">
              Pacientes sin expediente que tienen citas de diagnóstico o una entrevista inicial hecha. «Abrir expediente»
              mete dentro lo que ya hay: las citas dadas y futuras, y la entrevista con su cobro.
            </p>
            <div className="flex items-center gap-2">
              <Select
                value={String(meses)}
                onChange={(v) => setMeses(Number(v))}
                options={VENTANAS.map((m) => ({ value: String(m), label: `Últimos ${m} meses` }))}
                aria-label="Ventana de meses"
                className="text-xs border border-neutral-200 rounded-lg px-2 py-1.5 bg-white hover:border-neutral-300"
              />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por paciente…"
                aria-label="Buscar pacientes en diagnóstico"
                className="text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 focus:outline-none focus:border-neutral-400 w-full sm:w-56"
              />
            </div>
          </div>

          {errorMsg && <div className="mx-4 mb-3 px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}
          {data?.sinMigrar && (
            <div className="mx-4 mb-3 px-4 py-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">
              Los diagnósticos aún no están disponibles en este centro. Avisa a Salamandra.
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-y border-neutral-100 text-left text-[11px] uppercase tracking-wide text-neutral-400">
                  <th className="px-4 py-2.5 font-medium">Paciente</th>
                  <th className="px-4 py-2.5 font-medium">Entrevista inicial</th>
                  <th className="px-4 py-2.5 font-medium">Citas de diagnóstico</th>
                  <th className="px-4 py-2.5 font-medium">Terapeuta sugerido</th>
                  <th className="px-4 py-2.5 font-medium text-right"></th>
                </tr>
              </thead>
              <tbody>
                {cargando && filas.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-xs text-neutral-400">Buscando…</td></tr>
                )}
                {!cargando && filas.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-xs text-neutral-400">
                    {q.trim()
                      ? "Ningún paciente en diagnóstico casa con esa búsqueda."
                      : `Ningún paciente con citas de diagnóstico o entrevista inicial sin expediente en los últimos ${meses} meses.`}
                  </td></tr>
                )}
                {filas.map((c) => {
                  const cobro = rotuloDeCobro(c.entrevista?.cobro);
                  const cd = c.citasDiagnostico;
                  return (
                    <tr key={c.paciente.id} className="border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors">
                      <td className="px-4 py-3 align-top">
                        <Link href={`/pacientes/${c.paciente.id}`} className="font-medium text-neutral-800 hover:underline">
                          {c.paciente.nombre}
                        </Link>
                        {c.expedientesCerrados > 0 && (
                          <div className="text-[11px] text-neutral-400 mt-0.5">
                            {c.expedientesCerrados === 1 ? "1 diagnóstico anterior cerrado" : `${c.expedientesCerrados} diagnósticos anteriores cerrados`}
                          </div>
                        )}
                        {!c.clientId && <div className="text-[11px] text-amber-700 mt-0.5">Sin ficha de familia: no se podrá cobrar</div>}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-neutral-600">
                        {c.entrevista ? (
                          <>
                            <div>{fmtFecha(c.entrevista.fecha) ?? "—"}{!c.entrevista.bookingId ? " · solo el registro" : ""}</div>
                            <div className={`text-[11px] mt-0.5 ${cobro.cls}`}>{cobro.texto}</div>
                          </>
                        ) : (
                          <span className="text-neutral-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-neutral-600">
                        {cd ? (
                          <>
                            <div>{cd.total} {cd.total === 1 ? "cita" : "citas"}</div>
                            <div className="text-[11px] text-neutral-400 mt-0.5 tabular">
                              {formatoHoras(cd.horasHechas)} h dadas · {formatoHoras(cd.horasReservadas)} h reservadas
                            </div>
                          </>
                        ) : (
                          <span className="text-neutral-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-neutral-600">
                        {c.terapeutaSugerido?.nombre ?? <span className="text-neutral-300">—</span>}
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <button
                          type="button"
                          disabled={deshabilitado}
                          onClick={() => onAbrirExpediente?.(c)}
                          title={c.resumen}
                          className="text-[11px] font-medium px-2 py-1 rounded-md text-white hover:opacity-90 transition-opacity whitespace-nowrap disabled:opacity-40"
                          style={{ background: "var(--color-primary, #1B3A2D)" }}
                        >
                          Abrir expediente
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data?.truncado && (
            <p className="px-4 py-2.5 border-t border-neutral-100 text-[11px] text-neutral-400">
              Se enseñan {filas.length} de {total}: afina la búsqueda para ver el resto.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
