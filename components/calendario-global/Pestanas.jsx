"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Pestañas del calendario global: «Calendario» y «Proyectos» (12/09/2026).
 *
 * Rodrigo: «Debería tener acceso a los proyectos también aparte de los
 * calendarios». Van en la cabecera del layout, que es un componente de
 * servidor (exporta `metadata`) y no puede saber en qué ruta está; por eso la
 * pestaña activa la decide este componente cliente con `usePathname`.
 *
 * «Proyectos» sigue activa dentro del tablero de un proyecto
 * (`/calendario-global/proyectos/<slug>/<id>`).
 */

const PESTANAS = [
  {
    href: "/calendario-global",
    texto: "Calendario",
    activa: (ruta) => ruta === "/calendario-global" || ruta === "/calendario-global/",
  },
  {
    href: "/calendario-global/proyectos",
    texto: "Proyectos",
    activa: (ruta) => ruta === "/calendario-global/proyectos" || ruta.startsWith("/calendario-global/proyectos/"),
  },
];

export default function Pestanas() {
  const ruta = usePathname() ?? "";
  return (
    <nav aria-label="Secciones" className="flex items-stretch gap-0.5 sm:gap-1">
      {PESTANAS.map((p) => {
        const activa = p.activa(ruta);
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={activa ? "page" : undefined}
            className={`relative inline-flex items-center px-2.5 sm:px-3 text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/70 ${
              activa ? "text-white font-medium" : "text-white/65 hover:text-white"
            }`}
          >
            {p.texto}
            {activa && <span aria-hidden="true" className="absolute left-2.5 right-2.5 sm:left-3 sm:right-3 bottom-0 h-[2px] rounded-full bg-[#D9B93E]" />}
          </Link>
        );
      })}
    </nav>
  );
}
