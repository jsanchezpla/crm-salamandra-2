/**
 * smoke-test-documents.mjs — Smoke HTTP del Sprint 1 del módulo Documents.
 *
 * Cubre: carpetas anidadas, ACL private/shared entre 2 usuarios, subida con
 * validación de tipo (PPTX rechazado), magic bytes (PDF falso rechazado),
 * tamaño (30 MB → 413), cuota de tenant (fichero sparse ~1 GB → 507),
 * descarga (stream/attachment), preview PDF inline (DOCX rechazado), borrado
 * de documento (archivo físico) y de carpeta (CASCADE BD + disco), y AuditLog.
 *
 * Auth: firma dos JWT directos (JWT_SECRET) para dos userIds sintéticos. Como
 * NO existen en master.users, hasModule() resuelve por tenant (módulo activo);
 * el ACL por owner usa el x-user-id, así que las visibilidades se prueban igual.
 *
 * Requiere el server: `npm run dev` en otra terminal + módulo `documents`
 * habilitado en demo (lo asegura este script; ver también db:enable:documents).
 *
 * Uso: node --env-file=.env.local scripts/smoke-test-documents.mjs
 */

import { createRequire } from "node:module";
import path from "node:path";
import { promises as fs } from "node:fs";

const BASE_URL = "http://localhost:3000";
const TENANT_SLUG = "demo";
const USER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_B = "bbbbbbbb-0000-4000-8000-000000000002";

let cookieA = "";
let cookieB = "";
const created = { folderIds: [], docIds: [], diskPaths: [] };

function log(...a) { process.stdout.write(`  ${a.join(" ")}\n`); }
function header(l) { process.stdout.write(`\n══ ${l} ${"═".repeat(Math.max(0, 58 - l.length))}\n`); }
const counts = { pass: 0, fail: 0 };
function assertOk(cond, label, detail) {
  if (cond) { process.stdout.write(`  ✓ ${label}\n`); counts.pass++; }
  else { process.stdout.write(`  ✗ ${label}${detail ? ` — ${detail}` : ""}\n`); counts.fail++; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(method, urlPath, body, cookie) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* binario/no-json */ }
  return { status: res.status, ok: res.ok, json };
}

