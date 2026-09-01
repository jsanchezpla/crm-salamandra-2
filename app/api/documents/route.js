import { randomUUID } from "node:crypto";
import { Op } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, created, error, forbidden, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import {
  logDocumentsAudit,
  resolveOwnerNames,
  visibilityWhere,
  whereCarpetasVisibles,
  whereDocumentosVisibles,
  canCreateInside,
  ownerSegmentFor,
  serializeDocument,
} from "@/lib/documents/helpers.js";
import {
  MAX_FILE_SIZE_BYTES,
  TENANT_QUOTA_BYTES,
  quotaBytesDe,
  isAllowedMime,
  validateMimeMagicBytes,
  getTenantStorageUsage,
  saveDocumentFile,
  deleteDocumentFile,
  sanitizeFileName,
  extFromFileName,
} from "@/lib/documents/documentStorage.js";
import { sincronizaLectores, avisaALosLectores } from "@/lib/documents/lecturas.js";
import { carpetasCompartidasCon } from "@/lib/documents/carpetasCompartidas.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/documents?folderId=<uuid|null>&visibility=private|shared|all&q=&all=1
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS_AVANZADO)) return forbidden("El archivo de documentos exige el módulo Documentos avanzado");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();

    const { Document, DocumentFolder } = ctx.tenantModels;
    const sp = new URL(request.url).searchParams;
    const visibility = ["private", "shared", "all"].includes(sp.get("visibility")) ? sp.get("visibility") : "all";

    // Lo que le han compartido a quien mira (01/09/2026): un documento se ve
    // también si vive en una carpeta que está en su lista.
    const { todas: carpetasCompartidas } = await carpetasCompartidasCon({ tenantModels: ctx.tenantModels, userId });
    const where = whereDocumentosVisibles(userId, visibility, carpetasCompartidas);

    // Modo BÚSQUEDA (archivo central): filtrar por cliente, origen o texto
    // recorre TODO el archivo, ignorando la carpeta. `all=1` es lo mismo sin
    // filtro (la pantalla «Todos los documentos»). Modo NAVEGACIÓN: se
    // mantiene el comportamiento por carpeta de siempre.
    const clientId = sp.get("clientId");
    const patientId = sp.get("patientId");
    const source = sp.get("source");
    const q = (sp.get("q") || "").trim();
    const modoBusqueda = sp.get("all") === "1" || clientId || patientId || source || q;

    if (clientId && clientId !== "null") {
      if (!UUID_RE.test(clientId)) return error("clientId inválido", 400);
      where.clientId = clientId;
    }
    if (patientId && patientId !== "null") {
      if (!UUID_RE.test(patientId)) return error("patientId inválido", 400);
      where.patientId = patientId;
    }
    if (source) where.source = source.slice(0, 40);
    if (q) where.fileName = { [Op.iLike]: `%${q}%` };

    if (!modoBusqueda) {
      const folderParam = sp.get("folderId");
      if (folderParam && folderParam !== "null") {
        if (!UUID_RE.test(folderParam)) return error("folderId inválido", 400);
        where.folderId = folderParam;
      } else {
        where.folderId = null;
      }
    }

    // LIMIT defensivo (sin paginación aún; la UI del Sprint 2 la añadirá).
    const rows = await Document.findAll({ where, order: [["fileName", "ASC"]], limit: 1000 });
    const names = await resolveOwnerNames(rows.map((r) => r.ownerUserId));

    // En modo búsqueda el documento sale de su carpeta, así que hay que decir
    // de cuál: se resuelve la ruta completa («Carpeta / Subcarpeta») en memoria.
    let rutaDeCarpeta = null;
    if (modoBusqueda) {
      const folders = await DocumentFolder.findAll({
        where: whereCarpetasVisibles(userId, visibility, carpetasCompartidas),
        attributes: ["id", "name", "parentFolderId"],
      });
      const porId = new Map(folders.map((f) => [f.id, f]));
      rutaDeCarpeta = (folderId) => {
        const partes = [];
        let actual = folderId ? porId.get(folderId) : null;
        let guarda = 0; // el árbol tiene 4 niveles como mucho; esto para cualquier ciclo raro
        while (actual && guarda++ < 8) {
          partes.unshift(actual.name);
          actual = actual.parentFolderId ? porId.get(actual.parentFolderId) : null;
        }
        return partes.length ? partes.join(" / ") : null;
      };
    }

    return ok({
      documents: rows.map((d) => {
        const base = serializeDocument(d, names.get(d.ownerUserId));
        return rutaDeCarpeta ? { ...base, folderPath: rutaDeCarpeta(d.folderId) } : base;
      }),
    });
  } catch (err) {
    return serverError(err);
  }
});

