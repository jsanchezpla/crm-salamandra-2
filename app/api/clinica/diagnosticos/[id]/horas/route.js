import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, errorConDatos, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { resolveCurrentTeamMemberId } from "../../../../../../lib/team/currentTeamMember.js";
import { puedeDarBonos } from "../../../../../../lib/citas/quienDaBonos.js";
import { puedeDesbloquear, estaAbierto, ROTULO_ESTADO } from "../../../../../../lib/clinica/diagnostico.js";
import { UUID_RE, MOTIVO_SIN_PERMISO_DIAGNOSTICO } from "../../../../../../lib/clinica/diagnosticoFila.js";
import { tablaAusente, filasDe } from "../../../../../../lib/clinica/diagnosticoDb.js";

/**
 * POST /api/clinica/diagnosticos/[id]/horas — «Desbloquear horas»: subir el
 * tope de un expediente (12/09/2026).
 *
 * `{ horasMax }`, solo hacia arriba y de media en media (`puedeDesbloquear`):
 * bajar el tope a un expediente con citas dadas sería reescribir lo que ya
 * pasó. Queda escrito quién y cuándo (`horas_desbloqueadas_por/_at`) y una
 * línea en la auditoría con el antes y el después.
 *
 * Solo dirección o quien lleve Facturación (`puedeDarBonos`): más horas es
 * más dinero o más regalo, y eso lo decide quien lleva la caja. Solo en un
 * expediente ABIERTO (entrevista o en curso): uno parado o cerrado no va a
 * tener citas nuevas que necesiten hueco.
 */
export const POST = withTenant(async (request, routeCtx, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  if (!hasModule("clinica")) return forbidden();
  const puedeDecidir = puedeDarBonos({ role: request.headers.get("x-user-role") ?? "user", hasModule });
  if (!puedeDecidir) return forbidden(MOTIVO_SIN_PERMISO_DIAGNOSTICO);

  try {
    const { Diagnostico } = tenantModels;
    const { id } = (await routeCtx?.params) ?? {};
    if (!Diagnostico || !UUID_RE.test(String(id ?? ""))) return notFound("Ese diagnóstico no existe");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const expediente = await Diagnostico.findByPk(id);
    if (!expediente) return notFound("Ese diagnóstico no existe");
    if (!estaAbierto(expediente)) {
      return errorConDatos(
        `Solo se desbloquean horas en un diagnóstico abierto (este está en «${ROTULO_ESTADO[expediente.status] ?? expediente.status}»)`,
        409,
        { status: expediente.status }
      );
    }

    const antes = expediente.horasMax;
    const nuevo = Number(body?.horasMax);
    const v = puedeDesbloquear(antes, nuevo);
    if (!v.ok) return error(v.motivo, 422);

    // Quién: la ficha de equipo de quien pide o, sin ella (dirección que no da
    // consulta), su usuario. La auditoría guarda el usuario siempre.
    const quien = (await resolveCurrentTeamMemberId(request, tenantModels)) ?? request.headers.get("x-user-id") ?? null;
    await expediente.update({ horasMax: nuevo, horasDesbloqueadasPor: quien, horasDesbloqueadasAt: new Date() });

    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "diagnostico.horas_desbloqueadas",
      entity: "Diagnostico",
      entityId: expediente.id,
      before: { horasMax: antes },
      after: { horasMax: nuevo, patientId: expediente.patientId, productoKey: expediente.productoKey },
    });

    const [fila] = await filasDe({ tenantModels, expedientes: [expediente], puedeDecidir });
    return ok({ expediente: fila, horasMax: { antes, ahora: nuevo } });
  } catch (err) {
    if (tablaAusente(err)) return notFound("Ese diagnóstico no existe");
    return serverError(err);
  }
});
