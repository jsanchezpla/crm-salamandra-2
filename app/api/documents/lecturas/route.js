import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { canView } from "@/lib/documents/helpers.js";
import { resolveCurrentTeamMemberId } from "@/lib/team/currentTeamMember.js";
import { sincronizaLectores, avisaALosLectores, marcarLeido } from "@/lib/documents/lecturas.js";

/**
 * /api/documents/lecturas — los documentos que HAY QUE LEER (01/09/2026, Rodrigo).
 *
 *   GET   ?ambito=mias|centro   lo que me falta a mí · el estado de todo (admin)
 *   GET   ?documentId=UUID      a quién se le ha pedido ESE documento
 *   POST  { documentId, teamMemberIds }   a quién se le pide la lectura
 *   PATCH { documentId }        marcar como leída LA MÍA
 *
 * ── QUIÉN PUEDE QUÉ ─────────────────────────────────────────────────────────
 * PEDIR una lectura lo puede cualquiera del equipo, sobre un documento que YA
 * PUEDE VER (`canView`: los compartidos, y los suyos si son privados). Mismo
 * criterio que los bloqueos de agenda, y por lo mismo: quien convoca la reunión
 * no siempre es dirección, y si hay que pedírselo a un admin, no se pide.
 *
 * VER EL ESTADO DEL CENTRO —quién ha leído qué— es de dirección: es una lista
 * de quién va al día y quién no, y eso no se enseña a todo el equipo. Cada cual
 * ve LAS SUYAS, que es lo que necesita para trabajar.
 *
 * MARCAR una lectura solo se puede hacer sobre la propia: el `teamMemberId` sale
 * de la sesión y no del cuerpo de la petición, así que nadie firma por otro.
 *
 * ── GATE: `team` DEL CENTRO ─────────────────────────────────────────────────
 * `tenantHasModule` y no `hasModule`, a propósito: la pregunta es si el centro
 * tiene equipo (sin equipo no hay a quién pedirle nada), no si quien mira puede
 * entrar en la pantalla de Equipo — el caso de Rocío, explicado en
 * `lib/citas/visibilidad.js`. Y NO se exige `documents_avanzado`: el acta de la
 * reunión del miércoles se lee igual en un centro sin el archivo completo.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const LIMITE = 200;

function gate(ctx) {
  if (!ctx.tenantHasModule("team")) return forbidden("Módulo team no activo");
  return null;
}

// El documento tal como lo pinta la pantalla de lecturas: qué es, de dónde
// cuelga y cómo se abre. `origen` resuelto aquí para que la página no cruce nada.
function serializaDoc(doc) {
  const bloqueo = doc.teamBlock ?? null;
  return {
    id: doc.id,
    name: doc.fileName,
    mimeType: doc.mimeType,
    fileSize: Number(doc.fileSize),
    createdAt: doc.createdAt,
    source: doc.source ?? "manual",
    // De qué tramo de la agenda cuelga, si cuelga de alguno: es el contexto que
    // convierte «acta.pdf» en «el acta de la reunión del miércoles».
    bloqueo: bloqueo
      ? { id: bloqueo.id, label: bloqueo.label, startAt: bloqueo.startAt, endAt: bloqueo.endAt }
      : null,
    // Por dónde se descarga. Los del bloqueo van por su puerta (no exige el
    // archivo avanzado); el resto, por la del archivo central.
    href: bloqueo
      ? `/api/citas/bloqueos/${bloqueo.id}/documents/${doc.id}/download`
      : `/api/documents/${doc.id}/download`,
  };
}

function includeDelDocumento(tenantModels) {
  const { Document, TeamBlock } = tenantModels;
  return {
    model: Document,
    as: "document",
    required: true,
    include: TeamBlock
      ? [{ model: TeamBlock, as: "teamBlock", attributes: ["id", "label", "startAt", "endAt"], required: false }]
      : [],
  };
}

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { DocumentRead, Document, TeamMember } = ctx.tenantModels;
    if (!DocumentRead || !Document) return ok({ lecturas: [], documentos: [], yo: null });

    const esAdmin = ADMIN_ROLES.has(request.headers.get("x-user-role"));
    const miTm = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
    const sp = new URL(request.url).searchParams;

    /*
     * Los lectores de UN documento. Lo pide el archivo central al abrir el
     * panel de «¿quién tiene que leerlo?»: sin esto, guardar una lista nueva
     * borraría a los que ya estaban sin que nadie los hubiera visto.
     *
     * Mismo permiso que pedir la lectura (POST): quien puede VER el documento.
     */
    const documentId = (sp.get("documentId") || "").trim();
    if (documentId) {
      if (!UUID_RE.test(documentId)) return error("documentId inválido", 422);
      const doc = await Document.findByPk(documentId);
      if (!doc) return notFound("Documento no encontrado");
      const userId = request.headers.get("x-user-id");
      if (!canView(doc, userId)) return forbidden("Sin acceso a este documento");
      const filas = await DocumentRead.findAll({
        where: { documentId },
        include: TeamMember
          ? [{ model: TeamMember, as: "teamMember", attributes: ["id", "displayName"], required: false }]
          : [],
        order: [["createdAt", "ASC"]],
      });
      return ok({
        lectores: filas.map((f) => ({
          teamMemberId: f.teamMemberId,
          nombre: f.teamMember?.displayName ?? null,
          leido: !!f.readAt,
          readAt: f.readAt ?? null,
        })),
      });
    }

    const ambito = sp.get("ambito") === "centro" ? "centro" : "mias";

    if (ambito === "centro") {
      // El panorama de dirección: cada documento con lectura pedida y quién la
      // tiene pendiente. No se enseña a todo el equipo (ver la cabecera).
      if (!esAdmin) return forbidden("El estado de lectura del centro es de dirección");
      const filas = await DocumentRead.findAll({
        include: [
          includeDelDocumento(ctx.tenantModels),
          ...(TeamMember
            ? [{ model: TeamMember, as: "teamMember", attributes: ["id", "displayName"], required: false }]
            : []),
        ],
        order: [["createdAt", "DESC"]],
        limit: LIMITE,
      });
      // Agrupado por documento: la pregunta de dirección es «¿quién no ha
      // leído el protocolo?», no «cuántas filas hay».
      const porDoc = new Map();
      for (const f of filas) {
        const doc = f.document;
        if (!doc) continue;
        if (!porDoc.has(doc.id)) porDoc.set(doc.id, { ...serializaDoc(doc), lectores: [] });
        porDoc.get(doc.id).lectores.push({
          teamMemberId: f.teamMemberId,
          nombre: f.teamMember?.displayName ?? null,
          leido: !!f.readAt,
          readAt: f.readAt ?? null,
        });
      }
      const documentos = [...porDoc.values()].map((d) => ({
        ...d,
        pendientes: d.lectores.filter((l) => !l.leido).length,
      }));
      return ok({ documentos, yo: { teamMemberId: miTm, esAdmin } });
    }

    // Las MÍAS. Sin ficha de equipo no hay lecturas propias: lista vacía, no
    // las de todo el centro (un aviso solo es un aviso si es para ti).
    if (!miTm) return ok({ lecturas: [], pendientes: 0, yo: { teamMemberId: null, esAdmin } });

    const filas = await DocumentRead.findAll({
      where: { teamMemberId: miTm },
      include: [includeDelDocumento(ctx.tenantModels)],
      // Lo más nuevo arriba; lo PENDIENTE se sube después, en memoria (son 200
      // filas como mucho y así el criterio se lee de un vistazo). Lo que hay
      // que hacer no se busca, se ve.
      order: [[{ model: Document, as: "document" }, "createdAt", "DESC"]],
      limit: LIMITE,
    });

    const lecturas = filas
      .filter((f) => f.document)
      .map((f) => ({
        id: f.id,
        leido: !!f.readAt,
        readAt: f.readAt ?? null,
        pedidaEl: f.createdAt,
        documento: serializaDoc(f.document),
      }))
      .sort((a, b) => Number(a.leido) - Number(b.leido));

    return ok({
      lecturas,
      pendientes: lecturas.filter((l) => !l.leido).length,
      yo: { teamMemberId: miTm, esAdmin },
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { Document } = ctx.tenantModels;
    if (!Document) return error("Los documentos no están disponibles en este cliente", 503);

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
    if (!UUID_RE.test(documentId)) return error("documentId inválido", 422);

    const doc = await Document.findByPk(documentId);
    if (!doc) return notFound("Documento no encontrado");
    // Sobre lo que uno no puede ver, tampoco puede pedir que lo lea otro: sería
    // una forma de repartir un documento privado sin abrirlo.
    if (!canView(doc, userId)) return forbidden("Sin acceso a este documento");

    const { nuevos, quitados, total } = await sincronizaLectores({
      tenantModels: ctx.tenantModels,
      documentId,
      teamMemberIds: body.teamMemberIds,
      assignedById: userId,
    });
    await avisaALosLectores({ tenantModels: ctx.tenantModels, teamMemberIds: nuevos, documento: doc });

    return ok({ pedidas: total, nuevas: nuevos.length, quitadas: quitados });
  } catch (err) {
    return serverError(err);
  }
});

export const PATCH = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
    if (!UUID_RE.test(documentId)) return error("documentId inválido", 422);

    // De la sesión, NUNCA del cuerpo: nadie firma la lectura de otro.
    const miTm = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
    if (!miTm) return forbidden("Tu usuario no está enlazado con una ficha de equipo");

    const marcada = await marcarLeido({ tenantModels: ctx.tenantModels, documentId, teamMemberId: miTm });
    // `false` también es un final bueno: ya estaba leída, o no era mía. Se
    // contesta el estado, no un error — la pantalla solo tiene que refrescar.
    return ok({ marcada });
  } catch (err) {
    return serverError(err);
  }
});
