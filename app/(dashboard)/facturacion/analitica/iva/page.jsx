"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import PeriodPicker, { computeRange } from "../../_components/PeriodPicker.jsx";
import Kpi, { fmtMoney, fmtDate } from "../../_components/Kpi.jsx";
import HelpTooltip from "../../../../../components/ui/HelpTooltip.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

export default function IvaPage() {
  const sp = useSearchParams();
  const period = sp.get("period") || "quarter";
  let from = sp.get("from"), to = sp.get("to");
  if (!from || !to) { const r = computeRange(period); from = r.from; to = r.to; }

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!from || !to) return;
    setLoading(true); setErrorMsg(null);
    fetch(`/api/billing/analytics/iva?from=${from}&to=${to}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!j.ok) throw new Error(j.error); setData(j.data); })
      .catch((e) => setErrorMsg(e.message))
      .finally(() => setLoading(false));
  }, [from, to]);

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Finanzas · Fiscalidad</div>
          <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] mt-1 flex items-center gap-2 flex-wrap">
            <span>Impuestos</span>
            <HelpTooltip title="Impuestos" placement="bottom">
              Lo que llevas de IVA e IRPF en el periodo que elijas aquí debajo.
              {" "}
              <strong className="text-white">Cuenta por la fecha de la factura, no por cuándo te pagan</strong>:
              una factura de marzo que aún no has cobrado ya suma IVA aquí. Los borradores no cuentan.
              {" "}
              Y al entrar se abre el <strong className="text-white">trimestre en curso</strong>, que
              todavía no ha terminado — no el último cerrado.
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">{from} → {to}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/facturacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Volver</Link>
          <a href={`/api/billing/analytics/iva/export?from=${from}&to=${to}`}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
            style={{ background: "var(--color-primary, #1B3A2D)" }}>
            Exportar Excel
          </a>
        </div>
      </div>

      <PeriodPicker />

      {errorMsg && <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>}
      {loading && !data && <div className="text-xs text-neutral-400">Cargando...</div>}

      {data && (
        <>
          {/* IVA — Modelo 303 */}
          <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-400 font-semibold">IVA · Modelo 303</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Kpi label="IVA Repercutido" value={fmtMoney(data.model303.outputVat)} sub="Ventas" variant="dark" />
            <Kpi label="IVA Soportado" value={fmtMoney(data.model303.deductibleInputVat)} sub="Compras deducibles" variant="white" />
            <Kpi label={data.model303.difference >= 0 ? "A pagar" : "A devolver"} value={fmtMoney(Math.abs(data.model303.difference))} sub="Diferencia (estimación)" variant={data.model303.difference >= 0 ? "amber" : "emerald"} />
          </div>

          {/* IRPF y lo pagado a Hacienda. Antes había que salir del CRM para
              cuadrar estas dos cifras. */}
          <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-400 font-semibold pt-2">IRPF e impuestos pagados</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Kpi
              label="IRPF retenido en tus facturas"
              value={fmtMoney(data.irpf?.retenidoEnFacturas ?? 0)}
              sub={`${data.irpf?.facturasConRetencion ?? 0} factura(s) con retención · lo ingresa el cliente por ti`}
              variant="white"
            />
            <Kpi
              label="Impuestos pagados en el periodo"
              value={fmtMoney(data.impuestosPagados?.total ?? 0)}
              sub={`${data.impuestosPagados?.numero ?? 0} gasto(s): IRPF, IVA, IBI y tasas`}
              variant="white"
            />
          </div>

          {(data.impuestosPagados?.numero ?? 0) === 0 && (
            <div className="bg-neutral-50 border border-neutral-200 rounded-lg px-4 py-3 text-xs text-neutral-500">
              No hay gastos marcados como <strong>Impuestos</strong> en este periodo. Al registrar un
              pago de IRPF, IVA, IBI o una tasa, elige ese tipo de gasto y aparecerá aquí.
            </div>
          )}

          <div className="bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 text-xs text-amber-800">
            Este resumen es <strong>orientativo</strong>: revísalo con tu asesoría antes de presentarlo a Hacienda.
          </div>

          {/* Repercutido por tipo */}
          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
            <h2 className="eyebrow mb-3">IVA Repercutido por tipo</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead>
                  <tr className="border-b border-neutral-100">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Tipo</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Base</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Cuota</th>
                  </tr>
                </thead>
                <tbody>
                  {data.output.byRate.map((r) => (
                    <tr key={r.vatRate} className="border-b border-neutral-50">
                      <td className="px-3 py-2 text-neutral-700">{r.vatRate}%</td>
                      <td className="px-3 py-2 text-right tabular text-neutral-700">{fmtMoney(r.base)}</td>
                      <td className="px-3 py-2 text-right tabular font-semibold text-neutral-900">{fmtMoney(r.vat)}</td>
                    </tr>
                  ))}
                  {data.output.byRate.length === 0 && (
                    <tr><td colSpan={3} className="text-center py-6 text-xs text-neutral-400">Sin facturas en el periodo</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-neutral-200">
                    <td className="px-3 py-2 font-display text-neutral-900">Total</td>
                    <td className="px-3 py-2 text-right tabular font-display text-neutral-900">{fmtMoney(data.output.totals.base)}</td>
                    <td className="px-3 py-2 text-right tabular font-display text-neutral-900">{fmtMoney(data.output.totals.vat)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Soportado por tipo */}
          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
            <h2 className="eyebrow mb-3">IVA Soportado deducible por tipo</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead>
                  <tr className="border-b border-neutral-100">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Tipo</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Base</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Cuota</th>
                  </tr>
                </thead>
                <tbody>
                  {data.input.byRate.map((r) => (
                    <tr key={r.vatRate} className="border-b border-neutral-50">
                      <td className="px-3 py-2 text-neutral-700">{r.vatRate}%</td>
                      <td className="px-3 py-2 text-right tabular text-neutral-700">{fmtMoney(r.base)}</td>
                      <td className="px-3 py-2 text-right tabular font-semibold text-neutral-900">{fmtMoney(r.vat)}</td>
                    </tr>
                  ))}
                  {data.input.byRate.length === 0 && (
                    <tr><td colSpan={3} className="text-center py-6 text-xs text-neutral-400">Sin costes deducibles en el periodo</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-neutral-200">
                    <td className="px-3 py-2 font-display text-neutral-900">Total deducible</td>
                    <td className="px-3 py-2 text-right tabular font-display text-neutral-900">{fmtMoney(data.input.totals.base)}</td>
                    <td className="px-3 py-2 text-right tabular font-display text-neutral-900">{fmtMoney(data.input.totals.vat)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Detalle de facturas */}
          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
            <h2 className="eyebrow mb-3">Facturas emitidas</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-neutral-100">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Fecha</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Nº</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Cliente</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Base</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">IVA</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.output.invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-neutral-50">
                      <td className="px-3 py-2 font-mono text-xs text-neutral-500">{fmtDate(inv.issueDate)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-neutral-500">{inv.number}</td>
                      <td className="px-3 py-2 text-neutral-700">{inv.clientName ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular text-neutral-700">{fmtMoney(inv.base)}</td>
                      <td className="px-3 py-2 text-right tabular text-neutral-700">{fmtMoney(inv.vat)}</td>
                      <td className="px-3 py-2 text-right tabular font-semibold text-neutral-900">{fmtMoney(inv.total)}</td>
                    </tr>
                  ))}
                  {data.output.invoices.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-6 text-xs text-neutral-400">Sin facturas</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
