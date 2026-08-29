import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../lib/utils/apiResponse.js";
import { ladoDe, sugerenciasPara } from "../../../../lib/banco/conciliacion.js";

/**
 * GET /api/banco/sugerencias?movimiento=<id> — con qué casar un movimiento.
 *
 * Si entra dinero se buscan COBROS; si sale, GASTOS. La consulta ya trae solo
 * candidatos sin casar y del importe EXACTO (la regla de conciliacion.js: un
 * importe distinto no es «menos probable», no es él); el orden por fecha y
 * parecido de nombre lo pone `sugerenciasPara`, que es lo que fija la prueba.
 */
export const GET = withTenant(async (request, _ctx, ctx) => {
  if (!ctx.hasModule("banco")) return forbidden("Módulo banco no activo");
  const { BankTransaction, Payment, Cost, Client, Invoice } = ctx.tenantModels;
  const { searchParams } = new URL(request.url);

  const movId = searchParams.get("movimiento");
  if (!movId) return error("Falta el movimiento");
  const mov = await BankTransaction.findByPk(movId);
  if (!mov) return notFound("Movimiento no encontrado");

  const lado = ladoDe(mov);
  const objetivo = Math.abs(Number(mov.amount));

  let candidatos = [];
  if (lado === "cobro") {
    const cobros = await Payment.findAll({
      where: { bankTransactionId: null, status: "completed", amount: objetivo },
      include: [
        ...(Client ? [{ model: Client, as: "client", attributes: ["id", "name"] }] : []),
        { model: Invoice, as: "invoice", attributes: ["id", "number"] },
      ],
      order: [["paidAt", "DESC"]],
      limit: 200,
    });
    candidatos = cobros.map((p) => ({
      id: p.id,
      importe: Number(p.amount),
      fecha: p.paidAt,
      nombre: p.client?.name ?? null,
      etiqueta: [p.client?.name, p.invoice?.number].filter(Boolean).join(" · ") || "Cobro",
    }));
  } else {
    const gastos = await Cost.findAll({
      where: { bankTransactionId: null, total: objetivo },
      order: [["incurredAt", "DESC"]],
      limit: 200,
    });
    candidatos = gastos.map((c) => ({
      id: c.id,
      importe: Number(c.total),
      fecha: c.incurredAt,
      nombre: c.description ?? null,
      etiqueta: c.description ?? "Gasto",
    }));
  }

  const sugerencias = sugerenciasPara(
    { amount: Number(mov.amount), bookingDate: mov.bookingDate, counterparty: mov.counterparty },
    candidatos
  );

  return ok({ lado, sugerencias });
});
