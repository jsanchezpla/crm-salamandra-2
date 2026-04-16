import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ValidationError, ForbiddenError } from "../../../../../lib/utils/errors.js";
import ExcelJS from "exceljs";

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { TrainingUser, Company } = tenantModels;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file) throw new ValidationError("No se ha enviado ningún fichero");

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ValidationError("El fichero Excel no contiene hojas");

  // Cabeceras esperadas (insensible a mayúsculas y espacios)
  const normalize = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, "_");

  const headerRow = sheet.getRow(1);
  const headers = {};
  headerRow.eachCell((cell, col) => {
    headers[normalize(cell.value)] = col;
  });

  const col = (name) => headers[normalize(name)];

  let imported = 0;
  let skipped = 0;
  const errors = [];

  for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
    const row = sheet.getRow(rowNum);
    const getValue = (name) => {
      const c = col(name);
      return c ? row.getCell(c).value ?? null : null;
    };

    const email = String(getValue("email") ?? "").trim().toLowerCase();
    if (!email) {
      skipped++;
      continue;
    }

    try {
      const name = String(getValue("nombre") ?? "").trim() || null;
      const lastName = String(getValue("apellidos") ?? "").trim() || null;
      const username = String(getValue("username") ?? "").trim() || null;
      const nif = String(getValue("nif") ?? "").trim() || null;
      const country = String(getValue("país") ?? getValue("pais") ?? "").trim() || null;
      const birthDateRaw = getValue("fecha_nacimiento");
      const birthDate = birthDateRaw ? new Date(birthDateRaw) : null;

      // Resolver empresa por nombre o ID externo
      let companyId = null;
      const empresaVal = String(getValue("empresa") ?? "").trim();
      if (empresaVal) {
        const company = await Company.findOne({
          where: isNaN(empresaVal)
            ? { name: empresaVal }
            : { externalId: parseInt(empresaVal) },
        });
        if (company) companyId = company.id;
      }

      const [, wasCreated] = await TrainingUser.findOrCreate({
        where: { email },
        defaults: {
          email,
          name,
          lastName,
          username,
          nif,
          country,
          birthDate: birthDate && !isNaN(birthDate) ? birthDate : null,
          companyId,
          type: companyId ? "company" : "private",
          active: true,
        },
      });

      if (wasCreated) {
        imported++;
      } else {
        skipped++;
      }
    } catch (err) {
      errors.push({ row: rowNum, email, error: err.message });
    }
  }

  return ok({ imported, skipped, errors });
});
