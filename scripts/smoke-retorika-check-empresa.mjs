/**
 * smoke-retorika-check-empresa.mjs — Smoke del endpoint
 *   POST /api/webhooks/retorika/check-empresa-user
 *
 * 5 casos:
 *   1. TrainingUser empresa inactivo   → isEmpresaInactive=true   (200)
 *   2. TrainingUser empresa activo     → isEmpresaInactive=false  (200)
 *   3. TrainingUser privado            → isEmpresaInactive=false  (200)
 *   4. Email inexistente               → isEmpresaInactive=false  (200)
 *   5. Origin no autorizado            → 401
 *
 * Crea 3 TrainingUsers de prueba en crm_retorika.training_users con prefijo
 * "smoke-check-empresa-" y los borra al final (cleanup idempotente). NO
 * toca filas previas.
 *
 * Prerrequisitos (a mano):
 *   1. npm run setup:retorika-local       (tenant retorika listo en local)
 *   2. Dev server corriendo en http://localhost:3000
 *
 * Uso:
 *   node --env-file=.env.local scripts/smoke-retorika-check-empresa.mjs
 *
 * Idempotente: re-ejecutarlo limpia su propio rastro.
 */

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const TENANT_SLUG = "retorika";
const ALLOWED_ORIGIN = "https://asesoriaretorika.com";
const FORBIDDEN_ORIGIN = "https://evil.example.com";

// Prefijo único para no chocar con otros datos del tenant local.
const PREFIX = "smoke-check-empresa-";
const EMAIL_EMPRESA_INACTIVE = `${PREFIX}empresa-off@trinitycollege.es`;
const EMAIL_EMPRESA_ACTIVE   = `${PREFIX}empresa-on@trinitycollege.es`;
const EMAIL_PRIVATE          = `${PREFIX}privado@gmail.com`;
const EMAIL_GHOST            = `${PREFIX}ghost@example.com`;
const ALL_TEST_EMAILS = [EMAIL_EMPRESA_INACTIVE, EMAIL_EMPRESA_ACTIVE, EMAIL_PRIVATE];

const counts = { pass: 0, fail: 0 };

function header(label) {
  process.stdout.write(`\n══ ${label} ${"═".repeat(Math.max(0, 60 - label.length))}\n`);
}
function pass(label, info) {
  counts.pass++;
  process.stdout.write(`  ✓ ${label}${info ? ` — ${info}` : ""}\n`);
}
function fail(label, detail) {
  counts.fail++;
  process.stdout.write(`  ✗ ${label}${detail ? ` — ${detail}` : ""}\n`);
}

async function sqlQuery(sql, params = []) {
  const { getMasterDb } = await import("../lib/db/masterDb.js");
  const seq = getMasterDb();
  const [rows] = await seq.query(sql, params.length ? { bind: params } : undefined);
  return rows;
}

async function callCheck({ email, origin = ALLOWED_ORIGIN, tenant = TENANT_SLUG }) {
  const headers = {
    "Content-Type": "application/json",
    Origin: origin,
  };
  if (tenant != null) headers["x-tenant"] = tenant;
  const res = await fetch(`${BASE_URL}/api/webhooks/retorika/check-empresa-user`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, raw: text };
}

// ── Pre-checks ───────────────────────────────────────────────────────────────

async function preChecks() {
  header("Pre-checks");
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
  try {
    await sqlQuery("SELECT 1 FROM crm_retorika.training_users LIMIT 1");
    pass("tabla crm_retorika.training_users accesible");
  } catch (err) {
    fail("tabla training_users", err.message);
    process.exit(2);
  }
}

// ── Seeds ────────────────────────────────────────────────────────────────────

async function seed() {
  header("Seed: 3 TrainingUsers de prueba");
  // Limpiar por si el smoke anterior se interrumpió
  await sqlQuery(
    `DELETE FROM crm_retorika.training_users WHERE email = ANY($1)`,
    [ALL_TEST_EMAILS]
  );
  await sqlQuery(
    `INSERT INTO crm_retorika.training_users (id, email, type, active, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, 'company', false, NOW(), NOW())`,
    [EMAIL_EMPRESA_INACTIVE]
  );
  await sqlQuery(
    `INSERT INTO crm_retorika.training_users (id, email, type, active, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, 'company', true, NOW(), NOW())`,
    [EMAIL_EMPRESA_ACTIVE]
  );
  await sqlQuery(
    `INSERT INTO crm_retorika.training_users (id, email, type, active, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, 'private', true, NOW(), NOW())`,
    [EMAIL_PRIVATE]
  );
  pass(`seed OK`, `empresa-off / empresa-on / privado / ghost(no-insert)`);
}

// ── Casos ────────────────────────────────────────────────────────────────────

async function caseEmpresaInactive() {
  header("Caso 1 · empresa inactiva existente → true");
  const r = await callCheck({ email: EMAIL_EMPRESA_INACTIVE });
  if (r.status === 200 && r.json?.ok === true && r.json?.isEmpresaInactive === true) {
    pass("200 + isEmpresaInactive=true");
  } else {
    fail("respuesta inesperada", `status=${r.status} body=${r.raw}`);
  }
}

async function caseEmpresaActive() {
  header("Caso 2 · empresa activa existente → false");
  const r = await callCheck({ email: EMAIL_EMPRESA_ACTIVE });
  if (r.status === 200 && r.json?.ok === true && r.json?.isEmpresaInactive === false) {
    pass("200 + isEmpresaInactive=false");
  } else {
    fail("respuesta inesperada", `status=${r.status} body=${r.raw}`);
  }
}

async function casePrivate() {
  header("Caso 3 · privado existente → false");
  const r = await callCheck({ email: EMAIL_PRIVATE });
  if (r.status === 200 && r.json?.ok === true && r.json?.isEmpresaInactive === false) {
    pass("200 + isEmpresaInactive=false");
  } else {
    fail("respuesta inesperada", `status=${r.status} body=${r.raw}`);
  }
}

async function caseGhost() {
  header("Caso 4 · email inexistente → false");
  const r = await callCheck({ email: EMAIL_GHOST });
  if (r.status === 200 && r.json?.ok === true && r.json?.isEmpresaInactive === false) {
    pass("200 + isEmpresaInactive=false");
  } else {
    fail("respuesta inesperada", `status=${r.status} body=${r.raw}`);
  }
}

async function caseForbiddenOrigin() {
  header("Caso 5 · Origin no autorizado → 401");
  const r = await callCheck({ email: EMAIL_EMPRESA_INACTIVE, origin: FORBIDDEN_ORIGIN });
  if (r.status === 401) {
    pass("401 Origen no autorizado");
  } else {
    fail("debería 401", `status=${r.status} body=${r.raw}`);
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

async function cleanup() {
  header("Cleanup");
  const result = await sqlQuery(
    `DELETE FROM crm_retorika.training_users WHERE email = ANY($1)`,
    [ALL_TEST_EMAILS]
  );
  pass(`borrados`, `users con prefijo ${PREFIX}* eliminados`);
  void result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await preChecks();
    await seed();
    await caseEmpresaInactive();
    await caseEmpresaActive();
    await casePrivate();
    await caseGhost();
    await caseForbiddenOrigin();
  } catch (err) {
    fail("error inesperado", err?.stack || err?.message || String(err));
  } finally {
    try { await cleanup(); } catch (err) {
      fail("cleanup falló", err?.message || String(err));
    }
  }

  header("Resumen");
  process.stdout.write(`  ${counts.pass} PASS / ${counts.fail} FAIL\n\n`);
  process.exit(counts.fail === 0 ? 0 : 1);
})();
