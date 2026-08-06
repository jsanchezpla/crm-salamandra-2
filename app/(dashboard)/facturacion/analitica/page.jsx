"use client";

import Link from "next/link";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";

const SECTIONS = [
  { href: "/facturacion/analitica/iva", label: "Libro IVA · Modelo 303", desc: "Ventas, compras deducibles, diferencia, exportación a Excel" },
  { href: "/facturacion/analitica/clientes", label: "Por cliente", desc: "Facturación, cobros, costes imputados y margen por cliente" },
  { href: "/facturacion/analitica/empleados", label: "Por empleado", desc: "Rendimiento, coste salarial y margen por empleado" },
];

export default function AnaliticaIndex() {
  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-end justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Finanzas · Analítica</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1 flex items-center gap-2">
            <span>Analítica</span>
            <HelpTooltip title="Qué cuentan estos informes" placement="bottom">
              Los importes van <strong className="text-white">sin IVA</strong>, así que no cuadran
              con los totales que ves en Facturas. Cada factura cuenta en la fecha en que se emitió,
              aunque el dinero entre más tarde: para verlo por la fecha en que llegó, mira Cobros.
              No entran los borradores ni las facturas anuladas o rectificadas.
            </HelpTooltip>
          </h1>
        </div>
        <Link href="/facturacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Volver</Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href}
            className="bg-white border border-neutral-100 rounded-xl p-4 transition-colors hover:border-[var(--color-primary,#1B3A2D)] block">
            <div className="font-display text-base text-neutral-900">{s.label}</div>
            <div className="text-xs text-neutral-500 mt-1">{s.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
