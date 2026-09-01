/**
 * lib/documents/lecturas.js — «este documento tienes que leerlo tú»
 * (01/09/2026, Rodrigo).
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Cuando quiero subir un documento, quiero poder tagear a los miembros de mi
 * equipo para que les salte un aviso de que ese documento lo tienen que leer en
 * la pantalla de inicio.»
 *
 * Aquí viven las reglas de ese aviso, en un solo sitio, porque hay CUATRO
 * puertas que lo tocan y ninguna puede tener su propia versión:
 *
 *   · el modal del bloqueo de la agenda (se sube el acta y se elige quién la lee),
 *   · el archivo central (se pide la lectura de algo ya subido),
 *   · la descarga y la vista previa (abrirlo ES leerlo),
 *   · la portada y la bandeja (cuántas me faltan).
 *
 * ── QUÉ CUENTA COMO LEER ────────────────────────────────────────────────────
 * ABRIRLO. No hay «marcar como leído» de mentira que se pulse sin mirar: la
 * marca la pone la descarga o la vista previa del propio documento. El botón
 * existe igualmente para el caso en que alguien ya lo conocía (venía por correo,
 * se leyó en la reunión), y es el mismo sello — solo cambia quién lo dispara.
 *
 * ── UNA LECTURA YA HECHA NO SE BORRA AL REASIGNAR ──────────────────────────
 * Al cambiar la lista de lectores se quitan los que ya no están… salvo los que
 * YA LEYERON: ese acuse es la respuesta a «¿se enteró todo el mundo?» y no
 * puede desaparecer porque alguien reabra el desplegable y guarde. Se quitan
 * solo las lecturas PENDIENTES que sobran, que es lo que de verdad significa
 * «ya no tiene que leerlo».
 */

import { Op } from "sequelize";
import { notifyUsers } from "../notifications/notifyUsers.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tope de personas por documento. No es una regla de negocio, es un freno: el
 * campo viaja desde el navegador y sin límite una petición podría pedir mil
 * inserciones. Ningún equipo del CRM pasa de 50 (el mayor, Aumenta, son 15).
 */
export const MAX_LECTORES = 50;

/**
 * Los lectores que vienen del navegador, limpios: acepta un array o el JSON de
 * un array (el modal de subida viaja en multipart, donde todo es texto), tira
 * lo que no sea un UUID, quita repetidos y corta en `MAX_LECTORES`.
 *
 * Devuelve SIEMPRE un array. Vacío = «no hay que pedirle la lectura a nadie»,
 * que es lo que son casi todos los documentos.
 */
export function normalizaLectores(valor) {
  let lista = valor;
  if (typeof valor === "string") {
    const texto = valor.trim();
    if (!texto) return [];
    try {
      lista = JSON.parse(texto);
    } catch {
      // Tolerante a propósito: "id,id,id" es lo que manda un formulario simple.
      lista = texto.split(",");
    }
  }
  if (!Array.isArray(lista)) return [];
  const vistos = new Set();
  for (const bruto of lista) {
    const id = typeof bruto === "string" ? bruto.trim() : "";
    if (UUID_RE.test(id)) vistos.add(id.toLowerCase());
    if (vistos.size >= MAX_LECTORES) break;
  }
  return [...vistos];
}

/**
 * El resumen de un documento para la pantalla: cuántos tienen que leerlo,
 * cuántos lo han leído y si lo he leído YO.
 *
 * `filas` son las lecturas del documento (`DocumentRead`), en crudo o
 * serializadas: solo se miran `teamMemberId` y `readAt`. Función pura — la
 * pinta el modal del bloqueo y el listado del archivo, y la fija
 * `_smoke-documentos-lecturas.mjs`.
 */
export function resumenDeLecturas(filas, miTeamMemberId = null) {
  const lista = Array.isArray(filas) ? filas : [];
  let leidas = 0;
  let miLectura = null;
  for (const f of lista) {
    if (f?.readAt) leidas++;
    if (miTeamMemberId && f?.teamMemberId === miTeamMemberId) miLectura = f;
  }
  return {
    total: lista.length,
    leidas,
    pendientes: lista.length - leidas,
    // null = a mí no me la han pedido; true/false = la tengo y en qué estado.
    mia: miLectura ? { pedida: true, leida: !!miLectura.readAt, readAt: miLectura.readAt ?? null } : null,
  };
}

/**
 * Deja la lista de lectores de un documento EXACTAMENTE como se pide:
 * crea las que faltan, respeta las que ya estaban y borra las pendientes que
 * sobran (las ya leídas se conservan; ver la cabecera).
 *
 * Solo acepta fichas de equipo que EXISTAN en el tenant: un id inventado desde
 * el navegador se guardaría como una lectura fantasma que nadie puede cerrar.
 * Devuelve los ids realmente NUEVOS, que son a los que hay que avisar — volver
 * a guardar el mismo documento no vuelve a tocarle la campana a nadie.
 */
