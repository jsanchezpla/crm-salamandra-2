import { NextResponse } from "next/server";
import { getTenantContext } from "../../../../lib/tenant/tenantResolver.js";

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

    const { leads: rows } = await request.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "No hay filas para importar" }, { status: 400 });
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

      if (!row.email && !row.phone) {
        results.skipped++;
        continue;
      }

      try {
        const payload = {
          name: row.name?.toString().trim() || null,
          email: row.email?.toString().trim().toLowerCase() || null,
          phone: row.phone?.toString().trim() || null,
          notes: row.notes?.toString().trim() || null,
          source: row.source?.toString().trim() || "csv_import",
          stage: VALID_STAGES.includes(row.stage) ? row.stage : "new",
          customFields: {},
        };

        if (row.empresa) payload.customFields.empresa = row.empresa.toString().trim();
        if (row.experience) payload.customFields.experience = row.experience.toString().trim();
        if (row.zone) payload.customFields.zone = row.zone.toString().trim();

        if (!payload.email && !payload.phone) {
          results.skipped++;
          continue;
        }

        await Lead.create(payload);
        results.imported++;
      } catch {
        results.errors.push({ row: i + 2, message: "Error al crear el lead" });
      }
    }

    return NextResponse.json({ ok: true, data: results }, { status: 201 });
  } catch (err) {
    console.error("[leads/import] Error:", err);
    return NextResponse.json({ ok: false, error: "Error interno del servidor" }, { status: 500 });
  }
}

const VALID_STAGES = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"];
