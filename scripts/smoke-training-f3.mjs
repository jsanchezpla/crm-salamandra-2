// Smoke F3 — 13 pasos sobre el sprint F3 del módulo Training.
//
// Ejecutar con: node --env-file=.env.local scripts/smoke-training-f3.mjs
//
// SOLO contra crm_demo (no toca crm_retorika ni producción).
// Firma JWT como admin@demo.salamandra, valida BD vía pg, limpia al final
// con un bloque SQL documentado (no ejecutado).

import { SignJWT } from "jose";
import ExcelJS from "exceljs";
import pg from "pg";

const BASE = "http://localhost:3000";
const TENANT_SLUG = "demo";
const SCHEMA = "crm_demo";
const ADMIN_USER_ID = "701eabc2-1cf1-4f7f-bec8-ce812ca985b2";
const ADMIN_EMAIL = "admin@demo.salamandra";
const ADMIN_ROLE = "admin";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
if (!process.env.JWT_SECRET) {
  console.error("FALTA JWT_SECRET en env");
  process.exit(2);
}

// ───── helpers ──────────────────────────────────────────────────────────────

const results = [];
function record(step, label, passed, detail) {
  results.push({ step, label, passed, detail });
  const icon = passed ? "OK " : "FAIL";
  console.log(`[${icon}] Paso ${step} — ${label}${detail ? "  ::  " + detail : ""}`);
}

async function makeToken() {
  return await new SignJWT({
    userId: ADMIN_USER_ID,
    email: ADMIN_EMAIL,
    role: ADMIN_ROLE,
    tenantSlug: TENANT_SLUG,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(JWT_SECRET);
}

let TOKEN;
function authHeaders(extra = {}) {
  return { Cookie: `access_token=${TOKEN}`, ...extra };
}

async function apiJson(method, path, body) {
  const headers = authHeaders({ "Content-Type": "application/json" });
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json ?? text };
}

async function apiUpload(path, buffer, filename) {
  const fd = new FormData();
  fd.append("file", new Blob([buffer]), filename);
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json ?? text };
}

// ───── BD ───────────────────────────────────────────────────────────────────

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

async function sql(q, params = []) {
  const r = await db.query(q, params);
  return r.rows;
}

// ───── Excel builder ────────────────────────────────────────────────────────

