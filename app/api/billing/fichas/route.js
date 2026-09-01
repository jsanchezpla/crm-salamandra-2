import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, serverError } from "../../../../lib/utils/apiResponse.js";
import { filtroPorNombre } from "../../../../lib/utils/busquedaDb.js";
import { pacientesQueCasan } from "../../../../lib/clients/buscarPorPaciente.js";

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
 * lib/clients/buscarPorPaciente.js): Rosa conoce al niño, no al pagador.
 *
 * Sin el filtro de consultas externas a propósito: quien cobra tiene que
 * poder cobrar a todo el centro, y aquí no viaja nada clínico.
 */
const ATRIBUTOS = [
  "id", "name", "email", "taxId",
  "fiscalName", "fiscalTaxId", "fiscalAddress", "fiscalCity", "fiscalZip",
  "cuotaConceptIds",
];

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Client, Patient } = tenantModels;
    const { searchParams } = new URL(request.url);

    // Resolver UNA por su id: lo usa el selector para pintar la ya elegida.
    const id = searchParams.get("id");
    if (id) {
      const ficha = await Client.findByPk(id, { attributes: ATRIBUTOS });
      return ficha ? ok(ficha) : notFound("Ficha no encontrada");
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
      casan = await pacientesQueCasan(Patient, search);
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
      clients: rows.map((r) => ({ ...r.toJSON(), porPaciente: porPaciente.get(String(r.id)) ?? null })),
      total: count,
    });
  } catch (err) {
    return serverError(err);
  }
});
