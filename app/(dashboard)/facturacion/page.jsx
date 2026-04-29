"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import PeriodPicker, { computeRange } from "./_components/PeriodPicker.jsx";
import Kpi, { fmtMoney, fmtPct } from "./_components/Kpi.jsx";

const QUICK_LINKS = [
  { href: "/facturacion/facturas", label: "Facturas", desc: "Listado, alta, rectificativas" },
  { href: "/facturacion/cobros", label: "Cobros", desc: "Pagos recibidos, parciales" },
  { href: "/facturacion/costes", label: "Costes", desc: "Gastos con IVA" },
  { href: "/facturacion/recurrentes", label: "Recurrentes", desc: "Facturación periódica" },
  { href: "/facturacion/analitica/iva", label: "Libro IVA", desc: "Modelo 303 + Excel" },
  { href: "/facturacion/analitica/clientes", label: "Por cliente", desc: "Facturado y margen" },
  { href: "/facturacion/analitica/empleados", label: "Por empleado", desc: "Rendimiento" },
  { href: "/facturacion/configuracion", label: "Configuración", desc: "Datos fiscales y series" },
];

const MONTH_NAMES_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/**
 * Recibe array [{ month: "YYYY-MM", ... }] y devuelve etiquetas en español.
 * Si la serie cruza años, añade año corto solo a la primera barra del año nuevo.
 */
function formatMonthLabels(byMonth) {
  if (!Array.isArray(byMonth)) return [];
  const years = new Set(byMonth.map((m) => String(m.month || "").slice(0, 4)).filter(Boolean));
  const allSameYear = years.size <= 1;
  return byMonth.map((m, i) => {
    const [y, mm] = String(m.month || "").split("-");
    const idx = parseInt(mm, 10) - 1;
    const name = MONTH_NAMES_ES[idx] ?? mm ?? "";
    if (allSameYear) return name;
    const prevYear = i > 0 ? String(byMonth[i - 1].month || "").slice(0, 4) : null;
    if (i === 0 || (prevYear && y !== prevYear)) {
      return `${name} ${String(y).slice(2)}`;
    }
    return name;
  });
}

function MonthBar({ month, value, max }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
      <div className="w-full bg-white/10 rounded-t-sm overflow-hidden" style={{ height: 80 }}>
        <div
          className="w-full rounded-t-sm transition-all duration-300"
          style={{ height: `${pct}%`, marginTop: `${100 - pct}%`, background: "var(--ink-100, #F4F0EA)" }}
        />
      </div>
      <span className="text-[9px] text-white/40 truncate">{month}</span>
    </div>
  );
}

