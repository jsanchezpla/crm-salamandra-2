/**
 * smoke-retorika-registros.mjs — Smoke completo Sprint Retorika Registros.
 *
 * 12 pasos HTTP + verificación BD + cleanup idempotente.
 *
 * Prerrequisitos (que tú ejecutas a mano antes):
 *   1. npm run setup:retorika-local       (crea tenant + admin + curso + Trinity)
 *   2. npm run db:migrate:course-registrations
 *   3. Dev server corriendo en http://localhost:3000
 *   4. .env.local con RETORIKA_WEBHOOK_SECRET
 *
 * Uso:
 *   node --env-file=.env.local scripts/smoke-retorika-registros.mjs
 *
 * Idempotente: si lo re-ejecutas, el cleanup final limpia todo lo que creó
 * este smoke. NO toca filas previas (smoke-1, smoke-2 del Checkpoint 1 si
 * todavía existen).
 */

import crypto from "node:crypto";

const BASE_URL = "http://localhost:3000";
const TENANT_SLUG = "retorika";

const SECRET = process.env.RETORIKA_WEBHOOK_SECRET;
if (!SECRET) {
  process.stderr.write("\n✗ RETORIKA_WEBHOOK_SECRET no está en .env.local. Aborto.\n");
  process.exit(1);
}

// Emails del smoke (los 3 + 1 inexistente). Prefijo único para que el
// cleanup pueda barrer sin tocar nada más.
const EMAIL_A = "smoke-final-a@trinitycollege.es";  // paso 2 + 3
const EMAIL_B = "smoke-final-b@trinitycollege.es";  // paso 4
const EMAIL_C = "smoke-final-c@trinitycollege.es";  // paso 10 (HMAC)
const EMAIL_GHOST = "smoke-final-ghost@trinitycollege.es"; // paso 6 (no registrado)
const ALL_EMAILS = [EMAIL_A, EMAIL_B, EMAIL_C];

const WP_COURSE_ID = 5383;
const WP_PRODUCT_ID = 5487;

// ── Helpers ────────────────────────────────────────────────────────────────

const counts = { pass: 0, fail: 0 };

function header(label) {
  process.stdout.write(`\n══ ${label} ${"═".repeat(Math.max(0, 60 - label.length))}\n`);
}
function log(...args) { process.stdout.write(`  ${args.join(" ")}\n`); }
function pass(label, info) {
  counts.pass++;
  process.stdout.write(`  ✓ ${label}${info ? ` — ${info}` : ""}\n`);
}
function fail(label, detail) {
  counts.fail++;
  process.stdout.write(`  ✗ ${label}${detail ? ` — ${detail}` : ""}\n`);
}

function buildPayload(email) {
  return {
    userEmail: email,
    userWpId: 900000 + Math.floor(email.length * 31), // determinista por email
    courseWpId: WP_COURSE_ID,
    productWpId: WP_PRODUCT_ID,
    center: {
      type: "concertado",
      name: "Trinity College (Smoke Final)",
      nif: "A12345678",
      address: {
        street: "Calle Smoke 1",
        city: "Madrid",
        state: "Madrid",
        postalCode: "28001",
        country: "ES",
      },
    },
    teacher: {
      yearsOfExperience: 5,
      positions: ["docente_eso_bachillerato"],
      coursesTeaching: ["eso_1_2"],
      subjects: ["matematicas"],
      topicsOfInterest: ["liderazgo"],
    },
    diagnosis: {
      motivationCurrent: 4,
      motivationVsStart: 3,
      centerEnvironment: 4,
      stressLevel: 3,
      hasResources: 3,
      socialRecognition: 3,
      workloadFrequency: "algunas_veces",
      weeklyExtraHours: "5_10",
      mainDifficulties: "Smoke final",
      courseGoals: "Smoke final",
    },
    submittedAt: new Date("2026-06-16T20:00:00.000Z").toISOString(),
  };
}

