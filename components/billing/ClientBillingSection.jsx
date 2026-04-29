"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

function fmtMoney(n) {
  return `${Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}
function fmtDate(d) {
  return d ? String(d).slice(0, 10) : "—";
}

const STATUS_LABELS = {
  draft: "Borrador", issued: "Emitida", sent: "Enviada", paid: "Cobrada",
  partially_paid: "Parcial", overdue: "Vencida", cancelled: "Cancelada", rectified: "Rectificada",
};

/**
 * Resumen de facturación de un cliente.
 * Carga sus facturas, totales y muestra una tabla compacta.
 * Si el módulo billing no está activo, no renderiza nada (silencioso).
 */
export default function ClientBillingSection({ clientId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    fetch(`/api/clients/${clientId}/billing-summary`, { cache: "no-store" })
      .then((r) => {
        if (r.status === 403) { setHidden(true); return null; }
        return r.json();
      })
      .then((j) => { if (j?.ok) setData(j.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [clientId]);

  if (hidden) return null;

  return (
    <section className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 mt-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Facturación</h2>
        <Link href="/facturacion/facturas" className="text-xs text-neutral-400 hover:text-neutral-700 transition-colors">Ir a Facturas →</Link>
      </div>

      {loading && !data && <div className="text-xs text-neutral-400">Cargando...</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Stat label="Facturado" value={fmtMoney(data.billedBase)} sub="Base imponible" />
            <Stat label="Cobrado" value={fmtMoney(data.collectedBase)} sub="Base imponible" tone="emerald" />
            <Stat label="Pendiente" value={fmtMoney(data.pendingCollection)} tone={data.pendingCollection > 0 ? "amber" : "neutral"} />
            <Stat label="Margen" value={fmtMoney(data.margin)} sub={`${(data.marginPct || 0).toFixed(1)}%`} tone={data.margin >= 0 ? "emerald" : "red"} />
          </div>

          {data.invoices && data.invoices.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-neutral-100">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Nº</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Fecha</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Estado</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Total</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Cobrado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.slice(0, 10).map((inv) => (
                    <tr key={inv.id} className="border-b border-neutral-50">
                      <td className="px-3 py-2 font-mono text-xs text-neutral-500">{inv.number}</td>
                      <td className="px-3 py-2 text-xs text-neutral-500">{fmtDate(inv.issueDate)}</td>
                      <td className="px-3 py-2 text-xs text-neutral-700">{STATUS_LABELS[inv.status] ?? inv.status}</td>
                      <td className="px-3 py-2 text-right tabular text-neutral-900">{fmtMoney(inv.total)}</td>
                      <td className="px-3 py-2 text-right tabular text-emerald-700">{fmtMoney(inv.paidAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-neutral-400 py-4">Este cliente no tiene facturas aún.</div>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, sub, tone = "neutral" }) {
  const toneCls = {
    neutral: "text-neutral-900",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    red: "text-red-600",
  }[tone];
  return (
    <div className="border border-neutral-100 rounded-lg p-3">
      <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">{label}</div>
      <div className={`font-display text-lg ${toneCls} tabular mt-1`}>{value}</div>
      {sub && <div className="text-[10px] text-neutral-400 mt-0.5">{sub}</div>}
    </div>
  );
}
