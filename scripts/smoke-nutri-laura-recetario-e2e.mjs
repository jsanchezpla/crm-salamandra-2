/**
 * smoke-nutri-laura-recetario-e2e.mjs — Smoke END-TO-END del sprint Recetario.
 *
 * Cierre C5: ejercita el flujo completo de Laura en un único script
 * (catálogo → plantilla → asignación → edición → reapply → histórico),
 * leyendo cada paso anterior para componer el siguiente. Sin mockear,
 * todo HTTP+BD real contra crm_nutri_laura.
 *
 * Pasos (con asserts):
 *   1. Pre-cleanup + auth.
 *   2. Crear food custom (Avena) + verificar que el import OFF ya no existe (404).
 *   3. Crear plantilla "smoke-e2e-Plan" + 2 comidas + 3 opciones + 5 foods
 *      cubriendo los 3 modos (g, household, free).
 *   4. GET árbol y validar macros del plan completo con computePlanMacros.
 *   5. Asignar plantilla a paciente smoke → deep-copy verificado.
 *   6. Editar plan asignado: cambiar amount + cambiar unit g→household.
 *   7. Re-aplicar plantilla origen → archive viejo + crea nuevo.
 *   8. GET /api/clients/[id]/plans → 1 activo + 1 archivado.
 *   9. PATCH metadata plantilla con asignaciones → hadAssignments>=1.
 *  10. Cleanup completo (plans + clients + foods con prefijo smoke-e2e).
 *
 * Auth: igual que el resto de smokes. SMOKE_PASSWORD opcional, fallback
 * a firma JWT directa con JWT_SECRET.
 */

const BASE_URL = "http://localhost:3000";
const TENANT_SLUG = "nutri_laura";
const ADMIN_EMAIL = "admin@nutri-laura.es";
const ADMIN_PASSWORD = process.env.SMOKE_PASSWORD || null;
const PREFIX = "smoke-e2e";

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
  customFoodId: null,        // food creado manualmente
  offFoodId: null,           // siempre null desde Nutrinotas (OFF retirado); f5 usa customFoodId
  clientId: null,
  templateId: null,
  mealIds: [],
  optionIds: [],
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

// ── 1. Pre-cleanup + cliente smoke ──────────────────────────────────────────

