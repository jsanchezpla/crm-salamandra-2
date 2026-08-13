import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../lib/utils/apiResponse.js";
import { isDemoTenant } from "../../../lib/demo/isDemo.js";
import { enforceRateLimit } from "../../../lib/utils/rateLimit.js";
import { auditar, datosPeticion } from "../../../lib/utils/auditoria.js";
import { validarAvisoNuevo, serializarAviso, referencia, TIPOS } from "../../../lib/buzon/buzon.js";
import {
  crearAviso,
  crearAdjunto,
  listarDeUsuario,
  leerDeUsuario,
  contarSinVer,
  esSinTabla,
  COMANDO_MIGRACION,
} from "../../../lib/buzon/buzonStore.js";
import {
  guardarAdjuntosDelFormulario,
  MAX_FICHEROS,
  MAX_BYTES_POR_FICHERO,
} from "../../../lib/buzon/buzonStorage.js";
import { quienEscribe } from "../../../lib/buzon/quienEscribe.js";
import { avisarnos } from "../../../lib/buzon/avisarPorCorreo.js";

/**
 * /api/ayuda — por aquí un cliente nos escribe A NOSOTROS.
 *
 *   GET  → sus avisos (los SUYOS) y cuántas respuestas tiene sin ver
 *   POST → nos manda uno
 *
 * ── SIN `hasModule`, Y ES LO IMPORTANTE ─────────────────────────────────────
 * Este es el único endpoint del CRM que no mira ningún módulo, a propósito. Si
 * avisarnos dependiera de tener algo contratado, al que se le olvidara
 * activárselo se le quedaría el CRM sin forma de decirnos que algo va mal — que
 * es exactamente el fallo que esto viene a arreglar. Lo único que se exige es
 * estar dentro con una sesión válida, que es lo que hace `withTenant`.
 *
 * ── POR QUÉ NO CUELGA DE `/api/admin` ───────────────────────────────────────
 * Porque `middleware.js` sirve `/api/admin` SOLO desde `ADMIN_HOST` y devuelve
 * 404 en el host de los clientes. La bandeja donde esto acaba sí vive allí
 * (`/api/admin/buzon`); la puerta por la que entra, no puede.
 *
 * ── LA DEMO ─────────────────────────────────────────────────────────────────
 * La demo es pública y le da sesión de ADMIN a cualquier visitante anónimo, así
 * que sin freno sería un relé: escribe en master y dispara un correo nuestro.
 * Se corta con `forbidden()` y NO con `assertNotDemoMasterWrite()`, que lanza:
 * dentro de este `try` acabaría en `serverError` y el visitante vería un 500 en
 * vez de una explicación. La pantalla, además, ni siquiera le enseña el
 * formulario.
 */

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const usuarioId = request.headers.get("x-user-id");
    const [{ avisos, soloLectura }, sinVer] = await Promise.all([
      listarDeUsuario(usuarioId),
      contarSinVer(usuarioId),
    ]);

    return ok({
      avisos: avisos.map((a) => serializarAviso(a, { para: "cliente" })),
      sinVer,
      // `soloLectura` = las tablas todavía no existen (se despliega el código y
      // la migración se corre a mano después). La pantalla lo dice en vez de
      // reventar.
      soloLectura,
      tipos: TIPOS,
      // Para que la pantalla sepa si tiene que esconder el formulario.
      esDemo: isDemoTenant(ctx),
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    if (isDemoTenant(ctx)) {
      return forbidden(
        "Esto es la demo, así que este aviso no llegaría a ningún sitio. Si eres cliente, entra con tu cuenta; si no, escríbenos a info@salamandrasolutions.com."
      );
    }

    // El cubo va por PERSONA y no solo por IP: una oficina entera sale por la
    // misma IP y un compañero pesado dejaría sin avisar a los demás.
    const usuarioId = request.headers.get("x-user-id");
    const frenado = enforceRateLimit(request, {
      key: `ayuda-crear:${ctx.slug}:${usuarioId ?? "anon"}`,
      limit: 5,
      windowMs: 60_000,
    });
    if (frenado) return frenado;

    // Se corta por el tamaño ANTES de leer el cuerpo: si no, nos comemos en
    // memoria un envío que de todas formas vamos a rechazar. Y el tope real lo
    // pone nginx en 30 MB, así que pasarse de ahí ni siquiera llegaría aquí:
    // devolvería una página HTML suya que en pantalla parece que no ha pasado
    // nada.
    const declarado = Number(request.headers.get("content-length") ?? 0);
    if (declarado > (MAX_FICHEROS * MAX_BYTES_POR_FICHERO + 1024 * 1024)) {
      return error(`Demasiado grande. Como mucho ${MAX_FICHEROS} ficheros de 5 MB.`, 413);
    }

    const tipoContenido = request.headers.get("content-type") ?? "";
    const esFormulario = tipoContenido.includes("multipart/form-data");

    let body;
    let form = null;
    try {
      if (esFormulario) {
        form = await request.formData();
        body = {
          tipo: form.get("tipo"),
          asunto: form.get("asunto"),
          cuerpo: form.get("cuerpo"),
          bloquea: form.get("bloquea"),
          pantalla: form.get("pantalla"),
          contexto: JSON.parse(form.get("contexto") || "{}"),
        };
      } else {
        body = await request.json();
      }
    } catch {
      return error("Body inválido");
    }

    const v = validarAvisoNuevo(body);
    if (!v.ok) return error(v.error, v.status);

    const usuario = await quienEscribe(request, ctx);
    const aviso = await crearAviso({ tenant: ctx.tenant, usuario, limpio: v.limpio });

    // Los adjuntos van DESPUÉS del aviso porque cuelgan de su id. Si fallan, el
    // aviso se queda igual: perder la captura es molesto, perder lo que nos
    // querían contar es peor.
    let falloAdjuntos = null;
    if (form) {
      const r = await guardarAdjuntosDelFormulario({
        form,
        slug: ctx.slug,
        avisoId: aviso.id,
        subidoPor: "cliente",
      });
      for (const ficha of r.fichas) await crearAdjunto(ficha);
      falloAdjuntos = r.error;
    }

    // ⚠️ SE AUDITA EL NÚMERO Y EL CLIENTE, NUNCA EL TEXTO. Guardar el cuerpo
    // aquí lo duplicaría en `master.audit_logs`, que es justo la tabla que la
    // regla de auditoría protege de los datos personales. Lo que interesa del
    // rastro es que entró uno y de quién, no qué decía.
    const { userId, ip } = datosPeticion(request);
    await auditar({
      tenantId: ctx.tenant.id,
      userId,
      action: "buzon.aviso_creado",
      entity: "BuzonAviso",
      entityId: aviso.id,
      before: null,
      after: { ref: referencia(aviso.numero), tenantSlug: aviso.tenantSlug, tipo: aviso.tipo },
      ip,
    });

    // Y nos avisamos. Es lo único que hace que un aviso a las 9 de la mañana no
    // espere a que a alguien se le ocurra abrir el panel. No puede tumbar nada:
    // `avisarnos` se traga sus propios errores y deja constancia en el log.
    await avisarnos({ aviso: serializarAviso(aviso, { para: "salamandra" }) });

    // Se relee para que la respuesta lleve ya los adjuntos recién guardados.
    const completo = (await leerDeUsuario(aviso.id, { usuarioId })) ?? aviso;
    return created({
      ...serializarAviso(completo, { para: "cliente" }),
      // Si las capturas fallaron, el aviso SÍ entró: hay que decir las dos
      // cosas o el cliente se queda pensando que no ha llegado nada.
      avisoAdjuntos: falloAdjuntos,
    });
  } catch (err) {
    if (esSinTabla(err)) {
      return error(`No se ha podido guardar. Falta correr en el VPS: ${COMANDO_MIGRACION}`, 503);
    }
    return serverError(err);
  }
});
