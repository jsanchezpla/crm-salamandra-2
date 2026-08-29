import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { tenantTieneBanco } from "../../../../lib/banco/gocardlessConfig.js";

/**
 * GET /api/banco/estado — la foto de la conexión bancaria del tenant.
 *
 * Lo que la pantalla de Banco necesita para decidir qué enseñar: si hay
 * credenciales (BYOK de GoCardless), qué cuentas hay conectadas y cuánto
 * trabajo de conciliación queda. Solo lectura.
 */
export const GET = withTenant(async (request, _ctx, ctx) => {
  try {
    if (!ctx.hasModule("banco")) return forbidden("Módulo banco no activo");
    const { BankAccount, BankTransaction, Payment, Cost } = ctx.tenantModels;

    const cuentas = await BankAccount.findAll({ order: [["createdAt", "ASC"]] });

    const [totalMovimientos, casadosCobro, casadosGasto] = await Promise.all([
      BankTransaction.count(),
      Payment.count({ where: { bankTransactionId: { [Op.ne]: null } } }),
      Cost.count({ where: { bankTransactionId: { [Op.ne]: null } } }),
    ]);

    const ahora = Date.now();
    return ok({
      // ¿Hay credenciales? La tarjeta para ponerlas vive en Configuración →
      // Conexiones (la Configuración es universal, regla #14).
      configured: tenantTieneBanco(ctx),
      cuentas: cuentas.map((c) => ({
        id: c.id,
        institutionName: c.institutionName,
        iban: c.iban,
        name: c.name,
        status:
          // El consentimiento PSD2 caducado se enseña como tal aunque nadie
          // haya vuelto a sincronizar desde entonces.
          c.status === "linked" && c.agreementExpiresAt && new Date(c.agreementExpiresAt).getTime() < ahora
            ? "expired"
            : c.status,
        agreementExpiresAt: c.agreementExpiresAt,
        lastSyncedAt: c.lastSyncedAt,
        lastSyncError: c.lastSyncError,
      })),
      totalMovimientos,
      sinCasar: Math.max(0, totalMovimientos - casadosCobro - casadosGasto),
    });
  } catch (err) {
    return serverError(err);
  }
});