async function postSubmit({ email, headers, body }) {
  const rawBody = JSON.stringify(body ?? buildPayload(email));
  const finalHeaders = { "Content-Type": "application/json", ...headers };
  const res = await fetch(`${BASE_URL}/api/webhooks/retorika/registro-curso`, {
    method: "POST",
    headers: finalHeaders,
    body: rawBody,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, raw: text };
}

async function getCheck({ email, signMode = "valid" }) {
  const query = new URLSearchParams({ email, productId: String(WP_PRODUCT_ID) }).toString();
  let signature;
  if (signMode === "valid") {
    signature = crypto.createHmac("sha256", SECRET).update(query).digest("hex");
  } else if (signMode === "invalid") {
    signature = "deadbeef".repeat(8);
  }
  const headers = { "x-tenant": TENANT_SLUG };
  if (signature) headers["X-Retorika-Signature"] = `sha256=${signature}`;
  const res = await fetch(`${BASE_URL}/api/webhooks/retorika/registro-curso/check?${query}`, {
    method: "GET",
    headers,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, raw: text };
}

// SQL helper via psql/docker — usamos node directo con pg para ser portable.
// Aquí cargamos master via lib/db dynamic import (mismo patrón que otros smokes).
async function sqlQuery(sql, params = []) {
  const { getMasterDb } = await import("../lib/db/masterDb.js");
  const seq = getMasterDb();
  const [rows] = await seq.query(sql, params.length ? { bind: params } : undefined);
  return rows;
}

// ── Pre-checks ─────────────────────────────────────────────────────────────

async function preChecks() {
  header("Pre-checks");

  // Dev server vivo
  try {
    const r = await fetch(`${BASE_URL}/api/auth/me`);
    if (r.status !== 401 && r.status !== 200) {
      throw new Error(`HTTP ${r.status} inesperado`);
    }
    pass("dev server respondiendo");
  } catch (err) {
    fail("dev server vivo", err.message);
    process.exit(2);
  }

  // Tabla course_registrations existe
  try {
    await sqlQuery("SELECT 1 FROM crm_retorika.course_registrations LIMIT 1");
    pass("tabla course_registrations existe en crm_retorika");
  } catch (err) {
    fail("tabla course_registrations", err.message);
    process.exit(2);
  }

  // Course Liderazgo Educativo existe
  const courses = await sqlQuery(
    "SELECT id, name FROM crm_retorika.courses WHERE wp_course_id = $1",
    [WP_COURSE_ID]
  );
  if (courses.length === 0) {
    fail(`Course wp_course_id=${WP_COURSE_ID}`, "no existe — corre setup:retorika-local primero");
    process.exit(2);
  }
  pass(`Course Liderazgo Educativo`, `id=${courses[0].id}`);

  // Cleanup previo (idempotencia): borrar lo que pudiera haber quedado de
  // ejecuciones anteriores antes de empezar.
  await cleanup(true);
  log("cleanup pre-run completado");
}

// ── Smokes 1-13 ────────────────────────────────────────────────────────────

let registrationIdA = null;
let registrationIdB = null;
let registrationIdC = null;

async function smoke2_postBrowser() {
  header("2) POST modo browser válido → 200 alreadyExists=false");
  const r = await postSubmit({
    email: EMAIL_A,
    headers: { "x-tenant": TENANT_SLUG, Origin: "https://asesoriaretorika.com" },
  });
  if (r.status === 200 && r.json?.ok === true && r.json?.alreadyExists === false && r.json?.registrationId) {
    registrationIdA = r.json.registrationId;
    pass("POST browser válido", `registrationId=${registrationIdA}`);
  } else {
    fail("POST browser válido", `status=${r.status} body=${r.raw.slice(0, 200)}`);
  }
}

async function smoke3_idempotent() {
  header("3) POST mismo email + productId → idempotente");
  const r = await postSubmit({
    email: EMAIL_A,
    headers: { "x-tenant": TENANT_SLUG, Origin: "https://asesoriaretorika.com" },
  });
  if (
    r.status === 200 &&
    r.json?.ok === true &&
    r.json?.alreadyExists === true &&
    r.json?.registrationId === registrationIdA
  ) {
    pass("idempotencia", `mismo registrationId=${registrationIdA}`);
  } else {
    fail("idempotencia", `status=${r.status} body=${r.raw.slice(0, 200)}`);
  }
}

async function smoke4_otherEmail() {
  header("4) POST email distinto → 200 alreadyExists=false, otro registrationId");
  const r = await postSubmit({
    email: EMAIL_B,
    headers: { "x-tenant": TENANT_SLUG, Origin: "https://www.asesoriaretorika.com" },
  });
  if (
    r.status === 200 &&
    r.json?.ok === true &&
    r.json?.alreadyExists === false &&
    r.json?.registrationId &&
    r.json.registrationId !== registrationIdA
  ) {
    registrationIdB = r.json.registrationId;
    pass("nuevo registro", `registrationId=${registrationIdB}`);
  } else {
    fail("nuevo registro", `status=${r.status} body=${r.raw.slice(0, 200)}`);
  }
}

async function smoke5_checkHas() {
  header("5) GET /check con HMAC válido (email registrado) → has=true");
  const r = await getCheck({ email: EMAIL_A, signMode: "valid" });
  if (r.status === 200 && r.json?.ok === true && r.json?.has === true) {
    pass("check has=true para email registrado");
  } else {
    fail("check has=true", `status=${r.status} body=${r.raw.slice(0, 200)}`);
  }
}

async function smoke6_checkHasNot() {
  header("6) GET /check email no registrado → has=false");
  const r = await getCheck({ email: EMAIL_GHOST, signMode: "valid" });
  if (r.status === 200 && r.json?.ok === true && r.json?.has === false) {
    pass("check has=false para email inexistente");
  } else {
    fail("check has=false", `status=${r.status} body=${r.raw.slice(0, 200)}`);
  }
}

async function smoke7_checkInvalidHmac() {
  header("7) GET /check con HMAC inválido → 401");
  const r = await getCheck({ email: EMAIL_A, signMode: "invalid" });
  if (r.status === 401 && r.json?.ok === false) {
    pass("check rechaza HMAC inválido", `error="${r.json.error}"`);
  } else {
    fail("check rechaza HMAC inválido", `status=${r.status} body=${r.raw.slice(0, 200)}`);
  }
}

async function smoke8_evilOrigin() {
  header("8) POST con Origin inválido (evil.com) → 401");
  const r = await postSubmit({
    email: "hacker@test.com",
    headers: { "x-tenant": TENANT_SLUG, Origin: "https://evil.com" },
  });
  if (r.status === 401 && r.json?.ok === false) {
    pass("POST rechaza Origin no permitido", `error="${r.json.error}"`);
  } else {
    fail("POST rechaza Origin no permitido", `status=${r.status} body=${r.raw.slice(0, 200)}`);
  }
}

async function smoke9_noTenantHeader() {
  header("9) POST sin header x-tenant → 401");
  const r = await postSubmit({
    email: "hacker2@test.com",
    headers: { Origin: "https://asesoriaretorika.com" }, // x-tenant ausente
  });
  if (r.status === 401 && r.json?.ok === false) {
    pass("POST rechaza sin x-tenant", `error="${r.json.error}"`);
  } else {
    fail("POST rechaza sin x-tenant", `status=${r.status} body=${r.raw.slice(0, 200)}`);
  }
}

async function smoke10_postHmac() {
  header("10) POST modo HMAC válido → 200");
  const body = buildPayload(EMAIL_C);
  const rawBody = JSON.stringify(body);
  const signature = crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
  const res = await fetch(`${BASE_URL}/api/webhooks/retorika/registro-curso`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tenant": TENANT_SLUG,
      "X-Retorika-Signature": `sha256=${signature}`,
      // SIN Origin — modo HMAC no lo necesita
    },
    body: rawBody,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (res.status === 200 && json?.ok === true && json?.alreadyExists === false && json?.registrationId) {
    registrationIdC = json.registrationId;
    pass("POST HMAC válido", `registrationId=${registrationIdC}`);
  } else {
    fail("POST HMAC válido", `status=${res.status} body=${text.slice(0, 200)}`);
  }
}

async function smoke11_postInvalidHmac() {
  header("11) POST con HMAC inválido → 401");
  const body = buildPayload("smoke-final-bad@trinitycollege.es");
  const rawBody = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}/api/webhooks/retorika/registro-curso`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Retorika-Signature": "sha256=deadbeefcafebabe1234567890abcdef",
      // Sin Origin → solo modo HMAC; con firma inválida → 401
    },
    body: rawBody,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (res.status === 401 && json?.ok === false) {
    pass("POST rechaza HMAC inválido", `error="${json.error}"`);
  } else {
    fail("POST rechaza HMAC inválido", `status=${res.status} body=${text.slice(0, 200)}`);
  }
}

async function smoke12_dbValidation() {
  header("12) Validación BD — registros + audit logs");

  // Count registros del smoke (los 3 emails, no debe haber 4ª fila por idempotencia)
  const regs = await sqlQuery(
    "SELECT id, email FROM crm_retorika.course_registrations WHERE email = ANY($1) ORDER BY email",
    [ALL_EMAILS]
  );
  if (regs.length === 3) {
    pass("course_registrations count=3 (paso 3 es duplicado, no contó)");
    const ids = regs.map((r) => r.id).sort();
    const expected = [registrationIdA, registrationIdB, registrationIdC].sort();
    if (JSON.stringify(ids) === JSON.stringify(expected)) {
      pass("ids coinciden con los devueltos por los POSTs");
    } else {
      fail("ids coinciden", `bd=${ids.join(",")} expected=${expected.join(",")}`);
    }
  } else {
    fail("count=3", `actual=${regs.length} emails=${regs.map((r) => r.email).join(",")}`);
  }

  // Audit logs
  const logs = await sqlQuery(
    `SELECT entity_id, after->>'authMode' AS auth_mode, after->>'email' AS email_masked
     FROM master.audit_logs
     WHERE action = $1 AND entity_id = ANY($2)`,
    ["training.course_registration.created", regs.map((r) => r.id)]
  );
  if (logs.length >= 3) {
    pass(`audit_logs count >= 3 (encontrados=${logs.length})`);
    const browserCount = logs.filter((l) => l.auth_mode === "browser").length;
    const hmacCount = logs.filter((l) => l.auth_mode === "hmac").length;
    if (browserCount >= 2 && hmacCount >= 1) {
      pass(`authMode distribuidos`, `browser=${browserCount} hmac=${hmacCount}`);
    } else {
      fail("authMode distribución", `browser=${browserCount} hmac=${hmacCount} (esperado browser>=2 hmac>=1)`);
    }
  } else {
    fail("audit_logs count", `actual=${logs.length}`);
  }
}

// ── Cleanup (idempotente) ──────────────────────────────────────────────────

async function cleanup(silent = false) {
  if (!silent) header("13) Cleanup");

  // 1) Borrar audit_logs por entity_id de los registros del smoke
  const regs = await sqlQuery(
    "SELECT id FROM crm_retorika.course_registrations WHERE email = ANY($1)",
    [ALL_EMAILS]
  );
  const ids = regs.map((r) => r.id);
  let auditDeleted = 0;
  if (ids.length > 0) {
    const [, res] = await (await import("../lib/db/masterDb.js")).getMasterDb().query(
      `DELETE FROM master.audit_logs WHERE action = $1 AND entity_id = ANY($2)`,
      { bind: ["training.course_registration.created", ids] }
    );
    auditDeleted = res.rowCount ?? 0;
  }

  // 2) Borrar course_registrations
  const [, regsDel] = await (await import("../lib/db/masterDb.js")).getMasterDb().query(
    "DELETE FROM crm_retorika.course_registrations WHERE email = ANY($1)",
    { bind: [ALL_EMAILS] }
  );

  // 3) Borrar training_users creados por el smoke (no tocar smoke-1 / smoke-2 del Checkpoint 1)
  const [, tuDel] = await (await import("../lib/db/masterDb.js")).getMasterDb().query(
    "DELETE FROM crm_retorika.training_users WHERE email = ANY($1)",
    { bind: [ALL_EMAILS] }
  );

  if (!silent) {
    pass(`cleanup: ${regsDel.rowCount ?? 0} registros, ${tuDel.rowCount ?? 0} training_users, ${auditDeleted} audit_logs`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write(`\nSmoke Retorika Registros · Sprint Final · ${new Date().toISOString()}\n`);
  process.stdout.write(`${"═".repeat(70)}\n`);

  try {
    await preChecks();
    await smoke2_postBrowser();
    await smoke3_idempotent();
    await smoke4_otherEmail();
    await smoke5_checkHas();
    await smoke6_checkHasNot();
    await smoke7_checkInvalidHmac();
    await smoke8_evilOrigin();
    await smoke9_noTenantHeader();
    await smoke10_postHmac();
    await smoke11_postInvalidHmac();
    await smoke12_dbValidation();
    await cleanup(false);
  } catch (err) {
    fail("smoke abortado por excepción", err.message);
    process.stderr.write(`${err.stack}\n`);
    // Aún así intentamos cleanup para no dejar basura
    try { await cleanup(true); } catch {}
  }

  header("Resumen");
  log(`PASS: ${counts.pass}`);
  log(`FAIL: ${counts.fail}`);

  const { closeAllConnections } = await import("../lib/db/tenantDb.js");
  await closeAllConnections().catch(() => {});

  process.exit(counts.fail === 0 ? 0 : 1);
}

main();
