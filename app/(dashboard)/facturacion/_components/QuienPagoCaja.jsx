"use client";

/**
 * QuienPagoCaja — quién pagó cada día, en efectivo, con tarjeta o por el banco,
 * y descargarlo (15/09/2026, AV-0137 de Aumenta).
 *
 * «Efectivo en caja» ya dejaba desplegar cada día y ver quién pagó en efectivo
 * (AV-0084), pero esa pestaña es del CAJÓN: arrastra saldo y mezcla apuntes a
 * mano. La tarjeta y el banco no pasan por el cajón, así que no caben ahí sin
 * ensuciarla. Aquí la pregunta es la misma para las tres formas —¿de quién está
 * hecho lo cobrado?—, con el mismo desplegable y un botón para bajarlo.
 *
 * Lee el mismo `/api/arqueo/resumen`; el filtrado y el CSV, con prueba, en
 * `lib/billing/quienPago.js`.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { hoyVigente, mesVigente } from "@/lib/billing/cuotas.js";
import { FORMAS_PAGO, diasPorForma, totalPorForma, csvQuienPago } from "@/lib/billing/quienPago.js";
import { fmtMoney } from "./Kpi.jsx";
import CobroDrawer from "./CobroDrawer.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fmtDia(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]}` : String(iso ?? "");
}

function fmtHora(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
}

const METODO_CORTO = { transfer: "transferencia", direct_debit: "domiciliación" };

export default function QuienPagoCaja({ cajaId }) {
  const [forma, setForma] = useState("tarjeta");
  const [desde, setDesde] = useState(`${mesVigente()}-01`);
  const [hasta, setHasta] = useState(hoyVigente());
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [verTodos, setVerTodos] = useState(false);
  const [cobroAbierto, setCobroAbierto] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams({ desde, hasta });
      if (cajaId) qs.set("cajaId", cajaId);
      const r = await fetch(`/api/arqueo/resumen?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudieron cargar los cobros");
      setDatos(j.data);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, cajaId]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setAbiertos(new Set()); }, [desde, hasta, cajaId, forma]);

  const dias = useMemo(() => diasPorForma(datos?.dias, forma), [datos, forma]);
  const total = useMemo(() => totalPorForma(dias), [dias]);
  const label = FORMAS_PAGO.find((f) => f.clave === forma)?.label ?? forma;

  const alternar = (fecha) =>
    setAbiertos((previos) => {
      const siguiente = new Set(previos);
      if (siguiente.has(fecha)) siguiente.delete(fecha);
      else siguiente.add(fecha);
      return siguiente;
    });

  const descargar = () => {
    const blob = new Blob([csvQuienPago(dias)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cobros-${forma}-${desde}-a-${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-0.5">
          {FORMAS_PAGO.map((f) => (
            <button
              key={f.clave}
              type="button"
              onClick={() => setForma(f.clave)}
              className={`text-[12.5px] px-3 py-1 rounded-md transition ${
                forma === f.clave ? "bg-neutral-800 text-white font-medium" : "text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-neutral-500">
          Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={`${inputCls} py-1.5`} />
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-neutral-500">
          Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={`${inputCls} py-1.5`} />
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-neutral-600">
          <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} />
          Desplegar todos los días
        </label>
        <button
          type="button"
          onClick={descargar}
          disabled={cargando || dias.length === 0}
          className="ml-auto text-[12px] font-medium px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 transition"
        >
          Descargar Excel
        </button>
      </div>

      {errorMsg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{errorMsg}</div>}

      {datos && (
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">Cobrado · {label}</div>
            <div className="text-2xl font-semibold text-neutral-800 tabular">{fmtMoney(total.importe)}</div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">Cobros</div>
            <div className="text-2xl font-semibold text-neutral-800 tabular">{total.cobros}</div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">Día</th>
                <th className="text-right font-medium px-3 py-2">Cobros</th>
                <th className="text-right font-medium px-3 py-2">Cobrado · {label}</th>
              </tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={3} className="px-3 py-6 text-center text-neutral-400">Cargando…</td></tr>}
              {!cargando && dias.length === 0 && (
                <tr><td colSpan={3} className="px-3 py-8 text-center text-neutral-400">
                  Nadie pagó {forma === "banco" ? "por el banco" : forma === "tarjeta" ? "con tarjeta" : "en efectivo"} en estas fechas.
                </td></tr>
              )}
              {!cargando && dias.map((d) => {
                const abierto = verTodos || abiertos.has(d.fecha);
                return (
                  <Fragment key={d.fecha}>
                    <tr className="border-t border-neutral-100 cursor-pointer hover:bg-neutral-50" onClick={() => alternar(d.fecha)}>
                      <td className="px-3 py-2 text-neutral-700">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`text-neutral-400 transition-transform ${abierto ? "rotate-90" : ""}`}>›</span>
                          {fmtDia(d.fecha)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular text-neutral-600">{d.cobros.length}</td>
                      <td className="px-3 py-2 text-right tabular font-semibold text-neutral-800">{fmtMoney(d.total)}</td>
                    </tr>
                    {abierto && (
                      <tr className="bg-neutral-50/60">
                        <td colSpan={3} className="px-3 pb-3 pt-1">
                          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100 bg-white">
                            {d.cobros.map((c) => (
                              <li key={`${c.id}-${c.devolucion ? "d" : "c"}`} className="flex items-center gap-3 px-3 py-1.5">
                                <span className="text-[11px] text-neutral-400 w-12 shrink-0 tabular">
                                  {fmtHora(c.devolucion ? c.refundedAt ?? c.paidAt : c.paidAt)}
                                </span>
                                <button
                                  type="button"
                                  onClick={(ev) => { ev.stopPropagation(); setCobroAbierto(c); }}
                                  className="min-w-0 flex-1 text-left text-[12px] text-neutral-700 hover:underline"
                                >
                                  {c.patientName || c.clientName || "Sin nombre"}
                                  {c.patientName && c.clientName && <span className="text-neutral-400"> · paga {c.clientName}</span>}
                                  {METODO_CORTO[c.method] && <span className="text-neutral-400"> · {METODO_CORTO[c.method]}</span>}
                                  {c.devolucion && <span className="text-rose-600"> · devuelto</span>}
                                </button>
                                <span className={`text-[12px] tabular shrink-0 ${c.amount < 0 ? "text-rose-600" : "text-neutral-700"}`}>
                                  {fmtMoney(c.amount)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11.5px] text-neutral-400">
        Banco suma transferencias y domiciliaciones. Un cobro pendiente no aparece hasta que entra. Pulsa un día para
        ver quién pagó y un nombre para abrir el cobro. La descarga lleva lo que se ve: la forma de pago y las fechas
        elegidas.
      </p>

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
