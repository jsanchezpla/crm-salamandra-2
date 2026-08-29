import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../lib/utils/apiResponse.js";
import { transaccionesDeCuenta } from "../../../../lib/banco/gocardless.js";
import { normalizarTransaccion } from "../../../../lib/banco/conciliacion.js";

/**
 * POST /api/banco/sincronizar — trae del banco los movimientos nuevos.
 *
 * Se lanza A MANO desde la pantalla, nunca en bucle: los bancos limitan las
 * consultas POR CUENTA Y DÍA (cuatro en muchos casos), así que cada pulsación
 * cuenta. Dos frenos:
 *   · 15 minutos entre sincronizaciones de la misma cuenta (contra el doble
 *     clic y contra el F5 compulsivo);
 *   · el consentimiento caducado no se intenta: se marca `expired` y se pide
 *     reconectar, que es lo único que lo arregla.
 *
 * Idempotente: el UNIQUE (cuenta, uid del movimiento) hace que lo ya guardado
 * se salte. Solo movimientos CONTABILIZADOS (ver lib/banco/gocardless.js).
 * Un fallo en una cuenta no tumba a las demás: queda en su `lastSyncError`.
 */
const FRENO_MS = 15 * 60 * 1000;

function haceDias(dias) {
  const d = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export const POST = withTenant(async (request, _ctx, ctx) => {
  if (!ctx.hasModule("banco")) return forbidden("Módulo banco no activo");
  const { BankAccount, BankTransaction } = ctx.tenantModels;

  const cuentas = await BankAccount.findAll({ order: [["createdAt", "ASC"]] });
  const resultados = [];
  let totalNuevos = 0;

  for (const cuenta of cuentas) {
    const etiqueta = cuenta.institutionName || cuenta.iban || cuenta.id;

    if (cuenta.status === "suspended") {
      resultados.push({ cuenta: etiqueta, estado: "suspendida", nuevos: 0 });
      continue;
    }
    const caducada =
      cuenta.status === "expired" ||
      (cuenta.agreementExpiresAt && new Date(cuenta.agreementExpiresAt).getTime() < Date.now());
    if (caducada) {
      if (cuenta.status !== "expired") await cuenta.update({ status: "expired" });
      resultados.push({
        cuenta: etiqueta,
        estado: "consentimiento caducado — hay que reconectar el banco",
        nuevos: 0,
      });
      continue;
    }
    if (cuenta.lastSyncedAt && Date.now() - new Date(cuenta.lastSyncedAt).getTime() < FRENO_MS) {
      resultados.push({ cuenta: etiqueta, estado: "sincronizada hace nada — se salta", nuevos: 0 });
      continue;
    }

    try {
      // Desde el último movimiento guardado menos una semana (el banco asienta
      // con retraso y a veces recoloca); la primera vez, 90 días — lo que el
      // consentimiento estándar deja pedir.
      const ultimo = await BankTransaction.max("bookingDate", { where: { bankAccountId: cuenta.id } });
      const desde = ultimo
        ? new Date(new Date(ultimo).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        : haceDias(90);

      const crudas = await transaccionesDeCuenta(ctx, cuenta.accountUid, { desde });
      const filas = crudas
        .map((tx) => {
          const fila = normalizarTransaccion(tx);
          return fila ? { ...fila, raw: tx } : null;
        })
        .filter(Boolean);

      let nuevos = 0;
      if (filas.length) {
        const uids = filas.map((f) => f.uid);
        const existentes = await BankTransaction.findAll({
          where: { bankAccountId: cuenta.id, transactionUid: { [Op.in]: uids } },
          attributes: ["transactionUid"],
          raw: true,
        });
        const yaGuardados = new Set(existentes.map((e) => e.transactionUid));
        const aCrear = filas
          .filter((f) => !yaGuardados.has(f.uid))
          .map((f) => ({
            bankAccountId: cuenta.id,
            transactionUid: f.uid,
            bookingDate: f.bookingDate,
            valueDate: f.valueDate,
            amount: f.amount,
            currency: f.currency,
            concept: f.concept,
            counterparty: f.counterparty,
            raw: f.raw,
          }));
        if (aCrear.length) {
          // `ignoreDuplicates` por si dos personas sincronizan a la vez: el
          // UNIQUE decide y nadie ve un 500 por ganar una carrera.
          await BankTransaction.bulkCreate(aCrear, { ignoreDuplicates: true });
          nuevos = aCrear.length;
        }
      }

      await cuenta.update({ lastSyncedAt: new Date(), lastSyncError: null });
      totalNuevos += nuevos;
      resultados.push({ cuenta: etiqueta, estado: "ok", nuevos });
    } catch (err) {
      // El fallo queda EN LA CUENTA para que la pantalla lo enseñe; las demás
      // cuentas siguen. Un 429 aquí es normal: el banco raciona por día.
      await cuenta.update({ lastSyncError: String(err.message).slice(0, 500) }).catch(() => {});
      resultados.push({ cuenta: etiqueta, estado: `error: ${err.message}`, nuevos: 0 });
    }
  }

  return ok({ resultados, totalNuevos });
});
