"use client";

import { useEffect, useState } from "react";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

const CALENDAR = [
  { date: "2026", label: "Adaptación", done: true },
  { date: "1 ene 2027", label: "Verifactu · empresas", done: false },
  { date: "1 jul 2027", label: "Verifactu · autónomos", done: false },
  { date: "oct 2027", label: "Factura-e (>8 M€)", done: false },
  { date: "oct 2028", label: "Factura-e · resto", done: false },
];

function Chip({ tone, children }) {
  const map = {
    ok: "bg-emerald-100 text-emerald-700",
    warn: "bg-amber-100 text-amber-700",
    off: "bg-neutral-100 text-neutral-500",
  };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${map[tone]}`}>{children}</span>;
}

// Un presupuesto (serie P) no es documento fiscal → no aplica Verifactu/factura-e.
function isQuoteSeries(s) {
  const code = String(s.code || "").toUpperCase();
  const prefix = String(s.prefix || "").toUpperCase();
  const name = String(s.name || "").toLowerCase();
  return code.startsWith("P") || prefix.startsWith("P") || name.includes("presupuesto");
}

export default function CumplimientoPage() {
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/billing/series", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setSeries(j.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={`${anchoPantalla("listado")} space-y-6`}>
      <div>
        <div className="eyebrow">Finanzas · Cumplimiento</div>
        <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1 flex items-center gap-2 flex-wrap">
          <span>Verifactu &amp; Factura-e</span>
          <HelpTooltip title="Verifactu y Factura-e" placement="bottom">
            Dos obligaciones distintas que suenan parecido. <strong className="text-white">Verifactu</strong>{" "}
            es que cada factura se registre ante Hacienda al emitirla, con su huella y su QR.{" "}
            <strong className="text-white">Factura-e</strong> es el formato electrónico para
            facturar a otras empresas y a la Administración.
            {" "}
            Esta pantalla no emite nada: solo dice, serie a serie, si estás listo y para qué fecha
            te obliga la ley.
          </HelpTooltip>
        </h1>
        <p className="text-xs text-neutral-400 mt-1">
          Estado de preparación por serie y calendario normativo (RD-ley 15/2025 · RD 238/2026).
        </p>
      </div>

      {/* Calendario normativo */}
      <div className="bg-white border border-neutral-200 rounded-xl p-5">
        <div className="eyebrow mb-4">Calendario normativo</div>
        <div className="flex gap-0 overflow-x-auto">
          {CALENDAR.map((s, i) => (
            <div key={i} className="flex-1 min-w-[120px] text-center relative px-2">
              {i < CALENDAR.length - 1 && (
                <div className="absolute top-[7px] left-1/2 right-0 h-0.5 bg-neutral-200" />
              )}
              <div
                className={`w-4 h-4 rounded-full mx-auto mb-2.5 relative z-10 border-[3px] border-white ${
                  s.done ? "bg-emerald-500" : "bg-[var(--color-primary,#1B3A2D)]/40"
                }`}
                style={s.done ? {} : { background: "#C7B9EC" }}
              />
              <div className="font-display text-sm text-[var(--ink-900)]">{s.date}</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Estado por serie */}
      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1.4fr_120px_130px_110px] gap-3 px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 text-[10.5px] uppercase tracking-wide text-neutral-500 font-semibold">
          <span>Serie</span><span>Verifactu</span><span>Factura-e</span><span>Estados com.</span>
        </div>
        {loading ? (
          <div className="px-4 py-8 text-sm text-neutral-400 text-center">Cargando…</div>
        ) : series.length === 0 ? (
          <div className="px-4 py-8 text-sm text-neutral-400 text-center">
            No hay series configuradas. Añádelas en{" "}
            <a href="/facturacion/configuracion" className="underline">Configuración</a>.
          </div>
        ) : (
          series.map((s) => {
            const quote = isQuoteSeries(s);
            return (
              <div key={s.id || s.code} className="grid grid-cols-[1.4fr_120px_130px_110px] gap-3 px-4 py-3 border-t border-neutral-100 text-[13.5px] items-center">
                <span className="text-neutral-800">
                  <span className="font-display text-[var(--ink-900)]">{s.prefix || s.code}</span>
                  <span className="text-neutral-400 ml-2 text-[12px]">{s.name || (quote ? "Presupuestos" : "Facturas")}</span>
                </span>
                <span>{quote ? <Chip tone="off">No aplica</Chip> : <Chip tone="ok">Activo</Chip>}</span>
                <span>{quote ? <Chip tone="off">No aplica</Chip> : <Chip tone="warn">En pruebas</Chip>}</span>
                <span className="text-neutral-400 text-[12.5px]">{quote ? "—" : "Automático"}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-3 items-center bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-lg shrink-0">✓</div>
        <div>
          <div className="text-sm font-semibold text-emerald-800">Preparación global: en marcha para 2027</div>
          <div className="text-xs text-emerald-700/80">
            Hash encadenado, QR y comunicación de estados operativos en la serie principal (vía Facturantia).
          </div>
        </div>
      </div>
    </div>
  );
}
