import { randomUUID } from "node:crypto";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { crearRequisicion } from "../../../../lib/banco/gocardless.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";

/**
 * POST /api/banco/conectar { institutionId, origen, diasHistorico? }
 *
 * Abre la conexión con un banco: crea en GoCardless el acuerdo de SOLO LECTURA
 * (90 días de consentimiento PSD2) y la requisición, y devuelve el enlace AL
 * BANCO al que la pantalla manda al administrador. Allí se identifica con SU
 * banca online y consiente; el CRM jamás ve sus claves del banco.
 *
 * `origen` lo manda la pantalla (window.location.origin): detrás de nginx el
 * servidor no sabe con qué dominio se le está mirando, y el redirect tiene que
 * volver al MISMO sitio desde el que se salió. Se valida por forma, como las
 * URLs del portal en /api/tenant/settings.
 *
 * Solo administradores, y nunca desde las demos: son públicas con sesión de
 * admin, y esto arranca un consentimiento contra un banco REAL.
 */
export const POST = withTenant(async (request, _ctx, ctx) => {
  if (!ctx.hasModule("banco")) return forbidden("Módulo banco no activo");
  const role = ctx.user?.role;
  if (role !== "admin" && role !== "superadmin") {
    return forbidden("Solo los administradores pueden conectar el banco");
  }
  if (isDemoTenant(ctx)) return forbidden("La demo no puede conectarse a un banco real");

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }

  const institutionId = typeof body.institutionId === "string" ? body.institutionId.trim() : "";
  if (!institutionId) return error("Falta el banco (institutionId)");

  const origen = typeof body.origen === "string" ? body.origen.trim().replace(/\/+$/, "") : "";
  if (!/^https?:\/\/[^\s/]+$/i.test(origen)) {
    return error("El origen tiene que ser la dirección del CRM (https://...)");
  }

  const diasHistorico = Number(body.diasHistorico) || 90;

  const req = await crearRequisicion(ctx, {
    institutionId,
    // La vuelta cae en la propia pantalla de Banco, que al ver ?ref= remata la
    // conexión llamando a /api/banco/confirmar.
    redirect: `${origen}/facturacion/banco`,
    reference: `${ctx.slug}-${randomUUID()}`,
    diasHistorico,
  });

  return ok({ link: req.link, requisitionId: req.id });
});
