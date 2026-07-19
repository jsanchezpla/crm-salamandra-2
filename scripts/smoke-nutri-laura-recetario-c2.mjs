/**
 * smoke-nutri-laura-recetario-c2.mjs — Smoke HTTP del Sprint Recetario C2.
 *
 * 19 casos cubriendo:
 *
 *   1. Health: tablas plans/plan_meals/plan_meal_options/plan_meal_option_foods
 *      accesibles + ≥1 food del catálogo (lo creamos si no hay).
 *   2. Cleanup pre-run.
 *   3. POST /plans → plantilla vacía type='template'.
 *   4. PATCH /plans/[id] cambiar name → hadAssignments=0.
 *   5. POST /plans/[id]/meals → comida 'Desayuno'.
 *   6. POST /plans/[id]/meals/[mealId]/options → opción default.
 *   7. POST .../foods unit='g' amount=80.
 *   8. POST .../foods unit='household' label/grams.
 *   9. POST .../foods unit='free' amount=null.
 *  10. POST .../foods unit='g' amount=null → 400 (CHECK).
 *  11. GET /plans/[id] → árbol completo con 3 foods.
 *  12. POST /plans/[id]/duplicate → nuevo plan + árbol clonado.
 *  13. POST /plans/[id]/assign con clientId → 200 + plan asignado.
 *  14. POST /plans/[id]/assign mismo clientId → 409.
 *  15. PATCH /plans/[id] sobre plantilla con 1 asignación → hadAssignments=1.
 *  16. DELETE plan asignado → archived_at set + plantilla intacta.
 *  17. DELETE plantilla con asignaciones → archived_at set + asignaciones
 *      intactas (independencia).
 *  18. Permisos: GET /plans sin cookie → 401.
 *  19. Cleanup post-run.
 *
 * Auth: si no hay SMOKE_PASSWORD, firma JWT directo con JWT_SECRET (idéntico
 * al smoke C1).
 */

const BASE_URL = "http://localhost:3000";
const TENANT_SLUG = "nutri_laura";
const ADMIN_EMAIL = "admin@nutri-laura.es";
const ADMIN_PASSWORD = process.env.SMOKE_PASSWORD || null;

const PREFIX = "smoke-c2";

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

async function httpJson(method, urlPath, body, extraHeaders) {
  const headers = { "Content-Type": "application/json", ...(extraHeaders || {}) };
  if (cookies) headers.Cookie = cookies;
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
  foodId: null,        // food del catálogo a usar
  clientId: null,      // cliente test
  templateId: null,    // plantilla creada en 3
  mealId: null,
  optionId: null,
  duplicatedId: null,
  assignedId: null,
};

// ── 1. Health ──────────────────────────────────────────────────────────────

async function step1Health() {
  header("1) Health + tablas C2 + food del catálogo disponible");
  let r;
  try { r = await fetch(`${BASE_URL}/api/auth/me`); }
  catch (e) { throw new Error(`Dev server no responde (${e.message})`); }
  assertOk(r.status === 200 || r.status === 401, "GET /api/auth/me responde", `status=${r.status}`);

  const { sequelize, models } = await getModels(TENANT_SLUG);
  for (const t of ["foods", "plans", "plan_meals", "plan_meal_options", "plan_meal_option_foods"]) {
    const [rows] = await sequelize.query(`SELECT COUNT(*)::int AS n FROM crm_${TENANT_SLUG}.${t}`);
    assertOk(typeof rows[0].n === "number", `Tabla crm_${TENANT_SLUG}.${t} accesible`);
  }
  // Asegurar al menos 1 food disponible
  let food = await models.Food.findOne({ where: { archivedAt: null } });
  if (!food) {
    food = await models.Food.create({
      name: `${PREFIX}-food-seed`,
      defaultUnit: "g",
      proteinPer100: 25,
      carbsPer100: 0,
      fatPer100: 10,
      fiberPer100: 0,
      source: "custom",
    });
    log(`  · food seed creado para el smoke: ${food.id}`);
  }
  state.foodId = food.id;
  assertOk(!!state.foodId, "Food del catálogo disponible para el smoke");

  // Crear cliente test (siempre creamos uno propio para el smoke)
  const client = await models.Client.create({
    name: `${PREFIX}-paciente-${Math.floor(Math.random() * 100000)}`,
    type: "individual",
    email: `smoke-c2-${Date.now()}@example.com`,
  });
  state.clientId = client.id;
  log(`  · cliente smoke creado: ${client.id}`);
}

// ── 2. Pre-cleanup ─────────────────────────────────────────────────────────