async function buildExcelF3() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Empleados");
  ws.columns = [
    { header: "Email", key: "email" },
    { header: "Nombre", key: "nombre" },
    { header: "Fecha_nacimiento", key: "fecha_nacimiento" },
  ];
  ws.addRow(["smoke-a@f3.com", "Ana F3", "12-05-1985"]);
  ws.addRow(["smoke-b@f3.com", "Beto F3", "20-08-1990"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ───── HOUSEKEEPING ─────────────────────────────────────────────────────────

async function preClean() {
  await sql(`
    DELETE FROM ${SCHEMA}.course_enrollments
    WHERE training_user_id IN (
      SELECT id FROM ${SCHEMA}.training_users WHERE email LIKE 'smoke-%@f3.com'
    )
  `);
  await sql(`DELETE FROM ${SCHEMA}.training_users WHERE email LIKE 'smoke-%@f3.com'`);
  await sql(`DELETE FROM ${SCHEMA}.company_courses WHERE company_id IN (SELECT id FROM ${SCHEMA}.companies WHERE external_id=99003)`);
  await sql(`DELETE FROM ${SCHEMA}.courses WHERE name='Smoke F3 Curso'`);
  await sql(`DELETE FROM ${SCHEMA}.companies WHERE external_id=99003`);
  await sql(`DELETE FROM ${SCHEMA}.training_sync_log WHERE payload->>'smokeTag' = 'smoke-f3'`);
}

// ───── Run ──────────────────────────────────────────────────────────────────

TOKEN = await makeToken();

try {
  await preClean();
  console.log("[housekeeping] limpieza previa OK");

  // ── Paso 1: crear empresa ────────────────────────────────────────────────
  let companyId;
  {
    const r = await apiJson("POST", "/api/training/companies", {
      name: "Smoke F3 SL",
      externalId: 99003,
      active: true,
    });
    const ok = r.status === 201 && r.body?.data?.id;
    companyId = r.body?.data?.id;
    record(1, "POST /companies Smoke F3 SL", ok, `status=${r.status} id=${companyId}`);
    if (!ok) throw new Error("Paso 1 abortó");
  }

  // ── Paso 2: crear curso ──────────────────────────────────────────────────
  let courseId;
  {
    const r = await apiJson("POST", "/api/training/courses", {
      name: "Smoke F3 Curso",
      wcProductId: 99301,
      active: true,
    });
    const ok = r.status === 201 && r.body?.data?.id;
    courseId = r.body?.data?.id;
    record(2, "POST /courses Smoke F3 Curso", ok, `status=${r.status} id=${courseId}`);
  }

  // ── Paso 3: asignar curso a empresa ──────────────────────────────────────
  {
    const r = await apiJson("POST", `/api/training/companies/${companyId}/courses/bulk`, {
      courseIds: [courseId],
      propagateToActive: false,
    });
    const ok = r.status === 200 && r.body?.data?.added?.length === 1;
    record(3, "POST /companies/:id/courses/bulk", ok, `status=${r.status}`);
  }

  // ── Paso 4: importar Excel con 2 empleados ───────────────────────────────
  const excelBuf = await buildExcelF3();
  let empleadoAId, empleadoBId;
  {
    const r = await apiUpload(`/api/training/users/import?companyId=${companyId}`, excelBuf, "smoke_f3.xlsx");
    const body = r.body?.data ?? r.body;
    const ok = r.status === 200 && body?.imported === 2;
    const rows = await sql(`SELECT id, email, active, archived_at FROM ${SCHEMA}.training_users WHERE email LIKE 'smoke-%@f3.com' ORDER BY email`);
    empleadoAId = rows.find((u) => u.email === "smoke-a@f3.com")?.id;
    empleadoBId = rows.find((u) => u.email === "smoke-b@f3.com")?.id;
    const dbOk = rows.length === 2 && rows.every((u) => u.active === false && u.archived_at === null);
    record(4, "/import 2 empleados → pendientes, no archivados", ok && dbOk, `imported=${body?.imported} rows=${rows.length}`);
  }

  // ── Paso 5: archivar empleado A ──────────────────────────────────────────
  {
    const r = await apiJson("DELETE", `/api/training/users/${empleadoAId}`);
    const okStatus = r.status === 204 || r.status === 200;
    const row = (await sql(`SELECT archived_at FROM ${SCHEMA}.training_users WHERE id=$1`, [empleadoAId]))[0];
    const dbOk = row?.archived_at !== null;
    record(5, "DELETE /users/:id → archivedAt set", okStatus && dbOk, `status=${r.status} archived_at=${row?.archived_at}`);
  }

  // ── Paso 6: GET listado por defecto → solo el no archivado ───────────────
  {
    const r = await apiJson("GET", `/api/training/users?companyId=${companyId}&type=company&limit=200`);
    const users = r.body?.data?.users ?? [];
    const ok = r.status === 200 && users.length === 1 && users[0].id === empleadoBId;
    record(6, "GET /users (default) → solo no archivados", ok, `total=${users.length} idA=${empleadoAId} idB=${empleadoBId}`);
  }

  // ── Paso 7: GET con ?includeArchived=true → ambos ─────────────────────────
  {
    const r = await apiJson("GET", `/api/training/users?companyId=${companyId}&type=company&limit=200&includeArchived=true`);
    const users = r.body?.data?.users ?? [];
    const ok = r.status === 200 && users.length === 2;
    record(7, "GET /users ?includeArchived=true → ambos", ok, `total=${users.length}`);
  }

  // ── Paso 8: /register/empresa con email archivado → exists=false ──────────
  {
    const res = await fetch(`${BASE}/api/usuarios/register/empresa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant": TENANT_SLUG },
      body: JSON.stringify({ email: "smoke-a@f3.com" }),
    });
    const body = await res.json();
    const ok = res.status === 403 && body?.exists === false;
    record(8, "register/empresa con archivado → exists=false", ok, `status=${res.status} exists=${body?.exists}`);
  }

  // ── Paso 9: re-importar Excel reactiva A ──────────────────────────────────
  {
    const r = await apiUpload(`/api/training/users/import?companyId=${companyId}`, excelBuf, "smoke_f3.xlsx");
    const body = r.body?.data ?? r.body;
    const row = (await sql(`SELECT archived_at FROM ${SCHEMA}.training_users WHERE id=$1`, [empleadoAId]))[0];
    const ok = r.status === 200 && body?.updated >= 1 && row?.archived_at === null;
    record(9, "/import reactiva archivado (archivedAt=null)", ok, `updated=${body?.updated} archived_at_post=${row?.archived_at}`);
  }

  // ── Paso 10: /register/empresa con A reactivado → exists=true ────────────
  {
    const res = await fetch(`${BASE}/api/usuarios/register/empresa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant": TENANT_SLUG },
      body: JSON.stringify({ email: "smoke-a@f3.com" }),
    });
    const body = await res.json();
    const row = (await sql(`SELECT active FROM ${SCHEMA}.training_users WHERE id=$1`, [empleadoAId]))[0];
    const ok = res.status === 200 && body?.exists === true && row?.active === true;
    record(10, "register/empresa tras reactivar → exists=true + active=true", ok, `status=${res.status} exists=${body?.exists} active=${row?.active}`);
  }

  // ── Paso 11: PATCH curso → nombre nuevo ──────────────────────────────────
  {
    const r = await apiJson("PATCH", `/api/training/courses/${courseId}`, {
      name: "Smoke F3 Curso Renombrado",
      wpCourseId: 12345,
    });
    const body = r.body?.data ?? r.body;
    const row = (await sql(`SELECT name, wp_course_id FROM ${SCHEMA}.courses WHERE id=$1`, [courseId]))[0];
    const ok = r.status === 200 && body?.name === "Smoke F3 Curso Renombrado" &&
               row?.name === "Smoke F3 Curso Renombrado" && row?.wp_course_id === 12345;
    record(11, "PATCH /courses/:id (name + wpCourseId)", ok, `status=${r.status} dbName="${row?.name}" wpId=${row?.wp_course_id}`);
  }

  // ── Paso 12: insertar fila en sync log + GET /sync-status ────────────────
  {
    await sql(`
      INSERT INTO ${SCHEMA}.training_sync_log (source, synced_at, items_synced, items_deactivated, items_failed, payload)
      VALUES ('wp_tutor_courses', NOW(), 7, 1, 0, $1::jsonb)
    `, [JSON.stringify({ smokeTag: "smoke-f3", synced: 7, deactivated: 1 })]);

    const r = await apiJson("GET", "/api/training/sync-status");
    const data = r.body?.data;
    const ok = r.status === 200 && data?.tenantSlug === TENANT_SLUG &&
               data?.lastSync && data.lastSync.itemsSynced === 7 &&
               data.lastSync.itemsDeactivated === 1 &&
               data.lastSync.source === "wp_tutor_courses";
    record(12, "GET /sync-status devuelve última sync", ok,
      `status=${r.status} synced=${data?.lastSync?.itemsSynced} deactivated=${data?.lastSync?.itemsDeactivated} enabled=${data?.syncEnabled}`);
  }

  // ── Paso 13: restore de empleado B (que sigue activo, sin tocar) ─────────
  // Cobertura del restore: archivamos B y luego lo restauramos vía endpoint.
  {
    await apiJson("DELETE", `/api/training/users/${empleadoBId}`);
    const r = await apiJson("POST", `/api/training/users/${empleadoBId}/restore`);
    const row = (await sql(`SELECT archived_at FROM ${SCHEMA}.training_users WHERE id=$1`, [empleadoBId]))[0];
    const ok = r.status === 200 && row?.archived_at === null;
    record(13, "POST /users/:id/restore desarchiva", ok, `status=${r.status} archived_at=${row?.archived_at}`);
  }

  // ── Resumen final ────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log("\n──────────────────────────────────────────");
  console.log(`Resumen: ${passed} OK / ${failed} FAIL  (de ${results.length} pasos)`);
  if (failed > 0) {
    console.log("Pasos fallidos:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - Paso ${r.step}: ${r.label}  ::  ${r.detail}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Todos los pasos OK. Sprint F3 listo.");
  }

  // ── Limpieza al final (documentada, NO ejecutada) ────────────────────────
  // Si quieres limpiar manualmente tras revisar, ejecuta en psql:
  //   DELETE FROM crm_demo.course_enrollments WHERE training_user_id IN (
  //     SELECT id FROM crm_demo.training_users WHERE email LIKE 'smoke-%@f3.com'
  //   );
  //   DELETE FROM crm_demo.training_users WHERE email LIKE 'smoke-%@f3.com';
  //   DELETE FROM crm_demo.company_courses WHERE company_id IN (
  //     SELECT id FROM crm_demo.companies WHERE external_id=99003
  //   );
  //   DELETE FROM crm_demo.courses WHERE name LIKE 'Smoke F3 Curso%';
  //   DELETE FROM crm_demo.companies WHERE external_id=99003;
  //   DELETE FROM crm_demo.training_sync_log WHERE payload->>'smokeTag'='smoke-f3';
} catch (e) {
  console.error("ERROR FATAL:", e.message, e.stack);
  process.exitCode = 2;
} finally {
  await db.end();
}
