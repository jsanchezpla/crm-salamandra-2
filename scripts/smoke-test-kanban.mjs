/**
 * smoke-test-kanban.mjs — Smoke HTTP del Sprint 2 Proyectos (Kanban).
 *
 * Casos cubiertos:
 *   1. Health: server responde + tablas tasks/task_assignees accesibles.
 *   2. Cleanup pre-run.
 *   3. POST /projects → crea proyecto smoke con 4 columnas por defecto.
 *   4. POST /projects/[id]/tasks → crea 4 tasks en columna 0 con assignees.
 *   5. PATCH /tasks/[id] → cambia title + tags + assignees.
 *   6. PATCH /tasks/[id]/move → mueve task1 a columna 1 al final.
 *   7. PATCH /tasks/[id]/move → mueve task2 a columna 1 al inicio (orderShift).
 *   8. PATCH /columns/[colId]/reorder-tasks → reordena dentro de columna 1.
 *   9. GET /projects/[id]/board → verifica shape final.
 *  10. GET /projects/[id]/tasks?assigneeId=... → filtro por asignado.
 *  11. DELETE /tasks/[id] → borra una task; verifica recompactación de order.
 *  12. AuditLog: verifica entradas task.created/updated/moved/deleted.
 *  13. Cleanup post-run (borra el proyecto smoke).
 *
 * Auth: si no hay SMOKE_PASSWORD, firma JWT directo con JWT_SECRET.
 *
 * Uso:
 *   $env:DATABASE_URL=...; npm run dev   # en una terminal aparte
 *   node --env-file=.env.local scripts/smoke-test-kanban.mjs
 *   (opcional) $env:SMOKE_PASSWORD=...
 */

const BASE_URL = "http://localhost:3000";
const TENANT_SLUG = "demo";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || "admin@demo.salamandra";
const ADMIN_PASSWORD = process.env.SMOKE_PASSWORD || null;

const PREFIX = "smoke-kanban";

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

async function httpJson(method, urlPath, body, extraHeaders) {
  const headers = { "Content-Type": "application/json", ...(extraHeaders || {}) };
  if (cookies) headers.Cookie = cookies;
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method, headers, body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* */ }
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
  projectId: null,
  columnIds: [], // [col0..col3]
  taskIds: [],   // creadas en step 4
  teamMemberIds: [], // hasta 2 para asignar
};

// ── Login ──────────────────────────────────────────────────────────────────
async function login() {
  header("Login admin demo");
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
    // El middleware.js inyecta x-user-id a partir de `payload.userId` (NO `sub`).
    // Patrón alineado con app/api/auth/login y los smokes de nutricion.
    const token = await signAccessToken({
      userId: admin.id,
      email: admin.email,
      role: admin.role,
      tenantSlug: TENANT_SLUG,
      tokenVersion: admin.tokenVersion,
    });
    cookies = `access_token=${token}`;
    pass("JWT firmado directo (sin password)"); counts.pass++;
    return true;
  } catch (e) {
    log(`  ✗ JWT directo falló: ${e.message}`);
    counts.skipped++;
    return false;
  }
}

// ── 1. Health ──────────────────────────────────────────────────────────────
async function step1Health() {
  header("1) Health + tablas Sprint 2 accesibles");
  let r;
  try { r = await fetch(`${BASE_URL}/api/auth/me`); }
  catch (e) { throw new Error(`Dev server no responde (${e.message})`); }
  assertOk(r.status === 200 || r.status === 401, "GET /api/auth/me responde", `status=${r.status}`);

  const { sequelize } = await getModels(TENANT_SLUG);
  for (const t of ["projects", "tasks", "task_assignees", "board_columns", "project_members"]) {
    const [rows] = await sequelize.query(`SELECT COUNT(*)::int AS n FROM crm_${TENANT_SLUG}.${t}`);
    assertOk(typeof rows[0].n === "number", `Tabla crm_${TENANT_SLUG}.${t} accesible`);
  }
}

