/**
 * lib/citas/puertaIdentidad.js — sin cuenta no se reserva (05/08/2026).
 *
 * (Fichero nuevo en /lib, regla #2: la comparten `/info`, que la anuncia por
 * delante, y `/book`, que la aplica — mismo reparto que `puertaFormulario` y
 * `puertaContrato`.)
 *
 * ── EL AGUJERO QUE TAPA ─────────────────────────────────────────────────────
 * Existía un «gate» desde hace tiempo (`settings.widget.auth.required`) y era
 * DECORATIVO: el widget pedía `?wpa=1` en la URL y, si no estaba, enseñaba un
 * cartel de «inicia sesión». Pero ese parámetro
 *
 *   · lo pone quien abre la URL, así que se salta escribiéndolo a mano, y
 *   · el servidor NO LO MIRABA EN NINGÚN SITIO: un POST a `/book` creaba la
 *     cita sin sesión de nada.
 *
 * La página /citas/ de WordPress sí exigía login, pero el widget del CRM es una
 * URL pública: cualquiera que la conociera reservaba, y esa cita entraba sin
 * paciente detrás porque no había ficha a la que enlazarla.
 *
 * ── QUÉ CUENTA COMO IDENTIFICARSE ───────────────────────────────────────────
 * Una sesión de portal verificada: WordPress firma un token con el correo de
 * quien ha iniciado sesión (`?wpsso=`, TTL 5 min) y el CRM lo canjea por su
 * propia sesión (`lib/citas/portalSession.js`). Es lo ÚNICO que vale, porque es
 * lo único que no se puede fabricar desde el navegador. El correo va firmado
 * dentro, así que tampoco se puede reservar en nombre de otra.
 *
 * ── LA VALORACIÓN INICIAL NO SE SALTA ESTA PUERTA ───────────────────────────
 * Se salta la de CONTRATOS, que es otra cosa: a la primera visita se entra sin
 * firmar nada porque todavía no ha decidido empezar. Pero cuenta tiene que
 * tener — si no, la cita nace huérfana y hay que crearle la ficha a mano
 * adivinando quién es.
 *
 * ⚠️ Apagada por defecto, como sus hermanas: un centro que reparta el enlace de
 * su agenda por WhatsApp sin tener área privada montada se quedaría sin poder
 * dar una sola cita.
 */

/** ¿Este centro exige tener cuenta para reservar? (default: no) */
export function exigeIdentidad(tenant) {
  if (tenant?.settings?.citas?.identidadObligatoria === true) return true;
  // Compatibilidad: el interruptor viejo del widget. Nadie lo tenía encendido
  // cuando esto se escribió (comprobado en producción), pero si alguien lo
  // enciende esperando que sirva de algo, ahora sirve.
  return tenant?.settings?.widget?.auth?.required === true;
}

/** A dónde se le manda a iniciar sesión, si el centro lo tiene configurado. */
export function urlDeAcceso(tenant) {
  const widget = tenant?.settings?.widget?.auth ?? {};
  const portal = tenant?.settings?.citas?.portalUrl;
  return widget.loginUrl || portal || null;
}

/**
 * El aviso que se le enseña a quien llega sin identificar.
 *
 * Dice qué hacer, no qué ha fallado: quien lo lee no ha hecho nada malo, ha
 * entrado por un enlace suelto. Y NO se le cuenta si su correo existe o no
 * —ni se le pregunta—: este endpoint es público y anónimo.
 */
export function mensajeSinIdentidad(tenant) {
  const url = urlDeAcceso(tenant);
  const nombre = tenant?.name ? ` de ${tenant.name}` : "";
  return url
    ? `Para pedir cita necesitas entrar en tu área privada${nombre}. Inicia sesión en ${url} y vuelve a intentarlo.`
    : `Para pedir cita necesitas entrar en tu área privada${nombre} con tu cuenta.`;
}
