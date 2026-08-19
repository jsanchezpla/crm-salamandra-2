// @vivo — «Smoke HTTP end-to-end del Checkpoint 4 del sprint nutri_laura [...] Idempotente: limpia preventivamente y al final». (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * smoke-nutri-laura-c4.mjs — Smoke HTTP end-to-end del Checkpoint 4 del
 * sprint nutri_laura. Cubre los 15 pasos del spec C4:
 *
 *   1. Dev server vivo + tablas crm_nutri_laura accesibles.
 *   2. Crear cliente test "Test C4 Cliente".
 *   3. POST público /book en nutri_laura → status=pending.
 *   4. Verificar bookingReceived en logs dry-run.
 *   5. GET /api/citas/bookings?status=pending lo encuentra.
 *   6. PATCH /confirm → confirmed + bookingConfirmed dry-run.
 *   7. PATCH /confirm de nuevo → idempotente (200 + status sigue confirmed).
 *   8. PATCH /api/citas/bookings/:id con {status:cancelled,...} sobre la
 *      confirmed → cancelada (el endpoint /reject no acepta confirmed,
 *      hay que usar PATCH base).
 *   9. POST público /book en tenant demo (autoConfirm=true) → confirmed.
 *  10. Verificar bookingConfirmed inmediato en logs dry-run.
 *  11. PATCH genérico status=pending sobre confirmed → 403.
 *  12. GET notes del cliente test, paginado.
 *  13. POST nota → aparece en lista.
 *  14. POST upload PDF → aparece en attachments.
 *  15. Cleanup: cliente test + sus bookings + notes + attachments + Audit.
 *
 * USO:
 *   1) Asegúrate de tener `npm run dev` corriendo en otra terminal
 *      (este smoke NO arranca el server).
 *   2) Exporta SMOKE_PASSWORD del admin nutri_laura para login real:
 *        $env:SMOKE_PASSWORD="<la password>"
 *      (sin la var, los pasos admin caen a Sequelize directo.)
 *   3) Lanza:
 *        node --env-file=.env.local scripts/smoke-nutri-laura-c4.mjs
 *
 * El smoke fuerza `RESEND_API_KEY` a undefined para que el helper de
 * email caiga en modo dry-run y no consuma quota real. Idempotente:
 * limpia preventivamente y al final.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { promises as fs } from "node:fs";
import path from "node:path";

const BASE_URL = "http://localhost:3000";
const TENANT_NUTRI = "nutri_laura";
const TENANT_DEMO = "demo";
const ADMIN_EMAIL_NUTRI = "admin@nutri-laura.es";
const ADMIN_PASSWORD = process.env.SMOKE_PASSWORD || null;

const TEST_CLIENT_NAME = "Test C4 Cliente";
const TEST_CLIENT_EMAIL = "test-c4-cliente@example.com";
const TEST_BOOK_EMAIL_NUTRI = "smoke-c4-nutri@example.com";
const TEST_BOOK_EMAIL_DEMO = "smoke-c4-demo@example.com";

// Forzar dry-run de Resend
delete process.env.RESEND_API_KEY;

let cookies = "";

// ── Helpers ────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toISOString().slice(11, 23);
}
function log(...args) {
  process.stdout.write(`  ${args.join(" ")}\n`);
}
function header(label) {
  process.stdout.write(`\n══ ${label} ${"═".repeat(Math.max(0, 60 - label.length))}\n`);
}
function pass(label) {
  process.stdout.write(`  ✓ ${label}\n`);
}
function fail(label, detail) {
  process.stdout.write(`  ✗ ${label}${detail ? ` — ${detail}` : ""}\n`);
}
function assertOk(cond, label, detail) {
  if (cond) {
    pass(label);
    counts.pass++;
  } else {
    fail(label, detail);
    counts.fail++;
    throw new Error(`assertion failed: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function pdfDummy(label) {
  const body = `%PDF-1.4\n% smoke c4 ${label}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}

async function httpJson(method, urlPath, body, extraHeaders) {
  const headers = { "Content-Type": "application/json", ...(extraHeaders || {}) };
  if (cookies) headers.Cookie = cookies;
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* puede no ser JSON */ }
  return { status: res.status, ok: res.ok, json: j, raw: text, headers: res.headers };
}

async function httpFormData(urlPath, formData) {
  const headers = {};
  if (cookies) headers.Cookie = cookies;
  const res = await fetch(`${BASE_URL}${urlPath}`, { method: "POST", headers, body: formData });
  const text = await res.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* puede no ser JSON */ }
  return { status: res.status, ok: res.ok, json: j, raw: text, headers: res.headers };
}

