// Smoke F2 — 14 pasos sobre el sprint F2 del módulo Training (Fase 0 + A).
// Ejecutar con: node --env-file=.env.local scripts/smoke-training-f2.mjs
//
// Hace TODA la batería contra http://localhost:3000 + crm_demo, firma JWT
// como admin@demo.salamandra y verifica BD vía pg.

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
  return {
    Cookie: `access_token=${TOKEN}`,
    ...extra,
  };
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
  try { json = JSON.parse(text); } catch { /* texto plano */ }
  return { status: res.status, headers: res.headers, body: json ?? text };
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

async function downloadBytes(path) {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    return { status: res.status, body: await res.text() };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, contentType: res.headers.get("content-type"), buffer: buf };
}

// ───── BD ───────────────────────────────────────────────────────────────────

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

async function sql(q, params = []) {
  const r = await db.query(q, params);
  return r.rows;
}

// ───── Excel builders ───────────────────────────────────────────────────────

async function buildExcelF2() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Empleados");
  ws.columns = [
    { header: "Email", key: "email" },
    { header: "Nombre", key: "nombre" },
    { header: "Fecha_nacimiento", key: "fecha_nacimiento" },
  ];
  ws.addRow(["smoke-a@f2.com", "Ana", "12-05-1985"]);
  ws.addRow(["smoke-b@f2.com", "Bea", "1990-11-23"]);
  ws.addRow(["noesvalido", "Carlos", "01-01-1980"]);
  ws.addRow(["smoke-d@f2.com", "Dani", "32-13-2020"]);
  ws.addRow(["smoke-a@f2.com", "Otro", "01-01-1990"]); // dup intra-Excel
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function buildExcelF2Revisado() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Empleados");
  ws.columns = [
    { header: "Email", key: "email" },
    { header: "Nombre", key: "nombre" },
    { header: "Fecha_nacimiento", key: "fecha_nacimiento" },
  ];
  ws.addRow(["smoke-a@f2.com", "Ana Actualizada", "12-05-1985"]);
  ws.addRow(["smoke-b@f2.com", "Bea", "1990-11-23"]);
  ws.addRow(["smoke-c@f2.com", "Cesar", "01-01-1985"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ───── HOUSEKEEPING ─────────────────────────────────────────────────────────
// Si quedó basura de pruebas previas, limpiamos antes de empezar para que el
// estado inicial sea idéntico cada vez.

async function preClean() {
  await sql(`
    DELETE FROM ${SCHEMA}.course_enrollments
    WHERE training_user_id IN (
      SELECT id FROM ${SCHEMA}.training_users WHERE email IN ('smoke-a@f2.com','smoke-b@f2.com','smoke-c@f2.com','smoke-d@f2.com')
    )
  `);
  await sql(`DELETE FROM ${SCHEMA}.training_users WHERE email LIKE 'smoke-%@f2.com'`);
  await sql(`DELETE FROM ${SCHEMA}.company_courses WHERE company_id IN (SELECT id FROM ${SCHEMA}.companies WHERE external_id=99002)`);
  await sql(`DELETE FROM ${SCHEMA}.courses WHERE wc_product_id IN (99201,99202,99203)`);
  await sql(`DELETE FROM ${SCHEMA}.companies WHERE external_id=99002`);
}

// ───── Run ──────────────────────────────────────────────────────────────────

TOKEN = await makeToken();

try {
  await preClean();
  console.log("[housekeeping] limpieza previa OK");

  // ───── Paso 2: crear empresa ──────────────────────────────────────────
  let companyId;
  {
    const r = await apiJson("POST", "/api/training/companies", {
      name: "Smoke F2 SL",
      externalId: 99002,
      active: true,
    });
    const ok = r.status === 201 && r.body?.data?.name === "Smoke F2 SL";
    companyId = r.body?.data?.id;
    record(2, "POST /companies Smoke F2 SL", ok, `status=${r.status} id=${companyId}`);
    if (!ok) throw new Error("Paso 2 abortó");
  }

  // ───── Paso 3: crear 3 cursos ──────────────────────────────────────────
  const courses = {};
  {
    for (const [key, name, wc] of [["A","Curso F2 A",99201],["B","Curso F2 B",99202],["C","Curso F2 C",99203]]) {
      const r = await apiJson("POST", "/api/training/courses", { name, wcProductId: wc, active: true });
      if (r.status !== 201 || !r.body?.data?.id) {
        record(3, `POST /courses ${key}`, false, `status=${r.status} body=${JSON.stringify(r.body)}`);
        throw new Error(`Paso 3 (${key}) abortó`);
      }
      courses[key] = r.body.data.id;
    }
    record(3, "POST /courses A+B+C", true, `ids=${Object.values(courses).join(",")}`);
  }

  // ───── Paso 4: bulk A+B propagate=false ───────────────────────────────
  {
    const r = await apiJson(
      "POST",
      `/api/training/companies/${companyId}/courses/bulk`,
      { courseIds: [courses.A, courses.B], propagateToActive: false }
    );
    const dataOk =
      r.status === 200 &&
      r.body?.data?.companyId === companyId &&
      Array.isArray(r.body.data.added) &&
      r.body.data.added.length === 2 &&
      r.body.data.added.every((a) => a.wasNew === true) &&
      r.body.data.propagated === null;
    const dbRows = await sql(`SELECT course_id FROM ${SCHEMA}.company_courses WHERE company_id=$1`, [companyId]);
    const dbOk = dbRows.length === 2;
    record(4, "POST /bulk A+B (propagate=false)", dataOk && dbOk, `status=${r.status} added=${r.body?.data?.added?.length} dbRows=${dbRows.length}`);
  }

  // ───── Paso 5: generar Excel ──────────────────────────────────────────
  let excelF2, excelF2Rev;
  {
    excelF2 = await buildExcelF2();
    excelF2Rev = await buildExcelF2Revisado();
    record(5, "Generación Excel f2 y f2_revisado", excelF2.length > 1000 && excelF2Rev.length > 1000, `sizes=${excelF2.length},${excelF2Rev.length}`);
  }

  // ───── Paso 6: /preview NO escribe ─────────────────────────────────────
  {
    const beforeCount = parseInt((await sql(`SELECT COUNT(*) FROM ${SCHEMA}.training_users`))[0].count);
    const r = await apiUpload(`/api/training/users/import/preview?companyId=${companyId}`, excelF2, "smoke_f2.xlsx");
    const afterCount = parseInt((await sql(`SELECT COUNT(*) FROM ${SCHEMA}.training_users`))[0].count);
    const body = r.body?.data ?? r.body;
    const dataOk =
      r.status === 200 &&
      body?.totalRows === 5 &&
      body?.valid === 2 &&
      body?.newCount === 2 &&
      body?.updateCount === 0 &&
      Array.isArray(body?.errors) &&
      body.errors.length === 3 &&
      body.errors.every((e) => e && "row" in e && "field" in e && "value" in e && "error" in e);
    const dbOk = beforeCount === afterCount;
    record(6, "/preview no escribe + contadores", dataOk && dbOk,
      `status=${r.status} totalRows=${body?.totalRows} valid=${body?.valid} new=${body?.newCount} upd=${body?.updateCount} errors=${body?.errors?.length} dbDelta=${afterCount-beforeCount}`);
  }

  // ───── Paso 7: /import REAL ───────────────────────────────────────────
  {
    const r = await apiUpload(`/api/training/users/import?companyId=${companyId}`, excelF2, "smoke_f2.xlsx");
    const body = r.body?.data ?? r.body;
    const dataOk =
      r.status === 200 &&
      body?.imported === 2 &&
      body?.updated === 0 &&
      body?.skipped >= 3;
    const dbRows = await sql(`SELECT email, active, type, company_id FROM ${SCHEMA}.training_users WHERE email LIKE 'smoke-%@f2.com' ORDER BY email`);
    const dbOk =
      dbRows.length === 2 &&
      dbRows.every((u) => u.active === false && u.type === "company" && u.company_id === companyId);
    record(7, "/import REAL con companyId", dataOk && dbOk,
      `status=${r.status} imported=${body?.imported} updated=${body?.updated} skipped=${body?.skipped} dbUsers=${dbRows.length}`);
  }

  // ───── Paso 8: /import revisado (update + new) ────────────────────────
  {
    const r = await apiUpload(`/api/training/users/import?companyId=${companyId}`, excelF2Rev, "smoke_f2_revisado.xlsx");
    const body = r.body?.data ?? r.body;
    const dataOk =
      r.status === 200 &&
      body?.imported === 1 &&
      body?.updated >= 1;
    const smokeA = (await sql(`SELECT name, active FROM ${SCHEMA}.training_users WHERE email='smoke-a@f2.com'`))[0];
    const smokeC = (await sql(`SELECT email, active FROM ${SCHEMA}.training_users WHERE email='smoke-c@f2.com'`))[0];
    const dbOk = smokeA?.name === "Ana Actualizada" && smokeA?.active === false && !!smokeC && smokeC.active === false;
    record(8, "/import revisado (smoke-a update + smoke-c new)", dataOk && dbOk,
      `status=${r.status} imported=${body?.imported} updated=${body?.updated} smokeA.name="${smokeA?.name}" smokeA.active=${smokeA?.active} smokeC.active=${smokeC?.active}`);
  }

  // ───── Paso 9: activar smoke-a via register/empresa ────────────────────
  {
    const res = await fetch(`${BASE}/api/usuarios/register/empresa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant": TENANT_SLUG },
      body: JSON.stringify({ email: "smoke-a@f2.com" }),
    });
    const body = await res.json();
    const productIds = body?.product_ids ?? [];
    const dataOk = res.status === 200 && body?.exists === true && productIds.includes(99201) && productIds.includes(99202) && productIds.length === 2;
    const smokeA = (await sql(`SELECT id, active FROM ${SCHEMA}.training_users WHERE email='smoke-a@f2.com'`))[0];
    const enrolls = await sql(`SELECT course_id FROM ${SCHEMA}.course_enrollments WHERE training_user_id=$1`, [smokeA?.id]);
    const dbOk = smokeA?.active === true && enrolls.length === 2;
    record(9, "register/empresa activa smoke-a", dataOk && dbOk,
      `status=${res.status} product_ids=[${productIds.join(",")}] active=${smokeA?.active} enrollments=${enrolls.length}`);
  }

  // ───── Paso 10: bulk C propagate=true ──────────────────────────────────
  {
    const r = await apiJson(
      "POST",
      `/api/training/companies/${companyId}/courses/bulk`,
      { courseIds: [courses.C], propagateToActive: true }
    );
    const body = r.body?.data ?? r.body;
    const dataOk =
      r.status === 200 &&
      body?.added?.length === 1 &&
      body?.added[0]?.wasNew === true &&
      body?.propagated?.users === 1 &&
      body?.propagated?.totalEnrollmentsCreated === 1;
    const smokeA = (await sql(`SELECT id FROM ${SCHEMA}.training_users WHERE email='smoke-a@f2.com'`))[0];
    const enrolls = await sql(`SELECT course_id FROM ${SCHEMA}.course_enrollments WHERE training_user_id=$1`, [smokeA?.id]);
    const dbOk = enrolls.length === 3;
    record(10, "bulk C propagate=true", dataOk && dbOk,
      `status=${r.status} added=${body?.added?.length} propUsers=${body?.propagated?.users} newEnroll=${body?.propagated?.totalEnrollmentsCreated} dbEnrollSmokeA=${enrolls.length}`);
  }

  // ───── Paso 11: PATCH empresa ──────────────────────────────────────────
  {
    const r = await apiJson("PATCH", `/api/training/companies/${companyId}`, { name: "Smoke F2 SL Actualizada" });
    const body = r.body?.data ?? r.body;
    const dataOk = r.status === 200 && body?.name === "Smoke F2 SL Actualizada";
    const row = (await sql(`SELECT name FROM ${SCHEMA}.companies WHERE id=$1`, [companyId]))[0];
    const dbOk = row?.name === "Smoke F2 SL Actualizada";
    record(11, "PATCH /companies/[id] name", dataOk && dbOk, `status=${r.status} dbName="${row?.name}"`);
  }

  // ───── Paso 12: DELETE empresa ─────────────────────────────────────────
  {
    const usersBefore = parseInt((await sql(
      `SELECT COUNT(*) FROM ${SCHEMA}.training_users WHERE company_id=$1`,
      [companyId]
    ))[0].count);
    const r = await apiJson("DELETE", `/api/training/companies/${companyId}`);
    const okStatus = r.status === 204 || r.status === 200;
    const row = (await sql(`SELECT active FROM ${SCHEMA}.companies WHERE id=$1`, [companyId]))[0];
    const usersAfter = parseInt((await sql(
      `SELECT COUNT(*) FROM ${SCHEMA}.training_users WHERE company_id=$1`,
      [companyId]
    ))[0].count);
    const dbOk = row?.active === false && usersBefore === usersAfter && usersBefore === 3;
    record(12, "DELETE /companies/[id] soft delete", okStatus && dbOk,
      `status=${r.status} dbActive=${row?.active} usersBefore=${usersBefore} usersAfter=${usersAfter}`);
  }

  // ───── Paso 13: GET /companies (contadores) ────────────────────────────
  {
    const r = await apiJson("GET", "/api/training/companies");
    const list = r.body?.data ?? r.body;
    const ours = Array.isArray(list) ? list.find((c) => c.id === companyId) : null;
    const dataOk =
      r.status === 200 &&
      ours &&
      ours.name === "Smoke F2 SL Actualizada" &&
      ours.active === false &&
      ours.activeCount === 1 &&
      ours.pendingCount === 2 &&
      ours.userCount === 1 &&
      ours.courseCount === 3;
    record(13, "GET /companies contadores Smoke F2 SL", dataOk,
      `name="${ours?.name}" active=${ours?.active} activeC=${ours?.activeCount} pendingC=${ours?.pendingCount} userC=${ours?.userCount} courseC=${ours?.courseCount}`);
  }

  // ───── Paso 14: GET /template ─────────────────────────────────────────
  {
    const r = await downloadBytes("/api/training/users/import/template");
    const okStatus = r.status === 200 && (r.contentType || "").includes("spreadsheetml");
    let columnsOk = false;
    let instructionsOk = false;
    let headerColorOk = false;
    if (okStatus) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(r.buffer);
      const ws1 = wb.worksheets[0];
      const ws2 = wb.worksheets[1];
      const h1 = ws1?.getCell("A1").value;
      const h2 = ws1?.getCell("B1").value;
      const h3 = ws1?.getCell("C1").value;
      columnsOk = h1 === "Email" && h2 === "Nombre" && (h3 === "Fecha_nacimiento" || h3 === "fecha_nacimiento");
      instructionsOk = !!ws2 && (ws2.name === "Instrucciones");
      const fillCell = ws1?.getCell("A1");
      const argb = fillCell?.fill?.fgColor?.argb || "";
      headerColorOk = argb.toUpperCase().endsWith("174792");
    }
    record(14, "GET /template (3 cols + Instrucciones + #174792)", okStatus && columnsOk && instructionsOk && headerColorOk,
      `status=${r.status} cols=${columnsOk} instr=${instructionsOk} color=${headerColorOk}`);
  }

  // ───── Resumen final ──────────────────────────────────────────────────
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
    console.log("Todos los pasos OK. Backend listo para UI.");
  }
} catch (e) {
  console.error("ERROR FATAL:", e.message, e.stack);
  process.exitCode = 2;
} finally {
  await db.end();
}
