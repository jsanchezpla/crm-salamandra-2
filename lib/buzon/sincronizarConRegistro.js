/**
 * lib/buzon/sincronizarConRegistro.js — que las pestañas del Buzón digan lo
 * mismo que el Registro (Rodrigo, 15/09/2026).
 *
 * «Cuando resuelvo una tarea que he mandado del buzón al registro y la cierro,
 * debería mandarse de En el registro a Resuelto automáticamente. El objetivo es
 * que siempre coincidan.» Hasta ese día cerrar la tarea desde el tablero o con
 * `registro.mjs` no tocaba el aviso: se quedaba «En el registro» para siempre
 * (146 de 149 en producción, ninguno con la tarea abierta).
 *
 * (Fichero nuevo en /lib, regla #2: lo llama `publicarVersion`, que es la
 * ÚNICA puerta por la que cambia el texto del Registro —el tablero, los dos
 * botones del Buzón y `scripts/tablero-doc.js`—. Engancharlo en cada puerta
 * serían cuatro sitios y el cuarto se olvidaría.)
 *
 * ── LAS REGLAS ─────────────────────────────────────────────────────────────
 *   · «En el registro» con su tarea FUERA del backlog → Resuelto. La tarea
 *     sigue viva si el backlog lleva su ficha o cita su `AV-####` (una tarea
 *     reescrita a mano puede perder la ficha y conservar la referencia).
 *     Sin ficha (lo de antes del botón), solo si Resuelto cita la referencia:
 *     sin rastro en ningún lado no hay nada con qué casarlo.
 *   · «Resuelto» con su ficha de vuelta en el backlog (la tarea se reabrió) →
 *     En el registro. Aquí solo por FICHA: una tarea nueva que diga
 *     «relacionado con AV-0042» no reabre el 42.
 *   · «Activo» no se toca nunca: es el paso previo, lo decide una persona.
 *
 * Sin base de datos en `cambiosPorElRegistro` (la prueba la fija sin Postgres);
 * `sincronizarConRegistro` recibe los modelos por parámetro, como
 * `lib/tablero/documentos.js`, para no arrastrar la conexión a quien lo importa.
 */

import { trocearTodo } from "../tablero/parser.js";
import { estadoActual, referencia } from "./buzon.js";

function fichasDe(texto) {
  const fichas = new Set();
  for (const seccion of trocearTodo(texto ?? "").secciones) {
    if (seccion.esManual) continue;
    for (const tarea of seccion.tareas ?? []) if (tarea.id) fichas.add(tarea.id);
  }
  return fichas;
}

function citaLaReferencia(texto, numero) {
  if (numero == null) return false;
  return new RegExp(`${referencia(numero)}(?!\\d)`).test(String(texto ?? ""));
}

/**
 * Qué avisos cambian de pestaña con este Registro. Devuelve
 * `[{ id, de, a, ficha, numero }]`; vacío si todo coincide.
 */
export function cambiosPorElRegistro(avisos, { backlog, resuelto }) {
  const enBacklog = fichasDe(backlog);
  const enResuelto = fichasDe(resuelto);
  const cambios = [];

  for (const aviso of avisos ?? []) {
    const estado = estadoActual(aviso.estado);
    const ficha = aviso.registroFicha ?? null;

    if (estado === "enviado") {
      // La ficha manda. La referencia solo cuenta si la ficha no está en
      // ninguno de los dos: una tarea de seguimiento que cita «AV-0150» no
      // mantiene abierto el 150 si su propia tarea ya está en Resuelto.
      let cerrada;
      if (ficha && enBacklog.has(ficha)) cerrada = false;
      else if (ficha && enResuelto.has(ficha)) cerrada = true;
      else if (citaLaReferencia(backlog, aviso.numero)) cerrada = false;
      else cerrada = ficha ? true : citaLaReferencia(resuelto, aviso.numero);
      if (cerrada) cambios.push({ id: aviso.id, de: aviso.estado, a: "cerrado", ficha, numero: aviso.numero });
    } else if (estado === "cerrado" && ficha && enBacklog.has(ficha) && !enResuelto.has(ficha)) {
      cambios.push({ id: aviso.id, de: aviso.estado, a: "enviado", ficha, numero: aviso.numero });
    }
  }
  return cambios;
}

/**
 * Lee el Registro publicado y mueve los avisos que no coincidan. Best-effort
 * para quien lo llama (`publicarVersion` lo envuelve): la publicación ya está
 * escrita y esto no puede deshacerla.
 */
export async function sincronizarConRegistro(models, { por = null } = {}) {
  const { BuzonAviso, TableroDocumento } = models ?? {};
  if (!BuzonAviso || !TableroDocumento) return [];

  const ultima = (nombre) => TableroDocumento.findOne({ where: { nombre }, order: [["version", "DESC"]] });
  const [backlog, resuelto] = await Promise.all([ultima("backlog"), ultima("resuelto")]);
  if (!backlog || !resuelto) return [];

  const avisos = await BuzonAviso.findAll({
    where: { estado: ["enviado", "en_curso", "resuelto", "cerrado"] },
    attributes: ["id", "numero", "estado", "registroFicha", "tenantId", "tenantSlug"],
  });
  const cambios = cambiosPorElRegistro(avisos, { backlog: backlog.contenido, resuelto: resuelto.contenido });
  if (!cambios.length) return [];

  const { auditar } = await import("../utils/auditoria.js");
  const porId = new Map(avisos.map((a) => [a.id, a]));
  for (const c of cambios) {
    const aviso = porId.get(c.id);
    await aviso.update({ estado: c.a });
    await auditar({
      tenantId: aviso.tenantId ?? null,
      userId: null,
      action: "buzon.sincronizado_con_registro",
      entity: "BuzonAviso",
      entityId: aviso.id,
      before: { estado: c.de },
      after: { estado: c.a, ref: referencia(c.numero), tenantSlug: aviso.tenantSlug, ficha: c.ficha, por },
    });
  }
  return cambios;
}
