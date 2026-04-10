"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const currentYear = new Date().getFullYear();

function fmt(n) {
  return Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(n) {
  return `${Number(n || 0).toFixed(1)}%`;
}

function MarginCell({ value, pctValue }) {
  const isPositive = value >= 0;
  return (
    <td className="px-4 py-3 text-right">
      <div className={`font-semibold text-sm ${isPositive ? "text-emerald-600" : "text-red-500"}`}>
        {fmt(value)} €
      </div>
      <div className={`text-[11px] ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
        {pct(pctValue)}
      </div>
    </td>
  );
}

export default function AnaliticaPage() {
  const [from, setFrom] = useState(`${currentYear}-01-01`);
  const [to, setTo] = useState(`${currentYear}-12-31`);
  const [therapists, setTherapists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/analytics/therapists?from=${from}&to=${to}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setTherapists(json.data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [from, to]);

  // Totales
  const totals = therapists.reduce(
    (acc, t) => ({
      income: acc.income + t.income,
      invoiceCount: acc.invoiceCount + t.invoiceCount,
      clientCount: acc.clientCount + t.clientCount,
      salaryCost: acc.salaryCost + t.salaryCost,
      margin: acc.margin + t.margin,
      cancelledCount: acc.cancelledCount + t.cancelledCount,
    }),
    { income: 0, invoiceCount: 0, clientCount: 0, salaryCost: 0, margin: 0, cancelledCount: 0 }
  );

  const totalMarginPct = totals.income > 0 ? (totals.margin / totals.income) * 100 : 0;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Analítica por terapeuta</h1>
          <p className="text-sm text-neutral-400 mt-0.5">Rendimiento económico individual</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/facturacion" className="text-sm text-neutral-500 hover:text-neutral-700 transition-colors">
            ← Volver
          </Link>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border border-neutral-200 rounded-lg px-3 py-1.5 text-sm text-neutral-700 focus:outline-none focus:border-neutral-400"
            />
            <span className="text-neutral-400 text-sm">—</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border border-neutral-200 rounded-lg px-3 py-1.5 text-sm text-neutral-700 focus:outline-none focus:border-neutral-400"
            />
          </div>
        </div>
      </div>

      {/* Resumen global */}
      {therapists.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-4">
          {[
            { label: "Ingresos totales", value: fmt(totals.income) + " €" },
            { label: "Facturas emitidas", value: totals.invoiceCount },
            { label: "Clientes atendidos", value: totals.clientCount },
            { label: "Margen global", value: `${fmt(totals.margin)} € (${pct(totalMarginPct)})` },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white border border-neutral-100 rounded-xl p-4">
              <div className="text-xs text-neutral-400 mb-1">{label}</div>
              <div className="text-sm font-semibold text-neutral-800">{value}</div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">{error}</div>
      )}

      {/* Tabla de terapeutas */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100">
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Terapeuta</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Cargo</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Ingresos</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Facturas</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Clientes</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Ticket medio</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Coste salarial</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Margen</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Cancelaciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && therapists.length === 0 && (
              <tr><td colSpan={9} className="text-center py-12 text-sm text-neutral-400">Cargando...</td></tr>
            )}
            {!loading && therapists.length === 0 && (
              <tr><td colSpan={9} className="text-center py-12 text-sm text-neutral-400">Sin datos para el período seleccionado</td></tr>
            )}
            {therapists.map((t) => (
              <tr key={t.therapistId} className="border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-neutral-800 text-sm">{t.therapistName}</div>
                </td>
                <td className="px-4 py-3 text-xs text-neutral-500 capitalize">{t.position ?? "—"}</td>
                <td className="px-4 py-3 text-right font-semibold text-neutral-800">{fmt(t.income)} €</td>
                <td className="px-4 py-3 text-right text-neutral-600">{t.invoiceCount}</td>
                <td className="px-4 py-3 text-right text-neutral-600">{t.clientCount}</td>
                <td className="px-4 py-3 text-right text-neutral-600">{fmt(t.averageTicket)} €</td>
                <td className="px-4 py-3 text-right text-neutral-500">{fmt(t.salaryCost)} €</td>
                <MarginCell value={t.margin} pctValue={t.marginPct} />
                <td className="px-4 py-3 text-right">
                  {t.cancelledCount > 0 ? (
                    <span className="text-amber-600 text-xs font-medium">
                      {t.cancelledCount} ({pct(t.cancellationRate)})
                    </span>
                  ) : (
                    <span className="text-neutral-400 text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>

          {/* Totales */}
          {therapists.length > 1 && (
            <tfoot>
              <tr className="border-t border-neutral-200 bg-neutral-50">
                <td colSpan={2} className="px-4 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wide">
                  Total ({therapists.length} terapeutas)
                </td>
                <td className="px-4 py-3 text-right font-bold text-neutral-800">{fmt(totals.income)} €</td>
                <td className="px-4 py-3 text-right font-semibold text-neutral-700">{totals.invoiceCount}</td>
                <td className="px-4 py-3 text-right font-semibold text-neutral-700">{totals.clientCount}</td>
                <td className="px-4 py-3 text-right text-neutral-500">—</td>
                <td className="px-4 py-3 text-right font-semibold text-neutral-700">{fmt(totals.salaryCost)} €</td>
                <MarginCell value={totals.margin} pctValue={totalMarginPct} />
                <td className="px-4 py-3 text-right font-semibold text-neutral-700">{totals.cancelledCount}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
