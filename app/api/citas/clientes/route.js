import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";

/**
 * GET /api/citas/clientes — a quién se le puede poner una cita.
 *
 * Devuelve las fichas de cliente que tienen ACTIVADO algún módulo asistencial
 * (`nutricion` o `clinica`), que es como el CRM marca "esta persona es
 * paciente" desde su ficha (tabla client_module_assignments). Sirve para que
 * el alta manual de citas sea un buscador en vez de tres campos de texto
 * libre, y para que el email y el teléfono se rellenen solos.
 *
 * Query:
 *   ?q=ana        filtra por nombre, email o teléfono (sin distinguir mayúsculas)
 *   ?limit=20     tope de resultados (por defecto 20, máximo 50)
 *   ?todos=1      ignora el filtro de módulos y devuelve cualquier cliente
 *
 * DEGRADACIÓN DELIBERADA: si el tenant tiene citas pero NO la tabla de
 * asignaciones (42P01), se devuelven todos los clientes en vez de una lista
 * vacía. Un desplegable vacío dejaría a la usuaria sin poder crear la cita, y
 * eso es peor que ofrecer de más.
 */

const MODULOS_ASISTENCIALES = ["nutricion", "clinica"];

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");

    const { Client, ClientModuleAssignment } = tenantModels;
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();
    const todos = url.searchParams.get("todos") === "1";
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 50);

    const where = { status: { [Op.ne]: "inactive" } };
    if (q) {
      const patron = `%${q}%`;
      where[Op.or] = [
        { name: { [Op.iLike]: patron } },
        { email: { [Op.iLike]: patron } },
        { phone: { [Op.iLike]: patron } },
      ];
    }

    // Restricción a quienes son pacientes de algún módulo asistencial.
    let idsAsistenciales = null;
    if (!todos && ClientModuleAssignment) {
      try {
        const filas = await ClientModuleAssignment.findAll({
          where: { moduleKey: { [Op.in]: MODULOS_ASISTENCIALES }, enabled: true },
          attributes: ["clientId"],
          raw: true,
        });
        idsAsistenciales = [...new Set(filas.map((f) => f.clientId).filter(Boolean))];
      } catch (err) {
        // Tenant con citas pero sin la tabla de asignaciones: mejor de más que
        // dejar el desplegable vacío y bloquear el alta de la cita.
        const code = err?.parent?.code || err?.original?.code;
        if (code !== "42P01") throw err;
        idsAsistenciales = null;
      }
    }

    if (idsAsistenciales) {
      if (idsAsistenciales.length === 0) {
        return ok({ clientes: [], soloPacientes: true, totalPacientes: 0 });
      }
      where.id = { [Op.in]: idsAsistenciales };
    }

    const filas = await Client.findAll({
      where,
      attributes: ["id", "name", "email", "phone"],
      order: [["name", "ASC"]],
      limit,
    });

    return ok({
      clientes: filas.map((c) => c.toJSON()),
      soloPacientes: Boolean(idsAsistenciales),
      totalPacientes: idsAsistenciales ? idsAsistenciales.length : null,
    });
  } catch (err) {
    return serverError(err);
  }
});
