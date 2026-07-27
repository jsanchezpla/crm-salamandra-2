import { Op, fn, col } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { parsePeriodString } from "../../../../lib/clinica/period.js";
import { madridYearMonth } from "../../../../lib/utils/madridDate.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * GET /api/citas/informe-ocupacion?periodo=YYYY-MM
 *
 * Informe de agenda para dirección: cuántas citas hubo, cuántas se atendieron,
 * cuántas se cayeron y —lo importante— a cuántas NO SE PRESENTÓ NADIE, por
 * profesional.
 *
 * QUÉ RESUELVE: las citas ya registraban el estado "no presentado" desde
 * siempre, pero ese dato no se agregaba en ninguna pantalla: había que contarlo
 * a mano cita por cita. Es el primer número que pide quien dirige un centro,
 * porque una silla vacía es una hora facturable perdida.
 *
 * Solo admin (rol FRESCO de BD): cruza datos de todo el equipo.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");

    const { searchParams } = new URL(request.url);
    // Sin periodo → mes en curso EN MADRID (el contenedor va en UTC: usar la
    // fecha del servidor daría el mes equivocado la noche del día 1).
    const crudo = searchParams.get("periodo");
    const periodo = crudo ? parsePeriodString(crudo) : madridYearMonth();
    if (!periodo) return error("periodo debe tener el formato YYYY-MM", 400);
    const { year, month } = periodo;

    const desde = new Date(Date.UTC(year, month - 1, 1));
    const hasta = new Date(Date.UTC(year, month, 1));

    const { Booking, TeamMember, EventType } = ctx.tenantModels;
    const tieneEquipo = ctx.tenantHasModule ? ctx.tenantHasModule("team") : ctx.hasModule("team");

    const filas = await Booking.findAll({
      where: { scheduledAt: { [Op.gte]: desde, [Op.lt]: hasta } },
      attributes: [
        "teamMemberId",
        "status",
        [fn("count", col("id")), "n"],
        [fn("sum", col("duration")), "minutos"],
      ],
      group: ["teamMemberId", "status"],
      raw: true,
    });

    // Nombres de los profesionales (si el tenant tiene módulo equipo).
    const nombres = {};
    if (tieneEquipo && TeamMember) {
      try {
        const miembros = await TeamMember.findAll({ attributes: ["id", "displayName"] });
        for (const m of miembros) nombres[m.id] = m.displayName;
      } catch { /* schema parcial: se muestran sin nombre */ }
    }

    // Agregado por profesional.
    const porProfesional = new Map();
    const vacio = () => ({
      total: 0, atendidas: 0, canceladas: 0, noShow: 0, pendientes: 0, minutosAtendidos: 0,
    });

    for (const f of filas) {
      const clave = f.teamMemberId || "__sin_asignar__";
      if (!porProfesional.has(clave)) porProfesional.set(clave, vacio());
      const acc = porProfesional.get(clave);
      const n = Number(f.n) || 0;
      const minutos = Number(f.minutos) || 0;

      acc.total += n;
      if (f.status === "completed" || f.status === "confirmed") {
        acc.atendidas += n;
        acc.minutosAtendidos += minutos;
      } else if (f.status === "cancelled") {
        acc.canceladas += n;
      } else if (f.status === "no_show") {
        acc.noShow += n;
      } else if (f.status === "pending") {
        acc.pendientes += n;
      }
    }

    const profesionales = [...porProfesional.entries()]
      .map(([id, v]) => {
        // Tasa de ausencias sobre las citas que LLEGARON a su hora (atendidas +
        // no presentadas). Las canceladas con aviso NO cuentan: cancelar a
        // tiempo es justo lo que se quiere fomentar, penalizarlo sería absurdo.
        const base = v.atendidas + v.noShow;
        return {
          teamMemberId: id === "__sin_asignar__" ? null : id,
          nombre: id === "__sin_asignar__" ? "Sin profesional asignado" : nombres[id] || "(profesional eliminado)",
          ...v,
          horasAtendidas: Math.round((v.minutosAtendidos / 60) * 10) / 10,
          tasaNoShow: base > 0 ? Math.round((v.noShow / base) * 1000) / 10 : null,
        };
      })
      .sort((a, b) => b.total - a.total);

    const totales = profesionales.reduce(
      (acc, p) => ({
        total: acc.total + p.total,
        atendidas: acc.atendidas + p.atendidas,
        canceladas: acc.canceladas + p.canceladas,
        noShow: acc.noShow + p.noShow,
        pendientes: acc.pendientes + p.pendientes,
        minutosAtendidos: acc.minutosAtendidos + p.minutosAtendidos,
      }),
      { total: 0, atendidas: 0, canceladas: 0, noShow: 0, pendientes: 0, minutosAtendidos: 0 }
    );
    const baseTotal = totales.atendidas + totales.noShow;

    // Reparto por tipo de cita: qué servicios llenan la agenda.
    let porServicio = [];
    try {
      const filasET = await Booking.findAll({
        where: { scheduledAt: { [Op.gte]: desde, [Op.lt]: hasta } },
        attributes: ["eventTypeId", [fn("count", col("id")), "n"]],
        group: ["eventTypeId"],
        raw: true,
      });
      const tipos = EventType ? await EventType.findAll({ attributes: ["id", "name"] }) : [];
      const nombreTipo = Object.fromEntries(tipos.map((t) => [t.id, t.name]));
      porServicio = filasET
        .map((f) => ({ nombre: nombreTipo[f.eventTypeId] || "(tipo eliminado)", n: Number(f.n) || 0 }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 10);
    } catch { /* sin tipos: se omite el reparto */ }

    return ok({
      periodo: `${year}-${String(month).padStart(2, "0")}`,
      totales: {
        ...totales,
        horasAtendidas: Math.round((totales.minutosAtendidos / 60) * 10) / 10,
        tasaNoShow: baseTotal > 0 ? Math.round((totales.noShow / baseTotal) * 1000) / 10 : null,
        tasaCancelacion: totales.total > 0 ? Math.round((totales.canceladas / totales.total) * 1000) / 10 : null,
      },
      profesionales,
      porServicio,
    });
  } catch (err) {
    return serverError(err);
  }
});
