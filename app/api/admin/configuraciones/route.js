import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterDb, getMasterModels } from "../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { isEncrypted } from "../../../../lib/crypto/secretBox.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * GET /api/admin/configuraciones — la ficha completa de todos los clientes.
 *
 * ── LA REGLA QUE DEFINE ESTE ENDPOINT ───────────────────────────────────────
 * NO DESCIFRA NADA. Ni una vez, ni para una pista enmascarada.
 *
 * De cada credencial dice solo si está puesta y si está cifrada en reposo.
 * Ninguna de las dos requiere abrir el sobre (`isEncrypted` mira el prefijo
 * `enc:v1:`, que es texto plano).
 *
 * Es deliberado. No existe un caso legítimo en el que haga falta LEER la clave
 * de Stripe de un cliente: hace falta saber si funciona, y para eso está
 * probarla contra el proveedor. Leerla solo sirve para sacarla de aquí, que es
 * el abuso del que este panel debe estar a salvo. Una sesión robada se lleva una
 * lista de qué está puesto, no las credenciales de nadie.
 *
 * Mismos tres candados que el alta: módulo `provisioning` (que solo tiene
 * nuestro tenant), rol admin leído fresco de BD, y nunca desde la demo.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

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
 * ¿Lee el CÓDIGO cada tipo de personalización?
 *
 * Comprobado a mano el 2026-07-28 buscando consumidores en app/, lib/, modules/
 * y components/. Importa que la pantalla lo diga: hay clientes con "campos
 * extra" y "UI propia" guardados en la base de datos que no hacen absolutamente
 * nada, y un panel que los pintara igual que los que sí funcionan estaría
 * mintiendo.
 *
 *  · featureFlags   → SÍ. `hasFeatureFlag` y lecturas directas de la fila
 *                     (p. ej. autoConfirmPublicBookings en la reserva pública).
 *  · logicOverrides → el ayudante `getLogicOverride` existe en el contexto de
 *                     tenant, pero no se le encontraron llamantes.
 *  · uiOverride     → NO. Las pantallas propias se eligen con imports fijos y un
 *                     `if` por slug dentro de cada página; esta columna es
 *                     documentación que nadie aplica, y ya está desincronizada
 *                     (abarcaia/referidos declara un componente propio cuando en
 *                     realidad reutiliza el de quality-energy).
 *  · schemaExtensions → NO. Los campos extra están escritos a mano dentro de
 *                     cada componente override.
 */
const LO_LEE_EL_CODIGO = {
  featureFlags: { lee: true, nota: "Se aplica de verdad." },
  logicOverrides: { lee: null, nota: "El ayudante existe, pero no se le encontraron llamantes." },
  uiOverride: { lee: false, nota: "Decorativo: la pantalla propia se elige con un if por slug en el código." },
  schemaExtensions: { lee: false, nota: "Decorativo: los campos extra están escritos dentro del componente." },
};

function estadoCredencial(valor) {
  if (typeof valor !== "string" || !valor.trim()) return { puesta: false, cifrada: null };
  return { puesta: true, cifrada: isEncrypted(valor) };
}

const vacio = (o) => !o || typeof o !== "object" || Object.keys(o).length === 0;

/**
 * Tamaño, nº de tablas y filas ESTIMADAS por schema, en una sola consulta.
 *
 * Se usa `reltuples` (la estimación del planificador) y no `count(*)`: contar de
 * verdad exigiría una consulta por tabla y por cliente —cientos— para una
 * pantalla informativa. Para responder "¿este cliente usa esto?" la estimación
 * sobra, y no cuesta nada.
 */
async function radiografiaSchemas(sequelize) {
  const [filas] = await sequelize.query(`
    SELECT n.nspname AS schema,
           c.relname  AS tabla,
           GREATEST(c.reltuples, 0)::bigint AS filas,
           pg_total_relation_size(c.oid) AS bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname LIKE 'crm_%'
  `);
  const porSchema = new Map();
  for (const f of filas) {
    if (!porSchema.has(f.schema)) porSchema.set(f.schema, { tablas: 0, bytes: 0, filas: {} });
    const s = porSchema.get(f.schema);
    s.tablas += 1;
    s.bytes += Number(f.bytes) || 0;
    s.filas[f.tabla] = Number(f.filas) || 0;
  }
  return porSchema;
}

