"use client";

/**
 * DemoTabs — la barra de arriba para cambiar de demo (13/08/2026, Rodrigo).
 *
 * Había UNA demo con veinte módulos encendidos y era la que veía todo el que
 * pulsaba «Prueba una demo». Ahora hay una por oficio, y el visitante entra por
 * la general y salta a la suya desde aquí. Se pintan como pestañas y no como un
 * desplegable a propósito: la gracia es que se VEA que hay más de una — un
 * desplegable cerrado no le dice a nadie que existe la de nutrición.
 *
 * Solo aparece dentro de una demo. En el CRM de un cliente real, este componente
 * no devuelve nada: la lista de demos no tiene por qué salir en su pantalla.
 *
 * Cambiar de pestaña vuelve a pasar por `/api/auth/demo`, que es quien decide si
 * ese slug es una demo (lista blanca) y firma la sesión. Aquí no se elige nada:
 * si alguien manipulara este componente para pedir el slug de un cliente, el
 * servidor responde 404.
 */

import { useState } from "react";
import { DEMOS, esSlugDemo } from "../../lib/demo/demos.js";

/**
 * `disponibles` son las demos que EXISTEN de verdad, que las cuenta el layout.
 * No es lo mismo que la lista blanca: el código se despliega antes de que se
 * siembren las cuentas, y una pestaña que responde 404 en el escaparate público
 * es peor que no tenerla. Si no llega la lista se cae a la del catálogo, que es
 * lo que había antes y sigue siendo verdad en local.
 */
export default function DemoTabs({ slug, disponibles }) {
  const [yendoA, setYendoA] = useState(null);
  const [error, setError] = useState(null);

  if (!esSlugDemo(slug)) return null;

  const hay = Array.isArray(disponibles) && disponibles.length ? disponibles : DEMOS.map((d) => d.slug);
  const pestañas = DEMOS.filter((d) => hay.includes(d.slug));
  // Una sola demo montada: la barra no aporta nada y ocupa una franja del CRM.
  if (pestañas.length < 2) return null;

  async function cambiar(destino) {
    if (destino === slug || yendoA) return;
    setError(null);
    setYendoA(destino);
    try {
      const res = await fetch("/api/auth/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: destino }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "No se pudo abrir esa demo");
        setYendoA(null);
        return;
      }
      // Recarga entera y a la portada: la sesión cambia de tenant, así que todo
      // lo que hay pintado (menú, marca, datos) es de otro cliente. Y una
      // recarga dura es además lo que dispara la restauración de la demo a la
      // que se entra (lib/demo/resetDemo.js).
      window.location.assign("/");
    } catch {
      setError("Error de conexión");
      setYendoA(null);
    }
  }

  return (
    <div
      className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-1.5 overflow-x-auto"
      style={{
        backgroundColor: "var(--color-primary)",
        borderBottom: "1px solid color-mix(in srgb, var(--color-primary) 70%, black)",
      }}
    >
      <span
        className="hidden sm:inline text-[10px] uppercase tracking-[0.16em] shrink-0 pr-1"
        style={{ color: "color-mix(in srgb, white 55%, transparent)" }}
      >
        Demo
      </span>

      <div className="flex items-center gap-1">
        {pestañas.map((d) => {
          const activa = d.slug === slug;
          const cargando = yendoA === d.slug;
          return (
            <button
              key={d.slug}
              type="button"
              onClick={() => cambiar(d.slug)}
              disabled={!!yendoA}
              title={d.desc}
              aria-current={activa ? "page" : undefined}
              className="shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide transition-colors disabled:cursor-wait whitespace-nowrap"
              style={
                activa
                  ? { backgroundColor: "white", color: "var(--color-primary)" }
                  : {
                      color: "color-mix(in srgb, white 72%, transparent)",
                      border: "1px solid color-mix(in srgb, white 22%, transparent)",
                    }
              }
            >
              {cargando ? "Abriendo…" : d.rotulo}
            </button>
          );
        })}
      </div>

      {error ? (
        <span className="text-[11px] ml-2 shrink-0" style={{ color: "#FFD9D9" }}>
          {error}
        </span>
      ) : (
        <span
          className="hidden md:inline text-[11px] ml-auto shrink-0 pl-3 truncate"
          style={{ color: "color-mix(in srgb, white 45%, transparent)" }}
        >
          Datos de ejemplo · se restauran solos
        </span>
      )}
    </div>
  );
}
