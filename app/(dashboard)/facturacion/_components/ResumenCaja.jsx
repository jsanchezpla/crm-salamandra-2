"use client";

/**
 * ResumenCaja — el resumen POR DÍA de lo cobrado en efectivo, tarjeta y banco
 * (01/09/2026, petición de Aumenta).
 *
 * Una fila por día, con los días vacíos incluidos: un día sin caja es un dato,
 * no una fila que falta. La domiciliación cuenta como banco (para quien mira el
 * día es lo mismo); un cobro PENDIENTE no cuenta, y por eso se enseña aparte —
 * desde que las cuotas se generan solas, son cientos de filas al mes.
 *
 * ── Y DEBAJO DE CADA DÍA, SUS COBROS (04/09/2026, Rodrigo) ─────────────────
 * «Solo sale el total del día, tanto en efectivo como en tarjeta como en
 * banco»: con eso se cuadra el cajón, pero no se puede repasar. Cada día se
 * despliega y enseña la lista de lo que lo compone —hora, de quién es, cómo
 * pagó y cuánto—, que suma exactamente el total de su fila. Se abre pulsando el
 * día, o todos a la vez con la casilla de arriba; y cuando se mira UN SOLO día
 * (mismo desde y hasta, el cierre de caja de hoy) sale ya abierto, porque
 * entonces la lista es justo lo que se ha venido a ver.
 *
 * ── Y CADA COBRO SE ABRE, Y EL RESUMEN SE EXPORTA (04/09/2026, Rodrigo) ─────
 * Pulsar un cobro saca su vista lateral (`CobroDrawer.jsx`): sus datos, los
 * mismos campos que Cobros para corregirlo, borrarlo, y un ticket para la
 * familia. Antes había que apuntar el nombre, irse a Cobros y buscarlo entre
 * cientos. Y «Exportar a Excel» baja el periodo elegido en dos hojas —el día y
 * el cobro—, con las mismas cifras que la pantalla porque salen de la misma
 * función de servidor (`lib/billing/resumenCaja.js`).
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fmtMoney, fmtDate } from "./Kpi.jsx";
import CobroDrawer from "./CobroDrawer.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

// Los mismos rótulos que la pantalla de Cobros: es el mismo dato.
const METODOS = {
  card: "Tarjeta",
  transfer: "Transferencia",
  cash: "Efectivo",
  direct_debit: "Domiciliación",
};

const hoy = () => new Date().toISOString().slice(0, 10);
const primeroDeMes = () => `${new Date().toISOString().slice(0, 7)}-01`;

/** La hora del cobro, en Madrid: el servidor va en UTC y el cajón, no. */
function fmtHora(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  });
}

