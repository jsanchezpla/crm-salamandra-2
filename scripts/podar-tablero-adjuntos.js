/**
 * podar-tablero-adjuntos.js — borra las capturas que ya no cuelgan de ninguna
 * tarea viva del Registro.
 *
 * ── POR QUÉ ESTO EXISTE, Y POR QUÉ NO ES OPCIONAL ─────────────────────────
 * Una captura cuelga de la FICHA de una tarea (`<!--id:…-->`, escrita dentro del
 * texto publicado). La ficha no es la clave de ninguna tabla, así que no hay FK
 * ni ON DELETE CASCADE: cuando alguien borra una tarea del Registro, sus
 * capturas se quedan en `master.tablero_adjuntos` y en disco, y no hay nada que
 * las vaya a quitar.
 *
 * Eso no es un descuido de limpieza. Estas capturas PUEDEN LLEVAR DATOS DE UN
 * PACIENTE dentro y no se recortan (Jorge, 24/08/2026), y la regla que se puso
 * con ellas fue que viven lo que viva la tarea. Este script es esa regla,
 * escrita en código: sin él, «mientras viva la tarea» quiere decir «para
 * siempre».
 *
 * ── LOS 30 DÍAS DE GRACIA ─────────────────────────────────────────────────
 * No se borra en cuanto una ficha desaparece de los dos documentos, sino 30 días
 * después. El motivo es concreto: `tablero_documentos` es append-only y guarda
 * 50 versiones, así que una tarea borrada por error se rescata con
 * `registro.mjs restaurar` — y si la poda hubiera pasado por en medio, volvería
 * la tarea sin sus capturas, que es la mitad peor. Treinta días dan de sobra
 * para darse cuenta.
 *
 * Se mide desde que se SUBIÓ la captura, no desde que desapareció la tarea:
 * nadie apunta cuándo desapareció. Es más conservador de lo necesario y eso es
 * lo que se quiere aquí.
 *
 * Uso local:  node --env-file=.env.local scripts/podar-tablero-adjuntos.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/podar-tablero-adjuntos.js
 *
 * En seco por defecto: enseña lo que borraría y no toca nada. Con `--confirm`
 * borra de verdad.
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { DOCUMENTOS, trocear } from "../lib/tablero/parser.js";
import { ultimaVersion } from "../lib/tablero/documentos.js";
import { borrarFichero } from "../lib/tablero/tableroStorage.js";

const DIAS_DE_GRACIA = 30;
const confirmar = process.argv.includes("--confirm");
const out = (s) => process.stdout.write(`${s}\n`);

async function main() {
  const models = getMasterModels();

  // Las fichas que SIGUEN escritas, en cualquiera de los dos documentos.
  const vivas = new Set();
  for (const nombre of DOCUMENTOS) {
    const fila = await ultimaVersion(models, nombre);
    if (!fila) {
      // Sin documento publicado no se puede saber qué está vivo. Parar es la
      // única respuesta segura: seguir borraría TODO por no encontrar nada.
      out(`⚠ «${nombre}» no tiene ninguna versión publicada. No se poda nada.`);
      process.exit(1);
    }
    for (const s of trocear(fila.contenido)) {
      for (const t of s.tareas) if (t.id) vivas.add(t.id);
    }
  }
  out(`Fichas vivas en el Registro: ${vivas.size}`);

  const { TableroAdjunto } = models;
  const todas = await TableroAdjunto.findAll({
    attributes: ["id", "ficha", "nombre", "ruta", "bytes", "createdAt"],
    order: [["createdAt", "ASC"]],
  });
  out(`Capturas guardadas: ${todas.length}`);

  const limite = Date.now() - DIAS_DE_GRACIA * 24 * 60 * 60 * 1000;
  const huerfanas = todas.filter((a) => !vivas.has(a.ficha));
  const podables = huerfanas.filter((a) => new Date(a.createdAt).getTime() < limite);
  const esperando = huerfanas.length - podables.length;

  if (!huerfanas.length) {
    out("Ninguna captura huérfana. Nada que hacer.");
    return;
  }

  out("");
  out(`Huérfanas (su tarea ya no está escrita): ${huerfanas.length}`);
  if (esperando) out(`  · ${esperando} todavía dentro de los ${DIAS_DE_GRACIA} días de gracia`);
  out(`  · ${podables.length} se pueden podar ya`);
  for (const a of podables) {
    const kb = Math.round(a.bytes / 1024);
    // El NOMBRE del fichero no se imprime: puede llevar el de una persona
    // («captura pauta maría.png»), y los volcados de estos scripts acaban en un
    // chat. Con la ficha y el peso se identifica igual.
    out(`      ficha ${a.ficha} · ${kb} KB · subida ${new Date(a.createdAt).toISOString().slice(0, 10)}`);
  }

  if (!confirmar) {
    out("");
    out("En seco. Para borrarlas de verdad: --confirm");
    return;
  }

  let borradas = 0;
  for (const a of podables) {
    // Primero el disco y después la fila, por lo mismo que en el endpoint: al
    // revés, un fallo dejaría un binario que ya no apunta ninguna fila.
    await borrarFichero(a.ruta);
    await a.destroy();
    borradas++;
  }
  out("");
  out(`✓ ${borradas} captura(s) borradas`);
}

main()
  .then(async () => {
    await getMasterDb().close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    try {
      await getMasterDb().close();
    } catch {
      /* ya estaba cerrada */
    }
    process.exit(1);
  });
