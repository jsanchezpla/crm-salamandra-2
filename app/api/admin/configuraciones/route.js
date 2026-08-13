import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterDb, getMasterModels } from "../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { whereClientesVisibles } from "../../../../lib/provisioning/clientesVisibles.js";
import {
  CREDENCIALES,
  estadoCredencial,
  ponerCredenciales,
} from "../../../../lib/provisioning/credencialesCliente.js";
import { leerContacto } from "../../../../lib/provisioning/contactoCliente.js";
import { editarTenant } from "../../../../lib/provisioning/cicloVida.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { avisarCambioDeConfiguracion } from "../../../../lib/configuracion/avisoCambio.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * GET /api/admin/configuraciones — la ficha completa de todos los clientes.
 * PUT /api/admin/configuraciones — poner (nunca leer) las credenciales de uno.
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
 * ── EL PUT NO ROMPE ESA REGLA (13/08/2026) ──────────────────────────────────
 * Y conviene decirlo porque parece que sí. La regla es que no se LEE ninguna
 * credencial; escribir una no obliga a leer la anterior. El campo es de SOLO
 * ESCRIBIR: se pega, se cifra con `secretBox` igual que lo hace la Configuración
 * del cliente, y no se devuelve nunca, ni enmascarado, ni a quien acaba de
 * escribirlo. De vuelta va QUÉ le pasó a cada una —puesta, cambiada, borrada— y
 * nada más. El detalle, en lib/provisioning/credencialesCliente.js.
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
        // Solo los clientes en marcha (ver lib/provisioning/clientesVisibles.js):
        // un suspendido contando en los totales hacía que esta pantalla dijera
        // seis clientes donde hay cuatro.
        where: whereClientesVisibles(),
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
        clave: c.clave, nombre: c.nombre, grupo: c.grupo, donde: c.donde,
        ...estadoCredencial(integ[c.clave]),
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
        // A quién se le escribe cuando falta algo. NO es el usuario con el que
        // entra (ver lib/provisioning/contactoCliente.js). No es un secreto: se
        // devuelve tal cual, que es para lo único que sirve.
        contacto: leerContacto(t),
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

/**
 * PUT /api/admin/configuraciones — poner las credenciales de un cliente, y a
 * quién se le escribe.
 *
 * Cuerpo: `{ slug, claves?: { anthropicApiKey: "sk-ant-…" | null }, contacto?: { email, nombre, telefono } }`
 *   · una cadena FIJA la credencial (se cifra antes de guardarla),
 *   · `null` o `""` la BORRAN,
 *   · lo que no venga no se toca.
 *
 * La respuesta NUNCA lleva un valor: solo qué le pasó a cada clave. Ver la
 * cabecera del fichero y lib/provisioning/credencialesCliente.js.
 */
export const PUT = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const slug = String(body?.slug || "").trim();
    if (!slug || !/^[a-z0-9_]+$/.test(slug)) return error("Falta el cliente", 422);

    const traeClaves = body.claves && typeof body.claves === "object" && Object.keys(body.claves).length;
    const traeContacto = body.contacto !== undefined;
    if (!traeClaves && !traeContacto) return error("No hay nada que guardar", 422);

    const aplicado = {};
    const avisos = [];

    // ── Credenciales ────────────────────────────────────────────────────────
    let tenantId = null;
    if (traeClaves) {
      const res = await ponerCredenciales({ slug, valores: body.claves });
      if (res.error) return error(res.error, res.status ?? 400);
      Object.assign(aplicado, res.aplicado);
      avisos.push(...(res.avisos ?? []));
      tenantId = res.tenantId ?? null;
    }

    // ── Contacto ────────────────────────────────────────────────────────────
    // Va por `editarTenant` y no a pelo: es el mismo camino que usa
    // /admin/clientes, y así el dato no puede quedar guardado de dos formas
    // distintas según por qué pantalla se haya escrito.
    if (traeContacto) {
      const res = await editarTenant(slug, { contacto: body.contacto });
      if (res.error) return error(res.error, res.status ?? 400);
      if (res.aplicado?.contacto !== undefined) aplicado.contacto = res.aplicado.contacto;
    }

    // ── Rastro ──────────────────────────────────────────────────────────────
    // Se audita contra NUESTRO tenant (que es quien hace la acción) y se guarda
    // a quién se le hizo. De las credenciales solo el nombre del campo y qué le
    // pasó: el valor no entra ni cifrado, que es la regla de siempre para los
    // secretos (misma que /api/tenant/settings).
    if (Object.keys(aplicado).length) {
      const { userId, ip } = datosPeticion(request);
      if (!tenantId) {
        const { Tenant } = getMasterModels();
        const destino = await Tenant.findOne({ where: { slug }, attributes: ["id"] });
        tenantId = destino?.id ?? null;
      }
      await auditar({
        tenantId: ctx.tenant.id,
        userId,
        action: "provisioning.credenciales_cliente",
        entity: "Tenant",
        entityId: tenantId,
        before: { slug },
        after: aplicado,
        ip,
      });

      /*
       * Y EL RECIBO AL CLIENTE, que es la parte que no se puede saltar.
       *
       * Las credenciales son SUYAS, y el motivo de que exista el aviso de
       * cambios está escrito en lib/configuracion/avisoCambio.js: «que alguien
       * pueda tocarlas —NOSOTROS INCLUIDOS— sin que él se entere es lo que había
       * que arreglar». Abrir esta puerta sin enganchar el aviso convertía esa
       * frase en mentira el mismo día.
       *
       * Va firmado como Salamandra: quien lo hizo no es nadie de su equipo, y un
       * recibo sin firmar no se puede reconocer ni desconocer. Best-effort y sin
       * esperar: que el correo tarde no puede colgar la pantalla.
       */
      const soloCredenciales = Object.fromEntries(
        Object.entries(aplicado).filter(([k]) => k !== "contacto")
      );
      const { Tenant } = getMasterModels();
      const destino = await Tenant.findOne({ where: { slug } });
      if (destino) {
        avisarCambioDeConfiguracion({
          tenant: destino,
          cambios: {
            before: null,
            after: {
              ...(Object.keys(soloCredenciales).length ? { credenciales: soloCredenciales } : {}),
              ...(aplicado.contacto !== undefined ? { "contacto de la cuenta": "actualizado" } : {}),
            },
          },
          autor: `Salamandra Solutions (${ctx.slug})`,
        }).catch(() => {});
      }
    }

    return ok({ slug, aplicado, avisos });
  } catch (err) {
    return serverError(err);
  }
});
