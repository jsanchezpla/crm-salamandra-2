// @vivo — Herramienta genérica por --slug: enlaza cada cuota de FAMILIA con su paciente cuando la familia tiene uno solo. Se ejecutó en aumenta el 01/09/2026, pero se repite con cualquier cliente que traiga cuotas de un sistema viejo (criterio de scripts/_hechos/README.md).
/**
 * backfill-cuota-paciente-unico.js — la cuota de una familia con UN solo
 * paciente es de ese paciente (01/09/2026).
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 * El volcado del Organízate dejó las cuotas de Aumenta a nombre de la FAMILIA
 * (`sembrar-cuotas-desde-aprendidas.js`: «sin paciente, repartirla por paciente
 * sería inventarse el reparto»). Medido el 01/09/2026 en producción: de 274
 * cuotas activas, solo 15 tenían paciente.
 *
 * Repartir la cuota de una familia con DOS hijos sí sería inventárselo — y por
 * eso esas no se tocan. Pero cuando la familia tiene UN paciente y uno solo, no
 * hay nada que repartir ni que adivinar: esa cuota es suya. Eso es lo único que
 * hace este script.
 *
 * ── Qué cambia después ─────────────────────────────────────────────────────
 * `billing_cuotas.patient_id` lo leen tres sitios, y en los tres el enlace
 * mejora lo que ya hacían:
 *   · la generación mensual copia el paciente al cobro (`payments.patient_id`),
 *     así que a partir del mes que viene los cobros dicen de quién son;
 *   · el drawer de cobro y el de factura pueden acotar por paciente
 *     (`lib/billing/cuotaParaRellenar.js`);
 *   · la pantalla de Cuotas deja de decir «toda la familia» en esas filas.
 * Nada de esto cambia importes: el `amount` de la cuota no se toca.
 *
 * ── Lo que NO hace ─────────────────────────────────────────────────────────
 * No toca los cobros YA generados (siguen con su `patient_id` a NULL: nacieron
 * de una cuota que entonces era de la familia, y reescribir dinero pasado es
 * otra decisión). No toca las cuotas que ya tienen paciente. No toca las
 * familias con dos o más pacientes, ni las que no tienen ninguno.
 *
 * EN SECO por defecto. `--confirm` para escribir.
 *
 * Uso VPS:
 *   docker exec crm-salamandra-app-1 node scripts/backfill-cuota-paciente-unico.js [--slug aumenta] [--confirm]
 * Sin `--slug` recorre todos los schemas que tengan las dos tablas.
 */

import { Sequelize } from "sequelize";

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const i = args.indexOf("--slug");
  const slug = i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const q = async (sql, replacements) =>
    (await s.query(sql, replacements ? { replacements } : undefined))[0];

  // Los schemas que tienen LAS DOS tablas. Se preguntan a la base, no se
  // escriben a mano: un slug a fuego se queda viejo (regla #12 de CLAUDE.md).
  const schemas = (
    await q(
      `SELECT table_schema AS schema
         FROM information_schema.tables
        WHERE table_name IN ('billing_cuotas', 'patients')
          AND table_schema LIKE 'crm\\_%'
        GROUP BY table_schema
       HAVING count(DISTINCT table_name) = 2
        ORDER BY table_schema`
    )
  ).map((r) => r.schema);

  const objetivo = slug ? schemas.filter((x) => x === `crm_${slug}`) : schemas;
  if (!objetivo.length) {
    process.stderr.write(`✗ Ningún schema con billing_cuotas y patients${slug ? ` para ${slug}` : ""}\n`);
    await s.close();
    process.exit(1);
  }

  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(` Cuota de familia → su ÚNICO paciente${confirm ? "" : "   (EN SECO)"}\n`);
  process.stdout.write("════════════════════════════════════════════════════\n");

  let totalEnlazadas = 0;

  for (const schema of objetivo) {
    // El reparto completo de las cuotas SIN paciente, por cuántos pacientes
    // tiene su familia. Es lo que hay que poder leer antes de escribir: dice a
    // la vez cuántas se enlazan y cuántas se quedan fuera, y por qué.
    const reparto = await q(
      `SELECT CASE WHEN n = 0 THEN 'sin pacientes'
                   WHEN n = 1 THEN 'un paciente'
                   ELSE 'varios pacientes' END AS grupo,
              count(*)::int AS cuotas,
              count(*) FILTER (WHERE activa)::int AS activas
         FROM (
           SELECT c.active AS activa,
                  (SELECT count(*) FROM "${schema}".patients p WHERE p.client_id = c.client_id) AS n
             FROM "${schema}".billing_cuotas c
            WHERE c.patient_id IS NULL
         ) t
        GROUP BY grupo
        ORDER BY grupo`
    );
    const [{ con, sin }] = await q(
      `SELECT count(*) FILTER (WHERE patient_id IS NOT NULL)::int AS con,
              count(*) FILTER (WHERE patient_id IS NULL)::int AS sin
         FROM "${schema}".billing_cuotas`
    );
    if (con + sin === 0) continue; // sin cuotas: no se dice nada de este cliente

    process.stdout.write(`\n▶ ${schema}\n`);
    process.stdout.write(`  cuotas: ${con + sin} · con paciente: ${con} · sin paciente: ${sin}\n`);
    for (const r of reparto) {
      process.stdout.write(`    · familia con ${r.grupo}: ${r.cuotas} (${r.activas} activas)\n`);
    }
    const enlazables = reparto.find((r) => r.grupo === "un paciente")?.cuotas ?? 0;
    if (!enlazables) {
      process.stdout.write("    nada que enlazar aquí.\n");
      continue;
    }

    if (!confirm) {
      process.stdout.write(`    → se enlazarían ${enlazables}.\n`);
      totalEnlazadas += enlazables;
      continue;
    }

    // Una sola sentencia y dentro de su transacción: o se enlazan todas las de
    // este cliente o ninguna. La subconsulta del `= 1` es la valla — sin ella,
    // una familia con dos hijos cogería uno al azar.
    const t = await s.transaction();
    try {
      const [, meta] = await s.query(
        `UPDATE "${schema}".billing_cuotas c
            SET patient_id = p.id, updated_at = now()
           FROM "${schema}".patients p
          WHERE c.patient_id IS NULL
            AND p.client_id = c.client_id
            AND (SELECT count(*) FROM "${schema}".patients p2 WHERE p2.client_id = c.client_id) = 1`,
        { transaction: t }
      );
      await t.commit();
      const escritas = meta?.rowCount ?? enlazables;
      totalEnlazadas += escritas;
      process.stdout.write(`    ✓ ${escritas} cuotas enlazadas con su paciente.\n`);
    } catch (err) {
      await t.rollback();
      process.stderr.write(`    ✗ ${schema}: ${err.message}\n`);
      throw err;
    }
  }

  process.stdout.write(
    confirm
      ? `\n✓ Total enlazadas: ${totalEnlazadas}\n`
      : `\nEN SECO: no se ha escrito nada. Repite con --confirm (se enlazarían ${totalEnlazadas}).\n`
  );
  await s.close();
}

main().catch((err) => {
  process.stderr.write(`✗ ${err.message}\n`);
  process.exit(1);
});
