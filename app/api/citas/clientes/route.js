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
 * DEGRADACIÓN DELIBERADA: se devuelven TODOS los clientes, en vez de una lista
 * vacía, cuando el filtro no puede distinguir nada — porque el tenant no tiene
 * la tabla de asignaciones (42P01) o porque no hay ni un cliente marcado. Un
 * desplegable vacío dejaría a la usuaria sin poder crear la cita, y eso es peor
 * que ofrecer de más. `soloPacientes` dice cuál de los dos casos es.
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

    /*
     * ⚠️ NADIE MARCADO ≠ NADIE A QUIEN DAR CITA (12/08/2026, Rodrigo: «¿por qué
     * no me deja poner pacientes en la cita manual?»).
     *
     * La marca de módulo asistencial vive en la ficha del CLIENTE, y en un
     * centro clínico el cliente es la FAMILIA que paga: quien es paciente es el
     * hijo, que tiene su propia tabla y su propio selector en el alta. Aumenta
     * tiene 1.083 familias y CERO con esa marca puesta, así que el buscador
     * devolvía la lista vacía y un cartel («aún no hay pacientes con módulo
     * asistencial activado») que sonaba a que faltaba configurar algo.
     *
     * Si NADIE la tiene, la marca no está en uso en este centro y filtrar por
     * ella no distingue nada: se ofrecen todos los clientes. Es la misma
     * degradación deliberada que cuando falta la tabla — un desplegable vacío
     * deja a recepción sin poder dar la cita, y eso es peor que ofrecer de más.
     * Donde sí se usa (nutri_laura) no cambia nada: la lista sigue acotada.
     */
    if (idsAsistenciales && idsAsistenciales.length === 0) idsAsistenciales = null;

    if (idsAsistenciales) {
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
