/**
 * Lo que el paciente acepta cuando deja su tarjeta.
 *
 * ── POR QUÉ ESTO EXISTE ──────────────────────────────────────────────────────
 * Con retención, el banco del paciente le enseña el importe como cargo PENDIENTE
 * y muchos bancos no lo distinguen de un cobro. Sin una frase clara aceptada por
 * él, la primera reacción es "me han cobrado sin confirmarme la cita", y eso
 * acaba en una llamada, una reclamación al banco o un chargeback.
 *
 * Se guarda PRUEBA de la aceptación (versión, fecha, IP e importe) en
 * `PaymentSession.metadata`. Eso convierte esa llamada en una conversación de un
 * minuto: se puede decir exactamente qué leyó, cuándo y por cuánto.
 *
 * El texto y su versión viven AQUÍ, en un solo sitio, porque los usan el
 * navegador (para enseñarlo) y el servidor (para archivar qué se aceptó). Si
 * cada uno tuviera el suyo, acabaríamos archivando la aceptación de un texto
 * distinto del que se leyó — que es no tener prueba de nada.
 *
 * Al cambiar el texto, SUBIR la versión. Las aceptaciones viejas conservan la
 * suya, así que siempre se puede saber qué leyó cada persona.
 */

export const VERSION_CONSENTIMIENTO = "retencion-2026-07-29";

/** Importe en céntimos → "45,00 €". */
function euros(centimos) {
  return (centimos / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

/**
 * Las frases que se le enseñan, con el importe dentro. Devuelve un array para
 * que quien lo pinte decida el formato, pero el CONTENIDO es siempre este.
 */
export function textoConsentimiento(importeCentimos) {
  const i = euros(importeCentimos);
  return [
    `Al reservar, tu banco retendrá ${i} en tu tarjeta. No es un cobro.`,
    `Solo se te cobrará cuando se confirme la cita.`,
    `Si no se confirma, la retención se libera sola y no tienes que hacer nada.`,
  ];
}

/** Lo que se archiva como prueba. Nunca incluye datos de la tarjeta. */
export function pruebaDeConsentimiento({ importeCentimos, ip = null }) {
  return {
    version: VERSION_CONSENTIMIENTO,
    aceptadoEn: new Date().toISOString(),
    importe: importeCentimos,
    texto: textoConsentimiento(importeCentimos),
    ip,
  };
}
