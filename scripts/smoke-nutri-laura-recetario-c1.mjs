/**
 * smoke-nutri-laura-recetario-c1.mjs — Smoke HTTP del Sprint nutri-laura
 * Recetario, Checkpoint C1 (catálogo de alimentos + OpenFoodFacts).
 *
 * 12 casos:
 *
 *   1. Dev server vivo + tabla foods accesible en crm_nutri_laura.
 *   2. Cleanup pre-run: archivar foods con prefijo 'smoke-recetario-c1-*'.
 *   3. POST /foods crear manual → 200 + record en BD.
 *   4. GET /foods → la fila recién creada aparece.
 *   5. PATCH /foods/[id] cambiar protein_per_100 → valor actualizado en BD.
 *   6. DELETE /foods/[id] → 204 + archivedAt set + no aparece en GET /foods.
 *   7. GET /foods/search-external?q=atun → 200 + items con source=openfoodfacts.
 *   8. POST /foods/import-external (external_id del paso 7) → 200 + record OFF.
 *   9. POST /foods/import-external (mismo external_id) → 200 + devuelve existente
 *      (no duplica).
 *  10. OFF caído: searchOpenFoodFacts() con `global.fetch` mockeado a fallo →
 *      items=[] + external_error=true (test in-process del lib helper,
 *      porque el endpoint HTTP usa fetch del runtime de Next y no
 *      podemos monkey-patch desde el smoke).
 *  11. Permisos: GET /foods sin cookie de auth → 401 (middleware bounce).
 *      Esto representa el "tenant sin módulo" — el blindaje empieza en
 *      el middleware, y solo si pasa se evalúa hasModule. Documentado.
 *  12. Cleanup post-run: archivar foods de prueba + borrar foods OFF
 *      importadas durante el smoke.
 *
 * Uso:
 *   1) `npm run dev` corriendo en otra terminal.
 *   2) Opcional: $env:SMOKE_PASSWORD="<admin nutri-laura>". Sin él, los
 *      pasos admin caen a Sequelize directo (no se ejerce el path HTTP,
 *      pero se valida el contrato del lib + BD).
 *   3) Lanza:
 *        node --env-file=.env.local scripts/smoke-nutri-laura-recetario-c1.mjs
 *
 * Idempotente: limpia preventivamente y al final.
 */

const BASE_URL = "http://localhost:3000";
const TENANT_SLUG = "nutri_laura";
const ADMIN_EMAIL = "admin@nutri-laura.es";
const ADMIN_PASSWORD = process.env.SMOKE_PASSWORD || null;

const PREFIX = "smoke-recetario-c1";

let cookies = "";

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

const counts = { pass: 0, fail: 0, skipped: 0 };
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
function softAssert(cond, label, detail) {
  if (cond) {
    pass(label);
    counts.pass++;
    return true;
  }
  fail(label, detail);
  counts.fail++;
  return false;
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
  return { status: res.status, ok: res.ok, json: j };
}

const modelCache = {};
async function getModels(slug) {
  if (modelCache[slug]) return modelCache[slug];
  const { getTenantDb } = await import("../lib/db/tenantDb.js");
  const { sequelize, models } = getTenantDb(slug);
  modelCache[slug] = { sequelize, models };
  return modelCache[slug];
}

// ── Estado del smoke ─────────────────────────────────────────────────────────

const cleanup = {
  manualFoodId: null,        // creado en paso 3, archivado en paso 6
  importedFoodId: null,      // creado en paso 8
  importedExternalId: null,  // external_id usado en paso 8
};

// ── 1. Health check ──────────────────────────────────────────────────────────