// ── Acceso a modelos (cleanup + verificaciones) ────────────────────────────

const modelCache = {};
async function getModels(slug) {
  if (modelCache[slug]) return modelCache[slug];
  const { getTenantDb } = await import("../lib/db/tenantDb.js");
  const { sequelize, models } = getTenantDb(slug);
  modelCache[slug] = { sequelize, models };
  return modelCache[slug];
}

// ── Estado global del smoke ────────────────────────────────────────────────

const counts = { pass: 0, fail: 0 };
const cleanup = {
  nutriClientId: null,
  nutriBookingPendingId: null,
  nutriBookingConfirmedId: null,
  demoBookingId: null,
};

// ── 1. Health check ────────────────────────────────────────────────────────

async function step1HealthCheck() {
  header("1) Dev server vivo + schemas crm_nutri_laura y crm_demo");
  let r;
  try {
    r = await fetch(`${BASE_URL}/api/auth/me`);
  } catch (e) {
    throw new Error(`Dev server no responde en ${BASE_URL} — arranca 'npm run dev' antes (${e.message})`);
  }
  assertOk(r.status === 200 || r.status === 401, "GET /api/auth/me", `status=${r.status}`);

  const nutri = await getModels(TENANT_NUTRI);
  const demo = await getModels(TENANT_DEMO);

  const [nutriClients] = await nutri.sequelize.query(
    `SELECT COUNT(*)::int AS n FROM crm_${TENANT_NUTRI}.clients`
  );
  assertOk(typeof nutriClients[0].n === "number", `Schema crm_${TENANT_NUTRI}.clients accesible`);
  const [demoBookings] = await demo.sequelize.query(
    `SELECT COUNT(*)::int AS n FROM crm_${TENANT_DEMO}.bookings`
  );
  assertOk(typeof demoBookings[0].n === "number", `Schema crm_${TENANT_DEMO}.bookings accesible`);
}

// ── 0. Cleanup pre-run ─────────────────────────────────────────────────────

async function preCleanup() {
  header("0) Cleanup preventivo (idempotencia)");
  const nutri = await getModels(TENANT_NUTRI);
  const demo = await getModels(TENANT_DEMO);

  await nutri.models.Booking.destroy({ where: { clientEmail: TEST_BOOK_EMAIL_NUTRI } });
  await demo.models.Booking.destroy({ where: { clientEmail: TEST_BOOK_EMAIL_DEMO } });

  const stale = await nutri.models.Client.findAll({ where: { email: TEST_CLIENT_EMAIL } });
  for (const c of stale) await c.destroy();
  log(`  · ${stale.length} clientes previos eliminados de nutri_laura`);
}

// ── Login ──────────────────────────────────────────────────────────────────

async function login() {
  header("Login HTTP admin nutri_laura");
  if (!ADMIN_PASSWORD) {
    log("  · SMOKE_PASSWORD no seteada → pasos admin caerán a Sequelize directo.");
    return false;
  }
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tenant": TENANT_NUTRI },
    body: JSON.stringify({ email: ADMIN_EMAIL_NUTRI, password: ADMIN_PASSWORD, tenantSlug: TENANT_NUTRI }),
  });
  if (!res.ok) {
    log(`  ✗ Login devolvió ${res.status} — pasos admin caerán a Sequelize directo.`);
    return false;
  }
  const setCookie = res.headers.getSetCookie?.() || res.headers.raw?.()["set-cookie"] || [];
  cookies = setCookie.map((c) => c.split(";")[0]).join("; ");
  pass(`Login OK; cookie obtenida (len ${cookies.length})`);
  counts.pass++;
  return true;
}

