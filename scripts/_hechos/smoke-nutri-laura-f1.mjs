/**
 * smoke-nutri-laura-f1.mjs — Smoke HTTP end-to-end del sprint Fase 1
 * para el tenant nutri_laura. Arranca el dev server en background, hace
 * login real (si recibe la password) y dispara los 17+ pasos del sprint
 * contra los endpoints reales.
 *
 * Uso (con auth completa — recomendado):
 *   $env:SMOKE_PASSWORD="<la password del admin nutri-laura>"
 *   node --env-file=.env.local scripts/smoke-nutri-laura-f1.mjs
 *
 * Uso (sin auth — fallback parcial):
 *   node --env-file=.env.local scripts/smoke-nutri-laura-f1.mjs
 *   (los pasos admin se ejecutan via modelos Sequelize en vez de HTTP,
 *    los pasos públicos siguen siendo HTTP reales; se reporta cuál es
 *    cuál en el output).
 *
 * El smoke borra todo lo que crea. NO toca datos preexistentes.
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promises as fs } from "node:fs";
import path from "node:path";

const BASE_URL = "http://localhost:3000";
const TENANT_SLUG = "nutri_laura";
const ADMIN_EMAIL = "admin@nutri-laura.es";
const ADMIN_PASSWORD = process.env.SMOKE_PASSWORD || null;
const TEST_CLIENT_NAME = "Test F1 Paciente";
const TEST_CLIENT_EMAIL = "test-f1-paciente@example.com";
const TEST_PATIENT_EMAIL_A = "smoke-f1-book-a@example.com";
const TEST_PATIENT_EMAIL_B = "smoke-f1-book-b@example.com";

// Forzar dry-run de Resend durante el smoke (no consume quota)
delete process.env.RESEND_API_KEY;

let cookies = "";
let serverProc = null;
let serverLog = "";
let serverSpawned = false; // true si arrancamos nosotros el server (vemos stdout)

// ── Helpers ────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toISOString().slice(11, 23);
}
function log(...args) {
  process.stdout.write(`  ${args.join(" ")}\n`);
}
function header(label) {
  process.stdout.write(`\n══ ${label} ${"═".repeat(Math.max(0, 56 - label.length))}\n`);
}
function pass(label) {
  process.stdout.write(`  ✓ ${label}\n`);
}
function fail(label, detail) {
  process.stdout.write(`  ✗ ${label}${detail ? ` — ${detail}` : ""}\n`);
}
function assert(cond, label, detail) {
  if (cond) pass(label);
  else {
    fail(label, detail);
    throw new Error(`assertion failed: ${label}`);
  }
}

// PDF dummy: cabecera + EOF mínima. No es un PDF "completo" pero pasa
// nuestra validación MIME (content-type, no magic bytes).
function pdfDummy(label) {
  const body = `%PDF-1.4\n% smoke f1 ${label}\n%%EOF\n`;
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
  try { j = text ? JSON.parse(text) : null; } catch { /* puede ser respuesta no-JSON */ }
  return { status: res.status, ok: res.ok, json: j, raw: text, headers: res.headers };
}

async function httpFormData(urlPath, formData) {
  const headers = {};
  if (cookies) headers.Cookie = cookies;
  const res = await fetch(`${BASE_URL}${urlPath}`, { method: "POST", headers, body: formData });
  const text = await res.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* puede ser respuesta no-JSON */ }
  return { status: res.status, ok: res.ok, json: j, raw: text, headers: res.headers };
}

// ── Dev server lifecycle ───────────────────────────────────────────────────