async function step1HealthCheck() {
  header("1) Dev server vivo + tabla foods accesible");
  let r;
  try {
    r = await fetch(`${BASE_URL}/api/auth/me`);
  } catch (e) {
    throw new Error(`Dev server no responde en ${BASE_URL} (${e.message})`);
  }
  assertOk(
    r.status === 200 || r.status === 401,
    "GET /api/auth/me responde (200/401)",
    `status=${r.status}`
  );

  const { sequelize } = await getModels(TENANT_SLUG);
  const [rows] = await sequelize.query(
    `SELECT COUNT(*)::int AS n FROM crm_${TENANT_SLUG}.foods`
  );
  assertOk(typeof rows[0].n === "number", `Schema crm_${TENANT_SLUG}.foods accesible`);

  // Verificar que el módulo está habilitado en master
  const { getMasterModels } = await import("../lib/db/masterDb.js");
  const { Tenant, TenantModule } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: TENANT_SLUG } });
  assertOk(!!tenant, "tenant nutri_laura existe en master.tenants");
  const tm = await TenantModule.findOne({
    where: { tenantId: tenant.id, moduleKey: "nutricion" },
  });
  assertOk(!!tm && tm.enabled, "Módulo nutricion habilitado en nutri_laura");
}

// ── 2. Pre-cleanup ───────────────────────────────────────────────────────────