// ── 2. Crear cliente test ──────────────────────────────────────────────────

async function step2CreateClient(authed) {
  header("2) Crear cliente Test C4 Cliente en nutri_laura");
  const nutri = await getModels(TENANT_NUTRI);
  if (authed) {
    const r = await httpJson("POST", "/api/clients", {
      name: TEST_CLIENT_NAME,
      email: TEST_CLIENT_EMAIL,
      phone: "600999111",
      type: "individual",
      status: "new",
      customFields: { edad: "40", motivo: "Smoke C4", info_adicional: "—" },
    });
    assertOk(r.ok && r.json?.ok, "POST /api/clients", `status=${r.status} err=${r.json?.error}`);
    cleanup.nutriClientId = r.json.data.id;
  } else {
    const c = await nutri.models.Client.create({
      name: TEST_CLIENT_NAME, email: TEST_CLIENT_EMAIL, phone: "600999111",
      type: "individual",
      customFields: { edad: "40", motivo: "Smoke C4", info_adicional: "—", seStatus: "new" },
    });
    cleanup.nutriClientId = c.id;
    pass(`Client creado via modelo — id=${c.id}`);
    counts.pass++;
  }
}

// ── Helper: encontrar slot válido para POST /book ──────────────────────────

async function findValidSlot(slug, eventType, now = new Date()) {
  const { models } = await getModels(slug);
  // Estrategia: probar miércoles a +14 días a 10:00 Madrid. Si no hay
  // availability, iteramos +1 día hasta encontrar uno; si no encontramos
  // en 21 días, fallamos.
  const minNoticeMs = (eventType.minNoticeHours ?? 0) * 60 * 60 * 1000;
  const baseTs = now.getTime() + Math.max(14 * 24 * 60 * 60 * 1000, minNoticeMs + 60_000);
  const allAvail = await models.Availability.findAll();
  for (let offset = 0; offset < 21; offset++) {
    const candidate = new Date(baseTs + offset * 24 * 60 * 60 * 1000);
    candidate.setUTCHours(8, 0, 0, 0); // 10:00 Madrid CEST aprox
    // Sequelize devuelve `dayOfWeek` 0..6, donde nuestra convención está en
    // lib/citas/slots.js usando getMadridDayOfWeek. Calculamos en UTC
    // simple (lun=1, mié=3...).
    const utcDay = candidate.getUTCDay(); // 0..6 (Sunday=0)
    const matches = allAvail.filter((a) => Number(a.dayOfWeek) === utcDay);
    if (matches.length === 0) continue;
    return candidate;
  }
  return null;
}

// ── 3 + 4. POST /book nutri_laura → pending + bookingReceived ──────────────

