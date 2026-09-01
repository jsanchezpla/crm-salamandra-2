"use client";

/**
 * FichajeModule — el mes de fichaje del centro.
 *
 * ── POR QUÉ ESTÁ ORGANIZADA ASÍ ─────────────────────────────────────────────
 * La tentación era una cuadrícula personas × días. Con 14 personas y 31 días
 * son 434 celdas que no caben en una pantalla y que además no contestan la
 * pregunta que se hace de verdad al final de mes, que es «¿cuántas horas le
 * pago a cada una y hay algo raro?».
 *
 * Así que manda la LISTA POR PERSONA, y el día a día se abre debajo de quien lo
 * pidas. Encima, lo que hay que mirar antes de fiarte de ningún total: los
 * avisos. Un módulo de fichaje que solo suma horas obliga a leerse 271 filas
 * para encontrar la que está mal.
 *
 * Los avisos van separados en dos: lo que casi seguro está mal (`error`) y lo
 * que es raro pero puede ser correcto (`revisar`). Mezclarlos hace que no se
 * mire ninguno.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { formatearMinutos } from "@/lib/fichaje/parseHora.js";
import ImportarFichajeModal from "./ImportarFichajeModal.jsx";
import CorregirFichajeModal from "./CorregirFichajeModal.jsx";
import ApuntarExtraModal from "./ApuntarExtraModal.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function mesActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function tituloMes(periodo) {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo || "");
  if (!m) return periodo;
  return `${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return iso || "—";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const dia = ["do", "lu", "ma", "mi", "ju", "vi", "sá"][d.getUTCDay()];
  return `${dia} ${m[3]}`;
}

/** La diferencia con lo previsto, con su color. Es el número que se mira. */
function Diferencia({ minutos, hayPrevisto }) {
  if (!hayPrevisto) return <span className="text-gray-300">—</span>;
  const n = Number(minutos) || 0;
  if (n === 0) return <span className="text-gray-400">0</span>;
  const color = n > 0 ? "text-emerald-600" : "text-amber-600";
  return <span className={color}>{n > 0 ? "+" : ""}{formatearMinutos(n)}</span>;
}