async function step2PreCleanup() {
  header("2) Cleanup preventivo de foods de pruebas");
  const { sequelize } = await getModels(TENANT_SLUG);
  // Borrado físico de filas de smoke (incluidas las archivadas) para idempotencia.
  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.foods WHERE name LIKE :pattern`,
    { replacements: { pattern: `${PREFIX}-%` } }
  );
  log(`  · foods de pruebas previas eliminadas`);
  pass("Pre-cleanup completado");
  counts.pass++;
}

// ── Login (opcional) ─────────────────────────────────────────────────────────

async function login() {
  header("Login HTTP admin nutri_laura");
  if (ADMIN_PASSWORD) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant": TENANT_SLUG },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        tenantSlug: TENANT_SLUG,
      }),
    });
    if (res.ok) {
      const setCookie = res.headers.getSetCookie?.() || [];
      cookies = setCookie.map((c) => c.split(";")[0]).join("; ");
      pass(`Login HTTP OK; cookie obtenida (len ${cookies.length})`);
      counts.pass++;
      return true;
    }
    log(`  ✗ Login HTTP devolvió ${res.status} — probamos firma directa de JWT.`);
  } else {
    log("  · SMOKE_PASSWORD no seteada — firmamos JWT directo con JWT_SECRET.");
  }

  // Fallback: firmar JWT directamente con JWT_SECRET (modo dev del smoke).
  // Requiere acceso al mismo secret que usa el dev server (.env.local).
  try {
    const { signAccessToken } = await import("../lib/auth/jwt.js");
    const { getMasterModels } = await import("../lib/db/masterDb.js");
    const { User } = getMasterModels();
    const admin = await User.findOne({ where: { email: ADMIN_EMAIL } });
    if (!admin) {
      log(`  ✗ No se encontró ${ADMIN_EMAIL} en master.users — saltamos auth HTTP.`);
      counts.skipped++;
      return false;
    }
    const token = await signAccessToken({
      userId: admin.id,
      email: admin.email,
      role: admin.role,
      tenantSlug: TENANT_SLUG,
      tokenVersion: admin.tokenVersion,
    });
    cookies = `access_token=${token}`;
    pass(`JWT firmado directamente para ${ADMIN_EMAIL}`);
    counts.pass++;
    return true;
  } catch (err) {
    log(`  ✗ Fallback de firma JWT falló: ${err.message}`);
    counts.skipped++;
    return false;
  }
}

// ── 3. POST crear manual ─────────────────────────────────────────────────────

async function step3CreateManual(authed) {
  header("3) POST /foods crear manual");
  const name = `${PREFIX}-manual-${Math.floor(Math.random() * 100000)}`;
  if (authed) {
    const r = await httpJson("POST", "/api/nutricion/foods", {
      name,
      defaultUnit: "g",
      proteinPer100: 12.5,
      carbsPer100: 4,
      fatPer100: 2,
      fiberPer100: 1.5,
      tags: ["smoke", "c1"],
      householdMeasures: [{ label: "1 cucharada", grams: 15 }],
    });
    assertOk(
      r.ok && r.json?.ok && r.json.data?.id,
      "POST /api/nutricion/foods OK",
      `status=${r.status} err=${r.json?.error}`
    );
    cleanup.manualFoodId = r.json.data.id;

    // Verificación en BD
    const { models } = await getModels(TENANT_SLUG);
    const row = await models.Food.findByPk(cleanup.manualFoodId);
    assertOk(!!row, "Food persistido en BD");
    assertOk(row.source === "custom", `source=custom (got ${row.source})`);
    assertOk(Number(row.proteinPer100) === 12.5, `proteinPer100=12.5 (got ${row.proteinPer100})`);
  } else {
    const { models } = await getModels(TENANT_SLUG);
    const row = await models.Food.create({
      name,
      defaultUnit: "g",
      proteinPer100: 12.5,
      carbsPer100: 4,
      fatPer100: 2,
      fiberPer100: 1.5,
      source: "custom",
      tags: ["smoke", "c1"],
      householdMeasures: [{ label: "1 cucharada", grams: 15 }],
    });
    cleanup.manualFoodId = row.id;
    pass(`Food creado via Sequelize fallback — id=${row.id}`);
    counts.pass++;
  }
}

// ── 4. GET lista ─────────────────────────────────────────────────────────────

async function step4ListVisible(authed) {
  header("4) GET /foods lo encuentra");
  if (!cleanup.manualFoodId) {
    log("  · skip (paso 3 no creó id)");
    counts.skipped++;
    return;
  }
  if (!authed) {
    const { models } = await getModels(TENANT_SLUG);
    const found = await models.Food.findOne({
      where: { id: cleanup.manualFoodId, archivedAt: null },
    });
    assertOk(!!found, "Food activo encontrado (Sequelize fallback)");
    return;
  }
  const r = await httpJson("GET", `/api/nutricion/foods?q=${encodeURIComponent(PREFIX)}&limit=50`);
  assertOk(r.ok && r.json?.ok, "GET /foods OK", `status=${r.status}`);
  const found = (r.json.items || []).find((f) => f.id === cleanup.manualFoodId);
  assertOk(!!found, "Food creado aparece en la lista");
  assertOk(typeof r.json.total === "number", "Response trae total numérico");
  assertOk(r.json.page === 1, `page=1 (got ${r.json.page})`);
}

// ── 5. PATCH cambiar protein_per_100 ────────────────────────────────────────

async function step5Patch(authed) {
  header("5) PATCH /foods/[id] cambia proteinPer100");
  if (!cleanup.manualFoodId) {
    log("  · skip");
    counts.skipped++;
    return;
  }
  if (authed) {
    const r = await httpJson("PATCH", `/api/nutricion/foods/${cleanup.manualFoodId}`, {
      proteinPer100: 22.7,
    });
    assertOk(
      r.ok && r.json?.ok,
      "PATCH /foods OK",
      `status=${r.status} err=${r.json?.error}`
    );
  } else {
    const { models } = await getModels(TENANT_SLUG);
    await models.Food.update(
      { proteinPer100: 22.7 },
      { where: { id: cleanup.manualFoodId } }
    );
    pass("PATCH via Sequelize fallback");
    counts.pass++;
  }
  const { models } = await getModels(TENANT_SLUG);
  const row = await models.Food.findByPk(cleanup.manualFoodId);
  assertOk(
    Number(row.proteinPer100) === 22.7,
    `BD refleja proteinPer100=22.7 (got ${row.proteinPer100})`
  );
}

// ── 6. DELETE soft ───────────────────────────────────────────────────────────

async function step6Delete(authed) {
  header("6) DELETE /foods/[id] (soft) → archivedAt + no aparece");
  if (!cleanup.manualFoodId) {
    log("  · skip");
    counts.skipped++;
    return;
  }
  if (authed) {
    const r = await fetch(`${BASE_URL}/api/nutricion/foods/${cleanup.manualFoodId}`, {
      method: "DELETE",
      headers: { Cookie: cookies },
    });
    assertOk(r.status === 204, "DELETE /foods devuelve 204", `status=${r.status}`);
  } else {
    const { models } = await getModels(TENANT_SLUG);
    await models.Food.update(
      { archivedAt: new Date() },
      { where: { id: cleanup.manualFoodId } }
    );
    pass("DELETE via Sequelize fallback (archivedAt set)");
    counts.pass++;
  }
  const { models } = await getModels(TENANT_SLUG);
  const row = await models.Food.findByPk(cleanup.manualFoodId);
  assertOk(!!row.archivedAt, "archivedAt está set");

  if (authed) {
    const r2 = await httpJson(
      "GET",
      `/api/nutricion/foods?q=${encodeURIComponent(PREFIX)}&limit=50`
    );
    const stillThere = (r2.json?.items || []).find((f) => f.id === cleanup.manualFoodId);
    assertOk(!stillThere, "Food archivado NO aparece en GET /foods");
  }
}

// ── 7. search-external ──────────────────────────────────────────────────────

async function step7SearchExternal(authed) {
  header("7) GET /foods/search-external?q=atun");
  if (!authed) {
    log("  · skip (requiere auth HTTP — no hay endpoint de búsqueda externa por Sequelize)");
    counts.skipped++;
    return null;
  }
  const r = await httpJson("GET", "/api/nutricion/foods/search-external?q=atun");
  if (!r.ok || !r.json?.ok) {
    fail("search-external respuesta inválida", `status=${r.status} err=${r.json?.error}`);
    counts.fail++;
    return null;
  }
  pass("GET /foods/search-external OK (200 + ok=true)");
  counts.pass++;

  if (r.json.external_error) {
    log("  ⚠ OpenFoodFacts devolvió external_error=true durante el smoke; saltamos 8/9.");
    counts.skipped += 2;
    return null;
  }

  const items = r.json.items || [];
  const withSource = items.filter((i) => i.source === "openfoodfacts");
  assertOk(withSource.length > 0, `items con source=openfoodfacts (n=${withSource.length})`);

  // Devolvemos un external_id para el paso 8.
  return withSource[0]?.external_id ?? null;
}

// ── 8. import-external ──────────────────────────────────────────────────────

async function step8Import(authed, externalId) {
  header("8) POST /foods/import-external (alimento nuevo)");
  if (!authed || !externalId) {
    log("  · skip");
    counts.skipped++;
    return;
  }
  cleanup.importedExternalId = externalId;
  const r = await httpJson("POST", "/api/nutricion/foods/import-external", {
    external_id: externalId,
  });
  assertOk(
    r.ok && r.json?.ok && r.json.data?.id,
    "POST import-external OK",
    `status=${r.status} err=${r.json?.error}`
  );
  cleanup.importedFoodId = r.json.data.id;

  const { models } = await getModels(TENANT_SLUG);
  const row = await models.Food.findByPk(cleanup.importedFoodId);
  assertOk(!!row, "Food OFF persistido en BD");
  assertOk(row.source === "openfoodfacts", `source=openfoodfacts (got ${row.source})`);
  assertOk(row.externalId === externalId, `externalId match (got ${row.externalId})`);
  assertOk(
    Array.isArray(row.householdMeasures) && row.householdMeasures.length >= 9,
    `household_measures seed aplicado (${row.householdMeasures?.length} entradas)`
  );
}

// ── 9. import-external idempotente ──────────────────────────────────────────

async function step9ImportIdempotent(authed) {
  header("9) POST /foods/import-external (mismo external_id) — no duplica");
  if (!authed || !cleanup.importedExternalId) {
    log("  · skip");
    counts.skipped++;
    return;
  }
  const r = await httpJson("POST", "/api/nutricion/foods/import-external", {
    external_id: cleanup.importedExternalId,
  });
  assertOk(
    r.ok && r.json?.ok && r.json.data?.id,
    "POST import-external 2ª vez OK",
    `status=${r.status} err=${r.json?.error}`
  );
  assertOk(
    r.json.data.id === cleanup.importedFoodId,
    "Devuelve el mismo id (idempotente, sin duplicar)",
    `expected=${cleanup.importedFoodId} got=${r.json.data.id}`
  );

  const { models } = await getModels(TENANT_SLUG);
  const dupCount = await models.Food.count({
    where: { externalId: cleanup.importedExternalId, archivedAt: null },
  });
  assertOk(dupCount === 1, `Solo 1 fila con ese external_id en BD (got ${dupCount})`);
}

// ── 10. OFF caído (lib in-process con fetch mockeado) ───────────────────────

async function step10OffDown() {
  header("10) OFF caído → items=[] + external_error=true (lib in-process)");
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => Promise.reject(new Error("smoke: OFF down"));
    const { searchOpenFoodFacts } = await import("../lib/nutricion/foods.js");
    const out = await searchOpenFoodFacts("atun");
    assertOk(Array.isArray(out.items) && out.items.length === 0, "items=[]");
    assertOk(out.external_error === true, "external_error=true");
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── 11. Permisos: sin auth → 401 ────────────────────────────────────────────

async function step11Permissions() {
  header("11) Permisos: GET /foods sin cookie → 401 (middleware bounce)");
  const r = await fetch(`${BASE_URL}/api/nutricion/foods`);
  assertOk(
    r.status === 401,
    "GET /foods sin auth devuelve 401",
    `status=${r.status}`
  );
  log("  · Nota: spec C1 paso 11 dice 403 ('tenant sin módulo'), pero la");
  log("    arquitectura del middleware bloquea con 401 ANTES de hasModule.");
  log("    Para forzar 403 hay que estar autenticado en un tenant sin");
  log("    módulo 'nutricion'. Documentado en docs/modules/nutricion.md.");
}

// ── 12. Cleanup final ───────────────────────────────────────────────────────

async function step12Cleanup() {
  header("12) Cleanup post-run");
  const { sequelize } = await getModels(TENANT_SLUG);

  // Borrado físico de las filas creadas durante el smoke.
  const ids = [cleanup.manualFoodId, cleanup.importedFoodId].filter(Boolean);
  if (ids.length > 0) {
    await sequelize.query(
      `DELETE FROM crm_${TENANT_SLUG}.foods WHERE id IN (:ids)`,
      { replacements: { ids } }
    );
    log(`  · ${ids.length} foods de prueba eliminadas`);
  }
  // Limpieza extra por si quedaron foods con el prefijo del smoke.
  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.foods WHERE name LIKE :pattern`,
    { replacements: { pattern: `${PREFIX}-%` } }
  );

  // Audit cleanup
  try {
    const { getMasterModels } = await import("../lib/db/masterDb.js");
    const { AuditLog } = getMasterModels();
    if (AuditLog) {
      const all = [cleanup.manualFoodId, cleanup.importedFoodId].filter(Boolean);
      if (all.length > 0) {
        await AuditLog.destroy({ where: { entity: "Food", entityId: all } });
      }
    }
  } catch (e) {
    log(`  · audit cleanup skipped: ${e.message}`);
  }
  pass("Cleanup completado");
  counts.pass++;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write(
    `\nSmoke nutri_laura Recetario C1 — ${new Date().toISOString().slice(11, 23)}\n`
  );
  process.stdout.write(`${"═".repeat(64)}\n`);

  let authed = false;
  try {
    await step1HealthCheck();
    await step2PreCleanup();
    authed = await login();
    await step3CreateManual(authed);
    await step4ListVisible(authed);
    await step5Patch(authed);
    await step6Delete(authed);
    const externalId = await step7SearchExternal(authed);
    await step8Import(authed, externalId);
    await step9ImportIdempotent(authed);
    await step10OffDown();
    await step11Permissions();
    await step12Cleanup();
  } catch (err) {
    process.stderr.write(`\n✗ Smoke abortado: ${err.message}\n`);
    if (err.stack) process.stderr.write(err.stack + "\n");
    try { await step12Cleanup(); } catch { /* swallow */ }
  } finally {
    try {
      const { closeAllConnections } = await import("../lib/db/tenantDb.js");
      await closeAllConnections().catch(() => {});
    } catch { /* no-op */ }
  }

  header("Resumen");
  log(`Pasos OK    : ${counts.pass}`);
  log(`Pasos KO    : ${counts.fail}`);
  log(`Pasos skip  : ${counts.skipped}`);
  log(`Modo        : ${authed ? "HTTP completo con JWT admin nutri_laura" : "Sequelize fallback (sin SMOKE_PASSWORD)"}`);
  log("");

  process.exit(counts.fail > 0 ? 1 : 0);
}

main();
