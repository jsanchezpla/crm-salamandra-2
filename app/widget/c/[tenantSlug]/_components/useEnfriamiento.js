"use client";

/**
 * Enfriamiento del botón principal al cambiar de pantalla (06/08/2026, Rodrigo).
 *
 * ── QUÉ PASABA ──────────────────────────────────────────────────────────────
 * El recorrido del área privada es una pantalla detrás de otra —datos,
 * consentimiento parental, contrato, comunicaciones— y todas ponen su botón
 * principal más o menos en el mismo sitio. Con un doble clic sin querer, el
 * primero avanzaba y el segundo caía sobre el botón de la pantalla SIGUIENTE,
 * que ya estaba pintada debajo del cursor. Rodrigo se saltó el contrato entero
 * así, sin verlo.
 *
 * Medio segundo de enfriamiento al montar cada pantalla lo corta: es
 * imperceptible cuando se pulsa a propósito e imposible de atravesar con el
 * rebote de un doble clic.
 *
 * No sustituye a ninguna comprobación del servidor —firmar sigue exigiendo lo
 * que exigía—: esto solo evita que la pantalla se salte SOLA.
 */

import { useEffect, useState } from "react";

const POR_DEFECTO_MS = 500;

/** @returns {boolean} `true` cuando ya se puede pulsar. */
export function useEnfriamiento(ms = POR_DEFECTO_MS) {
  const [listo, setListo] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setListo(true), ms);
    return () => clearTimeout(t);
  }, [ms]);

  return listo;
}