async function step1Bootstrap() {
  header("1) Pre-cleanup + cliente smoke");
  const { sequelize, models } = await getModels(TENANT_SLUG);
  // Cleanup robusto por prefijo
  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.plans WHERE name LIKE :p`,
    { replacements: { p: `${PREFIX}-%` } }
  );
  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.foods WHERE name LIKE :p`,
    { replacements: { p: `${PREFIX}-%` } }
  );
  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.clients WHERE email LIKE :p`,
    { replacements: { p: `${PREFIX}-%@example.com` } }
  );
  pass("Cleanup pre-run completado"); counts.pass++;

  // Cliente smoke
  const client = await models.Client.create({
    name: `${PREFIX}-paciente-${Math.floor(Math.random() * 100000)}`,
    type: "individual",
    email: `${PREFIX}-${Date.now()}@example.com`,
  });
  state.clientId = client.id;
  pass(`Cliente smoke creado: ${client.name}`); counts.pass++;
}

// ── 2. Catálogo: food custom + import OFF ───────────────────────────────────

async function step2Catalog() {
  header("2) Catálogo — custom food + OFF retirado (404)");

  // Custom food (Avena por 100g)
  const r1 = await httpJson("POST", "/api/nutricion/foods", {
    name: `${PREFIX}-Avena Integral`,
    defaultUnit: "g",
    proteinPer100: 13.2,
    carbsPer100: 60,
    fatPer100: 6.5,
    fiberPer100: 10.5,
    householdMeasures: [
      { label: "1 cucharada", grams: 15 },
      { label: "1 puñado", grams: 30 },
    ],
  });
  assertOk(r1.ok && r1.json?.data?.id, "POST custom food OK", `status=${r1.status}`);
  state.customFoodId = r1.json.data.id;

  // OpenFoodFacts RETIRADO (Nutrinotas 2026-07-18): el import externo ya no
  // existe. Verificamos que el endpoint responde 404 (ruta eliminada).
  const r2 = await httpJson("POST", "/api/nutricion/foods/import-external", {
    external_id: "5449000000996",
  });
  assertOk(r2.status === 404, `import-external eliminado (status=${r2.status})`);
}

// ── 3. Crear plantilla + estructura ─────────────────────────────────────────

async function step3CreateTemplate() {
  header("3) Crear plantilla + 2 comidas + 3 opciones + 5 foods");

  const tpl = await httpJson("POST", "/api/nutricion/plans", {
    // Nutrinotas: los menus nuevos auto-siembran 5 comidas; las plantillas de
    // prueba se crean vacias para que las aserciones de conteo sigan valiendo.
    skipDefaultMeals: true,
    name: `${PREFIX}-Plan`,
    description: "Smoke E2E Recetario",
  });
  assertOk(tpl.ok && tpl.json?.data?.id, "POST plantilla");
  state.templateId = tpl.json.data.id;

  // Comida 1: Desayuno
  const m1 = await httpJson("POST", `/api/nutricion/plans/${state.templateId}/meals`, {
    name: "Desayuno", description: "DESAYUNO + BEBIDA",
  });
  assertOk(m1.ok, "POST meal Desayuno");
  state.mealIds.push(m1.json.data.id);

  // Comida 2: Comida
  const m2 = await httpJson("POST", `/api/nutricion/plans/${state.templateId}/meals`, {
    name: "Comida", description: "PLATO PRINCIPAL",
  });
  assertOk(m2.ok, "POST meal Comida");
  state.mealIds.push(m2.json.data.id);

  // Opciones — 2 en Desayuno (1 default), 1 en Comida (default)
  const o1 = await httpJson("POST",
    `/api/nutricion/plans/${state.templateId}/meals/${state.mealIds[0]}/options`,
    { isDefault: true });
  assertOk(o1.ok, "POST opción Desayuno #1 (default)");
  state.optionIds.push(o1.json.data.id);

  const o2 = await httpJson("POST",
    `/api/nutricion/plans/${state.templateId}/meals/${state.mealIds[0]}/options`,
    { name: "Opción 2" });
  assertOk(o2.ok, "POST opción Desayuno #2");
  state.optionIds.push(o2.json.data.id);

  const o3 = await httpJson("POST",
    `/api/nutricion/plans/${state.templateId}/meals/${state.mealIds[1]}/options`,
    { isDefault: true });
  assertOk(o3.ok, "POST opción Comida (default)");
  state.optionIds.push(o3.json.data.id);

  // Foods: ejercitar los 3 modos cantidad (g, household, free).
  // Opción Desayuno #1: 2 foods (g + household).
  const f1 = await httpJson("POST",
    `/api/nutricion/plans/${state.templateId}/meals/${state.mealIds[0]}/options/${state.optionIds[0]}/foods`,
    { foodId: state.customFoodId, unit: "g", amount: 80 });
  assertOk(f1.ok, "POST food unit=g amount=80");

  const f2 = await httpJson("POST",
    `/api/nutricion/plans/${state.templateId}/meals/${state.mealIds[0]}/options/${state.optionIds[0]}/foods`,
    {
      foodId: state.customFoodId,
      unit: "household",
      amount: 1,
      householdLabel: "1 cucharada",
      householdGrams: 15,
    });
  assertOk(f2.ok, "POST food unit=household 1×15g");

  // Opción Desayuno #2: 1 food (free).
  const f3 = await httpJson("POST",
    `/api/nutricion/plans/${state.templateId}/meals/${state.mealIds[0]}/options/${state.optionIds[1]}/foods`,
    { foodId: state.customFoodId, unit: "free", notes: "Lo que apetezca" });
  assertOk(f3.ok, "POST food unit=free notes='Lo que apetezca'");

  // Opción Comida: 2 foods (g + g).
  const f4 = await httpJson("POST",
    `/api/nutricion/plans/${state.templateId}/meals/${state.mealIds[1]}/options/${state.optionIds[2]}/foods`,
    { foodId: state.customFoodId, unit: "g", amount: 150 });
  assertOk(f4.ok, "POST food unit=g amount=150 (Comida)");

  const f5Source = state.offFoodId || state.customFoodId;
  const f5 = await httpJson("POST",
    `/api/nutricion/plans/${state.templateId}/meals/${state.mealIds[1]}/options/${state.optionIds[2]}/foods`,
    { foodId: f5Source, unit: "g", amount: 200 });
  assertOk(f5.ok, "POST food unit=g amount=200 (Comida)");
}

// ── 4. Validar macros calculados ────────────────────────────────────────────

async function step4VerifyMacros() {
  header("4) GET árbol completo + computePlanMacros");
  const tree = await httpJson("GET", `/api/nutricion/plans/${state.templateId}`);
  assertOk(tree.ok && tree.json?.ok, "GET árbol OK");
  const plan = tree.json.data;
  softAssert((plan.meals || []).length === 2, `meals=2 (got ${plan.meals?.length})`);

  // Macros: Avena por 100g → 13.2p/60c/6.5f/10.5fb.
  // Default Desayuno (opción #1): 80g + 15g = 95g de Avena → 95×0.132=12.54p, etc.
  // Default Comida (única): 150g + 200g = 350g de Avena (caso peor: la 5ª
  // food podría ser OFF con macros propios; toleramos diferencia).
  const { computePlanMacros, computeOptionMacros } = await import("../lib/nutricion/macros.js");
  const macros = computePlanMacros(plan);

  softAssert(typeof macros.protein === "number" && macros.protein > 0,
    `planMacros.protein > 0 (got ${macros.protein})`);
  softAssert(typeof macros.carbs === "number" && macros.carbs > 0,
    `planMacros.carbs > 0 (got ${macros.carbs})`);
  softAssert(typeof macros.fat === "number" && macros.fat > 0,
    `planMacros.fat > 0 (got ${macros.fat})`);
  softAssert(typeof macros.fiber === "number" && macros.fiber > 0,
    `planMacros.fiber > 0 (got ${macros.fiber})`);

  // Verificación específica de la opción Desayuno #1 que SÍ usa solo Avena:
  // 80g + (1×15g) = 95g de Avena → 95×13.2/100 = 12.54p.
  const desayunoOpt = plan.meals
    .find((m) => m.name === "Desayuno")
    .options.find((o) => o.id === state.optionIds[0]);
  const desayunoMacros = computeOptionMacros(desayunoOpt);
  const expectedProtein = Math.round(95 * 13.2) / 100; // 12.54
  softAssert(Math.abs(desayunoMacros.protein - expectedProtein) < 0.05,
    `Opción Desayuno protein=${expectedProtein} (got ${desayunoMacros.protein})`);
}

// ── 5. Asignar plantilla a paciente ─────────────────────────────────────────

async function step5Assign() {
  header("5) POST /assign → deep-copy del árbol");
  const r = await httpJson("POST", `/api/nutricion/plans/${state.templateId}/assign`, {
    clientId: state.clientId,
  });
  assertOk(r.ok && r.json?.data?.id, "POST /assign 200");
  state.assignedId = r.json.data.id;
  const assigned = r.json.data;
  softAssert(assigned.type === "assigned", "type=assigned");
  softAssert(assigned.templateId === state.templateId, "templateId conservado");
  softAssert(Array.isArray(assigned.meals) && assigned.meals.length === 2,
    "Árbol copiado (2 meals)");
  const totalFoods = (assigned.meals || []).reduce(
    (acc, m) => acc + (m.options || []).reduce((a2, o) => a2 + (o.foods || []).length, 0),
    0
  );
  softAssert(totalFoods === 5, `5 food lines copiadas (got ${totalFoods})`);
}

// ── 6. Editar plan asignado ─────────────────────────────────────────────────

async function step6EditAssigned() {
  header("6) Editar plan asignado — amount + unit g→household");
  // Cargar árbol del asignado y editar una food de Desayuno #1.
  const tree = await httpJson("GET", `/api/nutricion/plans/${state.assignedId}`);
  assertOk(tree.ok, "GET árbol asignado");
  const desayuno = tree.json.data.meals.find((m) => m.name === "Desayuno");
  const opt1 = desayuno.options.find((o) => o.isDefault);
  const foodG = opt1.foods.find((f) => Number(f.amount) === 80 && f.unit === "g");
  assertOk(!!foodG, "Encontrada food unit=g amount=80 en asignado");

  // Cambiar amount a 100
  const patch1 = await httpJson("PATCH",
    `/api/nutricion/plans/${state.assignedId}/meals/${desayuno.id}/options/${opt1.id}/foods/${foodG.id}`,
    { amount: 100 });
  assertOk(patch1.ok, "PATCH amount=100 OK");

  // Cambiar unit a household
  const patch2 = await httpJson("PATCH",
    `/api/nutricion/plans/${state.assignedId}/meals/${desayuno.id}/options/${opt1.id}/foods/${foodG.id}`,
    {
      unit: "household",
      amount: 2,
      householdLabel: "1 cucharada",
      householdGrams: 15,
    });
  assertOk(patch2.ok, "PATCH unit=g→household OK");

  // Confirmar en BD
  const { models } = await getModels(TENANT_SLUG);
  const row = await models.PlanMealOptionFood.findByPk(foodG.id);
  softAssert(row.unit === "household", `BD: unit='household' (got ${row.unit})`);
  softAssert(Number(row.amount) === 2, `BD: amount=2 (got ${row.amount})`);
  softAssert(row.householdLabel === "1 cucharada",
    `BD: householdLabel='1 cucharada' (got ${row.householdLabel})`);
}

// ── 7. Re-aplicar plantilla origen ──────────────────────────────────────────

async function step7Reapply() {
  header("7) POST /reapply-template → archive viejo + crea nuevo");
  const r = await httpJson("POST",
    `/api/nutricion/plans/${state.assignedId}/reapply-template`, {});
  assertOk(r.ok && r.json?.data?.id, "POST /reapply-template 200");
  state.reappliedId = r.json.data.id;
  softAssert(r.json.data.id !== state.assignedId, "Nuevo plan id distinto");
  softAssert(r.json.data.type === "assigned", "Nuevo plan type=assigned");

  // Confirmar en BD: viejo archivado, nuevo activo, deep-copy intacto
  const { models } = await getModels(TENANT_SLUG);
  const oldRow = await models.Plan.findByPk(state.assignedId);
  const newRow = await models.Plan.findByPk(state.reappliedId);
  softAssert(!!oldRow.archivedAt, "Plan viejo: archivedAt set");
  softAssert(!newRow.archivedAt, "Plan nuevo: activo (archivedAt null)");

  // En el nuevo plan, la food de Desayuno #1 vuelve a ser g/80 (sale de la
  // plantilla original, NO del viejo asignado editado).
  const newTree = await httpJson("GET", `/api/nutricion/plans/${state.reappliedId}`);
  const newOpt = newTree.json.data.meals
    .find((m) => m.name === "Desayuno")
    .options.find((o) => o.isDefault);
  const restoredFood = (newOpt.foods || []).find((f) => f.unit === "g" && Number(f.amount) === 80);
  softAssert(!!restoredFood,
    "Plantilla origen restaurada: food unit=g amount=80 en Desayuno");
}

// ── 8. GET /api/clients/[id]/plans ──────────────────────────────────────────

async function step8ListClientPlans() {
  header("8) GET /api/clients/[id]/plans → 1 activo + 1 archivado");
  const r = await httpJson("GET", `/api/clients/${state.clientId}/plans`);
  assertOk(r.ok && r.json?.ok, "GET clients/[id]/plans OK");
  const items = r.json.items || [];
  softAssert(items.length === 2, `2 planes (got ${items.length})`);
  const active = items.find((p) => p.status === "active");
  const archived = items.find((p) => p.status === "archived");
  softAssert(active?.id === state.reappliedId, "Activo es el nuevo plan");
  softAssert(archived?.id === state.assignedId, "Archivado es el plan editado");
  softAssert(active?.templateName === `${PREFIX}-Plan`, "templateName del activo coincide");
  softAssert(active?.mealCount === 2, `mealCount=2 (got ${active?.mealCount})`);
}

// ── 9. PATCH metadata plantilla con asignaciones → hadAssignments ───────────

async function step9PatchTemplate() {
  header("9) PATCH plantilla con asignaciones → hadAssignments>=1");
  const r = await httpJson("PATCH", `/api/nutricion/plans/${state.templateId}`, {
    description: "Editado en smoke E2E",
  });
  assertOk(r.ok && r.json?.ok, "PATCH plantilla OK");
  softAssert(typeof r.json.hadAssignments === "number" && r.json.hadAssignments >= 1,
    `hadAssignments>=1 (got ${r.json.hadAssignments})`);
}

// ── 10. Cleanup ─────────────────────────────────────────────────────────────

async function step10Cleanup() {
  header("10) Cleanup post-run");
  const { sequelize } = await getModels(TENANT_SLUG);
  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.plans WHERE name LIKE :p`,
    { replacements: { p: `${PREFIX}-%` } }
  );
  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.foods WHERE name LIKE :p`,
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
  process.stdout.write(`\n${"═".repeat(64)}\n`);
  process.stdout.write(`Smoke E2E Recetario nutri_laura — flujo completo\n`);
  process.stdout.write(`${"═".repeat(64)}\n`);

  let authed = false;
  try {
    await step1Bootstrap();
    authed = await login();
    if (!authed) throw new Error("No auth — abortando");
    await step2Catalog();
    await step3CreateTemplate();
    await step4VerifyMacros();
    await step5Assign();
    await step6EditAssigned();
    await step7Reapply();
    await step8ListClientPlans();
    await step9PatchTemplate();
    await step10Cleanup();
  } catch (err) {
    process.stderr.write(`\n✗ E2E abortado: ${err.message}\n`);
    if (err.stack) process.stderr.write(err.stack + "\n");
    try { await step10Cleanup(); } catch { /* swallow */ }
  } finally {
    try {
      const { closeAllConnections } = await import("../lib/db/tenantDb.js");
      await closeAllConnections().catch(() => {});
    } catch { /* no-op */ }
  }

  header("Resumen E2E");
  log(`Pasos OK    : ${counts.pass}`);
  log(`Pasos KO    : ${counts.fail}`);
  log(`Pasos skip  : ${counts.skipped}`);
  log(`Modo        : ${authed ? "HTTP completo" : "Sin auth"}`);

  process.exit(counts.fail > 0 ? 1 : 0);
}

main();
