import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { categoriasDe } from "../../../../lib/clients/consultaExterna.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../../../../lib/utils/errors.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { invalidateTenantCache } from "../../../../lib/tenant/tenantResolver.js";
import { isDemoTenant, assertNotDemoMasterWrite } from "../../../../lib/demo/isDemo.js";
import { encryptSecret, decryptSecret, isEncryptionConfigured } from "../../../../lib/crypto/secretBox.js";
import { isAllowedAnthropicModel, DEFAULT_ANTHROPIC_MODEL } from "../../../../lib/ai/anthropicModel.js";
import { getTenantStripeConfig } from "../../../../lib/payments/stripeConfig.js";
import { getTenantCloudflareConfig } from "../../../../lib/analytics/cloudflareConfig.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { avisarCambioDeConfiguracion } from "../../../../lib/configuracion/avisoCambio.js";
import { exigeIdentidad } from "../../../../lib/citas/puertaIdentidad.js";

/**
 * /api/tenant/settings — configuración básica del tenant.
 *
 * Cubre: datos del tenant (nombre), marca (colores/logo) y las credenciales de
 * IA por-tenant (API keys de Anthropic y de Google). Estas dos claves viven en
 * `master.tenants.settings.integrations` y son SECRETOS: nunca se devuelven en
 * claro (solo un estado "configurada" + una pista enmascarada), y el layout del
 * dashboard las elimina del tenant antes de serializarlo al cliente.
 *
 * Escritura solo para admin. Tras guardar se invalida la caché de tenant para
 * que el análisis con IA vea la nueva key de inmediato (la caché dura ~60s).
 */

// Nunca exponer la clave entera. Solo si está puesta + una pista corta. El valor
// guardado va cifrado, así que se descifra para calcular la pista (y si no se
// puede descifrar, se indica sin romper la respuesta).
function keyStatus(stored) {
  if (!stored || typeof stored !== "string") return { configured: false, hint: null };
  let key;
  try {
    key = decryptSecret(stored);
  } catch {
    return { configured: true, hint: "•••• (cifrada)" };
  }
  const hint = key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : "••••";
  return { configured: true, hint };
}

// Semántica de actualización de una clave:
//   undefined → no se toca (para poder guardar la marca sin perder la key)
//   null | "" → se borra
//   string    → se fija (trim)
function applyKey(target, field, value) {
  if (value === undefined) return;
  if (value === null || value === "") {
    delete target[field];
    return;
  }
  // Se guarda CIFRADA en reposo (lib/crypto/secretBox).
  if (typeof value === "string" && value.trim()) target[field] = encryptSecret(value.trim());
}

// Igual que applyKey pero SIN cifrar: para valores no-secretos (from, reply-to).
function applyPlain(target, field, value) {
  if (value === undefined) return;
  if (value === null || value === "") {
    delete target[field];
    return;
  }
  if (typeof value === "string" && value.trim()) target[field] = value.trim();
}

// Campos de `integrations` que son SECRETOS. De estos jamás se audita el valor
// —ni cifrado— sino solo qué les pasó: puesta, cambiada o borrada.
const CAMPOS_SECRETOS_AUDIT = [
  "anthropicApiKey",
  "cloudflareApiToken",
  "googlePlacesApiKey",
  "openaiApiKey",
  "resendApiKey",
  "stripeSecretKey",
  "stripeWebhookSecret",
  "whatsappToken",
];

// Estos NO son secretos y su valor sí ayuda a entender qué pasó.
const CAMPOS_ABIERTOS_AUDIT = [
  "anthropicModel",
  "cloudflareAccountId",
  "cloudflareSiteTag",
  "resendFromEmail",
  "resendReplyTo",
  "stripePublishableKey",
  "whatsappPhoneNumberId",
];

/**
 * Qué ha cambiado en la configuración, en forma auditable.
 *
 * Devuelve `null` si no cambió nada, para no llenar el registro de filas vacías
 * cuando se guarda la pantalla sin tocar nada.
 *
 * REGLA: de un secreto solo se guarda el NOMBRE del campo y qué le ocurrió.
 * El valor no entra ni cifrado: la tabla de auditoría vive en `master` y la
 * comparten todos los clientes.
 *
 * Nota sobre "cambiada": el cifrado usa IV aleatorio, así que volver a guardar
 * la MISMA clave produce un texto cifrado distinto. Por eso no se puede
 * distinguir "la cambió" de "la volvió a pegar igual"; se registra como
 * cambiada, que es la lectura conservadora.
 */
