import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { logCitasAudit } from "../../../../lib/citas/audit.js";
import { buildMadridDate } from "../../../../lib/citas/slots.js";
import { colorDeBloqueo } from "../../../../lib/citas/coloresBloqueo.js";
import { veTodaLaAgenda } from "../../../../lib/citas/visibilidad.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * /api/citas/bloqueos — «Vacaciones» (06/08/2026, Rodrigo).
 *
 *   GET    ?from=ISO&to=ISO    listar (las suyas y las del centro; ver abajo)
 *   POST   { teamMemberId, startAt, endAt, label, notes }   crear
 *   DELETE ?id=UUID            quitarlo
 *
 * Rodrigo lo pidió como «un tipo de cita especial sin paciente, con fecha y
 * hora de inicio y fin, asignado a un miembro del equipo». Por dentro NO es una
 * cita —el porqué está en `models/tenant/TeamBlock.model.js`— pero en la
 * pantalla se crea igual: se elige a quién, desde cuándo y hasta cuándo.
 *
 * `teamMemberId` a null = no está NADIE, o sea un cierre del centro con hora.
 *
 * ── QUIÉN PUEDE QUÉ (10/08/2026, tras el aviso de nutri_laura) ──────────────
 * Ponerlo lo puede CUALQUIERA del equipo desde el 07/08 —quien se va de
 * vacaciones tiene que poder apuntarlo—, pero hasta hoy podía apuntarlo A
 * NOMBRE DE CUALQUIERA, incluido «todo el centro». En la consulta de Laura eso
 * pasó SEIS veces: Rocío apuntaba sus ausencias, se quedaba el desplegable en
 * «Todo el centro» y cerraba también la agenda de Laura. Nadie se enteraba,
 * porque el resultado —un hueco que no se ofrece— es exactamente el mismo.
 *
 *   · quien NO es admin solo puede poner y quitar LAS SUYAS. El `teamMemberId`
 *     se resuelve AQUÍ a partir de la sesión; lo que mande el navegador da
 *     igual. Cerrar el centro entero sigue siendo cosa de dirección.
 *   · admin puede todo, incluido el cierre de centro.
 *
 * ── QUIÉN VE QUÉ ────────────────────────────────────────────────────────────
 * Las ausencias siguen la MISMA regla que las citas (`lib/citas/visibilidad.js`)
 * en vez de inventarse otro interruptor: con la agenda compartida encendida
 * —Aumenta, que lo pidió el 01/08 para cubrirse entre terapeutas— se ven las de
 * todo el mundo; apagada, cada cual ve las SUYAS y las del centro, que son las
 * que le afectan. El admin ve todas.
 *
 * ⚠️ Esto es SOLO lo que se ve. El cálculo de huecos (`lib/citas/ausencias.js`)
 * lee la tabla por su cuenta y sin filtrar, así que ocultar una ausencia NO
 * abre su hueco: la paciente sigue sin poder reservarlo.
 *
 * Crear un bloqueo NO cancela las citas que ya hubiera dentro: eso lo decide el
 * centro (avisar, reubicar, cobrar o no), igual que con los festivos. La
 * respuesta dice cuántas hay para que la pantalla pueda avisar.
 */

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^(\d{1,2}):(\d{2})$/;

/**
 * "2026-08-17" + "07:00" → el instante en que en MADRID son las 7 de la mañana.
 *
 * `respaldo` es un ISO completo, para no romper a quien llame al endpoint a la
 * vieja usanza (o a una pestaña abierta desde antes de este arreglo). Ahí sí se
 * respeta la zona que traiga la cadena, porque un ISO con zona no es ambiguo.
 */
function instanteDeMadrid(fecha, hora, respaldo) {
  if (FECHA_RE.test(String(fecha ?? "")) && HORA_RE.test(String(hora ?? ""))) {
    const [y, m, d] = String(fecha).split("-").map(Number);
    const [hh, mm] = HORA_RE.exec(String(hora)).slice(1).map(Number);
    if (hh > 23 || mm > 59) return null;
    return buildMadridDate(y, m, d, hh, mm);
  }
  if (respaldo) {
    const t = new Date(respaldo);
    return Number.isNaN(t.getTime()) ? null : t;
  }
  return null;
}

