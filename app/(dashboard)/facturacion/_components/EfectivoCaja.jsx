"use client";

/**
 * EfectivoCaja — lo que QUEDA en el cajón cada día (09/09/2026, petición de
 * Aumenta: «solo un apartado de efectivo donde se vea cada día lo que queda en
 * caja a golpe de vista, una vez restadas las salidas de caja»).
 *
 * ── Por qué es otra pestaña y no una columna más ───────────────────────────
 * «Resumen por día» contesta cuánto ENTRÓ cada día, separando efectivo,
 * tarjeta y banco, y se queda exactamente como está (lo pidieron así: «que la
 * otra permanezca totalizada como está»). Aquí se contesta otra pregunta:
 * cuánto HAY. El cajón arrastra —lo que quedó ayer sigue ahí hoy— y las
 * salidas lo bajan, así que sumar la columna «Efectivo» de siete días no da
 * este número.
 *
 * La tarjeta y el banco no aparecen: no pasan por el cajón. La cuenta está en
 * `lib/billing/caja.js` (`saldoDiarioEfectivo`), con su prueba, y el punto de
 * partida es lo contado en el último cierre anterior al periodo.
 */

import { useCallback, useEffect, useState } from "react";
import { hoyVigente, mesVigente } from "@/lib/billing/cuotas.js";
import { fmtMoney } from "./Kpi.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

const hoy = () => hoyVigente();
const primeroDeMes = () => `${mesVigente()}-01`;

/** «2026-09-09» → «9 sep» (la columna del día se lee de un vistazo). */
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fmtDia(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return String(iso ?? "");
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]}`;
}

/** «2026-09-09» → «09/09/2026», para las frases. */
function fmtFecha(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? "");
}

export default function EfectivoCaja({ cajaId, onApuntar }) {
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
      if (!j.ok) throw new Error(j.error || "No se pudo cargar el efectivo");
      setDatos(j.data);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, cajaId]);

  useEffect(() => { cargar(); }, [cargar]);

  // Un día sin efectivo ni apuntes no cambia el cajón: se puede esconder sin
  // que el saldo de las demás filas deje de cuadrar (cada fila lleva el suyo).
  const dias = (datos?.dias ?? []).filter(
    (d) => !soloConMovimiento || (d.efectivoDelDia?.movimiento ?? 0) !== 0
  );

  const partida = datos?.saldoInicial ?? null;
  const totalEntrado = Number(datos?.total?.efectivo?.importe ?? 0) + Number(datos?.total?.movimientos?.entradas ?? 0);
  const totalSalido = Number(datos?.total?.movimientos?.salidas ?? 0);

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
          Ocultar los días en que no se movió el cajón
        </label>
        {onApuntar && (
          <button
            type="button"
            onClick={onApuntar}
            className="ml-auto text-[11px] font-medium px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition"
          >
            Apuntar una entrada o salida
          </button>
        )}
      </div>

      {errorMsg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{errorMsg}</div>}

      {datos && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-emerald-700/70">Queda en caja</div>
            <div className="text-2xl font-semibold text-emerald-800 tabular">{fmtMoney(datos.enCajaAlFinal)}</div>
            <div className="text-[11px] text-emerald-700/70 mt-0.5">al cerrar el {fmtFecha(hasta)}</div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">Se partía de</div>
            <div className="text-lg font-semibold text-neutral-800 tabular">{fmtMoney(partida?.importe ?? 0)}</div>
            <div className="text-[11px] text-neutral-400 mt-0.5">
              {partida ? `contado al cerrar el ${fmtFecha(partida.fecha)}` : "sin cierre anterior: se empieza en cero"}
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">Entró en efectivo</div>
            <div className="text-lg font-semibold text-neutral-800 tabular">{fmtMoney(totalEntrado)}</div>
            <div className="text-[11px] text-neutral-400 mt-0.5">
              {datos.total.efectivo.cobros} {datos.total.efectivo.cobros === 1 ? "cobro" : "cobros"}
              {datos.total.movimientos.entradas > 0 && ` · ${fmtMoney(datos.total.movimientos.entradas)} apuntados a mano`}
              {/* Un cobro devuelto entró y volvió a salir: sin decirlo, el
                  recuento de cobros no cuadra con el importe (09/09/2026). */}
              {datos.total.efectivo.devuelto > 0 && ` · ${fmtMoney(datos.total.efectivo.devuelto)} devueltos, ya restados`}
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">Salió de caja</div>
            <div className={`text-lg font-semibold tabular ${totalSalido > 0 ? "text-rose-700" : "text-neutral-800"}`}>
              {totalSalido > 0 ? `− ${fmtMoney(totalSalido)}` : fmtMoney(0)}
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5">pagos, sobres al banco, cambio…</div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">Día</th>
                <th className="text-right font-medium px-3 py-2">Cobrado en efectivo</th>
                <th className="text-right font-medium px-3 py-2">Otras entradas</th>
                <th className="text-right font-medium px-3 py-2">Salidas</th>
                <th className="text-right font-medium px-3 py-2">Queda en caja</th>
              </tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={5} className="px-3 py-6 text-center text-neutral-400">Cargando…</td></tr>}
              {!cargando && dias.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-neutral-400">
                  El cajón no se movió en estas fechas. Sigue habiendo {fmtMoney(datos?.enCajaAlFinal ?? 0)}.
                </td></tr>
              )}
              {!cargando && dias.map((d) => {
                const e = d.efectivoDelDia ?? { cobrado: 0, entradas: 0, salidas: 0, queda: 0 };
                return (
                  <tr key={d.fecha} className="border-t border-neutral-100">
                    <td className="px-3 py-2 text-neutral-700">{fmtDia(d.fecha)}</td>
                    <td className="px-3 py-2 text-right tabular text-neutral-600">
                      {e.cobrado !== 0 ? fmtMoney(e.cobrado) : <span className="text-neutral-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-neutral-600">
                      {e.entradas !== 0 ? fmtMoney(e.entradas) : <span className="text-neutral-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular">
                      {e.salidas !== 0 ? <span className="text-rose-600">− {fmtMoney(e.salidas)}</span> : <span className="text-neutral-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular font-semibold text-neutral-800">{fmtMoney(e.queda)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11.5px] text-neutral-400">
        Solo efectivo: la tarjeta y el banco no pasan por el cajón.{" "}
        {partida
          ? `Se parte de los ${fmtMoney(partida.importe)} contados al cerrar el ${fmtFecha(partida.fecha)}.`
          : "No hay ningún cierre anterior a estas fechas con dinero contado, así que se empieza en cero: cierra la caja un día y a partir de ahí el saldo se arrastra solo."}
        {" "}Un cobro pendiente no cuenta hasta que entra.
      </p>
    </div>
  );
}
