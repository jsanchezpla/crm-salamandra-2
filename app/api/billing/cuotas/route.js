import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { logBillingAudit, datosPeticion } from "../../../../lib/billing/audit.js";
import { limpiarCuota, metodosValidos } from "../../../../lib/billing/cuotas.js";
import { billingHasPatients } from "../../../../lib/billing/patientLink.js";

/**
 * GET/POST /api/billing/cuotas — las cuotas asignadas (01/09/2026).
 *
 * GET: las vigentes por defecto (`?todas=1` trae también las de baja), con su
 * pagador, su paciente y —cuando no tiene— LOS PACIENTES DE SU FAMILIA ya
 * resueltos; filtrable por cliente, paciente y método.
 *
 * POST: el alta, individual **o EN GRUPO** — que es lo que pidió Aumenta
 * («crear cuotas para grupos de pacientes»). Se manda UNA vez lo que comparten
 * (conceptos, importe, método, día de cobro, alta) y la lista de destinatarios;
 * sale una cuota por cada uno. Quien ya tiene una cuota activa para ese mismo
 * paciente se SALTA con su motivo en vez de duplicarle el cobro: el lote de 40
 * familias no puede convertirse en 40 cuotas repetidas por un doble clic.
 */

/** El paciente solo se incluye si el tenant tiene módulo asistencial. */
function includePaciente(tenantModels, hasModule) {
  if (!billingHasPatients(hasModule) || !tenantModels.Patient) return [];
  return [{ model: tenantModels.Patient, as: "patient", attributes: ["id", "firstName", "lastName"] }];
}

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Cuota, Client } = tenantModels;
    const { searchParams } = new URL(request.url);

    const where = {};
    if (searchParams.get("todas") !== "1") where.active = true;
    if (searchParams.get("clientId")) where.clientId = searchParams.get("clientId");
    if (searchParams.get("patientId")) where.patientId = searchParams.get("patientId");
    const metodos = metodosValidos(searchParams.getAll("metodo"));
    if (metodos.length) where.method = { [Op.in]: metodos };

    const cuotas = await Cuota.findAll({
      where,
      include: [
        { model: Client, as: "client", attributes: ["id", "name", "fiscalName", "taxId", "fiscalTaxId"] },
        ...includePaciente(tenantModels, hasModule),
      ],
      order: [["active", "DESC"], ["startDate", "DESC"]],
    });

    /*
     * A cada cuota se le cuelgan los pacientes DE SU FAMILIA (01/09/2026).
     *
     * Sin esto, filtrar por paciente en la pantalla de Cuotas no encontraba
     * nada en 259 de las 274 cuotas de Aumenta: las del volcado del Organizate
     * son de la familia y tienen `patientId` a NULL. La regla de que una cuota
     * sin paciente cubre a los pacientes de su familia vive en
     * `lib/billing/cuotaPacientes.js`, con su prueba.
     *
     * Una sola consulta para todas las familias de la pagina, no una por fila.
     * Solo viajan id y nombre, que es lo que la pantalla pinta y busca.
     */
    const familiaPacientes = await pacientesPorFamilia(tenantModels, hasModule, cuotas);
    const filas = cuotas.map((c) => ({
      ...c.toJSON(),
      familiaPacientes: familiaPacientes.get(String(c.clientId)) ?? [],
    }));

    return ok({ cuotas: filas, total: filas.length });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Cuota, Client } = tenantModels;
    const body = await request.json();

    // Un destinatario suelto o una lista: la pantalla manda siempre la lista,
    // pero la forma de uno solo se acepta para no obligar a envolver.
    const destinatarios = Array.isArray(body?.destinatarios) && body.destinatarios.length
      ? body.destinatarios
      : [{ clientId: body?.clientId, patientId: body?.patientId ?? null }];
    if (destinatarios.length > 500) {
      return error("Demasiados destinatarios de una vez (máximo 500)", 422);
    }

    // Lo que comparten todos se valida UNA vez, con el primer destinatario de
    // muestra: si el importe o la fecha están mal, no se crea ninguna.
    const muestra = limpiarCuota({ ...body, ...destinatarios[0] });
    if (muestra.problema) return error(muestra.problema, 422);

    const permitirDuplicadas = body?.permitirDuplicadas === true;
    const creadas = [];
    const omitidas = [];

    for (const destino of destinatarios) {
      const { valores, problema } = limpiarCuota({ ...body, ...destino });
      if (problema) { omitidas.push({ ...destino, motivo: problema }); continue; }

      const ficha = await Client.findByPk(valores.clientId, { attributes: ["id", "name"] });
      if (!ficha) { omitidas.push({ ...destino, motivo: "la ficha no existe" }); continue; }

      if (!permitirDuplicadas) {
        // Mismo pagador y mismo paciente con cuota viva = casi siempre un doble
        // clic. Dos hijos son dos pacientes distintos, y esos sí pasan.
        const yaTiene = await Cuota.findOne({
          where: { clientId: valores.clientId, patientId: valores.patientId ?? null, active: true },
          attributes: ["id"],
        });
        if (yaTiene) {
          omitidas.push({ ...destino, nombre: ficha.name, motivo: "ya tiene una cuota activa", cuotaId: yaTiene.id });
          continue;
        }
      }

      const cuota = await Cuota.create(valores);
      creadas.push({ id: cuota.id, clientId: cuota.clientId, patientId: cuota.patientId, nombre: ficha.name });
    }

    // Auditoría DESPUÉS de mutar, como el resto del dinero. Un lote deja UNA
    // línea con el recuento: 300 líneas idénticas no se leen.
    if (creadas.length) {
      await logBillingAudit({
        tenantId: tenant.id,
        ...datosPeticion(request),
        action: "cuota.created",
        entity: "Cuota",
        entityId: creadas.length === 1 ? creadas[0].id : null,
        before: null,
        after: {
          altas: creadas.length,
          importe: valoresImporte(body),
          conceptos: (muestra.valores.conceptIds ?? []).length,
          desde: muestra.valores.startDate,
          metodo: muestra.valores.method,
        },
      });
    }

    return created({ creadas: creadas.length, cuotas: creadas, omitidas });
  } catch (err) {
    return serverError(err);
  }
});

