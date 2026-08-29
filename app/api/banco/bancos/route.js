import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../lib/utils/apiResponse.js";
import { listarBancos } from "../../../../lib/banco/gocardless.js";

/**
 * GET /api/banco/bancos — los bancos españoles a los que se puede conectar.
 *
 * La lista viene de GoCardless con las credenciales DEL TENANT; sin ellas, la
 * capa de banco lanza un 503 con el aviso de Configuración (mismo patrón que la
 * IA: sin clave no se llama con la de nadie). Los AppError de esa capa los
 * convierte withTenant en respuestas con su estado — no se tapan aquí.
 */
export const GET = withTenant(async (request, _ctx, ctx) => {
  if (!ctx.hasModule("banco")) return forbidden("Módulo banco no activo");
  const { searchParams } = new URL(request.url);
  const pais = (searchParams.get("pais") || "es").toLowerCase().slice(0, 2);
  const bancos = await listarBancos(ctx, pais);
  return ok({ bancos });
});
