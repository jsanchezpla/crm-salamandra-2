import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { forbidden } from "../../../../../../lib/utils/apiResponse.js";
import { ForbiddenError } from "../../../../../../lib/utils/errors.js";
import ExcelJS from "exceljs";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar este recurso";

const RETORIKA_BLUE = "FF174792"; // ARGB

/**
 * GET /api/training/users/import/template
 *
 * Devuelve una plantilla Excel con 2 hojas:
 *   - "Empleados": cabeceras canónicas + 3 filas de ejemplo.
 *   - "Instrucciones": cómo usarla, formato de fecha aceptado, casos límite.
 *
 * Generada al vuelo con exceljs (ya en deps). Sin estado en disco — esto
 * permite que cualquier cambio en el helper de parseo se refleje
 * inmediatamente en la plantilla descargada.
 */
export const GET = withTenant(async (request, _ctx, { hasModule }) => {
  if (!hasModule("training")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM Salamandra";
  workbook.created = new Date();

  // Hoja 1 — Empleados
  const sheet = workbook.addWorksheet("Empleados", {
    properties: { defaultRowHeight: 18 },
  });
  sheet.columns = [
    { header: "Email", key: "email", width: 32 },
    { header: "Nombre", key: "nombre", width: 22 },
    { header: "Fecha_nacimiento", key: "fecha_nacimiento", width: 20 },
  ];
  styleHeader(sheet.getRow(1));
  sheet.addRow(["juan.perez@empresa.com", "Juan", "12-05-1985"]);
  sheet.addRow(["ana.lopez@empresa.com", "Ana", "23-11-1990"]);
  sheet.addRow(["luis@empresa.com", "Luis", ""]);
  // Ancho de filas para que la cabecera respire
  sheet.getRow(1).height = 22;

  // Hoja 2 — Instrucciones
  const help = workbook.addWorksheet("Instrucciones");
  help.columns = [{ header: "", width: 100 }];
  help.getCell("A1").value = "Cómo rellenar la plantilla de empleados de empresa";
  help.getCell("A1").font = { name: "Calibri", size: 14, bold: true, color: { argb: RETORIKA_BLUE } };
  const lines = [
    "",
    "Columnas:",
    "  • Email — OBLIGATORIO. Debe ser un email válido. No puede repetirse dentro del mismo Excel.",
    "  • Nombre — opcional. Texto libre. Se guarda tal cual (con trim).",
    "  • Fecha_nacimiento — opcional. Formatos aceptados (en este orden):",
    "       - AAAA-MM-DD  (ISO, ej. 1985-05-12)",
    "       - DD-MM-AAAA  (formato europeo preferido, ej. 12-05-1985)",
    "       - DD/MM/AAAA  (con barras, se normaliza, ej. 12/05/1985)",
    "       - Celda formateada como fecha en Excel (también vale)",
    "",
    "Si una fila tiene un email inválido, fecha en formato no reconocido o cae",
    "fuera del rango de años aceptado (1900–2100), se reportará como error en",
    "el preview y NO se importará. El resto de filas válidas sí se importarán.",
    "",
    "Re-subir el mismo Excel con cambios actualiza los empleados existentes",
    "(MERGE por email). Los nuevos emails se crean como activos=false para",
    "que pasen por el flujo de activación al primer registro en la web.",
    "",
    "El empleado se asocia automáticamente a la empresa desde cuya pantalla",
    "subes el Excel. No es necesaria una columna 'Empresa'.",
  ];
  for (let i = 0; i < lines.length; i++) {
    help.getCell(`A${i + 2}`).value = lines[i];
    help.getCell(`A${i + 2}`).font = { name: "Calibri", size: 11 };
  }

  const buf = await workbook.xlsx.writeBuffer();
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-empleados-empresa.xlsx"',
      "Cache-Control": "no-store",
    },
  });
});

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: RETORIKA_BLUE },
    };
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FF0E2F5E" } },
    };
  });
}