function gate(ctx) {
  if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
  return null;
}

/**
 * Quién hace la petición: si manda (admin) y qué ficha de equipo tiene.
 *
 * El rol se lee de `x-user-role`, que `withTenant` reescribe con el rol REAL de
 * la base antes de llamar aquí (arreglo del 28/07): degradar a alguien surte
 * efecto al instante, no cuando le caduque el JWT.
 */
async function quienSoy(request, ctx) {
  const esAdmin = ADMIN_ROLES.has(request.headers.get("x-user-role"));
  const teamMemberId = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
  return { esAdmin, teamMemberId };
}

/**
 * Nombre de quien APUNTÓ cada ausencia, no de quién es.
 *
 * `createdById` es el id del usuario (schema master) y el nombre vive en la
 * ficha de equipo, así que se cruza por `TeamMember.userId`. Se hace con UNA
 * consulta para toda la lista en vez de un include: no hay asociación declarada
 * entre las dos cosas y no merece la pena crearla para un rótulo.
 *
 * Quien no tenga ficha de equipo —un admin que no da consulta— sale sin nombre,
 * y la pantalla simplemente no lo enseña.
 */
async function nombresDeQuienApunto(filas, tenantModels) {
  const ids = [...new Set(filas.map((f) => f.createdById).filter(Boolean))];
  if (!ids.length || !tenantModels?.TeamMember) return new Map();
  try {
    const fichas = await tenantModels.TeamMember.findAll({
      where: { userId: { [Op.in]: ids } },
      attributes: ["userId", "displayName"],
    });
    return new Map(fichas.map((t) => [t.userId, t.displayName]));
  } catch {
    return new Map(); // un rótulo no puede tumbar el listado
  }
}

/**
 * `colorGeneral` es el del centro. El color viaja YA RESUELTO (persona →
 * centro → rosa de siempre) para que la agenda solo tenga que pintarlo: la
 * regla de quién gana vive en un sitio, no repartida por cada pantalla.
 */