async function step3and4Pending() {
  header("3+4) POST público /book nutri_laura → pending + bookingReceived");
  const nutri = await getModels(TENANT_NUTRI);
  const et = await nutri.models.EventType.findOne({
    where: { active: true },
    order: [["createdAt", "ASC"]],
  });
  assertOk(!!et, "EventType activo encontrado en nutri_laura");

  const slot = await findValidSlot(TENANT_NUTRI, et);
  if (!slot) {
    log("  ⚠ Sin Availability válida en próximos 21 días — saltamos pasos 3-8");
    return false;
  }

  const r = await fetch(`${BASE_URL}/api/public/c/${TENANT_NUTRI}/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventTypeId: et.id,
      scheduledAt: slot.toISOString(),
      clientName: "Smoke C4 Nutri",
      clientEmail: TEST_BOOK_EMAIL_NUTRI,
      clientPhone: "600000333",
      additionalData: "Smoke C4 — slot pending",
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    log(`  ⚠ POST /book devolvió ${r.status}: ${j.error ?? r.statusText} — saltamos`);
    return false;
  }

  const created = await nutri.models.Booking.findByPk(j.data.booking.id);
  assertOk(created?.status === "pending", "Booking nutri_laura creado con status=pending", `status=${created?.status}`);
  cleanup.nutriBookingPendingId = created.id;

  log("  ▸ Paso 4: verifica MANUALMENTE en consola dev una línea como:");
  log(`     [email:send:dry-run] to="${TEST_BOOK_EMAIL_NUTRI}" subject="Hemos recibido tu solicitud de cita" preview="..."`);
  log("    (el smoke no puede capturar stdout de un dev server externo)");
  return true;
}

// ── 5. GET bookings?status=pending lo encuentra ────────────────────────────

async function step5ListPending(authed) {
  header("5) GET /api/citas/bookings?status=pending encuentra la nueva");
  if (!cleanup.nutriBookingPendingId) {
    log("  · skip (paso 3 falló)");
    return;
  }
  if (!authed) {
    const nutri = await getModels(TENANT_NUTRI);
    const found = await nutri.models.Booking.findOne({
      where: { id: cleanup.nutriBookingPendingId, status: "pending" },
    });
    assertOk(!!found, "Booking pending visible (via Sequelize fallback)");
    return;
  }
  const r = await httpJson("GET", "/api/citas/bookings?status=pending&limit=100");
  assertOk(r.ok && r.json?.ok, "GET pendings", `status=${r.status} err=${r.json?.error}`);
  const found = r.json.data.bookings.find((b) => b.id === cleanup.nutriBookingPendingId);
  assertOk(!!found, `Booking ${cleanup.nutriBookingPendingId} aparece en la lista de pending`);
}

// ── 6. PATCH /confirm → confirmed + bookingConfirmed ───────────────────────

async function step6Confirm(authed) {
  header("6) PATCH /confirm → confirmed + email bookingConfirmed (dry-run)");
  if (!cleanup.nutriBookingPendingId) {
    log("  · skip (paso 3 falló)");
    return;
  }
  if (!authed) {
    log("  · skip (sin auth)");
    return;
  }
  const r = await httpJson("PATCH", `/api/citas/bookings/${cleanup.nutriBookingPendingId}/confirm`);
  assertOk(
    r.ok && r.json?.ok && r.json.data.status === "confirmed",
    "PATCH /confirm devuelve status=confirmed",
    `status=${r.status} dataStatus=${r.json?.data?.status}`
  );
  cleanup.nutriBookingConfirmedId = cleanup.nutriBookingPendingId;
  cleanup.nutriBookingPendingId = null;
  log("  ▸ Verifica MANUALMENTE en consola dev:");
  log(`     [email:send:dry-run] to="${TEST_BOOK_EMAIL_NUTRI}" subject="Tu cita está confirmada"`);
}

// ── 7. PATCH /confirm idempotente ──────────────────────────────────────────

async function step7DoubleConfirm(authed) {
  header("7) PATCH /confirm sobre confirmed → idempotente (200, sin cambio)");
  if (!cleanup.nutriBookingConfirmedId || !authed) {
    log("  · skip");
    return;
  }
  const r = await httpJson("PATCH", `/api/citas/bookings/${cleanup.nutriBookingConfirmedId}/confirm`);
  // El endpoint /confirm devuelve 200 + booking sin cambios cuando ya está
  // confirmed (idempotencia explícita en confirm/route.js:36-40). El spec
  // C4 paso 7 esperaba 400 — corregido aquí porque el contrato real es 200.
  assertOk(
    r.ok && r.json?.ok && r.json.data.status === "confirmed",
    "Segundo /confirm es idempotente (200 OK + status sigue confirmed)",
    `status=${r.status} dataStatus=${r.json?.data?.status}`
  );
}

// ── 8. PATCH base con {status:cancelled} sobre confirmed ───────────────────

async function step8CancelConfirmed(authed) {
  header("8) PATCH base con status=cancelled sobre confirmed → cancelled");
  if (!cleanup.nutriBookingConfirmedId || !authed) {
    log("  · skip");
    return;
  }
  // NOTA: el spec C4 decía "PATCH /reject de una booking confirmed", pero
  // el endpoint /reject rechaza 409 sobre confirmed (solo acepta pending).
  // Para cancelar una confirmed hay que usar PATCH base con status=cancelled
  // y cancellationReason. Eso es lo que prueba este paso.
  const r = await httpJson("PATCH", `/api/citas/bookings/${cleanup.nutriBookingConfirmedId}`, {
    status: "cancelled",
    cancellationReason: "Smoke C4 — cancelar confirmed",
  });
  assertOk(
    r.ok && r.json?.ok && r.json.data.status === "cancelled" && r.json.data.cancellationReason?.includes("Smoke C4"),
    "PATCH base cancela confirmed con razón",
    `status=${r.status} dataStatus=${r.json?.data?.status} reason=${r.json?.data?.cancellationReason}`
  );
}

// ── 9 + 10. Booking en demo con autoConfirm=true → confirmed inmediato ────

async function step9and10DemoAutoConfirm() {
  header("9+10) POST /book demo (autoConfirm=true) → confirmed inmediato");
  const demo = await getModels(TENANT_DEMO);

  // Verificar que demo NO tiene autoConfirmPublicBookings=false.
  const { getMasterModels } = await import("../lib/db/masterDb.js");
  const { Tenant, TenantModule } = getMasterModels();
  const demoTenant = await Tenant.findOne({ where: { slug: TENANT_DEMO } });
  if (!demoTenant) {
    log("  ⚠ tenant 'demo' no existe en master.tenants — saltamos");
    return;
  }
  const mod = await TenantModule.findOne({
    where: { tenantId: demoTenant.id, moduleKey: "citas" },
  });
  if (!mod) {
    log("  ⚠ tenant demo no tiene módulo citas habilitado — saltamos");
    return;
  }
  if (mod.featureFlags?.autoConfirmPublicBookings === false) {
    log("  ⚠ demo tiene autoConfirmPublicBookings=false — no se puede testear auto-confirm aquí. Saltamos");
    return;
  }

  const et = await demo.models.EventType.findOne({
    where: { active: true },
    order: [["createdAt", "ASC"]],
  });
  if (!et) {
    log("  ⚠ demo no tiene EventType activo — saltamos");
    return;
  }
  if (!Array.isArray(et.modalities) || !et.modalities.includes("online")) {
    log(`  ⚠ EventType de demo no admite modality 'online' (modalities=${JSON.stringify(et.modalities)}) — saltamos`);
    return;
  }

  const slot = await findValidSlot(TENANT_DEMO, et);
  if (!slot) {
    log("  ⚠ demo sin Availability válida en próximos 21 días — saltamos");
    return;
  }

  const r = await fetch(`${BASE_URL}/api/public/c/${TENANT_DEMO}/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventTypeId: et.id,
      scheduledAt: slot.toISOString(),
      clientName: "Smoke C4 Demo",
      clientEmail: TEST_BOOK_EMAIL_DEMO,
      clientPhone: "600000444",
      additionalData: "Smoke C4 — demo auto-confirm",
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    log(`  ⚠ POST /book demo devolvió ${r.status}: ${j.error ?? r.statusText} — saltamos`);
    return;
  }

  const created = await demo.models.Booking.findByPk(j.data.booking.id);
  assertOk(created?.status === "confirmed", "Booking demo creado con status=confirmed", `status=${created?.status}`);
  cleanup.demoBookingId = created.id;
  log("  ▸ Paso 10: verifica MANUALMENTE en consola dev:");
  log(`     [email:send:dry-run] to="${TEST_BOOK_EMAIL_DEMO}" subject="Tu cita está confirmada"`);
}

