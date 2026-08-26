/**
 * migrate-tablero-estado.js — la tabla donde el Registro guarda el tick y el
 * reparto de cada tarea.
 *
 * POR QUÉ HACE FALTA
 * Hasta el 12/08/2026 el Registro (`/admin/tablero`) era de solo leer: pintaba
 * `docs/backlog.md` y `docs/resuelto.md` y nada más. Rodrigo pidió poder asignar
 * una tarea a él o a Jorge y marcarla con un tick para mandarla a Resuelto.
 *
 * Eso NO se puede guardar en los ficheros: viajan dentro de la imagen de Docker
 * (`Dockerfile:33`), así que lo que la pantalla escribiera lo borraría el
 * siguiente despliegue en silencio. El texto de cada tarea sigue en el repo; el
 * estado que se cambia en caliente vive aquí.
 *
 * OJO: opera sobre el schema MASTER, no sobre los `crm_*` — por eso no va en el
 * registro de migraciones por tenant. Se lanza una vez a mano:
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-tablero-estado.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-tablero-estado.js
 *
 * Es idempotente: se puede repetir sin miedo.
 */

import { Sequelize } from "sequelize";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  await s.query(`
    CREATE TABLE IF NOT EXISTS master.tablero_estado (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      clave       VARCHAR(200) NOT NULL UNIQUE,
      titulo      TEXT,
      asignado_a  VARCHAR(40),
      resuelta    BOOLEAN,
      tocada_por  VARCHAR(255),
      -- Cómo se arregla, escrito a mano desde la pantalla. Va AQUÍ y no en
      -- docs/backlog.md porque ese fichero viaja dentro de la imagen de Docker:
      -- lo que la pantalla escribiera en él se lo llevaría el siguiente
      -- despliegue, y sin dar ningún error. Mismo motivo que el tick y el
      -- reparto, que ya viven aquí por esto.
      solucion    TEXT,
      -- Cuándo se APUNTÓ la tarea (26/08/2026). Ojo con la de abajo, que se
      -- llama casi igual y dice otra cosa: created_at es cuándo nació esta fila
      -- —la primera vez que alguien tocó el tick o el reparto— y esta es cuándo
      -- entró la tarea en el Registro. Nullable a propósito: una tarea sin fecha
      -- se pinta sin fecha, no se le inventa una.
      apuntada_en TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // La tabla ya existía en producción desde el 10/08, así que el CREATE de
  // arriba no la toca: la columna hay que añadirla aparte o el Registro
  // desplegado se encontraría un 42703 al guardar (14/08/2026).
  await s.query(`
    ALTER TABLE master.tablero_estado
      ADD COLUMN IF NOT EXISTS solucion TEXT
  `);
  // Lo mismo con `apuntada_en` (26/08/2026): la tabla existe en producción
  // desde el 10/08, así que el CREATE de arriba no la va a tocar. Es aditiva y
  // sin valor por defecto, o sea invisible para el código que ya está
  // desplegado — y por eso puede correrse ANTES del despliegue, que es como
  // tiene que ir: el código nuevo la LEE (`estadosGuardados` la pide por
  // nombre) y sin ella el Registro daría 42703 en cada carga.
  await s.query(`
    ALTER TABLE master.tablero_estado
      ADD COLUMN IF NOT EXISTS apuntada_en TIMESTAMPTZ
  `);
  process.stdout.write("✓ master.tablero_estado (con `solucion` y `apuntada_en`)\n");

  const [filas] = await s.query(
    "SELECT count(*)::int AS n, count(apuntada_en)::int AS fechadas FROM master.tablero_estado"
  );
  process.stdout.write(
    `  · ${filas[0].n} tarea(s) con estado guardado, ${filas[0].fechadas} con fecha de alta\n`
  );
  if (filas[0].n > filas[0].fechadas) {
    process.stdout.write("  · las que no la tienen: node scripts/sembrar-fechas-de-alta.js\n");
  }

  await s.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
