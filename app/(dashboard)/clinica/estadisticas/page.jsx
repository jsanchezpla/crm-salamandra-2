"use client";

/**
 * Estadísticas del centro (bloque 6 del sprint Aumenta, punto 10).
 *
 * Tres bloques —actividad clínica, agenda y ausencias, captación— sobre el
 * periodo que se elija, con Excel y PDF. Los tres salen del mismo cálculo del
 * servidor (`lib/clinica/estadisticas.js`): lo que se lleva a la reunión y lo
 * que se ve aquí no pueden decir cosas distintas.
 *
 * El dinero NO está aquí a propósito: vive en Facturación (cobros y morosidad).
 */

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * 'AAAA-MM-DD' EN LOCAL. Con `toISOString()` (UTC) el 1 de julio a las 00:00
 * en España se convierte en «30 de junio»: el periodo empezaba un día antes de
 * lo que decía el botón.
 */
function fechaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function primeroDeMes(d = new Date()) {
  return fechaISO(new Date(d.getFullYear(), d.getMonth(), 1));
}
const hoyISO = () => fechaISO(new Date());

/** Curso escolar en marcha: de septiembre a agosto. */
function cursoActual() {
  const hoy = new Date();
  const inicio = hoy.getMonth() + 1 >= 9 ? hoy.getFullYear() : hoy.getFullYear() - 1;
  return { desde: `${inicio}-09-01`, hasta: hoyISO() };
}

function trimestreActual() {
  const hoy = new Date();
  const t = Math.floor(hoy.getMonth() / 3);
  return {
    desde: fechaISO(new Date(hoy.getFullYear(), t * 3, 1)),
    hasta: hoyISO(),
  };
}

function Kpi({ label, value, sub, tono = "neutral" }) {
  const color =
    tono === "bien" ? "text-emerald-700" : tono === "ojo" ? "text-amber-700" : tono === "mal" ? "text-red-700" : "text-[var(--ink-900)]";
  return (
    <div className="bg-white border border-neutral-100 rounded-xl px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-neutral-400">{label}</div>
      <div className={`text-2xl font-display mt-0.5 tabular ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-neutral-400 mt-0.5">{sub}</div>}
    </div>
  );
}

/** Barras horizontales sin librería: son cuatro filas, no hace falta un motor. */
function Barras({ datos, etiqueta, valor }) {
  const max = Math.max(1, ...datos.map((d) => valor(d)));
  return (
    <div className="space-y-1.5">
      {datos.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-[11px] text-neutral-600 w-40 shrink-0 truncate">{etiqueta(d)}</span>
          <span className="flex-1 h-2 rounded-full bg-neutral-100 overflow-hidden">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.round((valor(d) / max) * 100)}%`, background: "var(--color-primary, #1B3A2D)" }}
            />
          </span>
          <span className="text-[11px] text-neutral-700 tabular w-10 text-right">{valor(d)}</span>
        </div>
      ))}
    </div>
  );
}

function Panel({ titulo, children, nota }) {
  return (
    <section className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
      <div className="px-4 lg:px-5 py-3 border-b border-neutral-100">
        <h2 className="eyebrow">{titulo}</h2>
      </div>
      <div className="px-4 lg:px-5 py-4 space-y-4">{children}</div>
      {nota && <p className="px-4 lg:px-5 py-2 text-[10px] text-neutral-400 border-t border-neutral-50">{nota}</p>}
    </section>
  );
}