export async function sincronizaLectores({ tenantModels, documentId, teamMemberIds, assignedById = null }) {
  const { DocumentRead, TeamMember } = tenantModels ?? {};
  if (!DocumentRead || !documentId) return { nuevos: [], quitados: 0, total: 0 };

  const pedidos = normalizaLectores(teamMemberIds);
  let validos = pedidos;
  if (pedidos.length && TeamMember) {
    const fichas = await TeamMember.findAll({ where: { id: { [Op.in]: pedidos } }, attributes: ["id"], raw: true });
    const existen = new Set(fichas.map((f) => f.id));
    validos = pedidos.filter((id) => existen.has(id));
  }

  const yaEstaban = await DocumentRead.findAll({
    where: { documentId },
    attributes: ["id", "teamMemberId", "readAt"],
    raw: true,
  });
  const porMiembro = new Map(yaEstaban.map((f) => [f.teamMemberId, f]));

  const nuevos = validos.filter((id) => !porMiembro.has(id));
  if (nuevos.length) {
    await DocumentRead.bulkCreate(
      nuevos.map((teamMemberId) => ({ documentId, teamMemberId, assignedById })),
      // Dos pestañas guardando a la vez no pueden reventar con un 23505: el
      // índice único ya garantiza una fila por persona.
      { ignoreDuplicates: true }
    );
  }

  const sobran = yaEstaban.filter((f) => !validos.includes(f.teamMemberId) && !f.readAt).map((f) => f.id);
  let quitados = 0;
  if (sobran.length) quitados = await DocumentRead.destroy({ where: { id: { [Op.in]: sobran } } });

  return { nuevos, quitados, total: validos.length };
}

/**
 * Toca la campana de los lectores NUEVOS de un documento.
 *
 * La campana va por usuario de master y las lecturas por ficha de equipo, así
 * que se cruza por `TeamMember.userId`. Quien no tenga cuenta en el CRM se
 * queda con su lectura pendiente igual: la verá quien mire el estado del
 * documento, y la portada solo avisa a quien puede entrar.
 *
 * Best-effort como toda la infra de campana: un aviso caído no puede tumbar la
 * subida de un documento.
 */
export async function avisaALosLectores({ tenantModels, teamMemberIds, documento }) {
  try {
    const { TeamMember } = tenantModels ?? {};
    if (!TeamMember || !Array.isArray(teamMemberIds) || !teamMemberIds.length) return;
    const fichas = await TeamMember.findAll({
      where: { id: { [Op.in]: teamMemberIds } },
      attributes: ["userId"],
      raw: true,
    });
    const userIds = fichas.map((f) => f.userId).filter(Boolean);
    if (!userIds.length) return;
    await notifyUsers({
      tenantModels,
      userIds,
      type: "documento_por_leer",
      title: "Un documento que tienes que leer",
      body: documento?.fileName ? `«${documento.fileName}»` : null,
      entityType: "Document",
      entityId: documento?.id ?? null,
      // Por si se vuelve a pedir la misma lectura: un hecho, un aviso.
      dedupe: true,
    });
  } catch {
    // Best-effort: la campana no puede impedir que se suba un documento.
  }
}

/**
 * Sella MI lectura de un documento. Idempotente: leerlo dos veces no mueve la
 * fecha del primer día, que es la que interesa («¿cuándo se enteró?»).
 *
 * Devuelve true solo si esta llamada es la que lo marcó. Nunca lanza: la usa la
 * descarga, y un fallo aquí no puede impedir que alguien abra su documento.
 */
export async function marcarLeido({ tenantModels, documentId, teamMemberId }) {
  try {
    const { DocumentRead } = tenantModels ?? {};
    if (!DocumentRead || !documentId || !teamMemberId) return false;
    const [n] = await DocumentRead.update(
      { readAt: new Date() },
      { where: { documentId, teamMemberId, readAt: null } }
    );
    return n > 0;
  } catch {
    return false;
  }
}

/**
 * Cuántos documentos me faltan por leer. La cifra de la portada.
 *
 * Sin ficha de equipo no hay lecturas propias: devuelve 0 en vez de contar las
 * de todo el centro — un aviso solo es un aviso si es para ti.
 */
export async function cuentaPendientes({ tenantModels, teamMemberId }) {
  const { DocumentRead } = tenantModels ?? {};
  if (!DocumentRead || !teamMemberId) return 0;
  return DocumentRead.count({ where: { teamMemberId, readAt: null } });
}
