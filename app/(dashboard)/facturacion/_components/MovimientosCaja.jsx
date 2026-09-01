"use client";

/**
 * MovimientosCaja — las entradas y salidas del cajón que NO son cobros
 * (01/09/2026, petición de Aumenta: «fecha, importe, concepto, observaciones»).
 *
 * Cuenta para el arqueo: lo esperado en el cajón pasa a ser fondo + cobros en
 * efectivo + entradas − salidas. Por eso un apunte de un día YA CERRADO no se
 * puede tocar (el servidor lo frena): el cierre guardó la foto de ese día.
 */

import { useCallback, useEffect, useState } from "react";
import { fmtMoney, fmtDate } from "./Kpi.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const hoy = () => new Date().toISOString().slice(0, 10);
const primeroDeMes = () => `${new Date().toISOString().slice(0, 7)}-01`;

export default function MovimientosCaja({ cajaId, cajas = [] }) {
  const [movimientos, setMovimientos] = useState([]);
  const [saldo, setSaldo] = useState({ entradas: 0, salidas: 0, neto: 0 });
  const [desde, setDesde] = useState(primeroDeMes());
  const [hasta, setHasta] = useState(hoy());
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ direction: "out", date: hoy(), amount: "", concept: "", notes: "" });
  const [guardando, setGuardando] = useState(false);
  const [formError, setFormError] = useState(null);

  const cargar = useCallback(async () => {
    if (!cajaId) { setMovimientos([]); return; }
    setCargando(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams({ cajaId, desde, hasta });
      const r = await fetch(`/api/arqueo/movimientos?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudieron cargar los movimientos");
      setMovimientos(j.data?.movimientos ?? []);
      setSaldo(j.data?.saldo ?? { entradas: 0, salidas: 0, neto: 0 });
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, [cajaId, desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setFormError(null);
    try {
      const r = await fetch("/api/arqueo/movimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, cashPointId: cajaId, amount: Number(form.amount) }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar el apunte");
      setShowForm(false);
      setForm({ direction: "out", date: hoy(), amount: "", concept: "", notes: "" });
      await cargar();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(m) {
    if (!window.confirm(`¿Borrar «${m.concept}» de ${fmtMoney(m.amount)}?`)) return;
    setErrorMsg(null);
    const r = await fetch(`/api/arqueo/movimientos/${m.id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) { setErrorMsg(j.error || "No se pudo borrar"); return; }
    await cargar();
  }

  const nombreCaja = cajas.find((c) => c.id === cajaId)?.name;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-neutral-500">
            Desde
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={`${inputCls} py-1.5`} />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-neutral-500">
            Hasta
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={`${inputCls} py-1.5`} />
          </label>
        </div>
        <button
          onClick={() => { setShowForm(true); setFormError(null); }}
          disabled={!cajaId}
          className="text-[12.5px] px-3 py-1.5 rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white font-medium hover:opacity-90 transition disabled:opacity-40"
        >+ Entrada o salida</button>
      </div>

      {errorMsg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{errorMsg}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tarjeta titulo="Entradas" valor={fmtMoney(saldo.entradas)} tono="text-emerald-700" />
        <Tarjeta titulo="Salidas" valor={fmtMoney(saldo.salidas)} tono="text-rose-600" />
        <Tarjeta titulo="Efecto en la caja" valor={fmtMoney(saldo.neto)} tono={saldo.neto < 0 ? "text-rose-600" : "text-neutral-800"} />
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">Fecha</th>
                <th className="text-left font-medium px-3 py-2">Concepto</th>
                <th className="text-right font-medium px-3 py-2">Importe</th>
                <th className="text-left font-medium px-3 py-2">Observaciones</th>
                <th className="text-left font-medium px-3 py-2">Apuntó</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={6} className="px-3 py-6 text-center text-neutral-400">Cargando…</td></tr>}
              {!cargando && movimientos.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-neutral-400">
                  Sin entradas ni salidas en estas fechas.
                </td></tr>
              )}
              {!cargando && movimientos.map((m) => {
                const sale = m.direction === "out";
                return (
                  <tr key={m.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2 text-neutral-500">{fmtDate(m.date)}</td>
                    <td className="px-3 py-2 text-neutral-800">{m.concept}</td>
                    <td className={`px-3 py-2 text-right font-medium tabular ${sale ? "text-rose-600" : "text-emerald-700"}`}>
                      {sale ? "−" : "+"}{fmtMoney(m.amount)}
                    </td>
                    <td className="px-3 py-2 text-neutral-500">{m.notes || "—"}</td>
                    <td className="px-3 py-2 text-neutral-500">{m.createdBy?.displayName || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => borrar(m)} className="text-[11px] text-rose-500 hover:text-rose-700">Borrar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowForm(false)} />
          <div className="fixed right-0 top-14 lg:top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-xl overflow-y-auto">
            <form onSubmit={guardar} className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-neutral-800">Entrada o salida de caja</h2>
                <button type="button" onClick={() => setShowForm(false)} className="text-neutral-400 hover:text-neutral-700">Cerrar</button>
              </div>
              {nombreCaja && <p className="text-[12px] text-neutral-500">Caja: {nombreCaja}</p>}

              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{formError}</div>
              )}

              <div className="flex gap-2">
                {[["out", "Sale dinero"], ["in", "Entra dinero"]].map(([k, lbl]) => (
                  <button key={k} type="button" onClick={() => setForm((f) => ({ ...f, direction: k }))}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm border transition ${form.direction === k ? "border-transparent text-white" : "bg-white border-neutral-200 text-neutral-500"}`}
                    style={form.direction === k ? { background: "var(--color-primary, #1B3A2D)" } : undefined}>
                    {lbl}
                  </button>
                ))}
              </div>

              <label className="block">
                <span className="text-[12px] text-neutral-500">Fecha *</span>
                <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} />
              </label>
              <label className="block">
                <span className="text-[12px] text-neutral-500">Importe *</span>
                <input type="number" step="0.01" required value={form.amount} placeholder="0,00"
                  onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} />
                <span className="text-[11px] text-neutral-400">Siempre en positivo: arriba dices si entra o sale.</span>
              </label>
              <label className="block">
                <span className="text-[12px] text-neutral-500">Concepto *</span>
                <input required value={form.concept} placeholder="Mensajería, cambio, compra de material…"
                  onChange={(e) => setForm({ ...form, concept: e.target.value })} className={inputCls} />
              </label>
              <label className="block">
                <span className="text-[12px] text-neutral-500">Observaciones</span>
                <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} />
              </label>

              <button type="submit" disabled={guardando}
                className="w-full rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white text-sm font-medium py-2 hover:opacity-90 transition disabled:opacity-40">
                {guardando ? "Guardando…" : "Apuntar"}
              </button>
              <p className="text-[11px] text-neutral-400 text-center">
                Entra en el arqueo de ese día: lo esperado en el cajón lo tiene en cuenta.
              </p>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, tono = "text-neutral-800" }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-neutral-400">{titulo}</div>
      <div className={`text-lg font-semibold ${tono}`}>{valor}</div>
    </div>
  );
}
