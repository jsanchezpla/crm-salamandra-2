import { Op } from "sequelize";

import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../lib/utils/auditoria.js";
import { resumirPorPersona, totalesDelMes, avisosDelMes, ordenarAvisos, rangoDelPeriodo } from "../../../lib/fichaje/totales.js";
import { avisosDePuntualidad } from "../../../lib/fichaje/puntualidad.js";
import { cargarFestivos, esFestivo } from "../../../lib/citas/festivos.js";
import { describirParser } from "../../../lib/fichaje/parsers/index.js";


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

/**
 * La agenda del mes aplanada para la puntualidad (31/08/2026): citas activas
 * y bloqueos por persona, cada uno como { teamMemberId, fecha, inicio, fin }
 * EN HORA DE MADRID — el reloj de fichar y el Excel viven en hora de pared,
 * y el servidor va en UTC, así que aquí se convierte y la regla
 * (lib/fichaje/puntualidad.js) solo compara minutos. Sin módulo Citas no hay
 * tablas y la pantalla sigue: se pierde el aviso, no el módulo.
 */
const enMadrid = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
function fechaHoraMadrid(instante) {
  const p = Object.fromEntries(enMadrid.formatToParts(new Date(instante)).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

async function agendaDelPeriodo(tenantModels, rango) {
  const { Booking, TeamBlock } = tenantModels;
  const agenda = [];
  const desde = new Date(`${rango.desde}T00:00:00Z`);
  const hasta = new Date(`${rango.hasta}T23:59:59Z`);
  try {
    if (Booking) {
      const citas = await Booking.findAll({
        where: {
          teamMemberId: { [Op.ne]: null },
          scheduledAt: { [Op.between]: [desde, hasta] },
          status: { [Op.notIn]: ["cancelled"] },
        },
        attributes: ["teamMemberId", "scheduledAt", "duration"],
      });
      for (const c of citas) {
        const ini = fechaHoraMadrid(c.scheduledAt);
        const fin = fechaHoraMadrid(new Date(new Date(c.scheduledAt).getTime() + (Number(c.duration) || 0) * 60000));
        agenda.push({ teamMemberId: c.teamMemberId, fecha: ini.fecha, inicio: ini.hora, fin: fin.hora });
      }
    }
    if (TeamBlock) {
      const bloqueos = await TeamBlock.findAll({
        where: {
          teamMemberId: { [Op.ne]: null },
          startAt: { [Op.lt]: hasta },
          endAt: { [Op.gt]: desde },
        },
        attributes: ["teamMemberId", "startAt", "endAt"],
      });
      for (const b of bloqueos) {
        const ini = fechaHoraMadrid(b.startAt);
        const fin = fechaHoraMadrid(b.endAt);
        // Un bloqueo de varios días cuenta en su día de inicio y en el de fin;
        // los días de en medio no dicen nada de puntualidad (no se ficha).
        agenda.push({ teamMemberId: b.teamMemberId, fecha: ini.fecha, inicio: ini.hora, fin: ini.fecha === fin.fecha ? fin.hora : "23:59" });
        if (fin.fecha !== ini.fecha) {
          agenda.push({ teamMemberId: b.teamMemberId, fecha: fin.fecha, inicio: "00:00", fin: fin.hora });
        }
      }
    }
  } catch {
    return [];
  }
  return agenda;
}

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
    // Sin puerta de rol: la llave es tener el módulo CONCEDIDO, y eso ya lo
    // cruza `hasModule` (`lib/fichaje/acceso.js`, 04/09/2026).

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
    const agenda = await agendaDelPeriodo(tenantModels, rango);
    const nombres = new Map(personas.map((p) => [p.id, p.displayName || p.email || "(sin nombre)"]));

    return ok({
      periodo: mes,
      rango,
      filas: planas,
      resumen,
      totales: totalesDelMes(resumen),
      avisos: ordenarAvisos([
        ...avisosDelMes(planas, personas, { festivos }),
        ...avisosDePuntualidad(planas, agenda, { nombres }),
      ]),
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
    // Sin puerta de rol: la llave es tener el módulo CONCEDIDO, y eso ya lo
    // cruza `hasModule` (`lib/fichaje/acceso.js`, 04/09/2026).

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