async function httpUpload(cookie, { buffer, filename, mimeType, folderId, visibility }) {
  const fd = new FormData();
  fd.append("file", new Blob([buffer], { type: mimeType }), filename);
  if (folderId) fd.append("folderId", folderId);
  if (visibility) fd.append("visibility", visibility);
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE_URL}/api/documents`, { method: "POST", headers, body: fd });
  let json = null;
  try { json = await res.json(); } catch { /* */ }
  return { status: res.status, ok: res.ok, json };
}

// Buffers de prueba (solo importan los magic bytes; el resto es relleno).
const EXT = ".pdf";
const pdfBuf = (mb) => Buffer.concat([Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"), Buffer.alloc(mb * 1024 * 1024)]);
const docxBuf = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2048)]);
const MIME_PDF = "application/pdf";
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

async function main() {
  const require = createRequire(import.meta.url);
  const projectRoot = process.cwd();

  // ── Setup: firmar cookies + asegurar módulo + esperar caché del server ──
  header("Setup (auth + módulo activo)");
  const { signAccessToken } = await import("../lib/auth/jwt.js");
  const { getMasterModels, getMasterDb } = await import("../lib/db/masterDb.js");
  const { getUploadsRoot, TENANT_QUOTA_BYTES } = await import("../lib/documents/documentStorage.js");
  getMasterDb();
  const { Tenant, TenantModule, AuditLog, User } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug: TENANT_SLUG } });
  if (!tenant) { log(`✗ Tenant ${TENANT_SLUG} no existe`); process.exit(1); }
  // Asegurar módulo habilitado (idempotente).
  const [mod, wasCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "documents" },
    defaults: { tenantId: tenant.id, moduleKey: "documents", enabled: true, version: "1.0.0" },
  });
  if (!wasCreated && !mod.enabled) await mod.update({ enabled: true });

  // Dos usuarios REALES throwaway con acceso al módulo (para hasModule por-user
  // y para que el FK de audit_logs.user_id valide). Se borran en el cleanup.
  async function ensureUser(id, email) {
    const [u] = await User.findOrCreate({
      where: { id },
      defaults: { id, email, passwordHash: "smoke-documents-no-login", role: "admin", tenantId: tenant.id, moduleAccess: ["documents"], tokenVersion: 0 },
    });
    await u.update({ tenantId: tenant.id, moduleAccess: ["documents"] });
  }
  await ensureUser(USER_A, "smoke-a@documents.local");
  await ensureUser(USER_B, "smoke-b@documents.local");

  cookieA = `access_token=${await signAccessToken({ userId: USER_A, email: "smoke-a@documents.local", role: "admin", tenantSlug: TENANT_SLUG, tokenVersion: 0 })}`;
  cookieB = `access_token=${await signAccessToken({ userId: USER_B, email: "smoke-b@documents.local", role: "admin", tenantSlug: TENANT_SLUG, tokenVersion: 0 })}`;

  // Esperar a que el dev server vea el módulo (caché de config 60s por proceso).
  let active = false;
  for (let i = 0; i < 24; i++) {
    const r = await httpJson("GET", "/api/documents/quota", null, cookieA);
    if (r.status === 200) { active = true; break; }
    if (i === 0) log(`· quota status=${r.status}; esperando refresco de caché del server…`);
    await sleep(3000);
  }
  assertOk(active, "Módulo documents activo en el server (GET /quota 200)");
  if (!active) { await cleanup(getUploadsRoot, projectRoot); printSummary(); process.exit(1); }

  // ── 1. Empty state ──
  header("1) GET /folders (estado inicial)");
  const f0 = await httpJson("GET", "/api/documents/folders?visibility=all", null, cookieA);
  assertOk(f0.status === 200 && Array.isArray(f0.json?.data?.folders), "GET /folders 200 + array", `status=${f0.status}`);

  // ── 2. Crear carpetas ──
  header("2) Crear carpetas (private anidada + shared)");
  const contratos = await httpJson("POST", "/api/documents/folders", { name: "smoke Contratos", visibility: "private" }, cookieA);
  assertOk(contratos.status === 201 && contratos.json?.data?.level === 0, "POST Contratos (private, level 0)", `status=${contratos.status}`);
  created.folderIds.push(contratos.json?.data?.id);

  const y2026 = await httpJson("POST", "/api/documents/folders", { name: "2026", visibility: "private", parentFolderId: contratos.json?.data?.id }, cookieA);
  assertOk(y2026.status === 201 && y2026.json?.data?.level === 1, "POST 2026 (hija, level 1)", `status=${y2026.status}`);

  const facturas = await httpJson("POST", "/api/documents/folders", { name: "smoke Facturas comunes", visibility: "shared" }, cookieA);
  assertOk(facturas.status === 201 && facturas.json?.data?.visibility === "shared", "POST Facturas comunes (shared)", `status=${facturas.status}`);
  created.folderIds.push(facturas.json?.data?.id);

  // Depth guard: 4º nivel debe fallar. Construimos level 2 y 3, y el 4 rechaza.
  const lvl2 = await httpJson("POST", "/api/documents/folders", { name: "n2", visibility: "private", parentFolderId: y2026.json?.data?.id }, cookieA);
  const lvl3 = await httpJson("POST", "/api/documents/folders", { name: "n3", visibility: "private", parentFolderId: lvl2.json?.data?.id }, cookieA);
  const lvl4 = await httpJson("POST", "/api/documents/folders", { name: "n4", visibility: "private", parentFolderId: lvl3.json?.data?.id }, cookieA);
  assertOk(lvl3.status === 201 && lvl3.json?.data?.level === 3 && lvl4.status === 400, "Máx 4 niveles: level 3 OK, 5º nivel → 400", `lvl3=${lvl3.status} lvl4=${lvl4.status}`);

  // ── 3. ACL entre usuarios ──
  header("3) ACL private vs shared (userB)");
  const bPriv = await httpJson("GET", "/api/documents/folders?visibility=all", null, cookieB);
  const bNames = (bPriv.json?.data?.folders || []).map((f) => f.name);
  assertOk(!bNames.includes("smoke Contratos"), "userB NO ve la carpeta private de userA");
  assertOk(bNames.includes("smoke Facturas comunes"), "userB SÍ ve la carpeta shared");

  // ── 4. Subidas (válida + rechazos) ──
  header("4) Subidas: válida + rechazos (tipo/magic/tamaño)");
  const up = await httpUpload(cookieA, { buffer: pdfBuf(5), filename: "contrato.pdf", mimeType: MIME_PDF, folderId: contratos.json?.data?.id });
  assertOk(up.status === 201 && up.json?.data?.visibility === "private", "Upload PDF 5MB en carpeta private (hereda private)", `status=${up.status}`);
  const docId = up.json?.data?.id;
  created.docIds.push(docId);
  created.diskPaths.push(path.join(getUploadsRoot(), "documents", TENANT_SLUG, USER_A, `${docId}${EXT}`));

  const pptx = await httpUpload(cookieA, { buffer: docxBuf(), filename: "slides.pptx", mimeType: MIME_PPTX, folderId: contratos.json?.data?.id });
  assertOk(pptx.status === 400, "PPTX rechazado (400)", `status=${pptx.status}`);

  const fakePdf = await httpUpload(cookieA, { buffer: Buffer.from("no soy un pdf de verdad"), filename: "fake.pdf", mimeType: MIME_PDF, folderId: contratos.json?.data?.id });
  assertOk(fakePdf.status === 400, "PDF con magic bytes falsos rechazado (400)", `status=${fakePdf.status}`);

  const big = await httpUpload(cookieA, { buffer: pdfBuf(26), filename: "grande.pdf", mimeType: MIME_PDF, folderId: contratos.json?.data?.id });
  assertOk(big.status === 413, "Archivo >25MB rechazado (413)", `status=${big.status} err=${big.json?.error}`);

  // ── 5. Cuota de tenant (fichero sparse ~1GB) ──
  header("5) Cuota de tenant (507)");
  const sparsePath = path.join(getUploadsRoot(), "documents", TENANT_SLUG, "shared", `ffffffff-0000-4000-8000-000000000099.pdf`);
  await fs.mkdir(path.dirname(sparsePath), { recursive: true });
  const fh = await fs.open(sparsePath, "w");
  await fh.truncate(TENANT_QUOTA_BYTES); // sparse: tamaño lógico 1GB, ~0 en disco
  await fh.close();
  created.diskPaths.push(sparsePath);
  const overQuota = await httpUpload(cookieA, { buffer: pdfBuf(1), filename: "sobra.pdf", mimeType: MIME_PDF, visibility: "private" });
  assertOk(overQuota.status === 507, "Upload sobre cuota rechazado (507)", `status=${overQuota.status}`);
  await fs.unlink(sparsePath).catch(() => {});
  created.diskPaths = created.diskPaths.filter((p) => p !== sparsePath);

  // ── 6. Descarga + preview ──
  header("6) Descarga (attachment) + preview (inline)");
  const dl = await fetch(`${BASE_URL}/api/documents/${docId}/download`, { headers: { Cookie: cookieA } });
  const dlBytes = Buffer.from(await dl.arrayBuffer());
  assertOk(
    dl.status === 200 && /attachment/.test(dl.headers.get("content-disposition") || "") && dlBytes.length > 5 * 1024 * 1024,
    "Download 200 + attachment + bytes por stream",
    `status=${dl.status} len=${dlBytes.length}`
  );
  assertOk(dl.headers.get("x-content-type-options") === "nosniff", "Download con X-Content-Type-Options: nosniff");

  const pv = await fetch(`${BASE_URL}/api/documents/${docId}/preview`, { headers: { Cookie: cookieA } });
  assertOk(pv.status === 200 && /inline/.test(pv.headers.get("content-disposition") || ""), "Preview PDF 200 + inline", `status=${pv.status}`);
  assertOk((pv.headers.get("content-security-policy") || "").includes("default-src 'none'"), "Preview con CSP restrictiva");

  // Preview de un DOCX → 400.
  const upDocx = await httpUpload(cookieA, { buffer: docxBuf(), filename: "hoja.docx", mimeType: MIME_DOCX, visibility: "private" });
  created.docIds.push(upDocx.json?.data?.id);
  created.diskPaths.push(path.join(getUploadsRoot(), "documents", TENANT_SLUG, USER_A, `${upDocx.json?.data?.id}.docx`));
  const pvDocx = await fetch(`${BASE_URL}/api/documents/${upDocx.json?.data?.id}/preview`, { headers: { Cookie: cookieA } });
  assertOk(pvDocx.status === 400, "Preview de DOCX rechazado (400)", `status=${pvDocx.status}`);

  // ── 7. Borrado documento (archivo físico) ──
  header("7) DELETE documento → archivo físico borrado");
  const delDoc = await httpJson("DELETE", `/api/documents/${docId}`, null, cookieA);
  const physicalGone = await fs
    .access(path.join(getUploadsRoot(), "documents", TENANT_SLUG, USER_A, `${docId}${EXT}`))
    .then(() => false)
    .catch(() => true);
  assertOk(delDoc.status === 204 && physicalGone, "DELETE doc 204 + archivo físico eliminado", `status=${delDoc.status} gone=${physicalGone}`);

  // ── 8. Borrado carpeta con subárbol (CASCADE BD + disco) ──
  header("8) DELETE carpeta con subcarpetas + docs (CASCADE)");
  const upInChild = await httpUpload(cookieA, { buffer: pdfBuf(1), filename: "en-hija.pdf", mimeType: MIME_PDF, folderId: y2026.json?.data?.id });
  const childDocId = upInChild.json?.data?.id;
  const childDiskPath = path.join(getUploadsRoot(), "documents", TENANT_SLUG, USER_A, `${childDocId}${EXT}`);
  const delFolder = await httpJson("DELETE", `/api/documents/folders/${contratos.json?.data?.id}`, null, cookieA);
  const childFolderGone = (await httpJson("GET", `/api/documents/folders/${y2026.json?.data?.id}`, null, cookieA)).status === 404;
  const childFileGone = await fs.access(childDiskPath).then(() => false).catch(() => true);
  assertOk(delFolder.status === 204 && childFolderGone && childFileGone, "DELETE carpeta raíz → subcarpetas + docs + archivos borrados", `del=${delFolder.status} folderGone=${childFolderGone} fileGone=${childFileGone}`);
  created.folderIds = created.folderIds.filter((id) => id !== contratos.json?.data?.id);

  // ── 9. AuditLog ──
  header("9) AuditLog de mutaciones");
  const { Op } = require("sequelize");
  const auditRows = await AuditLog.findAll({
    where: { tenantId: tenant.id, action: { [Op.like]: "document%" } },
    order: [["createdAt", "DESC"]],
    limit: 50,
  });
  const actions = new Set(auditRows.map((r) => r.action));
  assertOk(
    actions.has("document_folder.created") && actions.has("document.uploaded") && actions.has("document.deleted") && actions.has("document_folder.deleted"),
    "AuditLog tiene created/uploaded/deleted (folder + doc)",
    [...actions].join(",")
  );

  // ── Cleanup ──
  await cleanup(getUploadsRoot, projectRoot);
  printSummary();
  process.exit(counts.fail > 0 ? 1 : 0);
}

async function cleanup(getUploadsRoot, projectRoot) {
  header("Cleanup");
  try {
    const { getTenantDb } = await import("../lib/db/tenantDb.js");
    const { models } = getTenantDb(TENANT_SLUG);
    const { Op } = createRequire(import.meta.url)("sequelize");
    await models.Document.destroy({ where: { ownerUserId: { [Op.in]: [USER_A, USER_B] } } });
    await models.DocumentFolder.destroy({ where: { ownerUserId: { [Op.in]: [USER_A, USER_B] } } });
    const { getMasterModels } = await import("../lib/db/masterDb.js");
    await getMasterModels().User.destroy({ where: { id: { [Op.in]: [USER_A, USER_B] } } });
  } catch (e) {
    log(`· cleanup BD: ${e.message}`);
  }
  // Disco: borrar dirs de los usuarios sintéticos + cualquier path suelto tracked.
  for (const seg of [USER_A, USER_B]) {
    await fs.rm(path.join(getUploadsRoot(), "documents", TENANT_SLUG, seg), { recursive: true, force: true }).catch(() => {});
  }
  for (const p of created.diskPaths) await fs.unlink(p).catch(() => {});
  log("· hecho");
  void projectRoot;
}

function printSummary() {
  process.stdout.write(`\n${"─".repeat(60)}\n`);
  process.stdout.write(`  RESULTADO: ${counts.pass} ok · ${counts.fail} fallos\n`);
  process.stdout.write(`${"─".repeat(60)}\n\n`);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Smoke abortado: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
