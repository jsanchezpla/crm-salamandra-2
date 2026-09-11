import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, errorConDatos, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../../../lib/utils/auditoria.js";
import { puedeDarBonos } from "../../../../../../lib/citas/quienDaBonos.js";
import { puedePasarA, ROTULO_ESTADO } from "../../../../../../lib/clinica/diagnostico.js";
import { UUID_RE } from "../../../../../../lib/clinica/diagnosticoFila.js";
import { tablaAusente, filasDe, horasDelExpediente } from "../../../../../../lib/clinica/diagnosticoDb.js";

/**
 * POST /api/clinica/diagnosticos/[id]/cerrar — cerrar un expediente a mano
 * (12/09/2026; la unión con el informe de valoración diagnóstica es la
 * segunda entrega).
 *
 * Desde cualquier estado que pueda pasar a `cerrado` (`puedePasarA`: en
 * curso, parado o incluso con la entrevista sin dar, si la familia no vuelve).
 * Lo cierra cualquiera del equipo con `clinica`: cerrar no mueve dinero, es
 * decir que el trabajo terminó. El bono no se toca: sigue activo y sin tope,
 * y es el expediente cerrado el que corta las citas nuevas
 * (`cabeCitaEnExpediente`); el cobro pendiente, si lo hay, sigue en Cobros
 * hasta que se cobre.
 *
 * La respuesta dice cuántas horas quedaron por dar (`horasSinDar`) y si había
 * citas futuras (`citasFuturas`): la pantalla avisa antes de cerrar con la
 * agenda llena, pero no se corta aquí — cerrar con citas puestas es una
 * decisión del centro, no un error.
 */
export const POST = withTenant(async (request, routeCtx, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  if (!hasModule("clinica")) return forbidden();

  try {
    const { Diagnostico } = tenantModels;
    const { id } = (await routeCtx?.params) ?? {};
    if (!Diagnostico || !UUID_RE.test(String(id ?? ""))) return notFound("Ese diagnóstico no existe");

    const expediente = await Diagnostico.findByPk(id);
    if (!expediente) return notFound("Ese diagnóstico no existe");
    if (!puedePasarA(expediente.status, "cerrado")) {
      return errorConDatos(
        `Este diagnóstico ya está «${ROTULO_ESTADO[expediente.status] ?? expediente.status}»`,
        409,
        { status: expediente.status }
      );
    }

    const horas = await horasDelExpediente(tenantModels, expediente);
    const desde = expediente.status;
    await expediente.update({ status: "cerrado" });

    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "diagnostico.cerrado",
      entity: "Diagnostico",
      entityId: expediente.id,
      before: { status: desde },
      after: {
        ...resumen(expediente, ["id", "patientId", "productoKey", "packId", "status"]),
        horasHechas: String(horas.entrevista + horas.hechas),
        horasMax: String(horas.max),
      },
    });

    const puedeDecidir = puedeDarBonos({ role: request.headers.get("x-user-role") ?? "user", hasModule });
    const [fila] = await filasDe({ tenantModels, expedientes: [expediente], puedeDecidir });
    return ok({
      expediente: fila,
      horasSinDar: horas.libres,
      citasFuturas: horas.reservadas > 0,
    });
  } catch (err) {
    if (tablaAusente(err)) return notFound("Ese diagnóstico no existe");
    return serverError(err);
  }
});
