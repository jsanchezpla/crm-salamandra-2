import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../../../lib/utils/apiResponse.js";
import { ValidationError, ForbiddenError } from "../../../../../../lib/utils/errors.js";
import { parseFlexibleDate } from "../../../../../../lib/training/parseDate.js";
import ExcelJS from "exceljs";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar este recurso";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PREVIEW_MAX_ROWS = 50;

/**
 * POST /api/training/users/import/preview
 *
 * MISMA entrada que /import (multipart/form-data con `file` xlsx). NO escribe
 * en BD bajo NINGUNA circunstancia — solo parsea, valida y reporta. Pensado
 * para la UI: mostrar al admin qué se va a crear / actualizar / saltar antes
 * de confirmar.
 *
 * Acepta query param `?companyId=X` (igual que /import). Cuando está
 * presente la columna "Empresa" del Excel se ignora.
 *
 * Respuesta:
 *   {
 *     "totalRows": <N>,                       // filas no vacías
 *     "valid": <V>,                           // filas que se importarían
 *     "newCount": <C>,                        // emails no existentes en BD
 *     "updateCount": <U>,                     // emails que ya existen → se actualizarían
 *     "errors": [{ row, field, value, error }, ...],
 *     "preview": [{ row, email, name, lastName, birthDate, action: "create"|"update" }, ...]
 *   }
 *
 * Notas defensivas:
 *   - Si el handler entra y por cualquier motivo no llega al `return ok(...)`,
 *     no hay puntos de escritura intermedios; cualquier excepción propaga
 *     limpia y no deja datos huérfanos.
 *   - El número de filas devueltas en `preview` está limitado a PREVIEW_MAX_ROWS
 *     para no inflar la respuesta cuando el admin sube 5.000 empleados de
 *     golpe. `totalRows` / `valid` / counters siguen siendo del Excel entero.
 */
export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

  const { TrainingUser, Company } = tenantModels;
  const { searchParams } = new URL(request.url);
  const companyIdParam = searchParams.get("companyId");

  // Validar que la empresa del query param existe en este tenant (si llega).
  // Es solo informativo para el preview — el GET no escribe.
  let companyForOverride = null;
  if (companyIdParam) {
    companyForOverride = await Company.findByPk(companyIdParam, { attributes: ["id", "name"] });
    if (!companyForOverride) {
      throw new ValidationError(`Empresa ${companyIdParam} no encontrada en este tenant`);
    }
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
  if (!colEmail) {
    throw new ValidationError("El Excel debe tener una columna 'Email'");
  }
  const colNombre = colOf("nombre");
  const colApellidos = colOf("apellidos");
  const colFecha = colOf("fecha_nacimiento", "fecha nacimiento", "fecha");
  const colEmpresa = colOf("empresa");

  // Una sola pasada por las filas: validamos formato y recopilamos emails
  // únicos para una sola query a BD que distinga create/update.
  const rowsInfo = [];      // { row, email, name, lastName, birthDate, errors:[{field,value,error}], empresaCell }
  const seenEmails = new Set();
  const validEmails = [];
  let totalRows = 0;

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

    totalRows++;

    const rowErrors = [];
    const email = String(
      typeof rawEmail === "object" && rawEmail?.text ? rawEmail.text : (rawEmail ?? "")
    ).trim().toLowerCase();

    if (!email) {
      rowErrors.push({ field: "email", value: "", error: "Email obligatorio" });
    } else if (!EMAIL_RE.test(email)) {
      rowErrors.push({ field: "email", value: email, error: "Email inválido" });
    } else if (seenEmails.has(email)) {
      rowErrors.push({ field: "email", value: email, error: "Email duplicado en el archivo" });
    } else {
      seenEmails.add(email);
    }

    const name = strOrNull(cellValue(colNombre));
    const lastName = strOrNull(cellValue(colApellidos));

    let birthDate = null;
    if (colFecha) {
      const rawFecha = cellValue(colFecha);
      if (rawFecha !== null && rawFecha !== "") {
        const parsed = parseFlexibleDate(rawFecha);
        if (parsed.ok) {
          birthDate = parsed.date.toISOString().slice(0, 10);
        } else if (parsed.reason !== "vacio") {
          rowErrors.push({
            field: "fecha_nacimiento",
            value: serializeCellForError(rawFecha),
            error: `Fecha no reconocida (${parsed.reason})`,
          });
        }
      }
    }

    if (rowErrors.length === 0 && email) validEmails.push(email);

    rowsInfo.push({
      row: rowNum,
      email,
      name,
      lastName,
      birthDate,
      errors: rowErrors,
    });
  }

  // Una sola query para resolver create vs update.
  const existing = validEmails.length
    ? await TrainingUser.findAll({
        where: { email: validEmails },
        attributes: ["email"],
      })
    : [];
  const existingSet = new Set(existing.map((u) => u.email));

  const errors = [];
  const preview = [];
  let newCount = 0;
  let updateCount = 0;

  for (const r of rowsInfo) {
    if (r.errors.length) {
      for (const e of r.errors) errors.push({ row: r.row, ...e });
      continue;
    }
    const action = existingSet.has(r.email) ? "update" : "create";
    if (action === "create") newCount++;
    else updateCount++;
    if (preview.length < PREVIEW_MAX_ROWS) {
      preview.push({
        row: r.row,
        email: r.email,
        name: r.name,
        lastName: r.lastName,
        birthDate: r.birthDate,
        action,
      });
    }
  }

  return ok({
    totalRows,
    valid: newCount + updateCount,
    newCount,
    updateCount,
    errors,
    preview,
    company: companyForOverride
      ? { id: companyForOverride.id, name: companyForOverride.name }
      : null,
    note: colEmpresa && companyForOverride
      ? "Se detectó columna 'Empresa' en el Excel; se ignorará porque el preview se hizo con companyId del contexto."
      : null,
  });
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