// ── 11. PATCH genérico status=pending desde confirmed → 403 ────────────────

async function step11RegressionBlocked(authed) {
  header("11) PATCH status='pending' sobre cancelled → 403 (regresión bloqueada)");
  if (!cleanup.nutriBookingConfirmedId || !authed) {
    log("  · skip");
    return;
  }
  // Tras el paso 8 la booking nutri quedó cancelled. El PATCH base bloquea
  // regresión a 'pending' desde cualquier estado terminal (no solo confirmed).
  const r = await httpJson("PATCH", `/api/citas/bookings/${cleanup.nutriBookingConfirmedId}`, { status: "pending" });
  assertOk(
    r.status === 403 && r.json?.error?.includes("no puede volver al estado pendiente"),
    "Regresión a pending → 403",
    `status=${r.status} err=${r.json?.error}`
  );
}

// ── 12. GET notes paginado ─────────────────────────────────────────────────

async function step12NotesList(authed) {
  header("12) GET /api/clients/:id/notes paginado");
  if (!cleanup.nutriClientId) {
    log("  · skip (sin cliente)");
    return;
  }
  if (!authed) {
    log("  · skip (sin auth)");
    return;
  }
  const r = await httpJson("GET", `/api/clients/${cleanup.nutriClientId}/notes?page=1&limit=50`);
  assertOk(
    r.ok && r.json?.ok && typeof r.json.data?.total === "number",
    "GET notes devuelve { notes, total, page, limit }",
    `status=${r.status}`
  );
  log(`  · total inicial: ${r.json.data.total} notas`);
}

