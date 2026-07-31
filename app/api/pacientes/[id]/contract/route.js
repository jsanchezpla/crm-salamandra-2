import { NextResponse } from "next/server";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { readContract } from "../../../../../lib/clinica/contractStorage.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pacientes/[id]/contract — descarga el contrato ANTIGUO del paciente.
//
// SOLO LECTURA DESDE EL SPRINT 2026-07 (punto 1.1). El contrato pasó a ser del
// CLIENTE (la familia): quien firma y quien paga son los padres, y con dos
// hermanos en el centro había dos copias del mismo contrato. Se sube y se borra
// en /api/clients/[id]/contract; aquí solo quedan los PDFs que la migración
// `migrate-contract-patient-to-client.js` no pudo mover porque el paciente no
// tenía cliente pagador enlazado. Cuando no quede ninguno, este endpoint se va.
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (_request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);
    const { Patient } = ctx.tenantModels;

    const patient = await Patient.findByPk(id, { attributes: ["id", "contractFile"] });
    if (!patient) return notFound("Paciente no encontrado");
    const cf = patient.contractFile;
    if (!cf?.storedFilename) return notFound("El paciente no tiene contrato subido");

    let buffer;
    try {
      buffer = await readContract(ctx.tenant.slug, id, cf.storedFilename);
    } catch (err) {
      if (err.code === "ENOENT") return notFound("Archivo físico no encontrado");
      throw err;
    }
    const safeName = String(cf.originalName || "contrato.pdf").replace(/[\r\n"]/g, "_");
    const ab = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(ab).set(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    return new NextResponse(ab, {
      status: 200,
      headers: {
        "Content-Type": cf.mime || "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
