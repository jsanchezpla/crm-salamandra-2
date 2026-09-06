"use client";

/**
 * BajasModule — la lista de supresión: de aquí no sale nadie nunca más.
 * Bajas de un clic, rebotes duros, quejas y las añadidas a mano. No hay botón
 * de quitar a propósito (plan, entregable 6: «obligatorio por ley y por AWS»).
 */

import { useCallback, useEffect, useState } from "react";
import Cabecera from "./Cabecera.jsx";
import { api, botonPrimario, estiloPrimario, fecha, inputCls, num } from "./api.js";

const MOTIVO = {
  baja: { label: "Se dio de baja", cls: "bg-neutral-200 text-neutral-700" },
  rebote: { label: "Rebote duro", cls: "bg-amber-100 text-amber-700" },
  queja: { label: "Queja (spam)", cls: "bg-red-100 text-red-700" },
  manual: { label: "Añadida a mano", cls: "bg-sky-100 text-sky-700" },
};

export default function BajasModule() {
  const [estado, setEstado] = useState(null);
  const [filas, setFilas] = useState(null);
  const [porMotivo, setPorMotivo] = useState({});
  const [q, setQ] = useState("");
  const [nuevo, setNuevo] = useState({ email: "", detalle: "" });
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await api(`/supresiones?q=${encodeURIComponent(q)}`);
      setFilas(r.supresiones);
      setPorMotivo(r.porMotivo);
    } catch (err) {
      setError(err.message);
    }
  }, [q]);
  useEffect(() => {
    api("/estado").then(setEstado).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [cargar]);

  const anadir = async () => {
    setOcupado(true);
    setError(null);
    try {
      await api("/supresiones", { metodo: "POST", body: nuevo });
      setNuevo({ email: "", detalle: "" });
      cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Cabecera titulo="Bajas" subtitulo="La lista de supresión. Se consulta en todo envío, venga de donde venga la dirección." estado={estado} />
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error} <button className="underline ml-2" onClick={() => setError(null)}>Cerrar</button></div>}

      <div className="grid gap-3 sm:grid-cols-4 mb-6">
        {Object.entries(MOTIVO).map(([k, m]) => (
          <div key={k} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{m.label}</div>
            <div className="text-2xl font-semibold text-gray-900">{num(porMotivo[k] ?? 0)}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px] items-start">
        <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">Direcciones</h2>
            <input className={`${inputCls} py-1 max-w-[240px]`} placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {filas === null ? (
            <div className="p-6 text-sm text-gray-500">Cargando…</div>
          ) : filas.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-500">Nadie se ha dado de baja todavía.</div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {filas.map((f) => {
                  const m = MOTIVO[f.motivo] ?? { label: f.motivo, cls: "bg-neutral-100 text-neutral-600" };
                  return (
                    <tr key={f.id} className="border-b border-gray-100 align-top">
                      <td className="px-4 py-2 text-gray-900">{f.email}</td>
                      <td className="px-4 py-2 whitespace-nowrap"><span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.cls}`}>{m.label}</span></td>
                      <td className="px-4 py-2 text-xs text-gray-500 max-w-[320px] truncate" title={f.detalle ?? ""}>{f.detalle ?? ""}</td>
                      <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap text-right">{fecha(f.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <aside className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-800">Añadir una dirección a mano</h2>
          <p className="text-xs text-gray-500">Para quien lo pide por teléfono o en persona. Deja de recibir campañas aunque su ficha tenga la casilla marcada (se desmarca sola).</p>
          <input className={inputCls} value={nuevo.email} onChange={(e) => setNuevo((n) => ({ ...n, email: e.target.value }))} placeholder="persona@ejemplo.com" />
          <input className={inputCls} value={nuevo.detalle} maxLength={300} onChange={(e) => setNuevo((n) => ({ ...n, detalle: e.target.value }))} placeholder="Lo pidió por teléfono el 6/9" />
          <button type="button" className={`${botonPrimario} w-full justify-center`} style={estiloPrimario} disabled={ocupado || !nuevo.email.trim()} onClick={anadir}>
            Dar de baja
          </button>
          <p className="text-[11px] text-gray-400">No hay forma de quitar a alguien de esta lista desde el CRM: si quiere volver, que se apunte de nuevo y lo revisa Salamandra.</p>
        </aside>
      </div>
    </div>
  );
}
