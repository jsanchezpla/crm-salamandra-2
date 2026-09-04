import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, serverError } from "../../../../lib/utils/apiResponse.js";
import { filtroPorNombre } from "../../../../lib/utils/busquedaDb.js";
import { pacientesQueCasan } from "../../../../lib/clients/familiasPorPaciente.js";
import { opcionesDeRazonSocial, razonSocialPorDefecto } from "../../../../lib/billing/razonSocial.js";

/**
 * El buscador de fichas DE FACTURACIÓN (31/08/2026).
 *
 * Nace de un 403: Rosa y Olga llevan los cobros con el módulo `billing` pero
 * sin `clients` en su module_access, así que el selector de cliente de Cobros
 * les preguntaba a /api/clients y volvía vacío — «no les sale nadie». Cobrar
 * es de facturación: la puerta de este buscador es `billing`, y devuelve SOLO
 * lo que una pantalla de dinero necesita (nombre, datos fiscales y la cuota),
 * nunca la ficha entera.
 *
 * Busca por el nombre del pagador Y por el del paciente (la regla compartida,
 * lib/clients/familiasPorPaciente.js): Rosa conoce al niño, no al pagador.
 *
 * Sin el filtro de consultas externas a propósito: quien cobra tiene que
 * poder cobrar a todo el centro, y aquí no viaja nada clínico.
 */
const ATRIBUTOS = [
  "id", "name", "email", "taxId",
  "fiscalName", "fiscalTaxId", "fiscalAddress", "fiscalCity", "fiscalZip",
  "cuotaConceptIds",
  // Para poder ofrecer «a nombre de quién» se factura (04/09/2026). Los
  // tutores se leen aquí pero NO salen de aquí: `paraPantalla` los convierte
  // en la lista de nombres y quita el JSONB, que lleva DNI y teléfono.
  "guardians", "fiscalGuardianId",
];

/**
 * La ficha tal y como la ve una pantalla de dinero: sin los tutores en crudo y
 * con las opciones de razón social ya resueltas (nombre, parentesco y si le
 * falta DNI). Misma regla del 02/09/2026 por la que `ATRIBUTOS_CLIENTE_FACTURA`
 * deja `guardians` fuera: elegir un nombre no necesita datos personales.
 */
function paraPantalla(fila) {
  const ficha = fila.toJSON ? fila.toJSON() : fila;
  const { guardians, ...resto } = ficha;
  return {
    ...resto,
    razonesSociales: opcionesDeRazonSocial(ficha),
    razonSocial: razonSocialPorDefecto(ficha),
  };
}

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Client, Patient } = tenantModels;
    const { searchParams } = new URL(request.url);

    // Resolver UNA por su id: lo usa el selector para pintar la ya elegida.
    const id = searchParams.get("id");
    if (id) {
      const ficha = await Client.findByPk(id, { attributes: ATRIBUTOS });
      return ficha ? ok(paraPantalla(ficha)) : notFound("Ficha no encontrada");
    }

    const search = (searchParams.get("search") ?? "").trim();
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20") || 20, 50);

    const or = [];
    let casan = [];
    if (search) {
      const porNombre = await filtroPorNombre(Client.sequelize, search, [
        "Client.name", "Client.email", "Client.phone",
      ]);
      if (porNombre) or.push(porNombre);
      casan = await pacientesQueCasan({ q: search, Patient, hasModule });
      if (casan.length) or.push({ id: { [Op.in]: [...new Set(casan.map((x) => x.clientId))] } });
      // Texto que no casa con nada buscable → nadie, no todo el centro.
      if (!or.length) return ok({ clients: [], total: 0 });
    }

    const { rows, count } = await Client.findAndCountAll({
      where: or.length ? { [Op.or]: or } : {},
      attributes: ATRIBUTOS,
      order: search ? [["name", "ASC"]] : [["createdAt", "DESC"]],
      limit,
    });

    const porPaciente = new Map(casan.map((x) => [String(x.clientId), x.nombre]));
    return ok({
      clients: rows.map((r) => ({ ...paraPantalla(r), porPaciente: porPaciente.get(String(r.id)) ?? null })),
      total: count,
    });
  } catch (err) {
    return serverError(err);
  }
});