/** Tablas cuyo volumen dice si un cliente USA de verdad lo que tiene contratado. */
const TABLAS_DE_USO = [
  { tabla: "clients", etiqueta: "Clientes" },
  { tabla: "leads", etiqueta: "Leads" },
  { tabla: "bookings", etiqueta: "Citas" },
  { tabla: "invoices", etiqueta: "Facturas" },
  { tabla: "patients", etiqueta: "Pacientes" },
  { tabla: "team_members", etiqueta: "Equipo" },
  { tabla: "tickets", etiqueta: "Tickets" },
  { tabla: "projects", etiqueta: "Proyectos" },
];

export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const { Tenant, TenantModule, User } = getMasterModels();
    const sequelize = getMasterDb();

    const [tenants, modulos, usuarios, radiografia] = await Promise.all([
      Tenant.findAll({
        attributes: ["id", "name", "slug", "plan", "status", "settings", "createdAt"],
        order: [["name", "ASC"]],
      }),
      TenantModule.findAll({
        attributes: ["tenantId", "moduleKey", "enabled", "uiOverride", "logicOverrides", "featureFlags", "schemaExtensions"],
      }),
      User.findAll({ attributes: ["tenantId", "role", "lastLoginAt"] }),
      radiografiaSchemas(sequelize),
    ]);

    const modsPorTenant = new Map();
    for (const m of modulos) {
      if (!modsPorTenant.has(m.tenantId)) modsPorTenant.set(m.tenantId, []);
      modsPorTenant.get(m.tenantId).push(m);
    }
    const usersPorTenant = new Map();
    for (const u of usuarios) {
      if (!usersPorTenant.has(u.tenantId)) usersPorTenant.set(u.tenantId, []);
      usersPorTenant.get(u.tenantId).push(u);
    }

    const clientes = tenants.map((t) => {
      const integ = t.settings?.integrations ?? {};
      const credenciales = CREDENCIALES.map((c) => ({
        clave: c.clave, nombre: c.nombre, grupo: c.grupo, ...estadoCredencial(integ[c.clave]),
      }));
      const enClaro = credenciales.filter((c) => c.puesta && c.cifrada === false).length;

      const mods = modsPorTenant.get(t.id) ?? [];
      const modulosDetalle = mods
        .map((m) => ({
          clave: m.moduleKey,
          activo: !!m.enabled,
          personalizacion: {
            ui: m.uiOverride || null,
            logica: vacio(m.logicOverrides) ? null : m.logicOverrides,
            flags: vacio(m.featureFlags) ? null : m.featureFlags,
            camposExtra: vacio(m.schemaExtensions) ? null : Object.keys(m.schemaExtensions),
          },
        }))
        .sort((a, b) => a.clave.localeCompare(b.clave));

      const conPersonalizacion = modulosDetalle.filter(
        (m) => m.personalizacion.ui || m.personalizacion.logica || m.personalizacion.flags || m.personalizacion.camposExtra
      );

      const us = usersPorTenant.get(t.id) ?? [];
      const ultimoAcceso = us
        .map((u) => u.lastLoginAt)
        .filter(Boolean)
        .sort()
        .pop() ?? null;

      const rx = radiografia.get(`crm_${t.slug}`) ?? { tablas: 0, bytes: 0, filas: {} };
      const uso = TABLAS_DE_USO
        .filter((x) => rx.filas[x.tabla] !== undefined)
        .map((x) => ({ etiqueta: x.etiqueta, filas: rx.filas[x.tabla] }));

      return {
        id: t.id,
        nombre: t.name,
        slug: t.slug,
        plan: t.plan,
        estado: t.status,
        alta: t.createdAt,
        // Módulos
        modulos: modulosDetalle.filter((m) => m.activo).map((m) => m.clave),
        modulosDetalle,
        personalizados: conPersonalizacion.length,
        // Gente
        usuarios: { total: us.length, admins: us.filter((u) => u.role === "admin" || u.role === "superadmin").length },
        ultimoAcceso,
        // Base de datos
        bd: { tablas: rx.tablas, bytes: rx.bytes, existe: rx.tablas > 0 },
        uso,
        // Credenciales
        credenciales,
        enClaro,
        ajustes: {
          remitenteCorreo: integ.resendFromEmail ?? null,
          modeloIA: integ.anthropicModel ?? null,
          accesoIA: t.settings?.aiAccess ?? "libre",
          modoVideollamada: t.settings?.citas?.meetModo ?? "manual",
          recordatorios: t.settings?.citas?.recordatorios === true,
        },
      };
    });

    return ok({
      clientes,
      loLeeElCodigo: LO_LEE_EL_CODIGO,
      politica: {
        descifra: false,
        nota: "Este panel nunca lee el valor de una credencial. Solo si está puesta y si está cifrada.",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
