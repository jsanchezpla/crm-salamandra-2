/**
 * lib/documents/carpetasCompartidas.js — qué carpetas del archivo ve cada uno
 * (01/09/2026, Rodrigo: «las carpetas creadas en Documentos tienen que poder
 * ser vistas por quien se quiera. Un selector de equipo»).
 *
 * Aquí vive TODO el cruce, porque es el punto donde chocan dos formas de
 * nombrar a una persona:
 *
 *   · el archivo (`documents`, `document_folders`) va por `ownerUserId`, que es
 *     el usuario de `master.users`;
 *   · un selector de equipo va por `teamMemberId`, que es la ficha del tenant.
 *
 * El puente es `TeamMember.userId`, y se cruza en este fichero y en ninguno
 * más: los endpoints piden «las carpetas que veo» y les llega una lista de ids.
 *
 * ── LO QUE ARRASTRA UNA CARPETA COMPARTIDA ─────────────────────────────────
 * Sus SUBCARPETAS y sus DOCUMENTOS. Compartir «Protocolos» y que dentro no se
 * vea nada sería compartir un cartel. Como el árbol tiene 4 niveles como mucho
 * (`DocumentFolder.level`), los descendientes se recogen con un bucle acotado y
 * no con una consulta recursiva: son cuatro vueltas contadas.
 *
 * ── VER, NO ESCRIBIR ────────────────────────────────────────────────────────
 * Esta lista solo abre la LECTURA. Subir, renombrar y borrar siguen siendo del
 * dueño de la carpeta (`canCreateInside` y los `ownerUserId !== userId` de los
 * endpoints no se tocan). El encargo dice «vistas».
 */

import { Op } from "sequelize";

const NIVELES = 4; // DocumentFolder.level va de 0 a 3

/**
 * Las carpetas que le han compartido a este usuario.
 *
 * Devuelve DOS listas y no una porque significan cosas distintas y la pantalla
 * las usa distinto:
 *   · `directas` — las que le compartieron a él, tal cual. Son las que se le
 *     enseñan en la RAÍZ de su archivo, esté la carpeta en el nivel que esté:
 *     si no, una subcarpeta compartida sería invisible (para llegar a ella
 *     habría que poder abrir a su madre, que no ve).
 *   · `todas` — esas y todas sus descendientes. Es lo que decide si puede ver
 *     una carpeta o un documento concreto.
 *
 * Sin ficha de equipo no hay nada compartido: dos listas vacías. Nunca lanza —
 * un archivo que no puede resolver esto enseña lo de siempre (lo suyo y lo
 * compartido con todo el centro), que es fallar CERRADO.
 */
export async function carpetasCompartidasCon({ tenantModels, userId }) {
  const vacio = { directas: [], todas: [] };
  try {
    const { DocumentFolderMember, DocumentFolder, TeamMember } = tenantModels ?? {};
    if (!DocumentFolderMember || !DocumentFolder || !TeamMember || !userId) return vacio;

    const ficha = await TeamMember.findOne({ where: { userId }, attributes: ["id"] });
    if (!ficha) return vacio;

    const filas = await DocumentFolderMember.findAll({
      where: { teamMemberId: ficha.id },
      attributes: ["folderId"],
      raw: true,
    });
    const directas = [...new Set(filas.map((f) => f.folderId))];
    if (!directas.length) return vacio;

    // Los descendientes, nivel a nivel. Tope duro por si algún día alguien
    // consigue meter un ciclo en el árbol.
    const todas = new Set(directas);
    let frontera = directas;
    for (let i = 0; i < NIVELES && frontera.length; i++) {
      const hijas = await DocumentFolder.findAll({
        where: { parentFolderId: { [Op.in]: frontera } },
        attributes: ["id"],
        raw: true,
      });
      frontera = hijas.map((h) => h.id).filter((id) => !todas.has(id));
      for (const id of frontera) todas.add(id);
    }

    return { directas, todas: [...todas] };
  } catch {
    return vacio;
  }
}

