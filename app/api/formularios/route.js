import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../lib/utils/apiResponse.js";
import { MODULE_KEYS } from "../../../lib/tenant/moduleKeys.js";

/**
 * GET /api/formularios — la bandeja.
 *
 * Query:
 *   ?status=pending|accepted|rejected   (por defecto pending)
 *   ?formSlug=consulta                  (opcional, si hay varios formularios)
 *   ?limit=50&offset=0
 *
 * Devuelve además el recuento por estado (para los globos de las pestañas) y
 * la lista de formularios activos, que la bandeja necesita para saber qué
 * preguntas existen.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule(MODULE_KEYS.FORMULARIOS)) return forbidden("Módulo formularios no activo");

    const { Form, FormSubmission } = tenantModels;
    const url = new URL(request.url);

    const estadosValidos = ["pending", "accepted", "rejected"];
    const status = estadosValidos.includes(url.searchParams.get("status"))
      ? url.searchParams.get("status")
      : "pending";
    const formSlug = url.searchParams.get("formSlug");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

    const where = { status };
    if (formSlug) where.formSlug = formSlug;

    const [{ rows, count }, forms, porEstado] = await Promise.all([
      FormSubmission.findAndCountAll({
        where,
        order: [["createdAt", "DESC"]],
        limit,
        offset,
      }),
      Form.findAll({ order: [["sortOrder", "ASC"], ["title", "ASC"]] }),
      FormSubmission.findAll({
        attributes: [
          "status",
          [FormSubmission.sequelize.fn("COUNT", FormSubmission.sequelize.col("id")), "n"],
        ],
        group: ["status"],
        raw: true,
      }),
    ]);

    const recuento = { pending: 0, accepted: 0, rejected: 0 };
    for (const fila of porEstado) {
      if (fila.status in recuento) recuento[fila.status] = Number(fila.n) || 0;
    }

    return ok({
      submissions: rows.map((r) => r.toJSON()),
      total: count,
      recuento,
      forms: forms.map((f) => f.toJSON()),
    });
  } catch (err) {
    return serverError(err);
  }
});
