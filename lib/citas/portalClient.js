/**
 * lib/citas/portalClient.js — resuelve la FICHA de cliente del paciente que
 * entra al portal.
 *
 * La sesión del portal solo lleva el EMAIL (viene del SSO de WordPress). Las
 * citas se cruzan por `bookings.client_email`, pero los documentos cuelgan de la
 * ficha (`clients`), así que hace falta este salto email → Client.
 *
 * Comparación case-insensitive con el email ya normalizado (igual que hace el
 * resto del portal): quien reserva puede haber escrito el correo con otras
 * mayúsculas que quien creó la ficha.
 *
 * Devuelve la fila de Client o null. No lanza.
 */
import { Op } from "sequelize";

export async function resolvePortalClient(tenantModels, email) {
  try {
    if (!email) return null;
    const { Client } = tenantModels;
    if (!Client) return null;
    return await Client.findOne({
      where: { email: { [Op.iLike]: email } },
      attributes: ["id", "name", "email"],
    });
  } catch {
    return null;
  }
}