export default function EstadisticasPage() {
  const [rango, setRango] = useState({ desde: primeroDeMes(), hasta: hoyISO() });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const qs = useMemo(() => `desde=${rango.desde}&hasta=${rango.hasta}`, [rango]);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/clinica/estadisticas?${qs}`, { cache: "no-store" })
      .then(async (r) => ({ r, j: await r.json().catch(() => ({})) }))
      .then(({ r, j }) => {
        if (r.status === 403) throw new Error("Las estadísticas del centro las ve dirección");
        if (!j.ok) throw new Error(j.error || "No se pudieron cargar las estadísticas");
        setData(j.data);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [qs]);

  useEffect(() => load(), [load]);

  const c = data?.clinica;
  const a = data?.agenda;
  const cap = data?.captacion;

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow">Clínica</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1">Estadísticas del centro</h1>
          <p className="text-xs text-neutral-500 mt-1">
            Actividad, agenda y captación del periodo. Los números de dinero están en Facturación.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/clinica/estadisticas/export?formato=xlsx&${qs}`}
            className="text-xs px-3 py-2 rounded-lg border border-neutral-200 text-neutral-700 hover:border-neutral-400"
          >
            Excel
          </a>
          <a
            href={`/api/clinica/estadisticas/export?formato=pdf&${qs}`}
            className="text-xs px-3 py-2 rounded-lg text-white"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            PDF del periodo
          </a>
        </div>
      </div>

      {/* Periodo */}
      <div className="bg-white border border-neutral-100 rounded-xl px-4 py-3 flex flex-wrap items-center gap-2">
        {[
          ["Este mes", { desde: primeroDeMes(), hasta: hoyISO() }],
          ["Trimestre", trimestreActual()],
          ["Curso", cursoActual()],
        ].map(([label, r]) => (
          <button
            key={label}
            onClick={() => setRango(r)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition ${rango.desde === r.desde && rango.hasta === r.hasta ? "border-transparent text-white" : "bg-white border-neutral-200 text-neutral-500"}`}
            style={rango.desde === r.desde && rango.hasta === r.hasta ? { background: "var(--color-primary, #1B3A2D)" } : undefined}
          >
            {label}
          </button>
        ))}
        <span className="text-[11px] text-neutral-400 mx-1">o</span>
        <input
          type="date"
          value={rango.desde}
          onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))}
          className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs"
        />
        <span className="text-[11px] text-neutral-400">a</span>
        <input
          type="date"
          value={rango.hasta}
          onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))}
          className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs"
        />
      </div>

      {error && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{error}</div>}
      {loading && <div className="text-sm text-neutral-400">Calculando…</div>}

      {!loading && data && (
        <div className="space-y-5">
          {c && (
            <Panel
              titulo="Actividad clínica"
              nota="Se cuenta sobre las sesiones y los informes reales del periodo; no hay contadores guardados."
            >
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi label="Pacientes activos" value={c.pacientesActivos} sub={c.pacientesEnPausa ? `${c.pacientesEnPausa} en pausa` : null} />
                <Kpi label="Altas / bajas" value={`${c.altas} / ${c.bajas}`} sub="en el periodo" />
                <Kpi label="Sesiones" value={c.sesiones} />
                <Kpi
                  label="Informes en plazo"
                  value={c.informesEnPlazoPct == null ? "—" : `${c.informesEnPlazoPct}%`}
                  sub={`${c.informesEntregados} entregados de ${c.informes}`}
                  tono={c.informesEnPlazoPct == null ? "neutral" : c.informesEnPlazoPct >= 85 ? "bien" : c.informesEnPlazoPct >= 60 ? "ojo" : "mal"}
                />
              </div>

              {c.terapeutas.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-2">Sesiones por terapeuta</div>
                  <Barras datos={c.terapeutas} etiqueta={(t) => t.name} valor={(t) => t.sesiones} />
                </div>
              )}

              {c.especialidades.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-2">Pacientes activos por especialidad</div>
                  <Barras datos={c.especialidades} etiqueta={(e) => e.label} valor={(e) => e.pacientes} />
                </div>
              )}
            </Panel>
          )}

          {a && (
            <Panel
              titulo="Agenda y ausencias"
              nota="La tasa de ausencias se calcula sobre las citas que llegaron a su hora (atendidas + no presentadas): las canceladas con aviso no penalizan."
            >
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi label="Citas" value={a.total} />
                <Kpi label="Atendidas" value={a.porEstado.find((e) => e.estado === "completed")?.citas ?? 0} />
                <Kpi
                  label="Faltas"
                  value={a.faltas}
                  sub={`${a.faltasJustificadas} justificadas · ${a.faltasSinJustificar} sin justificar`}
                />
                <Kpi
                  label="Tasa de ausencias"
                  value={a.tasaAusenciasPct == null ? "—" : `${a.tasaAusenciasPct}%`}
                  tono={a.tasaAusenciasPct == null ? "neutral" : a.tasaAusenciasPct < 8 ? "bien" : a.tasaAusenciasPct < 15 ? "ojo" : "mal"}
                />
              </div>

              {a.profesionales.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[480px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-neutral-400 border-b border-neutral-100">
                        <th className="text-left px-2 py-2 font-medium">Profesional</th>
                        <th className="text-right px-2 py-2 font-medium">Citas</th>
                        <th className="text-right px-2 py-2 font-medium">Atendidas</th>
                        <th className="text-right px-2 py-2 font-medium">Faltas</th>
                        <th className="text-right px-2 py-2 font-medium">Ausencias</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.profesionales.map((p) => (
                        <tr key={p.therapistId} className="border-b border-neutral-50">
                          <td className="px-2 py-2 text-xs text-neutral-800">{p.name}</td>
                          <td className="px-2 py-2 text-xs text-right tabular text-neutral-600">{p.citas}</td>
                          <td className="px-2 py-2 text-xs text-right tabular text-neutral-600">{p.atendidas}</td>
                          <td className="px-2 py-2 text-xs text-right tabular text-neutral-600">{p.faltas}</td>
                          <td className="px-2 py-2 text-xs text-right tabular text-neutral-600">
                            {p.tasaAusenciasPct == null ? "—" : `${p.tasaAusenciasPct}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          {cap && (
            <Panel
              titulo="Captación"
              nota="La espera media se calcula con la última modificación de cada entrada convertida: es aproximada."
            >
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi label="Leads nuevos" value={cap.leads} />
                <Kpi label="Clientes nuevos" value={cap.clientesNuevos} />
                <Kpi label="En lista de espera" value={cap.listaEspera.enEspera} sub={`${cap.listaEspera.convertidos} entraron en el periodo`} />
                <Kpi
                  label="Espera media"
                  value={cap.listaEspera.esperaMediaDias == null ? "—" : `${cap.listaEspera.esperaMediaDias} d`}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {cap.leadsPorOrigen.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-2">De dónde llegan los leads</div>
                    <Barras datos={cap.leadsPorOrigen} etiqueta={(o) => o.origen} valor={(o) => o.leads} />
                  </div>
                )}
                {cap.clientesPorOrigen.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-2">Cómo entran los clientes nuevos</div>
                    <Barras datos={cap.clientesPorOrigen} etiqueta={(o) => o.origen} valor={(o) => o.clientes} />
                  </div>
                )}
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