async function step2PreCleanup() {
  header("2) Cleanup preventivo de plans de pruebas");
  const { sequelize } = await getModels(TENANT_SLUG);
  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.plans WHERE name LIKE :p`,
    { replacements: { p: `${PREFIX}-%` } }
  );
  pass("Pre-cleanup completado");
  counts.pass++;
}

// ── Login ──────────────────────────────────────────────────────────────────

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
    pass(`JWT firmado directamente para ${ADMIN_EMAIL}`);
    counts.pass++;
    return true;
  } catch (err) {
    log(`  ✗ JWT fallback falló: ${err.message}`);
    counts.skipped++;
    return false;
  }
}

// ── 3. POST plantilla vacía ────────────────────────────────────────────────

async function step3CreateTemplate() {
  header("3) POST /plans crear plantilla vacía");
  const name = `${PREFIX}-template-${Math.floor(Math.random() * 100000)}`;
  const r = await httpJson("POST", "/api/nutricion/plans", {
    // Nutrinotas: los menus nuevos auto-siembran 5 comidas; las plantillas de
    // prueba se crean vacias para que las aserciones de conteo sigan valiendo.
    skipDefaultMeals: true,
    name,
    description: "Plantilla smoke C2",
  });
  assertOk(r.ok && r.json?.ok && r.json.data?.id, "POST /plans OK", `status=${r.status}`);
  assertOk(r.json.data.type === "template", `type=template (got ${r.json.data.type})`);
  state.templateId = r.json.data.id;
}

// ── 4. PATCH metadata ──────────────────────────────────────────────────────

async function step4PatchMetadata() {
  header("4) PATCH /plans editar name → hadAssignments=0");
  const r = await httpJson("PATCH", `/api/nutricion/plans/${state.templateId}`, {
    name: `${PREFIX}-template-renamed`,
  });
  assertOk(r.ok && r.json?.ok, "PATCH /plans OK", `status=${r.status}`);
  assertOk(r.json.hadAssignments === 0, `hadAssignments=0 (got ${r.json.hadAssignments})`);
}

// ── 5. POST meal ───────────────────────────────────────────────────────────

async function step5AddMeal() {
  header("5) POST /plans/[id]/meals 'Desayuno'");
  const r = await httpJson("POST", `/api/nutricion/plans/${state.templateId}/meals`, {
    name: "Desayuno",
    description: "DESAYUNO + BEBIDA",
  });
  assertOk(r.ok && r.json?.ok && r.json.data?.id, "POST meal OK", `status=${r.status}`);
  state.mealId = r.json.data.id;
}

// ── 6. POST option ─────────────────────────────────────────────────────────

async function step6AddOption() {
  header("6) POST /plans/[id]/meals/[mealId]/options is_default=true");
  const r = await httpJson(
    "POST",
    `/api/nutricion/plans/${state.templateId}/meals/${state.mealId}/options`,
    { name: "Opción 1", isDefault: true }
  );
  assertOk(r.ok && r.json?.ok && r.json.data?.id, "POST option OK", `status=${r.status}`);
  state.optionId = r.json.data.id;
}

// ── 7. POST food unit=g ────────────────────────────────────────────────────

async function step7AddFoodG() {
  header("7) POST .../foods unit='g' amount=80");
  const r = await httpJson(
    "POST",
    `/api/nutricion/plans/${state.templateId}/meals/${state.mealId}/options/${state.optionId}/foods`,
    { foodId: state.foodId, unit: "g", amount: 80 }
  );
  assertOk(r.ok && r.json?.ok && r.json.data?.id, "POST food g OK", `status=${r.status}`);
  assertOk(r.json.data.unit === "g", `unit=g (got ${r.json.data.unit})`);
}

// ── 8. POST food unit=household ────────────────────────────────────────────

async function step8AddFoodHousehold() {
  header("8) POST .../foods unit='household'");
  const r = await httpJson(
    "POST",
    `/api/nutricion/plans/${state.templateId}/meals/${state.mealId}/options/${state.optionId}/foods`,
    {
      foodId: state.foodId,
      unit: "household",
      amount: 2,
      householdLabel: "1 cucharada",
      householdGrams: 15,
    }
  );
  assertOk(r.ok && r.json?.ok, "POST food household OK", `status=${r.status} err=${r.json?.error}`);
}

// ── 9. POST food unit=free ─────────────────────────────────────────────────

async function step9AddFoodFree() {
  header("9) POST .../foods unit='free' amount=null");
  const r = await httpJson(
    "POST",
    `/api/nutricion/plans/${state.templateId}/meals/${state.mealId}/options/${state.optionId}/foods`,
    { foodId: state.foodId, unit: "free", notes: "Café con leche al gusto" }
  );
  assertOk(r.ok && r.json?.ok, "POST food free OK", `status=${r.status} err=${r.json?.error}`);
}

// ── 10. POST food unit=g + amount=null → 400 ──────────────────────────────

async function step10AddFoodInvalid() {
  header("10) POST .../foods unit='g' + amount=null → 400");
  const r = await httpJson(
    "POST",
    `/api/nutricion/plans/${state.templateId}/meals/${state.mealId}/options/${state.optionId}/foods`,
    { foodId: state.foodId, unit: "g" }  // amount missing
  );
  assertOk(r.status === 400, "Devuelve 400", `status=${r.status} body=${JSON.stringify(r.json)}`);
}

// ── 11. GET árbol completo ─────────────────────────────────────────────────

async function step11GetTree() {
  header("11) GET /plans/[id] → árbol completo");
  const r = await httpJson("GET", `/api/nutricion/plans/${state.templateId}`);
  assertOk(r.ok && r.json?.ok, "GET árbol OK", `status=${r.status}`);
  const data = r.json.data;
  assertOk(Array.isArray(data.meals) && data.meals.length === 1, `meals.length=1 (got ${data.meals?.length})`);
  const meal = data.meals[0];
  assertOk(Array.isArray(meal.options) && meal.options.length === 1, `options.length=1`);
  const option = meal.options[0];
  assertOk(option.foods.length === 3, `foods.length=3 (got ${option.foods.length})`);
  // Cada food anidado debe incluir el catálogo
  assertOk(!!option.foods[0].food?.name, "food.food.name presente (catálogo eager-loaded)");
}

// ── 12. Duplicate ──────────────────────────────────────────────────────────

async function step12Duplicate() {
  header("12) POST /plans/[id]/duplicate → árbol clonado");
  const r = await httpJson("POST", `/api/nutricion/plans/${state.templateId}/duplicate`, {});
  assertOk(r.ok && r.json?.ok && r.json.data?.id, "POST duplicate OK", `status=${r.status}`);
  state.duplicatedId = r.json.data.id;
  assertOk(state.duplicatedId !== state.templateId, "ID nuevo distinto");
  assertOk(r.json.data.meals?.[0]?.options?.[0]?.foods?.length === 3, "Árbol duplicado con 3 foods");
}

// ── 13. Assign ─────────────────────────────────────────────────────────────

async function step13Assign() {
  header("13) POST /plans/[id]/assign → plan asignado");
  const r = await httpJson("POST", `/api/nutricion/plans/${state.templateId}/assign`, {
    clientId: state.clientId,
  });
  assertOk(r.ok && r.json?.ok && r.json.data?.id, "POST assign OK", `status=${r.status} err=${r.json?.error}`);
  state.assignedId = r.json.data.id;
  assertOk(r.json.data.type === "assigned", "type=assigned");
  assertOk(r.json.data.templateId === state.templateId, "templateId apunta a la plantilla");
  assertOk(r.json.data.clientId === state.clientId, "clientId match");
  assertOk(r.json.data.meals?.[0]?.options?.[0]?.foods?.length === 3, "Árbol asignado con 3 foods");
}

// ── 14. Assign duplicado → 409 ─────────────────────────────────────────────

async function step14AssignDup() {
  header("14) POST /plans/[id]/assign mismo cliente → 409");
  const r = await httpJson("POST", `/api/nutricion/plans/${state.templateId}/assign`, {
    clientId: state.clientId,
  });
  assertOk(r.status === 409, "Devuelve 409", `status=${r.status} body=${JSON.stringify(r.json)}`);
}

// ── 15. PATCH plantilla con 1 asignación → hadAssignments=1 ────────────────

async function step15PatchTemplateWithAssignment() {
  header("15) PATCH plantilla con asignación → hadAssignments=1");
  const r = await httpJson("PATCH", `/api/nutricion/plans/${state.templateId}`, {
    description: "Plantilla editada después de asignar",
  });
  assertOk(r.ok && r.json?.ok, "PATCH OK", `status=${r.status}`);
  assertOk(r.json.hadAssignments === 1, `hadAssignments=1 (got ${r.json.hadAssignments})`);
}

// ── 16. DELETE plan asignado → archivado, plantilla intacta ────────────────

async function step16DeleteAssigned() {
  header("16) DELETE plan asignado → archived_at set, plantilla intacta");
  const r = await fetch(`${BASE_URL}/api/nutricion/plans/${state.assignedId}`, {
    method: "DELETE", headers: { Cookie: cookies },
  });
  assertOk(r.status === 204, "DELETE asignado 204", `status=${r.status}`);
  const { models } = await getModels(TENANT_SLUG);
  const assigned = await models.Plan.findByPk(state.assignedId);
  assertOk(!!assigned.archivedAt, "asignado.archivedAt set");
  const tpl = await models.Plan.findByPk(state.templateId);
  assertOk(!tpl.archivedAt, "plantilla NO archivada");
}

// ── 17. DELETE plantilla con asignaciones — independencia ──────────────────

async function step17DeleteTemplateIndependence() {
  header("17) DELETE plantilla con asignaciones → independencia");
  // Crear una NUEVA asignación viva (la del 13 ya está archivada)
  const r1 = await httpJson("POST", `/api/nutricion/plans/${state.templateId}/assign`, {
    clientId: state.clientId,
  });
  assertOk(r1.ok && r1.json?.ok, "Crear 2ª asignación OK");
  const liveAssignedId = r1.json.data.id;

  const r2 = await fetch(`${BASE_URL}/api/nutricion/plans/${state.templateId}`, {
    method: "DELETE", headers: { Cookie: cookies },
  });
  assertOk(r2.status === 204, "DELETE plantilla 204", `status=${r2.status}`);

  const { models } = await getModels(TENANT_SLUG);
  const tpl = await models.Plan.findByPk(state.templateId);
  assertOk(!!tpl.archivedAt, "plantilla.archivedAt set");
  const liveAssigned = await models.Plan.findByPk(liveAssignedId);
  assertOk(!liveAssigned.archivedAt, "asignación viva NO archivada (independencia)");
  // Sus foods siguen intactos — vía endpoint GET (cuenta deterministico)
  const treeRes = await httpJson("GET", `/api/nutricion/plans/${liveAssignedId}`);
  assertOk(treeRes.ok && treeRes.json?.ok, "GET árbol asignación viva tras archivar plantilla", `status=${treeRes.status}`);
  const foodsCount = treeRes.json?.data?.meals?.[0]?.options?.[0]?.foods?.length ?? 0;
  assertOk(foodsCount === 3, `foods de asignación viva intactos (n=${foodsCount})`);
}

// ── 18. Permisos sin auth → 401 ────────────────────────────────────────────

async function step18Auth() {
  header("18) GET /plans sin cookie → 401");
  const r = await fetch(`${BASE_URL}/api/nutricion/plans?type=template`);
  assertOk(r.status === 401, "Sin cookie 401", `status=${r.status}`);
}

// ── 18b. POST /meals/reorder — añadido en C5 ───────────────────────────────

async function step18bReorder() {
  header("18b) POST /meals/reorder (C5) — plan fresco standalone");
  // Plan dedicado para no depender del state de los pasos anteriores (que
  // archivan el template y la asignación en 16/17). Self-contained: lo
  // creamos, le añadimos 3 comidas, probamos los 4 casos y el cleanup global
  // por prefijo lo elimina al final.
  const tpl = await httpJson("POST", "/api/nutricion/plans", {
    // Nutrinotas: los menus nuevos auto-siembran 5 comidas; las plantillas de
    // prueba se crean vacias para que las aserciones de conteo sigan valiendo.
    skipDefaultMeals: true,
    name: `${PREFIX}-reorder`,
  });
  assertOk(tpl.ok && tpl.json?.data?.id, "POST plantilla reorder");
  const reorderPlanId = tpl.json.data.id;
  state.reorderPlanId = reorderPlanId;

  for (const name of ["Desayuno", "Comida", "Cena"]) {
    const m = await httpJson("POST", `/api/nutricion/plans/${reorderPlanId}/meals`, { name });
    assertOk(m.ok, `POST meal ${name}`);
  }

  const treePre = await httpJson("GET", `/api/nutricion/plans/${reorderPlanId}`);
  const mealsPre = (treePre.json.data.meals || []).slice().sort((a, b) => a.order - b.order);
  assertOk(mealsPre.length === 3, `Plan tiene 3 comidas (got ${mealsPre.length})`);

  // ── Caso A: reorder OK invirtiendo el orden ─────────────────────────────
  const inverted = mealsPre.slice().reverse().map((m, i) => ({ id: m.id, order: i }));
  const rOk = await httpJson("POST",
    `/api/nutricion/plans/${reorderPlanId}/meals/reorder`,
    { order: inverted });
  assertOk(rOk.ok && rOk.json?.ok, "POST /reorder happy path 200",
    `status=${rOk.status} body=${JSON.stringify(rOk.json)}`);
  softAssert((rOk.json.items || []).length === 3, "Response items.length === 3");
  const { models: m1 } = await getModels(TENANT_SLUG);
  const fresh = await m1.PlanMeal.findAll({
    where: { planId: reorderPlanId },
    attributes: ["id", "order"],
    order: [["order", "ASC"]],
  });
  const freshIds = fresh.map((r) => r.id);
  const expectedIds = inverted.slice().sort((a, b) => a.order - b.order).map((r) => r.id);
  softAssert(JSON.stringify(freshIds) === JSON.stringify(expectedIds),
    "BD refleja el nuevo orden tras /reorder",
    `bd=${JSON.stringify(freshIds)} expected=${JSON.stringify(expectedIds)}`);

  // ── Caso B: ID inválido (no pertenece al plan) → 400 ────────────────────
  const fakeId = "00000000-0000-0000-0000-000000000000";
  const badIds = [
    { id: fakeId, order: 0 },
    { id: mealsPre[1].id, order: 1 },
    { id: mealsPre[2].id, order: 2 },
  ];
  const rBadId = await httpJson("POST",
    `/api/nutricion/plans/${reorderPlanId}/meals/reorder`,
    { order: badIds });
  softAssert(rBadId.status === 400, `Reorder con id ajeno → 400 (got ${rBadId.status})`,
    JSON.stringify(rBadId.json));

  // ── Caso C: lista incompleta (omitiendo una comida) → 400 ───────────────
  const missingOne = [
    { id: mealsPre[0].id, order: 0 },
    { id: mealsPre[1].id, order: 1 },
  ];
  const rIncomplete = await httpJson("POST",
    `/api/nutricion/plans/${reorderPlanId}/meals/reorder`,
    { order: missingOne });
  softAssert(rIncomplete.status === 400, `Reorder con lista incompleta → 400 (got ${rIncomplete.status})`,
    JSON.stringify(rIncomplete.json));

  // ── Caso D: order con hueco (no consecutivo) → 400 ──────────────────────
  const withGap = mealsPre.map((m, i) => ({ id: m.id, order: i === 1 ? 5 : i }));
  const rGap = await httpJson("POST",
    `/api/nutricion/plans/${reorderPlanId}/meals/reorder`,
    { order: withGap });
  softAssert(rGap.status === 400, `Reorder con hueco en orders → 400 (got ${rGap.status})`,
    JSON.stringify(rGap.json));
}

// ── 19. Cleanup ────────────────────────────────────────────────────────────

async function step19Cleanup() {
  header("19) Cleanup post-run");
  const { sequelize, models } = await getModels(TENANT_SLUG);

  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.plans WHERE name LIKE :p`,
    { replacements: { p: `${PREFIX}-%` } }
  );
  if (state.clientId) {
    await models.Client.destroy({ where: { id: state.clientId } });
  }
  // El food seed que pudimos crear lo dejamos si tiene el prefijo del smoke
  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.foods WHERE name LIKE :p`,
    { replacements: { p: `${PREFIX}-%` } }
  );
  try {
    const { getMasterModels } = await import("../lib/db/masterDb.js");
    const { AuditLog } = getMasterModels();
    if (AuditLog) {
      const ids = [state.templateId, state.duplicatedId, state.assignedId].filter(Boolean);
      if (ids.length) {
        await AuditLog.destroy({ where: { entity: "Plan", entityId: ids } });
      }
    }
  } catch { /* swallow */ }
  pass("Cleanup completado");
  counts.pass++;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write(`\nSmoke nutri_laura Recetario C2 — ${new Date().toISOString().slice(11, 23)}\n`);
  process.stdout.write(`${"═".repeat(64)}\n`);

  let authed = false;
  try {
    await step1Health();
    await step2PreCleanup();
    authed = await login();
    if (!authed) throw new Error("No auth — abortando");
    await step3CreateTemplate();
    await step4PatchMetadata();
    await step5AddMeal();
    await step6AddOption();
    await step7AddFoodG();
    await step8AddFoodHousehold();
    await step9AddFoodFree();
    await step10AddFoodInvalid();
    await step11GetTree();
    await step12Duplicate();
    await step13Assign();
    await step14AssignDup();
    await step15PatchTemplateWithAssignment();
    await step16DeleteAssigned();
    await step17DeleteTemplateIndependence();
    await step18Auth();
    await step18bReorder();
    await step19Cleanup();
  } catch (err) {
    process.stderr.write(`\n✗ Smoke abortado: ${err.message}\n`);
    if (err.stack) process.stderr.write(err.stack + "\n");
    try { await step19Cleanup(); } catch { /* swallow */ }
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
