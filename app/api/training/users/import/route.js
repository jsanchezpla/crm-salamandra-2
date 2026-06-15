import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { ValidationError, ForbiddenError } from "../../../../../lib/utils/errors.js";
import { parseFlexibleDate } from "../../../../../lib/training/parseDate.js";
import ExcelJS from "exceljs";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar este recurso";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/training/users/import
 *
 * Importa usuarios desde un Excel.
 *
 * Query params:
 *   - `companyId` (opcional): si presente, TODAS las filas se asocian a esa
 *     empresa y la columna `Empresa` del Excel se ignora. Si no, se resuelve
 *     `companyId` por fila a partir de la columna `Empresa` (por nombre o
 *     por externalId).
 *
 * Semántica MERGE (Fase 2, junio 2026): los emails que ya existen se
 * ACTUALIZAN (campos no vacíos en el Excel pisan los valores actuales). Los
 * emails nuevos se CREAN. La respuesta separa los contadores:
 *
 *   { imported, updated, skipped, errors[] }
 *
 *   - `imported`: filas con email nuevo → INSERT.
 *   - `updated` : filas con email existente → UPDATE (sin tocar `active` si
 *     ya estaba en true, para no romper a un empleado ya activo).
 *   - `skipped` : filas con email vacío o no parseables (también cuentan
 *     aquí las que dieron error de validación).
 *   - `errors[]`: detalle por fila para que la UI pueda señalarlas.
 *
 * `active` default para nuevos:
 *   - companyId resuelto → `false` (pre-aprobado, espera a /register/empresa).
 *   - sin companyId      → `true`  (private, no pasa por el flujo de WP).
 *
 * Las actualizaciones NO tocan `active` ni `type`: si el empleado ya estaba
 * activo o ya tenía type=company, eso lo gobierna /register/empresa, no el
 * import.
 */
export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

  const { TrainingUser, Company } = tenantModels;

  const { searchParams } = new URL(request.url);
  const companyIdParam = searchParams.get("companyId");

  let overrideCompanyId = null;
  if (companyIdParam) {
    const company = await Company.findByPk(companyIdParam, { attributes: ["id"] });
    if (!company) {
      throw new ValidationError(`Empresa ${companyIdParam} no encontrada en este tenant`);
    }
    overrideCompanyId = company.id;
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file) throw new ValidationError("No se ha enviado ningún fichero");

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ValidationError("El fichero Excel no contiene hojas");

  const normalize = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, "_");
  const headerRow = sheet.getRow(1);
  const headers = {};
  headerRow.eachCell((cell, col) => {
    headers[normalize(cell.value)] = col;
  });
  const colOf = (...names) => {
    for (const n of names) {
      const idx = headers[normalize(n)];
      if (idx) return idx;
    }
    return null;
  };

  const colEmail = colOf("email");
  if (!colEmail) throw new ValidationError("El Excel debe tener una columna 'Email'");
  const colNombre = colOf("nombre");
  const colApellidos = colOf("apellidos");
  const colUsername = colOf("username");
  const colNif = colOf("nif");
  const colPais = colOf("país", "pais");
  const colFecha = colOf("fecha_nacimiento", "fecha nacimiento", "fecha");
  const colEmpresa = colOf("empresa");

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];
  const seenEmails = new Set();

  for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
    const row = sheet.getRow(rowNum);
    const cellValue = (col) => (col ? (row.getCell(col).value ?? null) : null);

    const rawEmail = cellValue(colEmail);
    const isEmpty =
      (rawEmail === null || String(rawEmail).trim() === "") &&
      !cellValue(colNombre) &&
      !cellValue(colApellidos) &&
      !cellValue(colFecha) &&
      !cellValue(colEmpresa);
    if (isEmpty) continue;

    const email = String(
      typeof rawEmail === "object" && rawEmail?.text ? rawEmail.text : (rawEmail ?? "")
    ).trim().toLowerCase();
    if (!email) {
      skipped++;
      errors.push({ row: rowNum, field: "email", value: "", error: "Email obligatorio" });
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      skipped++;
      errors.push({ row: rowNum, field: "email", value: email, error: "Email inválido" });
      continue;
    }
    if (seenEmails.has(email)) {
      skipped++;
      errors.push({ row: rowNum, field: "email", value: email, error: "Email duplicado en el archivo" });
      continue;
    }
    seenEmails.add(email);

    const name = strOrNull(cellValue(colNombre));
    const lastName = strOrNull(cellValue(colApellidos));
    const username = strOrNull(cellValue(colUsername));
    const nif = strOrNull(cellValue(colNif));
    const country = strOrNull(cellValue(colPais));

    let birthDate = null;
    if (colFecha) {
      const rawFecha = cellValue(colFecha);
      if (rawFecha !== null && rawFecha !== "") {
        const parsed = parseFlexibleDate(rawFecha);
        if (parsed.ok) {
          birthDate = parsed.date;
        } else if (parsed.reason !== "vacio") {
          skipped++;
          errors.push({
            row: rowNum,
            field: "fecha_nacimiento",
            value: serializeCellForError(rawFecha),
            error: `Fecha no reconocida (${parsed.reason})`,
          });
          continue;
        }
      }
    }

    // Resolver companyId. El query param prevalece sobre la columna Empresa.
    let companyId = overrideCompanyId;
    if (!companyId && colEmpresa) {
      const empresaVal = String(cellValue(colEmpresa) ?? "").trim();
      if (empresaVal) {
        const where = /^\d+$/.test(empresaVal)
          ? { externalId: parseInt(empresaVal, 10) }
          : { name: empresaVal };
        const company = await Company.findOne({ where, attributes: ["id"] });
        if (company) companyId = company.id;
      }
    }

    const type = companyId ? "company" : "private";

    try {
      const existing = await TrainingUser.findOne({ where: { email } });
      if (existing) {
        // MERGE: pisar solo campos no vacíos del Excel. No tocar `active`
        // ni `type` (gobernados por register/empresa / decisiones manuales).
        // Si el empleado estaba archivado → reactivar (archivedAt = NULL).
        const updates = {};
        if (name !== null) updates.name = name;
        if (lastName !== null) updates.lastName = lastName;
        if (username !== null) updates.username = username;
        if (nif !== null) updates.nif = nif;
        if (country !== null) updates.country = country;
        if (birthDate !== null) updates.birthDate = birthDate;
        if (companyId) updates.companyId = companyId;
        const wasArchived = !!existing.archivedAt;
        if (wasArchived) updates.archivedAt = null;
        await existing.update(updates);
        updated++;
        if (wasArchived) {
          console.log(`[training] reactivated archived user email=${email}`);
        }
        console.log(
          `[training] import row email=${email} action=update companyId=${companyId ?? "unchanged"} reactivated=${wasArchived}`
        );
      } else {
        const active = type === "private";
        await TrainingUser.create({
          email,
          name,
          lastName,
          username,
          nif,
          country,
          birthDate,
          companyId,
          type,
          active,
        });
        imported++;
        console.log(
          `[training] import row email=${email} action=create type=${type} companyId=${companyId ?? "none"} active=${active}`
        );
      }
    } catch (err) {
      skipped++;
      errors.push({ row: rowNum, field: "row", value: email, error: err.message || "Error en BD" });
    }
  }

  return ok({ imported, updated, skipped, errors });
});

function strOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(typeof v === "object" && v?.text ? v.text : v).trim();
  return s || null;
}

function serializeCellForError(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v?.text) return String(v.text);
  return String(v);
}
