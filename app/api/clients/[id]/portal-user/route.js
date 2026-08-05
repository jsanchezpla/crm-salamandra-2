import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { crearUsuarioPortal, resolverUrlWordpress } from "../../../../../lib/formularios/portalUser.js";
import { assertNotDemoPaidCall } from "../../../../../lib/demo/isDemo.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";

/**
 * POST /api/clients/[id]/portal-user — crearle a esta paciente su cuenta en la
 * web del cliente (05/08/2026).
 *
 * EL HUECO QUE TAPA: cuando alguien llega por el formulario de la web y Laura
 * acepta su solicitud, el CRM ya le crea la ficha Y la cuenta de WordPress, y
 * así puede entrar a su área privada a reservar. Pero quien escribe por
 * Instagram —o a quien Laura da de alta a mano— se quedaba solo con la ficha:
 * no tenía forma de entrar en la web, y por tanto tampoco de ver sus citas ni
 * de que le funcionara un bono. Había que crearle el usuario a mano en
 * WordPress, acordándose de hacerlo.
 *
 * NUNCA VIAJA UNA CONTRASEÑA. WordPress crea el usuario y le manda a ELLA un
 * enlace con caducidad para que elija la suya. Mandarle una contraseña por
 * correo la dejaría escrita para siempre en su bandeja.
 *
 * Es el MISMO camino que usa el aceptar del formulario (`crearUsuarioPortal`),
 * no una segunda implementación: si mañana cambia la forma de dar de alta,
 * cambia para los dos.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

export const POST = withTenant(async (request, ctx, tenantContext) => {
  try {
    const { tenant, tenantModels } = tenantContext;

    const userRole = request.headers.get("x-user-role") ?? "user";
    const { userId, ip } = datosPeticion(request);
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede crear cuentas en la web");

    // La demo es pública y da sesión de admin a cualquiera: sin esto, cualquier
    // visitante podría usar el CRM para dar de alta usuarios en un WordPress
    // ajeno y disparar correos desde él.
    assertNotDemoPaidCall(tenantContext, "Crear cuentas en la web");

    const { Client } = tenantModels;
    const { id } = (await ctx?.params) ?? {};
    const client = Client ? await Client.findByPk(id) : null;
    if (!client) return notFound("Ficha no encontrada");

    // El correo del portal manda si está puesto: es con el que ella entra. Si
    // no, el de contacto, que es lo que hay en todas las fichas de hoy.
    const email = (client.portalEmail || client.email || "").trim();
    if (!email) {
      return error("Esta ficha no tiene correo, así que no se le puede crear la cuenta.", 422);
    }

    const wordpressUrl = await resolverUrlWordpress(tenant, tenantModels);
    if (!wordpressUrl) {
      return error(
        "No sé cuál es la web de este cliente. Configúrala en el formulario de la web o en Configuración → Área privada.",
        422
      );
    }

    const resultado = await crearUsuarioPortal({
      tenantSlug: tenant.slug,
      wordpressUrl,
      email,
      nombre: client.name,
    });

    // Se audita el intento, salga bien o mal: es un alta de usuario en un
    // sistema de fuera que dispara un correo a una paciente.
    await auditar({
      tenantId: tenant.id,
      userId,
      action: resultado.ok ? "client.cuenta_web_creada" : "client.cuenta_web_fallida",
      entity: "Client",
      entityId: client.id,
      before: null,
      after: { email, creado: resultado.creado ?? null, motivo: resultado.motivo ?? null },
      ip,
    });

    // Un fallo de WordPress NO es un 500 nuestro: se devuelve 200 con el motivo
    // para que la pantalla lo cuente en cristiano («no respondió a tiempo»,
    // «ya tenía usuario») en vez de enseñar un error genérico.
    return ok({
      ok: resultado.ok,
      creado: resultado.creado ?? false,
      mensaje: resultado.mensaje,
      email,
    });
  } catch (err) {
    return serverError(err);
  }
});
