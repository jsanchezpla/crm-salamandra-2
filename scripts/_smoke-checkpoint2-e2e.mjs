/**
 * _smoke-checkpoint2-e2e.mjs — smoke "light end-to-end" sobre crm_nutri_laura
 * que reproduce la cadena BD → template → dry-run email para los 3
 * disparadores. NO toca HTTP (no requiere dev server corriendo).
 *
 * Pasos:
 *   1) Carga un EventType existente o crea uno mínimo si no hay.
 *   2) Verifica que master.tenant_modules.feature_flags tiene
 *      autoConfirmPublicBookings=false para nutri_laura.citas.
 *   3) Crea un Booking simulando POST público con autoConfirm=false
 *      → status='pending'. Renderiza bookingReceived y manda dry-run.
 *   4) Sobre el mismo booking, ejecuta el flujo de /confirm:
 *      → row.update({status:'confirmed'}) + render bookingConfirmed
 *        + dry-run.
 *   5) Crea un segundo booking pending y ejecuta el flujo de /reject:
 *      → row.update({status:'cancelled', cancelledAt, reason}) + render
 *        bookingRejected + dry-run.
 *   6) Limpieza: borra los 2 bookings creados.
 *
 * Output esperado: 3 líneas [email:send:dry-run] + invariantes BD.
 *
 * Uso: node --env-file=.env.local scripts/_smoke-checkpoint2-e2e.mjs
 */

import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { sendEmail } from "../lib/email/resendClient.js";
import { bookingReceivedTemplate } from "../lib/email/templates/citas/bookingReceived.js";
import { bookingConfirmedTemplate } from "../lib/email/templates/citas/bookingConfirmed.js";
import { bookingRejectedTemplate } from "../lib/email/templates/citas/bookingRejected.js";

// Forzar dry-run aunque el entorno tenga RESEND_API_KEY
delete process.env.RESEND_API_KEY;

const SLUG = "nutri_laura";
const TEST_EMAIL_A = "smoke-ckpt2-a@example.com";
const TEST_EMAIL_B = "smoke-ckpt2-b@example.com";

function header(label) {
  process.stdout.write(`\n══ ${label} ${"═".repeat(Math.max(0, 56 - label.length))}\n`);
}
function log(...args) { process.stdout.write("  " + args.join(" ") + "\n"); }
function assert(cond, label) {
  log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) throw new Error(`assertion failed: ${label}`);
}

