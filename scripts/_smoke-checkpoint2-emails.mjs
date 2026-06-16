/**
 * _smoke-checkpoint2-emails.mjs — verifica los 3 templates de email en
 * dry-run. NO commit. NO se ejecuta automáticamente.
 *
 * Simula las 3 condiciones del Checkpoint 2:
 *   1) POST público /book con tenant en lista de espera → bookingReceived.
 *   2) PATCH /confirm sobre booking pending → bookingConfirmed.
 *   3) PATCH /reject sobre booking pending → bookingRejected.
 *
 * Para cada caso renderiza el template con datos realistas y llama
 * sendEmail() en modo dry-run. Output esperado: 3 líneas
 * "[email:send:dry-run] ..." en stdout.
 *
 * Uso (sin RESEND_API_KEY → dry-run automático):
 *   node --env-file=.env.local scripts/_smoke-checkpoint2-emails.mjs
 */

import { sendEmail } from "../lib/email/resendClient.js";
import { bookingReceivedTemplate } from "../lib/email/templates/citas/bookingReceived.js";
import { bookingConfirmedTemplate } from "../lib/email/templates/citas/bookingConfirmed.js";
import { bookingRejectedTemplate } from "../lib/email/templates/citas/bookingRejected.js";

// Fuerza dry-run aunque .env.local tenga RESEND_API_KEY real
delete process.env.RESEND_API_KEY;

const tenantName = "Nutri Laura";
const brand = {
  primaryColor: "#A97873",
  secondaryColor: "#6E5A52",
  accent: "#F7F1EB",
  card: "#FFFDFC",
};

const scheduledAt = "2026-06-25T10:30:00.000Z";

function header(label) {
  process.stdout.write(`\n══ ${label} ${"═".repeat(Math.max(0, 56 - label.length))}\n`);
}

async function main() {
  header("1) booking-received (POST público con autoConfirm=false)");
  {
    const tpl = bookingReceivedTemplate({
      tenantName,
      brand,
      clientName: "Marta López",
      eventTypeName: "Primera consulta nutricional (60 min)",
      scheduledAt,
    });
    await sendEmail({
      to: "marta.test@example.com",
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
  }

  header("2) booking-confirmed (PATCH /confirm)");
  {
    const tpl = bookingConfirmedTemplate({
      tenantName,
      brand,
      clientName: "Marta López",
      eventTypeName: "Primera consulta nutricional (60 min)",
      scheduledAt,
      duration: 60,
      modality: "online",
      meetUrl: "https://meet.google.com/nutri-laura-primera",
      cancelUrl: "https://tunutrilaura.com/cancelar/aaaa-bbbb",
    });
    await sendEmail({
      to: "marta.test@example.com",
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
  }

  header("3) booking-rejected (PATCH /reject)");
  {
    const tpl = bookingRejectedTemplate({
      tenantName,
      brand,
      clientName: "Diego Martín",
      eventTypeName: "Seguimiento (30 min)",
      scheduledAt,
      reason: "Esa hora ya está ocupada. Te proponemos otra disponibilidad por email.",
    });
    await sendEmail({
      to: "diego.test@example.com",
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
  }

  process.stdout.write("\n══ FIN ════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  process.stderr.write(`✗ ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
