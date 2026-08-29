import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound } from "../../../../../lib/utils/apiResponse.js";
import { isDemoTenant } from "../../../../../lib/demo/isDemo.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";

/**
 * DELETE /api/banco/cuentas/[id] — quitar una cuenta conectada.
 *
 * Se lleva la cuenta Y su extracto (los movimientos son una copia del banco:
 * reconectar los vuelve a traer), pero NO toca el dinero del CRM: los cobros y
 * gastos que estaban casados con esos movimientos se quedan, solo pierden el
 * enlace. La pantalla lo avisa antes de pedirlo.
 */
export const DELETE = withTenant(async (request, routeContext, ctx) => {
  if (!ctx.hasModule("banco")) return forbidden("Módulo banco no activo");
  const role = ctx.user?.role;
  if (role !== "admin" && role !== "superadmin") {
    return forbidden("Solo los administradores pueden quitar una cuenta");
  }
  if (isDemoTenant(ctx)) return forbidden("La demo no gestiona cuentas bancarias");

  const { id } = await routeContext.params;
  const { BankAccount, BankTransaction, Payment, Cost } = ctx.tenantModels;

  const cuenta = await BankAccount.findByPk(id);
  if (!cuenta) return notFound("Cuenta no encontrada");

  // Primero se sueltan los enlaces desde cobros y gastos: la FK de la tabla
  // borra los movimientos en cascada, pero payments/costs no llevan FK y se
  // quedarían apuntando a filas que ya no existen.
  const movimientos = await BankTransaction.findAll({
    where: { bankAccountId: cuenta.id },
    attributes: ["id"],
    raw: true,
  });
  const ids = movimientos.map((m) => m.id);
  let desenlazados = 0;
  if (ids.length) {
    const [cobros] = await Payment.update(
      { bankTransactionId: null },
      { where: { bankTransactionId: { [Op.in]: ids } } }
    );
    const [gastos] = await Cost.update(
      { bankTransactionId: null },
      { where: { bankTransactionId: { [Op.in]: ids } } }
    );
    desenlazados = cobros + gastos;
  }

  const resumen = { banco: cuenta.institutionName, iban: cuenta.iban, movimientos: ids.length, desenlazados };
  await BankTransaction.destroy({ where: { bankAccountId: cuenta.id } });
  await cuenta.destroy();

  const { userId, ip } = datosPeticion(request);
  await auditar({
    tenantId: ctx.tenant.id,
    userId,
    action: "banco.cuenta.eliminada",
    entity: "BankAccount",
    entityId: id,
    before: resumen,
    after: null,
    ip,
  });

  return ok({ eliminada: true, ...resumen });
});