export default function ResumenCaja({ cajaId }) {
  const [desde, setDesde] = useState(primeroDeMes());
  const [hasta, setHasta] = useState(hoy());
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [soloConMovimiento, setSoloConMovimiento] = useState(true);
  // Qué días están desplegados. `verTodos` los abre de golpe; un solo día
  // pedido (desde === hasta) abre el suyo sin que haya que pulsarlo.
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [verTodos, setVerTodos] = useState(false);
  // El cobro abierto en la vista lateral. Se guarda la fila del resumen además
  // del id para poner el nombre en la cabecera mientras carga la ficha.
  const [cobroAbierto, setCobroAbierto] = useState(null);
  const unSoloDia = desde === hasta;

  const alternar = useCallback((fecha) => {
    setAbiertos((previos) => {
      const siguiente = new Set(previos);
      if (siguiente.has(fecha)) siguiente.delete(fecha);
      else siguiente.add(fecha);
      return siguiente;
    });
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams({ desde, hasta });
      if (cajaId) qs.set("cajaId", cajaId);
      const r = await fetch(`/api/arqueo/resumen?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo cargar el resumen");
      setDatos(j.data);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, cajaId]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setAbiertos(new Set()); }, [desde, hasta, cajaId]);

  const dias = (datos?.dias ?? []).filter(
    (d) => !soloConMovimiento || d.cobrado !== 0 || d.movimientos.entradas !== 0 || d.movimientos.salidas !== 0
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[12px] text-neutral-500">
          Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={`${inputCls} py-1.5`} />
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-neutral-500">
          Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={`${inputCls} py-1.5`} />
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-neutral-600">
          <input type="checkbox" checked={soloConMovimiento} onChange={(e) => setSoloConMovimiento(e.target.checked)} />
          Ocultar los días sin nada
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-neutral-600">
          <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} />
          Ver los cobros de cada día
        </label>
        {/* El Excel del periodo ELEGIDO (04/09/2026, Rodrigo): las mismas
            fechas que se están mirando, y las mismas cifras — sale de la misma
            función de servidor que esta tabla. */}
        <a
          href={`/api/arqueo/exports/resumen?desde=${desde}&hasta=${hasta}${cajaId ? `&cajaId=${cajaId}` : ""}`}
          className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Exportar a Excel
        </a>
      </div>

      {errorMsg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{errorMsg}</div>}

      {datos && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tarjeta titulo="Efectivo" valor={fmtMoney(datos.total.efectivo.importe)} pie={`${datos.total.efectivo.cobros} cobros`} />
          <Tarjeta titulo="Tarjeta" valor={fmtMoney(datos.total.tarjeta.importe)} pie={`${datos.total.tarjeta.cobros} cobros`} />
          <Tarjeta titulo="Banco" valor={fmtMoney(datos.total.banco.importe)} pie={`${datos.total.banco.cobros} cobros · incluye domiciliaciones`} />
          <Tarjeta titulo="Total cobrado" valor={fmtMoney(datos.total.cobrado)} pie={datos.total.pendiente ? `${fmtMoney(datos.total.pendiente)} pendiente, sin contar` : "todo cobrado"} />
        </div>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">Día</th>
                <th className="text-right font-medium px-3 py-2">Efectivo</th>
                <th className="text-right font-medium px-3 py-2">Tarjeta</th>
                <th className="text-right font-medium px-3 py-2">Banco</th>
                <th className="text-right font-medium px-3 py-2">Total</th>
                <th className="text-right font-medium px-3 py-2">Caja (+/−)</th>
              </tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={6} className="px-3 py-6 text-center text-neutral-400">Cargando…</td></tr>}
              {!cargando && dias.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-neutral-400">
                  Ningún cobro en estas fechas.
                </td></tr>
              )}
              {!cargando && dias.map((d) => {
                const cobros = d.lista ?? [];
                const abierto = verTodos || unSoloDia || abiertos.has(d.fecha);
                const desplegable = cobros.length > 0 || d.pendientes?.cobros > 0;
                return (
                  <Fragment key={d.fecha}>
                    <tr
                      className={`border-t border-neutral-100 ${desplegable ? "cursor-pointer hover:bg-neutral-50" : ""}`}
                      onClick={desplegable ? () => alternar(d.fecha) : undefined}
                    >
                      <td className="px-3 py-2 text-neutral-700">
                        {desplegable ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); alternar(d.fecha); }}
                            aria-expanded={abierto}
                            className="inline-flex items-center gap-1.5 text-left hover:text-neutral-900 transition-colors"
                          >
                            <span className={`text-neutral-400 transition-transform ${abierto ? "rotate-90" : ""}`} aria-hidden="true">›</span>
                            {fmtDate(d.fecha)}
                            {cobros.length > 0 && (
                              <span className="text-[11px] text-neutral-400">
                                · {cobros.length} {cobros.length === 1 ? "cobro" : "cobros"}
                              </span>
                            )}
                          </button>
                        ) : (
                          <span className="pl-[18px] inline-block">{fmtDate(d.fecha)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular text-neutral-600">{d.efectivo.importe ? fmtMoney(d.efectivo.importe) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular text-neutral-600">{d.tarjeta.importe ? fmtMoney(d.tarjeta.importe) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular text-neutral-600">{d.banco.importe ? fmtMoney(d.banco.importe) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular font-semibold text-neutral-900">{fmtMoney(d.cobrado)}</td>
                      <td className="px-3 py-2 text-right tabular text-neutral-500">
                        {d.movimientos.entradas === 0 && d.movimientos.salidas === 0
                          ? "—"
                          : <span className={d.movimientos.neto < 0 ? "text-rose-600" : "text-emerald-700"}>
                              {d.movimientos.neto > 0 ? "+" : ""}{fmtMoney(d.movimientos.neto)}
                            </span>}
                      </td>
                    </tr>

                    {/* El detalle del día: lo que suma la fila de arriba, cobro
                        a cobro y en orden de hora. */}
                    {abierto && desplegable && (
                      <tr className="bg-neutral-50/70">
                        <td colSpan={6} className="px-3 pb-3 pt-1">
                          {cobros.length > 0 && (
                            <table className="w-full text-[12px]">
                              <thead className="text-neutral-400">
                                <tr>
                                  <th className="text-left font-medium px-2 py-1 w-16">Hora</th>
                                  <th className="text-left font-medium px-2 py-1">Paciente / cliente</th>
                                  <th className="text-left font-medium px-2 py-1">Método</th>
                                  <th className="text-left font-medium px-2 py-1">Factura</th>
                                  <th className="text-right font-medium px-2 py-1">Importe</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cobros.map((c) => (
                                  /* Pulsar el cobro abre su vista lateral: sus
                                     datos, editarlo, borrarlo y el ticket
                                     (04/09/2026, Rodrigo). El `stopPropagation`
                                     evita que el clic pliegue el día. */
                                  <tr
                                    key={c.id}
                                    onClick={(e) => { e.stopPropagation(); setCobroAbierto(c); }}
                                    className="border-t border-neutral-200/70 cursor-pointer hover:bg-white transition-colors"
                                    title="Ver el cobro, editarlo o sacar su ticket"
                                  >
                                    <td className="px-2 py-1.5 text-neutral-500 tabular">{fmtHora(c.paidAt)}</td>
                                    {/* El paciente primero y el pagador detrás, como en Cobros
                                        (03/09/2026, Aumenta). Sin paciente queda el cliente solo. */}
                                    <td className="px-2 py-1.5 text-neutral-700">
                                      {c.patientName ? (
                                        <>
                                          {c.patientName}
                                          <span className="text-neutral-400"> · {c.clientName ?? "—"}</span>
                                        </>
                                      ) : (
                                        c.clientName ?? <span className="text-neutral-400">—</span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 text-neutral-600">{METODOS[c.method] ?? c.method}</td>
                                    <td className="px-2 py-1.5 font-mono text-[11.5px]">
                                      {c.invoiceId ? (
                                        <Link
                                          href={`/facturacion/facturas/${c.invoiceId}`}
                                          onClick={(e) => e.stopPropagation()}
                                          className="text-[var(--color-primary,#1B3A2D)] hover:underline"
                                        >
                                          {c.invoiceNumber}
                                        </Link>
                                      ) : (
                                        <span className="text-neutral-400">
                                          sin factura{c.periodMonth ? ` · ${c.periodMonth}` : ""}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 text-right tabular font-medium text-neutral-800">{fmtMoney(c.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {/* Los pendientes de ese día no están en la lista porque no
                              suman: se dicen para que nadie los eche en falta. */}
                          {d.pendientes?.cobros > 0 && (
                            <p className="text-[11.5px] text-neutral-500 mt-2 px-2">
                              Y {d.pendientes.cobros} {d.pendientes.cobros === 1 ? "cobro pendiente" : "cobros pendientes"} por{" "}
                              {fmtMoney(d.pendientes.importe)}, que no cuentan en la caja hasta que entren.{" "}
                              <Link href="/facturacion/cobros" onClick={(e) => e.stopPropagation()} className="underline hover:text-neutral-700">
                                Verlos en Cobros
                              </Link>
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            {datos && dias.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-neutral-200 bg-neutral-50 font-semibold text-neutral-800">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular">{fmtMoney(datos.total.efectivo.importe)}</td>
                  <td className="px-3 py-2 text-right tabular">{fmtMoney(datos.total.tarjeta.importe)}</td>
                  <td className="px-3 py-2 text-right tabular">{fmtMoney(datos.total.banco.importe)}</td>
                  <td className="px-3 py-2 text-right tabular">{fmtMoney(datos.total.cobrado)}</td>
                  <td className="px-3 py-2 text-right tabular">{fmtMoney(datos.total.movimientos.neto)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {datos?.metodosSinCesta?.length > 0 && (
        <p className="text-[11.5px] text-amber-700">
          Hay cobros con un método que este resumen no sabe clasificar ({datos.metodosSinCesta.join(", ")}):
          no están sumados en ninguna columna.
        </p>
      )}

      {cobroAbierto && (
        <CobroDrawer
          cobroId={cobroAbierto.id}
          resumen={cobroAbierto}
          onClose={() => setCobroAbierto(null)}
          onCambiado={cargar}
        />
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, pie }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-neutral-400">{titulo}</div>
      <div className="text-lg font-semibold text-neutral-800">{valor}</div>
      {pie && <div className="text-[11px] text-neutral-400 mt-0.5">{pie}</div>}
    </div>
  );
}
