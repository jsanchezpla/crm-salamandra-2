/**
 * _smoke-nutri-laura-recetario-c4.mjs — Smoke del Sprint Recetario C4.
 *
 * C4 añade dos endpoints + dos UIs (modal de asignación y tab Plan en
 * ficha de paciente). Aquí cubrimos la PARTE de integración HTTP/BD
 * (las UIs se prueban manualmente en browser local).
 *
 * Casos:
 *   1. Pre-checks: dev server + tablas C2 + cliente test + plantilla test.
 *   2. Cleanup pre-run.
 *   3. POST /assign → asigna plantilla a cliente → 200.
 *   4. GET /api/clients/[id]/plans → devuelve el plan recién asignado con
 *      templateName + status='active' + mealCount.
 *   5. POST /reapply-template → archive viejo + crea nuevo → 200.
 *   6. GET /api/clients/[id]/plans → 2 planes (1 active + 1 archived) en
 *      orden createdAt DESC.
 *   7. POST /reapply-template sobre plantilla (type='template') → 400.
 *   8. POST /reapply-template con plantilla origen archivada → 409.
 *   9. POST /reapply-template con planId inexistente → 404.
 *  10. Regresión C2: POST /assign mismo cliente+plantilla activos → 409.
 *  11. Permisos: GET /api/clients/[id]/plans sin cookie → 401.
 *  12. Cleanup post-run.
 *
 * Auth: mismo patrón C1/C2/C3 — SMOKE_PASSWORD opcional, fallback JWT
 * firmado con JWT_SECRET.
 */

const BASE_URL = "http://localhost:3000";
const TENANT_SLUG = "nutri_laura";
const ADMIN_EMAIL = "admin@nutri-laura.es";
const ADMIN_PASSWORD = process.env.SMOKE_PASSWORD || null;

const PREFIX = "smoke-c4";

let cookies = "";

function log(...args) { process.stdout.write(`  ${args.join(" ")}\n`); }
function header(label) {
  process.stdout.write(`\n══ ${label} ${"═".repeat(Math.max(0, 60 - label.length))}\n`);
}
function pass(label) { process.stdout.write(`  ✓ ${label}\n`); }
function fail(label, detail) {
  process.stdout.write(`  ✗ ${label}${detail ? ` — ${detail}` : ""}\n`);
}

const counts = { pass: 0, fail: 0, skipped: 0 };
function assertOk(cond, label, detail) {
  if (cond) { pass(label); counts.pass++; }
  else { fail(label, detail); counts.fail++; throw new Error(`assertion failed: ${label}${detail ? ` — ${detail}` : ""}`); }
}
function softAssert(cond, label, detail) {
  if (cond) { pass(label); counts.pass++; return true; }
  fail(label, detail); counts.fail++; return false;
}

async function httpJson(method, urlPath, body, { withCookie = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (withCookie && cookies) headers.Cookie = cookies;
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method, headers, body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* no json */ }
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

const state = {
  foodId: null,
  clientId: null,
  templateId: null,
  archivedTemplateId: null,
  assignedId: null,
  reappliedId: null,
};

// ── Auth ────────────────────────────────────────────────────────────────────

async function login() {
  header("Login admin nutri_laura");
  if (ADMIN_PASSWORD) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant": TENANT_SLUG },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, tenantSlug: TENANT_SLUG }),
    });
    if (res.ok) {
      const setCookie = res.headers.getSetCookie?.() || [];
      cookies = setCookie.map((c) => c.split(";")[0]).join("; ");
      pass(`Login HTTP OK; cookie len=${cookies.length}`); counts.pass++;
      return true;
    }
    log(`  ✗ Login HTTP devolvió ${res.status} — probamos firma JWT directa`);
  } else {
    log("  · SMOKE_PASSWORD no seteada — firmamos JWT con JWT_SECRET.");
  }
  try {
    const { signAccessToken } = await import("../lib/auth/jwt.js");
    const { getMasterModels } = await import("../lib/db/masterDb.js");
    const { User } = getMasterModels();
    const admin = await User.findOne({ where: { email: ADMIN_EMAIL } });
    if (!admin) { log(`  ✗ Admin ${ADMIN_EMAIL} no existe`); counts.skipped++; return false; }
    const token = await signAccessToken({
      userId: admin.id, email: admin.email, role: admin.role,
      tenantSlug: TENANT_SLUG, tokenVersion: admin.tokenVersion,
    });
    cookies = `access_token=${token}`;
    pass(`JWT firmado directamente para ${ADMIN_EMAIL}`); counts.pass++;
    return true;
  } catch (err) {
    log(`  ✗ JWT fallback falló: ${err.message}`); counts.skipped++; return false;
  }
}

