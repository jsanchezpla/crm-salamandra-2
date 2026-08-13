/**
 * backfill-nutricion-assignments.js — puesta al día del check «Paciente Nutrición».
 *
 * Desde 2026-07-27 toda alta de cliente en un tenant con el módulo `nutricion`
 * marcaba la asignación sola (lib/clients/moduleAssignments.js →
 * applyAutoAssignments, decisión de nutri_laura, la reina del módulo). Desde el
 * 13/08/2026 eso ya no basta: hace falta además el flag `autoAsignarEnAlta` del
 * tenant, y **este script exige el mismo flag**.
 *
 * Alinea a los clientes creados ANTES: para cada tenant con `nutricion` activo Y
 * el auto-marcado encendido, inserta la fila que falte en
 * client_module_assignments para todos sus clientes no inactivos.
 *
 * Es de DATOS, no de schema → registrado como ONE_OFF (no lo corre el
 * disparador de migraciones). REPETIBLE SIN MIEDO: ON CONFLICT DO NOTHING sobre
 * el único (client_id, module_key); no toca filas existentes (si Laura
 * desmarcó a alguien a mano, se respeta: la fila existe con enabled=false y el
 * conflicto la deja como está).
 *
 * Uso local:      node --env-file=.env.local scripts/backfill-nutricion-assignments.js
 * Uso producción: docker compose run --rm app node scripts/backfill-nutricion-assignments.js
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("Falta DATABASE_URL\n");
    process.exit(1);
  }
  const s = new Sequelize(url, { logging: false });

  try {
    // Regla #12: la lista de tenants sale de master en runtime, nunca hardcodeada.
    //
    // ⚠️ Y ADEMÁS EXIGE EL FLAG `autoAsignarEnAlta` (13/08/2026). Sin esa línea
    // este script era la puerta trasera del estropicio que el flag existe para
    // evitar: marcaba a TODOS los clientes de TODO tenant con `nutricion`, y ese
    // mismo día Aumenta estrenó el módulo con 1.083 familias dentro. Una sola
    // ejecución —y la cabecera dice «repetible sin miedo»— las habría marcado
    // todas como pacientes de dietas, incluidas las que van a terapia.
    //
    // El criterio es el mismo que el del alta: marcar solo donde el cliente ha
    // dicho que quiere que se marque. Un tenant con el flag apagado no quiere
    // ese check ni en las fichas nuevas ni en las viejas.
    const [tenants] = await s.query(`
      SELECT DISTINCT t.slug
      FROM master.tenants t
      JOIN master.tenant_modules tm ON tm.tenant_id = t.id
      WHERE t.status = 'active' AND tm.enabled = TRUE AND tm.module_key = 'nutricion'
        AND COALESCE(tm.feature_flags->>'autoAsignarEnAlta', 'false') = 'true'
      ORDER BY t.slug
    `);

    // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
    // lanza a mano, que es como se escribio. Ver scripts/_solo-este-tenant.js.
    const slugs = acotarSlugs(tenants.map((r) => r.slug));

    if (slugs.length === 0) {
      log("Ningún tenant activo tiene nutrición CON el auto-marcado encendido. Nada que hacer.");
      return;
    }

    for (const slug of slugs) {
      const schema = `crm_${slug}`;
      header(`${slug} (${schema})`);

      const [[tabla]] = await s.query(
        `SELECT to_regclass($1) AS t`, { bind: [`${schema}.client_module_assignments`] }
      );
      if (!tabla?.t) {
        log(`✗ sin tabla client_module_assignments — corre antes migrate-client-module-assignments.js`);
        continue;
      }

      const contar = async () => {
        const [[{ total }]] = await s.query(`
          SELECT count(*)::int AS total
          FROM "${schema}".client_module_assignments
          WHERE module_key = 'nutricion' AND enabled
        `);
        return total;
      };

      const antes = await contar();
      await s.query(`
        INSERT INTO "${schema}".client_module_assignments
          (id, client_id, module_key, enabled, assigned_at, metadata, created_at, updated_at)
        SELECT gen_random_uuid(), c.id, 'nutricion', TRUE, now(),
               '{"auto": true, "origen": "backfill-2026-07-27"}'::jsonb, now(), now()
        FROM "${schema}".clients c
        WHERE c.status IS DISTINCT FROM 'inactive'
        ON CONFLICT (client_id, module_key) DO NOTHING
      `);
      const despues = await contar();
      log(`✓ marcadas ahora: ${despues - antes} · con el check activo en total: ${despues}`);
    }
  } finally {
    await s.close();
  }
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err.message}\n`);
  process.exit(1);
});
