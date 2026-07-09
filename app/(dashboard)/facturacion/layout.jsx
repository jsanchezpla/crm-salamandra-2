"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PILLARS = [
  {
    label: "Operativa",
    items: [
      { href: "/facturacion", label: "Panel", exact: true },
      { href: "/facturacion/presupuestos", label: "Presupuestos" },
      { href: "/facturacion/facturas", label: "Facturas" },
      { href: "/facturacion/cobros", label: "Cobros" },
      { href: "/facturacion/recurrentes", label: "Recurrentes" },
      { href: "/facturacion/costes", label: "Gastos" },
    ],
  },
  {
    label: "Finanzas & Rentabilidad",
    items: [
      { href: "/facturacion/resumen", label: "Resumen" },
      { href: "/facturacion/analitica/socios", label: "Por socio" },
      { href: "/facturacion/analitica/clientes", label: "Por cliente" },
      { href: "/facturacion/analitica/empleados", label: "Por empleado" },
      { href: "/facturacion/analitica/iva", label: "Libro IVA" },
      { href: "/facturacion/cumplimiento", label: "Cumplimiento" },
    ],
  },
  {
    label: "Config",
    items: [{ href: "/facturacion/configuracion", label: "Configuración" }],
  },
];

function isActive(pathname, item) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export default function FacturacionLayout({ children }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-full min-h-0">
      <nav className="shrink-0 border-b border-neutral-200 bg-white/70 backdrop-blur px-4 lg:px-8 py-2.5 overflow-x-auto">
        <div className="flex items-center gap-5 min-w-max">
          {PILLARS.map((pillar) => (
            <div key={pillar.label} className="flex items-center gap-2">
              <span className="text-[9.5px] uppercase tracking-[0.12em] text-neutral-400 font-semibold shrink-0">
                {pillar.label}
              </span>
              <div className="flex items-center gap-1">
                {pillar.items.map((item) => {
                  const active = isActive(pathname, item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`text-[12.5px] px-2.5 py-1 rounded-md whitespace-nowrap transition ${
                        active
                          ? "bg-[var(--color-primary,#1B3A2D)] text-white font-medium"
                          : "text-neutral-600 hover:bg-neutral-100"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
              {pillar.label !== "Config" && <span className="w-px h-4 bg-neutral-200 shrink-0" />}
            </div>
          ))}
        </div>
      </nav>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}
