/**
 * «¿A qué entras hoy?» — cuándo se pregunta y cuándo ya no.
 *
 * ── LA DECISIÓN ES UNA SOLA VEZ (06/08/2026, Rodrigo) ───────────────────────
 * La pantalla ofrece dos caminos que son alternativos, no un menú permanente:
 *
 *   · «Vengo a una valoración inicial» → reserva su primera consulta SIN
 *     firmar nada. Es la puerta de quien todavía no ha decidido si empieza.
 *   · «Entro a mi perfil» → firma los documentos y a partir de ahí pide el tipo
 *     de cita que quiera, valoración incluida.
 *
 * En cuanto ha tirado por uno de los dos, preguntar otra vez es devolverla a
 * una casilla de salida por la que ya pasó. Y era exactamente lo que ocurría:
 * alguien que acababa de firmar TODOS sus documentos volvía a la agenda y se
 * encontraba de nuevo «¿a qué entras hoy?», porque lo único que se miraba era
 * si tenía reservada una valoración.
 *
 * Ya ha decidido si se cumple CUALQUIERA de estas:
 *   1. tiene alguna cita —la que sea, próxima o pasada—: eligió al reservarla;
 *   2. ha terminado de firmar: eso ES haber elegido el perfil;
 *   3. el centro no tiene ninguna valoración inicial configurada, y entonces la
 *      pregunta no existe.
 *
 * Vive en /lib y no dentro de una pantalla porque lo preguntan DOS —la agenda y
 * el área privada— y tienen que contestar lo mismo. Con la condición escrita en
 * cada una, la primera vez que cambie quedarán discrepando.
 */

/**
 * ¿Ha terminado de firmar lo que le tocaba?
 *
 * `documentosPendientes` es la cuenta del contrato estructurado; `requiereFirma`
 * cubre el contrato simple de siempre. Sin ficha todavía (`motivo: "sin-ficha"`)
 * no ha firmado nada: es alguien que acaba de llegar.
 */
export function haFirmadoTodo(contrato) {
  if (!contrato || contrato.motivo === "sin-ficha") return false;
  if (contrato.requiereFirma) return false;
  if (contrato.estructurado) return (contrato.documentosPendientes ?? 0) === 0 && !!contrato.yaFirme;
  return !!contrato.yaFirme || !!contrato.contratoCompleto;
}

/**
 * ¿Hay que enseñarle «¿A qué entras hoy?»?
 *
 * @param {object} opciones
 * @param {object|null} opciones.valoracion  tipo de cita marcado como valoración inicial
 * @param {Array}       opciones.citas       TODAS sus citas (próximas + historial)
 * @param {object|null} opciones.contrato    respuesta de `citas-portal/contract`
 */
export function debePreguntarBienvenida({ valoracion, citas, contrato }) {
  if (!valoracion) return false;
  if (Array.isArray(citas) && citas.length > 0) return false;
  if (haFirmadoTodo(contrato)) return false;
  return true;
}

/**
 * ¿Se le sigue ofreciendo la valoración inicial como tipo de cita?
 *
 * Deja de ofrecerse en cuanto tiene CUALQUIER cita, no solo cuando ya tuvo una
 * valoración (Rodrigo, 06/08/2026: «una vez pidas valoración inicial o te
 * decantes directamente por pedir cualquier otro tipo de cita, la valoración
 * inicial dejará de estar disponible»). Es una consulta para conocerse: quien
 * ya ha pasado por la agenda del centro, aunque fuera para un acompañamiento,
 * ya no está en ese momento.
 *
 * Ojo: esto es lo que se ENSEÑA. Quien de verdad lo impide es el servidor al
 * reservar (`puedeReservarValoracionInicial`).
 */
export function ofreceValoracionInicial(citas) {
  return !(Array.isArray(citas) && citas.length > 0);
}
