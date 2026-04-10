"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const currentYear = new Date().getFullYear();

function fmt(n) {
  return Number(n || 0).toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function KpiCard({ label, value, sub, variant = "white" }) {
  const styles = {
    dark: {
      wrap: "bg-[#0F0F0F] border-[#0F0F0F]",
      label: "text-white/40",
      value: "text-white",
      sub: "text-white/40",
    },
    green: {
      wrap: "border-transparent",
      label: "text-black/40",
      value: "text-[#0F0F0F]",
      sub: "text-black/40",
    },
    amber: {
      wrap: "bg-[#FFF8ED] border-[#FDDBA0]",
      label: "text-amber-700",
      value: "text-amber-900",
      sub: "text-amber-600",
    },
    white: {
      wrap: "bg-white border-neutral-200",
      label: "text-neutral-400",
      value: "text-neutral-900",
      sub: "text-neutral-400",
    },
    emerald: {
      wrap: "bg-white border-emerald-200",
      label: "text-emerald-800",
      value: "text-emerald-600",
      sub: "text-emerald-300",
    },
  };

  const s = styles[variant];

  return (
    <div
      className={`rounded-xl p-4 flex flex-col gap-1.5 border ${s.wrap}`}
      style={
        variant === "green"
          ? {
              background: "var(--color-primary, #2EE59D)",
              borderColor: "var(--color-primary, #2EE59D)",
            }
          : {}
      }
    >
      <span className={`text-[10px] font-medium uppercase tracking-widest ${s.label}`}>
        {label}
      </span>
      <span
        className={`text-2xl font-extrabold leading-none ${s.value}`}
        style={{ fontFamily: "'Syne', sans-serif" }}
      >
        {fmt(value)}
        <span className={`text-sm font-normal ml-1 ${s.sub}`}>€</span>
      </span>
      {sub && <span className={`text-[10px] ${s.sub}`}>{sub}</span>}
    </div>
  );
}

function MonthBar({ month, value, max }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const display = value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value;
  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <div className="w-full bg-white/10 rounded-t-sm overflow-hidden" style={{ height: 72 }}>
        <div
          className="w-full rounded-t-sm"
          style={{
            height: `${pct}%`,
            marginTop: `${100 - pct}%`,
            background: "var(--color-primary, #2EE59D)",
          }}
        />
      </div>
      <span className="text-[9px] text-white/30">{month}</span>
    </div>
  );
}

