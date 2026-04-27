"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

function fmt(n, decimals = 2) {
  if (n === null || n === undefined) return "—";
  return parseFloat(n).toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function Bar({ value, max, color = "bg-[var(--color-primary)]" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function InventarioStatsPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/inventory/stats")
      .then((r) => r.json())
      .then((data) => { if (data.ok) setStats(data.data); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-gray-500">No se pudieron cargar las estadísticas</p>
        <Link href="/inventario" className="text-[var(--color-primary)] hover:underline text-sm">← Volver</Link>
      </div>
    );
  }

  const maxClientRevenue = Math.max(...(stats.topClients.map((c) => c.revenue)), 1);
  const maxProductRevenue = Math.max(...(stats.topProducts.map((p) => p.revenue)), 1);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="px-4 lg:px-8 pt-6 pb-4 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-3">
          <Link href="/inventario" className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <h1 className="text-gray-900 text-lg font-semibold">Estadísticas de inventario</h1>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-4 lg:px-8 py-6">
        {/* KPI grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 max-w-5xl">
          {[
            { label: "Total productos", value: stats.totalProducts.toString(), color: "text-gray-900" },
            { label: "Stock disponible", value: `${fmt(stats.totalKgStock, 1)} kg`, color: "text-emerald-600" },
            { label: "Total vendido", value: `${fmt(stats.totalKgSold, 1)} kg`, color: "text-blue-600" },
            { label: "Ingresos", value: `${fmt(stats.totalRevenue)} €`, color: "text-gray-900" },
            { label: "Coste total", value: `${fmt(stats.totalCost)} €`, color: "text-gray-700" },
            { label: "Margen bruto", value: `${fmt(stats.totalMargin)} €`, color: stats.totalMargin >= 0 ? "text-emerald-600" : "text-red-600" },
            { label: "Margen %", value: `${fmt(stats.marginPercent, 1)}%`, color: stats.marginPercent >= 0 ? "text-emerald-600" : "text-red-600" },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1">{kpi.label}</div>
              <div className={`text-xl font-semibold ${kpi.color}`}>{kpi.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl">

          {/* Top clientes */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-700">Top 5 clientes por ingresos</span>
            </div>
            {stats.topClients.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">Sin datos de ventas</div>
            ) : (
              <div className="p-4 space-y-4">
                {stats.topClients.map((c, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-gray-800 truncate max-w-[60%]">{c.clientName}</span>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-gray-900">{fmt(c.revenue)} €</span>
                        <span className="text-xs text-gray-400 ml-2">{fmt(c.kgPurchased, 1)} kg</span>
                      </div>
                    </div>
                    <Bar value={c.revenue} max={maxClientRevenue} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top productos */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-700">Top 5 productos por ingresos</span>
            </div>
            {stats.topProducts.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">Sin datos de ventas</div>
            ) : (
              <div className="p-4 space-y-4">
                {stats.topProducts.map((p, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-gray-800 truncate max-w-[60%]">{p.productName}</span>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-gray-900">{fmt(p.revenue)} €</span>
                        <span className="text-xs text-gray-400 ml-2">{fmt(p.kgSold, 1)} kg</span>
                      </div>
                    </div>
                    <Bar value={p.revenue} max={maxProductRevenue} color="bg-blue-400" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tabla detalle clientes */}
          {stats.topClients.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <span className="text-sm font-semibold text-gray-700">Detalle por cliente</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Cliente</th>
                    <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Kg comprados</th>
                    <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Ingresos</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topClients.map((c, i) => (
                    <tr key={i} className={`border-b border-gray-50 ${i % 2 ? "bg-gray-50/50" : ""}`}>
                      <td className="px-4 py-2.5 text-gray-700 font-medium">{c.clientName}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{fmt(c.kgPurchased, 1)} kg</td>
                      <td className="px-4 py-2.5 text-right text-gray-900 font-medium">{fmt(c.revenue)} €</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tabla detalle productos */}
          {stats.topProducts.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <span className="text-sm font-semibold text-gray-700">Detalle por producto</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Producto</th>
                    <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Kg vendidos</th>
                    <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Ingresos</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topProducts.map((p, i) => (
                    <tr key={i} className={`border-b border-gray-50 ${i % 2 ? "bg-gray-50/50" : ""}`}>
                      <td className="px-4 py-2.5 text-gray-700 font-medium">{p.productName}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{fmt(p.kgSold, 1)} kg</td>
                      <td className="px-4 py-2.5 text-right text-gray-900 font-medium">{fmt(p.revenue)} €</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