// ── 1. Pre-checks ───────────────────────────────────────────────────────────

async function step1Health() {
  header("1) Health + tablas C2 + food + cliente + plantilla seed");
  let r;
  try { r = await fetch(`${BASE_URL}/api/auth/me`); }
  catch (e) { throw new Error(`Dev server no responde (${e.message})`); }
  assertOk(r.status === 200 || r.status === 401, "GET /api/auth/me responde", `status=${r.status}`);

  const { sequelize, models } = await getModels(TENANT_SLUG);

  // Food disponible
  let food = await models.Food.findOne({ where: { archivedAt: null } });
  if (!food) {
    food = await models.Food.create({
      name: `${PREFIX}-food-seed`,
      defaultUnit: "g",
      proteinPer100: 25, carbsPer100: 0, fatPer100: 10, fiberPer100: 0,
      source: "custom",
    });
  }
  state.foodId = food.id;
  pass(`Food disponible: id=${food.id}`); counts.pass++;

  // Cliente smoke
  const client = await models.Client.create({
    name: `${PREFIX}-paciente-${Math.floor(Math.random() * 100000)}`,
    type: "individual",
    email: `smoke-c4-${Date.now()}@example.com`,
  });
  state.clientId = client.id;
  pass(`Cliente smoke creado: id=${client.id}`); counts.pass++;
}

