"use client";

import { useCallback, useEffect, useState } from "react";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";

/**
 * Equipo → Ocupación — el informe de agenda que pide quien dirige un centro:
 * cuántas citas hubo, cuántas se atendieron, cuántas se cayeron y a cuántas no
 * se presentó nadie, por profesional.
 *
 * El dato de "no presentado" existía en cada cita desde siempre, pero no se
 * sumaba en ninguna parte: había que contarlo a mano. Una silla vacía es una
 * hora facturable perdida, así que es el primer número que interesa.
 *
 * Solo admin (la API responde 403 al resto y aquí se explica).
 */

function mesAnterior(periodo) {
  const [y, m] = periodo.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
function mesSiguiente(periodo) {
  const [y, m] = periodo.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
function nombreMes(periodo) {
  const [y, m] = periodo.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

/** Color del semáforo de ausencias. Umbrales de sentido común, no dogma. */
function colorNoShow(tasa) {
  if (tasa == null) return "text-neutral-400";
  if (tasa >= 15) return "text-red-600";
  if (tasa >= 8) return "text-amber-600";
  return "text-emerald-600";
}

function Tarjeta({ titulo, valor, sufijo, pista, acento }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4">
      <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">{titulo}</div>
      <div className={`text-2xl font-semibold mt-1 tabular-nums ${acento || "text-neutral-900"}`}>
        {valor}
        {sufijo && <span className="text-sm font-normal text-neutral-400 ml-0.5">{sufijo}</span>}
      </div>
      {pista && <div className="text-[11px] text-neutral-400 mt-0.5">{pista}</div>}
    </div>
  );
}

export default function OcupacionPage() {
  const [periodo, setPeriodo] = useState(() => {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
  });
  const [datos, setDatos] = useState(null);
  const [err, setErr] = useState(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(() => {
    setCargando(true);
    setErr(null);
    fetch(`/api/citas/informe-ocupacion?periodo=${periodo}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ status: r.status, j })))
      .then(({ status, j }) => {
        if (j.ok) setDatos(j.data);
        else setErr(status === 403 ? "Este informe es solo para administradores." : j.error || "Error");
      })
      .catch(() => setErr("No se pudo cargar el informe"))
      .finally(() => setCargando(false));
  }, [periodo]);

  useEffect(() => { cargar(); }, [cargar]);

  const t = datos?.totales;
  const maxServicio = Math.max(1, ...(datos?.porServicio ?? []).map((s) => s.n));

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-5">
        <div className="eyebrow mb-1.5">Equipo · Agenda</div>
        <h1 className="font-display text-[26px] lg:text-[34px] leading-[1.05] text-[var(--ink-900)] tracking-tight">
          Ocupación y ausencias
          <HelpTooltip title="Ocupación" className="ml-2">
            Cuenta las citas del mes y las horas de las que ya se atendieron.{" "}
            <strong className="text-white">No se compara con la jornada de nadie</strong>: no hay
            horas de contrato ni huecos libres de la agenda, así que quien libre medio mes sale
            simplemente con menos citas. El «Ocupación %» de Desempeño es otro número: sale de
            Productividad, que sí mide las horas contra el objetivo semanal de cada persona.
          </HelpTooltip>
        </h1>
        <p className="text-xs text-neutral-400 mt-2">
          Cómo se ha llenado la agenda y cuánta se ha perdido. Solo lo ven los administradores.
        </p>
      </div>

      {/* Selector de mes */}
      <div className="flex items-center gap-2 mb-5">
        <button onClick={() => setPeriodo(mesAnterior(periodo))}
          className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 text-xs">
          ←
        </button>
        <span className="text-sm font-medium text-neutral-700 capitalize min-w-[9rem] text-center">
          {nombreMes(periodo)}
        </span>
        <button onClick={() => setPeriodo(mesSiguiente(periodo))}
          className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 text-xs">
          →
        </button>
      </div>

      {err && (
        <div className="bg-white border border-neutral-200 rounded-xl px-5 py-8 text-center text-sm text-neutral-500">{err}</div>
      )}

      {!err && cargando && !datos && (
        <div className="bg-white border border-neutral-200 rounded-xl px-5 py-8 text-center text-xs text-neutral-400">Cargando informe…</div>
      )}

      {!err && datos && t && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Tarjeta titulo="Citas del mes" valor={t.total} pista={`${t.horasAtendidas} h atendidas`} />
            <Tarjeta
              titulo="Atendidas"
              valor={t.atendidas}
              // Las confirmadas que aún no han llegado a su hora se cuentan
              // aparte: antes entraban como atendidas e inflaban el mes en curso.
              pista={t.proximas ? `${t.proximas} aún por venir` : undefined}
              acento="text-emerald-700"
            />
            <Tarjeta
              titulo="No se presentaron"
              valor={t.noShow}
              pista={t.tasaNoShow != null ? `${t.tasaNoShow}% de las que llegaron a su hora` : "—"}
              acento={colorNoShow(t.tasaNoShow)}
            />
            <Tarjeta
              titulo="Canceladas"
              valor={t.canceladas}
              pista={t.tasaCancelacion != null ? `${t.tasaCancelacion}% del total` : "—"}
              acento="text-neutral-500"
            />
          </div>

          {t.total === 0 ? (
            <div className="bg-white border border-neutral-200 rounded-xl px-5 py-10 text-center">
              <div className="text-sm text-neutral-500">No hay citas registradas en {nombreMes(periodo)}.</div>
              <div className="text-[11px] text-neutral-400 mt-1">Prueba con otro mes.</div>
            </div>
          ) : (
            <>
              {/* Por profesional */}
              <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden mb-6">
                <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
                  <span className="text-sm font-semibold text-neutral-700">Por profesional</span>
                  <span className="text-[10px] text-neutral-400 uppercase tracking-widest">{datos.profesionales.length}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[620px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-widest text-neutral-400 border-b border-neutral-100">
                        <th className="text-left font-semibold px-4 py-2">Profesional</th>
                        <th className="text-right font-semibold px-3 py-2">Citas</th>
                        <th className="text-right font-semibold px-3 py-2">Atendidas</th>
                        <th className="text-right font-semibold px-3 py-2">Horas</th>
                        <th className="text-right font-semibold px-3 py-2">Canceladas</th>
                        <th className="text-right font-semibold px-3 py-2">No vinieron</th>
                        <th className="text-right font-semibold px-4 py-2">% ausencias</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {datos.profesionales.map((p) => (
                        <tr key={p.teamMemberId ?? "sin"} className="hover:bg-neutral-50/60">
                          <td className="px-4 py-2.5 text-neutral-800">{p.nombre}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{p.total}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-neutral-800">{p.atendidas}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{p.horasAtendidas}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">{p.canceladas}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-neutral-800">{p.noShow}</td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${colorNoShow(p.tasaNoShow)}`}>
                            {p.tasaNoShow != null ? `${p.tasaNoShow}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-2.5 text-[10px] text-neutral-400 border-t border-neutral-100">
                  El % de ausencias se calcula sobre las citas que llegaron a su hora (atendidas + no presentadas).
                  Las canceladas con aviso no cuentan: avisar a tiempo es lo que se quiere fomentar.
                </p>
              </div>

              {/* Por servicio */}
              {datos.porServicio.length > 0 && (
                <div className="bg-white border border-neutral-200 rounded-xl p-4">
                  <div className="text-sm font-semibold text-neutral-700 mb-3">Qué llena la agenda</div>
                  <div className="space-y-2">
                    {datos.porServicio.map((s) => (
                      <div key={s.nombre} className="flex items-center gap-3">
                        <span className="text-xs text-neutral-600 w-44 truncate shrink-0">{s.nombre}</span>
                        <div className="flex-1 h-2 rounded-full bg-neutral-100 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${(s.n / maxServicio) * 100}%`, background: "var(--color-primary, #1B3A2D)" }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-neutral-500 w-8 text-right shrink-0">{s.n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
