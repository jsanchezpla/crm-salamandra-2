/**
 * _smoke-enlace-videollamada.mjs — «Guardar y enviar» no puede mentir.
 *
 * Es el gesto que Laura va a hacer todos los días: crea la reunión de Meet a
 * mano, pega el enlace en la cita y pulsa «Guardar y enviar» para que le llegue
 * al paciente.
 *
 * El fallo que se fija aquí: `sendEmail` devuelve `{ok: true, dryRun: true}`
 * cuando no hay clave de Resend —no lanza excepción a propósito, para que en
 * desarrollo no se caiga media aplicación—, y quien lo llamaba daba por hecho
 * que había salido. El panel decía «✓ Enlace enviado por email al cliente» con
 * el buzón del paciente vacío. Y el mensaje alternativo sugería una causa
 * equivocada («revisa que la cita sea online y no esté cancelada») cuando lo
 * que pasaba era que faltaba configurar el correo.
 *
 * Aquí se comprueba que, sin clave, el CRM lo dice: `emailEnviado: false` y
 * `emailMotivo: "sin_configurar"`, que es lo que la pantalla traduce a «falta
 * configurar el correo».
 *
 * ⚠️ Esta prueba SOLO tiene sentido con el correo SIN configurar, que es el
 * estado de local y, a día de hoy, el de producción. Si algún día el tenant
 * tiene clave de Resend de verdad, la prueba se salta sola y lo dice.
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-enlace-videollamada.mjs [slug]
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { signAccessToken } from "../lib/auth/jwt.js";
import { getTenantResendConfig } from "../lib/outreach/resendConfig.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const MARCA = "smoke-meet@example.com";
const ENLACE = "https://meet.google.com/abc-defg-hij";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

async function main() {
  process.stdout.write(`\n═══ Smoke: el enlace de videollamada y lo que se le dice a la profesional (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`no existe el tenant ${SLUG}`);

  const { models } = getTenantDb(SLUG);
  const { Booking, EventType } = models;

  // Si el correo SÍ está configurado, esta prueba no puede medir nada.
  const resend = getTenantResendConfig({ tenant });
  if (resend.apiKey || process.env.RESEND_API_KEY) {
    process.stdout.write(
      `\n  · El correo está configurado en este entorno: la prueba del aviso\n` +
      `    "sin_configurar" no aplica. Nada que comprobar.\n\n`
    );
    process.exit(0);
  }

  const admin = await User.findOne({ where: { tenantId: tenant.id, role: "admin" } });
  const token = await signAccessToken({
    userId: admin.id, email: admin.email, role: admin.role, tenantSlug: SLUG,
  });
  const H = { "Content-Type": "application/json", Cookie: `access_token=${token}` };

  const eventType = await EventType.findOne({ where: { active: true }, order: [["order", "ASC"]] });
  let cita;

  try {
    paso("Preparando una cita online confirmada");
    cita = await Booking.create({
      eventTypeId: eventType.id,
      scheduledAt: new Date(Date.now() + 5 * 86400000),
      duration: eventType.duration,
      modality: "online",
      status: "confirmed",
      clientName: "Smoke Meet",
      clientEmail: MARCA,
      clientPhone: "+34600444555",
      paymentStatus: "none",
    });
    ok(`cita ${cita.id.slice(0, 8)}… lista`);

    paso("«Guardar y enviar» con el correo SIN configurar");
    const r = await fetch(`${BASE}/api/citas/bookings/${cita.id}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ meetUrl: ENLACE, enviarEmail: true }),
    });
    const j = await r.json();
    const d = j?.data ?? {};

    esperar(r.status === 200, `el guardado funciona (HTTP ${r.status})`);

    // Lo que de verdad importa: el enlace SE GUARDA aunque el correo no salga.
    await cita.reload();
    esperar(cita.meetUrl === ENLACE, "el enlace queda guardado en la cita pase lo que pase");

    esperar(
      d.emailEnviado === false,
      `NO dice que lo ha enviado (emailEnviado=${d.emailEnviado})`
    );
    esperar(
      d.emailMotivo === "sin_configurar",
      `y dice la causa correcta: falta configurar el correo (emailMotivo='${d.emailMotivo}')`
    );

    paso("Guardar sin enviar no promete nada");
    const r2 = await fetch(`${BASE}/api/citas/bookings/${cita.id}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ meetUrl: "https://meet.google.com/zzz-yyyy-xxx" }),
    });
    const d2 = (await r2.json())?.data ?? {};
    esperar(d2.emailEnviado === false, "guardar a secas no marca el correo como enviado");
  } finally {
    await Booking.destroy({ where: { clientEmail: { [Op.iLike]: "smoke-meet%" } }, force: true });
  }

  process.stdout.write(fallos ? `\n═══ ${fallos} fallo(s) ═══\n` : `\n═══ Todo en orden ═══\n`);
  process.exit(fallos ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