async function step2PreCleanup() {
  header("2) Cleanup pre-run de planes con prefijo smoke-c4");
  const { sequelize } = await getModels(TENANT_SLUG);
  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.plans WHERE name LIKE :p`,
    { replacements: { p: `${PREFIX}-%` } }
  );
  pass("Cleanup pre-run completado"); counts.pass++;
}

async function step3CreateTemplate() {
  header("3) Crear plantilla con árbol mínimo + POST /assign");
  // Plantilla vacía
  const tpl = await httpJson("POST", "/api/nutricion/plans", {
    // Nutrinotas: los menus nuevos auto-siembran 5 comidas; las plantillas de
    // prueba se crean vacias para que las aserciones de conteo sigan valiendo.
    skipDefaultMeals: true,
    name: `${PREFIX}-template`,
    description: "Plantilla smoke C4",
  });
  assertOk(tpl.ok && tpl.json?.data?.id, "POST /plans plantilla", `status=${tpl.status}`);
  state.templateId = tpl.json.data.id;

  // Comida + opción default + 1 food
  const meal = await httpJson("POST", `/api/nutricion/plans/${state.templateId}/meals`, {
    name: "Desayuno",
  });
  assertOk(meal.ok, "POST /meals Desayuno");
  const mealId = meal.json.data.id;

  const opt = await httpJson("POST",
    `/api/nutricion/plans/${state.templateId}/meals/${mealId}/options`,
    { isDefault: true });
  assertOk(opt.ok, "POST /options default");
  const optId = opt.json.data.id;

  const foodLine = await httpJson("POST",
    `/api/nutricion/plans/${state.templateId}/meals/${mealId}/options/${optId}/foods`,
    { foodId: state.foodId, unit: "g", amount: 100 });
  assertOk(foodLine.ok, "POST /foods unit=g amount=100");

  // Asignar
  const assign = await httpJson("POST", `/api/nutricion/plans/${state.templateId}/assign`, {
    clientId: state.clientId,
  });
  assertOk(assign.ok && assign.json?.data?.id, "POST /assign 200", `status=${assign.status}`);
  state.assignedId = assign.json.data.id;
  softAssert(assign.json.data.type === "assigned", `type=assigned (got ${assign.json.data.type})`);
}

// ── 4. GET /api/clients/[id]/plans ──────────────────────────────────────────

async function step4ListClientPlans() {
  header("4) GET /api/clients/[id]/plans devuelve el plan asignado");
  const r = await httpJson("GET", `/api/clients/${state.clientId}/plans`);
  assertOk(r.ok && r.json?.ok, "GET /clients/[id]/plans 200", `status=${r.status}`);
  const items = r.json.items || [];
  softAssert(items.length === 1, `1 plan en la lista (got ${items.length})`);
  const p = items[0];
  softAssert(p?.id === state.assignedId, "id coincide con el plan asignado");
  softAssert(p?.status === "active", `status='active' (got ${p?.status})`);
  softAssert(p?.templateId === state.templateId, "templateId apunta a la plantilla");
  softAssert(p?.templateName === `${PREFIX}-template`, `templateName poblado (${p?.templateName})`);
  softAssert(p?.mealCount === 1, `mealCount=1 (got ${p?.mealCount})`);
  softAssert(p?.templateArchived === false, "templateArchived=false");
}

// ── 5. POST /reapply-template (happy path) ──────────────────────────────────

async function step5ReapplyTemplate() {
  header("5) POST /reapply-template → archive viejo + crea nuevo");
  const r = await httpJson("POST",
    `/api/nutricion/plans/${state.assignedId}/reapply-template`,
    {});
  assertOk(r.ok && r.json?.data?.id, "POST /reapply-template 200", `status=${r.status} body=${JSON.stringify(r.json)}`);
  const newPlan = r.json.data;
  state.reappliedId = newPlan.id;
  softAssert(newPlan.id !== state.assignedId, "Nuevo plan tiene id distinto");
  softAssert(newPlan.type === "assigned", "type=assigned");
  softAssert(newPlan.templateId === state.templateId, "templateId conservado");
  softAssert(newPlan.clientId === state.clientId, "clientId conservado");
  softAssert(Array.isArray(newPlan.meals) && newPlan.meals.length === 1,
    "Árbol meals copiado");
  softAssert((newPlan.meals?.[0]?.options?.[0]?.foods?.length ?? 0) === 1,
    "1 food line copiada al nuevo plan");

  // Verificar BD: viejo archivado, nuevo activo
  const { models } = await getModels(TENANT_SLUG);
  const oldRow = await models.Plan.findByPk(state.assignedId);
  softAssert(!!oldRow.archivedAt, "Plan viejo: archivedAt set");
  const newRow = await models.Plan.findByPk(state.reappliedId);
  softAssert(!newRow.archivedAt, "Plan nuevo: archivedAt null");
}

// ── 6. GET /api/clients/[id]/plans (2 planes) ───────────────────────────────

async function step6ListAfterReapply() {
  header("6) GET /clients/[id]/plans tras reapply: 2 planes ordenados DESC");
  const r = await httpJson("GET", `/api/clients/${state.clientId}/plans`);
  assertOk(r.ok && r.json?.ok, "GET /clients/[id]/plans 200");
  const items = r.json.items || [];
  softAssert(items.length === 2, `2 planes en la lista (got ${items.length})`);
  // createdAt DESC → el nuevo (reappliedId) primero
  softAssert(items[0]?.id === state.reappliedId, "Plan nuevo aparece primero");
  softAssert(items[0]?.status === "active", "Primer plan: active");
  softAssert(items[1]?.id === state.assignedId, "Plan viejo aparece segundo");
  softAssert(items[1]?.status === "archived", "Segundo plan: archived");
}

// ── 7. /reapply sobre plantilla → 400 ───────────────────────────────────────

async function step7ReapplyOnTemplateRejected() {
  header("7) /reapply-template sobre plantilla (type='template') → 400");
  const r = await httpJson("POST",
    `/api/nutricion/plans/${state.templateId}/reapply-template`,
    {});
  softAssert(r.status === 400, `Devuelve 400 (got ${r.status})`,
    JSON.stringify(r.json));
}

// ── 8. /reapply con plantilla origen archivada → 409 ────────────────────────

async function step8ReapplyOnArchivedTemplate() {
  header("8) /reapply-template con plantilla origen archivada → 409");

  // Crear plantilla independiente, asignar, archivar plantilla → reapply
  const tpl = await httpJson("POST", "/api/nutricion/plans", {
    // Nutrinotas: los menus nuevos auto-siembran 5 comidas; las plantillas de
    // prueba se crean vacias para que las aserciones de conteo sigan valiendo.
    skipDefaultMeals: true,
    name: `${PREFIX}-template-archived`,
  });
  assertOk(tpl.ok, "POST plantilla a archivar");
  state.archivedTemplateId = tpl.json.data.id;

  // Crear meal/option/food para que sea un árbol válido
  const meal = await httpJson("POST", `/api/nutricion/plans/${state.archivedTemplateId}/meals`, {
    name: "Desayuno",
  });
  const mealId = meal.json.data.id;
  const opt = await httpJson("POST",
    `/api/nutricion/plans/${state.archivedTemplateId}/meals/${mealId}/options`,
    { isDefault: true });
  const optId = opt.json.data.id;
  await httpJson("POST",
    `/api/nutricion/plans/${state.archivedTemplateId}/meals/${mealId}/options/${optId}/foods`,
    { foodId: state.foodId, unit: "g", amount: 50 });

  // Asignar a otro cliente para no chocar con anti-duplicado
  const { models } = await getModels(TENANT_SLUG);
  const otherClient = await models.Client.create({
    name: `${PREFIX}-paciente-other-${Math.floor(Math.random() * 100000)}`,
    type: "individual",
    email: `smoke-c4-other-${Date.now()}@example.com`,
  });
  const assign = await httpJson("POST",
    `/api/nutricion/plans/${state.archivedTemplateId}/assign`,
    { clientId: otherClient.id });
  assertOk(assign.ok, "POST /assign secundario");
  const assignedSecondaryId = assign.json.data.id;

  // Archivar plantilla
  const del = await httpJson("DELETE", `/api/nutricion/plans/${state.archivedTemplateId}`);
  softAssert(del.status === 204, `DELETE plantilla 204 (got ${del.status})`);

  // Intentar reapply
  const r = await httpJson("POST",
    `/api/nutricion/plans/${assignedSecondaryId}/reapply-template`,
    {});
  softAssert(r.status === 409, `Devuelve 409 (got ${r.status})`,
    JSON.stringify(r.json));

  // Cleanup local del cliente secundario (lo borrará el cleanup global por
  // prefix tras los planes, pero el cliente NO tiene prefijo en nombre así
  // que lo cazamos aquí explícitamente).
  await models.Client.destroy({ where: { id: otherClient.id } });
}

// ── 9. /reapply con planId inexistente → 404 ────────────────────────────────

async function step9ReapplyMissingPlan() {
  header("9) /reapply-template con planId inexistente → 404");
  const r = await httpJson("POST",
    `/api/nutricion/plans/00000000-0000-0000-0000-000000000000/reapply-template`,
    {});
  softAssert(r.status === 404, `Devuelve 404 (got ${r.status})`,
    JSON.stringify(r.json));
}

// ── 10. Regresión anti-duplicado de /assign ─────────────────────────────────

async function step10AssignDup() {
  header("10) Regresión C2: /assign mismo (template, client) activos → 409");
  const r = await httpJson("POST", `/api/nutricion/plans/${state.templateId}/assign`, {
    clientId: state.clientId,
  });
  softAssert(r.status === 409, `Devuelve 409 (got ${r.status})`,
    JSON.stringify(r.json));
}

// ── 11. Permisos: GET sin cookie → 401 ──────────────────────────────────────

async function step11AuthRequired() {
  header("11) GET /api/clients/[id]/plans sin cookie → 401");
  const r = await httpJson("GET", `/api/clients/${state.clientId}/plans`, null, { withCookie: false });
  softAssert(r.status === 401, `Devuelve 401 (got ${r.status})`,
    JSON.stringify(r.json));
}

// ── 12. Cleanup ─────────────────────────────────────────────────────────────

async function step12Cleanup() {
  header("12) Cleanup post-run");
  const { sequelize } = await getModels(TENANT_SLUG);
  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.plans WHERE name LIKE :p`,
    { replacements: { p: `${PREFIX}-%` } }
  );
  if (state.clientId) {
    await sequelize.query(
      `DELETE FROM crm_${TENANT_SLUG}.clients WHERE id = :id`,
      { replacements: { id: state.clientId } }
    );
  }
  pass("Cleanup completado"); counts.pass++;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  let authed = false;
  try {
    await step1Health();
    await step2PreCleanup();
    authed = await login();
    if (!authed) {
      log("⚠ Sin auth no podemos correr la batería HTTP."); return;
    }
    await step3CreateTemplate();
    await step4ListClientPlans();
    await step5ReapplyTemplate();
    await step6ListAfterReapply();
    await step7ReapplyOnTemplateRejected();
    await step8ReapplyOnArchivedTemplate();
    await step9ReapplyMissingPlan();
    await step10AssignDup();
    await step11AuthRequired();
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
  log(`Modo        : ${authed ? "HTTP completo" : "Sin auth"}`);

  process.exit(counts.fail > 0 ? 1 : 0);
}

main();
