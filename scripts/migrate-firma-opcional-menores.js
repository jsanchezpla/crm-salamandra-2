/**
 * migrate-firma-opcional-menores.js
 *
 * Una persona menor de edad puede firmar su contrato SIN dibujar la firma.
 *
 * Por qué (Rodrigo, 06/08/2026): la firma de una menor depende de su edad y su
 * madurez —una niña de 8 años no firma nada— y quien autoriza de verdad es su
 * tutor legal, que firma el consentimiento parental justo después. Hasta hoy eso
 * se resolvía al revés: se le exigía firmar su contrato y ADEMÁS se le pedía una
 * segunda firma de «asentimiento» dentro del consentimiento parental. La misma
 * persona firmaba dos veces el mismo acto, y la segunda vez encima ya la había
 * autorizado su tutor.
 *
 * Qué hace: quita el NOT NULL de `contract_signatures.signature_path`. Nada más.
 * El documento se sostiene igual sin el dibujo: lo que da valor a una firma
 * electrónica simple es la traza (quién, cuándo, desde qué IP, qué clausulado y
 * qué versión), y eso sigue guardándose entero.
 *
 * Sin slugs a mano: recorre los schemas que tengan la tabla, leyendo la lista de
 * `master.tenants` en tiempo de ejecución. Idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-firma-opcional-menores.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-firma-opcional-menores.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

const FIRMAS = "contract_signatures";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Firma opcional para menores de edad\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  const { schemas } = await byTable(s, FIRMAS);
  if (schemas.length === 0) log("· Ningún schema tiene la tabla de firmas todavía.");

  for (const schema of schemas) {
    try {
      await s.query(
        `ALTER TABLE "${schema}"."${FIRMAS}" ALTER COLUMN signature_path DROP NOT NULL`
      );
      log(`✓ ${schema}: signature_path admite NULL`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n✓ Migración completada\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