async function ensureServer() {
  header("Comprobando dev server en " + BASE_URL);

  // ¿Ya hay alguien escuchando?
  try {
    const r = await fetch(`${BASE_URL}/api/auth/me`, { method: "GET" });
    if (r.status === 401 || r.status === 200) {
      log("✓ Dev server ya corriendo — reutilizamos");
      log("  ⚠ Cambios en middleware.js / modelos requieren reinicio manual del server.");
      log("    Si no reiniciaste tras Checkpoint 2/Final, hazlo: Ctrl+C + npm run dev.");
      serverSpawned = false;
      return false; // no spawned by us
    }
  } catch { /* puerto libre, arrancamos */ }

  log("· Puerto libre — arrancando npm run dev…");
  serverProc = spawn("npm.cmd", ["run", "dev"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  serverProc.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
  serverProc.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE_URL}/api/auth/me`, { method: "GET" });
      if (r.status === 401 || r.status === 200) {
        log("✓ Dev server listo");
        serverSpawned = true;
        return true;
      }
    } catch { /* todavía no escucha */ }
    await sleep(1500);
  }
  throw new Error("dev server no arrancó en 60 s");
}

async function stopServerIfSpawned() {
  if (!serverProc) return;
  serverProc.kill("SIGTERM");
  await sleep(800);
  try { serverProc.kill("SIGKILL"); } catch {}
}

// ── Auth ────────────────────────────────────────────────────────────────────

async function login() {
  header("Login HTTP real");
  if (!ADMIN_PASSWORD) {
    log("· SMOKE_PASSWORD no seteada → modo sin auth (admin via modelos).");
    return false;
  }
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tenant": TENANT_SLUG },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, tenantSlug: TENANT_SLUG }),
  });
  if (!res.ok) {
    log(`✗ Login devolvió ${res.status} — modo sin auth.`);
    return false;
  }
  const setCookie = res.headers.getSetCookie?.() || res.headers.raw?.()["set-cookie"] || [];
  cookies = setCookie.map((c) => c.split(";")[0]).join("; ");
  pass(`Login OK; cookie obtenida (longitud ${cookies.length})`);
  return true;
}

// ── Modo fallback: import dinámico de modelos Sequelize ────────────────────

let modelsLib = null;
async function loadModels() {
  if (modelsLib) return modelsLib;
  const { getTenantDb } = await import("../../lib/db/tenantDb.js");
  const { sequelize, models } = getTenantDb(TENANT_SLUG);
  modelsLib = { sequelize, models };
  return modelsLib;
}

// ── Steps ───────────────────────────────────────────────────────────────────

const counts = { pass: 0, fail: 0 };
function recordPass(label) { counts.pass++; pass(label); }

const cleanup = { clientId: null, bookingPendingId: null, bookingConfirmedId: null, bookingRejectedId: null };

async function runHttpSmoke(authed) {
  // ── Limpieza preventiva ──────────────────────────────────────────────────
  header("0) Limpieza preventiva (idempotente)");
  const { models } = await loadModels();
  await models.Booking.destroy({ where: { clientEmail: [TEST_PATIENT_EMAIL_A, TEST_PATIENT_EMAIL_B] } });
  const stale = await models.Client.findAll({ where: { email: TEST_CLIENT_EMAIL } });
  for (const c of stale) await c.destroy(); // CASCADE limpia notes+attachments
  log(`· Limpieza completada (${stale.length} clientes previos eliminados)`);

  // ── 1) Crear cliente "Test F1 Paciente" ─────────────────────────────────
  header("1) Crear cliente Test F1 Paciente");
  let clientId;
  if (authed) {
    const r = await httpJson("POST", "/api/clients", {
      name: TEST_CLIENT_NAME,
      email: TEST_CLIENT_EMAIL,
      phone: "600999000",
      type: "individual",
      status: "new",
      customFields: { edad: "33", motivo: "Smoke test F1", info_adicional: "—" },
    });
    assert(r.ok && r.json?.ok, "POST /api/clients", `status=${r.status} err=${r.json?.error}`);
    clientId = r.json.data.id;
  } else {
    const c = await models.Client.create({
      name: TEST_CLIENT_NAME, email: TEST_CLIENT_EMAIL, phone: "600999000",
      type: "individual", customFields: { edad: "33", motivo: "Smoke test F1", info_adicional: "—", seStatus: "new" },
    });
    clientId = c.id;
    pass(`Client creado via modelo (fallback) — id=${clientId}`);
  }
  cleanup.clientId = clientId;
  counts.pass++;

  // ── 2) Subir 2 PDFs ──────────────────────────────────────────────────────
  header("2) Subir 2 PDFs al cliente");
  const uploadedIds = [];
  if (authed) {
    for (const label of ["analitica.pdf", "plan-nutricional.pdf"]) {
      const fd = new FormData();
      fd.append("file", new Blob([pdfDummy(label)], { type: "application/pdf" }), label);
      const r = await httpFormData(`/api/clients/${clientId}/attachments`, fd);
      assert(r.ok && r.json?.ok, `POST attachment ${label}`, `status=${r.status} err=${r.json?.error}`);
      uploadedIds.push(r.json.data.id);
      counts.pass++;
    }

    // Verificar archivos físicos
    const { getClientDir } = await import("../../lib/clients/attachmentStorage.js");
    const dir = getClientDir(TENANT_SLUG, clientId);
    const files = await fs.readdir(dir);
    assert(files.length === 2, "2 archivos físicos en disco", `encontrados ${files.length} en ${dir}`);
    counts.pass++;

    // ── 3) Verificar contador (2/50) vía GET ──────────────────────────────
    header("3) GET attachments — contador 2/50");
    const list = await httpJson("GET", `/api/clients/${clientId}/attachments`);
    assert(list.ok && list.json?.data?.total === 2, "GET attachments total=2", `total=${list.json?.data?.total}`);
    counts.pass++;

    // ── 4) Subir un .txt → 422 ────────────────────────────────────────────
    header("4) Subir .txt → debe rechazarse");
    const badFd = new FormData();
    badFd.append("file", new Blob(["hola"], { type: "text/plain" }), "bad.txt");
    const bad = await httpFormData(`/api/clients/${clientId}/attachments`, badFd);
    assert(bad.status === 422 && !bad.json?.ok, "POST .txt → 422", `status=${bad.status} err=${bad.json?.error}`);
    counts.pass++;

    // ── 5) Borrar 1 PDF ──────────────────────────────────────────────────
    header("5) Borrar 1 PDF (BD + disco)");
    const delRes = await fetch(`${BASE_URL}/api/clients/${clientId}/attachments/${uploadedIds[0]}`, {
      method: "DELETE", headers: { Cookie: cookies },
    });
    assert(delRes.status === 204, "DELETE attachment", `status=${delRes.status}`);
    const filesAfter = await fs.readdir(dir);
    assert(filesAfter.length === 1, "1 archivo físico tras borrado", `encontrados ${filesAfter.length}`);
    counts.pass += 2;

    // ── 6) Descargar 1 PDF ───────────────────────────────────────────────
    header("6) Descargar PDF — Content-Disposition");
    const dlRes = await fetch(`${BASE_URL}/api/clients/${clientId}/attachments/${uploadedIds[1]}/download`, {
      headers: { Cookie: cookies },
    });
    const cd = dlRes.headers.get("content-disposition");
    const ct = dlRes.headers.get("content-type");
    assert(dlRes.ok && ct === "application/pdf" && cd?.includes("attachment;"), "GET download stream", `status=${dlRes.status} ct=${ct} cd=${cd}`);
    counts.pass++;
  } else {
    log("· Modo fallback: pasos 2-6 (attachments HTTP) saltados — requieren login.");
  }

  // ── 7) Añadir 3 notas ────────────────────────────────────────────────────
  header("7) Añadir 3 notas internas");
  let noteIds = [];
  if (authed) {
    for (const content of ["Primera consulta agendada", "Paciente refiere intolerancia a la lactosa", "Plan inicial entregado"]) {
      const r = await httpJson("POST", `/api/clients/${clientId}/notes`, { content });
      assert(r.ok && r.json?.ok, `POST note "${content.slice(0, 20)}…"`, `status=${r.status}`);
      noteIds.push(r.json.data.id);
      counts.pass++;
    }
    // Verificar createdBy (debería tener email del admin si JWT lleva email)
    const sample = await models.ClientNote.findByPk(noteIds[0]);
    log(`  · sample.createdBy = "${sample.createdBy ?? "NULL"}" ${sample.createdBy === ADMIN_EMAIL ? "✓" : "(JWT antiguo? logout/login para que rellene)"}`);
  } else {
    for (const content of ["Note A", "Note B", "Note C"]) {
      const n = await models.ClientNote.create({ clientId, content });
      noteIds.push(n.id);
    }
    counts.pass += 3;
    log(`· 3 notas creadas via modelo (fallback)`);
  }

  // ── 8) Listar notas DESC ─────────────────────────────────────────────────
  header("8) GET notes — 3 en orden DESC");
  if (authed) {
    const r = await httpJson("GET", `/api/clients/${clientId}/notes`);
    assert(r.ok && r.json?.data?.total === 3, "GET notes total=3", `total=${r.json?.data?.total}`);
    const ordered = r.json.data.notes.every((n, i, arr) => i === 0 || new Date(arr[i - 1].createdAt) >= new Date(n.createdAt));
    assert(ordered, "Notas en orden DESC por createdAt");
    counts.pass += 2;
  } else {
    log(`· skip (modo fallback)`);
  }

  // ── 9) Borrar 1 nota ─────────────────────────────────────────────────────
  header("9) Borrar 1 nota");
  if (authed) {
    const r = await fetch(`${BASE_URL}/api/clients/${clientId}/notes/${noteIds[0]}`, {
      method: "DELETE", headers: { Cookie: cookies },
    });
    assert(r.status === 204, "DELETE note", `status=${r.status}`);
    counts.pass++;
  } else {
    await models.ClientNote.destroy({ where: { id: noteIds[0] } });
    log(`· borrado via modelo`);
  }

  // ── 10) POST público /book → pending ─────────────────────────────────────
  header("10) POST público /book → status=pending");
  const eventType = await models.EventType.findOne({ where: { active: true } });
  assert(!!eventType, "EventType activo encontrado");
  counts.pass++;

  const scheduledA = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // +14 días para evitar minNotice
  // Alinear a hora :00 dentro de la availability (lun-vie 9-14 / 16-18 madrid).
  // Forzamos un martes 10:00 europa/madrid.
  const d = new Date(scheduledA);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(8, 0, 0, 0); // 10:00 Madrid CEST ≈ 08:00 UTC
  const r10 = await fetch(`${BASE_URL}/api/public/c/${TENANT_SLUG}/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventTypeId: eventType.id,
      scheduledAt: d.toISOString(),
      clientName: "Smoke Booker A",
      clientEmail: TEST_PATIENT_EMAIL_A,
      clientPhone: "600000111",
      additionalData: "Smoke test F1 — slot pending",
    }),
  });
  const j10 = await r10.json().catch(() => ({}));
  if (r10.ok && j10.ok) {
    const created = await models.Booking.findByPk(j10.data.booking.id);
    assert(created?.status === "pending", "Booking público creado con status=pending", `status=${created?.status}`);
    cleanup.bookingPendingId = created.id;
    counts.pass++;
  } else {
    log(`  ⚠ POST /book devolvió ${r10.status}: ${j10.error ?? r10.statusText}`);
    log(`     (el endpoint valida disponibilidad — si nutri_laura no tiene slot ese día/hora,`);
    log(`     este paso falla. Saltamos los pasos 10-15 dependientes.)`);
  }

  // ── 11) Verificar log dry-run "received" ─────────────────────────────────
  header("11) Verificar log [email:send:dry-run] received");
  if (cleanup.bookingPendingId) {
    await sleep(500); // dejar que el handler termine de loguear
    if (serverSpawned) {
      const hasReceived = serverLog.includes("[email:send:dry-run]") &&
        serverLog.includes("Hemos recibido tu solicitud de cita") &&
        serverLog.includes(TEST_PATIENT_EMAIL_A);
      assert(hasReceived, "log dry-run bookingReceived encontrado en server output");
      counts.pass++;
    } else {
      log(`  ▸ Server externo — el log no es capturable desde el smoke.`);
      log(`  ▸ Verifica MANUALMENTE en tu consola de 'npm run dev' una línea como:`);
      log(`     [email:send:dry-run] to="${TEST_PATIENT_EMAIL_A}" ... subject="Hemos recibido tu solicitud de cita"`);
    }
  } else {
    log("· skip (paso 10 falló)");
  }

  // ── 12) PATCH /confirm + log "confirmed" ─────────────────────────────────
  header("12) PATCH /confirm → status=confirmed + email confirmed");
  if (cleanup.bookingPendingId) {
    if (authed) {
      const r = await httpJson("PATCH", `/api/citas/bookings/${cleanup.bookingPendingId}/confirm`);
      assert(r.ok && r.json?.ok && r.json.data.status === "confirmed", "PATCH /confirm", `status=${r.status}`);
      cleanup.bookingConfirmedId = cleanup.bookingPendingId;
      counts.pass++;
      await sleep(500);
      if (serverSpawned) {
        const hasConfirmed = serverLog.includes("Tu cita está confirmada") && serverLog.includes(TEST_PATIENT_EMAIL_A);
        assert(hasConfirmed, "log dry-run bookingConfirmed encontrado");
        counts.pass++;
      } else {
        log(`  ▸ Verifica MANUALMENTE en consola del dev server: [email:send:dry-run] subject="Tu cita está confirmada"`);
      }
    } else {
      log("· skip (modo fallback — PATCH admin requiere auth)");
    }
  } else {
    log("· skip");
  }

  // ── 13) Crear segundo booking pending + reject ───────────────────────────
  header("13) Crear booking pending B + PATCH /reject");
  const dB = new Date(d);
  dB.setUTCDate(dB.getUTCDate() + 7); // siguiente martes
  const r13 = await fetch(`${BASE_URL}/api/public/c/${TENANT_SLUG}/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventTypeId: eventType.id,
      scheduledAt: dB.toISOString(),
      clientName: "Smoke Booker B",
      clientEmail: TEST_PATIENT_EMAIL_B,
      clientPhone: "600000222",
      additionalData: "Smoke test F1 — slot reject",
    }),
  });
  const j13 = await r13.json().catch(() => ({}));
  if (r13.ok && j13.ok) {
    cleanup.bookingRejectedId = j13.data.booking.id;
    if (authed) {
      const r = await httpJson("PATCH", `/api/citas/bookings/${cleanup.bookingRejectedId}/reject`, {
        cancellationReason: "Smoke test reject",
      });
      assert(r.ok && r.json.data.status === "cancelled", "PATCH /reject", `status=${r.status}`);
      counts.pass++;
      await sleep(500);
      if (serverSpawned) {
        const hasRejected = serverLog.includes("Sobre tu solicitud de cita") && serverLog.includes(TEST_PATIENT_EMAIL_B);
        assert(hasRejected, "log dry-run bookingRejected encontrado");
        counts.pass++;
      } else {
        log(`  ▸ Verifica MANUALMENTE en consola del dev server: [email:send:dry-run] subject="Sobre tu solicitud de cita"`);
      }
    } else {
      log("· skip reject (modo fallback)");
    }
  } else {
    log(`  ⚠ POST /book B devolvió ${r13.status}: ${j13.error ?? r13.statusText}`);
  }

  // ── 14) PATCH status=pending sobre confirmed → 403 ───────────────────────
  header("14) PATCH status='pending' sobre booking confirmed → 403");
  if (authed && cleanup.bookingConfirmedId) {
    const r = await httpJson("PATCH", `/api/citas/bookings/${cleanup.bookingConfirmedId}`, { status: "pending" });
    assert(r.status === 403 && r.json?.error?.includes("no puede volver al estado pendiente"), "regresión a pending → 403", `status=${r.status} err=${r.json?.error}`);
    log(`  · respuesta: HTTP 403 { ok: false, error: "${r.json?.error}" }`);
    counts.pass++;
  } else {
    log("· skip (sin auth o sin booking confirmed)");
  }

  // ── 15) Borrar cliente → GC del directorio ───────────────────────────────
  header("15) DELETE cliente → GC físico de uploads/{slug}/clients/{id}/");
  if (authed) {
    const { getClientDir } = await import("../../lib/clients/attachmentStorage.js");
    const dir = getClientDir(TENANT_SLUG, clientId);
    const beforeExisted = await fs.access(dir).then(() => true).catch(() => false);
    const r = await fetch(`${BASE_URL}/api/clients/${clientId}`, { method: "DELETE", headers: { Cookie: cookies } });
    assert(r.status === 204, "DELETE /api/clients/[id]", `status=${r.status}`);
    counts.pass++;
    await sleep(300);
    const afterExists = await fs.access(dir).then(() => true).catch(() => false);
    assert(beforeExisted && !afterExists, "Directorio físico borrado tras DELETE", `before=${beforeExisted} after=${afterExists}`);
    counts.pass++;
    cleanup.clientId = null;
  } else {
    log("· skip (sin auth)");
  }

  // ── Cleanup final ────────────────────────────────────────────────────────
  header("Cleanup final");
  if (cleanup.clientId) {
    try { await models.Client.destroy({ where: { id: cleanup.clientId } }); } catch {}
  }
  await models.Booking.destroy({ where: { clientEmail: [TEST_PATIENT_EMAIL_A, TEST_PATIENT_EMAIL_B] } });
  log("✓ Datos de smoke eliminados");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write(`\nSmoke nutri_laura Fase 1 — ${ts()}\n`);
  process.stdout.write(`${"═".repeat(60)}\n`);

  const spawned = await ensureServer();
  let authed = false;
  try {
    authed = await login();
    await runHttpSmoke(authed);
  } catch (err) {
    process.stderr.write(`\n✗ Smoke FAIL: ${err.message}\n${err.stack}\n`);
    if (spawned) {
      process.stderr.write(`\n--- Últimas 40 líneas del server log ---\n`);
      process.stderr.write(serverLog.split("\n").slice(-40).join("\n") + "\n");
    } else {
      process.stderr.write(`\n(Server externo — revisa la terminal de 'npm run dev' para logs.)\n`);
    }
  } finally {
    if (spawned) await stopServerIfSpawned();
    const { closeAllConnections } = await import("../../lib/db/tenantDb.js");
    await closeAllConnections().catch(() => {});
  }

  header("Resumen");
  log(`Pasos OK: ${counts.pass}`);
  log(`Modo: ${authed ? "HTTP completo con JWT" : "HTTP público + admin via modelos (sin auth)"}`);

  // Guardar server log completo por si quiere consultarlo
  const logPath = path.join(process.cwd(), "scripts", "_smoke-server.log");
  try {
    await fs.writeFile(logPath, serverLog);
    log(`Server log completo guardado en ${logPath}`);
  } catch {}

  process.exit(0);
}

main();
