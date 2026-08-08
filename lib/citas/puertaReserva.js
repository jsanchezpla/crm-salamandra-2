/**
 * lib/citas/puertaReserva.js — hay centros que no dan cita por internet.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten los CUATRO endpoints públicos
 * de la agenda, `/info` —que lo anuncia por delante— y las dos pantallas del
 * widget que dependen de ellos. Mismo reparto que `puertaIdentidad`,
 * `puertaFormulario` y `puertaContrato`.)
 *
 * ── QUÉ TAPA ────────────────────────────────────────────────────────────────
 * La agenda pública de un centro estaba abierta por el mero hecho de tener el
 * módulo de citas contratado. Nadie la había enlazado desde la web de Aumenta,
 * pero eso no cierra nada: `/widget/c/aumenta` respondía a cualquiera que
 * conociera la dirección, y su catálogo entregaba los 57 tipos de cita del
 * centro con sus nombres internos («CUOTA LOGOPEDIA 30», «SESIONES A
 * DOMICILIO 60»…). No poner el enlace es maquetación; esto es una puerta.
 *
 * ── POR QUÉ NO VALÍA NINGUNA DE LAS PUERTAS QUE YA HABÍA ────────────────────
 * `soloConPago` parecía el atajo y no lo es: la valoración inicial se lo salta
 * a propósito, y además no cierra ni la página ni el catálogo —la familia
 * vería los 57 tipos y el calendario entero, y solo se llevaría el error al
 * final, después de rellenar sus datos—. Las otras tres (identidad, admisión,
 * contrato) filtran QUIÉN reserva, no SI se reserva.
 *
 * ── LO QUE ESTO **NO** CIERRA ───────────────────────────────────────────────
 * El área privada de la familia. Vive en la misma carpeta
 * (`/widget/c/[slug]/mi-perfil`) pero se alimenta de otros endpoints, bajo
 * `/citas-portal/`, cada uno con su sesión firmada. Comprobado: lo único del
 * perfil que toca la agenda es una consulta al catálogo para localizar la
 * valoración inicial, y está escrita para tolerar que falle —se queda en null y
 * sigue—. El efecto es que la pantalla «¿A qué entras hoy?» deja de aparecer,
 * que es justo lo que se quiere en un centro que no da cita por internet.
 *
 * ⚠️ Apagada por defecto, como sus hermanas: si naciera encendida, cualquier
 * cliente que hoy vive de su agenda pública se quedaría sin poder dar una sola
 * cita en el mismo despliegue, y sin ningún error que lo delatara.
 */

/** ¿Este centro tiene cerrada la reserva por internet? (default: no) */
export function reservaOnlineCerrada(tenant) {
  return tenant?.settings?.citas?.reservaOnlineCerrada === true;
}

/**
 * Qué se le dice a quien llega a la agenda de un centro que no da cita online.
 *
 * Dice qué hacer, no qué ha fallado: quien abre esa dirección no ha hecho nada
 * raro. Y se le da una salida —su web, o el teléfono si está configurado—,
 * porque una pantalla que solo dice «no» convierte a alguien que quería pedir
 * cita en alguien que se va.
 */
export function mensajeReservaCerrada(tenant) {
  const centro = tenant?.name ? ` de ${tenant.name}` : "";
  const tel = tenant?.settings?.phone || tenant?.settings?.citas?.telefono || null;
  return tel
    ? `Las citas${centro} se piden directamente con el centro. Llámanos al ${tel} y te damos hora.`
    : `Las citas${centro} se piden directamente con el centro. Ponte en contacto con nosotros y te damos hora.`;
}

/**
 * A dónde mandar a esa persona.
 *
 * Se reutiliza `reservaUrl` —la página de reservas de la web del cliente— si la
 * tiene puesta, y si no la portada del portal. Devuelve null cuando no hay
 * ninguna, y entonces la pantalla se limita al mensaje sin botón: mejor eso que
 * un botón que no lleva a ningún sitio.
 */
export function urlDeContacto(tenant) {
  const citas = tenant?.settings?.citas ?? {};
  const url = citas.reservaUrl || citas.portalUrl || null;
  if (!url) return null;
  try {
    return new URL(String(url)).origin;
  } catch {
    return null;
  }
}
