import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../lib/utils/apiResponse.js";

/**
 * GET /api/banco/movimientos — el extracto, con su estado de conciliación.
 *
 * Cada movimiento sale anotado con QUÉ cobro o gasto lo tiene casado (el enlace
 * vive en payments/costs.bank_transaction_id, ver BankTransaction.model.js).
 * Filtros: ?estado=sin_casar|casados, ?q= (concepto o contraparte), ?cuenta=,
 * paginación page/limit como el resto de Facturación.
 */
export const GET = withTenant(async (request, _ctx, ctx) => {
  if (!ctx.hasModule("banco")) return forbidden("Módulo banco no activo");
  const { BankAccount, BankTransaction, Payment, Cost, Client, Invoice } = ctx.tenantModels;
  const { searchParams } = new URL(request.url);

  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(200, parseInt(searchParams.get("limit") || "50"));
  const offset = (page - 1) * limit;

  // Lo casado se resuelve ANTES para poder filtrar por estado: el enlace vive
  // en payments/costs, no en el movimiento.
  const [cobrosCasados, gastosCasados] = await Promise.all([
    Payment.findAll({
      where: { bankTransactionId: { [Op.ne]: null } },
      attributes: ["id", "amount", "paidAt", "bankTransactionId"],
      include: [
        ...(Client ? [{ model: Client, as: "client", attributes: ["id", "name"] }] : []),
        { model: Invoice, as: "invoice", attributes: ["id", "number"] },
      ],
    }),
    Cost.findAll({
      where: { bankTransactionId: { [Op.ne]: null } },
      attributes: ["id", "description", "total", "incurredAt", "bankTransactionId"],
    }),
  ]);

  const casadoPor = new Map();
  for (const p of cobrosCasados) {
    casadoPor.set(p.bankTransactionId, {
      tipo: "cobro",
      id: p.id,
      texto: p.client?.name ?? p.invoice?.number ?? "Cobro",
      importe: Number(p.amount),
      fecha: p.paidAt,
    });
  }
  for (const c of gastosCasados) {
    casadoPor.set(c.bankTransactionId, {
      tipo: "gasto",
      id: c.id,
      texto: c.description ?? "Gasto",
      importe: Number(c.total),
      fecha: c.incurredAt,
    });
  }

  const where = {};
  // Un movimiento concreto: es como llega el botón «Banco» de la pantalla de
  // Cobros, que trae el id del movimiento conciliado.
  if (searchParams.get("id")) where.id = searchParams.get("id");
  if (searchParams.get("cuenta")) where.bankAccountId = searchParams.get("cuenta");
  const q = (searchParams.get("q") || "").trim();
  if (q) {
    where[Op.or] = [{ concept: { [Op.iLike]: `%${q}%` } }, { counterparty: { [Op.iLike]: `%${q}%` } }];
  }
  const estado = searchParams.get("estado");
  const idsCasados = [...casadoPor.keys()];
  if (estado === "sin_casar" && idsCasados.length) where.id = { [Op.notIn]: idsCasados };
  if (estado === "casados") {
    if (!idsCasados.length) return ok({ movimientos: [], total: 0, page, limit });
    where.id = { [Op.in]: idsCasados };
  }

  const { count, rows } = await BankTransaction.findAndCountAll({
    where,
    include: [{ model: BankAccount, as: "account", attributes: ["id", "institutionName", "iban", "name"] }],
    order: [["bookingDate", "DESC"], ["createdAt", "DESC"]],
    limit,
    offset,
  });

  return ok({
    movimientos: rows.map((m) => ({
      id: m.id,
      bookingDate: m.bookingDate,
      amount: Number(m.amount),
      currency: m.currency,
      concept: m.concept,
      counterparty: m.counterparty,
      account: m.account
        ? { id: m.account.id, institutionName: m.account.institutionName, iban: m.account.iban, name: m.account.name }
        : null,
      casadoCon: casadoPor.get(m.id) ?? null,
    })),
    total: count,
    page,
    limit,
  });
});