/**
 * Deja la lista de una carpeta EXACTAMENTE como se pide: crea las que faltan,
 * respeta las que ya estaban y borra las que sobran.
 *
 * A diferencia de las lecturas de un documento, aquí sí se borra sin miramientos
 * lo que sobra: quitar a alguien de una carpeta es justamente retirarle el
 * acceso, y no hay ningún acuse que conservar.
 *
 * Solo acepta fichas de equipo que EXISTAN: un id inventado desde el navegador
 * se guardaría como un miembro fantasma que nadie puede quitar. Devuelve los
 * ids que finalmente quedan.
 */
export async function sincronizaMiembrosDeCarpeta({ tenantModels, folderId, teamMemberIds, addedById = null }) {
  const { DocumentFolderMember, TeamMember } = tenantModels ?? {};
  if (!DocumentFolderMember || !folderId) return { miembros: [], quitados: 0 };

  const pedidos = [...new Set((Array.isArray(teamMemberIds) ? teamMemberIds : []).filter((x) => typeof x === "string"))];
  let validos = pedidos;
  if (pedidos.length && TeamMember) {
    const fichas = await TeamMember.findAll({ where: { id: { [Op.in]: pedidos } }, attributes: ["id"], raw: true });
    const existen = new Set(fichas.map((f) => f.id));
    validos = pedidos.filter((id) => existen.has(id));
  }

  const yaEstaban = await DocumentFolderMember.findAll({
    where: { folderId },
    attributes: ["id", "teamMemberId"],
    raw: true,
  });
  const actuales = new Set(yaEstaban.map((f) => f.teamMemberId));

  const nuevos = validos.filter((id) => !actuales.has(id));
  if (nuevos.length) {
    await DocumentFolderMember.bulkCreate(
      nuevos.map((teamMemberId) => ({ folderId, teamMemberId, addedById })),
      // Dos pestañas guardando a la vez no pueden reventar con un 23505.
      { ignoreDuplicates: true }
    );
  }

  const sobran = yaEstaban.filter((f) => !validos.includes(f.teamMemberId)).map((f) => f.id);
  let quitados = 0;
  if (sobran.length) quitados = await DocumentFolderMember.destroy({ where: { id: { [Op.in]: sobran } } });

  return { miembros: validos, quitados };
}

/**
 * Con quién está compartida una carpeta, con nombre, para pintarlo.
 * Best-effort: si falla, la carpeta se enseña sin la lista.
 */
export async function miembrosDeCarpeta({ tenantModels, folderId }) {
  try {
    const { DocumentFolderMember, TeamMember } = tenantModels ?? {};
    if (!DocumentFolderMember || !folderId) return [];
    const filas = await DocumentFolderMember.findAll({
      where: { folderId },
      include: TeamMember
        ? [{ model: TeamMember, as: "teamMember", attributes: ["id", "displayName"], required: false }]
        : [],
      order: [["createdAt", "ASC"]],
    });
    return filas.map((f) => ({ teamMemberId: f.teamMemberId, nombre: f.teamMember?.displayName ?? null }));
  } catch {
    return [];
  }
}

/**
 * Cuántas personas tiene compartida cada carpeta de una tanda: `Map id → n`.
 *
 * Una sola consulta agrupada para toda la lista, para que el archivo pueda
 * poner «compartida con 3» en cada carpeta sin N+1.
 */
export async function contarMiembros({ tenantModels, folderIds }) {
  const vacio = new Map();
  try {
    const { DocumentFolderMember } = tenantModels ?? {};
    if (!DocumentFolderMember || !folderIds?.length) return vacio;
    const filas = await DocumentFolderMember.findAll({
      where: { folderId: { [Op.in]: folderIds } },
      attributes: ["folderId"],
      raw: true,
    });
    const cuenta = new Map();
    for (const f of filas) cuenta.set(f.folderId, (cuenta.get(f.folderId) ?? 0) + 1);
    return cuenta;
  } catch {
    return vacio;
  }
}
