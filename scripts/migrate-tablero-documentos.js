/**
 * migrate-tablero-documentos.js — la tabla donde vive el TEXTO del Registro.
 *
 * POR QUÉ HACE FALTA (19/08/2026)
 * Hasta hoy `docs/backlog.md` y `docs/resuelto.md` viajaban dentro de la imagen
 * de Docker, y apuntar una tarea costaba commit + build + deploy. Jorge quiso
 * reservar los commits para código. Desde hoy el texto vive en
 * `master.tablero_documentos` (una fila por versión, append-only) y se publica
 * con `scripts/tablero-doc.js` desde dentro del contenedor, o con
 * `scripts/registro.mjs` desde local. El porqué largo, en el modelo
 * (`models/master/TableroDocumento.model.js`).
 *
 * OJO: opera sobre el schema MASTER, no sobre los `crm_*` — por eso no va en el
 * registro de migraciones por tenant. Se lanza una vez a mano:
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-tablero-documentos.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-tablero-documentos.js
 *
 * Es idempotente: solo crea (tabla e índice) si no existen. NO carga el texto:
 * eso es un dato y lo hace `tablero-doc.js publicar` cuando se le diga.
 */

import { Sequelize } from "sequelize";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  await s.query(`
    CREATE TABLE IF NOT EXISTS master.tablero_documentos (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nombre        VARCHAR(40) NOT NULL,
      version       INTEGER NOT NULL,
      contenido     TEXT NOT NULL,
      nota          TEXT,
      publicado_por VARCHAR(255),
      tareas        INTEGER,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // El cerrojo contra dos publicaciones a la vez sobre la misma versión: la
  // segunda falla en vez de pisar. `publicarVersion` lo traduce a una frase.
  await s.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS tablero_documentos_nombre_version
      ON master.tablero_documentos (nombre, version)
  `);
  process.stdout.write("✓ master.tablero_documentos (UNIQUE nombre+version)\n");

  const [filas] = await s.query(
    "SELECT nombre, max(version)::int AS version, count(*)::int AS versiones FROM master.tablero_documentos GROUP BY nombre ORDER BY nombre"
  );
  if (!filas.length) {
    process.stdout.write(
      "  · vacía: el tablero seguirá leyendo del fichero hasta que se publique (tablero-doc.js publicar)\n"
    );
  }
  for (const f of filas) {
    process.stdout.write(`  · ${f.nombre}: v${f.version} (${f.versiones} versión(es) guardadas)\n`);
  }

  await s.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
