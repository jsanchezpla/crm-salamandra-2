import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../../lib/utils/auditoria.js";
import { puedeDarBonos } from "../../../../../lib/citas/quienDaBonos.js";
import { productoDe, conceptoDeProducto, ROTULO_ESTADO } from "../../../../../lib/clinica/diagnostico.js";
import { UUID_RE } from "../../../../../lib/clinica/diagnosticoFila.js";
import { tablaAusente, catalogoDelCentro } from "../../../../../lib/clinica/diagnosticoDb.js";
import { fichaDeExpediente } from "../../../../../lib/clinica/registrosDelExpediente.js";

/**
 * GET/PATCH /api/clinica/diagnosticos/[id] — un expediente de diagnóstico y lo
 * que se le puede cambiar sin decidir nada (12/09/2026).
 *
 * GET   — la misma fila que la lista, más lo que solo enseña la FICHA del
 *         expediente (segunda entrega, 12/09/2026): sus citas (`citas[]`, cada
 *         una con `sessionId` y `urls.registro` para seguir el registro que
 *         hay o estrenar uno con `cita=`), sus registros de diagnóstico por
 *         fecha (`registros[]`, con título, quien firma, estado y `url`), el
 *         informe de valoración (`informe`, o null si aún no existe; si la
 *         columna apuntaba a un informe borrado, se limpia), el título que
 *         toca al siguiente registro (`siguienteTitulo`) y `urls.nuevoRegistro`
 *         / `urls.informe`. Todo lo monta `fichaDeExpediente`
 *         (`lib/clinica/registrosDelExpediente.js`), que es la misma fila de
 *         `filaDeExpediente` con esas piezas de más.
 * PATCH — `{ therapistId?, notes?, productoKey? }`. El terapeuta se cambia
 *         desde el desplegable de la lista y queda auditado; el producto solo
 *         mientras está en `entrevista` (después ya hay un bono y un cobro con
 *         el precio del que se contrató, y cambiarlo sería reescribirlos).
 *         Devuelve la misma ficha entera que el GET: la pantalla del
 *         expediente la sustituye sin volver a pedirla.
 *
 * Parar, seguir, desbloquear y cerrar tienen su POST cada uno: son decisiones
 * y dejan su línea propia en la auditoría.
 */

const limpiaTexto = (v, max = 4000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export const GET = withTenant(async (request, routeCtx, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  if (!hasModule("clinica")) return forbidden();
  try {
    const { Diagnostico } = tenantModels;
    const { id } = (await routeCtx?.params) ?? {};
    if (!Diagnostico || !UUID_RE.test(String(id ?? ""))) return notFound("Ese diagnóstico no existe");

    const expediente = await Diagnostico.findByPk(id);
    if (!expediente) return notFound("Ese diagnóstico no existe");

    const puedeDecidir = puedeDarBonos({ role: request.headers.get("x-user-role") ?? "user", hasModule });
    const fila = await fichaDeExpediente({ tenant, tenantModels, expediente, puedeDecidir });
    return ok({ expediente: fila });
  } catch (err) {
    if (tablaAusente(err)) return notFound("Ese diagnóstico no existe");
    return serverError(err);
  }
});

export const PATCH = withTenant(async (request, routeCtx, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  if (!hasModule("clinica")) return forbidden();
  try {
    const { Diagnostico, TeamMember } = tenantModels;
    const { id } = (await routeCtx?.params) ?? {};
    if (!Diagnostico || !UUID_RE.test(String(id ?? ""))) return notFound("Ese diagnóstico no existe");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const expediente = await Diagnostico.findByPk(id);
    if (!expediente) return notFound("Ese diagnóstico no existe");

    const antes = resumen(expediente, ["therapistId", "productoKey", "horasMax"]);
    const cambios = {};
    let cambioDeTerapeuta = false;

    // El terapeuta asignado: null lo deja sin asignar; un id tiene que existir.
    if ("therapistId" in body) {
      if (body.therapistId === null || body.therapistId === "") {
        cambios.therapistId = null;
      } else {
        if (!UUID_RE.test(String(body.therapistId)) || !TeamMember) return error("Ese terapeuta no es válido", 422);
        const tm = await TeamMember.findByPk(body.therapistId, { attributes: ["id"] });
        if (!tm) return error("Ese terapeuta no existe", 422);
        cambios.therapistId = tm.id;
      }
      cambioDeTerapeuta = String(cambios.therapistId ?? "") !== String(expediente.therapistId ?? "");
    }

    if ("notes" in body) cambios.notes = limpiaTexto(body.notes);

    /*
     * El producto solo cambia en `entrevista`: después ya nació el bono y su
     * cobro con el precio del producto contratado. Al cambiarlo se toma el tope
     * del nuevo producto tal cual (en `entrevista` nadie ha desbloqueado nada
     * todavía) y se vuelve a buscar su concepto.
     */
    if ("productoKey" in body && String(body.productoKey ?? "") !== String(expediente.productoKey)) {
      if (expediente.status !== "entrevista") {
        return error(`El producto solo se cambia mientras el diagnóstico está en ${ROTULO_ESTADO.entrevista.toLowerCase()}`, 409);
      }
      const producto = productoDe(tenant, body.productoKey);
      if (!producto) return error("Ese producto de diagnóstico no existe (simple o completo)", 422);
      const catalogo = await catalogoDelCentro(tenantModels);
      const concepto = conceptoDeProducto(producto, catalogo.conceptos);
      cambios.productoKey = producto.key;
      cambios.productoNombre = producto.nombre;
      cambios.horasMax = producto.horas;
      cambios.conceptId = concepto?.id ?? null;
    }

    if (Object.keys(cambios).length) {
      await expediente.update(cambios);
      await auditar({
        tenantId: tenant.id,
        ...datosPeticion(request),
        action: cambioDeTerapeuta ? "diagnostico.terapeuta_cambiado" : "diagnostico.editado",
        entity: "Diagnostico",
        entityId: expediente.id,
        before: antes,
        after: resumen(expediente, ["therapistId", "productoKey", "horasMax"]),
      });
    }

    const puedeDecidir = puedeDarBonos({ role: request.headers.get("x-user-role") ?? "user", hasModule });
    const fila = await fichaDeExpediente({ tenant, tenantModels, expediente, puedeDecidir });
    return ok({ expediente: fila });
  } catch (err) {
    if (tablaAusente(err)) return notFound("Ese diagnóstico no existe");
    return serverError(err);
  }
});