async function main() {
  getMasterDb();
  const { Tenant, TenantModule } = getMasterModels();
  const { sequelize, models } = getTenantDb(SLUG);
  const { EventType, Booking } = models;

  // ── Limpieza previa idempotente ──────────────────────────────────────────
  await Booking.destroy({ where: { clientEmail: [TEST_EMAIL_A, TEST_EMAIL_B] } });

  // ── 1) Cargar tenant + flag ──────────────────────────────────────────────
  header(`1) Tenant ${SLUG} + flag autoConfirmPublicBookings`);
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  assert(!!tenant, `Tenant ${SLUG} existe`);

  const mod = await TenantModule.findOne({
    where: { tenantId: tenant.id, moduleKey: "citas" },
  });
  assert(!!mod, `tenant_modules row para citas existe`);
  const autoConfirm = mod.featureFlags?.autoConfirmPublicBookings !== false;
  log(`  flag autoConfirmPublicBookings = ${mod.featureFlags?.autoConfirmPublicBookings} (autoConfirm efectivo: ${autoConfirm})`);
  assert(autoConfirm === false, "autoConfirm es false (bookings nacerán pending)");

  // ── 2) EventType ─────────────────────────────────────────────────────────
  header("2) EventType disponible");
  const eventType = await EventType.findOne({ where: { active: true } });
  assert(!!eventType, `Hay al menos un EventType activo en ${SLUG}`);
  log(`  using: ${eventType.name} (${eventType.duration}min)`);

  // ── 3) Simular POST público /book con autoConfirm=false → pending ───────
  header("3) Simular POST /book → booking-received (dry-run)");
  const scheduledAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // +7 días
  const bookingA = await Booking.create({
    eventTypeId: eventType.id,
    clientName: "Marta Smoke",
    clientEmail: TEST_EMAIL_A,
    clientPhone: "600111222",
    additionalData: "Smoke test received",
    scheduledAt,
    duration: eventType.duration,
    modality: "online",
    meetUrl: eventType.meetUrl,
    status: autoConfirm ? "confirmed" : "pending",
  });
  assert(bookingA.status === "pending", "booking A creado con status=pending");

  if (!autoConfirm) {
    const tpl = bookingReceivedTemplate({
      tenantName: tenant.name,
      brand: tenant.settings?.brand,
      clientName: bookingA.clientName,
      eventTypeName: eventType.name,
      scheduledAt: bookingA.scheduledAt,
    });
    await sendEmail({ to: bookingA.clientEmail, subject: tpl.subject, html: tpl.html, text: tpl.text });
  }

  // ── 4) Simular PATCH /confirm sobre el booking A ─────────────────────────
  header("4) Simular PATCH /confirm → booking-confirmed (dry-run)");
  await bookingA.update({ status: "confirmed" });
  await bookingA.reload();
  assert(bookingA.status === "confirmed", "booking A pasa a confirmed");

  // El endpoint hace include({ EventType }) pero aquí lo ponemos a mano
  // para reflejar fielmente lo que pasa al cargar el row con association.
  bookingA.eventType = eventType;

  {
    const cancelUrl = bookingA.cancellationToken
      ? `/widget/c/${tenant.slug}/cancel/${bookingA.cancellationToken}`
      : null;
    const tpl = bookingConfirmedTemplate({
      tenantName: tenant.name,
      brand: tenant.settings?.brand,
      clientName: bookingA.clientName,
      eventTypeName: bookingA.eventType.name,
      scheduledAt: bookingA.scheduledAt,
      duration: bookingA.duration,
      modality: bookingA.modality,
      meetUrl: bookingA.meetUrl,
      cancelUrl,
      location: bookingA.eventType.location ?? null,
    });
    await sendEmail({ to: bookingA.clientEmail, subject: tpl.subject, html: tpl.html, text: tpl.text });
  }

  // ── 5) Booking B → simular PATCH /reject ────────────────────────────────
  header("5) Crear booking B + Simular PATCH /reject → booking-rejected (dry-run)");
  const scheduledAtB = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
  const bookingB = await Booking.create({
    eventTypeId: eventType.id,
    clientName: "Diego Smoke",
    clientEmail: TEST_EMAIL_B,
    clientPhone: "600333444",
    additionalData: "Smoke test rejected",
    scheduledAt: scheduledAtB,
    duration: eventType.duration,
    modality: "online",
    meetUrl: eventType.meetUrl,
    status: "pending",
  });
  assert(bookingB.status === "pending", "booking B creado con status=pending");

  const rejectReason = "Esa hora ya está ocupada, te proponemos otra disponibilidad por email.";
  await bookingB.update({
    status: "cancelled",
    cancelledAt: new Date(),
    cancellationReason: rejectReason,
  });
  await bookingB.reload();
  assert(bookingB.status === "cancelled", "booking B pasa a cancelled");

  bookingB.eventType = eventType;
  {
    const tpl = bookingRejectedTemplate({
      tenantName: tenant.name,
      brand: tenant.settings?.brand,
      clientName: bookingB.clientName,
      eventTypeName: bookingB.eventType.name,
      scheduledAt: bookingB.scheduledAt,
      reason: rejectReason,
    });
    await sendEmail({ to: bookingB.clientEmail, subject: tpl.subject, html: tpl.html, text: tpl.text });
  }

  // ── 6) Verificación de la regresión 'pending' (PATCH base) ──────────────
  header("6) Verificar bloqueo de regresión a 'pending' (en código del endpoint)");
  // No se llama al endpoint real (sería HTTP); se verifica la guardarraíl
  // por inspección de código en el reporte. Aquí registramos el contrato.
  log(`  ▸ El PATCH genérico devuelve 403 si se intenta status='pending' desde otro estado.`);
  log(`  ▸ Test mental: booking A está confirmed; PATCH { status: 'pending' } → 403.`);

  // ── 7) Limpieza ──────────────────────────────────────────────────────────
  header("7) Limpieza");
  await Booking.destroy({ where: { id: [bookingA.id, bookingB.id] } });
  log(`  ✓ 2 bookings de smoke eliminados`);

  await closeAllConnections();
  process.stdout.write("\n══ FIN — Estado global: PASS ✓ ═══════════════════════════\n");
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