function QuickLink({ href, label, desc, icon }) {
  return (
    <Link
      href={href}
      className="group bg-white border border-neutral-200 rounded-xl p-4 hover:border-transparent transition-all block"
      style={{ "--hover-border": "var(--color-primary, #2EE59D)" }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--color-primary, #2EE59D)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "")}
    >
      <div
        className="w-8 h-8 bg-neutral-100 rounded-lg flex items-center justify-center mb-3 transition-colors"
        style={{}}
        onMouseEnter={() => {}}
      >
        <span
          className="text-neutral-500 group-hover:text-[#0F0F0F] transition-colors"
          style={{ lineHeight: 0 }}
        >
          {icon}
        </span>
      </div>
      <div
        className="text-xs font-bold text-neutral-900 mb-0.5"
        style={{ fontFamily: "'Syne', sans-serif" }}
      >
        {label}
      </div>
      <div className="text-[10px] text-neutral-400">{desc}</div>
    </Link>
  );
}

export default function FacturacionOverview() {
  const [from, setFrom] = useState(`${currentYear}-01-01`);
  const [to, setTo] = useState(`${currentYear}-12-31`);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/analytics?from=${from}&to=${to}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setData(json.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [from, to]);

  const income = data?.income;
  const costs = data?.costs;
  const margins = data?.margins;
  const byMonth = income?.byMonth ?? [];
  const maxMonth = Math.max(...byMonth.map((m) => m.totalBilled), 1);
  const totalBilled = income?.totalBilled || 1;

  const collectedPct = income ? Math.round((income.totalCollected / totalBilled) * 100) : 0;
  const pendingPct = income ? Math.round((income.pendingCollection / totalBilled) * 100) : 0;

  return (
    <div className="h-screen flex flex-col gap-4 p-6 bg-[#F5F5F3] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1
            className="text-xl font-extrabold text-neutral-900"
            style={{ fontFamily: "'Syne', sans-serif" }}
          >
            Facturación
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">Resumen financiero del período</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs text-neutral-600 bg-white focus:outline-none focus:border-neutral-400"
          />
          <span className="text-neutral-300 text-xs">—</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs text-neutral-600 bg-white focus:outline-none focus:border-neutral-400"
          />
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide text-[#0F0F0F] disabled:opacity-50 transition-opacity"
            style={{
              fontFamily: "'Syne', sans-serif",
              background: "var(--color-primary, #2EE59D)",
            }}
          >
            <svg
              className="w-3 h-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            {loading ? "Cargando..." : "Exportar"}
          </button>
        </div>
      </div>

      {error && (
        <div className="shrink-0 px-4 py-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="grid grid-cols-4 gap-3 shrink-0">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="bg-white border border-neutral-100 rounded-xl h-20 animate-pulse"
            />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-4 gap-3 shrink-0">
            <KpiCard
              label="Facturado"
              value={income?.totalBilled}
              sub="Período seleccionado"
              variant="dark"
            />
            <KpiCard
              label="Cobrado"
              value={income?.totalCollected}
              sub={`${collectedPct}% del total`}
              variant="green"
            />
            <KpiCard
              label="Pendiente"
              value={income?.pendingCollection}
              sub={`${pendingPct}% sin cobrar`}
              variant={income?.pendingCollection > 0 ? "amber" : "white"}
            />
            <KpiCard
              label="Ticket medio"
              value={income?.averageTicket}
              sub={`${income?.invoiceCount ?? 0} facturas · ${income?.clientCount ?? 0} clientes`}
              variant="white"
            />
          </div>

          {/* Main grid */}
          <div className="grid grid-cols-[1.4fr_1fr] gap-3 flex-1 min-h-0">
            {/* Columna izquierda — gráfico + servicios */}
            <div className="flex flex-col gap-3 min-h-0">
              <div className="bg-[#0F0F0F] rounded-xl p-4 flex-1 min-h-0 flex flex-col">
                <h2
                  className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-3 shrink-0"
                  style={{ fontFamily: "'Syne', sans-serif" }}
                >
                  Ingresos mensuales
                </h2>
                <div className="flex items-end gap-1.5 flex-1">
                  {byMonth.map((m) => (
                    <MonthBar
                      key={m.month}
                      month={m.month?.slice(5) ?? m.month}
                      value={m.totalBilled}
                      max={maxMonth}
                    />
                  ))}
                </div>
              </div>

              <div className="bg-[#0F0F0F] rounded-xl p-4 shrink-0">
                <h2
                  className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-3"
                  style={{ fontFamily: "'Syne', sans-serif" }}
                >
                  Por tipo de servicio
                </h2>
                <div className="space-y-2">
                  {income?.byServiceType?.map((s) => {
                    const pct = Math.round((s.totalBilled / totalBilled) * 100);
                    return (
                      <div key={s.serviceType}>
                        <div className="flex justify-between mb-1">
                          <span className="text-xs text-white/60 capitalize">{s.serviceType}</span>
                          <span className="text-xs font-medium text-white">
                            {fmt(s.totalBilled)} €
                          </span>
                        </div>
                        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-1 rounded-full"
                            style={{
                              width: `${pct}%`,
                              background: "var(--color-primary, #2EE59D)",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Columna derecha — costes + márgenes */}
            <div className="flex flex-col gap-3 min-h-0">
              <div className="bg-white border border-neutral-200 rounded-xl p-4 flex-1 min-h-0 flex flex-col">
                <h2
                  className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 mb-3 shrink-0"
                  style={{ fontFamily: "'Syne', sans-serif" }}
                >
                  Desglose de costes
                </h2>
                <div className="flex flex-col gap-0 flex-1 justify-between">
                  {[
                    { label: "Salarios", value: costs?.salaries },
                    { label: "Costes fijos", value: costs?.fixed },
                    { label: "Variables", value: costs?.variable },
                    { label: "CAPEX", value: costs?.capex },
                    { label: "OPEX", value: costs?.opex },
                  ].map(({ label, value }) => (
                    <div
                      key={label}
                      className="flex items-center justify-between py-1.5 border-b border-neutral-50 last:border-0"
                    >
                      <span className="text-xs text-neutral-500">{label}</span>
                      <span className="text-xs font-medium text-neutral-800">{fmt(value)} €</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 mt-1 border-t-2 border-neutral-900">
                    <span
                      className="text-xs font-extrabold text-neutral-900"
                      style={{ fontFamily: "'Syne', sans-serif" }}
                    >
                      Total
                    </span>
                    <span
                      className="text-xs font-extrabold text-neutral-900"
                      style={{ fontFamily: "'Syne', sans-serif" }}
                    >
                      {fmt(costs?.total)} €
                    </span>
                  </div>
                </div>
              </div>

              {/* Márgenes */}
              <div className="grid grid-cols-2 gap-3 shrink-0">
                <div className="bg-white border border-emerald-200 rounded-xl p-4">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-emerald-800 mb-2">
                    Margen bruto
                  </div>
                  <div
                    className="text-xl font-extrabold text-emerald-600 leading-none mb-1"
                    style={{ fontFamily: "'Syne', sans-serif" }}
                  >
                    {fmt(margins?.grossMargin)}
                    <span className="text-sm font-normal text-emerald-300 ml-1">€</span>
                  </div>
                  <div className="text-[10px] text-emerald-400">
                    {margins?.grossMarginPct ?? 0}%
                  </div>
                </div>
                <div className="bg-white border border-emerald-200 rounded-xl p-4">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-emerald-800 mb-2">
                    Margen neto
                  </div>
                  <div
                    className="text-xl font-extrabold text-emerald-600 leading-none mb-1"
                    style={{ fontFamily: "'Syne', sans-serif" }}
                  >
                    {fmt(margins?.netMargin)}
                    <span className="text-sm font-normal text-emerald-300 ml-1">€</span>
                  </div>
                  <div className="text-[10px] text-emerald-400">{margins?.netMarginPct ?? 0}%</div>
                </div>
                <div className="col-span-2 bg-white border border-emerald-200 rounded-xl p-4">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-emerald-800 mb-2">
                    EBITDA
                  </div>
                  <div
                    className="text-xl font-extrabold text-emerald-600 leading-none mb-1"
                    style={{ fontFamily: "'Syne', sans-serif" }}
                  >
                    {fmt(margins?.ebitda)}
                    <span className="text-sm font-normal text-emerald-300 ml-1">€</span>
                  </div>
                  <div className="text-[10px] text-emerald-400">
                    {Math.round(((margins?.ebitda ?? 0) / totalBilled) * 100)}% margen
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-4 gap-3 shrink-0">
            {[
              {
                href: "/facturacion/facturas",
                label: "Facturas",
                desc: "Gestión de facturas",
                icon: (
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    />
                  </svg>
                ),
              },
              {
                href: "/facturacion/cobros",
                label: "Cobros",
                desc: "Pagos y tesorería",
                icon: (
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
                    />
                  </svg>
                ),
              },
              {
                href: "/facturacion/costes",
                label: "Costes",
                desc: "Gastos operativos",
                icon: (
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"
                    />
                  </svg>
                ),
              },
              {
                href: "/facturacion/analitica",
                label: "Analítica",
                desc: "Por terapeuta",
                icon: (
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zm9.75-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.625c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.25zm-6.75 9.75c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-2.25A1.125 1.125 0 016 20.25v-2.25z"
                    />
                  </svg>
                ),
              },
            ].map(({ href, label, desc, icon }) => (
              <Link
                key={href}
                href={href}
                className="group bg-white border border-neutral-200 rounded-xl p-3.5 transition-colors block"
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-primary, #2EE59D)";
                  e.currentTarget.querySelector(".ql-icon").style.background =
                    "var(--color-primary, #2EE59D)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "";
                  e.currentTarget.querySelector(".ql-icon").style.background = "";
                }}
              >
                <div className="ql-icon w-7 h-7 bg-neutral-100 rounded-lg flex items-center justify-center mb-2.5 transition-colors">
                  <span className="text-neutral-500 transition-colors" style={{ lineHeight: 0 }}>
                    {icon}
                  </span>
                </div>
                <div
                  className="text-xs font-bold text-neutral-900 mb-0.5"
                  style={{ fontFamily: "'Syne', sans-serif" }}
                >
                  {label}
                </div>
                <div className="text-[10px] text-neutral-400">{desc}</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
