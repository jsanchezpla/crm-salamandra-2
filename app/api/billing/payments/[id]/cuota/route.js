import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { cobroSePuedeRehacer, mesVigente } from "../../../../../../lib/billing/cuotas.js";
import { loQuePasaConLaCuota, mesDelCobro } from "../../../../../../lib/billing/cuotaDelCobro.js";

/**
 * GET /api/billing/payments/[id]/cuota — qué le pasa a la cuota si se borra este
 * cobro (18/09/2026, AV-0190 de Aumenta: «no sabemos si eliminando los cobros
 * uno a uno se elimina la cuota, o para vosotros es lo mismo cobro que cuota»).
 *
 * La pantalla lo pide ANTES de preguntar, para poder preguntar con los números
 * delante —igual que hace borrar una cuota con sus cobros (01/09/2026)—: cuántos
 * cobros más tiene esa cuota, cuántos se irían con ella, cuántos de esos son de
 * meses que aún no han llegado (los que había que borrar uno a uno) y cuántos se
 * quedarían en el histórico por ser ya dinero o papel. La regla y las frases,
 * con su prueba, en `lib/billing/cuotaDelCobro.js`.
 *
 * Solo lee. Lo que borra es el DELETE del cobro, con `?cuota=1`.
 */
export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Payment, Cuota } = tenantModels;
    const { id } = await params;

    const payment = await Payment.findByPk(id);
    if (!payment) return notFound("Cobro no encontrado");
    if (!payment.cuotaId || !Cuota) return ok(loQuePasaConLaCuota({ cobro: payment }));

    // Sin tabla de cuotas en este schema se contesta lo mismo que sin cuota: no
    // hay nada que avisar y desde luego nada que ofrecer borrar.
    let cuota = null;
    let hermanos = [];
    try {
      cuota = await Cuota.findByPk(payment.cuotaId);
      hermanos = await Payment.findAll({ where: { cuotaId: payment.cuotaId } });
    } catch {
      return ok(loQuePasaConLaCuota({ cobro: payment }));
    }

    const otros = hermanos.filter((p) => String(p.id) !== String(payment.id));
    const seVan = otros.filter((p) => cobroSePuedeRehacer(p).ok);
    // «Futuro» es el mes del cobro, no su fecha: lo que la cuota deja puesto por
    // delante son meses enteros (`lib/billing/cobrosDelTramo.js`), y el mes en
    // curso no es futuro aunque su día de cobro todavía no haya llegado.
    const ahora = mesVigente();
    const futuros = seVan.filter((p) => (mesDelCobro(p) ?? "") > ahora);

    return ok(
      loQuePasaConLaCuota({
        cobro: payment,
        cuota,
        otrosCobros: otros.length,
        otrosBorrables: seVan.length,
        otrosFuturos: futuros.length,
      })
    );
  } catch (err) {
    return serverError(err);
  }
});
