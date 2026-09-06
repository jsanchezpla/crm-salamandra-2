import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { exigirMailing } from "../../../../lib/mailing/comun.js";
import { costeEstimado, cuentaSes, getTenantSesConfig } from "../../../../lib/mailing/ses.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { madridYearMonth } from "../../../../lib/utils/madridDate.js";

/**
 * GET /api/mailing/uso — el contador de cuota (plan, entregable 7): cuántos
 * correos han salido este mes y lo que cuestan, y lo que AWS dice de la cuenta
 * (cupo de 24 h, ritmo, sandbox). Para que el cliente vea lo que lleva gastado
 * ANTES de darle a enviar.
 *
 * El recuento sale de `mailing_sends` (estado enviado/rebotado/queja con
 * `enviado_at` en el mes de Madrid), no de un contador aparte que pueda
 * desviarse: la verdad está en las filas.
 */
function inicioDeMes(ahora = new Date()) {
  const { year, month } = madridYearMonth(ahora);
  // Medianoche de Madrid del día 1: entre +01:00 y +02:00 según la época.
  const candidatos = ["+02:00", "+01:00"].map((off) => new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00${off}`));
  return candidatos.find((d) => madridYearMonth(d).month === month) ?? candidatos[1];
}

export const GET = withTenant(async (_request, _rc, ctx) => {
  exigirMailing(ctx);
  const { MailingSend } = ctx.tenantModels;
  const desde = inicioDeMes();

  const enviadosMes = await MailingSend.count({
    where: { estado: { [Op.in]: ["enviado", "rebotado", "queja"] }, enviadoAt: { [Op.gte]: desde } },
  });
  const enviadosTotal = await MailingSend.count({ where: { estado: { [Op.in]: ["enviado", "rebotado", "queja"] } } });
  const quejas = await MailingSend.count({ where: { estado: "queja" } });
  const rebotes = await MailingSend.count({ where: { estado: "rebotado" } });

  const cfg = getTenantSesConfig(ctx);
  const cuenta = cfg.configurado && !isDemoTenant(ctx) ? await cuentaSes(cfg) : null;

  return ok({
    mes: { desde, enviados: enviadosMes, costeUsd: costeEstimado(enviadosMes) },
    total: {
      enviados: enviadosTotal,
      rebotes,
      quejas,
      // AWS pone la cuenta en revisión al pasar del 0,1 % y la para en el 0,5 %.
      tasaQuejas: enviadosTotal ? Math.round((quejas / enviadosTotal) * 100000) / 1000 : 0,
      tasaRebotes: enviadosTotal ? Math.round((rebotes / enviadosTotal) * 100000) / 1000 : 0,
    },
    precioPorMil: 0.1,
    cuenta,
  });
});
