/**
 * migrate-calendar-videollamada.js — el evento del Calendario puede llevar
 * enlace de videollamada y a quién se le manda (27/08/2026, Rodrigo).
 *
 * El Calendario es de REUNIONES ENTRE PROFESIONALES, no de citas con un
 * paciente (eso es el módulo Citas). Hasta hoy un evento no tenía dónde poner
 * la sala ni a quién avisar: se quedaba en una nota y el enlace viajaba por
 * WhatsApp. Tres columnas, todas nullable:
 *
 *   · `meet_url`       — el enlace de la videollamada, PEGADO por quien crea el
 *     evento (Meet, Zoom, Teams…). El CRM no genera salas: mismo criterio, y el
 *     mismo porqué, que `lib/citas/videollamada.js`.
 *   · `invite_email`   — a qué dirección se le manda. Una sola: la reunión se
 *     convoca a alguien concreto, y una lista pide un modelo aparte que hoy no
 *     hace falta.
 *   · `invite_sent_at` — cuándo salió el último correo. Existe para poder DECIR
 *     en pantalla «ya se envió» en vez de dejar a quien lo mira adivinando si
 *     pulsó o no.
 *
 * Aditiva e idempotente. Se aplica a todo schema que TENGA `calendar_tasks`
 * (byTable, no byModule): un tenant con la tabla creada por un sync anterior y
 * el módulo aún sin comprar tiene que quedarse al día igual — es el incidente
 * del 21/07/2026 escrito en `_schema-targets.js`.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-calendar-videollamada.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-calendar-videollamada.js
 */

import { Sequelize } from "sequelize";
import { acotarSchemas } from "./_solo-este-tenant.js";

function log(m) { process.stdout.write(`  ${m}\n`); }

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("Falta DATABASE_URL\n"); process.exit(1); }

  const s = new Sequelize(url, { logging: false });
  try {
    await s.authenticate();
    const [rows] = await s.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
    );
    const schemas = acotarSchemas(rows.map((r) => r.schema_name));
    process.stdout.write(`\n▶ Videollamada en el Calendario · ${schemas.length} schema(s)\n\n`);

    let tocados = 0;
    for (const schema of schemas) {
      const [tabla] = await s.query(
        `SELECT 1 FROM information_schema.tables
          WHERE table_schema=$1 AND table_name='calendar_tasks'`,
        { bind: [schema] }
      );
      if (!tabla.length) { log(`· ${schema}: sin calendar_tasks, se salta`); continue; }

      await s.query(
        `ALTER TABLE "${schema}"."calendar_tasks"
           ADD COLUMN IF NOT EXISTS "meet_url" VARCHAR(500),
           ADD COLUMN IF NOT EXISTS "invite_email" VARCHAR(255),
           ADD COLUMN IF NOT EXISTS "invite_sent_at" TIMESTAMPTZ`
      );
      log(`✓ ${schema}: meet_url, invite_email, invite_sent_at`);
      tocados++;
    }

    process.stdout.write(`\n✓ Migración completada · ${tocados} schema(s) con Calendario\n\n`);
  } finally {
    await s.close();
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.message ?? err}\n`);
  process.exit(1);
});