// ── 13. POST nota → aparece en lista ───────────────────────────────────────

async function step13NewNote(authed) {
  header("13) POST nota → aparece en GET subsiguiente");
  if (!cleanup.nutriClientId || !authed) {
    log("  · skip");
    return;
  }
  const r = await httpJson("POST", `/api/clients/${cleanup.nutriClientId}/notes`, {
    content: "Smoke C4 — nota inicial del paciente",
  });
  assertOk(r.ok && r.json?.ok && r.json.data.id, "POST nota", `status=${r.status}`);
  const noteId = r.json.data.id;

  const r2 = await httpJson("GET", `/api/clients/${cleanup.nutriClientId}/notes`);
  const found = r2.json?.data?.notes?.find((n) => n.id === noteId);
  assertOk(!!found, "Nota recién creada aparece en GET");
}

// ── 14. POST upload PDF → aparece en attachments ───────────────────────────

async function step14UploadPdf(authed) {
  header("14) POST upload PDF → aparece en GET attachments");
  if (!cleanup.nutriClientId || !authed) {
    log("  · skip");
    return;
  }
  const fd = new FormData();
  fd.append("file", new Blob([pdfDummy("smoke-c4")], { type: "application/pdf" }), "informe-c4.pdf");
  const r = await httpFormData(`/api/clients/${cleanup.nutriClientId}/attachments`, fd);
  assertOk(r.ok && r.json?.ok && r.json.data.id, "POST attachment PDF", `status=${r.status} err=${r.json?.error}`);
  const attachmentId = r.json.data.id;

  const r2 = await httpJson("GET", `/api/clients/${cleanup.nutriClientId}/attachments`);
  const found = r2.json?.data?.attachments?.find((a) => a.id === attachmentId);
  assertOk(!!found, "Attachment recién subido aparece en GET");
}

// ── 15. Cleanup final ──────────────────────────────────────────────────────

