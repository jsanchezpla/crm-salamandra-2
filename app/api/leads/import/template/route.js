import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ForbiddenError } from "../../../../../lib/utils/errors.js";
import ExcelJS from "exceljs";

const TENANT_TEMPLATES = {
  spain_enzymes: {
    columns: [
      { header: "Nombre", key: "name", width: 25 },
      { header: "Empresa", key: "empresa", width: 28 },
      { header: "Email", key: "email", width: 30 },
      { header: "Teléfono", key: "phone", width: 15 },
      { header: "País", key: "pais", width: 18 },
      { header: "Ciudad", key: "ciudad", width: 18 },
      { header: "Asunto", key: "asunto", width: 35 },
      { header: "Mensaje", key: "mensaje", width: 50 },
      { header: "Estado", key: "stage", width: 20 },
      { header: "Prioridad", key: "prioridad", width: 12 },
    ],
    example: {
      name: "John Doe",
      empresa: "Acme Corp",
      email: "john@acme.com",
      phone: "+34600000000",
      pais: "España",
      ciudad: "Madrid",
      asunto: "Consulta sobre productos enzimáticos",
      mensaje: "Estamos interesados en vuestros productos para uso industrial.",
      stage: "Nuevo lead",
      prioridad: "media",
    },
    help: {
      name: "* Requerido si no hay email",
      empresa: "Texto libre",
      email: "* Requerido si no hay nombre",
      phone: "Opcional",
      pais: "Texto libre (ej: España, Francia)",
      ciudad: "Texto libre",
      asunto: "Texto libre",
      mensaje: "Texto libre",
      stage: "Nuevo lead | Contactado | En seguimiento | Convertido | Descartado",
      prioridad: "alta | media | baja",
    },
  },
  nutri_laura: {
    columns: [
      { header: "Nombre", key: "name", width: 25 },
      { header: "Email", key: "email", width: 30 },
      { header: "Teléfono", key: "phone", width: 15 },
      { header: "Edad", key: "edad", width: 10 },
      { header: "Motivo", key: "motivo", width: 50 },
      { header: "Info adicional", key: "info_adicional", width: 50 },
      { header: "Estado", key: "stage", width: 22 },
      { header: "Notas", key: "notes", width: 40 },
    ],
    example: {
      name: "Marta Gómez",
      email: "marta.gomez@example.com",
      phone: "611234567",
      edad: "34",
      motivo: "Quiero perder unos kilos antes del verano y mantener hábitos saludables",
      info_adicional: "Intolerancia leve a la lactosa. Sin alergias conocidas.",
      stage: "Nuevo lead",
      notes: "",
    },
    help: {
      name: "* Requerido si no hay email",
      email: "* Requerido si no hay nombre",
      phone: "Opcional",
      edad: "Texto libre (ej: 34, 'menor de edad')",
      motivo: "Texto libre — ¿qué te gustaría trabajar?",
      info_adicional: "Texto libre — ¿algo más que deba saber?",
      stage: "Nuevo lead | Contactado | Consulta agendada | Consulta realizada | Paciente activo | Descartado",
      notes: "Texto libre (notas internas)",
    },
  },
  // `abarcaia` tenía la suya y se fue con el cliente el 12/08/2026.
};

const DEFAULT_TEMPLATE = {
  columns: [
    { header: "Nombre", key: "name", width: 25 },
    { header: "Email", key: "email", width: 30 },
    { header: "Teléfono", key: "phone", width: 15 },
    { header: "Empresa", key: "empresa", width: 28 },
    { header: "Estado", key: "stage", width: 18 },
    { header: "Notas", key: "notes", width: 40 },
  ],
  example: {
    name: "Juan García",
    email: "juan@ejemplo.com",
    phone: "612345678",
    empresa: "Empresa S.L.",
    stage: "Contactado",
    notes: "",
  },
  help: {
    name: "* Requerido si no hay email ni teléfono",
    email: "",
    phone: "",
    empresa: "Texto libre",
    stage: "new | contacted | qualified | won | lost",
    notes: "Texto libre",
  },
};

export const GET = withTenant(async (_request, _ctx, { hasModule, tenant }) => {
  if (!hasModule("leads")) throw new ForbiddenError();

  const tmpl = TENANT_TEMPLATES[tenant?.slug] ?? DEFAULT_TEMPLATE;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM Salamandra";
  const sheet = workbook.addWorksheet("Plantilla Leads");

  sheet.columns = tmpl.columns;

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B3A2D" } };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.height = 22;

  const exampleRow = sheet.addRow(tmpl.example);
  exampleRow.font = { italic: true, color: { argb: "FF6B7280" } };
  exampleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  exampleRow.height = 18;

  const helpRow = sheet.addRow(tmpl.help);
  helpRow.font = { size: 9, color: { argb: "FF9CA3AF" } };
  helpRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAFAFA" } };
  helpRow.height = 16;

  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla_leads.xlsx"',
    },
  });
});