export default function FichajeModule() {
  const [periodo, setPeriodo] = useState(mesActual);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [abierta, setAbierta] = useState(null); // teamMemberId desplegado
  const [importando, setImportando] = useState(false);
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [apuntandoExtra, setApuntandoExtra] = useState(false);
  const [verAvisos, setVerAvisos] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch(`/api/fichaje?mes=${periodo}`);
      const j = await r.json();
      if (!j?.ok) {
        setError(j?.error || `HTTP ${r.status}`);
        setDatos(null);
      } else {
        setDatos(j.data);
      }
    } catch (e) {
      setError(e.message || "Error de red");
    } finally {
      setCargando(false);
    }
  }, [periodo]);

  useEffect(() => { cargar(); }, [cargar]);

  const porPersona = useMemo(() => {
    const m = new Map();
    for (const f of datos?.filas || []) {
      if (!m.has(f.teamMemberId)) m.set(f.teamMemberId, []);
      m.get(f.teamMemberId).push(f);
    }
    return m;
  }, [datos]);

  const avisosPorPersona = useMemo(() => {
    const m = new Map();
    for (const a of datos?.avisos || []) {
      if (!a.teamMemberId) continue;
      m.set(a.teamMemberId, (m.get(a.teamMemberId) || 0) + 1);
    }
    return m;
  }, [datos]);

  const errores = (datos?.avisos || []).filter((a) => a.gravedad === "error");
  const revisar = (datos?.avisos || []).filter((a) => a.gravedad === "revisar");
  const hayPrevisto = (datos?.totales?.minutosPrevistos || 0) > 0;

  return (
    <div className={anchoPantalla("listado")}>
      {/* ── Cabecera ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Equipo</div>
          <h1 className="text-2xl font-semibold text-gray-900">Fichaje</h1>
          <p className="text-sm text-gray-500 mt-1">
            Horas trabajadas de {tituloMes(periodo)}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={periodo}
            onChange={(e) => { setPeriodo(e.target.value); setAbierta(null); }}
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />
          <a
            href={`/api/fichaje/export?mes=${periodo}`}
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            Exportar
          </a>
          <button
            type="button"
            onClick={() => setApuntandoExtra(true)}
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            Apuntar horas extra
          </button>
          <button
            type="button"
            onClick={() => setImportando(true)}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90"
          >
            Importar Excel
          </button>
        </div>
      </div>

      {cargando && <p className="py-16 text-center text-sm text-gray-400">Cargando el mes…</p>}
      {error && (
        <div className="py-10 text-center">
          <p className="text-sm text-red-600">No se ha podido cargar: {error}</p>
          <button onClick={cargar} className="mt-3 text-xs px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50">
            Reintentar
          </button>
        </div>
      )}

      {!cargando && !error && datos && (
        <>
          {/* ── Los cuatro números ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Tarjeta titulo="Horas del mes" valor={formatearMinutos(datos.totales.minutos)} />
            <Tarjeta
              titulo="Personas con fichajes"
              valor={`${datos.totales.personasConFichajes} de ${datos.totales.personas}`}
            />
            <Tarjeta
              titulo="Diferencia con el horario"
              valor={hayPrevisto ? formatearMinutos(datos.totales.extras) : "—"}
              tono={hayPrevisto && datos.totales.extras > 0 ? "verde" : hayPrevisto && datos.totales.extras < 0 ? "ambar" : null}
            />
            <Tarjeta titulo="Corregidos a mano" valor={String(datos.totales.correcciones)} />
          </div>

          {/* ── Avisos ──────────────────────────────────────────────────── */}
          {(errores.length > 0 || revisar.length > 0) && (
            <div className="mb-6 rounded-xl border border-gray-100 bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => setVerAvisos((v) => !v)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50"
              >
                <span className="text-sm font-medium text-gray-900">
                  {errores.length > 0 && (
                    <span className="text-red-600">{errores.length} {errores.length === 1 ? "cosa que está mal" : "cosas que están mal"}</span>
                  )}
                  {errores.length > 0 && revisar.length > 0 && <span className="text-gray-400"> · </span>}
                  {revisar.length > 0 && <span className="text-amber-600">{revisar.length} para revisar</span>}
                </span>
                <span className="text-xs text-gray-400">{verAvisos ? "ocultar" : "ver"}</span>
              </button>
              {verAvisos && (
                <ul className="border-t border-gray-100 divide-y divide-gray-50 max-h-72 overflow-y-auto">
                  {[...errores, ...revisar].map((a, i) => (
                    <li key={i} className="px-4 py-2 flex items-start gap-3 text-sm">
                      <span
                        className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${a.gravedad === "error" ? "bg-red-500" : "bg-amber-400"}`}
                      />
                      <span className="text-gray-700">
                        <span className="font-medium">{a.nombre}</span>
                        {a.fecha && <span className="text-gray-400"> · {fechaCorta(a.fecha)}</span>}
                        <span className="text-gray-400"> · </span>
                        {a.texto}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── La tabla ────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="text-left font-medium px-4 py-2.5">Persona</th>
                  <th className="text-right font-medium px-3 py-2.5 w-16">Días</th>
                  <th className="text-right font-medium px-3 py-2.5 w-28">Trabajadas</th>
                  <th className="text-right font-medium px-3 py-2.5 w-28 hidden sm:table-cell">Previstas</th>
                  <th className="text-right font-medium px-3 py-2.5 w-28">Diferencia</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {datos.resumen.map((r) => {
                  const desplegada = abierta === r.teamMemberId;
                  const nAvisos = avisosPorPersona.get(r.teamMemberId) || 0;
                  return (
                    <FilaPersona
                      key={r.teamMemberId}
                      r={r}
                      nAvisos={nAvisos}
                      desplegada={desplegada}
                      onToggle={() => setAbierta(desplegada ? null : r.teamMemberId)}
                      filas={porPersona.get(r.teamMemberId) || []}
                      onCorregir={setCorrigiendo}
                    />
                  );
                })}
              </tbody>
            </table>
            {datos.resumen.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-gray-400">
                No hay nadie activo en el equipo.
              </p>
            )}
          </div>

          {datos.totales.personasConFichajes === 0 && (
            <div className="mt-6 rounded-xl border border-dashed border-gray-200 px-6 py-10 text-center">
              <p className="text-sm text-gray-600">Todavía no hay ningún fichaje de {tituloMes(periodo)}.</p>
              <button
                type="button"
                onClick={() => setImportando(true)}
                className="mt-3 px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90"
              >
                Importar el Excel del mes
              </button>
              {datos.parser && (
                <p className="mt-3 text-xs text-gray-400">
                  Formato esperado: {datos.parser.nombre}
                  {!datos.parser.esPropio && " (el genérico; se puede adaptar a vuestro fichero)"}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {importando && (
        <ImportarFichajeModal
          periodo={periodo}
          onClose={() => setImportando(false)}
          onHecho={() => { setImportando(false); cargar(); }}
        />
      )}
      {corrigiendo && (
        <CorregirFichajeModal
          fichaje={corrigiendo}
          onClose={() => setCorrigiendo(null)}
          onHecho={() => { setCorrigiendo(null); cargar(); }}
        />
      )}
      {apuntandoExtra && datos && (
        <ApuntarExtraModal
          personas={datos.resumen}
          periodo={periodo}
          onClose={() => setApuntandoExtra(false)}
          onSaved={() => { setApuntandoExtra(false); cargar(); }}
        />
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, tono }) {
  const color = tono === "verde" ? "text-emerald-600" : tono === "ambar" ? "text-amber-600" : "text-gray-900";
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-gray-400">{titulo}</div>
      <div className={`text-lg font-semibold mt-0.5 ${color}`}>{valor}</div>
    </div>
  );
}

function FilaPersona({ r, nAvisos, desplegada, onToggle, filas, onCorregir }) {
  const hayPrevisto = r.minutosPrevistos > 0;
  return (
    <>
      <tr className={`hover:bg-gray-50 cursor-pointer ${desplegada ? "bg-gray-50" : ""}`} onClick={onToggle}>
        <td className="px-4 py-2.5">
          <span className="text-gray-900">{r.nombre}</span>
          {nAvisos > 0 && (
            <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{nAvisos}</span>
          )}
          {r.correcciones > 0 && (
            <span className="ml-2 text-[11px] text-gray-400">{r.correcciones} a mano</span>
          )}
          {r.extrasApuntadas > 0 && (
            <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
              +{formatearMinutos(r.extrasApuntadas)} extra
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right text-gray-500">{r.dias || "—"}</td>
        <td className="px-3 py-2.5 text-right text-gray-900">{r.filas ? formatearMinutos(r.minutos) : "—"}</td>
        <td className="px-3 py-2.5 text-right text-gray-400 hidden sm:table-cell">
          {hayPrevisto ? formatearMinutos(r.minutosPrevistos) : "—"}
        </td>
        <td className="px-3 py-2.5 text-right">
          <Diferencia minutos={r.extras} hayPrevisto={hayPrevisto} />
        </td>
        <td className="px-3 py-2.5 text-gray-300 text-xs">{desplegada ? "▲" : "▼"}</td>
      </tr>
      {desplegada && (
        <tr>
          <td colSpan={6} className="px-4 pb-4 bg-gray-50">
            {filas.length === 0 ? (
              <p className="py-4 text-sm text-gray-400">Sin fichajes este mes.</p>
            ) : (
              <div className="rounded-lg border border-gray-100 bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-50">
                    {filas.map((f) => (
                      <tr key={f.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-500 w-20">{fechaCorta(f.fecha)}</td>
                        <td className="px-3 py-2 text-gray-700 w-32">
                          {f.entradaAt ? String(f.entradaAt).slice(0, 5) : "—"}
                          <span className="text-gray-300"> → </span>
                          {f.salidaAt ? String(f.salidaAt).slice(0, 5) : "—"}
                        </td>
                        <td className="px-3 py-2 text-gray-900 w-24">{formatearMinutos(f.minutos)}</td>
                        <td className="px-3 py-2 text-gray-400 text-xs">
                          {/* El original SOLO se enseña si de verdad cambió. Si
                              no, es ruido en todas las filas del mes. */}
                          {f.minutosOriginal !== null && f.minutosOriginal !== f.minutos && (
                            <span className="text-amber-600">
                              el Excel decía {formatearMinutos(f.minutosOriginal)}
                            </span>
                          )}
                          {f.tipo === "extra" && (
                            <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 not-italic">horas extra</span>
                          )}
                          {f.origen !== "import" && (
                            <span className="ml-2">{f.origen === "manual" ? "a mano" : "corregido"}</span>
                          )}
                          {f.nota && <span className="ml-2 italic">«{f.nota}»</span>}
                        </td>
                        <td className="px-3 py-2 text-right w-24">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onCorregir({ ...f, nombre: r.nombre }); }}
                            className="text-xs text-[var(--color-primary)] hover:underline"
                          >
                            Corregir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
