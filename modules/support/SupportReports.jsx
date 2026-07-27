"use client";

import { useEffect, useState } from "react";

/**
 * Informes del módulo Soporte: KPIs, serie mensual creados/resueltos, reparto
 * por categoría y carga por responsable. Barras CSS puras — sin librerías de
 * gráficos, igual que el resto del CRM.
 */
export default function SupportReports() {
  const [months, setMonths] = useState(6);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    fetch(`/api/tickets/stats?months=${months}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "No se han podido cargar los informes");
        if (vivo) setDatos(j.data);
      })
      .catch((e) => vivo && setFallo(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [months]);

  if (cargando) {
    return (
      <div className="flex items-center gap-3 text-sm text-gray-500 py-16 justify-center">
        <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
        Calculando…
      </div>
    );
  }
  if (fallo) {
    return <div className="mx-4 lg:mx-8 my-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{fallo}</div>;
  }
  if (!datos) return null;

  const maxSerie = Math.max(1, ...datos.serie.map((s) => Math.max(s.creados, s.resueltos)));
  const maxCat = Math.max(1, ...datos.porCategoria.map((c) => c.n));
  const fmtH = (h) => (h == null ? "—" : h < 24 ? `${h} h` : `${Math.round((h / 24) * 10) / 10} días`);

  return (
    <div className="px-4 lg:px-8 py-4 space-y-4">
      {/* Rango */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-700">Últimos {datos.months} meses</h2>
        <div className="flex items-center bg-white border border-gray-200 rounded-lg p-0.5">
          {[3, 6, 12].map((m) => (
            <button
              key={m}
              onClick={() => setMonths(m)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
                months === m ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi titulo="Activos ahora" valor={datos.porEstado.open + datos.porEstado.in_progress + datos.porEstado.waiting} />
        <Kpi
          titulo="SLA 1ª respuesta"
          valor={datos.sla.firstResponsePct != null ? `${datos.sla.firstResponsePct}%` : "—"}
          nota={datos.sla.muestras.firstResponse ? `${datos.sla.muestras.firstResponse} tickets` : "sin datos aún"}
          alerta={datos.sla.firstResponsePct != null && datos.sla.firstResponsePct < 80}
        />
        <Kpi titulo="1ª respuesta media" valor={fmtH(datos.tiempos.avgFirstResponseHours)} />
        <Kpi titulo="Resolución media" valor={fmtH(datos.tiempos.avgResolutionHours)} />
      </div>

      {/* Serie mensual */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 lg:p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">Tickets por mes</h3>
          <div className="flex items-center gap-3 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[var(--color-primary)]" /> Creados
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" /> Resueltos
            </span>
          </div>
        </div>
        <div className="flex items-end gap-2 lg:gap-3 h-36">
          {datos.serie.map((s) => (
            <div key={s.mes} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div className="w-full flex items-end justify-center gap-1 flex-1">
                <div
                  className="w-full max-w-[22px] rounded-t bg-[var(--color-primary)] transition-all"
                  style={{ height: `${(s.creados / maxSerie) * 100}%`, minHeight: s.creados > 0 ? 4 : 0 }}
                  title={`${s.creados} creados`}
                />
                <div
                  className="w-full max-w-[22px] rounded-t bg-emerald-400 transition-all"
                  style={{ height: `${(s.resueltos / maxSerie) * 100}%`, minHeight: s.resueltos > 0 ? 4 : 0 }}
                  title={`${s.resueltos} resueltos`}
                />
              </div>
              <span className="text-[10px] text-gray-400 truncate">{s.mes.slice(5)}/{s.mes.slice(2, 4)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Por categoría */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 lg:p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Por categoría</h3>
          {datos.porCategoria.length === 0 && <p className="text-sm text-gray-400">Sin datos en el periodo.</p>}
          <div className="space-y-2.5">
            {datos.porCategoria.map((c) => (
              <div key={c.categoryId || "none"}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-600 truncate">{c.nombre}</span>
                  <span className="text-gray-400 tabular-nums">{c.n}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(c.n / maxCat) * 100}%`, backgroundColor: c.color || "var(--color-primary)" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Por responsable */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 lg:p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Carga por responsable</h3>
          {datos.porResponsable.length === 0 && <p className="text-sm text-gray-400">Sin datos en el periodo.</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-gray-400">
                <th className="text-left font-medium pb-2">Quién</th>
                <th className="text-right font-medium pb-2">Abiertos</th>
                <th className="text-right font-medium pb-2">Resueltos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {datos.porResponsable.map((r) => (
                <tr key={r.teamMemberId || "none"}>
                  <td className="py-1.5 text-gray-700 truncate">{r.nombre}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-900 font-medium">{r.abiertos}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-500">{r.resueltos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ titulo, valor, nota, alerta }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3.5">
      <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">{titulo}</div>
      <div className={`text-2xl font-semibold tabular-nums ${alerta ? "text-red-600" : "text-gray-900"}`}>{valor}</div>
      {nota && <div className="text-[11px] text-gray-400 mt-0.5">{nota}</div>}
    </div>
  );
}
