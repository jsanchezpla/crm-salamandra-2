import { NextResponse } from "next/server";
import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import ExcelJS from "exceljs";

const HEADER_MAP = {
  nombre: "name",
  name: "name",
  candidato: "name",
  email: "email",
  correo: "email",
  "e-mail": "email",
  telefono: "phone",
  teléfono: "phone",
  phone: "phone",
  movil: "phone",
  móvil: "phone",
  empresa: "empresa",
  company: "empresa",
  cargo: "cargo",
  "empresa actual": "empresa_actual",
  empresa_actual: "empresa_actual",
  notas: "notes",
  notes: "notes",
  observaciones: "notes",
  comentarios: "notes",
  estado: "stage",
  stage: "stage",
  fase: "stage",
  origen: "source",
  source: "source",
  fuente: "source",
  experiencia: "experience",
  experience: "experience",
  zona: "zona",
  zone: "zona",
  linkedin: "linkedin",
  "linkedin url": "linkedin",
  "perfil linkedin": "linkedin",
};

const STAGE_MAP = {
  nuevo: "new",
  new: "new",
  "nuevo lead": "new",
  contactado: "contacted",
  contacted: "contacted",
  "en seguimiento": "qualified",
  seguimiento: "qualified",
  qualified: "qualified",
  convertido: "won",
  won: "won",
  descartado: "lost",
  lost: "lost",
};

const VALID_STAGES = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"];

export async function POST(request) {
  try {
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ ok: false, error: "Tenant no encontrado" }, { status: 401 });
    }

    const { tenantModels, hasModule } = context;

    if (!hasModule("leads") && !hasModule("sales")) {
      return NextResponse.json({ ok: false, error: "Módulo no habilitado" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file) {
      return NextResponse.json({ ok: false, error: "No se ha subido ningún archivo" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return NextResponse.json({ ok: false, error: "El archivo no contiene hojas" }, { status: 400 });
    }

    const headerRow = worksheet.getRow(1);
    const headers = {};
    headerRow.eachCell((cell, colNumber) => {
      const raw = cell.value?.toString().trim().toLowerCase() ?? "";
      headers[colNumber] = HEADER_MAP[raw] || raw;
    });

    const rows = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const obj = {};
      row.eachCell((cell, colNumber) => {
        const key = headers[colNumber];
        if (!key) return;
        let val = cell.value;
        if (val instanceof Date) val = val.toISOString();
        else if (val !== null && typeof val === "object") val = val.text ?? val.toString();
        obj[key] = val?.toString().trim() ?? "";
      });
      if (obj.stage) obj.stage = STAGE_MAP[obj.stage.toLowerCase()] ?? "new";
      rows.push(obj);
    });

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "El archivo no contiene filas de datos" },
        { status: 400 }
      );
    }

    if (rows.length > 1000) {
      return NextResponse.json(
        { ok: false, error: "Máximo 1000 leads por importación" },
        { status: 400 }
      );
    }

    const { Lead } = tenantModels;
    const results = { imported: 0, skipped: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (!row.name && !row.email && !row.phone) {
        results.skipped++;
        continue;
      }

      try {
        const payload = {
          name: row.name?.trim() || null,
          email: row.email?.trim().toLowerCase() || null,
          phone: row.phone?.trim() || null,
          notes: row.notes?.trim() || null,
          source: row.source?.trim() || "excel_import",
          stage: VALID_STAGES.includes(row.stage) ? row.stage : "new",
          customFields: {},
        };

        if (row.empresa) payload.customFields.empresa = row.empresa.trim();
        if (row.cargo) payload.customFields.cargo = row.cargo.trim();
        if (row.empresa_actual) payload.customFields.empresa_actual = row.empresa_actual.trim();
        if (row.zona) payload.customFields.zona = row.zona.trim();
        if (row.experience) payload.customFields.experience = row.experience.trim();
        if (row.linkedin) payload.customFields.linkedin = row.linkedin.trim();

        await Lead.create(payload);
        results.imported++;
      } catch {
        results.errors.push({ row: i + 2, message: "Error al crear el lead" });
      }
    }

    return NextResponse.json({ ok: true, data: results }, { status: 201 });
  } catch (err) {
    console.error("[leads/import/excel] Error:", err);
    return NextResponse.json({ ok: false, error: "Error interno del servidor" }, { status: 500 });
  }
}
