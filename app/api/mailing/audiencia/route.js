import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { exigirMailing, leerBody } from "../../../../lib/mailing/comun.js";
import { contarAudiencia, resolverAudiencia } from "../../../../lib/mailing/audiencia.js";

/**
 * /api/mailing/audiencia — quién recibiría un correo.
 *
 *   GET            la lista entera de «todos los que han dicho que sí»: las
 *                  fichas con la casilla de novedades y los correos sueltos
 *                  activos. Es la pantalla «Lista» del módulo.
 *   POST {reglas}  cuánta gente cae en unas reglas de segmento (recuento y
 *                  muestra), para el editor de segmentos y para el aviso de
 *                  «esto va a salir a N personas» antes de enviar.
 *
 * Las dos pasan por `lib/mailing/audiencia.js`, que es el único sitio donde se
 * decide a quién se escribe: lo que se ve aquí es exactamente lo que saldrá.
 */
const LIMITE_LISTA = 1000;

export const GET = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  const q = (new URL(request.url).searchParams.get("q") || "").trim().toLowerCase();
  const r = await resolverAudiencia(ctx, {}, { conClientes: ctx.tenantHasModule("clients") });
  let lista = r.destinatarios;
  if (q) lista = lista.filter((d) => d.email.includes(q) || (d.nombre ?? "").toLowerCase().includes(q));
  return ok({
    total: r.total,
    clientes: r.clientes,
    contactos: r.contactos,
    suprimidos: r.suprimidos,
    sinCasilla: r.sinCasilla,
    destinatarios: lista.slice(0, LIMITE_LISTA),
    truncada: lista.length > LIMITE_LISTA,
  });
});

export const POST = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  const body = await leerBody(request);
  const r = await contarAudiencia(ctx, body.reglas ?? {}, { conClientes: ctx.tenantHasModule("clients") });
  return ok(r);
});
