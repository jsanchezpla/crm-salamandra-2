"use client";

import { useCallback } from "react";
import SelectorRemoto from "../ui/SelectorRemoto.jsx";
import { urlDeFichas } from "../../lib/clients/buscarFichas.js";

/**
 * SelectorCliente — elegir una ficha de cliente preguntando al SERVIDOR.
 *
 * ─── DE QUÉ FALLO NACE (28/08/2026) ─────────────────────────────────────────
 *
 * Once pantallas hacían lo mismo: al abrirse, `fetch("/api/clients?limit=200")`
 * y un desplegable que filtraba encima de esa lista. Con las 1.083 fichas de
 * Aumenta, **883 familias (el 82%) no salían de ninguna manera**, y varias
 * pantallas ni siquiera tenían dónde escribir: había que bajar por la lista.
 *
 * Subir el número no lo arreglaba. `/api/clients` corta en 200 por su cuenta,
 * así que el `limit=300` de Cobros y el `limit=500` del Calendario ya estaban
 * recibiendo 200 y nadie lo sabía.
 *
 * Y lo peor no era el tope, era el SILENCIO: la familia sencillamente no estaba
 * en la lista, exactamente igual que si no existiera. Un techo callado se lee
 * como una ausencia. Por eso, cuando hay más coincidencias que sitio, se dice.
 *
 * La mecánica vive en `components/ui/SelectorRemoto.jsx`, compartida con el
 * selector de pacientes. Aquí solo está lo que es propio de una ficha: a qué
 * dirección se pregunta y cómo se llama cada línea.
 *
 * ─── CÓMO SE USA ────────────────────────────────────────────────────────────
 *
 *     <SelectorCliente value={clientId} onChange={setClientId} />
 *
 * Es un reemplazo directo del `<Select>` que había: mismas pintas, mismo
 * teclado. La pantalla YA NO necesita bajarse la lista de fichas.
 *
 *   value        id de la ficha elegida (o "" / null)
 *   onChange     (id, ficha) — la ficha entera por si hace falta el nombre
 *   onFicha      (ficha|null) — la elegida, TAMBIÉN cuando se resuelve por id al
 *                cargar la pantalla. La necesita quien pinta algo con ella
 *                (Facturas avisa si le falta razón social o NIF).
 *   etiqueta     (ficha) => texto de cada línea. Por defecto, su nombre.
 *   params       filtros extra para la consulta, p.ej. { assignedTo: "nutricion" }
 *   opcionesFijas  opciones que van SIEMPRE arriba y no se filtran (`pinned`),
 *                  p.ej. «Sin cliente». Su `value` no puede chocar con un id.
 */
export default function SelectorCliente({
  value,
  onChange,
  onFicha,
  etiqueta,
  params = null,
  placeholder = "— Seleccionar cliente —",
  className = "",
  disabled = false,
  id,
  "aria-label": ariaLabel,
  opcionesFijas = [],
}) {
  // `params` suele venir escrito en el JSX (`params={{ assignedTo: "x" }}`), o
  // sea un objeto nuevo en cada render. Se fija por su contenido para que el
  // selector no vuelva a preguntar sin motivo.
  const clave = JSON.stringify(params || {});

  const buscar = useCallback(
    async (texto) => {
      const r = await fetch(urlDeFichas(texto, JSON.parse(clave)), { cache: "no-store" });
      if (!r.ok) return { items: [], total: 0 };
      const j = await r.json();
      return { items: j?.data?.clients || [], total: j?.data?.total ?? 0 };
    },
    [clave]
  );

  const traerUna = useCallback(async (idFicha) => {
    // La ficha ENTERA, no solo su nombre: quien la pide puede necesitar su
    // razón social o su NIF, y volver a pedirla sería otra vuelta al servidor.
    const r = await fetch(`/api/clients/${idFicha}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.data ?? null;
  }, []);

  return (
    <SelectorRemoto
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      onElegida={onFicha}
      buscar={buscar}
      traerUna={traerUna}
      etiqueta={etiqueta || ((c) => c.name)}
      plural="fichas"
      dondeSeCrean="Clientes"
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      opcionesFijas={opcionesFijas}
    />
  );
}