function diffConfiguracion(antes, despues, nombreAntes, nombreDespues) {
  const iAntes = antes?.integrations ?? {};
  const iDespues = despues?.integrations ?? {};

  const secretos = {};
  for (const campo of CAMPOS_SECRETOS_AUDIT) {
    const habia = !!iAntes[campo];
    const hay = !!iDespues[campo];
    if (!habia && hay) secretos[campo] = "puesta";
    else if (habia && !hay) secretos[campo] = "borrada";
    else if (habia && hay && iAntes[campo] !== iDespues[campo]) secretos[campo] = "cambiada";
  }

  const before = {};
  const after = {};
  const anota = (clave, va, vd) => {
    if (JSON.stringify(va ?? null) === JSON.stringify(vd ?? null)) return;
    before[clave] = va ?? null;
    after[clave] = vd ?? null;
  };

  if (nombreDespues !== undefined) anota("name", nombreAntes, nombreDespues);
  for (const campo of CAMPOS_ABIERTOS_AUDIT) anota(campo, iAntes[campo], iDespues[campo]);
  for (const campo of ["primaryColor", "secondaryColor", "logoUrl"]) {
    anota(`brand.${campo}`, antes?.brand?.[campo], despues?.brand?.[campo]);
  }
  anota("aiAccess", antes?.aiAccess, despues?.aiAccess);
  anota("citas.meetModo", antes?.citas?.meetModo, despues?.citas?.meetModo);
  anota("citas.recordatorios", antes?.citas?.recordatorios, despues?.citas?.recordatorios);
  anota("citas.agendaCompartida", antes?.citas?.agendaCompartida, despues?.citas?.agendaCompartida);
  anota("citas.portalBloqueoImpago", antes?.citas?.portalBloqueoImpago, despues?.citas?.portalBloqueoImpago);
  anota("citas.cancelacionBloqueada", antes?.citas?.cancelacionBloqueada, despues?.citas?.cancelacionBloqueada);
  anota("citas.avisosWhatsapp", antes?.citas?.avisosWhatsapp, despues?.citas?.avisosWhatsapp);
  anota("citas.formularioObligatorio", antes?.citas?.formularioObligatorio, despues?.citas?.formularioObligatorio);
  anota("citas.contratoObligatorio", antes?.citas?.contratoObligatorio, despues?.citas?.contratoObligatorio);
  anota("citas.soloConPago", antes?.citas?.soloConPago, despues?.citas?.soloConPago);
  anota("clientes.categoriasExternas", antes?.clientes?.categoriasExternas, despues?.clientes?.categoriasExternas);
  anota("citas.identidadObligatoria", antes?.citas?.identidadObligatoria, despues?.citas?.identidadObligatoria);
  anota("citas.formularioUrl", antes?.citas?.formularioUrl, despues?.citas?.formularioUrl);
  anota("citas.portalUrl", antes?.citas?.portalUrl, despues?.citas?.portalUrl);
  anota("citas.reservaUrl", antes?.citas?.reservaUrl, despues?.citas?.reservaUrl);

  const huboSecretos = Object.keys(secretos).length > 0;
  const huboAbiertos = Object.keys(after).length > 0;
  if (!huboSecretos && !huboAbiertos) return null;

  return {
    before: huboAbiertos ? before : null,
    after: {
      ...(huboAbiertos ? after : {}),
      ...(huboSecretos ? { credenciales: secretos } : {}),
    },
  };
}

