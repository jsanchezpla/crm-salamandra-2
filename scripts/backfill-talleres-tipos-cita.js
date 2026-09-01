// @vivo — Herramienta genérica: da de alta el tipo de cita de cada grupo de taller que aún no lo tenga. Se relanza después de cualquier migración que cree grupos, y no duplica.
/**
 * backfill-talleres-tipos-cita.js — cada grupo de taller necesita su TIPO DE
 * CITA para poder apuntarse en la agenda (01/09/2026, Aumenta por Rodrigo).
 *
 * ── POR QUÉ HACE FALTA UN SCRIPT ────────────────────────────────────────────
 * Desde hoy, crear un grupo desde la pantalla crea también su tipo de cita
 * (`lib/clinica/tipoCitaTaller.js`). Pero los grupos que salieron de
 * `migrate-talleres-grupos.js` —uno por cada taller que ya existía— nacieron
 * sin él: aquella migración es SQL puro y crear una fila de `event_types`, con
 * su slug único y sus dieciocho columnas obligatorias, no es trabajo de una
 * migración de esquema.
 *
 * Sin esto, «Habilidades sociales» tendría su grupo y sus 45 niños pero no se
 * podría elegir en la agenda, que es justo de lo que iba el encargo.
 *
 * ── QUÉ CREA, EXACTAMENTE ───────────────────────────────────────────────────
 * Un tipo de cita OCULTO (`is_hidden`) por grupo, llamado «Actividad · Grupo»,
 * con la duración del grupo y presencial. Oculto porque a un taller se entra
 * apuntándose, no reservando hora desde la web; el mismo mecanismo que ya usa
 * `lib/citas/tiposVisibles.js`.
 *
 * Idempotente: solo toca los grupos SIN tipo. Relanzarlo no duplica nada.
 *
 * EN SECO por defecto. `--confirm` para escribir.
 *
 * Uso local: node --env-file=.env.local scripts/backfill-talleres-tipos-cita.js --confirm
 * Uso VPS:   docker exec crm-salamandra-app-1 node scripts/backfill-talleres-tipos-cita.js --confirm
 */

import { Sequelize } from "sequelize";
import { rotuloDeGrupo, slugBaseDeGrupo } from "../lib/clinica/tipoCitaTaller.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const i = args.indexOf("--slug");
  const soloSlug = i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(` Tipos de cita de los grupos de taller${confirm ? "" : "  (EN SECO)"}\n`);
  process.stdout.write("════════════════════════════════════════════════════\n");

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const q = async (sql, bind) => (await s.query(sql, bind ? { bind } : undefined))[0];

  /*
   * Los schemas que tienen LAS DOS tablas. Se preguntan a la base y no se
   * escriben a mano (regla #12): hay tenants con `event_types` y sin talleres
   * —nutri_laura— y al revés.
   */
  const schemas = (
    await q(
      `SELECT t.table_schema FROM information_schema.tables t
        WHERE t.table_name = 'taller_grupos'
          AND EXISTS (
            SELECT 1 FROM information_schema.tables e
             WHERE e.table_schema = t.table_schema AND e.table_name = 'event_types'
          )
        ORDER BY 1`
    )
  ).map((r) => r.table_schema);

  const objetivo = soloSlug ? schemas.filter((x) => x === `crm_${soloSlug}`) : schemas;
  if (!objetivo.length) {
    log(soloSlug ? `· No hay schema crm_${soloSlug} con grupos de taller.` : "· Ningún schema con grupos de taller.");
    await s.close();
    process.exit(0);
  }
  log(`✓ ${objetivo.length} schema(s) con grupos de taller`);

  let creados = 0;
  for (const schema of objetivo) {
    const pendientes = await q(
      `SELECT g.id, g.name, g.duration, g.color, g.active, t.name AS taller_name, t.active AS taller_active
         FROM "${schema}"."taller_grupos" g
         JOIN "${schema}"."talleres" t ON t.id = g.taller_id
        WHERE NOT EXISTS (
          SELECT 1 FROM "${schema}"."event_types" e WHERE e.taller_grupo_id = g.id
        )
        ORDER BY t.name, g.name`
    );
    if (!pendientes.length) {
      log(`· ${schema}: todos los grupos ya tienen su tipo de cita`);
      continue;
    }

    for (const g of pendientes) {
      const taller = { name: g.taller_name, active: g.taller_active };
      const grupo = { id: g.id, name: g.name, active: g.active };
      const name = rotuloDeGrupo(taller, grupo);

      // Slug libre: `slug` es UNIQUE y dos grupos pueden normalizar igual.
      const base = slugBaseDeGrupo(taller, grupo);
      let slug = base;
      for (let n = 2; n < 50; n += 1) {
        const choca = await q(`SELECT 1 FROM "${schema}"."event_types" WHERE slug = $1`, [slug]);
        if (!choca.length) break;
        slug = `${base}-${n}`;
      }

      log(`${confirm ? "→" : "·"} ${schema}: «${name}» (${slug}, ${g.duration} min)`);
      if (!confirm) { creados += 1; continue; }

      await s.query(
        `INSERT INTO "${schema}"."event_types"
           (id, name, slug, description, duration, color, modalities,
            min_notice_hours, max_advance_days, is_hidden, active, taller_grupo_id,
            created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, '["presencial"]'::jsonb,
                 0, 365, TRUE, $6, $7, NOW(), NOW())`,
        { bind: [name, slug, "Taller de grupo. Se gestiona desde Clínica → Talleres.", g.duration || 90, g.color, g.active && g.taller_active, g.id] }
      );
      creados += 1;
    }
  }

  process.stdout.write(
    confirm ? `\n✓ ${creados} tipo(s) de cita creados\n\n` : `\n· ${creados} se crearían. Relanza con --confirm\n\n`
  );
  await s.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