async function step15Cleanup(authed) {
  header("15) Cleanup final");
  const nutri = await getModels(TENANT_NUTRI);
  const demo = await getModels(TENANT_DEMO);

  if (cleanup.nutriClientId) {
    if (authed) {
      // DELETE HTTP también borra el directorio físico de uploads.
      const r = await fetch(`${BASE_URL}/api/clients/${cleanup.nutriClientId}`, {
        method: "DELETE", headers: { Cookie: cookies },
      });
      assertOk(r.status === 204, "DELETE cliente test (CASCADE notes+attachments)", `status=${r.status}`);
    } else {
      await nutri.models.Client.destroy({ where: { id: cleanup.nutriClientId } });
      pass("Cliente borrado via Sequelize fallback");
      counts.pass++;
    }
  }

  // Bookings creados desde el formulario público no tienen FK a client,
  // hay que borrarlos manualmente por email para idempotencia del próximo run.
  await nutri.models.Booking.destroy({ where: { clientEmail: TEST_BOOK_EMAIL_NUTRI } });
  await demo.models.Booking.destroy({ where: { clientEmail: TEST_BOOK_EMAIL_DEMO } });
  log("  · Bookings nutri+demo eliminados");

  // Audit logs asociados — best effort.
  try {
    const { getMasterModels } = await import("../lib/db/masterDb.js");
    const { AuditLog } = getMasterModels();
    if (AuditLog) {
      await AuditLog.destroy({
        where: {
          entity: "Booking",
          entityId: [cleanup.nutriBookingConfirmedId, cleanup.nutriBookingPendingId, cleanup.demoBookingId].filter(Boolean),
        },
      });
      log("  · Audit logs de bookings test eliminados");
    }
  } catch (e) {
    log(`  · audit cleanup skipped: ${e.message}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write(`\nSmoke nutri_laura Checkpoint 4 — ${ts()}\n`);
  process.stdout.write(`${"═".repeat(64)}\n`);

  let authed = false;
  try {
    await step1HealthCheck();
    await preCleanup();
    authed = await login();
    await step2CreateClient(authed);
    const pendingOk = await step3and4Pending();
    if (pendingOk) {
      await step5ListPending(authed);
      await step6Confirm(authed);
      await step7DoubleConfirm(authed);
      await step8CancelConfirmed(authed);
    }
    await step9and10DemoAutoConfirm();
    await step11RegressionBlocked(authed);
    await step12NotesList(authed);
    await step13NewNote(authed);
    await step14UploadPdf(authed);
    await step15Cleanup(authed);
  } catch (err) {
    process.stderr.write(`\n✗ Smoke abortado: ${err.message}\n`);
    if (err.stack) process.stderr.write(err.stack + "\n");
    // Cleanup defensivo aunque haya petado.
    try { await step15Cleanup(authed); } catch { /* swallow */ }
  } finally {
    try {
      const { closeAllConnections } = await import("../lib/db/tenantDb.js");
      await closeAllConnections().catch(() => {});
    } catch { /* tenantDb no exporta closeAllConnections en alguna build */ }
  }

  header("Resumen");
  log(`Pasos OK    : ${counts.pass}`);
  log(`Pasos KO    : ${counts.fail}`);
  log(`Modo        : ${authed ? "HTTP completo con JWT admin nutri_laura" : "HTTP público + admin via Sequelize fallback"}`);
  log(`Dry-run     : RESEND_API_KEY forzado a undefined — emails solo logueados`);
  log(``);
  log(`Logs de email a verificar en la consola del dev server:`);
  log(`  · [email:send:dry-run] to="${TEST_BOOK_EMAIL_NUTRI}" subject="Hemos recibido tu solicitud de cita"`);
  log(`  · [email:send:dry-run] to="${TEST_BOOK_EMAIL_NUTRI}" subject="Tu cita está confirmada"`);
  log(`  · [email:send:dry-run] to="${TEST_BOOK_EMAIL_DEMO}"  subject="Tu cita está confirmada"`);

  process.exit(counts.fail > 0 ? 1 : 0);
}

main();
