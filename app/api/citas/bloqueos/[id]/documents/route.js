import { randomUUID } from "node:crypto";
import { Op } from "sequelize";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../../../lib/team/currentTeamMember.js";
import {
  MAX_FILE_SIZE_BYTES,
  quotaBytesDe,
  getTenantStorageUsage,
  saveDocumentFile,
  deleteDocumentFile,
  sanitizeFileName,
  extFromFileName,
} from "../../../../../../lib/documents/documentStorage.js";
import {
  sincronizaLectores,
  avisaALosLectores,
  resumenDeLecturas,
} from "../../../../../../lib/documents/lecturas.js";

/**
 * Documentos APAREJADOS A UN BLOQUEO de la agenda (01/09/2026, Rodrigo).
 *
 *   GET   /api/citas/bloqueos/[id]/documents   los del tramo, con su lectura
 *   POST  /api/citas/bloqueos/[id]/documents   subir uno (multipart) y, de paso,
 *                                              pedirle la lectura a quien toque
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Quiero poder aparejarlo a un bloqueo concreto, por ejemplo el miércoles 2 en
 * la Reunión de equipo de 12:00-13:00, para que si entran en la cita del
 * bloqueo vean el documento aparejado. También se tiene que poder hacer a la
 * inversa, subir el documento a través del modal de ese bloqueo concreto.»
 *
 * Las dos direcciones son la MISMA pareja (`documents.team_block_id`): desde el
 * archivo se elige el bloqueo, desde el bloqueo se sube el documento, y en los
 * dos casos acaba en la misma columna. Por eso no hay dos conceptos, hay uno.
 *
 * ── QUÉ NO ES ───────────────────────────────────────────────────────────────
 * No es un archivo aparte: el documento va al ARCHIVO CENTRAL como todos los
 * demás (`documents`, `source='bloqueo'`, `visibility='shared'`), así que se
 * busca desde Documentos, cuenta para la cuota y se descarga con las mismas
 * reglas. Este endpoint solo es la puerta que le pone el bloqueo.
 *
 * ── GATE ────────────────────────────────────────────────────────────────────
 * `citas`, el mismo que el bloqueo, y NO `documents_avanzado`: el acta de la
 * reunión del equipo es de la agenda, y un centro con Citas y sin el archivo
 * completo tiene que poder colgarla igual. Es el mismo criterio que los
 * documentos de una incidencia, que se gatean por Clínica.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DOCS_POR_BLOQUEO = 20;

function gate(ctx) {
  if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
  return null;
}

function serializa(doc, lecturas, miTeamMemberId) {
  return {
    id: doc.id,
    name: doc.fileName,
    mimeType: doc.mimeType,
    fileSize: Number(doc.fileSize),
    createdAt: doc.createdAt,
    // Quién tiene que leerlo y quién ya lo hizo, con nombre: el modal del
    // bloqueo lo pinta tal cual, sin cruzar nada.
    lectores: lecturas.map((l) => ({
      teamMemberId: l.teamMemberId,
      nombre: l.teamMember?.displayName ?? null,
      leido: !!l.readAt,
      readAt: l.readAt ?? null,
    })),
    lectura: resumenDeLecturas(lecturas, miTeamMemberId),
  };
}

// Las lecturas de una tanda de documentos, agrupadas por documento. Una sola
// consulta para toda la lista: son 20 documentos como mucho, pero cada uno con
// su query serían 20 viajes en cada apertura del modal.
async function lecturasDe(tenantModels, docIds) {
  const { DocumentRead, TeamMember } = tenantModels;
  const porDoc = new Map(docIds.map((id) => [id, []]));
  if (!DocumentRead || !docIds.length) return porDoc;
  try {
    const filas = await DocumentRead.findAll({
      where: { documentId: { [Op.in]: docIds } },
      include: TeamMember
        ? [{ model: TeamMember, as: "teamMember", attributes: ["id", "displayName"], required: false }]
        : [],
      order: [["createdAt", "ASC"]],
    });
    for (const f of filas) porDoc.get(f.documentId)?.push(f);
  } catch {
    // Un acuse de lectura no puede impedir ver los documentos del bloqueo.
  }
  return porDoc;
}

export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { TeamBlock, Document } = ctx.tenantModels;
    if (!TeamBlock || !Document) return ok({ documents: [], total: 0, limit: MAX_DOCS_POR_BLOQUEO });

    const bloqueo = await TeamBlock.findByPk(id, { attributes: ["id"] });
    if (!bloqueo) return notFound("Bloqueo no encontrado");

    // Un cliente con Citas y sin Clientes no tiene tabla `documents` (el
    // archivo cuelga de `clients`). Ahí el tramo simplemente no lleva
    // documentos, en vez de reventar el modal del bloqueo con un 500.
    let filas = [];
    try {
      filas = await Document.findAll({
        where: { teamBlockId: id },
        order: [["createdAt", "DESC"]],
        limit: MAX_DOCS_POR_BLOQUEO,
      });
    } catch (e) {
      if (!/relation .* does not exist/i.test(e.message) && e?.parent?.code !== "42P01") throw e;
      return ok({ documents: [], total: 0, limit: MAX_DOCS_POR_BLOQUEO });
    }
    const miTm = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
    const lecturas = await lecturasDe(ctx.tenantModels, filas.map((d) => d.id));

    return ok({
      documents: filas.map((d) => serializa(d, lecturas.get(d.id) ?? [], miTm)),
      total: filas.length,
      limit: MAX_DOCS_POR_BLOQUEO,
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido");
    const ownerUserId = request.headers.get("x-user-id");
    if (!ownerUserId) return error("No autorizado", 401);

    const { TeamBlock, Document } = ctx.tenantModels;
    if (!TeamBlock || !Document) return error("Los documentos no están disponibles en este cliente", 503);

    const bloqueo = await TeamBlock.findByPk(id, { attributes: ["id"] });
    if (!bloqueo) return notFound("Bloqueo no encontrado");

    const cuantos = await Document.count({ where: { teamBlockId: id } });
    if (cuantos >= MAX_DOCS_POR_BLOQUEO) {
      return error(`Límite alcanzado: máximo ${MAX_DOCS_POR_BLOQUEO} documentos por bloqueo`, 422);
    }

    let form;
    try { form = await request.formData(); } catch { return error("Body inválido: se esperaba multipart/form-data", 400); }

    const file = form.get("file");
    if (!file || typeof file === "string") return error("Campo 'file' obligatorio (multipart)", 422);

    // NOMBRE obligatorio, como en incidencias y en pacientes: en la lista del
    // bloqueo se lee el nombre, no el fichero que salió del escáner.
    const nameRaw = form.get("name");
    const name = typeof nameRaw === "string" ? nameRaw.trim().slice(0, 200) : "";
    if (!name) return error("El nombre del documento es obligatorio", 422);

    const declaredMime = file.type || "application/octet-stream";
    if (typeof file.size === "number" && file.size > MAX_FILE_SIZE_BYTES) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const realSize = buffer.length;
    if (realSize > MAX_FILE_SIZE_BYTES) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }

    const usage = await getTenantStorageUsage(ctx.tenant.slug);
    if (usage + realSize > quotaBytesDe(ctx)) return error("Cuota de almacenamiento superada", 507);

    const ext = extFromFileName(file.name);
    const yaTieneExt = /\.[A-Za-z0-9]{1,10}$/.test(name);
    const fileName = sanitizeFileName(yaTieneExt || !ext ? name : `${name}.${ext}`);

    const documentId = randomUUID();
    // 'shared': lo que cuelga de un tramo de la agenda es del centro, y quien
    // abre el bloqueo tiene que poder leerlo aunque no lo subiera él.
    const storagePath = await saveDocumentFile(ctx.tenant.slug, "shared", documentId, buffer, ext);

    let row;
    try {
      row = await Document.create({
        id: documentId,
        folderId: null,
        visibility: "shared",
        ownerUserId,
        fileName,
        storagePath,
        fileSize: realSize,
        mimeType: declaredMime,
        teamBlockId: id,
        source: "bloqueo",
      });
    } catch (dbErr) {
      await deleteDocumentFile(ctx.tenant.slug, storagePath);
      throw dbErr;
    }

    // Y a quién hay que pedirle que lo lea. Va DESPUÉS de crear el documento y
    // fuera de su camino crítico: si esto fallara, el acta ya está subida.
    const { nuevos } = await sincronizaLectores({
      tenantModels: ctx.tenantModels,
      documentId: row.id,
      teamMemberIds: form.get("lectores"),
      assignedById: ownerUserId,
    });
    await avisaALosLectores({ tenantModels: ctx.tenantModels, teamMemberIds: nuevos, documento: row });

    const miTm = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
    const lecturas = await lecturasDe(ctx.tenantModels, [row.id]);
    return created(serializa(row, lecturas.get(row.id) ?? [], miTm));
  } catch (err) {
    return serverError(err);
  }
});
