/**
 * migrate-tablero-adjuntos.js — la tabla de las capturas del Registro.
 *
 * POR QUÉ HACE FALTA
 * El cuerpo de una tarea se pinta como texto plano, así que una imagen escrita
 * al estilo markdown saldría con sus corchetes a la vista; y por detrás tampoco
 * había dónde meterla, porque el documento es un TEXTO versionado y un fichero
 * no cabe dentro de un texto. Medido el 24/08/2026: cero imágenes y cero enlaces
 * en las 133 tareas de los dos documentos publicados. No es que se usara poco,
 * es que no se podía — y las tareas que nacen de una captura son muchas.
 *
 * LO QUE HUBO QUE DECIDIR ANTES DE ESCRIBIR LA PRIMERA LÍNEA
 * De qué cuelga un adjunto. Todo lo demás (tick, reparto, solución) casa por
 * título normalizado, y eso deja filas huérfanas cuando alguien reescribe un
 * título. Con un tick da igual; con un fichero deja algo en disco que nadie
 * alcanza y nadie borra. Por eso cuelgan de la FICHA de la tarea
 * (`<!--id:…-->`, dentro del propio texto), que sobrevive al cambio de título, al
 * cambio de sección y al cierre.
 *
 * SIN FK a propósito: la ficha no es la clave de ninguna tabla, vive dentro de
 * un texto. El sustituto del ON DELETE CASCADE es `podar-tablero-adjuntos.js`.
 *
 * OJO: opera sobre el schema MASTER, no sobre los `crm_*` — por eso no va en el
 * registro de migraciones por tenant. Se lanza una vez a mano:
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-tablero-adjuntos.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-tablero-adjuntos.js
 *
 * Es idempotente: se puede repetir sin miedo. Y es aditivo — no toca ninguna
 * fila existente, así que puede correr antes del despliegue sin romper nada de
 * lo que está sirviendo ahora.
 */

import { Sequelize } from "sequelize";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  await s.query(`
    CREATE TABLE IF NOT EXISTS master.tablero_adjuntos (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      -- La ficha de la tarea, tal como está escrita en el texto publicado.
      -- No hay FK: no hay tabla de tareas a la que apuntar.
      ficha       VARCHAR(32) NOT NULL,
      documento   VARCHAR(20),
      nombre      VARCHAR(255) NOT NULL,
      -- Ruta RELATIVA dentro de uploads/. Nunca una ruta absoluta del servidor.
      ruta        VARCHAR(500) NOT NULL,
      bytes       INTEGER NOT NULL DEFAULT 0,
      mime        VARCHAR(120),
      subido_por  VARCHAR(255),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Se busca SIEMPRE por ficha (todas las capturas de una tarea), nunca por id
  // suelto salvo al servir una. Sin este índice, cada carga del tablero haría un
  // recorrido completo por cada tarea que se despliegue.
  await s.query(`
    CREATE INDEX IF NOT EXISTS tablero_adjuntos_ficha_idx
      ON master.tablero_adjuntos (ficha)
  `);

  process.stdout.write("✓ master.tablero_adjuntos\n");

  const [filas] = await s.query(
    "SELECT count(*)::int AS n, coalesce(sum(bytes),0)::bigint AS b FROM master.tablero_adjuntos"
  );
  const kb = Math.round(Number(filas[0].b) / 1024);
  process.stdout.write(`  · ${filas[0].n} captura(s), ${kb} KB\n`);

  await s.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