export const GET = withTenant(async (request, _routeContext, ctx) => {
  // Solo admin: la página de Configuración es de administradores (los perfiles
  // no-admin ni la ven en el menú) y esto expone pistas enmascaradas de las
  // claves de IA. La escritura (PATCH) ya estaba gateada.
  const role = ctx.user?.role;
  if (role !== "admin" && role !== "superadmin") {
    throw new ForbiddenError("Solo los administradores pueden ver la configuración");
  }

  const t = ctx.tenant;
  const brand = t.settings?.brand ?? {};
  const integ = t.settings?.integrations ?? {};

  // Las salas fijas que HEREDARÍAN las citas online al pasar a modo automático.
  // Se enseñan en la tarjeta de videollamada porque el modo automático no
  // valida nada: si el enlace guardado es de ejemplo —a nutri_laura le quedaron
  // dos de un seed— el paciente recibe una sala que no existe, y nadie se entera
  // hasta que se planta delante de ella. Verlos antes de cambiar el modo
  // convierte eso en una decisión informada.
  let salasVideollamada = [];
  try {
    if (ctx.hasModule("citas") && ctx.tenantModels?.EventType) {
      const tipos = await ctx.tenantModels.EventType.findAll({
        where: { active: true },
        attributes: ["name", "modalities", "meetUrl"],
        order: [["order", "ASC"]],
      });
      salasVideollamada = tipos
        .filter((e) => (e.modalities ?? []).includes("online"))
        .map((e) => ({ nombre: e.name, url: e.meetUrl || null }));
    }
  } catch {
    // Tener el módulo no garantiza tener la tabla. Sin salas que enseñar, la
    // tarjeta se pinta igual: esto es información de apoyo, no la pantalla.
  }

  // En la demo pública NO se filtra la pista de la clave (últimos 4 chars de una
  // credencial real): solo si está configurada o no.
  const demo = isDemoTenant(ctx);
  const ks = (stored) => {
    const r = keyStatus(stored);
    return demo ? { configured: r.configured, hint: null } : r;
  };

  return ok({
    name: t.name,
    slug: t.slug,
    plan: t.plan,
    readOnly: demo, // la UI deshabilita el guardado en la demo
    // Candado de la IA para empleados: "libre" (default) o "restringido".
    aiAccess: t.settings?.aiAccess === "restringido" ? "restringido" : "libre",
    // Cómo consigue su enlace una cita online: a mano (por defecto) o
    // heredado del tipo de cita (tenant con sala de videollamada contratada).
    meetModo: t.settings?.citas?.meetModo === "automatico" ? "automatico" : "manual",
    salasVideollamada,
    // Recordatorio automático la víspera de la cita. Apagado por defecto:
    // encenderlo empieza a mandar correos a pacientes reales.
    recordatoriosCitas: t.settings?.citas?.recordatorios === true,
    agendaCompartida: t.settings?.citas?.agendaCompartida === true,
    // Bloqueo del área privada mes a mes hasta que consta el cobro de ese mes.
    portalBloqueoImpago: t.settings?.citas?.portalBloqueoImpago === true,
    // ¿El centro impide que la familia anule sus citas? (lib/citas/cancelacion.js)
    cancelacionBloqueada: t.settings?.citas?.cancelacionBloqueada === true,
    // Avisos de cita también por WhatsApp (01/08). Apagado por defecto.
    avisosWhatsapp: t.settings?.citas?.avisosWhatsapp === true,
    // Puerta de admisión: solo reserva quien tiene el formulario aceptado.
    formularioObligatorio: t.settings?.citas?.formularioObligatorio === true,
    // Puerta de contratos (04/08/2026): sin firmar no se reserva, salvo la
    // valoración inicial. Ver lib/citas/puertaContrato.js.
    contratoObligatorio: t.settings?.citas?.contratoObligatorio === true,
    // Puerta de caja (05/08/2026): desde la agenda pública solo se reserva lo
    // que se cobra —pasarela ahora o bono ya pagado—. Ver tiposVisibles.js.
    soloConPago: t.settings?.citas?.soloConPago === true,
    // Puerta de identidad (05/08/2026): sin cuenta no se reserva. Se lee con el
    // helper porque respeta también el interruptor viejo del widget.
    identidadObligatoria: exigeIdentidad(t),
    /*
     * Las empresas con las que hay acuerdo, para clasificar las consultas
     * externas (07/08/2026, Rodrigo). Se devuelven SIEMPRE, tenga o no el
     * cliente el módulo: la Configuración es universal (regla 14) y quien
     * mañana quiera usarlo tiene que poder rellenarlo solo.
     */
    categoriasExternas: categoriasDe(t),
    formularioUrl: t.settings?.citas?.formularioUrl ?? "",
    // Página de la web del cliente donde está incrustado el portal.
    portalUrl: t.settings?.citas?.portalUrl ?? "",
    reservaUrl: t.settings?.citas?.reservaUrl ?? "",
    brand: {
      primaryColor: brand.primaryColor ?? null,
      secondaryColor: brand.secondaryColor ?? null,
      logoUrl: brand.logoUrl ?? null,
    },
    integrations: {
      anthropic: {
        ...ks(integ.anthropicApiKey),
        model: isAllowedAnthropicModel(integ.anthropicModel) ? integ.anthropicModel : DEFAULT_ANTHROPIC_MODEL,
      },
      googlePlaces: ks(integ.googlePlacesApiKey),
      openai: ks(integ.openaiApiKey),
      // Visitas de la web (módulo Analíticas). `ready` = se puede consultar de
      // verdad: sin id de cuenta el token no sirve para nada, igual que en
      // Stripe hacen falta las dos piezas.
      cloudflare: {
        ...ks(integ.cloudflareApiToken),
        accountId: integ.cloudflareAccountId ?? null,
        siteTag: integ.cloudflareSiteTag ?? null,
        ready: getTenantCloudflareConfig({ tenant: t }).configured,
      },
      whatsapp: {
        ...ks(integ.whatsappToken),
        phoneNumberId: integ.whatsappPhoneNumberId ?? null,
      },
      resend: {
        ...ks(integ.resendApiKey),
        fromEmail: integ.resendFromEmail ?? null,
        replyTo: integ.resendReplyTo ?? null,
      },
      // Cobro online. `ready` = se puede cobrar de verdad: hacen falta AMBOS
      // secretos. Con la clave pero sin el secreto del webhook, el cliente pagaría
      // y su cita nunca se confirmaría (nadie nos avisa del cobro).
      stripe: {
        ...ks(integ.stripeSecretKey),
        publishableKey: integ.stripePublishableKey ?? null,
        webhook: keyStatus(integ.stripeWebhookSecret).configured,
        // Mismo criterio que el cobro real (getTenantStripeConfig): hay que poder
        // DESCIFRAR las claves, no solo que estén guardadas.
        ready: getTenantStripeConfig({ tenant: t }).configured,
        // Con claves de prueba no se cobra dinero de verdad. Es la diferencia
        // entre estar cobrando y creer que se está cobrando, así que la pantalla
        // tiene que decirlo. Se deduce del prefijo de la clave, no se guarda
        // aparte: así no puede desincronizarse.
        liveMode: getTenantStripeConfig({ tenant: t }).liveMode,
      },
    },
  });
});

