/**
 * lib/clinica/avisoComentarioIncidencia.js — que un comentario en una
 * incidencia llegue a quien va dirigido (02/09/2026, Rodrigo).
 *
 * EL PROBLEMA
 * El comentario se guardaba bien (append atómico en el JSONB, ver el PATCH de
 * `app/api/clinica/incidencias/[id]/route.js`) y ahí se quedaba: nadie recibía
 * nada. La campana solo conocía `incidencia_pending` —asignada a mí y sin
 * empezar—, que se sincroniza al abrirla mirando el ESTADO; un comentario no
 * cambia el estado, así que no movía nada. Resultado: se escribía «para los
 * compañeros» y los compañeros no se enteraban salvo que abrieran la ficha por
 * su cuenta. Y si tenían el listado cargado de antes, ni así.
 *
 * QUIÉN SE ENTERA
 * Las personas que ya están en la conversación: quien la registró, sus
 * responsables (por la pivote `incidencia_assignees`, con caída al espejo
 * `assignedToId` en un tenant sin migrar) y quien haya comentado antes. Nunca
 * quien escribe: avisarse a uno mismo es ruido. Si después de quitar al autor
 * no queda nadie —una incidencia sin responsable que comenta la misma persona
 * que la abrió— se avisa a dirección, que es quien puede darle salida.
 *
 * La campana va por usuario de `master` y las incidencias por ficha de equipo:
 * se cruza por `TeamMember.userId`, igual que `lib/documents/lecturas.js`.
 * Quien no tiene cuenta en el CRM no tiene campana que tocar.
 *
 * Tipo NUEVO y fuera de `AUTO_TYPES`: un comentario es un hecho, no un estado.
 * Nadie lo sincroniza ni lo borra; se lee y se marca leído como cualquier otro.
 * Sin `dedupe`: dos comentarios son dos avisos.
 *
 * Best-effort de principio a fin: un aviso caído no puede impedir que el
 * comentario se guarde, que es lo que ya funcionaba.
 *
 * La DECISIÓN (a quién y con qué texto) va separada de la ENTREGA
 * (`notifyUsers` / `notifyAdmins`) para poder probarla sin base de datos en
 * `scripts/_smoke-aviso-comentario-incidencia.mjs`.
 */

import { Op } from "sequelize";

import { notifyUsers, notifyAdmins } from "../notifications/notifyUsers.js";

/** Tipo de la campana. Fuera de `AUTO_TYPES`: nadie lo sincroniza ni lo borra. */
export const TIPO_AVISO = "incidencia_comentario";

/**
 * Pura: qué fichas de equipo tienen que enterarse. Sin el autor, sin repetidos.
 * `incidencia.comments` puede llevar ya el comentario nuevo: su autor se quita
 * igualmente.
 */
export function fichasQueSeEnteran({ incidencia, responsables = [], autorTeamMemberId = null }) {
  const ids = new Set();
  if (incidencia?.reportedById) ids.add(incidencia.reportedById);
  if (incidencia?.assignedToId) ids.add(incidencia.assignedToId);
  for (const id of responsables) if (id) ids.add(id);
  const hilo = Array.isArray(incidencia?.comments) ? incidencia.comments : [];
  for (const c of hilo) if (c?.authorId) ids.add(c.authorId);
  if (autorTeamMemberId) ids.delete(autorTeamMemberId);
  return [...ids];
}

/** Pura: el aviso tal cual va a la campana. */
export function avisoDeComentario({ incidencia, comentario }) {
  const quien = comentario?.authorName || "Alguien";
  const texto = String(comentario?.text ?? "").replace(/\s+/g, " ").trim();
  // El recorte es un anticipo: la conversación se lee en la ficha, no en la campana.
  const recorte = texto.length > 120 ? `${texto.slice(0, 117).trimEnd()}…` : texto;
  return {
    type: TIPO_AVISO,
    title: `${quien} ha comentado una incidencia`,
    body: `«${incidencia?.title ?? "Incidencia"}» · ${recorte}`,
    entityType: "Incidencia",
    entityId: incidencia?.id ?? null,
  };
}

/**
 * Entrega. `row` es la incidencia con sus `assignees` incluidos si se cargó
 * con el include (se ahorra la consulta a la pivote); si no, se consulta.
 * `autorUserId` es `x-user-id`: un admin sin ficha de equipo también comenta,
 * y tampoco hay que avisarle a él.
 *
 * `entregarADireccion` solo se sustituye en las pruebas.
 */
export async function avisarComentarioIncidencia({
  ctx,
  row,
  comentario,
  autorTeamMemberId = null,
  autorUserId = null,
  entregarADireccion = notifyAdmins,
}) {
  try {
    const M = ctx?.tenantModels ?? {};
    const { TeamMember, IncidenciaAssignee } = M;
    if (!TeamMember || !row?.id) return;

    let responsables = [];
    if (Array.isArray(row.assignees)) {
      responsables = row.assignees.map((a) => a?.id).filter(Boolean);
    } else if (IncidenciaAssignee) {
      const enlaces = await IncidenciaAssignee.findAll({
        where: { incidenciaId: row.id },
        attributes: ["teamMemberId"],
        raw: true,
      });
      responsables = enlaces.map((e) => e.teamMemberId);
    }

    const fichas = fichasQueSeEnteran({ incidencia: row, responsables, autorTeamMemberId });
    const aviso = avisoDeComentario({ incidencia: row, comentario });

    let userIds = [];
    if (fichas.length) {
      const filas = await TeamMember.findAll({
        where: { id: { [Op.in]: fichas } },
        attributes: ["userId"],
        raw: true,
      });
      userIds = filas.map((f) => f.userId).filter((u) => u && u !== autorUserId);
    }

    if (userIds.length) {
      // `reemplazar`: cada comentario vuelve a encender la campana (el índice
      // único de notifications dejaría pasar solo el primero).
      await notifyUsers({ tenantModels: M, userIds, ...aviso, reemplazar: true });
      return;
    }
    // Nadie más en la conversación: que lo vea dirección (menos quien escribe).
    await entregarADireccion({
      tenantId: ctx?.tenantId ?? ctx?.tenant?.id ?? null,
      tenantModels: M,
      excepto: autorUserId,
      reemplazar: true,
      ...aviso,
    });
  } catch (err) {
    process.stderr.write(`[incidencias:campana] no se pudo avisar del comentario: ${err.message}\n`);
  }
}
