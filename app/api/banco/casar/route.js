import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../lib/utils/apiResponse.js";
import { ladoDe } from "../../../../lib/banco/conciliacion.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";

/**
 * POST /api/banco/casar { movimiento, tipo: "cobro"|"gasto", id }
 *
 * Ata un movimiento del banco a su cobro (o gasto) del CRM. Es lo que hace que
 * desde la pantalla de Cobros se salte al movimiento con un clic.
 *
 * Reglas: un movimiento se casa con UNA sola cosa y al revés; el lado tiene que
 * cuadrar (dinero que entra ↔ cobro, dinero que sale ↔ gasto). El IMPORTE no se
 * exige igual a propósito: una transferencia real puede juntar dos cuotas o
 * venir con comisión descontada, y eso lo decide quien concilia, no un if.
 */
export const POST = withTenant(async (request, _ctx, ctx) => {
  if (!ctx.hasModule("banco")) return forbidden("Módulo banco no activo");
  const { BankTransaction, Payment, Cost } = ctx.tenantModels;

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  const { movimiento: movId, tipo, id } = body;
  if (!movId || !id) return error("Faltan el movimiento y el cobro o gasto");
  if (tipo !== "cobro" && tipo !== "gasto") return error("tipo tiene que ser 'cobro' o 'gasto'");

  const mov = await BankTransaction.findByPk(movId);
  if (!mov) return notFound("Movimiento no encontrado");

  if (ladoDe(mov) !== tipo) {
    return error(
      tipo === "cobro"
        ? "Ese movimiento es dinero que SALE: se casa con un gasto, no con un cobro"
        : "Ese movimiento es dinero que ENTRA: se casa con un cobro, no con un gasto",
      409
    );
  }

  // ¿El movimiento ya está casado con otra cosa?
  const [cobroPrevio, gastoPrevio] = await Promise.all([
    Payment.findOne({ where: { bankTransactionId: mov.id }, attributes: ["id"] }),
    Cost.findOne({ where: { bankTransactionId: mov.id }, attributes: ["id"] }),
  ]);
  if (cobroPrevio || gastoPrevio) {
    return error("Ese movimiento ya está casado. Descásalo primero si no era él.", 409);
  }

  const Modelo = tipo === "cobro" ? Payment : Cost;
  const objetivo = await Modelo.findByPk(id);
  if (!objetivo) return notFound(tipo === "cobro" ? "Cobro no encontrado" : "Gasto no encontrado");
  if (objetivo.bankTransactionId) {
    return error(`Ese ${tipo} ya está casado con otro movimiento del banco`, 409);
  }

  await objetivo.update({ bankTransactionId: mov.id });

  // El importe distinto se PERMITE pero se dice: quien mire el registro tiene
  // que poder ver que se casó 150 € del banco con un cobro de 145.
  const importeMov = Math.abs(Number(mov.amount));
  const importeObj = Math.abs(Number(objetivo.amount ?? objetivo.total));
  const descuadre = Math.abs(importeMov - importeObj) > 0.005;

  const { userId, ip } = datosPeticion(request);
  await auditar({
    tenantId: ctx.tenant.id,
    userId,
    action: "banco.movimiento.casado",
    entity: tipo === "cobro" ? "Payment" : "Cost",
    entityId: objetivo.id,
    before: null,
    after: {
      movimiento: mov.id,
      fechaBanco: mov.bookingDate,
      importeBanco: String(mov.amount),
      ...(descuadre ? { descuadre: `banco ${importeMov.toFixed(2)} vs CRM ${importeObj.toFixed(2)}` } : {}),
    },
    ip,
  });

  return ok({ casado: true, descuadre });
});
