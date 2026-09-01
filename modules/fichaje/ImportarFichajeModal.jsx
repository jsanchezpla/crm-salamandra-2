"use client";

/**
 * ImportarFichajeModal — subir el Excel del mes en tres pasos.
 *
 *   1. Fichero + mes
 *   2. LO QUE VA A PASAR (y lo que hay que resolver antes)
 *   3. Confirmar
 *
 * El paso 2 es todo el módulo. Un volcado a ciegas es una nómina a ciegas, así
 * que antes de escribir nada se enseña, en este orden:
 *
 *   · los nombres del Excel que no casan con nadie del equipo — y hasta que no
 *     estén todos resueltos NO se puede aplicar, porque esas horas se perderían
 *     sin que nadie lo notara;
 *   · qué se va a reemplazar del volcado anterior y qué correcciones a mano
 *     sobreviven;
 *   · las filas que el lector no ha entendido, con el motivo;
 *   · las anotaciones que venían escritas en el Excel (BAJA, MÉDICO…), que se
 *     guardan con el volcado.
 *
 * El preview no escribe NADA, así que se puede subir el fichero equivocado las
 * veces que haga falta.
 */

import { useEffect, useState } from "react";

import { formatearMinutos } from "@/lib/fichaje/parseHora.js";

export default function ImportarFichajeModal({ periodo: periodoInicial, onClose, onHecho }) {
  const [periodo, setPeriodo] = useState(periodoInicial);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  // La lista de nombres por asignar del PRIMER preview. El preview se vuelve a
  // pedir con los mapeos puestos (y entonces ya no los trae como pendientes),
  // pero los desplegables tienen que seguir a la vista para poder revisarlos.
  const [pendientesOriginales, setPendientesOriginales] = useState([]);
  const [mapeos, setMapeos] = useState({});
  const [ocupado, setOcupado] = useState(false);
  const [recalculando, setRecalculando] = useState(false);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);

  const pendientes = pendientesOriginales;
  const sinResolver = pendientes.filter((p) => !mapeos[p.nombre]);
  const puedeAplicar =
    preview && !recalculando && preview.totales.listas > 0 && sinResolver.length === 0;

  // Cada nombre asignado cambia cuántas jornadas quedan listas, y quien cuenta
  // eso es el servidor: se re-pide el preview con los mapeos puestos (sigue sin
  // escribir nada). Sin esto, un fichero cuyos nombres no casan con NADIE
  // —el volcado del reloj, la primera vez— dejaba `listas` en 0 para siempre y
  // el botón nunca se encendía por mucho que se asignara a todo el mundo.
  useEffect(() => {
    if (!file || resultado) return;
    const asignados = Object.fromEntries(Object.entries(mapeos).filter(([, v]) => v));
    if (Object.keys(asignados).length === 0) return;
    const t = setTimeout(async () => {
      setRecalculando(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("periodo", periodo);
        fd.append("mapeos", JSON.stringify(asignados));
        const r = await fetch("/api/fichaje/import/preview", { method: "POST", body: fd });
        const j = await r.json();
        if (j?.ok) setPreview(j.data);
      } catch {
        // El preview que ya había sigue en pantalla; aplicar re-valida igual.
      } finally {
        setRecalculando(false);
      }
    }, 400);
    return () => clearTimeout(t);
    // `preview` fuera a propósito: este efecto lo REESCRIBE, y tenerlo de
    // dependencia sería pedirse a sí mismo en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapeos, file, periodo, resultado]);

  async function pedirPreview() {
    if (!file) return setError("Elige el fichero");
    setOcupado(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("periodo", periodo);
      const r = await fetch("/api/fichaje/import/preview", { method: "POST", body: fd });
      const j = await r.json();
      if (!j?.ok) {
        setError(j?.error || `HTTP ${r.status}`);
        return;
      }
      setPreview(j.data);
      setPendientesOriginales(j.data.pendientesDeMapeo || []);
      // Las sugerencias vienen premarcadas: son un ahorro real (9 de 14 en el
      // fichero de Aumenta) y siguen siendo revisables antes de confirmar.
      const iniciales = {};
      for (const p of j.data.pendientesDeMapeo || []) {
        if (p.sugerencia) iniciales[p.nombre] = p.sugerencia.id;
      }
      setMapeos(iniciales);
    } catch (e) {
      setError(e.message || "Error de red");
    } finally {
      setOcupado(false);
    }
  }

  async function aplicar() {
    setOcupado(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("periodo", periodo);
      fd.append("mapeos", JSON.stringify(mapeos));
      const r = await fetch("/api/fichaje/import", { method: "POST", body: fd });
      const j = await r.json();
      if (!j?.ok) {
        setError(j?.error || `HTTP ${r.status}`);
        return;
      }
      setResultado(j.data);
    } catch (e) {
      setError(e.message || "Error de red");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={ocupado ? undefined : onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[88dvh] flex flex-col">
        <header className="px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Fichaje</div>
          <h2 className="text-lg font-semibold text-gray-900">Importar el Excel del mes</h2>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* ── Hecho ────────────────────────────────────────────────────── */}
          {resultado ? (
            <div className="py-6 text-center">
              <p className="text-base text-gray-900">
                Entraron <strong>{resultado.creadas}</strong> jornadas de {resultado.periodo}.
              </p>
              {resultado.reemplazadas > 0 && (
                <p className="text-sm text-gray-500 mt-2">
                  Se dieron de baja {resultado.reemplazadas} del volcado anterior de ese mes.
                </p>
              )}
              {resultado.duplicadas > 0 && (
                <p className="text-sm text-gray-500 mt-1">
                  Se descartaron {resultado.duplicadas}{" "}
                  {resultado.duplicadas === 1 ? "fila repetida" : "filas repetidas"} del fichero
                  (misma persona, mismo día y misma hora).
                </p>
              )}
              {resultado.anotaciones > 0 && (
                <p className="text-sm text-gray-500 mt-1">
                  Se guardaron {resultado.anotaciones} anotaciones del fichero.
                </p>
              )}
            </div>
          ) : (
            <>
              {/* ── Paso 1 ─────────────────────────────────────────────── */}
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider text-gray-400 block mb-1">
                    Mes
                  </span>
                  <input
                    type="month"
                    value={periodo}
                    onChange={(e) => {
                      setPeriodo(e.target.value);
                      setPreview(null);
                    }}
                    className="w-full px-3 py-2 text-sm rounded-md border border-gray-200"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider text-gray-400 block mb-1">
                    Fichero
                  </span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => {
                      setFile(e.target.files?.[0] || null);
                      setPreview(null);
                    }}
                    className="w-full text-sm file:mr-2 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-gray-100 file:text-sm"
                  />
                </label>
              </div>
              <p className="text-xs text-gray-500">
                El mes lo eliges tú, no se adivina del fichero. Si el fichero sí dice de qué mes es
                (el volcado del reloj lo dice), se comprueba y no te deja equivocarte.
              </p>

              {!preview && (
                <button
                  type="button"
                  onClick={pedirPreview}
                  disabled={ocupado || !file}
                  className="px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50"
                >
                  {ocupado ? "Leyendo…" : "Ver qué va a pasar"}
                </button>
              )}

              {/* ── Paso 2 ─────────────────────────────────────────────── */}
              {preview && (
                <>
                  <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
                    <strong>{preview.totales.listas}</strong> jornadas listas de{" "}
                    <strong>{preview.totales.personas}</strong> personas ·{" "}
                    {formatearMinutos(preview.totales.minutos)} en total.
                    {preview.totales.bloqueadas > 0 && (
                      <span className="text-amber-700">
                        {" "}
                        · {preview.totales.bloqueadas} sin poder entrar
                      </span>
                    )}
                  </div>

                  {preview.ficheroRepetido && (
                    <Aviso tono="ambar">
                      Este fichero exacto ya se volcó
                      {preview.ficheroRepetido.fecha
                        ? ` el ${new Date(preview.ficheroRepetido.fecha).toLocaleDateString("es-ES")}`
                        : ""}
                      . Si lo vuelves a aplicar, se reemplaza el mes con lo mismo.
                    </Aviso>
                  )}

                  {preview.reemplazo.hayVolcadoPrevio && (
                    <Aviso tono="ambar">
                      Ya hay un volcado de este mes. Al aplicar se darán de baja sus{" "}
                      <strong>{preview.reemplazo.filasQueSeReemplazan}</strong> jornadas y entrarán
                      las nuevas.
                      {preview.reemplazo.correccionesQueSobreviven > 0 && (
                        <>
                          {" "}
                          Las <strong>{preview.reemplazo.correccionesQueSobreviven}</strong>{" "}
                          corregidas a mano se conservan.
                        </>
                      )}
                    </Aviso>
                  )}

                  {/* Lo que BLOQUEA */}
                  {pendientes.length > 0 && (
                    <section>
                      <h3 className="text-sm font-medium text-gray-900 mb-1">
                        ¿Quién es cada uno?
                      </h3>
                      <p className="text-xs text-gray-500 mb-3">
                        Estos nombres del Excel no casan con nadie del equipo. Hay que decirlo una
                        vez: el mes que viene ya se reconocen solos. Ninguna fila se importa a ojo.
                      </p>
                      <ul className="space-y-2">
                        {pendientes.map((p) => (
                          <li key={p.nombre} className="flex items-center gap-3">
                            <span className="text-sm text-gray-900 w-40 truncate">{p.nombre}</span>
                            <select
                              value={mapeos[p.nombre] || ""}
                              onChange={(e) =>
                                setMapeos((m) => ({ ...m, [p.nombre]: e.target.value }))
                              }
                              className="flex-1 px-2 py-1.5 text-sm rounded-md border border-gray-200"
                            >
                              <option value="">— elegir persona —</option>
                              {preview.equipo.map((e2) => (
                                <option key={e2.id} value={e2.id}>
                                  {e2.nombre}
                                </option>
                              ))}
                            </select>
                            {p.sugerencia && !mapeos[p.nombre] && (
                              <span className="text-[11px] text-gray-400 hidden sm:inline">
                                {p.sugerencia.motivo}
                              </span>
                            )}
                            {/* Nombre ambiguo (dos personas se llaman así): sin sugerencia a propósito,
                                se dice por qué para que no parezca que el CRM no lo ha visto. */}
                            {!p.sugerencia && p.motivo && !mapeos[p.nombre] && (
                              <span className="text-[11px] text-amber-600 hidden sm:inline">
                                {p.motivo}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {preview.bloqueadas.length > 0 && (
                    <Detalle
                      titulo={`${preview.totales.bloqueadas} filas que no se pueden importar`}
                    >
                      <ul className="text-xs text-gray-600 space-y-1 max-h-40 overflow-y-auto">
                        {preview.bloqueadas.map((b, i) => (
                          <li key={i}>
                            <span className="text-gray-400">
                              {b.hoja} f{b.fila}
                            </span>{" "}
                            · {b.nombreExcel} · {b.fecha} — {b.motivo}
                          </li>
                        ))}
                      </ul>
                    </Detalle>
                  )}

                  {preview.anotaciones?.length > 0 && (
                    <Detalle
                      titulo={`${preview.anotaciones.length} anotaciones escritas en el Excel`}
                    >
                      <ul className="text-xs text-gray-600 space-y-1">
                        {preview.anotaciones.map((a, i) => (
                          <li key={i}>
                            {a.fecha} · <strong>{a.nombreExcel}</strong> — «{a.texto}»
                          </li>
                        ))}
                      </ul>
                    </Detalle>
                  )}

                  {preview.avisosDelFichero?.length > 0 && (
                    <div className="space-y-1">
                      {preview.avisosDelFichero.map((a, i) => (
                        <Aviso key={i} tono={a.nivel === "error" ? "rojo" : "ambar"}>
                          {a.texto}
                        </Aviso>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={resultado ? onHecho : onClose}
            disabled={ocupado}
            className="px-4 py-2 text-sm rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {resultado ? "Cerrar" : "Cancelar"}
          </button>
          {preview && !resultado && (
            <button
              type="button"
              onClick={aplicar}
              disabled={ocupado || !puedeAplicar}
              className="px-4 py-2 text-sm rounded-md bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50"
              title={sinResolver.length ? "Faltan nombres por asignar" : undefined}
            >
              {ocupado
                ? "Importando…"
                : sinResolver.length
                  ? `Faltan ${sinResolver.length} por asignar`
                  : recalculando
                    ? "Recalculando…"
                    : `Importar ${preview.totales.listas} jornadas`}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function Aviso({ tono, children }) {
  const cls = tono === "rojo" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800";
  return <div className={`rounded-lg px-4 py-2.5 text-sm ${cls}`}>{children}</div>;
}

function Detalle({ titulo, children }) {
  return (
    <details className="rounded-lg border border-gray-100">
      <summary className="px-4 py-2.5 text-sm text-gray-700 cursor-pointer select-none">
        {titulo}
      </summary>
      <div className="px-4 pb-3">{children}</div>
    </details>
  );
}
