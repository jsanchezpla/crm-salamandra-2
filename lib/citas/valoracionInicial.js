/**
 * Valoración inicial: quién puede pedirla y quién ya no.
 *
 * Regla, decidida con el cliente (05/08/2026): **la valoración inicial se ofrece
 * una sola vez en la vida**. Es la primera visita — quien ya la tuvo pide una
 * cita normal.
 *
 * ── QUÉ CUENTA COMO «YA LA TUVO» ────────────────────────────────────────────
 * Cualquier valoración que NO esté cancelada: confirmada, realizada o incluso
 * no asistida. Las dos alternativas se descartaron por lo que hacen con
 * personas reales:
 *
 *   · Contar solo las COMPLETADAS dejaría que quien no se presenta la reserve
 *     una y otra vez, que es justo el hueco caro de la agenda.
 *   · Contar también las CANCELADAS castigaría a quien anuló por un imprevisto:
 *     se quedaría sin poder pedirla nunca más y solo podría arreglarlo el
 *     centro a mano.
 *
 * Un `no_show` sí cuenta: el hueco se dio y se perdió. Si el centro quiere
 * darle otra oportunidad, cancela esa cita y vuelve a estar disponible — que es
 * una acción que ya existe y se entiende.
 *
 * ── UNA SOLA FUENTE DE VERDAD ───────────────────────────────────────────────
 * Este helper lo consumen las DOS superficies donde aparece la opción: el
 * listado de tipos de cita del widget y los botones de «Rellenar documentos».
 * El cliente detectó que ocultarla en una y no en la otra la dejaba accesible,
 * así que no se duplica la condición en ninguna vista: se pregunta aquí.
 *
 * Y el servidor CORTA además en `/book`: esconder el botón no es suficiente
 * cuando ya se han encontrado dos caminos alternativos.
 */

import { Op } from "sequelize";

/** Estados que dejan la valoración «gastada». Cancelar la devuelve. */
export const CUENTAN_COMO_TENIDA = ["pending", "confirmed", "completed", "no_show"];

/** ¿Es este tipo de cita la valoración inicial del centro? */
export function esValoracionInicial(eventType) {
  return eventType?.isInitialAssessment === true;
}

/**
 * ¿Puede esta persona reservar la valoración inicial?
 *
 * Se busca por EMAIL, que es lo único que compartimos con una reserva pública
 * —igual que la puerta de admisión y el portal—, y con `iLike` porque nadie
 * escribe su correo dos veces igual.
 *
 * @returns {Promise<{puede: boolean, motivo: string}>}
 *   motivo: "sin_valoracion" (puede) · "ya_la_tuvo" · "no_hay_tipo" ·
 *           "sin_datos" (no se pudo comprobar → se DEJA pasar, ver abajo)
 */
export async function puedeReservarValoracionInicial(tenantModels, email) {
  const { Booking, EventType } = tenantModels ?? {};
  if (!Booking || !EventType) return { puede: true, motivo: "sin_datos" };

  const limpio = typeof email === "string" ? email.trim() : "";
  if (!limpio) return { puede: true, motivo: "sin_datos" };

  try {
    const tipo = await EventType.findOne({
      where: { isInitialAssessment: true },
      attributes: ["id"],
    });
    // Un centro que no ha marcado ninguna valoración inicial no tiene nada que
    // limitar: no es un error, es que no usa esa figura.
    if (!tipo) return { puede: true, motivo: "no_hay_tipo" };

    const yaTuvo = await Booking.count({
      where: {
        eventTypeId: tipo.id,
        clientEmail: { [Op.iLike]: limpio },
        status: { [Op.in]: CUENTAN_COMO_TENIDA },
      },
    });

    return yaTuvo > 0
      ? { puede: false, motivo: "ya_la_tuvo" }
      : { puede: true, motivo: "sin_valoracion" };
  } catch (err) {
    // Se DEJA PASAR ante un fallo, al revés que la puerta del formulario.
    // Aquí lo peor que ocurre es una primera visita de más, que el centro ve y
    // cancela; cerrar por un error de lectura dejaría sin poder entrar a quien
    // nunca ha venido, que es exactamente a quien se quiere captar.
    process.stderr.write(`[valoracion-inicial] no se pudo comprobar: ${err.message}\n`);
    return { puede: true, motivo: "sin_datos" };
  }
}

/** Lo que se le responde a quien la pide teniéndola ya. */
export function mensajeValoracionUsada(nombreCentro = null) {
  const quien = nombreCentro ? ` de ${nombreCentro}` : "";
  return {
    codigo: "VALORACION_YA_REALIZADA",
    titulo: "Ya has hecho tu primera visita",
    texto:
      `La valoración inicial es solo para la primera vez. Elige cualquiera de las otras citas, ` +
      `y si crees que es un error escríbele al equipo${quien}.`,
  };
}
