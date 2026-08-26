/**
 * migrate-invoices-client-restrict.js
 *
 * La relación `invoices.client_id → clients` pasa de **ON DELETE CASCADE** a
 * **ON DELETE RESTRICT**.
 *
 * ── POR QUÉ (26/08/2026) ───────────────────────────────────────────────────
 * Tal como estaba, borrar una ficha borraba sus facturas — y con ellas sus
 * cobros, porque `payments.invoice_id` también está en cascada. Lo único que lo
 * contenía era un `if` en `app/api/clients/[id]/route.js`, o sea un freno de
 * aplicación en UNA puerta: cualquier otro camino que llegue a `clients` (un
 * script, un borrado en lote) se lo salta y la base obedece sin decir nada.
 *
 * En Aumenta son 14.243 facturas, todas numeradas. La numeración de una serie
 * es correlativa SIN HUECOS por obligación fiscal, así que esto no sería perder
 * unos documentos: sería agujerear ejercicios ya declarados.
 *
 * Con RESTRICT, el «no» lo dice la base de datos y el `if` del endpoint pasa a
 * ser lo que debe ser: un mensaje bonito por delante de una garantía real.
 *
 * ⚠️ NO cambia a SET NULL, que sería lo que haría falta para poder borrar la
 * ficha y conservar la factura. Eso pide antes que la factura se sostenga sola
 * (`migrate-invoice-fiscal-snapshot.js`), y aun así es una decisión de producto
 * que nadie ha tomado: hoy el CRM no borra fichas con facturas y punto.
 *
 * ── Y DE PASO, LAS DUPLICADAS ─────────────────────────────────────────────
 * La misma columna tenía la restricción declarada varias veces —2 en
 * `crm_aumenta` y en `crm_spain_enzymes`, **4** en `crm_demo`—, restos de las
 * sincronizaciones automáticas de esquema de otras épocas. Se dejan todas en
 * UNA, con el nombre que generaría Sequelize.
 *
 * NO TOCA NI UNA FILA. Es estructura: si falla, falla el ALTER entero de ese
 * schema y los demás siguen. Idempotente: si ya hay exactamente una y es
 * RESTRICT, no hace nada.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-invoices-client-restrict.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-invoices-client-restrict.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

const NOMBRE = "invoices_client_id_fkey";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}
function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

/** Las restricciones que hoy atan `invoices.client_id` a `clients`. */
async function fksActuales(s, schema) {
  const [filas] = await s.query(
    `SELECT tc.constraint_name AS nombre, rc.delete_rule AS regla
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       JOIN information_schema.referential_constraints rc
         ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = :schema
        AND tc.table_name = 'invoices'
        AND kcu.column_name = 'client_id'
        AND ccu.table_name = 'clients'`,
    { replacements: { schema } }
  );
  return filas;
}

async function processSchema(s, schema) {
  const antes = await fksActuales(s, schema);
  const yaEsta = antes.length === 1 && antes[0].regla === "RESTRICT" && antes[0].nombre === NOMBRE;
  if (yaEsta) return { cambiado: false, antes: antes.length };

  /*
   * Antes de tocar nada: ¿hay facturas apuntando a una ficha que ya no existe?
   *
   * No debería —la restricción de hoy lo impide— pero si alguna se declaró
   * NOT VALID en su día, podría haberlas, y entonces el ALTER de abajo fallaría
   * a mitad. Vale más pararse en este schema y decirlo que dejar la tabla sin
   * ninguna restricción porque el DROP salió y el ADD no.
   */
  const [[huerfanas]] = await s.query(
    `SELECT count(*)::int AS n FROM "${schema}"."invoices" i
      WHERE i.client_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "${schema}"."clients" c WHERE c.id = i.client_id)`
  );
  if (huerfanas.n > 0) {
    throw new Error(
      `${huerfanas.n} factura(s) apuntan a una ficha que no existe: se deja como estaba y hay que mirarlo a mano`
    );
  }

  // Todo dentro de UNA transacción: o hay restricción nueva, o se queda la
  // vieja. En ningún momento la tabla se queda sin ninguna.
  await s.transaction(async (t) => {
    for (const fk of antes) {
      await s.query(`ALTER TABLE "${schema}"."invoices" DROP CONSTRAINT "${fk.nombre}"`, {
        transaction: t,
      });
    }
    await s.query(
      `ALTER TABLE "${schema}"."invoices"
         ADD CONSTRAINT "${NOMBRE}" FOREIGN KEY (client_id)
         REFERENCES "${schema}"."clients" (id) ON UPDATE CASCADE ON DELETE RESTRICT`,
      { transaction: t }
    );
  });
  return { cambiado: true, antes: antes.length };
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: borrar una ficha ya no borra sus facturas\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  header("Schemas con tabla `invoices`...");
  const { schemas, skipped } = await byTable(sequelize, "invoices");
  if (schemas.length === 0) {
    log("· Ningún schema con tabla invoices. Nada que hacer.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length}: ${schemas.join(", ")}`);
  if (skipped.length) log(`· sin tabla invoices, se omiten: ${skipped.join(", ")}`);

  header("Cambiando la regla de borrado...");
  let fallos = 0;
  for (const schema of schemas) {
    try {
      const r = await processSchema(sequelize, schema);
      if (r.cambiado) log(`✓ ${schema}: ${r.antes} restricción(es) → 1 con ON DELETE RESTRICT`);
      else log(`· ${schema}: ya estaba`);
    } catch (err) {
      fallos += 1;
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  header("Comprobación final...");
  for (const schema of schemas) {
    const fks = await fksActuales(sequelize, schema);
    const reglas = fks.map((f) => `${f.nombre}=${f.regla}`).join(", ") || "(ninguna)";
    log(`${fks.length === 1 && fks[0].regla === "RESTRICT" ? "✓" : "✗"} ${schema}: ${reglas}`);
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(
    fallos ? ` ✗ Terminada con ${fallos} schema(s) sin cambiar\n` : " ✓ Migración completada\n"
  );
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await sequelize.close();
  process.exit(fallos ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
