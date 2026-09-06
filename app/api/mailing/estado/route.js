import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { exigirMailing, esAdmin } from "../../../../lib/mailing/comun.js";
import { getTenantSesConfig, cuentaSes, identidadDelRemitente } from "../../../../lib/mailing/ses.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { vocabularioCliente } from "../../../../lib/clients/vocabulario.js";
import { marcasYModulosAsignables } from "../../../../lib/clients/moduleAssignments.js";
import { usaEstadoDeFicha, estadosDeFicha } from "../../../../lib/clients/estados.js";

/**
 * GET /api/mailing/estado — lo que la pantalla necesita saber antes de dejar
 * hacer nada: si Amazon SES está configurado y en qué estado está la cuenta
 * (sandbox, cupo diario), si esto es una demo (botón de enviar bloqueado), el
 * idioma del centro y qué filtros de segmento tienen sentido aquí.
 *
 * Es el equivalente de `/api/correo/remitentes`: el botón no miente porque
 * antes de pintarlo se ha preguntado.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  const cfg = getTenantSesConfig(ctx);
  const demo = isDemoTenant(ctx);

  let cuenta = null;
  let remitente = null;
  if (cfg.configurado && !demo && new URL(request.url).searchParams.get("comprobar") === "1") {
    cuenta = await cuentaSes(cfg);
    remitente = await identidadDelRemitente(cfg);
  }

  const tieneModulo = (k) => ctx.tenantHasModule(k);
  const conClientes = tieneModulo("clients");
  const conEstado = conClientes && usaEstadoDeFicha(tieneModulo);

  return ok({
    demo,
    puedeConfigurar: esAdmin(ctx),
    ses: {
      configurado: cfg.configurado,
      region: cfg.region,
      fromEmail: cfg.fromEmail,
      fromName: cfg.fromName,
      configurationSet: cfg.configurationSet,
      cuenta,
      remitente,
    },
    vocab: vocabularioCliente(tieneModulo),
    segmentos: {
      conClientes,
      conCitas: tieneModulo("citas"),
      // Los módulos por los que se puede filtrar: los que la ficha deja marcar.
      modulos: conClientes ? marcasYModulosAsignables(tieneModulo) : [],
      estados: conEstado ? estadosDeFicha().map((e) => ({ key: e.key, label: e.label })) : [],
    },
  });
});
