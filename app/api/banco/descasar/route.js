import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";

/**
 * POST /api/banco/descasar { movimiento }
 *
 * Deshace un casado (se ató al cobro o gasto equivocado). No borra nada: el
 * movimiento vuelve a «sin casar» y el cobro/gasto queda como estaba.
 */
export const POST = withTenant(async (request, _ctx, ctx) => {
  if (!ctx.hasModule("billing_banco")) return forbidden("Módulo billing_banco no activo");
  const { BankTransaction, Payment, Cost } = ctx.tenantModels;

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  const movId = body.movimiento;
  if (!movId) return error("Falta el movimiento");

  const mov = await BankTransaction.findByPk(movId);
  if (!mov) return notFound("Movimiento no encontrado");

  const [cobro, gasto] = await Promise.all([
    Payment.findOne({ where: { bankTransactionId: mov.id } }),
    Cost.findOne({ where: { bankTransactionId: mov.id } }),
  ]);
  const objetivo = cobro ?? gasto;
  if (!objetivo) return error("Ese movimiento no estaba casado con nada", 409);

  await objetivo.update({ bankTransactionId: null });

  const { userId, ip } = datosPeticion(request);
  await auditar({
    tenantId: ctx.tenant.id,
    userId,
    action: "banco.movimiento.descasado",
    entity: cobro ? "Payment" : "Cost",
    entityId: objetivo.id,
    before: { movimiento: mov.id, fechaBanco: mov.bookingDate, importeBanco: String(mov.amount) },
    after: null,
    ip,
  });

  return ok({ descasado: true });
});
