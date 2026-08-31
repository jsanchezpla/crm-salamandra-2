"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * La barra de pestañas de Facturación. Era el propio layout hasta el
 * 29/08/2026; se partió en dos cuando llegó la primera pestaña que depende de
 * un submódulo (`billing_banco`): un "use client" no puede preguntar por los módulos, así
 * que el layout (servidor) los resuelve y esta barra solo pinta lo que le den
 * — el mismo reparto que la página de Configuración con ConfigModule.
 */
function pillars(conBanco, conSocios) {
  return [
    {
      label: "Operativa",
      items: [
        { href: "/facturacion", label: "Panel", exact: true },
        { href: "/facturacion/presupuestos", label: "Presupuestos" },
        { href: "/facturacion/facturas", label: "Facturas" },
        { href: "/facturacion/cobros", label: "Cobros" },
        { href: "/facturacion/recurrentes", label: "Recurrentes" },
        { href: "/facturacion/costes", label: "Gastos" },
        // Proveedores va pegado a Gastos porque es donde se usa: al registrar un
        // gasto eliges proveedor. No es una pantalla de configuración.
        { href: "/facturacion/proveedores", label: "Proveedores" },
        { href: "/facturacion/arqueo", label: "Arqueo" },
        // Banco: el extracto real y la conciliación. Solo con el submódulo
        // `billing_banco` (las tres puertas: esta pestaña, la página con
        // notFound() y los endpoints con hasModule).
        ...(conBanco ? [{ href: "/facturacion/banco", label: "Banco" }] : []),
      ],
    },
    {
      label: "Finanzas & Rentabilidad",
      items: [
        { href: "/facturacion/resumen", label: "Resumen" },
        // Por socio: solo si el centro tiene socios CONFIGURADOS (la vara,
        // lib/billing/socios.js). Un centro sin socios veía una tabla con una
        // sola fila «Sin asignar».
        ...(conSocios ? [{ href: "/facturacion/analitica/socios", label: "Por socio" }] : []),
        { href: "/facturacion/analitica/clientes", label: "Por cliente" },
        { href: "/facturacion/analitica/empleados", label: "Por empleado" },
        { href: "/facturacion/analitica/iva", label: "Impuestos" },
        { href: "/facturacion/cumplimiento", label: "Cumplimiento" },
      ],
    },
    {
      label: "Config",
      items: [{ href: "/facturacion/configuracion", label: "Configuración" }],
    },
  ];
}

function isActive(pathname, item) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export default function FacturacionNav({ conBanco = false, conSocios = true }) {
  const pathname = usePathname();

  return (
    <nav className="shrink-0 border-b border-neutral-200 bg-white/70 backdrop-blur px-4 lg:px-8 py-2.5 overflow-x-auto">
      <div className="flex items-center gap-5 min-w-max">
        {pillars(conBanco, conSocios).map((pillar) => (
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
  );
}
