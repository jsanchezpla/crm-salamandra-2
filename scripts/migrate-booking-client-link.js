/**
 * migrate-booking-client-link.js
 *
 * Enlaza las citas con la ficha de cliente DE VERDAD.
 *
 * EL PROBLEMA QUE ARREGLA
 * Hasta hoy `bookings` no tenía ninguna clave hacia `clients`: guardaba
 * client_name / client_email / client_phone como texto suelto, y "las citas de
 * esta clienta" se resolvía comparando cadenas de email (ILIKE). Era una
 * decisión explícita documentada en docs/modules/citas.md, pero se rompe sola
 * en cuanto la vida real interviene:
 *
 *   - la misma persona reserva con Ana.Lopez@gmail.com y su ficha dice
 *     ana.lopez@gmail.com → para el CRM son dos personas;
 *   - una paciente cambia de correo → sus citas antiguas se le despegan;
 *   - una cita creada a mano con el nombre mal escrito no aparece en su ficha.
 *
 * QUÉ HACE, schema a schema:
 *   1. ALTER TABLE bookings ADD COLUMN IF NOT EXISTS client_id UUID
 *   2. FK a clients(id) ON DELETE SET NULL — SET NULL y no CASCADE a
 *      propósito: borrar una ficha no puede llevarse por delante el histórico
 *      de citas, que tiene valor contable y clínico.
 *   3. Índice por client_id (la ficha del cliente lista sus citas).
 *   4. RELLENO HACIA ATRÁS: empareja las citas existentes con su cliente por
 *      email en minúsculas y sin espacios. Solo cuando el email casa con UNA
 *      única ficha: si dos clientes comparten correo (una madre que apunta a
 *      dos hijas) se deja a NULL y que lo resuelva una persona, que adivinar
 *      ahí es peor que no hacer nada.
 *
 * El texto (client_name/email/phone) SE QUEDA: es la foto del momento de la
 * reserva y sigue siendo lo que se imprime y se envía por correo. El enlace es
 * un añadido, no un sustituto — y así ninguna cita vieja se queda coja.
 *
 * Selecciona schemas por EXISTENCIA de tabla (scripts/_schema-targets.js).
 * Aditiva e idempotente. Transacción por schema.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-booking-client-link.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-booking-client-link.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: citas enlazadas con la ficha de cliente\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  header("Schemas con tabla `bookings`...");
  const { schemas } = await byTable(s, "bookings");
  if (schemas.length === 0) log("· Ninguno.");

  let totalEnlazadas = 0;
  let totalAmbiguas = 0;
  let totalSinFicha = 0;

  for (const schema of schemas) {
    try {
      // ARREGLO 2026-07-23 (revision de bugs): la COLUMNA client_id se añade
      // SIEMPRE en todo tenant con `bookings`, tenga o no tabla `clients`.
      // Antes esta migracion se saltaba ENTERO el schema sin `clients`, dejando
      // el modelo Booking (que declara clientId siempre) apuntando a una columna
      // inexistente → 42703 al leer citas. Es el mismo patron que tumbo a Laura;
      // el fix ecb7fff corrigio 5 migraciones hermanas pero se dejo esta.
      // Solo la FK y el relleno hacia atras necesitan `clients`.
      const [[{ existe }]] = await s.query(
        `SELECT to_regclass('"${schema}"."clients"') IS NOT NULL AS existe`
      );

      await s.transaction(async (t) => {
        await s.query(
          `ALTER TABLE "${schema}"."bookings" ADD COLUMN IF NOT EXISTS client_id UUID`,
          { transaction: t }
        );

        // FK y relleno SOLO si existe clients. addFk hace no-op seguro igual.
        if (existe) {
          await s.query(
            `DO $$
             BEGIN
               ALTER TABLE "${schema}"."bookings"
                 ADD CONSTRAINT bookings_client_id_fkey
                 FOREIGN KEY (client_id) REFERENCES "${schema}"."clients"(id)
                 ON UPDATE CASCADE ON DELETE SET NULL;
             EXCEPTION
               WHEN duplicate_object THEN NULL;
               WHEN duplicate_table  THEN NULL;
             END $$;`,
            { transaction: t }
          );
        }

        await s.query(
          `CREATE INDEX IF NOT EXISTS bookings_client_idx
             ON "${schema}"."bookings" (client_id)`,
          { transaction: t }
        );
      });

      if (!existe) {
        log(`✓ ${schema}: columna lista (sin clients: sin FK ni relleno)`);
        continue;
      }

      // ── Relleno hacia atrás ────────────────────────────────────────────
      // Solo emails que apuntan a UNA sola ficha. El resto se deja a NULL.
      const [resultado] = await s.query(
        `WITH unicos AS (
           SELECT lower(btrim(email)) AS clave, min(id::text)::uuid AS client_id
             FROM "${schema}"."clients"
            WHERE email IS NOT NULL AND btrim(email) <> ''
            GROUP BY lower(btrim(email))
           HAVING count(*) = 1
         )
         UPDATE "${schema}"."bookings" b
            SET client_id = u.client_id
           FROM unicos u
          WHERE b.client_id IS NULL
            AND b.client_email IS NOT NULL
            AND lower(btrim(b.client_email)) = u.clave
         RETURNING b.id`
      );
      const enlazadas = Array.isArray(resultado) ? resultado.length : 0;

      const [[conteos]] = await s.query(
        `SELECT
           count(*) FILTER (WHERE client_id IS NULL AND client_email IS NOT NULL) AS sin_ficha,
           count(*) AS total
         FROM "${schema}"."bookings"`
      );

      // ¿Cuántas se quedaron fuera por email compartido entre dos fichas?
      const [[ambiguas]] = await s.query(
        `WITH repes AS (
           SELECT lower(btrim(email)) AS clave
             FROM "${schema}"."clients"
            WHERE email IS NOT NULL AND btrim(email) <> ''
            GROUP BY lower(btrim(email))
           HAVING count(*) > 1
         )
         SELECT count(*) AS n
           FROM "${schema}"."bookings" b
           JOIN repes r ON lower(btrim(b.client_email)) = r.clave
          WHERE b.client_id IS NULL`
      );

      totalEnlazadas += enlazadas;
      totalSinFicha += Number(conteos.sin_ficha) || 0;
      totalAmbiguas += Number(ambiguas.n) || 0;

      log(
        `✓ ${schema}: columna lista · ${enlazadas} de ${conteos.total} citas enlazadas` +
        (Number(ambiguas.n) > 0 ? ` · ${ambiguas.n} sin enlazar por email compartido` : "")
      );
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n──────────────────────────────────────────────────\n");
  log(`Enlazadas hacia atrás: ${totalEnlazadas}`);
  log(`Sin ficha que las reclame: ${totalSinFicha} (normal: reservas de gente que aún no es cliente)`);
  if (totalAmbiguas > 0) {
    log(`Ambiguas por email repetido en dos fichas: ${totalAmbiguas} — se dejan a NULL a propósito`);
  }
  process.stdout.write("──────────────────────────────────────────────────\n");
  process.stdout.write("\n ✓ Migración completada\n\n");

  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
