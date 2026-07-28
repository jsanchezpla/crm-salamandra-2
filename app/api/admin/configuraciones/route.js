import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { isEncrypted } from "../../../../lib/crypto/secretBox.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * GET /api/admin/configuraciones — la configuración de TODOS los clientes.
 *
 * ── LA REGLA QUE DEFINE ESTE ENDPOINT ───────────────────────────────────────
 * NO DESCIFRA NADA. Ni una vez, ni para una pista enmascarada.
 *
 * De cada credencial dice solo dos cosas: si está puesta y si está cifrada en
 * reposo. Ninguna de las dos requiere abrir el sobre.
 *
 * Es deliberado, no una simplificación. No existe un caso legítimo en el que
 * haga falta LEER la clave de Stripe de un cliente: lo que hace falta es saber
 * si funciona, y para eso está probarla contra el proveedor. Leerla solo sirve
 * para sacarla de aquí, que es justo el abuso del que este panel debe estar a
 * salvo.
 *
 * La consecuencia práctica: una sesión robada de este panel no se lleva las
 * credenciales de cobro, correo e IA de todos los clientes. Se lleva una lista
 * de cuáles están puestas. Esa diferencia es todo el diseño.
 *
 * Mismos tres candados que el alta de clientes: módulo `provisioning` (que solo
 * tiene nuestro tenant), rol admin leído fresco de BD, y nunca desde la demo.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

/** Credenciales que vigilamos, agrupadas como las entiende un cliente. */
const CREDENCIALES = [
  { clave: "stripeSecretKey", nombre: "Stripe — clave secreta", grupo: "Cobros" },
  { clave: "stripeWebhookSecret", nombre: "Stripe — webhook", grupo: "Cobros" },
  { clave: "resendApiKey", nombre: "Correo (Resend)", grupo: "Correo" },
  { clave: "anthropicApiKey", nombre: "IA (Anthropic)", grupo: "IA" },
  { clave: "openaiApiKey", nombre: "Transcripción (OpenAI)", grupo: "IA" },
  { clave: "googlePlacesApiKey", nombre: "Google Places", grupo: "Otros" },
  { clave: "whatsappToken", nombre: "WhatsApp", grupo: "Otros" },
];

/**
 * Estado de una credencial SIN descifrarla.
 *
 * `cifrada` mira el prefijo `enc:v1:`, que es texto plano. Un `false` aquí
 * significa que ese secreto está guardado LEGIBLE en la base de datos —pasa con
 * los que se guardaron antes de que existiera el cifrado— y es justo lo que este
 * panel debe ayudar a detectar.
 */
function estadoCredencial(valor) {
  if (typeof valor !== "string" || !valor.trim()) return { puesta: false, cifrada: null };
  return { puesta: true, cifrada: isEncrypted(valor) };
}

export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const { Tenant, TenantModule } = getMasterModels();
    const tenants = await Tenant.findAll({
      attributes: ["id", "name", "slug", "plan", "status", "settings", "createdAt"],
      order: [["name", "ASC"]],
    });
    const modulos = await TenantModule.findAll({
      where: { enabled: true },
      attributes: ["tenantId", "moduleKey"],
    });
    const porTenant = new Map();
    for (const m of modulos) {
      if (!porTenant.has(m.tenantId)) porTenant.set(m.tenantId, []);
      porTenant.get(m.tenantId).push(m.moduleKey);
    }

    const clientes = tenants.map((t) => {
      const integ = t.settings?.integrations ?? {};
      const credenciales = CREDENCIALES.map((c) => ({
        clave: c.clave,
        nombre: c.nombre,
        grupo: c.grupo,
        ...estadoCredencial(integ[c.clave]),
      }));

      // Cuántos secretos están sin cifrar. Es el número que hay que llevar a 0.
      const enClaro = credenciales.filter((c) => c.puesta && c.cifrada === false).length;

      return {
        id: t.id,
        nombre: t.name,
        slug: t.slug,
        plan: t.plan,
        estado: t.status,
        alta: t.createdAt,
        modulos: (porTenant.get(t.id) || []).sort(),
        credenciales,
        enClaro,
        // Ajustes que no son secretos y conviene ver de un vistazo.
        ajustes: {
          remitenteCorreo: integ.resendFromEmail ?? null,
          modeloIA: integ.anthropicModel ?? null,
          accesoIA: t.settings?.aiAccess ?? "libre",
          modoVideollamada: t.settings?.citas?.meetModo ?? "manual",
          recordatorios: t.settings?.citas?.recordatorios === true,
          marca: {
            primario: t.settings?.brand?.primaryColor ?? null,
            secundario: t.settings?.brand?.secondaryColor ?? null,
          },
        },
      };
    });

    return ok({
      clientes,
      // Para que la pantalla pueda decir "no se descifra nada" sin que sea una
      // promesa de marketing: viene del propio endpoint.
      politica: {
        descifra: false,
        nota: "Este panel nunca lee el valor de una credencial. Solo si está puesta y si está cifrada.",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
