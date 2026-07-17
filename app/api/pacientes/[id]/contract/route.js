import { NextResponse } from "next/server";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, noContent, serverError } from "../../../../../lib/utils/apiResponse.js";
import { logClinicaAudit } from "../../../../../lib/clinica/audit.js";
import {
  ALLOWED_MIME,
  MAX_FILE_SIZE_BYTES,
  generateStoredFilename,
  writeContract,
  readContract,
  deleteContractFile,
} from "../../../../../lib/clinica/contractStorage.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const contractView = (cf) =>
  cf ? { originalName: cf.originalName ?? null, size: cf.size ?? null, uploadedAt: cf.uploadedAt ?? null } : null;

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/pacientes/[id]/contract — sube el PDF del contrato firmado.
// multipart/form-data, campo "file". Marca contractSigned=true y guarda la
// metadata en patients.contract_file. Reemplaza el contrato anterior si existía.
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);
    const { Patient } = ctx.tenantModels;
    const uploadedBy = request.headers.get("x-user-email") ?? null;

    const patient = await Patient.findByPk(id);
    if (!patient) return notFound("Paciente no encontrado");

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return error("Body inválido: se esperaba multipart/form-data", 400);
    }
    const file = formData.get("file");
    if (!file || typeof file === "string") return error("Campo 'file' obligatorio (multipart)", 422);
    if (file.type !== ALLOWED_MIME) {
      return error(`Tipo no permitido: solo ${ALLOWED_MIME}. Recibido: ${file.type || "desconocido"}`, 422);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(2);
      return error(`Archivo demasiado grande: ${mb} MB. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 422);
    }

    const originalName = (file.name || "contrato.pdf").slice(0, 255);
    const storedFilename = generateStoredFilename();
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeContract(ctx.tenant.slug, id, storedFilename, buffer);

    const previous = patient.contractFile && typeof patient.contractFile === "object" ? patient.contractFile : null;
    const contractFile = {
      storedFilename,
      originalName,
      size: file.size,
      mime: file.type,
      uploadedAt: new Date().toISOString(),
      uploadedBy,
    };
    try {
      await patient.update({ contractFile, contractSigned: true });
    } catch (dbErr) {
      // Si la BD falla, no dejar el archivo huérfano.
      await deleteContractFile(ctx.tenant.slug, id, storedFilename);
      throw dbErr;
    }
    // Borrar el PDF anterior (best-effort) sólo tras persistir el nuevo.
    if (previous?.storedFilename && previous.storedFilename !== storedFilename) {
      await deleteContractFile(ctx.tenant.slug, id, previous.storedFilename);
    }

    await logClinicaAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "pacientes.contract_uploaded",
      entity: "Patient",
      entityId: id,
      before: { contractFile: contractView(previous) },
      after: { contractFile: contractView(contractFile) },
      ip: request.headers.get("x-forwarded-for"),
    });

    return ok({ contractSigned: true, contractFile: contractView(contractFile) });
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pacientes/[id]/contract — descarga el PDF del contrato.
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

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/pacientes/[id]/contract — elimina el PDF (deja contractSigned).
// ─────────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);
    const { Patient } = ctx.tenantModels;

    const patient = await Patient.findByPk(id);
    if (!patient) return notFound("Paciente no encontrado");
    const cf = patient.contractFile;
    if (!cf?.storedFilename) return noContent();

    await patient.update({ contractFile: null });
    await deleteContractFile(ctx.tenant.slug, id, cf.storedFilename);

    await logClinicaAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "pacientes.contract_deleted",
      entity: "Patient",
      entityId: id,
      before: { contractFile: contractView(cf) },
      after: { contractFile: null },
      ip: request.headers.get("x-forwarded-for"),
    });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
