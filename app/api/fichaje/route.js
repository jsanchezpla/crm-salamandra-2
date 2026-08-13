import { Op } from "sequelize";

import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../lib/utils/auditoria.js";
import { resumirPorPersona, totalesDelMes, avisosDelMes, rangoDelPeriodo } from "../../../lib/fichaje/totales.js";
import { cargarFestivos, esFestivo } from "../../../lib/citas/festivos.js";
import { describirParser } from "../../../lib/fichaje/parsers/index.js";

const ADMIN = new Set(["admin", "superadmin"]);

/**
 * /api/fichaje — el mes de fichaje del centro.
 *
 * GET  ?mes=YYYY-MM[&teamMemberId=]  filas + totales por persona + avisos
 * POST                               alta MANUAL de un tramo (exige nota)
 *
 * Solo admin, en las dos. Un registro de jornada es un documento laboral y el
 * CRM ya tiene el patrón: `withTenant` reescribe `x-user-role` con el rol
 * fresco de base de datos, así que degradar a alguien surte efecto al instante.
 */

/** Festivos del periodo como Set de 'YYYY-MM-DD'. Tolera que no haya módulo Citas. */
async function festivosDelPeriodo(tenantModels, rango) {
  try {
    const festivos = await cargarFestivos(tenantModels, { desde: rango.desde, hasta: rango.hasta });
    const set = new Set();
    for (let d = 1; d <= rango.dias; d++) {
      const fecha = { year: rango.year, month: rango.month, day: d };
      if (esFestivo(festivos, fecha)) {
        set.add(`${rango.year}-${String(rango.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
      }
    }
    return set;
  } catch {
    // Sin módulo Citas no hay tabla de festivos, y eso no puede tumbar la
    // pantalla de fichaje: se pierde un aviso, no el módulo.
    return new Set();
  }
}

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("fichaje")) return forbidden("Módulo fichaje no activo");
    if (!ADMIN.has(request.headers.get("x-user-role"))) return forbidden("Solo administradores");

    const url = new URL(request.url);
    const mes = url.searchParams.get("mes");
    const teamMemberId = url.searchParams.get("teamMemberId");
    const rango = rangoDelPeriodo(mes);
    if (!rango) return error("Falta `mes` o no tiene formato YYYY-MM");

    const { Fichaje, TeamMember } = tenantModels;
    const where = {
      fecha: { [Op.between]: [rango.desde, rango.hasta] },
      deletedAt: null,
    };
    if (teamMemberId) where.teamMemberId = teamMemberId;

    const [filas, personas] = await Promise.all([
      Fichaje.findAll({ where, order: [["fecha", "ASC"], ["entradaAt", "ASC"]] }),
      TeamMember.findAll({
        where: { status: "active" },
        attributes: ["id", "displayName", "email", "customFields"],
        order: [["displayName", "ASC"]],
      }),
    ]);

    const planas = filas.map((f) => f.toJSON());
    const festivos = await festivosDelPeriodo(tenantModels, rango);
    const resumen = resumirPorPersona(planas, personas);

    return ok({
      periodo: mes,
      rango,
      filas: planas,
      resumen,
      totales: totalesDelMes(resumen),
      avisos: avisosDelMes(planas, personas, { festivos }),
      parser: describirParser(request.headers.get("x-tenant")),
    });
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST — un tramo a mano.
//
// Existe porque el Excel nunca lo trae todo: el día que el reloj falla, o la
// persona que se dejó el fichaje, se apuntan aquí. Y por eso la NOTA es
// obligatoria: un tramo que no salió de ningún fichero tiene que decir de dónde
// salió, o dentro de seis meses nadie sabe si es un dato o un apaño.
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule, user }) => {
  try {
    if (!hasModule("fichaje")) return forbidden("Módulo fichaje no activo");
    if (!ADMIN.has(request.headers.get("x-user-role"))) return forbidden("Solo administradores");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const { teamMemberId, fecha, entradaAt = null, salidaAt = null, tipo = "trabajo", nota } = body || {};
    if (!teamMemberId) return error("Falta la persona");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ""))) return error("Falta la fecha (YYYY-MM-DD)");
    if (!nota || !String(nota).trim()) return error("La nota es obligatoria en un fichaje a mano: di de dónde sale");

    let minutos = Number(body.minutos);
    if (!Number.isFinite(minutos)) {
      return error("Faltan los minutos trabajados");
    }
    minutos = Math.round(minutos);
    if (minutos < 0 || minutos > 24 * 60) return error("Los minutos tienen que estar entre 0 y 1440");

    const { Fichaje, TeamMember } = tenantModels;
    const persona = await TeamMember.findByPk(teamMemberId);
    if (!persona) return error("Esa persona no está en el equipo", 422);

    const fila = await Fichaje.create({
      teamMemberId,
      fecha,
      entradaAt,
      salidaAt,
      minutos,
      minutosOriginal: null, // no vino de ningún Excel
      tipo,
      origen: "manual",
      nota: String(nota).trim(),
      corregidoAt: new Date(),
    });

    // Resumen, nunca la fila entera: son datos laborales y `master.audit_log`
    // es un schema compartido por todos los clientes.
    await auditar({
      tenantId: tenant.id,
      userId: user?.id ?? null,
      action: "fichaje.creado_a_mano",
      entity: "Fichaje",
      entityId: fila.id,
      after: { persona: persona.displayName, fecha, minutos, motivo: String(nota).trim().slice(0, 120) },
      ...datosPeticion(request),
    });

    return created(fila.toJSON());
  } catch (err) {
    return serverError(err);
  }
});
