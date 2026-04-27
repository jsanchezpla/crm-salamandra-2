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
  abarcaia: {
    columns: [
      { header: "Nombre", key: "name", width: 25 },
      { header: "Email", key: "email", width: 30 },
      { header: "Teléfono", key: "phone", width: 15 },
      { header: "Cargo", key: "cargo", width: 28 },
      { header: "Empresa actual", key: "empresa_actual", width: 28 },
      { header: "Ubicación", key: "zona", width: 20 },
      { header: "LinkedIn", key: "linkedin", width: 40 },
      { header: "Usuario Instagram", key: "instagram_user", width: 25 },
      { header: "Estado", key: "stage", width: 20 },
      { header: "Respuesta", key: "respuesta", width: 30 },
      { header: "Demo Agendada", key: "demo_agendada", width: 15 },
      { header: "Fecha Demo", key: "fecha_demo", width: 18 },
      { header: "Prioridad", key: "prioridad", width: 12 },
      { header: "Notas", key: "notes", width: 40 },
    ],
    example: {
      name: "Juan García",
      email: "juan@ejemplo.com",
      phone: "612345678",
      cargo: "Director Comercial",
      empresa_actual: "Empresa S.L.",
      zona: "Madrid",
      linkedin: "https://linkedin.com/in/juangarcia",
      instagram_user: "@juangarcia",
      stage: "Contactado",
      respuesta: "Interesado, volver a llamar la próxima semana",
      demo_agendada: "Sí",
      fecha_demo: "2026-05-10",
      prioridad: "media",
      notes: "Conocido a través de LinkedIn",
    },
    help: {
      name: "* Requerido si no hay email ni teléfono",
      email: "",
      phone: "",
      cargo: "Texto libre",
      empresa_actual: "Texto libre",
      zona: "Texto libre",
      linkedin: "URL completa",
      instagram_user: "@usuario o vacío",
      stage: "Nuevo | Contactado | En proceso | Demo agendada | Demo realizada | Cerrado - Sí | Cerrado - No",
      respuesta: "Texto libre",
      demo_agendada: "Sí | No | Pendiente",
      fecha_demo: "AAAA-MM-DD o AAAA-MM-DDTHH:MM",
      prioridad: "alta | media | baja",
      notes: "Texto libre",
    },
  },
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
  if (!hasModule("leads") && !hasModule("sales")) throw new ForbiddenError();

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
