"use client";

/**
 * ResumenCaja — el resumen POR DÍA de lo cobrado en efectivo, tarjeta y banco
 * (01/09/2026, petición de Aumenta).
 *
 * Una fila por día, con los días vacíos incluidos: un día sin caja es un dato,
 * no una fila que falta. La domiciliación cuenta como banco (para quien mira el
 * día es lo mismo); un cobro PENDIENTE no cuenta, y por eso se enseña aparte —
 * desde que las cuotas se generan solas, son cientos de filas al mes.
 */

import { useCallback, useEffect, useState } from "react";
import { fmtMoney, fmtDate } from "./Kpi.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

const hoy = () => new Date().toISOString().slice(0, 10);
const primeroDeMes = () => `${new Date().toISOString().slice(0, 7)}-01`;

export default function ResumenCaja({ cajaId }) {
  const [desde, setDesde] = useState(primeroDeMes());
  const [hasta, setHasta] = useState(hoy());
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [soloConMovimiento, setSoloConMovimiento] = useState(true);

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
              {!cargando && dias.map((d) => (
                <tr key={d.fecha} className="border-t border-neutral-100">
                  <td className="px-3 py-2 text-neutral-700">{fmtDate(d.fecha)}</td>
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
              ))}
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