// POST /api/documents (multipart: file + folderId? + visibility?)
export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS_AVANZADO)) return forbidden("El archivo de documentos exige el módulo Documentos avanzado");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();

    const { Document, DocumentFolder } = ctx.tenantModels;

    // Guard por Content-Length ANTES de parsear: el runtime rechaza cuerpos
    // grandes en request.formData() (throw genérico) antes de que podamos medir
    // el archivo; así devolvemos un 413 claro en vez de un 400 de "body inválido".
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength && contentLength > MAX_FILE_SIZE_BYTES + 1024 * 1024) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return error("Body inválido: se esperaba multipart/form-data", 400);
    }

    const file = form.get("file");
    if (!file || typeof file === "string") return error("Campo 'file' obligatorio (multipart)", 400);

    // Carpeta destino (opcional) → determina la visibilidad heredada.
    const folderRaw = form.get("folderId");
    const folderId = folderRaw && folderRaw !== "null" ? String(folderRaw) : null;
    let visibility;
    if (folderId) {
      if (!UUID_RE.test(folderId)) return error("folderId inválido", 400);
      const folder = await DocumentFolder.findByPk(folderId);
      if (!folder) return error("La carpeta no existe", 404);
      if (!canCreateInside(folder, userId)) return forbidden("Sin acceso a la carpeta destino");
      visibility = folder.visibility; // heredada
    } else {
      visibility = form.get("visibility");
      if (!["private", "shared"].includes(visibility)) {
        return error("visibility debe ser 'private' o 'shared' para documentos en la raíz", 400);
      }
    }

    // Archivo central transversal (2026-07-23): se acepta CUALQUIER tipo. Solo
    // se exige que venga un Content-Type. La comprobación de magic bytes sigue
    // aplicándose a los tipos que sabemos verificar (PDF/OOXML); para el resto
    // se confía en el Content-Type (el archivo se sirve como adjunto, nunca se
    // ejecuta).
    const declaredMime = file.type || "application/octet-stream";

    // Guard barato con el tamaño declarado (evita leer un archivo gigante).
    if (typeof file.size === "number" && file.size > MAX_FILE_SIZE_BYTES) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const realSize = buffer.length; // bytes REALES medidos en servidor
    if (realSize > MAX_FILE_SIZE_BYTES) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }

    // Magic bytes SOLO para los tipos que sabemos verificar. Para el resto
    // (imágenes, txt, etc.) se acepta: es un archivo, no un ejecutable.
    if (isAllowedMime(declaredMime) && !validateMimeMagicBytes(buffer, declaredMime)) {
      return error("El contenido del archivo no coincide con su tipo declarado", 400);
    }

    // Cuota del tenant (bytes reales en disco + este archivo).
    const usage = await getTenantStorageUsage(ctx.slug);
    if (usage + realSize > quotaBytesDe(ctx)) {
      return error(
        `Cuota de almacenamiento superada (${(quotaBytesDe(ctx) / (1024 * 1024 * 1024)).toFixed(0)} GB por tenant)`,
        507
      );
    }

    const documentId = randomUUID();
    const ext = extFromFileName(file.name);

    // NOMBRE del documento en el CRM. La UI obliga a ponerlo (modal). Si viene,
    // se usa como nombre para mostrar (conservando la extensión del fichero para
    // que la descarga siga teniendo tipo). Si no, se cae al nombre del fichero.
    const nameRaw = form.get("name");
    const providedName = typeof nameRaw === "string" ? nameRaw.trim().slice(0, 200) : "";
    let fileName;
    if (providedName) {
      const yaTieneExt = /\.[A-Za-z0-9]{1,10}$/.test(providedName);
      fileName = sanitizeFileName(yaTieneExt || !ext ? providedName : `${providedName}.${ext}`);
    } else {
      fileName = sanitizeFileName(file.name);
    }
    const ownerSegment = ownerSegmentFor(visibility, userId);

    // Escribir a disco; si el INSERT falla, limpiar el archivo (best-effort atómico).
    const storagePath = await saveDocumentFile(ctx.slug, ownerSegment, documentId, buffer, ext);

    // Cliente y/o paciente al que se asocia el documento subido desde el módulo.
    const clientIdRaw = form.get("clientId");
    const clientId = typeof clientIdRaw === "string" && UUID_RE.test(clientIdRaw) ? clientIdRaw : null;
    const patientIdRaw = form.get("patientId");
    const patientId = typeof patientIdRaw === "string" && UUID_RE.test(patientIdRaw) ? patientIdRaw : null;
    /*
     * El BLOQUEO de agenda al que se apareja (01/09/2026, Rodrigo): la otra
     * dirección de «subir el acta desde el modal del bloqueo». Desde aquí se
     * cuelga un documento que YA está en el archivo del tramo que toque.
     * Se comprueba contra la tabla: un id inventado desde el navegador se
     * guardaría como una pareja fantasma que no se puede abrir desde ningún
     * sitio. Lo que no cuela se queda a null, sin rechazar la subida — el
     * documento es lo importante, la pareja es un añadido.
     */
    const teamBlockRaw = form.get("teamBlockId");
    let teamBlockId = typeof teamBlockRaw === "string" && UUID_RE.test(teamBlockRaw) ? teamBlockRaw : null;
    if (teamBlockId) {
      // El try/catch NO es decorativo: `documents` ya no exige `citas`
      // (24/08/2026), así que hay clientes con archivo y SIN tabla
      // `team_blocks`. Ahí esta consulta da 42P01, y un 500 al subir un PDF
      // porque venía un campo que ese cliente no puede usar sería absurdo.
      try {
        const { TeamBlock } = ctx.tenantModels;
        const existe = TeamBlock ? await TeamBlock.findByPk(teamBlockId, { attributes: ["id"] }) : null;
        if (!existe) teamBlockId = null;
      } catch {
        teamBlockId = null;
      }
    }

    // Origen: el bloqueo manda sobre el paciente (es de dónde VIENE), y si no
    // hay ninguno de los dos, 'manual'.
    const source = teamBlockId ? "bloqueo" : patientId ? "paciente" : "manual";

    let row;
    try {
      row = await Document.create({
        id: documentId,
        folderId,
        visibility,
        ownerUserId: userId,
        fileName,
        storagePath,
        fileSize: realSize,
        mimeType: declaredMime,
        clientId,
        patientId,
        teamBlockId,
        source,
      });
    } catch (dbErr) {
      await deleteDocumentFile(ctx.slug, storagePath);
      throw dbErr;
    }

    await logDocumentsAudit({
      tenantId: ctx.tenant.id,
      userId,
      action: "document.uploaded",
      entity: "Document",
      entityId: row.id,
      before: null,
      // NO se audita fileName: puede llevar el nombre del paciente
      // ("informe-TCA-Maria.pdf") y el log vive en master (schema compartido).
      after: { mimeType: declaredMime, fileSize: realSize, visibility, folderId, clientId, patientId, source },
      ip: request.headers.get("x-forwarded-for"),
    });

    /*
     * A quién hay que pedirle que lo lea (01/09/2026, Rodrigo: «tagear a los
     * miembros de mi equipo para que les salte un aviso»). Va al FINAL y fuera
     * del camino crítico: si esto fallara, el documento ya está subido y la
     * lectura se puede pedir después desde el propio archivo.
     */
    const { nuevos } = await sincronizaLectores({
      tenantModels: ctx.tenantModels,
      documentId: row.id,
      teamMemberIds: form.get("lectores"),
      assignedById: userId,
    });
    await avisaALosLectores({ tenantModels: ctx.tenantModels, teamMemberIds: nuevos, documento: row });

    return created(serializeDocument(row, null));
  } catch (err) {
    return serverError(err);
  }
});
