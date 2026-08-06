/**
 * Lo que se lleva por delante borrar a un paciente (06/08/2026, Rodrigo).
 *
 * Borrar una ficha ya arrastraba lo que cuelga de ella por CASCADE (adjuntos,
 * notas, contactos, firmas del contrato). Faltaban dos cosas que la base de
 * datos dejaba sueltas con la FK a NULL, y las dos tenían consecuencias:
 *
 *   · LOS DOCUMENTOS quedaban huérfanos. Los ficheros seguían en disco, sin
 *     ficha a la que colgarse: no los veía la paciente ni los veía nadie del
 *     centro. Papeles de salud sin dueño ocupando sitio para siempre. Se borran,
 *     fila y fichero.
 *   · LAS CITAS FUTURAS seguían en la agenda de una persona que ya no es
 *     paciente, ocupando un hueco que nadie más podía coger. Se borran, y a
 *     quien las tuviera se le manda el aviso de cancelación de siempre: sin él,
 *     alguien con cita el jueves se presentaba a una hora que ya no existía.
 *
 * ── LAS PASADAS NO SE TOCAN ────────────────────────────────────────────────
 * Decisión de Rodrigo, y es la parte importante: **las citas pasadas se quedan
 * como prueba del trabajo hecho**. Son la constancia de que esa consulta
 * ocurrió: sostienen lo facturado y lo que se atendió. Perderlas al dar de baja
 * a alguien sería borrar el historial de la profesional, no el del paciente.
 *
 * El corte es la HORA ACTUAL, no el día: una cita de esta misma mañana ya
 * ocurrió y se queda; la de esta tarde, no.
 *
 * Best-effort a propósito. Si algo de esto falla, el borrado de la ficha sigue
 * adelante: dejar a la profesional sin poder dar de baja a nadie porque un
 * fichero no se pudo desenlazar sería peor que el rastro que se intenta limpiar.
 * Devuelve el recuento para que quede en la auditoría.
 */

import { Op } from "sequelize";
import { deleteDocumentFile } from "../documents/documentStorage.js";
import { emailCancelacionAlCliente } from "../citas/notificarCancelacion.js";
import { isDemoTenant } from "../demo/isDemo.js";

/**
 * @param {object} opciones
 * @param {object} opciones.tenantModels
 * @param {object} opciones.tenant        el tenant entero: hace falta para el
 *                                        correo de cancelación (nombre, marca y
 *                                        credenciales de envío propias)
 * @returns {Promise<{documentos:number, citasFuturas:number, avisadas:number}>}
 */
export async function borrarRastroDelCliente({ tenantModels, tenant, clientId, clientEmail }) {
  const cuenta = { documentos: 0, citasFuturas: 0, avisadas: 0 };
  if (!clientId) return cuenta;
  const tenantSlug = tenant?.slug;

  // ── Documentos: primero el fichero, luego la fila ─────────────────────────
  try {
    const { Document } = tenantModels;
    if (Document) {
      const suyos = await Document.findAll({
        where: { clientId },
        attributes: ["id", "storagePath"],
      });
      for (const doc of suyos) {
        if (doc.storagePath) await deleteDocumentFile(tenantSlug, doc.storagePath);
      }
      if (suyos.length) {
        cuenta.documentos = await Document.destroy({ where: { clientId } });
      }
    }
  } catch (err) {
    process.stderr.write(`[borrar-rastro] documentos: ${err.message}\n`);
  }

  // ── Citas futuras ─────────────────────────────────────────────────────────
  // Por ficha Y por correo: una cita puede haberse reservado antes de que
  // existiera la ficha (la valoración inicial se pide sin dar datos), y
  // entonces `client_id` viene vacío y lo único que la ata a esa persona es el
  // correo con el que la pidió.
  try {
    const { Booking } = tenantModels;
    if (Booking) {
      const dueña = [{ clientId }];
      if (clientEmail) dueña.push({ clientEmail: { [Op.iLike]: String(clientEmail) } });
      const where = { [Op.or]: dueña, scheduledAt: { [Op.gt]: new Date() } };

      /*
       * EL AVISO DE CANCELACIÓN VA ANTES DE BORRAR (06/08/2026, Rodrigo).
       *
       * Se cargan las citas para poder avisar: una vez borradas no hay a quién
       * escribir. Sin esto, alguien con cita el jueves se presentaba en la
       * consulta a una hora que ya no existía.
       *
       * Es el MISMO correo que manda el centro al cancelar desde el panel
       * —«tu cita ha sido cancelada»—, sin motivo escrito: el porqué de una baja
       * es una conversación de la consulta, no una línea en un correo
       * automático.
       *
       * No se avisa de las que ya estaban canceladas (sería un aviso duplicado
       * de algo que esa persona ya sabe) ni desde la demo pública, que da sesión
       * de admin a cualquiera y convertiría el borrado en un relé de correo.
       */
      const futuras = await Booking.findAll({ where });
      if (tenant && !isDemoTenant(tenant)) {
        for (const cita of futuras) {
          if (cita.status === "cancelled") continue;
          // Nunca lanza: un correo caído no puede impedir dar de baja a nadie.
          await emailCancelacionAlCliente({ tenant, tenantModels, booking: cita, reason: null });
          if (cita.clientEmail) cuenta.avisadas += 1;
        }
      }

      cuenta.citasFuturas = await Booking.destroy({ where });
    }
  } catch (err) {
    process.stderr.write(`[borrar-rastro] citas futuras: ${err.message}\n`);
  }

  return cuenta;
}
