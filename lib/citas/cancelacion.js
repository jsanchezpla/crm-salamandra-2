import { telefonoDelCentro } from "../tenant/datosCentro.js";
/**
 * lib/citas/cancelacion.js — el centro decide si la familia puede anular sola.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten los DOS endpoints públicos que
 * cancelan, la pantalla previa del enlace del correo, el serializer que pinta el
 * botón y los cuatro sitios que meten el enlace en los correos. Mismo reparto
 * que `puertaIdentidad` y `puertaContrato`: una decisión, un fichero.)
 *
 * ── POR QUÉ HACE FALTA ──────────────────────────────────────────────────────
 * Aumenta gestiona TODAS sus citas en el centro y pidió que su área privada sea
 * de consulta: la familia mira, descarga y firma, pero no anula. Hasta hoy no
 * existía forma de decir eso: la cancelación por la familia solo miraba el
 * módulo `citas`, así que estaba encendida para todo el que lo tuviera.
 *
 * ── EL AGUJERO QUE TAPA, QUE ES MÁS GORDO DE LO QUE PARECÍA ─────────────────
 * No es solo el botón del área privada. El correo de confirmación de CADA cita
 * lleva un «¿No puedes asistir? Cancela aquí», y ese enlace:
 *
 *   · cancela SIN iniciar sesión y sin comprobar de quién es la cita —quien
 *     tenga el enlace, cancela; reenviar el correo es dar la llave—, y
 *   · NO CADUCA: el token vive en la fila de la cita, sin fecha de expiración,
 *     así que los correos ya enviados siguen siendo llaves válidas mientras la
 *     cita sea futura.
 *
 * Lo segundo es importante para entender el alcance: bloquear la cancelación
 * corta los enlaces FUTUROS y cierra el endpoint, con lo que los enlaces
 * antiguos dejan de funcionar. Pero si alguna vez se desbloquea, vuelven a
 * valer. No se pueden «revocar» de otra forma que rotando el token, que hoy no
 * hace nadie.
 *
 * ── POR QUÉ EL NOMBRE ESTÁ EN NEGATIVO ──────────────────────────────────────
 * `cancelacionBloqueada` y no `cancelacionPermitida`, a propósito. Los doce
 * ajustes hermanos de `settings.citas.*` se leen todos con `=== true` y nacen
 * APAGADOS. Si este se llamara en positivo habría que leerlo con `!== false`
 * para que el default fuera «sí se puede», y esa sería la única excepción de la
 * familia: el día que alguien la «arregle» para dejarla como sus hermanas,
 * apagaría la cancelación de TODOS los centros —nutri_laura incluida, que sí la
 * usa con pacientes reales— en silencio y sin ningún error. Con el nombre en
 * negativo, todos leen `=== true` y el default sigue siendo el de siempre.
 *
 * ── DÓNDE **NO** VA ESTE GUARDIÁN ───────────────────────────────────────────
 * En `lib/citas/cancelBooking.js` NO, aunque parezca el embudo. Ese fichero lo
 * comparten los dos endpoints públicos con el panel interno, y hay seis sitios
 * en el repo que marcan una cita como cancelada. Metiendo el candado ahí, el
 * día que el panel reutilice esa función, el propio centro no podría anular sus
 * citas desde el CRM. Esto bloquea a la FAMILIA, nunca al equipo.
 */

/** ¿Este centro impide que la familia anule sus citas? (default: no) */
export function cancelacionBloqueada(tenant) {
  return tenant?.settings?.citas?.cancelacionBloqueada === true;
}

/**
 * El enlace de «Cancela aquí» de los correos, o null si el centro lo bloquea.
 *
 * Devolver null es suficiente para que desaparezca de los correos: las cuatro
 * plantillas ya lo pintan solo `if (ctx.cancelUrl)`. Por eso el candado va
 * aquí y no en cada plantilla.
 *
 * `baseUrl` es opcional porque no todos los que lo llaman la tienen: los
 * correos que salen de una petición usan una ruta relativa y el recordatorio,
 * que sale de un proceso en segundo plano, necesita la absoluta.
 */
export function enlaceCancelacion(tenant, { baseUrl = "", slug, token }) {
  if (!token || !slug) return null;
  if (cancelacionBloqueada(tenant)) return null;
  const base = baseUrl ? String(baseUrl).replace(/\/+$/, "") : "";
  return `${base}/widget/c/${slug}/cancel/${token}`;
}

/**
 * Qué se le dice a quien intenta anular en un centro que no lo permite.
 *
 * Dice qué hacer, no qué ha fallado: quien llega aquí no ha hecho nada raro,
 * ha pulsado un enlace que le mandamos nosotros hace semanas. Y se le da una
 * salida concreta —el teléfono del centro si está configurado— porque dejarle
 * con un «no se puede» y sin alternativa acaba en una cita a la que no viene
 * nadie, que es justo lo que esto intenta evitar.
 */
export function mensajeCancelacionBloqueada(tenant) {
  const centro = tenant?.name ? ` de ${tenant.name}` : "";
  // Los tres sitios donde ha ido cayendo el teléfono del centro, en un solo
  // lector (28/08/2026): desde hoy hay pantalla para ponerlo —Configuración →
  // Datos del centro— y antes solo se podía dejar a mano en la base, así que
  // este mensaje salía casi siempre sin número.
  const tel = telefonoDelCentro(tenant) || null;
  return tel
    ? `Las citas${centro} se gestionan directamente con el centro. Llámanos al ${tel} y lo cambiamos contigo.`
    : `Las citas${centro} se gestionan directamente con el centro. Ponte en contacto con nosotros y lo cambiamos contigo.`;
}
