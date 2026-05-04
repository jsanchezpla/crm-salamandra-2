import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ForbiddenError } from "../../../../lib/utils/errors.js";
import { Op } from "sequelize";
import ExcelJS from "exceljs";
import { STAGE_LABELS } from "../../../../lib/leads/stages.js";

const TENANT_COLUMNS = {
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
      { header: "Recibido", key: "createdAt", width: 14 },
    ],
    row: (lead) => ({
      name: lead.name || "",
      empresa: lead.customFields?.empresa || "",
      email: lead.email || "",
      phone: lead.phone || "",
      pais: lead.customFields?.pais || "",
      ciudad: lead.customFields?.ciudad || "",
      asunto: lead.customFields?.asunto || "",
      mensaje: lead.notes || "",
      stage: STAGE_LABELS[lead.stage] ?? lead.stage,
      prioridad: lead.customFields?.prioridad || "",
      createdAt: lead.createdAt ? new Date(lead.createdAt).toLocaleDateString("es-ES") : "",
    }),
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
      { header: "Fecha", key: "createdAt", width: 14 },
    ],
    row: (lead) => ({
      name: lead.name || lead.title || "",
      email: lead.email || "",
      phone: lead.phone || "",
      cargo: lead.customFields?.cargo || "",
      empresa_actual: lead.customFields?.empresa_actual || "",
      zona: lead.customFields?.zona ?? lead.customFields?.zone ?? "",
      linkedin: lead.customFields?.linkedin || "",
      instagram_user: lead.customFields?.instagram_user || "",
      stage: STAGE_LABELS[lead.stage] ?? lead.stage,
      respuesta: lead.customFields?.respuesta || "",
      demo_agendada: lead.customFields?.demo_agendada || "",
      fecha_demo: lead.customFields?.fecha_demo || "",
      prioridad: lead.customFields?.prioridad || "",
      notes: lead.notes || "",
      createdAt: lead.createdAt ? new Date(lead.createdAt).toLocaleDateString("es-ES") : "",
    }),
  },
};

const DEFAULT_CONFIG = {
  columns: [
    { header: "Nombre", key: "name", width: 25 },
    { header: "Email", key: "email", width: 30 },
    { header: "Teléfono", key: "phone", width: 15 },
    { header: "Empresa", key: "empresa", width: 28 },
    { header: "Estado", key: "stage", width: 18 },
    { header: "Notas", key: "notes", width: 40 },
    { header: "Fecha", key: "createdAt", width: 14 },
  ],
  row: (lead) => ({
    name: lead.name || lead.title || "",
    email: lead.email || "",
    phone: lead.phone || "",
    empresa: lead.customFields?.empresa || "",
    stage: STAGE_LABELS[lead.stage] ?? lead.stage,
    notes: lead.notes || "",
    createdAt: lead.createdAt ? new Date(lead.createdAt).toLocaleDateString("es-ES") : "",
  }),
};

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule, tenant }) => {
  if (!hasModule("leads") && !hasModule("sales")) throw new ForbiddenError();

  const { Lead } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  const stage = searchParams.get("stage");
  const empresa = searchParams.get("empresa");
  const search = searchParams.get("search");

  if (stage) where.stage = stage;
  if (empresa) where.customFields = { [Op.contains]: { empresa } };
  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } },
      { phone: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const leads = await Lead.findAll({ where, order: [["createdAt", "DESC"]] });

  const config = TENANT_COLUMNS[tenant?.slug] ?? DEFAULT_CONFIG;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM Salamandra";
  const sheet = workbook.addWorksheet("Leads");

  sheet.columns = config.columns;

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B3A2D" } };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.height = 22;

  for (const lead of leads) {
    sheet.addRow(config.row(lead));
  }

  for (let i = 2; i <= leads.length + 1; i++) {
    const row = sheet.getRow(i);
    row.height = 18;
    row.eachCell((cell) => {
      cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
    });
    if (i % 2 === 0) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const fecha = new Date().toISOString().slice(0, 10);

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="leads_${fecha}.xlsx"`,
    },
  });
});
