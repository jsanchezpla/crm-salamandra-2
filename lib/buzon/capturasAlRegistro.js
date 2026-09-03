/**
 * lib/buzon/capturasAlRegistro.js — copiar las capturas de un aviso del Buzón
 * a la tarea del Registro que acaba de nacer de él (03/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: es la única pieza del Buzón que escribe en
 * el almacén del TABLERO, y por eso no va ni en `buzonStore.js` —que solo toca
 * las tablas del Buzón— ni en `alRegistro.js` —que no toca disco ni base para
 * que su prueba corra sin Postgres—. Lo llama solo
 * `POST /api/admin/buzon/[id]/registro`.)
 *
 * ── SE COPIA, NO SE ENLAZA ──────────────────────────────────────────────────
 * Cada lado tiene su carpeta (`buzon/{slug}/{aviso}/…` y `tablero/{ficha}/…`),
 * su tabla y su poda con su propio reloj: el Buzón caduca a los dos años de
 * enviarse, el tablero a los 30 días de que la tarea desaparezca. Una fila del
 * tablero apuntando a un fichero del Buzón dejaría de abrirse el día que una
 * de las dos podas pasara por delante de la otra, y ese fallo se descubre al
 * abrirla, meses después. Diez MB por captura y tres por tarea: copiar sale
 * más barato que ese día.
 *
 * ── NUNCA LANZA, Y VA DESPUÉS DE PUBLICAR ───────────────────────────────────
 * La tarea ya está publicada cuando esto corre. Si una captura no se puede
 * copiar (fichero que ya no está, disco lleno), la tarea se queda —con la
 * línea de «Capturas» que la nombra— y se devuelve el fallo para que el botón
 * lo diga: la captura sigue en el Buzón y se puede colgar a mano desde el
 * tablero. Lo que no se hace es dejar filas a medias: si falla la tercera, las
 * dos primeras se deshacen y se dice que no se copió ninguna. Media colección
 * sin avisar es peor que ninguna con aviso.
 */

import { getMasterModels } from "../db/masterDb.js";
import { extensionPorContenido, extFromFileName } from "../documents/documentStorage.js";
import { leerFichero } from "./buzonStorage.js";
import { guardarFichero, borrarFichero } from "../tablero/tableroStorage.js";
import { capturasQueViajan } from "./alRegistro.js";

/**
 * Copia las capturas que `capturasQueViajan` elige y las cuelga de `ficha`.
 *
 * Devuelve `{ copiadas, quedan, error }`: las fichas nuevas del tablero, cuántas
 * se quedaron en el Buzón por el tope, y el mensaje si algo falló (entonces
 * `copiadas` va vacío).
 */
export async function copiarCapturasAlRegistro({ aviso, ficha, documento = "backlog", subidoPor = null }) {
  const { viajan, quedan } = capturasQueViajan(aviso);
  if (!viajan.length) return { copiadas: [], quedan, error: null };

  const filas = [];
  const escritas = [];
  try {
    for (const a of viajan) {
      const buffer = await leerFichero(a.ruta);
      // La extensión sale de los bytes, como cuando se sube desde el tablero:
      // el nombre lo escribió el cliente y no decide cómo se sirve.
      const ext = extensionPorContenido(buffer) ?? extFromFileName(a.ruta);
      const adjuntoId = crypto.randomUUID();
      const ruta = await guardarFichero(ficha, adjuntoId, buffer, ext);
      escritas.push(ruta);
      filas.push({
        id: adjuntoId,
        ficha,
        documento,
        nombre: a.nombre,
        ruta,
        bytes: buffer.length,
        mime: a.mime ?? null,
        // Quién la cuelga es quien pulsó el botón; de dónde venía lo dice el
        // cuerpo de la tarea (la referencia AV-####).
        subidoPor,
      });
    }
    const { TableroAdjunto } = getMasterModels();
    const guardadas = await TableroAdjunto.bulkCreate(filas);
    return { copiadas: guardadas.map((g) => ({ id: g.id, nombre: g.nombre, bytes: g.bytes })), quedan, error: null };
  } catch (e) {
    await Promise.all(escritas.map(borrarFichero));
    const motivo = e?.code === "ENOENT" ? "una de las capturas ya no está en el disco del Buzón" : e?.message || "fallo al copiar";
    return {
      copiadas: [],
      quedan,
      error: `${viajan.length === 1 ? "No se ha copiado la captura" : `No se han copiado las ${viajan.length} capturas`} al Registro (${motivo}). Siguen en el Buzón: cuélgalas a mano desde /admin/tablero.`,
    };
  }
}
