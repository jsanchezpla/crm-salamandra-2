// @vivo — Herramienta genérica por --slug: pone en cada cobro el paciente de la cuota que lo generó. Se ejecutó en aumenta el 01/09/2026 (los cobros de septiembre, que nacieron antes de que las cuotas tuvieran paciente), y se repite cada vez que un enlace de cuota↔paciente llegue después que sus cobros.
/**
 * backfill-cobro-paciente-desde-cuota.js — el cobro hereda el paciente de SU
 * cuota (01/09/2026).
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 * Los cobros de septiembre de Aumenta se generaron cuando las cuotas eran de la
 * FAMILIA, así que nacieron con `payments.patient_id` a NULL: 259 de 274. Ese
 * mismo día, `backfill-cuota-paciente-unico.js` puso el paciente en las cuotas
 * de las familias con un solo hijo — pero los cobros ya estaban emitidos y
 * nadie vuelve hacia atrás a rellenarlos. Esto es ese paso hacia atrás, y solo
 * hay que darlo una vez por desfase: de aquí en adelante la generación mensual
 * copia el paciente de la cuota al cobro ella sola.
 *
 * ── Qué toca, y qué NO ─────────────────────────────────────────────────────
 * Escribe UNA columna, `payments.patient_id`, y solo en los cobros que:
 *   · nacieron de una cuota (`cuota_id` no nulo) — un cobro apuntado a mano no
 *     tiene de dónde heredar nada;
 *   · todavía no tienen paciente;
 *   · y cuya cuota SÍ lo tiene (las de familias con varios hijos no lo tienen,
 *     y se quedan como están: repartirlas sería inventárselo).
 *
 * **No toca el dinero**: ni importe, ni estado, ni fecha, ni concepto, ni la
 * factura asociada. Y no cambia ninguna agrupación: «Facturar el mes» agrupa
 * por pagador (y por terapia si se pide), nunca por paciente
 * (`lib/billing/lotesCuotas.js`).
 *
 * EN SECO por defecto. `--confirm` para escribir. `--mes AAAA-MM` para acotar.
 *
 * Uso VPS:
 *   docker exec crm-salamandra-app-1 node scripts/backfill-cobro-paciente-desde-cuota.js [--slug aumenta] [--mes 2026-09] [--confirm]
 */

import { Sequelize } from "sequelize";

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const valorDe = (nombre) => {
    const i = args.indexOf(nombre);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
  };
  const slug = valorDe("--slug");
  const mes = valorDe("--mes");

  if (mes && !/^\d{4}-\d{2}$/.test(mes)) {
    process.stderr.write("✗ --mes tiene que ser AAAA-MM\n");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const q = async (sql, replacements) =>
    (await s.query(sql, replacements ? { replacements } : undefined))[0];

  const schemas = (
    await q(
      `SELECT table_schema AS schema
         FROM information_schema.tables
        WHERE table_name IN ('billing_cuotas', 'payments')
          AND table_schema LIKE 'crm\\_%'
        GROUP BY table_schema
       HAVING count(DISTINCT table_name) = 2
        ORDER BY table_schema`
    )
  ).map((r) => r.schema);

  const objetivo = slug ? schemas.filter((x) => x === `crm_${slug}`) : schemas;
  if (!objetivo.length) {
    process.stderr.write(`✗ Ningún schema con billing_cuotas y payments${slug ? ` para ${slug}` : ""}\n`);
    await s.close();
    process.exit(1);
  }

  // El filtro del mes se aplica igual al recuento y al UPDATE: si divergieran,
  // el seco diría una cosa y la escritura haría otra.
  const filtroMes = mes ? `AND to_char(p.period_month, 'YYYY-MM') = :mes` : "";
  const repl = mes ? { mes } : undefined;

  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(` Cobro → paciente de su cuota${mes ? ` · ${mes}` : ""}${confirm ? "" : "   (EN SECO)"}\n`);
  process.stdout.write("════════════════════════════════════════════════════\n");

  let total = 0;

  for (const schema of objetivo) {
    const filas = await q(
      `SELECT to_char(p.period_month, 'YYYY-MM') AS mes,
              count(*)::int AS de_cuota,
              count(*) FILTER (WHERE p.patient_id IS NULL)::int AS sin_paciente,
              count(*) FILTER (WHERE p.patient_id IS NULL AND c.patient_id IS NOT NULL)::int AS enlazables
         FROM "${schema}".payments p
         JOIN "${schema}".billing_cuotas c ON c.id = p.cuota_id
        WHERE p.cuota_id IS NOT NULL ${filtroMes}
        GROUP BY 1 ORDER BY 1`,
      repl
    );
    if (!filas.length) continue;

    process.stdout.write(`\n▶ ${schema}\n`);
    let enlazables = 0;
    for (const f of filas) {
      enlazables += f.enlazables;
      process.stdout.write(
        `  ${f.mes ?? "sin mes"}: ${f.de_cuota} cobros de cuota · ${f.sin_paciente} sin paciente · ${f.enlazables} enlazables\n`
      );
    }
    if (!enlazables) {
      process.stdout.write("    nada que enlazar aquí.\n");
      continue;
    }
    if (!confirm) {
      process.stdout.write(`    → se enlazarían ${enlazables}.\n`);
      total += enlazables;
      continue;
    }

    const t = await s.transaction();
    try {
      const [, meta] = await s.query(
        `UPDATE "${schema}".payments p
            SET patient_id = c.patient_id, updated_at = now()
           FROM "${schema}".billing_cuotas c
          WHERE c.id = p.cuota_id
            AND p.patient_id IS NULL
            AND c.patient_id IS NOT NULL ${filtroMes}`,
        { replacements: repl, transaction: t }
      );
      await t.commit();
      const escritos = meta?.rowCount ?? enlazables;
      total += escritos;
      process.stdout.write(`    ✓ ${escritos} cobros con su paciente.\n`);
    } catch (err) {
      await t.rollback();
      process.stderr.write(`    ✗ ${schema}: ${err.message}\n`);
      throw err;
    }
  }

  process.stdout.write(
    confirm
      ? `\n✓ Total enlazados: ${total}\n`
      : `\nEN SECO: no se ha escrito nada. Repite con --confirm (se enlazarían ${total}).\n`
  );
  await s.close();
}

main().catch((err) => {
  process.stderr.write(`✗ ${err.message}\n`);
  process.exit(1);
});