function serializa(f, colorGeneral, autores) {
  return {
    id: f.id,
    teamMemberId: f.teamMemberId ?? null,
    teamMemberName: f.teamMember?.displayName ?? null,
    // Quién lo APUNTÓ. Lo pinta solo la tabla de Vacaciones; la agenda no lo
    // usa (Jorge, 10/08: en el calendario no tiene por qué salir).
    createdByName: autores?.get(f.createdById) ?? null,
    startAt: f.startAt,
    endAt: f.endAt,
    label: f.label,
    notes: f.notes ?? null,
    color: colorDeBloqueo(f.teamMember?.blockColor, colorGeneral),
  };
}

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { TeamBlock, TeamMember } = ctx.tenantModels;
    const yo = await quienSoy(request, ctx);
    if (!TeamBlock) return ok({ bloqueos: [], yo });

    const sp = new URL(request.url).searchParams;
    const from = sp.get("from");
    const to = sp.get("to");
    const where = {};
    if (from && to && !Number.isNaN(Date.parse(from)) && !Number.isNaN(Date.parse(to))) {
      // Los que PISAN el rango, no los que caben dentro: unas vacaciones de tres
      // semanas tienen que salir aunque el rango pedido sea de un solo día.
      where.startAt = { [Op.lt]: new Date(to) };
      where.endAt = { [Op.gt]: new Date(from) };
    }

    /*
     * Sin agenda compartida, cada cual ve las SUYAS y las del centro (las que
     * van sin persona), que son las que le afectan. Las de la compañera no le
     * dicen nada y le ensucian el calendario — es lo que pidió la consulta de
     * Laura el 10/08.
     *
     * Quien no tiene ficha de equipo se queda solo con las del centro: no hay
     * ninguna «suya» que enseñarle, y colarle las de todos sería justo lo que
     * se está quitando.
     */
    if (!veTodaLaAgenda({ tenant: ctx.tenant, role: request.headers.get("x-user-role") })) {
      where[Op.or] = yo.teamMemberId
        ? [{ teamMemberId: null }, { teamMemberId: yo.teamMemberId }]
        : [{ teamMemberId: null }];
    }

    const filas = await TeamBlock.findAll({
      where,
      include: TeamMember ? [{ model: TeamMember, as: "teamMember", attributes: ["id", "displayName", "blockColor"], required: false }] : [],
      order: [["startAt", "ASC"]],
      limit: 500,
    });
    const colorGeneral = ctx.tenant?.settings?.citas?.colorBloqueos ?? null;
    const autores = await nombresDeQuienApunto(filas, ctx.tenantModels);
    return ok({ bloqueos: filas.map((f) => serializa(f, colorGeneral, autores)), yo });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    /*
     * Lo bloquea CUALQUIERA del equipo (07/08/2026, Rodrigo). Nació en admin
     * pensando que era cosa de dirección; en una consulta de dos personas eso
     * significa que quien se va de vacaciones tiene que pedirle a otra que lo
     * apunte, y entonces no se apunta.
     *
     * Pero SOLO LAS SUYAS si no es admin (10/08/2026): ver la cabecera. Cada
     * bloqueo queda además en la auditoría con su autor — que es la respuesta
     * cuando alguien pregunte por qué su agenda apareció cerrada un martes.
     */
    const { TeamBlock, TeamMember, Booking } = ctx.tenantModels;
    if (!TeamBlock) return error("Los bloqueos no están disponibles en este cliente", 503);
    const yo = await quienSoy(request, ctx);

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    /*
     * ⚠️ LA HORA VIENE PARTIDA (fecha + hora), NO COMO UN INSTANTE. Corrige el
     * fallo del 07/08/2026 que reportó Rodrigo: metía «de 7 a 9» y salía «de 9
     * a 11».
     *
     * La pantalla mandaba "2026-08-17T07:00:00", sin zona. `new Date()` de una
     * cadena así la interpreta en la hora LOCAL DE QUIEN LA LEE, y el
     * contenedor de producción va en UTC: las 7 se guardaban como las 7 UTC, o
     * sea las 9 de Madrid. En local no se veía porque mi reloj ya es de Madrid
     * — el fallo solo aparecía en el servidor.
     *
     * Con `buildMadridDate` la hora que se teclea es la hora de Madrid siempre,
     * la lea quien la lea y esté el servidor donde esté; y resuelve solo el
     * cambio de hora (+02:00 en verano, +01:00 en invierno).
     */
    const startAt = instanteDeMadrid(body.startDate, body.startTime, body.startAt);
    const endAt = instanteDeMadrid(body.endDate, body.endTime, body.endAt);
    if (!startAt) return error("La fecha u hora de inicio no es válida", 422);
    if (!endAt) return error("La fecha u hora de fin no es válida", 422);
    if (endAt <= startAt) return error("La fecha de fin tiene que ser posterior a la de inicio", 422);

    /*
     * De quién es la ausencia.
     *
     * Si NO es admin, no se mira el cuerpo de la petición: es SIEMPRE suya. Da
     * igual lo que mande el navegador —una pestaña vieja, un desplegable que no
     * se tocó, alguien curioseando con las herramientas del navegador—; el
     * servidor no acepta que un no-admin cierre la agenda de otra persona ni la
     * del centro entero.
     */
    let teamMemberId = null;
    // Su color se lee de la misma consulta que ya validaba a la persona, para
    // que la respuesta lleve el color definitivo y la agenda no parpadee.
    let colorPersona = null;

    if (!yo.esAdmin) {
      if (!yo.teamMemberId) {
        return forbidden(
          "Tu usuario no está enlazado con una ficha de equipo, así que no se sabe de quién sería la ausencia. Pídeselo a un administrador."
        );
      }
      teamMemberId = yo.teamMemberId;
      if (TeamMember) {
        const tm = await TeamMember.findByPk(teamMemberId, { attributes: ["id", "blockColor"] });
        colorPersona = tm?.blockColor ?? null;
      }
    } else {
      const tmId = typeof body.teamMemberId === "string" && body.teamMemberId.trim() ? body.teamMemberId.trim() : null;
      if (tmId) {
        if (!UUID_RE.test(tmId)) return error("teamMemberId inválido", 422);
        if (TeamMember) {
          const tm = await TeamMember.findByPk(tmId, { attributes: ["id", "blockColor"] });
          if (!tm) return error("Esa persona no está en el equipo", 422);
          colorPersona = tm.blockColor ?? null;
        }
        teamMemberId = tmId;
      }
    }

    const label = (body.label ? String(body.label).trim() : "").slice(0, 120) || "Vacaciones";
    const notes = body.notes ? String(body.notes).trim() : null;

    const fila = await TeamBlock.create({
      teamMemberId,
      startAt,
      endAt,
      label,
      notes,
      createdById: request.headers.get("x-user-id") || null,
    });

    // Citas que ya estaban dentro del tramo: NO se tocan, pero se cuentan para
    // que la pantalla pueda avisar de que hay que reubicarlas.
    let citasDentro = 0;
    if (Booking) {
      const donde = {
        scheduledAt: { [Op.gte]: startAt, [Op.lt]: endAt },
        status: { [Op.notIn]: ["cancelled", "no_show"] },
      };
      // Si el bloqueo es de una persona, solo cuentan SUS citas.
      if (teamMemberId) donde.teamMemberId = teamMemberId;
      citasDentro = await Booking.count({ where: donde });
    }

    await logCitasAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "citas.bloqueo_created",
      entity: "TeamBlock",
      entityId: fila.id,
      after: { teamMemberId, startAt, endAt, label },
      ip: request.headers.get("x-forwarded-for") ?? null,
    });

    const colorGeneral = ctx.tenant?.settings?.citas?.colorBloqueos ?? null;
    return created({
      ...serializa(fila, colorGeneral),
      color: colorDeBloqueo(colorPersona, colorGeneral),
      citasDentro,
    });
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    // Quitarlo, igual que ponerlo: si uno lo puede cerrar, tiene que poder
    // abrirlo — y con el mismo alcance. Queda auditado quién lo quita.

    const { TeamBlock } = ctx.tenantModels;
    if (!TeamBlock) return error("Los bloqueos no están disponibles en este cliente", 503);

    const id = String(new URL(request.url).searchParams.get("id") ?? "").trim();
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const fila = await TeamBlock.findByPk(id);
    if (!fila) return ok({ removed: false }); // idempotente

    /*
     * Simétrico al POST: un no-admin solo abre lo que él podría haber cerrado.
     * Sin esto, cerrar la agenda de otra persona seguiría estando a un clic —
     * solo que al revés: bastaría con borrarle sus vacaciones y dejarla
     * ofreciendo huecos el día que no está.
     */
    const yo = await quienSoy(request, ctx);
    if (!yo.esAdmin && (!fila.teamMemberId || fila.teamMemberId !== yo.teamMemberId)) {
      return forbidden(
        fila.teamMemberId
          ? "Solo puedes quitar tus propias ausencias."
          : "Los cierres de todo el centro los quita un administrador."
      );
    }

    const antes = { teamMemberId: fila.teamMemberId, startAt: fila.startAt, endAt: fila.endAt, label: fila.label };
    await fila.destroy();

    await logCitasAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "citas.bloqueo_deleted",
      entity: "TeamBlock",
      entityId: id,
      before: antes,
      ip: request.headers.get("x-forwarded-for") ?? null,
    });

    return ok({ removed: true });
  } catch (err) {
    return serverError(err);
  }
});
