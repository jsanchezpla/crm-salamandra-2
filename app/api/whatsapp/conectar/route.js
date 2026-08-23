import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../../../../lib/utils/errors.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { invalidateTenantCache } from "../../../../lib/tenant/tenantResolver.js";
import { assertNotDemoMasterWrite } from "../../../../lib/demo/isDemo.js";
import { encryptSecret, isEncryptionConfigured } from "../../../../lib/crypto/secretBox.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { verifyTokenFor } from "../../../../lib/whatsapp/webhookAuth.js";
import {
  baseUrlWebhook,
  callbackDeTenant,
  datosDelNumero,
  embeddedSignupConfigurado,
  intercambiarCodigo,
  suscribirWebhook,
} from "../../../../lib/whatsapp/embeddedSignup.js";

/**
 * POST /api/whatsapp/conectar — el final del botón "Conectar mi WhatsApp".
 *
 * El navegador abre la ventana de Meta (Embedded Signup), el cliente acepta, y
 * vuelve con `{ code, wabaId, phoneNumberId }`. Aquí se canjea el código por el
 * token permanente de SU cuenta, se suscribe nuestra app a sus webhooks
 * apuntando a SU URL, y se guarda todo cifrado.
 *
 * ⚠️ **EL CÓDIGO CADUCA A LOS 30 SEGUNDOS.** Por eso el navegador lo manda aquí
 * en cuanto lo tiene y aquí se canjea de inmediato. No se guarda ni se encola.
 *
 * ── EL ORDEN IMPORTA ─────────────────────────────────────────────────────────
 * Primero se canjea, después se suscribe el webhook, y solo al final se guarda.
 * Si se guardara antes de suscribir, un fallo en la suscripción dejaría al
 * cliente "conectado" en pantalla, mandando mensajes y sin recibir NADA — ni
 * respuestas ni historial— sin que nada lo delatara. Como está, un fallo a
 * mitad deja la configuración como estaba y el cliente puede volver a darle al
 * botón.
 */
export const POST = withTenant(async (request, _routeContext, ctx) => {
  // Configuración es de administradores, y esto conecta una cuenta que gasta
  // dinero del cliente.
  const role = ctx.user?.role;
  if (role !== "admin" && role !== "superadmin") {
    throw new ForbiddenError("Solo los administradores pueden conectar WhatsApp");
  }
  // La demo es pública y da sesión de admin a cualquiera: sin esto, un visitante
  // anónimo podría enganchar una cuenta de WhatsApp al tenant de escaparate.
  assertNotDemoMasterWrite(ctx);

  if (!embeddedSignupConfigurado()) {
    throw new AppError("La conexión con Meta no está configurada en el servidor", 503);
  }
  // El token del cliente se guarda CIFRADO o no se guarda. `encryptSecret`
  // degrada a texto plano sin `SETTINGS_ENCRYPTION_KEY` (ver secretBox.js), y
  // dejar el token de WhatsApp de un cliente legible en la base de datos —y en
  // cada backup— es peor que fallar aquí.
  if (!isEncryptionConfigured()) {
    throw new AppError("Falta SETTINGS_ENCRYPTION_KEY: no se puede guardar el token cifrado", 503);
  }

  const body = await request.json().catch(() => ({}));
  const code = String(body?.code ?? "").trim();
  const wabaId = String(body?.wabaId ?? "").trim();
  const phoneNumberId = String(body?.phoneNumberId ?? "").trim();

  if (!code) throw new ValidationError("Falta el código de Meta");
  if (!/^\d+$/.test(wabaId)) throw new ValidationError("Identificador de cuenta de WhatsApp no válido");
  if (!/^\d+$/.test(phoneNumberId)) throw new ValidationError("Identificador de número no válido");

  // Antes de gastar el código: si la URL no sirve, mejor saberlo ya. Canjear
  // primero y fallar aquí quemaría el código, que no se puede reutilizar.
  const urlBase = baseUrlWebhook(request);
  if (!urlBase.ok) throw new AppError(urlBase.error, 400);
  const callbackUrl = callbackDeTenant(urlBase.base, ctx.slug);

  // ── 1. El código por el token del cliente ──────────────────────────────────
  const canje = await intercambiarCodigo(code);
  if (!canje.ok) {
    process.stderr.write(`[whatsapp:conectar] ${ctx.slug}: canje falló: ${canje.error}\n`);
    throw new AppError(`Meta rechazó la conexión: ${canje.error}`, 400);
  }

  // ── 2. Nuestros webhooks sobre su cuenta, en SU url ────────────────────────
  const suscripcion = await suscribirWebhook({
    wabaId,
    token: canje.token,
    callbackUrl,
    verifyToken: verifyTokenFor(ctx.slug),
  });
  if (!suscripcion.ok) {
    process.stderr.write(`[whatsapp:conectar] ${ctx.slug}: suscripción falló: ${suscripcion.error}\n`);
    throw new AppError(
      `La cuenta se autorizó pero no se pudo suscribir el webhook (${suscripcion.error}). No se ha guardado nada: vuelve a intentarlo.`,
      502
    );
  }

  // ── 3. ¿De qué número hablamos? ────────────────────────────────────────────
  // Best-effort: sirve para enseñarlo en pantalla y, de paso, confirma que el
  // token funciona. Que falle no invalida una conexión que ya está hecha.
  const info = await datosDelNumero({ phoneNumberId, token: canje.token });

  // ── 4. Guardar ─────────────────────────────────────────────────────────────
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(ctx.tenant.id);
  if (!tenant) throw new NotFoundError("Tenant no encontrado");

  // Objetos nuevos: no se muta el settings cacheado, y así Sequelize detecta el
  // cambio del JSONB.
  const settings = { ...(tenant.settings ?? {}) };
  settings.integrations = { ...(settings.integrations ?? {}) };
  settings.integrations.whatsappToken = encryptSecret(canje.token);
  settings.integrations.whatsappPhoneNumberId = phoneNumberId;
  settings.integrations.whatsappWabaId = wabaId;
  settings.integrations.whatsappNumero = info.ok ? info.numero : null;
  settings.integrations.whatsappConectadoAt = new Date().toISOString();

  await tenant.update({ settings });

  // DESPUÉS de la mutación y best-effort, como el resto del CRM. El token NO
  // entra en la auditoría, obviamente; sí el número, que es lo que hace falta
  // para explicar qué se conectó y cuándo.
  const { userId, ip } = datosPeticion(request);
  await auditar({
    tenantId: ctx.tenant.id,
    userId,
    action: "whatsapp.conectado",
    entity: "Tenant",
    entityId: ctx.tenant.id,
    before: { whatsapp: ctx.tenant.settings?.integrations?.whatsappPhoneNumberId ? "conectado" : "sin conectar" },
    after: { whatsapp: "conectado", numero: info.ok ? info.numero : null, wabaId },
    ip,
  });

  invalidateTenantCache(ctx.slug);

  return ok({
    conectado: true,
    numero: info.ok ? info.numero : null,
    nombre: info.ok ? info.nombre : null,
    calidad: info.ok ? info.calidad : null,
    webhook: callbackUrl,
  });
});
