"use client";

import { useCallback, useEffect, useState } from "react";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import MovimientosCaja from "../_components/MovimientosCaja.jsx";
import ResumenCaja from "../_components/ResumenCaja.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const fmt = (n) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n) || 0);

const hoy = () => new Date().toISOString().slice(0, 10);

export default function ArqueoPage() {
  const [cajas, setCajas] = useState([]);
  const [cajaId, setCajaId] = useState("");
  const [cierres, setCierres] = useState([]);
  const [resumen, setResumen] = useState({ total: 0, conDescuadre: 0, totalDescuadre: 0 });
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [soloDescuadres, setSoloDescuadres] = useState(false);
  // Tres cosas distintas sobre el mismo cajon: los cierres de siempre, los
  // apuntes de entrada/salida y el resumen por dia (01/09/2026). Pestanas y no
  // tres pantallas: se miran seguidas, cuadrando el dia.
  const [vista, setVista] = useState("cierres");

  const [showCaja, setShowCaja] = useState(false);
  const [nombreCaja, setNombreCaja] = useState("");

  const [showCierre, setShowCierre] = useState(false);
  const [form, setForm] = useState({ closeDate: hoy(), openingAmount: "", countedAmount: "", notes: "" });
  const [previo, setPrevio] = useState(null); // { esperado, efectivoDelDia, numCobros }
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const cargarCajas = useCallback(async () => {
    try {
      const r = await fetch("/api/arqueo/cajas", { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudieron cargar las cajas");
      const lista = j.data?.cajas ?? [];
      setCajas(lista);
      setCajaId((prev) => prev || lista[0]?.id || "");
    } catch (e) {
      setErrorMsg(e.message);
    }
  }, []);

  const cargarCierres = useCallback(async () => {
    if (!cajaId) {
      setCierres([]);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams({ cajaId });
      if (soloDescuadres) qs.set("soloDescuadres", "1");
      const r = await fetch(`/api/arqueo/cierres?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudieron cargar los cierres");
      setCierres(j.data?.cierres ?? []);
      setResumen({
        total: j.data?.total ?? 0,
        conDescuadre: j.data?.conDescuadre ?? 0,
        totalDescuadre: j.data?.totalDescuadre ?? 0,
      });
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, [cajaId, soloDescuadres]);

  useEffect(() => {
    cargarCajas();
  }, [cargarCajas]);
  useEffect(() => {
    cargarCierres();
  }, [cargarCierres]);

  async function crearCaja(e) {
    e.preventDefault();
    if (!nombreCaja.trim()) return;
    try {
      const r = await fetch("/api/arqueo/cajas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nombreCaja.trim() }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo crear la caja");
      setNombreCaja("");
      setShowCaja(false);
      await cargarCajas();
    } catch (e) {
      setErrorMsg(e.message);
    }
  }

  function abrirCierre() {
    setForm({ closeDate: hoy(), openingAmount: "", countedAmount: "", notes: "" });
    setPrevio(null);
    setFormError(null);
    setShowCierre(true);
  }

  /**
   * Se pide el esperado DESPUÉS de teclear lo contado, no antes: si la cifra
   * objetivo estuviera a la vista mientras se cuenta, el arqueo dejaría de
   * detectar nada. El servidor lo recalcula igualmente al guardar.
   */
  async function comprobar() {
    setFormError(null);
    if (form.countedAmount === "") {
      setFormError("Escribe primero cuánto dinero has contado");
      return;
    }
    try {
      const r = await fetch("/api/arqueo/cierres", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashPointId: cajaId, closeDate: form.closeDate, openingAmount: form.openingAmount || 0 }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo calcular lo esperado");
      setPrevio(j.data);
    } catch (e) {
      setFormError(e.message);
    }
  }

  async function guardar(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const r = await fetch("/api/arqueo/cierres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, cashPointId: cajaId }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo cerrar la caja");
      setShowCierre(false);
      await cargarCierres();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const dif = previo !== null ? Number(form.countedAmount || 0) - Number(previo.esperado || 0) : null;

  return (
    <div className="p-4 lg:p-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-800 flex items-center gap-2">
            Arqueo de caja
            <HelpTooltip title="Arqueo de caja" placement="bottom">
              Cuentas el dinero que hay en el cajón y el CRM lo compara con lo que debería haber
              según los cobros en efectivo del día.
              {" "}
              <strong className="text-white">Un cierre es la FOTO de ese día</strong>: la
              diferencia se guarda tal cual y no se recalcula después, aunque luego corrijas un
              cobro. Por eso un descuadre viejo sigue ahí — es lo que pasó, no lo que debería
              haber pasado.
            </HelpTooltip>
          </h1>
          <p className="text-[12.5px] text-neutral-500 mt-0.5">
            Cuenta el dinero del cajón y compáralo con lo que debería haber. La diferencia queda registrada.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCaja(true)}
            className="text-[12.5px] px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition"
          >
            Nueva caja
          </button>
          <button
            onClick={abrirCierre}
            disabled={!cajaId}
            className="text-[12.5px] px-3 py-1.5 rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white font-medium hover:opacity-90 transition disabled:opacity-40"
          >
            Cerrar caja
          </button>
        </div>
      </div>

      {cajas.length === 0 && !loading && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          Todavía no hay ninguna caja. Crea una (por ejemplo «Recepción») para poder hacer arqueos.
        </div>
      )}

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{errorMsg}</div>
      )}

      {cajas.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {cajas.length > 1 && (
            <select value={cajaId} onChange={(e) => setCajaId(e.target.value)} className={`${inputCls} max-w-xs`}>
              {cajas.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-0.5">
            {[
              ["cierres", "Cierres"],
              ["movimientos", "Entradas y salidas"],
              ["resumen", "Resumen por día"],
            ].map(([k, lbl]) => (
              <button
                key={k}
                onClick={() => setVista(k)}
                className={`text-[12.5px] px-3 py-1 rounded-md transition ${
                  vista === k ? "bg-[var(--color-primary,#1B3A2D)] text-white font-medium" : "text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
          {vista === "cierres" && (
            <label className="flex items-center gap-2 text-[12.5px] text-neutral-600">
              <input type="checkbox" checked={soloDescuadres} onChange={(e) => setSoloDescuadres(e.target.checked)} />
              Solo los días que no cuadraron
            </label>
          )}
        </div>
      )}

      {vista === "movimientos" && <MovimientosCaja cajaId={cajaId} cajas={cajas} />}
      {vista === "resumen" && <ResumenCaja cajaId={cajaId} />}

      {vista === "cierres" && cierres.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">Cierres</div>
            <div className="text-lg font-semibold text-neutral-800">{resumen.total}</div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">Días con descuadre</div>
            <div className="text-lg font-semibold text-neutral-800">{resumen.conDescuadre}</div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">Descuadre acumulado</div>
            <div className={`text-lg font-semibold ${resumen.totalDescuadre < 0 ? "text-red-600" : resumen.totalDescuadre > 0 ? "text-amber-600" : "text-neutral-800"}`}>
              {fmt(resumen.totalDescuadre)}
            </div>
          </div>
        </div>
      )}

      {vista === "cierres" && (
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">Fecha</th>
                <th className="text-right font-medium px-3 py-2">Fondo inicial</th>
                <th className="text-right font-medium px-3 py-2">Esperado</th>
                <th className="text-right font-medium px-3 py-2">Contado</th>
                <th className="text-right font-medium px-3 py-2">Descuadre</th>
                <th className="text-left font-medium px-3 py-2">Cerró</th>
                <th className="text-left font-medium px-3 py-2">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-neutral-400">Cargando…</td></tr>
              )}
              {!loading && cierres.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-neutral-400">
                    {soloDescuadres ? "Ningún cierre con descuadre. Buena señal." : "Todavía no se ha cerrado ninguna caja."}
                  </td>
                </tr>
              )}
              {!loading &&
                cierres.map((c) => {
                  const d = Number(c.difference || 0);
                  return (
                    <tr key={c.id} className="border-t border-neutral-100">
                      <td className="px-3 py-2">{c.closeDate}</td>
                      <td className="px-3 py-2 text-right text-neutral-500">{fmt(c.openingAmount)}</td>
                      <td className="px-3 py-2 text-right text-neutral-500">{fmt(c.expectedAmount)}</td>
                      <td className="px-3 py-2 text-right">{fmt(c.countedAmount)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${d < 0 ? "text-red-600" : d > 0 ? "text-amber-600" : "text-neutral-400"}`}>
                        {d === 0 ? "cuadra" : fmt(d)}
                      </td>
                      <td className="px-3 py-2 text-neutral-500">{c.closedBy?.displayName || "—"}</td>
                      <td className="px-3 py-2 text-neutral-500">{c.notes || "—"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {showCaja && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowCaja(false)} />
          <div className="fixed right-0 top-14 lg:top-0 bottom-0 w-full max-w-sm bg-white z-50 shadow-xl overflow-y-auto">
            <form onSubmit={crearCaja} className="p-5 space-y-4">
              <h2 className="text-base font-semibold text-neutral-800">Nueva caja</h2>
              <p className="text-[12px] text-neutral-500">
                Un punto donde se cobra en efectivo: recepción, mostrador… Cada caja se cuadra por separado.
              </p>
              <input value={nombreCaja} onChange={(e) => setNombreCaja(e.target.value)} placeholder="Recepción" className={inputCls} autoFocus />
              <button type="submit" className="w-full rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white text-sm font-medium py-2 hover:opacity-90 transition">
                Crear caja
              </button>
            </form>
          </div>
        </>
      )}

      {showCierre && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowCierre(false)} />
          <div className="fixed right-0 top-14 lg:top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-xl overflow-y-auto">
            <form onSubmit={guardar} className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-neutral-800">Cerrar caja</h2>
                <button type="button" onClick={() => setShowCierre(false)} className="text-neutral-400 hover:text-neutral-700">Cerrar</button>
              </div>

              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{formError}</div>
              )}

              <label className="block">
                <span className="text-[12px] text-neutral-500">Día que se cierra</span>
                <input type="date" value={form.closeDate} onChange={(e) => { setForm({ ...form, closeDate: e.target.value }); setPrevio(null); }} className={inputCls} />
              </label>
              <label className="block">
                <span className="text-[12px] text-neutral-500">Fondo inicial (lo que había al abrir)</span>
                <input type="number" step="0.01" value={form.openingAmount} onChange={(e) => { setForm({ ...form, openingAmount: e.target.value }); setPrevio(null); }} className={inputCls} placeholder="0,00" />
              </label>
              <label className="block">
                <span className="text-[12px] text-neutral-500">Dinero contado en el cajón *</span>
                <input type="number" step="0.01" value={form.countedAmount} onChange={(e) => setForm({ ...form, countedAmount: e.target.value })} className={inputCls} placeholder="0,00" />
              </label>

              {previo === null ? (
                <button type="button" onClick={comprobar} className="w-full rounded-lg border border-neutral-200 text-neutral-700 text-sm font-medium py-2 hover:bg-neutral-50 transition">
                  Comprobar
                </button>
              ) : (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 space-y-1 text-[12.5px]">
                  <div className="flex justify-between text-neutral-600">
                    <span>Cobros en efectivo del día ({previo.numCobros})</span>
                    <span>{fmt(previo.efectivoDelDia)}</span>
                  </div>
                  {/* Las entradas y salidas apuntadas ese día también mueven el
                      cajón (01/09/2026): sin enseñarlas, el esperado sale de
                      una cuenta que la persona no puede seguir. */}
                  {previo.numMovimientos > 0 && (
                    <div className="flex justify-between text-neutral-600">
                      <span>Entradas y salidas de caja ({previo.numMovimientos})</span>
                      <span>{fmt(Number(previo.entradas || 0) - Number(previo.salidas || 0))}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-neutral-600">
                    <span>Debería haber</span>
                    <span>{fmt(previo.esperado)}</span>
                  </div>
                  <div className={`flex justify-between font-semibold pt-1 border-t border-neutral-200 ${dif < 0 ? "text-red-600" : dif > 0 ? "text-amber-600" : "text-emerald-700"}`}>
                    <span>{dif === 0 ? "Cuadra" : dif < 0 ? "Faltan" : "Sobran"}</span>
                    <span>{dif === 0 ? "✓" : fmt(Math.abs(dif))}</span>
                  </div>
                </div>
              )}

              <label className="block">
                <span className="text-[12px] text-neutral-500">
                  Motivo {previo !== null && dif !== 0 ? "*" : "(opcional)"}
                </span>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  className={inputCls}
                  placeholder={previo !== null && dif !== 0 ? "Un «faltan 20 €» sin explicación no vale de nada dentro de seis meses" : ""}
                />
              </label>

              <button
                type="submit"
                disabled={saving || previo === null}
                className="w-full rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white text-sm font-medium py-2 hover:opacity-90 transition disabled:opacity-40"
              >
                {saving ? "Guardando…" : "Cerrar el día"}
              </button>
              {previo === null && (
                <p className="text-[11.5px] text-neutral-400 text-center">Comprueba antes de cerrar.</p>
              )}
            </form>
          </div>
        </>
      )}
    </div>
  );
}