/** El importe tal cual se pactó, para el rastro (null = «lo que digan sus conceptos»). */
function valoresImporte(body) {
  const v = body?.amount;
  return v === null || v === undefined || v === "" ? null : String(v);
}

/**
 * Los pacientes de cada familia que aparece en la lista, en UNA consulta.
 * Mapa clientId -> [{ id, firstName, lastName }]. Vacio si el centro no tiene
 * modulo asistencial (una gestoria no tiene pacientes) o si la tabla no esta.
 */
async function pacientesPorFamilia(tenantModels, hasModule, cuotas) {
  const mapa = new Map();
  if (!billingHasPatients(hasModule) || !tenantModels.Patient) return mapa;
  const ids = [...new Set(cuotas.map((c) => c.clientId).filter(Boolean))];
  if (!ids.length) return mapa;
  try {
    const filas = await tenantModels.Patient.findAll({
      where: { clientId: ids },
      attributes: ["id", "firstName", "lastName", "clientId"],
      order: [["firstName", "ASC"]],
      raw: true,
    });
    for (const p of filas) {
      const clave = String(p.clientId);
      if (!mapa.has(clave)) mapa.set(clave, []);
      mapa.get(clave).push({ id: p.id, firstName: p.firstName, lastName: p.lastName });
    }
  } catch (err) {
    // Tenant sin tabla de pacientes migrada: la pantalla sigue como estaba.
    const code = err?.parent?.code || err?.original?.code;
    if (code !== "42P01") throw err;
  }
  return mapa;
}
