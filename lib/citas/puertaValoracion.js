/**
 * puertaValoracion — a la PRIMERA visita solo se llega por el formulario.
 *
 * POR QUÉ EXISTE, SI YA HAY UNA PUERTA DE ADMISIÓN
 * `puertaFormulario.js` exige el formulario para TODAS las citas: enciéndela y
 * el paciente de siempre que quiere una revisión de seguimiento se come un 403.
 * Esta lo pide solo delante de la valoración inicial, que es donde tiene
 * sentido: la primera visita es la que trae a alguien que el centro no conoce,
 * y es justo la que hoy entra sin enseñar nada.
 *
 * PORQUE HOY NO ENSEÑA NADA. La valoración inicial está EXIMIDA a propósito de
 * las dos puertas que quedaban: no firma contrato (es lo que la define, se
 * entra sin papeles) y no pasa por caja cuando el centro la da gratis. Con la
 * admisión global apagada —como está—, lo único que la protege es el «una sola
 * vez por persona», y ese se cruza por el correo que escribe quien manda la
 * petición. Un correo distinto cada vez y la agenda se llena de primeras
 * visitas que nadie ha pedido.
 *
 * DOS DECISIONES QUE SOSTIENEN EL RESTO
 *
 * 1. APAGADA POR DEFECTO. El módulo `citas` lo comparten cuatro clientes y solo
 *    uno tiene formulario. Encender esto de fábrica dejaría la valoración
 *    inicial IRRESERVABLE en los otros tres el día que marcasen la casilla —el
 *    botón prometiendo algo que el servidor niega—. Se enciende quien tiene
 *    dónde mandar a la gente.
 *
 * 2. SI NO HAY DÓNDE MANDARLE, SE DEJA PASAR. Sin módulo de formularios o sin
 *    URL configurada, la puerta se abre. Cerrar sin dar salida no protege a
 *    nadie: convierte una reserva en un callejón sin instrucciones, y quien la
 *    quería se va a otro sitio. La única excepción es no poder LEER la bandeja,
 *    que se hereda de `estadoDeAdmision` y ahí sí cierra —si no se sabe quién
 *    ha sido admitido, dejar pasar sería admitir a cualquiera—.
 *
 * La decisión vive aquí y solo aquí: la comparten el corte de `/book`, lo que
 * anuncia `/info` y lo que pinta el portal. Tres sitios comprobando lo mismo por
 * su cuenta es como se llega a un botón que promete lo que el servidor niega.
 */

import { admitido, estadoDeAdmision, urlDelFormulario } from "./puertaFormulario.js";

/**
 * ¿Este centro exige el formulario ANTES de la primera visita?
 *
 * Apagado por defecto: solo cuenta el `true` explícito.
 */
export function exigeFormularioParaValoracion(tenant) {
  return tenant?.settings?.citas?.valoracionSoloConFormulario === true;
}

/**
 * ¿Puede esta persona reservar la primera visita?
 *
 * Devuelve `{ puede, estado }`. `estado` es el mismo vocabulario que la puerta
 * de admisión ("aceptada" | "pendiente" | "rechazada" | "sin_solicitud" |
 * "sin_bandeja"), para que el mensaje se pueda escribir en un solo sitio.
 *
 * @param {object} tenant
 * @param {object} opciones
 * @param {boolean} opciones.tieneFormularios  módulo `formularios` activo
 * @param {object}  opciones.tenantModels      modelos del tenant (bandeja + fichas)
 * @param {string}  opciones.email             correo de quien reserva
 */
export async function puedePedirValoracion(tenant, { tieneFormularios, tenantModels, email }) {
  if (!exigeFormularioParaValoracion(tenant)) return { puede: true, estado: "no_aplica" };

  // Sin bandeja donde mirar o sin formulario al que mandarle: se deja pasar.
  // Ver la decisión 2 de la cabecera.
  if (!tieneFormularios || !urlDelFormulario(tenant)) {
    return { puede: true, estado: "sin_donde_mandarle" };
  }

  // `admitido` y no `=== "aceptada"`: quien viene marcado como profesional está
  // exento del formulario en las dos puertas, no solo en la global. Es lo que se
  // decidió el 12/08 y partirlo por la mitad dejaría al mismo correo pasando por
  // una y chocándose con la otra.
  const estado = await estadoDeAdmision(tenantModels, email);
  return { puede: admitido(estado), estado };
}
