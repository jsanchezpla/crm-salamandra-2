import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, created, error, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import {
  validarAvisoDeSalamandra,
  serializarAviso,
  referencia,
  MB_POR_ADJUNTO,
} from "../../../../../lib/buzon/buzon.js";
import {
  crearAvisoDeSalamandra,
  crearAdjunto,
  leerParaSalamandra,
  esSinTabla,
  COMANDO_MIGRACION,
} from "../../../../../lib/buzon/buzonStore.js";
import {
  guardarAdjuntosDelFormulario,
  MAX_FICHEROS,
  MAX_BYTES_POR_FICHERO,
} from "../../../../../lib/buzon/buzonStorage.js";
import { candadoBuzon, quienContesta } from "../../../../../lib/buzon/candadoBackoffice.js";
import { avisarEnSuCrm } from "../../../../../lib/buzon/avisarEnSuCrm.js";
import {
  clientesParaEscribir,
  clienteParaEscribir,
  personasDelCliente,
} from "../../../../../lib/buzon/destinatarios.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /api/admin/buzon/escribir — le escribimos NOSOTROS a una persona de un
 * cliente, sin que haya abierto nada (15/09/2026, Rodrigo).
 *
 *   GET                 → los clientes a los que se puede escribir
 *   GET ?tenantId=<id>  → las personas de ese cliente
 *   POST (multipart)    → tenantId, usuarioId, asunto, cuerpo y hasta 3 capturas
 *
 * Nace un aviso del Buzón como cualquier otro, marcado como nuestro
 * (`contexto.origen`): la persona lo ve en Ayuda con «Nueva respuesta», le suena
 * la campana de su CRM, y contesta en el mismo hilo. No sale correo: igual que
 * cuando contestamos, se entera DENTRO de su CRM (Jorge, 13/08/2026).
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = candadoBuzon(request, ctx);
    if (veto) return veto;

    const tenantId = new URL(request.url).searchParams.get("tenantId");
    if (!tenantId) return ok({ clientes: await clientesParaEscribir() });

    if (!UUID_RE.test(tenantId)) return error("tenantId inválido", 422);
    const tenant = await clienteParaEscribir(tenantId);
    if (!tenant) return notFound("Ese cliente no existe o no está activo");
    return ok({ personas: await personasDelCliente(tenant) });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = candadoBuzon(request, ctx);
    if (veto) return veto;

    const declarado = Number(request.headers.get("content-length") ?? 0);
    if (declarado > MAX_FICHEROS * MAX_BYTES_POR_FICHERO + 1024 * 1024) {
      return error(`Demasiado grande. Como mucho ${MAX_FICHEROS} ficheros de ${MB_POR_ADJUNTO} MB.`, 413);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return error("Body inválido");
    }

    const v = validarAvisoDeSalamandra({
      tenantId: form.get("tenantId"),
      usuarioId: form.get("usuarioId"),
      asunto: form.get("asunto"),
      cuerpo: form.get("cuerpo"),
    });
    if (!v.ok) return error(v.error, v.status);

    // La persona tiene que ser DE ESE cliente: el desplegable lo garantiza en
    // pantalla, pero el id viaja en el formulario.
    const tenant = await clienteParaEscribir(v.limpio.tenantId);
    if (!tenant) return notFound("Ese cliente no existe o no está activo");
    const persona = (await personasDelCliente(tenant)).find((p) => p.id === v.limpio.usuarioId);
    if (!persona) return notFound("Esa persona no es de ese cliente");

    const yo = quienContesta(request, ctx);
    const aviso = await crearAvisoDeSalamandra({
      tenant,
      destinatario: { id: persona.id, email: persona.usuario, nombre: persona.nombre, rol: persona.rol },
      limpio: v.limpio,
      firmante: yo.nombre,
    });

    // Las capturas cuelgan del aviso, sin mensaje: son las «del alta», que el
    // cliente ve y descarga (su endpoint solo tapa las de una nota interna).
    const r = await guardarAdjuntosDelFormulario({
      form,
      slug: tenant.slug,
      avisoId: aviso.id,
      subidoPor: "salamandra",
    });
    for (const ficha of r.fichas) await crearAdjunto(ficha);

    // Como en el POST de Ayuda: la referencia y el cliente, nunca el texto.
    const { userId, ip } = datosPeticion(request);
    await auditar({
      tenantId: ctx.tenant.id,
      userId,
      action: "buzon.aviso_escrito",
      entity: "BuzonAviso",
      entityId: aviso.id,
      before: null,
      after: { ref: referencia(aviso.numero), tenantSlug: tenant.slug },
      ip,
    });

    const campana = await avisarEnSuCrm({ aviso, titulo: "Salamandra te ha escrito" });

    const fresco = await leerParaSalamandra(aviso.id, { marcarLeido: false });
    return created({
      ...serializarAviso(fresco ?? aviso, { para: "salamandra" }),
      avisoAdjuntos: r.error,
      campana: campana.ok,
    });
  } catch (err) {
    if (esSinTabla(err)) return error(`Falta correr en el VPS: ${COMANDO_MIGRACION}`, 503);
    return serverError(err);
  }
});