// ── 2. Cleanup pre-run ─────────────────────────────────────────────────────
async function step2Cleanup() {
  header("2) Cleanup pre-run de proyectos smoke");
  const { sequelize } = await getModels(TENANT_SLUG);
  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.projects WHERE name LIKE :p`,
    { replacements: { p: `${PREFIX}-%` } }
  );
  pass("Pre-cleanup completado");
  counts.pass++;
}

// ── 3. Crear proyecto ──────────────────────────────────────────────────────
async function step3CreateProject() {
  header("3) POST /api/projects → crea proyecto smoke");
  const name = `${PREFIX}-${Date.now()}`;
  const r = await httpJson("POST", "/api/projects", {
    name,
    description: "Proyecto smoke Kanban",
    status: "active",
    priority: "medium",
  });
  assertOk(r.ok, `POST /projects status=${r.status}`);
  assertOk(r.json?.data?.id, "Devuelve project.id");
  state.projectId = r.json.data.id;

  const detail = await httpJson("GET", `/api/projects/${state.projectId}`);
  assertOk(detail.ok, "GET /projects/[id] responde");
  const cols = (detail.json?.data?.boardColumns ?? []).sort((a, b) => a.order - b.order);
  assertOk(cols.length === 4, "Proyecto tiene 4 columnas por defecto", `len=${cols.length}`);
  state.columnIds = cols.map((c) => c.id);
}

// ── 4. Crear 4 tasks ───────────────────────────────────────────────────────
async function step4CreateTasks() {
  header("4) POST /projects/[id]/tasks (4 tasks)");
  const { models } = await getModels(TENANT_SLUG);
  const tms = await models.TeamMember.findAll({ limit: 2 });
  state.teamMemberIds = tms.map((t) => t.id);
  log(`  · ${state.teamMemberIds.length} team_members localizados`);

  for (let i = 0; i < 4; i++) {
    const r = await httpJson("POST", `/api/projects/${state.projectId}/tasks`, {
      boardColumnId: state.columnIds[0],
      title: `${PREFIX} Task ${i + 1}`,
      tags: i % 2 === 0 ? ["smoke"] : ["smoke", "alt"],
      assigneeIds: i < 2 ? state.teamMemberIds.slice(0, 1) : [],
    });
    assertOk(r.ok, `POST task ${i + 1} status=${r.status}`);
    assertOk(r.json?.data?.id, `Task ${i + 1} devuelve id`);
    assertOk(r.json?.data?.order === i, `Task ${i + 1} order=${i}`, `got=${r.json?.data?.order}`);
    state.taskIds.push(r.json.data.id);
  }
}

// ── 5. PATCH task ──────────────────────────────────────────────────────────
async function step5PatchTask() {
  header("5) PATCH /tasks/[id] — edit title + tags + assignees");
  const taskId = state.taskIds[0];
  const r = await httpJson("PATCH", `/api/tasks/${taskId}`, {
    title: `${PREFIX} Task 1 EDITADA`,
    tags: ["smoke", "edited"],
    assigneeIds: state.teamMemberIds,
  });
  assertOk(r.ok, `PATCH status=${r.status}`);
  assertOk(r.json?.data?.title === `${PREFIX} Task 1 EDITADA`, "Title actualizado");
  assertOk((r.json?.data?.tags ?? []).includes("edited"), "Tag 'edited' presente");
  assertOk((r.json?.data?.assignees ?? []).length === state.teamMemberIds.length, "Assignees sustituidos");
}

// ── 6. Move task a otra columna ────────────────────────────────────────────
async function step6MoveTask() {
  header("6) PATCH /tasks/[id]/move — task1 col0→col1 final");
  const taskId = state.taskIds[0];
  const r = await httpJson("PATCH", `/api/tasks/${taskId}/move`, {
    targetBoardColumnId: state.columnIds[1],
    targetOrder: 0,
  });
  assertOk(r.ok, `Move status=${r.status}`);
  assertOk(r.json?.data?.boardColumnId === state.columnIds[1], "Tarea ahora en col1");
  assertOk(r.json?.data?.order === 0, "Order=0 en destino");
}

// ── 7. Move otra task a col1 al inicio (force shift) ───────────────────────
async function step7MoveShift() {
  header("7) PATCH /tasks/[id]/move — task2 col0→col1 inicio (force shift)");
  const taskId = state.taskIds[1];
  const r = await httpJson("PATCH", `/api/tasks/${taskId}/move`, {
    targetBoardColumnId: state.columnIds[1],
    targetOrder: 0,
  });
  assertOk(r.ok, `Move status=${r.status}`);
  assertOk(r.json?.data?.order === 0, "Task2 ahora en col1.order=0");

  // Comprobar que task1 ahora está en order=1
  const detail = await httpJson("GET", `/api/tasks/${state.taskIds[0]}`);
  assertOk(detail.ok && detail.json?.data?.order === 1, "Task1 desplazada a order=1", `got=${detail.json?.data?.order}`);
}

// ── 8. Reorder dentro de col1 ──────────────────────────────────────────────
async function step8ReorderTasks() {
  header("8) PATCH /columns/[colId]/reorder-tasks — invertir orden");
  const col1 = state.columnIds[1];
  // Listamos las tareas de col1
  const listR = await httpJson("GET", `/api/projects/${state.projectId}/tasks?boardColumnId=${col1}`);
  assertOk(listR.ok, "List tasks col1 ok");
  const inCol = listR.json?.data?.tasks ?? [];
  assertOk(inCol.length === 2, "Col1 tiene 2 tasks", `len=${inCol.length}`);
  // Invertir
  const order = inCol.slice().reverse().map((t, i) => ({ id: t.id, order: i }));
  const r = await httpJson(
    "PATCH",
    `/api/projects/${state.projectId}/columns/${col1}/reorder-tasks`,
    { order }
  );
  assertOk(r.ok, `Reorder status=${r.status}`);
  assertOk(r.json?.data?.items?.[0]?.id === order[0].id, "Primera tarea ahora es la previa última");
}

// ── 9. GET /board ──────────────────────────────────────────────────────────
async function step9GetBoard() {
  header("9) GET /projects/[id]/board — vista agregada");
  const r = await httpJson("GET", `/api/projects/${state.projectId}/board`);
  assertOk(r.ok, `Board status=${r.status}`);
  const cols = r.json?.data?.columns ?? [];
  assertOk(cols.length === 4, "Board devuelve 4 columnas");
  const col0Count = cols.find((c) => c.id === state.columnIds[0])?.tasks.length;
  const col1Count = cols.find((c) => c.id === state.columnIds[1])?.tasks.length;
  assertOk(col0Count === 2, "Col0 tiene 2 tasks", `got=${col0Count}`);
  assertOk(col1Count === 2, "Col1 tiene 2 tasks", `got=${col1Count}`);
}

// ── 10. Filtro por assignee ────────────────────────────────────────────────
async function step10FilterAssignee() {
  header("10) GET /tasks?assigneeId=... — filtro funciona");
  if (state.teamMemberIds.length === 0) {
    log("  · sin team_members, skip");
    counts.skipped++; return;
  }
  const tmId = state.teamMemberIds[0];
  const r = await httpJson("GET", `/api/projects/${state.projectId}/tasks?assigneeId=${tmId}`);
  assertOk(r.ok, `Filter status=${r.status}`);
  // Task1 (editada) tiene a tmId entre asignados; Task1 estaba originalmente con tmId también.
  const got = r.json?.data?.tasks ?? [];
  assertOk(got.length >= 1, "Devuelve ≥ 1 task con assignee", `got=${got.length}`);
}

// ── 11. DELETE task con recompactación ─────────────────────────────────────
async function step11DeleteTask() {
  header("11) DELETE /tasks/[id] — borra task2 (col0.order=2)");
  // En col0 quedan task3 y task4 (porque task1 y task2 las movimos a col1)
  // task3 está en order=0, task4 en order=1
  // Borramos task3 → task4 debe quedar en order=0
  const taskToDelete = state.taskIds[2];
  const r = await httpJson("DELETE", `/api/tasks/${taskToDelete}`);
  assertOk(r.status === 204 || r.ok, `DELETE status=${r.status}`);
  const remainingR = await httpJson("GET", `/api/projects/${state.projectId}/tasks?boardColumnId=${state.columnIds[0]}`);
  const remaining = remainingR.json?.data?.tasks ?? [];
  assertOk(remaining.length === 1, "Col0 ahora con 1 task", `len=${remaining.length}`);
  assertOk(remaining[0].order === 0, "Task superviviente compactada a order=0", `got=${remaining[0].order}`);
}

// ── 12. AuditLog ───────────────────────────────────────────────────────────
async function step12AuditLog() {
  header("12) AuditLog tiene entradas del flujo");
  const { getMasterModels } = await import("../lib/db/masterDb.js");
  const { AuditLog, Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    log("  · tenant no encontrado, skip");
    counts.skipped++;
    return;
  }
  for (const action of ["task.created", "task.updated", "task.moved", "task.deleted", "project.column.tasks_reordered"]) {
    const c = await AuditLog.count({ where: { tenantId: tenant.id, action } });
    assertOk(c > 0, `AuditLog tiene ≥1 ${action}`, `count=${c}`);
  }
}

// ── 13. Cleanup ────────────────────────────────────────────────────────────
async function step13Cleanup() {
  header("13) Cleanup proyecto smoke");
  const { sequelize } = await getModels(TENANT_SLUG);
  await sequelize.query(
    `DELETE FROM crm_${TENANT_SLUG}.projects WHERE id = :id`,
    { replacements: { id: state.projectId } }
  );
  pass("Proyecto y dependencias borradas");
  counts.pass++;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Smoke: Sprint 2 Proyectos (Kanban)                  \n");
  process.stdout.write("════════════════════════════════════════════════════\n");
  process.stdout.write(`\n  BASE_URL=${BASE_URL}  TENANT=${TENANT_SLUG}\n`);

  try {
    await step1Health();
    await step2Cleanup();
    const logged = await login();
    if (!logged) {
      log("\n  ✗ Sin auth no se pueden ejercitar endpoints autenticados. Aborto.");
      process.exit(1);
    }
    await step3CreateProject();
    await step4CreateTasks();
    await step5PatchTask();
    await step6MoveTask();
    await step7MoveShift();
    await step8ReorderTasks();
    await step9GetBoard();
    await step10FilterAssignee();
    await step11DeleteTask();
    await step12AuditLog();
    await step13Cleanup();
  } catch (e) {
    // Contar el corte como fallo (18/08/2026). Antes solo se imprimía, y como
    // el código de salida sale de `counts.fail`, reventar en el primer paso
    // —el servidor apagado, sin ir más lejos— terminaba en VERDE: «pass=0
    // fail=0» y salida 0. Una prueba que no ha podido probar nada no puede
    // decir que todo está bien; es peor que una que falla, porque no avisa.
    counts.fail++;
    process.stderr.write(`\n  ✗ Falló: ${e.message}\n`);
  } finally {
    process.stdout.write("\n════════════════════════════════════════════════════\n");
    process.stdout.write(` Resultado: pass=${counts.pass} fail=${counts.fail} skipped=${counts.skipped}\n`);
    process.stdout.write("════════════════════════════════════════════════════\n\n");
    // Cerrar conexiones
    try {
      const { closeAllConnections } = await import("../lib/db/tenantDb.js");
      await closeAllConnections();
    } catch {}
    process.exit(counts.fail > 0 ? 1 : 0);
  }
}

main().catch((e) => {
  process.stderr.write(`\n  ✗ Error inesperado: ${e.message}\n${e.stack}\n`);
  process.exit(1);
});
