"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

/**
 * Histórico de COBROS de un cliente (15/09/2026, Rodrigo): la pestaña gemela
 * de Facturación. Facturación dice lo que se le emitió; esta, lo que pagó,
 * cuándo y cómo — en Aumenta la mayoría de cobros no tiene factura detrás.
 * Si el módulo billing no está activo (403), no pinta nada y la pestaña se
 * esconde sola.
 */

const METODO = { card: "Tarjeta", transfer: "Transferencia", cash: "Efectivo", direct_debit: "Domiciliación" };
const ESTADO = { completed: "Cobrado", pending: "Pendiente", failed: "Fallido", refunded: "Devuelto" };
const ESTADO_CLS = {
  completed: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  failed: "bg-rose-50 text-rose-700",
  refunded: "bg-violet-50 text-violet-700",
};

function fmtMoney(n) {
  return `${Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}
const anioDe = (p) => (p.paidAt ? String(new Date(p.paidAt).getFullYear()) : "");

export default function ClientPaymentsSection({ clientId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [anio, setAnio] = useState("");

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    fetch(`/api/clients/${clientId}/payments`, { cache: "no-store" })
      .then((r) => {
        if (r.status === 403) { setHidden(true); return null; }
        return r.json();
      })
      .then((j) => { if (j?.ok) setData(j.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [clientId]);

  const cobros = useMemo(() => data?.payments ?? [], [data]);
  const anios = useMemo(() => [...new Set(cobros.map(anioDe).filter(Boolean))].sort().reverse(), [cobros]);
  const visibles = useMemo(() => (anio ? cobros.filter((p) => anioDe(p) === anio) : cobros), [cobros, anio]);
  // Las sumas son de lo que se está mirando (el año elegido o todo).
  const suma = (estado) => visibles.filter((p) => p.status === estado).reduce((t, p) => t + Number(p.amount || 0), 0);
  const conPaciente = cobros.some((p) => p.patientName);

  if (hidden) return null;

  return (
    <section className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 mt-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Cobros</h2>
        {anios.length > 1 && (
          <select
            value={anio}
            onChange={(e) => setAnio(e.target.value)}
            className="ml-auto mr-3 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600"
            aria-label="Año"
          >
            <option value="">Todos los años</option>
            {anios.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        )}
        <Link href="/facturacion/cobros" className="text-xs text-neutral-400 hover:text-neutral-700 transition-colors">Ir a Cobros →</Link>
      </div>

      {loading && !data && <div className="text-xs text-neutral-400">Cargando...</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            <Stat label="Cobrado" value={fmtMoney(suma("completed"))} tone="emerald" />
            <Stat label="Pendiente" value={fmtMoney(suma("pending"))} tone={suma("pending") > 0 ? "amber" : "neutral"} />
            <Stat label="Devuelto" value={fmtMoney(suma("refunded"))} />
          </div>

          {cobros.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[620px]">
                <thead>
                  <tr className="border-b border-neutral-100">
                    <Th>Fecha</Th>
                    <Th>Mes</Th>
                    {conPaciente && <Th>Paciente</Th>}
                    <Th>Forma de pago</Th>
                    <Th>Estado</Th>
                    <Th>Factura</Th>
                    <Th right>Importe</Th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((p) => (
                    <tr key={p.id} className="border-b border-neutral-50" title={p.notes || undefined}>
                      <td className="px-3 py-2 text-xs text-neutral-500 tabular">{fmtDate(p.paidAt)}</td>
                      <td className="px-3 py-2 text-xs text-neutral-500 tabular">{p.periodMonth ? String(p.periodMonth).slice(0, 7) : "—"}</td>
                      {conPaciente && <td className="px-3 py-2 text-xs text-neutral-700">{p.patientName || "—"}</td>}
                      <td className="px-3 py-2 text-xs text-neutral-700">{METODO[p.method] || "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${ESTADO_CLS[p.status] || "bg-neutral-100 text-neutral-500"}`}>
                          {ESTADO[p.status] || p.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-neutral-500">{p.invoiceNumber || "—"}</td>
                      <td className="px-3 py-2 text-right tabular text-neutral-900">{fmtMoney(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 text-[11.5px] text-neutral-400">
                {visibles.length === cobros.length
                  ? `${cobros.length} ${cobros.length === 1 ? "cobro" : "cobros"}`
                  : `${visibles.length} de ${cobros.length} cobros`}
                {data.truncados && " · hay más antiguos: míralos en Cobros"}
              </div>
            </div>
          ) : (
            <div className="text-xs text-neutral-400 py-4">Este cliente no tiene cobros registrados.</div>
          )}
        </>
      )}
    </section>
  );
}

function Th({ children, right = false }) {
  return (
    <th className={`${right ? "text-right" : "text-left"} px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest`}>
      {children}
    </th>
  );
}

function Stat({ label, value, tone = "neutral" }) {
  const toneCls = { neutral: "text-neutral-900", emerald: "text-emerald-700", amber: "text-amber-700" }[tone];
  return (
    <div className="border border-neutral-100 rounded-lg p-3">
      <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">{label}</div>
      <div className={`font-display text-lg ${toneCls} tabular mt-1`}>{value}</div>
    </div>
  );
}