export default function FacturacionResumen() {
  const sp = useSearchParams();
  const period = sp.get("period") || "year";
  let from = sp.get("from");
  let to = sp.get("to");
  if (!from || !to) {
    const r = computeRange(period);
    from = r.from; to = r.to;
  }

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!from || !to) return;
    setLoading(true);
    setErrorMsg(null);
    fetch(`/api/billing/analytics?from=${from}&to=${to}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "Error");
        setData(j.data);
      })
      .catch((e) => setErrorMsg(e.message))
      .finally(() => setLoading(false));
  }, [from, to]);

  const income = data?.income;
  const costs = data?.costs;
  const margins = data?.margins;
  const byMonth = income?.byMonth ?? [];
  const maxMonth = Math.max(1, ...byMonth.map((m) => m.billedBase));

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Finanzas · Resumen</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">
            Facturación
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            {from && to ? `${from} → ${to}` : "Cargando periodo..."}
          </p>
        </div>
        <PeriodPicker />
      </div>

      {errorMsg && (
        <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {!data && (
          [...Array(4)].map((_, i) => (
            <div key={i} className="bg-neutral-100 border border-neutral-100 rounded-xl h-24 animate-pulse" />
          ))
        )}
        {data && (
          <>
            <Kpi
              label="Facturado"
              value={fmtMoney(income.billedBase)}
              sub="Base imponible · sin IVA"
              variant="dark"
            />
            <Kpi
              label="Cobrado"
              value={fmtMoney(income.collectedBase)}
              sub={`${fmtPct(income.collectedPct)} del facturado · base`}
              variant="primary"
            />
            <Kpi
              label="Pendiente"
              value={fmtMoney(income.pendingCollection)}
              sub={`${income.pendingInvoiceCount} factura${income.pendingInvoiceCount === 1 ? "" : "s"} pendiente${income.pendingInvoiceCount === 1 ? "" : "s"} · ${income.pendingClientCount} cliente${income.pendingClientCount === 1 ? "" : "s"}`}
              variant={income.pendingCollection > 0 ? "amber" : "white"}
            />
            <Kpi
              label="Ticket medio"
              value={fmtMoney(income.averageTicket)}
              sub="Base imponible / nº facturas"
              variant="white"
            />
          </>
        )}
      </div>

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-3">
          {/* Columna izquierda: gráfico mensual + KPI margen */}
          <div className="flex flex-col gap-3">
            <div
              className="rounded-xl p-4 lg:p-5 flex flex-col gap-3 min-h-[220px]"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              <div className="flex items-center justify-between">
                <h2 className="eyebrow text-white/60">Ingresos mensuales</h2>
                <span className="text-[10px] text-white/40">Base imponible</span>
              </div>
              {byMonth.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-white/40 text-xs">Sin datos</div>
              ) : (() => {
                const labels = formatMonthLabels(byMonth);
                return (
                  <div className="flex items-end gap-1.5 flex-1">
                    {byMonth.map((m, i) => (
                      <MonthBar key={m.month} month={labels[i]} value={m.billedBase} max={maxMonth} />
                    ))}
                  </div>
                );
              })()}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Kpi label="Margen Bruto" value={fmtMoney(margins.grossMargin)} sub={fmtPct(margins.grossMarginPct)} variant="emerald" />
              <Kpi label="Margen Neto" value={fmtMoney(margins.netMargin)} sub={fmtPct(margins.netMarginPct)} variant="white" />
              <Kpi label="EBITDA" value={fmtMoney(margins.ebitda)} sub={fmtPct(margins.ebitdaPct)} variant="white" />
            </div>
          </div>

          {/* Columna derecha: desglose costes */}
          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="eyebrow">Desglose de costes</h2>
              <span className="text-[10px] text-neutral-400">Base imponible</span>
            </div>
            <div className="flex-1 space-y-2">
              {[
                { label: "Variables", value: costs.byCategory.variable, color: "bg-amber-400", refTotal: "operating" },
                { label: "Fijos", value: costs.byCategory.fixed, color: "bg-neutral-400", refTotal: "operating" },
                { label: "OPEX", value: costs.byCategory.opex, color: "bg-sky-400", refTotal: "operating" },
              ].map((row) => {
                const pct = costs.operating > 0 ? Math.round((row.value / costs.operating) * 100) : 0;
                return (
                  <div key={row.label}>
                    <div className="flex justify-between text-xs">
                      <span className="text-neutral-500">{row.label}</span>
                      <span className="text-neutral-800 font-medium tabular">{fmtMoney(row.value)}</span>
                    </div>
                    <div className="h-1 bg-neutral-100 rounded-full overflow-hidden mt-1">
                      <div className={`h-1 rounded-full ${row.color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-neutral-200 mt-3 pt-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-700 font-semibold">Costes operativos</span>
                <span className="text-xs text-neutral-900 font-semibold tabular">{fmtMoney(costs.operating)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-neutral-400">
                <span>Facturado − operativos = Margen Neto</span>
              </div>
            </div>
            <div className="border-t border-neutral-100 mt-2 pt-2 space-y-1">
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-purple-400 inline-block" />
                  CAPEX <span className="text-[10px] text-neutral-400">(no operativo)</span>
                </span>
                <span className="tabular">{fmtMoney(costs.byCategory.capex)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-neutral-200 mt-2 pt-3">
              <span className="font-display text-base text-neutral-900">Total general</span>
              <span className="font-display text-base text-neutral-900 tabular">{fmtMoney(costs.total)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {QUICK_LINKS.map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className="bg-white border border-neutral-100 rounded-xl p-3.5 transition-colors hover:border-[var(--color-primary,#1B3A2D)] block"
          >
            <div className="font-display text-sm text-neutral-900">{q.label}</div>
            <div className="text-[10px] text-neutral-400 mt-0.5">{q.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