export const PATCH = withTenant(async (request, _routeContext, ctx) => {
  const role = ctx.user?.role;
  if (role !== "admin" && role !== "superadmin") {
    throw new ForbiddenError("Solo los administradores pueden cambiar la configuración");
  }
  // La demo es pública: cualquiera entra como admin. Bloquear que un visitante
  // desfigure el tenant o borre/cambie claves en master (el reset no lo restaura).
  assertNotDemoMasterWrite(ctx);

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(ctx.tenant.id);
  if (!tenant) throw new NotFoundError("Tenant no encontrado");

  // Objetos nuevos (no mutar el settings cacheado en memoria). Asignar un
  // objeto fresco garantiza además que Sequelize detecte el cambio del JSONB.
  const settings = { ...(tenant.settings ?? {}) };
  settings.brand = { ...(settings.brand ?? {}) };
  settings.integrations = { ...(settings.integrations ?? {}) };

  // ── Sin clave de cifrado no se guardan secretos ─────────────────────────────
  // `encryptSecret` degrada a texto plano cuando falta SETTINGS_ENCRYPTION_KEY
  // (ver lib/crypto/secretBox.js). Sin este guard, guardar la clave secreta de
  // Stripe con la variable sin configurar la dejaba LEGIBLE en la base de datos
  // — y la respuesta decía "configurada", así que nada delataba el problema.
  // `.env.production.example` trae la variable vacía, o sea que es un escenario
  // realista, no teórico.
  const CAMPOS_SECRETOS = [
    "anthropicApiKey",
    "cloudflareApiToken",
    "googlePlacesApiKey",
    "openaiApiKey",
    "resendApiKey",
    "stripeSecretKey",
    "stripeWebhookSecret",
  ];
  const traeSecreto = CAMPOS_SECRETOS.some(
    (f) => typeof body[f] === "string" && body[f].trim() !== ""
  );
  if (traeSecreto && !isEncryptionConfigured()) {
    throw new AppError(
      "No se pueden guardar credenciales: falta la clave de cifrado del servidor (SETTINGS_ENCRYPTION_KEY). Avisa al administrador del sistema.",
      500
    );
  }

  const updates = {};

  // Nombre del tenant (dato básico).
  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim();
  }

  // Marca.
  if (body.brand && typeof body.brand === "object") {
    for (const k of ["primaryColor", "secondaryColor", "logoUrl"]) {
      if (k in body.brand) {
        const v = body.brand[k];
        settings.brand[k] = typeof v === "string" && v.trim() ? v.trim() : null;
      }
    }
  }

  // Claves de IA (secretos).
  applyKey(settings.integrations, "anthropicApiKey", body.anthropicApiKey);
  applyKey(settings.integrations, "googlePlacesApiKey", body.googlePlacesApiKey);
  applyKey(settings.integrations, "openaiApiKey", body.openaiApiKey);
  applyKey(settings.integrations, "resendApiKey", body.resendApiKey);
  applyPlain(settings.integrations, "resendFromEmail", body.resendFromEmail);

  // Cobro online (Stripe). La clave secreta y la del webhook son SECRETOS; la
  // publicable no lo es por definición (viaja al navegador).
  applyKey(settings.integrations, "stripeSecretKey", body.stripeSecretKey);
  applyKey(settings.integrations, "stripeWebhookSecret", body.stripeWebhookSecret);
  applyPlain(settings.integrations, "stripePublishableKey", body.stripePublishableKey);

  // Modelo de Claude (no es un secreto). Solo se guarda si es un id válido.
  if (typeof body.anthropicModel === "string" && isAllowedAnthropicModel(body.anthropicModel)) {
    settings.integrations.anthropicModel = body.anthropicModel;
  }
  applyPlain(settings.integrations, "resendReplyTo", body.resendReplyTo);

  // WhatsApp Cloud API (Meta): el token es SECRETO (se cifra como el resto de
  // claves); el identificador del número no lo es.
  applyKey(settings.integrations, "whatsappToken", body.whatsappToken);
  applyPlain(settings.integrations, "whatsappPhoneNumberId", body.whatsappPhoneNumberId);

  // Cloudflare Web Analytics (módulo Analíticas). El token de API es SECRETO;
  // el id de cuenta y el del sitio no lo son (salen de la URL del panel de
  // Cloudflare y no dan acceso a nada por sí solos).
  // El token de Cloudflare se valida por FORMA antes de guardarlo. Motivo
  // (2026-07-31): se guardó un valor de 13 caracteres —un pegado a medias— y el
  // CRM lo dio por bueno; el fallo no salía aquí sino mucho después, al consultar
  // la API, y con un "Authentication failed" de Cloudflare que no apunta a la
  // causa. Un secreto mal pegado tiene que cantar EN EL MOMENTO de pegarlo.
  //
  // El suelo es holgado a propósito (30, no 40 exactos): hoy miden 40, pero no
  // queremos que un cambio de formato de Cloudflare deje a un cliente sin poder
  // guardar un token que sí es válido. Lo que se descarta es lo que no puede
  // serlo de ninguna manera.
  if (typeof body.cloudflareApiToken === "string" && body.cloudflareApiToken.trim()) {
    const tok = body.cloudflareApiToken.trim();
    if (!/^[A-Za-z0-9_-]+$/.test(tok)) {
      throw new ValidationError(
        "El token de Cloudflare tiene caracteres que no le corresponden. Cópialo entero desde el panel, sin espacios ni saltos de línea."
      );
    }
    if (tok.length < 30) {
      throw new ValidationError(
        `Eso no parece un token de Cloudflare: has pegado ${tok.length} caracteres y los suyos rondan los 40. Vuelve a copiarlo entero (Cloudflare solo lo enseña una vez; si ya lo cerraste, crea otro).`
      );
    }
  }
  applyKey(settings.integrations, "cloudflareApiToken", body.cloudflareApiToken);
  applyPlain(settings.integrations, "cloudflareAccountId", body.cloudflareAccountId);
  applyPlain(settings.integrations, "cloudflareSiteTag", body.cloudflareSiteTag);

  // Modo de videollamada del módulo Citas. Lista cerrada.
  if (body.meetModo === "manual" || body.meetModo === "automatico") {
    settings.citas = { ...(settings.citas ?? {}), meetModo: body.meetModo };
  }

  /*
   * La lista de empresas de las consultas externas. Se guarda LIMPIA —sin
   * espacios sueltos, sin vacías y sin repetidas mirando mayúsculas— por el
   * mismo helper que la lee: si entrara sucia, el desplegable tendría «Empresa
   * A» y «empresa a» como dos cosas distintas y nadie sabría cuál elegir.
   *
   * Quitar una empresa de aquí NO toca a los pacientes que ya la tenían: su
   * ficha conserva el texto. Es una lista para teclear más rápido, no un
   * catálogo cerrado.
   */
  if (Array.isArray(body.categoriasExternas)) {
    settings.clientes = {
      ...(settings.clientes ?? {}),
      categoriasExternas: categoriasDe({ settings: { clientes: { categoriasExternas: body.categoriasExternas } } }),
    };
  }
  if (typeof body.recordatoriosCitas === "boolean") {
    settings.citas = { ...(settings.citas ?? {}), recordatorios: body.recordatoriosCitas };
  }
  // Agenda compartida: todo el equipo ve las citas de todo el equipo. Apagada
  // por defecto porque el listado enseña datos personales del paciente
  // (lib/citas/visibilidad.js); encenderla es decisión de cada cliente.
  if (typeof body.agendaCompartida === "boolean") {
    settings.citas = { ...(settings.citas ?? {}), agendaCompartida: body.agendaCompartida };
  }
  // Bloqueo por impago del área privada (sprint Aumenta 2026-07, punto 2.3).
  // APAGADO por defecto: encenderlo en un centro que no registra los cobros por
  // mes esconde de golpe la documentación de todas las familias.
  if (typeof body.portalBloqueoImpago === "boolean") {
    settings.citas = { ...(settings.citas ?? {}), portalBloqueoImpago: body.portalBloqueoImpago };
  }
  // Anulación por la familia. APAGADO por defecto (o sea: SÍ se puede anular),
  // que es como se ha comportado siempre. El nombre va en negativo para que
  // se lea con `=== true` como sus hermanos: en positivo habría que leerlo
  // con `!== false` y sería la única excepción de la familia — la clase de
  // detalle que alguien «arregla» un martes y deja a otro centro sin poder
  // anular, en silencio.
  if (typeof body.cancelacionBloqueada === "boolean") {
    settings.citas = { ...(settings.citas ?? {}), cancelacionBloqueada: body.cancelacionBloqueada };
  }
  // Avisos de cita por WhatsApp. APAGADO por defecto: encenderlo sin las
  // credenciales de Meta no manda nada, y con ellas empieza a escribir a
  // pacientes reales (y Meta cobra por conversación).
  if (typeof body.avisosWhatsapp === "boolean") {
    settings.citas = { ...(settings.citas ?? {}), avisosWhatsapp: body.avisosWhatsapp };
  }

  // Puerta de admisión: exigir formulario aceptado para poder reservar.
  // APAGADA por defecto. El enlace se guarda aparte porque el formulario vive
  // en la web del cliente (WordPress), no en el CRM: sin él la persona ve el
  // aviso pero no tiene a dónde ir.
  if (typeof body.formularioObligatorio === "boolean") {
    settings.citas = { ...(settings.citas ?? {}), formularioObligatorio: body.formularioObligatorio };
  }
  if (typeof body.contratoObligatorio === "boolean") {
    settings.citas = { ...(settings.citas ?? {}), contratoObligatorio: body.contratoObligatorio };
  }
  // Tercera puerta (05/08/2026): desde la agenda pública solo se reserva lo que
  // pasa por caja —o lo paga la pasarela ahora, o lo pagó un bono antes—. Las
  // citas gratuitas de verdad las crea el centro a mano desde su agenda.
  // APAGADA por defecto: hay centros cuyos tipos de cita no tienen precio
  // porque cobran cuotas por fuera, y encenderla para todos los dejaría sin
  // poder reservar nada. Ver `lib/citas/tiposVisibles.js`.
  if (typeof body.soloConPago === "boolean") {
    settings.citas = { ...(settings.citas ?? {}), soloConPago: body.soloConPago };
  }
  // Cuarta puerta (05/08/2026): sin cuenta no se reserva. Es la más básica de
  // las cuatro —antes de preguntar si está admitida o si ha firmado, hay que
  // saber quién es— y la única que hasta ahora era decorativa: el widget
  // enseñaba el cartel pero el servidor no comprobaba nada.
  if (typeof body.identidadObligatoria === "boolean") {
    settings.citas = { ...(settings.citas ?? {}), identidadObligatoria: body.identidadObligatoria };
  }
  if (typeof body.formularioUrl === "string") {
    const url = body.formularioUrl.trim();
    // Solo http(s) y solo absoluta: esta URL se le sirve a un tercero en un
    // enlace, así que un `javascript:` aquí sería un XSS de regalo.
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      throw new ValidationError("La dirección del formulario tiene que empezar por http:// o https://");
    }
    settings.citas = { ...(settings.citas ?? {}), formularioUrl: url || null };
  }

  // Dirección del ÁREA PRIVADA en la web del cliente: la página donde está
  // incrustado el portal. El CRM no puede deducirla —el portal vive dentro de
  // un iframe en su WordPress, no en un sitio nuestro— y sin ella lo único que
  // se le puede ofrecer a alguien para cancelar es el enlace con el token.
  if (typeof body.portalUrl === "string") {
    const url = body.portalUrl.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      throw new ValidationError("La dirección del área privada tiene que empezar por http:// o https://");
    }
    settings.citas = { ...(settings.citas ?? {}), portalUrl: url || null };
  }

  /*
   * Dirección de la página de RESERVAS en la web del cliente (06/08/2026,
   * Rodrigo). Es la hermana de `portalUrl`, y resuelve el enlace de cita única:
   * el botón de copiar daba la dirección del CRM, y esa dirección abierta desde
   * un WhatsApp cae fuera de la web del centro —sin sesión— y solo puede
   * enseñar el cartel de «inicia sesión para reservar». Con esta puesta, el
   * enlace que se copia es el de SU web, donde quien lo abra ya está
   * identificado (o puede identificarse) y el iframe recibe su sesión.
   */
  if (typeof body.reservaUrl === "string") {
    const url = body.reservaUrl.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      throw new ValidationError("La dirección de la página de reservas tiene que empezar por http:// o https://");
    }
    settings.citas = { ...(settings.citas ?? {}), reservaUrl: url || null };
  }

  // Candado de la IA para empleados (no es un secreto): lista cerrada.
  if (body.aiAccess === "libre" || body.aiAccess === "restringido") {
    settings.aiAccess = body.aiAccess;
  }

  // ── Qué cambia, para el rastro de auditoría ──────────────────────────────
  // Se calcula ANTES del update, comparando el estado previo con el nuevo.
  // Aquí se decide sobre el dinero y las credenciales de un cliente (su clave
  // de Stripe, la de correo, las de IA) y hasta ahora no quedaba ni una fila:
  // no había forma de saber quién cambió qué ni cuándo.
  const antes = ctx.tenant.settings ?? {};
  const cambios = diffConfiguracion(antes, settings, tenant.name, updates.name);

  updates.settings = settings;
  await tenant.update(updates);

  // DESPUÉS de la mutación y best-effort, como el resto del CRM.
  if (cambios) {
    const { userId, ip } = datosPeticion(request);
    await auditar({
      tenantId: ctx.tenant.id,
      userId,
      action: "configuracion.updated",
      entity: "Tenant",
      entityId: ctx.tenant.id,
      before: cambios.before,
      after: cambios.after,
      ip,
    });
    // Y el recibo al cliente. El registro es la prueba; esto es el aviso.
    // No se espera a que salga para responder: que el correo tarde no debe
    // hacer que la pantalla de Configuración parezca colgada.
    avisarCambioDeConfiguracion({ tenant, cambios, autorId: userId }).catch(() => {});
  }

  invalidateTenantCache(ctx.slug);

  return ok({
    name: tenant.name,
    aiAccess: settings.aiAccess === "restringido" ? "restringido" : "libre",
    meetModo: settings.citas?.meetModo === "automatico" ? "automatico" : "manual",
    recordatoriosCitas: settings.citas?.recordatorios === true,
    agendaCompartida: settings.citas?.agendaCompartida === true,
    portalBloqueoImpago: settings.citas?.portalBloqueoImpago === true,
    cancelacionBloqueada: settings.citas?.cancelacionBloqueada === true,
    avisosWhatsapp: settings.citas?.avisosWhatsapp === true,
    // ⚠️ LAS CUATRO PUERTAS TIENEN QUE VOLVER EN ESTA RESPUESTA (05/08/2026).
    // La pantalla hace `setCfg({...c, ...data})`, así que lo que no vuelva se
    // queda con el valor viejo: el interruptor se guardaba en la base de datos
    // pero el botón seguía apagado, y desde fuera parecía que la pantalla no
    // hacía nada. Rodrigo encendió tres puertas sin enterarse de que estaban
    // encendidas. Cualquier ajuste nuevo que se añada arriba tiene que
    // devolverse también aquí.
    formularioObligatorio: settings.citas?.formularioObligatorio === true,
    contratoObligatorio: settings.citas?.contratoObligatorio === true,
    soloConPago: settings.citas?.soloConPago === true,
    identidadObligatoria: exigeIdentidad({ settings }),
    brand: {
      primaryColor: settings.brand.primaryColor ?? null,
      secondaryColor: settings.brand.secondaryColor ?? null,
      logoUrl: settings.brand.logoUrl ?? null,
    },
    integrations: {
      anthropic: {
        ...keyStatus(settings.integrations.anthropicApiKey),
        model: isAllowedAnthropicModel(settings.integrations.anthropicModel) ? settings.integrations.anthropicModel : DEFAULT_ANTHROPIC_MODEL,
      },
      googlePlaces: keyStatus(settings.integrations.googlePlacesApiKey),
      openai: keyStatus(settings.integrations.openaiApiKey),
      cloudflare: {
        ...keyStatus(settings.integrations.cloudflareApiToken),
        accountId: settings.integrations.cloudflareAccountId ?? null,
        siteTag: settings.integrations.cloudflareSiteTag ?? null,
        ready: getTenantCloudflareConfig({ tenant: { settings } }).configured,
      },
      whatsapp: {
        ...keyStatus(settings.integrations.whatsappToken),
        phoneNumberId: settings.integrations.whatsappPhoneNumberId ?? null,
      },
      resend: {
        ...keyStatus(settings.integrations.resendApiKey),
        fromEmail: settings.integrations.resendFromEmail ?? null,
        replyTo: settings.integrations.resendReplyTo ?? null,
      },
      stripe: {
        ...keyStatus(settings.integrations.stripeSecretKey),
        publishableKey: settings.integrations.stripePublishableKey ?? null,
        webhook: keyStatus(settings.integrations.stripeWebhookSecret).configured,
        // MISMO criterio que usa el cobro de verdad (getTenantStripeConfig): no
        // basta con que las claves estén, hay que poder DESCIFRARLAS. Si se
        // rotara SETTINGS_ENCRYPTION_KEY, mirar la mera presencia diría "listo
        // para cobrar" mientras todos los cobros fallan.
        ready: getTenantStripeConfig({ tenant: { settings } }).configured,
        liveMode: getTenantStripeConfig({ tenant: { settings } }).liveMode,
      },
    },
  });
});
