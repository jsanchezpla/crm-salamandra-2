/**
 * lib/citas/portalClient.js — resuelve la FICHA de cliente del paciente que
 * entra al portal.
 *
 * La sesión del portal solo lleva el EMAIL (viene del SSO de WordPress). Las
 * citas se cruzan por `bookings.client_email`, pero los documentos cuelgan de la
 * ficha (`clients`), así que hace falta este salto email → Client.
 *
 * DOS CAMINOS (sprint 2026-07-29, punto 1.2 — familias con dos tutores):
 *   1. `clients.email` — el de siempre.
 *   2. Cualquier tutor de `clients.guardians` con ese email.
 *
 * El segundo camino es lo que permite que el padre Y la madre entren cada uno
 * con SU correo y vean la misma familia, que es el caso de los separados. Se
 * devuelve además QUÉ tutor ha entrado, porque de eso depende a quién se le
 * atribuye la firma del contrato (ContractSignature.guardianId) y si falta la
 * del otro.
 *
 * Comparación case-insensitive con el email ya normalizado (igual que hace el
 * resto del portal): quien reserva puede haber escrito el correo con otras
 * mayúsculas que quien creó la ficha.
 *
 * No lanza nunca: un fallo aquí deja al cliente sin documentos, no con un 500.
 */
import { Op } from "sequelize";

const mismoEmail = (a, b) =>
  !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// `communicationPrefs` va aquí desde el 01/08: Sequelize solo trae los
// atributos pedidos, así que sin él la pantalla de comunicaciones del portal
// leía `undefined` y enseñaba los valores por defecto — daba igual lo que la
// familia hubiera marcado. Mismo tropiezo que tuvo el contrato con
// `contractDocumentId`.
const ATRIBUTOS = ["id", "name", "email", "guardians", "portalUnlockedMonths", "communicationPrefs"];

const tutorConEseEmail = (cliente, email) =>
  (Array.isArray(cliente?.guardians) ? cliente.guardians : []).find((g) => mismoEmail(g?.email, email)) ?? null;

/**
 * Ficha + tutor que corresponden a un email del portal.
 * @returns {Promise<{client: object|null, guardian: object|null}>}
 */
export async function resolvePortalAccess(tenantModels, email) {
  const vacio = { client: null, guardian: null };
  try {
    if (!email) return vacio;
    const { Client } = tenantModels;
    if (!Client) return vacio;

    // Camino 1: el email de la propia ficha.
    const porFicha = await Client.findOne({
      where: { email: { [Op.iLike]: email } },
      attributes: ATRIBUTOS,
    });
    if (porFicha) {
      // Aun entrando por el email de la ficha puede coincidir con un tutor
      // concreto; si es así se identifica, para poder atribuirle su firma.
      return { client: porFicha, guardian: tutorConEseEmail(porFicha, email) };
    }

    // Camino 2: el email de un TUTOR. `guardians` es JSONB y el email va dentro
    // de cada entrada, así que se compara en JS. Se acotan los candidatos a las
    // fichas que tienen tutores para no recorrer la tabla entera.
    // El filtro va en SQL crudo a propósito: comparar una columna JSONB con un
    // array de JS por Sequelize no produce el SQL que uno espera.
    const candidatos = await Client.findAll({
      where: Client.sequelize.literal("jsonb_array_length(guardians) > 0"),
      attributes: ATRIBUTOS,
      limit: 1000,
    });
    for (const c of candidatos) {
      const g = tutorConEseEmail(c, email);
      if (g) return { client: c, guardian: g };
    }

    return vacio;
  } catch {
    return vacio;
  }
}

/**
 * Compatibilidad: los endpoints que solo quieren la ficha siguen llamando aquí.
 * Ahora también encuentran la familia entrando con el correo de un tutor.
 */
export async function resolvePortalClient(tenantModels, email) {
  const { client } = await resolvePortalAccess(tenantModels, email);
  return client;
}
