"use client";

// components/clients/AvisoSinContacto.jsx — el chip que avisa de que a esta
// familia no se la puede avisar.
//
// ── DE DÓNDE SALE (Jorge, 28/08/2026, por Lau de Aumenta) ───────────────────
//
// En producción hay **102 familias vivas de Aumenta sin teléfono ni correo en
// ningún sitio** —ni en la ficha, ni en los tutores, ni en la pestaña de
// contactos— y otras 210 activas sin correo, que son las que no pueden entrar
// al área privada. A esas no se les puede mandar ni un recordatorio de cita ni
// una factura.
//
// Ese dato no lo inventa el CRM: se perdió al traer las fichas de Organízate y
// hay que pedírselo a la familia. Lo que sí puede hacer el CRM es **decirlo en
// el sitio donde alguien va a poder arreglarlo**, que es la propia ficha, en vez
// de esconderlo en un recuento de «Fichas a completar» al que no entra nadie.
//
// ── POR QUÉ UN COMPONENTE Y NO CUATRO LÍNEAS EN LA FICHA ───────────────────
//
// Porque hay DOS fichas: la base y la propia de `nutri_laura`. Escribirlo solo
// en la base dejaría a la otra sin el aviso y en silencio, que es exactamente la
// deriva que describe la escalera del CLAUDE.md.
//
// Y la decisión —qué falta y cuánto duele— no vive aquí sino en
// `lib/clients/contactoDeFicha.js` (`avisoFaltaContacto`), con su prueba. Este
// fichero solo pinta: así el día que cambie la regla no hay que acordarse de
// dos pantallas.

import { avisoFaltaContacto } from "../../lib/clients/contactoDeFicha.js";

/**
 * Chip de aviso para la cabecera de una ficha. `null` cuando la familia es
 * localizable, que es el caso normal.
 *
 * @param {{client: object}} props  la ficha tal cual la devuelve
 *   `/api/clients/[id]`. Hace falta que traiga `guardians`, o un contacto que
 *   solo esté en un tutor se contaría como ausente.
 */
export default function AvisoSinContacto({ client }) {
  const aviso = avisoFaltaContacto(client);
  if (!aviso) return null;

  const tono = aviso.grave ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800";
  const punto = aviso.grave ? "bg-red-500" : "bg-amber-500";

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${tono}`}
      title={aviso.explicacion}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${punto}`} />
      Sin {aviso.falta}
    </span>
  );
}
