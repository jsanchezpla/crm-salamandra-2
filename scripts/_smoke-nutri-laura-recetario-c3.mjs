/**
 * _smoke-nutri-laura-recetario-c3.mjs — Smoke del Sprint Recetario C3.
 *
 * C3 es principalmente UI; este smoke cubre las DOS partes que SÍ se
 * pueden testear sin un navegador headless:
 *
 *   PARTE A — Unit tests del helper lib/nutricion/macros.js
 *     Casos borde de computeFoodMacros / computeOptionMacros /
 *     computeMealMacros / computePlanMacros (sin red, sin BD).
 *
 *   PARTE B — Integración HTTP/BD del backend que cambió en C3:
 *     · Búsqueda case+accent insensitive en GET /api/nutricion/foods
 *     · Nuevo query param `withSummary=true` en GET /api/nutricion/plans
 *       (con counts de meals/options + activeAssignmentsCount + clientName
 *       para asignados).
 *     · Re-cálculo de macros tras editar amount de un PlanMealOptionFood.
 *     · Asignación a paciente (smoke ya cubierto en C2 — replicamos para
 *       verificar el path completo de deep-copy + asignaciones contadas).
 *
 * Auth: igual que C1/C2 — SMOKE_PASSWORD o firma JWT directa.
 *
 * Uso:
 *   # PARTE A (sin red, sin servidor)
 *   node scripts/_smoke-nutri-laura-recetario-c3.mjs --only-unit
 *
 *   # Smoke completo (requiere dev server + .env.local)
 *   npm run dev          # otra terminal
 *   node --env-file=.env.local scripts/_smoke-nutri-laura-recetario-c3.mjs
 *
 *   # Con auth HTTP completa
 *   $env:SMOKE_PASSWORD = "<password admin nutri_laura>"
 *   node --env-file=.env.local scripts/_smoke-nutri-laura-recetario-c3.mjs
 */

const BASE_URL = "http://localhost:3000";
const TENANT_SLUG = "nutri_laura";
const ADMIN_EMAIL = "admin@nutri-laura.es";
const ADMIN_PASSWORD = process.env.SMOKE_PASSWORD || null;
const ONLY_UNIT = process.argv.includes("--only-unit");
const PREFIX = "smoke-c3";

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

// ════════════════════════════════════════════════════════════════════════════
// PARTE A — Unit tests del helper de macros (sin red)
// ════════════════════════════════════════════════════════════════════════════

async function partA_macros() {
  header("PARTE A — lib/nutricion/macros.js (casos borde)");

  const {
    computeFoodMacros,
    computeOptionMacros,
    computeMealMacros,
    computePlanMacros,
  } = await import("../lib/nutricion/macros.js");

  // ── 1. unit='g' con macros completos → proporcional a 100g ──────────────────
  {
    const line = {
      unit: "g", amount: 200,
      food: { proteinPer100: 10, carbsPer100: 20, fatPer100: 5, fiberPer100: 1 },
    };
    const m = computeFoodMacros(line);
    softAssert(m.protein === 20 && m.carbs === 40 && m.fat === 10 && m.fiber === 2,
      "computeFoodMacros — unit='g' amount=200 ×2", `got ${JSON.stringify(m)}`);
  }

  // ── 2. unit='household' usa householdGrams ─────────────────────────────────
  {
    const line = {
      unit: "household", amount: 1, householdGrams: 15,
      food: { proteinPer100: 0, carbsPer100: 0, fatPer100: 100, fiberPer100: 0 },
    };
    const m = computeFoodMacros(line);
    softAssert(m.fat === 15 && m.protein === 0,
      "computeFoodMacros — unit='household' 15g aceite → 15g grasa",
      `got ${JSON.stringify(m)}`);
  }

  // ── 3. unit='free' → todos null ────────────────────────────────────────────
  {
    const line = { unit: "free", food: { proteinPer100: 10 } };
    const m = computeFoodMacros(line);
    softAssert(m.protein === null && m.carbs === null && m.fat === null && m.fiber === null,
      "computeFoodMacros — unit='free' devuelve todos null",
      `got ${JSON.stringify(m)}`);
  }

  // ── 4. food eager-load missing → todos null ────────────────────────────────
  {
    const line = { unit: "g", amount: 100 /* no food */ };
    const m = computeFoodMacros(line);
    softAssert(m.protein === null,
      "computeFoodMacros — falta line.food → null",
      `got ${JSON.stringify(m)}`);
  }

  // ── 5. amount=0 o negativo → null ──────────────────────────────────────────
  {
    const m1 = computeFoodMacros({ unit: "g", amount: 0, food: { proteinPer100: 10 } });
    softAssert(m1.protein === null, "amount=0 → null", `got ${JSON.stringify(m1)}`);
    const m2 = computeFoodMacros({ unit: "g", amount: -5, food: { proteinPer100: 10 } });
    softAssert(m2.protein === null, "amount<0 → null", `got ${JSON.stringify(m2)}`);
  }

  // ── 6. Opción mixta: g + household + free + un macro con null ──────────────
  {
    const option = {
      foods: [
        { unit: "g", amount: 100, food: { proteinPer100: 20, carbsPer100: null, fatPer100: 0, fiberPer100: 0 } },
        { unit: "household", amount: 2, householdGrams: 50,
          food: { proteinPer100: 0, carbsPer100: 30, fatPer100: 0, fiberPer100: 4 } },
        { unit: "free", food: { proteinPer100: 100 } },
      ],
    };
    const m = computeOptionMacros(option);
    // Esperado: protein = 20 + 0 = 20
    //           carbs   = null (1ª) + (100g × 30/100 = 30) = 30
    //           fat     = 0
    //           fiber   = 0 + (100g × 4/100 = 4) = 4
    softAssert(m.protein === 20, `optionMacros.protein === 20 (got ${m.protein})`);
    softAssert(m.carbs === 30,   `optionMacros.carbs === 30 (got ${m.carbs})`);
    softAssert(m.fat === 0,      `optionMacros.fat === 0 (got ${m.fat})`);
    softAssert(m.fiber === 4,    `optionMacros.fiber === 4 (got ${m.fiber})`);
  }

  // ── 7. Opción vacía (sin foods) → todos null ───────────────────────────────
  {
    const m = computeOptionMacros({ foods: [] });
    softAssert(m.protein === null && m.carbs === null && m.fat === null && m.fiber === null,
      "Opción sin foods → todos null", `got ${JSON.stringify(m)}`);
  }

  // ── 8. Meal usa la opción isDefault, no la primera ─────────────────────────
  {
    const meal = {
      options: [
        { order: 0, isDefault: false, foods: [{ unit: "g", amount: 100,
          food: { proteinPer100: 5, carbsPer100: 0, fatPer100: 0, fiberPer100: 0 } }] },
        { order: 1, isDefault: true, foods: [{ unit: "g", amount: 100,
          food: { proteinPer100: 50, carbsPer100: 0, fatPer100: 0, fiberPer100: 0 } }] },
      ],
    };
    const m = computeMealMacros(meal);
    softAssert(m.protein === 50,
      "mealMacros usa isDefault (50 prot), no la de menor order (5)",
      `got ${m.protein}`);
  }

  // ── 9. Meal sin isDefault → usa la de menor order ──────────────────────────
  {
    const meal = {
      options: [
        { order: 1, isDefault: false, foods: [{ unit: "g", amount: 100,
          food: { proteinPer100: 99, carbsPer100: 0, fatPer100: 0, fiberPer100: 0 } }] },
        { order: 0, isDefault: false, foods: [{ unit: "g", amount: 100,
          food: { proteinPer100: 7, carbsPer100: 0, fatPer100: 0, fiberPer100: 0 } }] },
      ],
    };
    const m = computeMealMacros(meal);
    softAssert(m.protein === 7,
      "Sin default → usa menor order (7), no la primera del array (99)",
      `got ${m.protein}`);
  }

  // ── 10. Plan con varias comidas: suma defaults ─────────────────────────────
  {
    const plan = {
      meals: [
        { options: [{ isDefault: true, foods: [{ unit: "g", amount: 100,
          food: { proteinPer100: 10, carbsPer100: 0, fatPer100: 0, fiberPer100: 0 } }] }] },
        { options: [{ isDefault: true, foods: [{ unit: "g", amount: 100,
          food: { proteinPer100: 5,  carbsPer100: 0, fatPer100: 0, fiberPer100: 0 } }] }] },
      ],
    };
    const m = computePlanMacros(plan);
    softAssert(m.protein === 15, "planMacros suma defaults (10+5=15)", `got ${m.protein}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Auth helper (reutilizado del smoke C2)
// ════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════
// PARTE B — Integración HTTP/BD del backend C3
// ════════════════════════════════════════════════════════════════════════════

const state = {
  foodWithAccent: null, // ID del food con tilde
  clientId: null,
  templateId: null,
  assignedId: null,
};

async function partB_setup() {
  header("Setup BD: food con tilde + cliente smoke");
  const { sequelize, models } = await getModels(TENANT_SLUG);
  // Limpieza preventiva de runs previos
  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.plans WHERE name LIKE :p`,
    { replacements: { p: `${PREFIX}-%` } }
  );
  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.foods WHERE name LIKE :p`,
    { replacements: { p: `${PREFIX}-%` } }
  );

  // Crear un food con tilde en el nombre y con medidas caseras pobladas
  // (necesarias para los tests B.5 / B.6 que dependen del eager-load de
  // householdMeasures en el árbol del plan).
  const food = await models.Food.create({
    name: `${PREFIX}-Cebáda Integral`,
    defaultUnit: "g",
    proteinPer100: 10,
    carbsPer100: 65,
    fatPer100: 2,
    fiberPer100: 8,
    source: "custom",
    householdMeasures: [
      { label: "1 cucharada", grams: 15 },
      { label: "1 taza", grams: 240 },
    ],
  });
  state.foodWithAccent = food.id;
  pass(`Food con tilde creado: id=${food.id}`); counts.pass++;

  const client = await models.Client.create({
    name: `${PREFIX}-paciente-${Math.floor(Math.random() * 100000)}`,
    type: "individual",
    email: `smoke-c3-${Date.now()}@example.com`,
  });
  state.clientId = client.id;
  pass(`Cliente smoke creado: id=${client.id}`); counts.pass++;
}

async function partB_searchAccentInsensitive() {
  header("PARTE B.1 — GET /foods con búsqueda case+accent insensitive");

  // Sin tilde, todo en minúsculas → debe encontrar "Cebáda"
  const r1 = await httpJson("GET", `/api/nutricion/foods?q=cebada`);
  assertOk(r1.ok && r1.json?.ok, "GET /foods?q=cebada responde 200", `status=${r1.status}`);
  const hit1 = (r1.json.items || []).find((f) => f.id === state.foodWithAccent);
  softAssert(!!hit1, "Cebáda Integral encontrado al buscar 'cebada' (sin tilde, lower)");

  // Con tilde, mayúsculas → debe encontrar igualmente
  const r2 = await httpJson("GET", `/api/nutricion/foods?q=CEBÁDA`);
  assertOk(r2.ok && r2.json?.ok, "GET /foods?q=CEBÁDA responde 200", `status=${r2.status}`);
  const hit2 = (r2.json.items || []).find((f) => f.id === state.foodWithAccent);
  softAssert(!!hit2, "Cebáda Integral encontrado al buscar 'CEBÁDA' (mayús+tilde)");

  // Búsqueda parcial con normalización mixta
  const r3 = await httpJson("GET", `/api/nutricion/foods?q=Integ`);
  assertOk(r3.ok && r3.json?.ok, "GET /foods?q=Integ responde 200");
  const hit3 = (r3.json.items || []).find((f) => f.id === state.foodWithAccent);
  softAssert(!!hit3, "Match parcial 'Integ' encuentra 'Cebáda Integral'");
}

async function partB_plansWithSummary() {
  header("PARTE B.2 — GET /plans?withSummary=true (templates + assigned)");

  // Crear plantilla, comida, opción, 2 foods
  const tplRes = await httpJson("POST", "/api/nutricion/plans", {
    // Nutrinotas: los menus nuevos auto-siembran 5 comidas; las plantillas de
    // prueba se crean vacias para que las aserciones de conteo sigan valiendo.
    skipDefaultMeals: true,
    name: `${PREFIX}-template`,
    description: "Smoke C3 template",
  });
  assertOk(tplRes.ok && tplRes.json?.data?.id, "POST /plans plantilla", `status=${tplRes.status}`);
  state.templateId = tplRes.json.data.id;

  const m1Res = await httpJson("POST", `/api/nutricion/plans/${state.templateId}/meals`, {
    name: "Desayuno",
  });
  assertOk(m1Res.ok, "POST /meals Desayuno");
  const m1Id = m1Res.json.data.id;

  const m2Res = await httpJson("POST", `/api/nutricion/plans/${state.templateId}/meals`, {
    name: "Comida",
  });
  assertOk(m2Res.ok, "POST /meals Comida");
  const m2Id = m2Res.json.data.id;

  const o1Res = await httpJson("POST",
    `/api/nutricion/plans/${state.templateId}/meals/${m1Id}/options`,
    { isDefault: true });
  assertOk(o1Res.ok, "POST /options para Desayuno");
  const o1Id = o1Res.json.data.id;

  const o2Res = await httpJson("POST",
    `/api/nutricion/plans/${state.templateId}/meals/${m2Id}/options`,
    { isDefault: true });
  assertOk(o2Res.ok, "POST /options para Comida");

  const food1Res = await httpJson("POST",
    `/api/nutricion/plans/${state.templateId}/meals/${m1Id}/options/${o1Id}/foods`,
    { foodId: state.foodWithAccent, unit: "g", amount: 100 });
  assertOk(food1Res.ok, "POST /foods amount=100 en Desayuno");
  state.foodLineId = food1Res.json.data.id;

  // Ahora pedir el listado con summary
  const listRes = await httpJson("GET",
    `/api/nutricion/plans?type=template&withSummary=true&limit=100`);
  assertOk(listRes.ok && listRes.json?.ok, "GET /plans?withSummary=true template");
  const tpl = (listRes.json.items || []).find((p) => p.id === state.templateId);
  softAssert(!!tpl, "Plantilla aparece en el listado con summary");
  softAssert(Array.isArray(tpl?.mealsSummary), "tpl.mealsSummary es array");
  softAssert(tpl?.mealsSummary?.length === 2, `2 comidas en mealsSummary (got ${tpl?.mealsSummary?.length})`);
  softAssert(tpl?.mealCount === 2, `mealCount=2 (got ${tpl?.mealCount})`);
  const desayuno = tpl?.mealsSummary?.find((m) => m.name === "Desayuno");
  softAssert(desayuno?.optionCount === 1,
    `Desayuno.optionCount=1 (got ${desayuno?.optionCount})`);
  softAssert(tpl?.activeAssignmentsCount === 0,
    "Plantilla sin asignaciones todavía → activeAssignmentsCount=0",
    `got ${tpl?.activeAssignmentsCount}`);
}

async function partB_assignAndCount() {
  header("PARTE B.3 — Asignar paciente y verificar contadores");
  const assignRes = await httpJson("POST",
    `/api/nutricion/plans/${state.templateId}/assign`,
    { clientId: state.clientId });
  assertOk(assignRes.ok && assignRes.json?.data?.id, "POST /assign 200", `status=${assignRes.status}`);
  state.assignedId = assignRes.json.data.id;

  // Verificar que el listado de plantillas refleja la asignación
  const listRes = await httpJson("GET",
    `/api/nutricion/plans?type=template&withSummary=true&limit=100`);
  const tpl = (listRes.json.items || []).find((p) => p.id === state.templateId);
  softAssert(tpl?.activeAssignmentsCount === 1,
    "Plantilla ahora con activeAssignmentsCount=1",
    `got ${tpl?.activeAssignmentsCount}`);

  // Listado de asignados con summary incluye clientName + templateName
  const assignedList = await httpJson("GET",
    `/api/nutricion/plans?type=assigned&withSummary=true&limit=100`);
  assertOk(assignedList.ok, "GET /plans?type=assigned&withSummary OK");
  const assigned = (assignedList.json.items || []).find((p) => p.id === state.assignedId);
  softAssert(!!assigned, "Plan asignado aparece en el listado");
  softAssert(typeof assigned?.clientName === "string" && assigned.clientName.length > 0,
    `clientName poblado (${assigned?.clientName})`);
  softAssert(assigned?.templateName?.includes(`${PREFIX}-template`),
    `templateName apunta a la plantilla origen (${assigned?.templateName})`);
}

async function partB_householdMeasuresInTree() {
  header("PARTE B.5 — GET /plans/[id] devuelve food.householdMeasures");
  // Verifica el fix A: el eager-load del árbol incluye householdMeasures.
  const r = await httpJson("GET", `/api/nutricion/plans/${state.templateId}`);
  assertOk(r.ok && r.json?.ok, "GET /plans/[id] OK");
  const meal = (r.json.data.meals || []).find((m) => m.name === "Desayuno");
  const line = meal?.options?.[0]?.foods?.[0];
  softAssert(!!line, "Hay al menos una food line en el árbol");
  softAssert(Array.isArray(line?.food?.householdMeasures),
    "line.food.householdMeasures es array",
    `tipo: ${typeof line?.food?.householdMeasures}`);
  softAssert((line?.food?.householdMeasures?.length ?? 0) >= 2,
    "line.food.householdMeasures contiene ≥2 medidas (cucharada + taza)",
    `count=${line?.food?.householdMeasures?.length}`);
  const cucharada = (line?.food?.householdMeasures || []).find((m) => m.label === "1 cucharada");
  softAssert(cucharada && Number(cucharada.grams) === 15,
    "Medida '1 cucharada' viene con grams=15",
    `got ${JSON.stringify(cucharada)}`);
}

async function partB_unitTransitions() {
  header("PARTE B.6 / B.7 — Transiciones de unit con null explícito");

  // Reusamos el food line creado en B.2 (Desayuno → opción → Cebáda 100g).
  const tree = await httpJson("GET", `/api/nutricion/plans/${state.templateId}`);
  const meal = tree.json.data.meals.find((m) => m.name === "Desayuno");
  const opt = meal.options[0];
  const line = opt.foods[0];

  // Primero llevar la línea a 'household' (necesario para que B.6 sea
  // representativo). Antes del fix B esto ya funcionaba (no se pasaban
  // nulls). Sanity check + setup.
  const toHH = await httpJson("PATCH",
    `/api/nutricion/plans/${state.templateId}/meals/${meal.id}/options/${opt.id}/foods/${line.id}`,
    {
      unit: "household",
      amount: 2,
      householdLabel: "1 cucharada",
      householdGrams: 15,
    });
  assertOk(toHH.ok, "PATCH g→household (setup B.6)", `status=${toHH.status} ${JSON.stringify(toHH.json)}`);

  // B.6 — household → g con nulls explícitos (antes del fix B: 400).
  const toG = await httpJson("PATCH",
    `/api/nutricion/plans/${state.templateId}/meals/${meal.id}/options/${opt.id}/foods/${line.id}`,
    {
      unit: "g",
      amount: 30,            // 2 × 15 = 30 (lo que enviaría el frontend con el fix Bonus)
      householdLabel: null,
      householdGrams: null,
    });
  assertOk(toG.ok, "B.6 PATCH household→g con household_* nulls explícitos → 200",
    `status=${toG.status} body=${JSON.stringify(toG.json)}`);

  // Verificar persistencia
  const after6 = await httpJson("GET", `/api/nutricion/plans/${state.templateId}`);
  const line6 = after6.json.data.meals
    .find((m) => m.name === "Desayuno").options[0].foods[0];
  softAssert(line6.unit === "g", `Persistido unit='g' (got ${line6.unit})`);
  softAssert(Number(line6.amount) === 30, `Persistido amount=30 (got ${line6.amount})`);
  softAssert(line6.householdLabel === null, `Persistido householdLabel=null (got ${JSON.stringify(line6.householdLabel)})`);
  softAssert(line6.householdGrams === null, `Persistido householdGrams=null (got ${JSON.stringify(line6.householdGrams)})`);

  // B.7 — g → free con amount + household_* nulls.
  const toFree = await httpJson("PATCH",
    `/api/nutricion/plans/${state.templateId}/meals/${meal.id}/options/${opt.id}/foods/${line.id}`,
    {
      unit: "free",
      amount: null,
      householdLabel: null,
      householdGrams: null,
    });
  assertOk(toFree.ok, "B.7 PATCH g→free con amount + household_* nulls → 200",
    `status=${toFree.status} body=${JSON.stringify(toFree.json)}`);

  const after7 = await httpJson("GET", `/api/nutricion/plans/${state.templateId}`);
  const line7 = after7.json.data.meals
    .find((m) => m.name === "Desayuno").options[0].foods[0];
  softAssert(line7.unit === "free", `Persistido unit='free' (got ${line7.unit})`);
  softAssert(line7.amount === null, `Persistido amount=null (got ${JSON.stringify(line7.amount)})`);
  softAssert(line7.householdLabel === null, `Persistido householdLabel=null (got ${JSON.stringify(line7.householdLabel)})`);
  softAssert(line7.householdGrams === null, `Persistido householdGrams=null (got ${JSON.stringify(line7.householdGrams)})`);

  // Volver a 'g' para que B.4 (que viene después en main, no — viene antes)
  // siga teniendo sentido. NOTA: B.4 ya se ejecutó antes que B.5/B.6/B.7
  // en el orden de main; aquí no afecta a tests posteriores.
}

async function partB_recalcMacros() {
  header("PARTE B.4 — Re-cálculo de macros tras editar amount");
  // Editar el food de Desayuno a amount=200 y comprobar macros vía GET tree
  const treeBefore = await httpJson("GET", `/api/nutricion/plans/${state.templateId}`);
  const meal = (treeBefore.json.data.meals || []).find((m) => m.name === "Desayuno");
  const opt = meal.options[0];
  const line = opt.foods[0];
  softAssert(Number(line.amount) === 100, "Pre: amount=100", `got ${line.amount}`);

  const patchRes = await httpJson("PATCH",
    `/api/nutricion/plans/${state.templateId}/meals/${meal.id}/options/${opt.id}/foods/${line.id}`,
    { amount: 200 });
  assertOk(patchRes.ok, "PATCH amount=200 OK");

  const treeAfter = await httpJson("GET", `/api/nutricion/plans/${state.templateId}`);
  const lineAfter = treeAfter.json.data.meals
    .find((m) => m.name === "Desayuno").options[0].foods[0];
  softAssert(Number(lineAfter.amount) === 200, "Post: amount=200", `got ${lineAfter.amount}`);

  // Macros calculados in-process con el helper sobre el nuevo árbol
  const { computeOptionMacros } = await import("../lib/nutricion/macros.js");
  const opt2 = treeAfter.json.data.meals.find((m) => m.name === "Desayuno").options[0];
  const macros = computeOptionMacros(opt2);
  // Cebáda Integral: 10p / 65c / 2f / 8fb por 100g → 200g = 20p / 130c / 4f / 16fb
  softAssert(macros.protein === 20,
    `Macro recalc: protein=20 (10×2) — got ${macros.protein}`);
  softAssert(macros.carbs === 130,
    `Macro recalc: carbs=130 (65×2) — got ${macros.carbs}`);
}

async function partB_cleanup() {
  header("Cleanup final");
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

// ════════════════════════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  let authed = false;
  try {
    await partA_macros();
    if (ONLY_UNIT) {
      log("\n--only-unit: saltamos PARTE B");
    } else {
      authed = await login();
      if (!authed) {
        log("⚠ No se pudo autenticar; saltamos PARTE B (necesita dev server).");
      } else {
        await partB_setup();
        await partB_searchAccentInsensitive();
        await partB_plansWithSummary();
        await partB_assignAndCount();
        await partB_recalcMacros();
        await partB_householdMeasuresInTree();
        await partB_unitTransitions();
        await partB_cleanup();
      }
    }
  } catch (err) {
    process.stderr.write(`\n✗ Smoke abortado: ${err.message}\n`);
    if (err.stack) process.stderr.write(err.stack + "\n");
    try { await partB_cleanup(); } catch { /* swallow */ }
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
  log(`Modo        : ${ONLY_UNIT ? "Sólo PARTE A (helper macros)" : authed ? "PARTE A + PARTE B HTTP" : "Sólo PARTE A"}`);

  process.exit(counts.fail > 0 ? 1 : 0);
}

main();
