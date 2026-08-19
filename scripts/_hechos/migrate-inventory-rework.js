/**
 * migrate-inventory-rework.js
 *
 * Sprint inventario rework. Reemplaza el modelo monolítico InventoryProduct
 * (entrada+salida en una sola fila) por un esquema modular:
 *
 *   InboundProduct   ─ catálogo de productos entrantes (materia prima)
 *   InboundBatch     ─ entregas concretas por proveedor (lote)
 *   OutboundProduct  ─ catálogo de productos salientes (lo que se vende)
 *   Formula          ─ receta outbound = Σ inbound × qty (global o por cliente)
 *   ClientOutboundAlias ─ alias por cliente del producto saliente
 *   StockMovement    ─ histórico auditable de variaciones de stock
 *
 * Estrategia:
 *   - Idempotente. Lee slugs activos desde master.tenants.
 *   - Crea las 6 tablas si no existen con columnas en snake_case (Sequelize
 *     usa underscored:true global; los modelos camelCase se mapean solos).
 *   - Migra cada fila de inventory_products → inbound_product (dedupe por
 *     nombre) + inbound_batch + (si tiene datos de salida) outbound_product
 *     + formula + stock_movement histórico.
 *   - Filas ya migradas se detectan por inbound_batches.legacy_inventory_product_id.
 *   - NO borra inventory_products: se conserva como histórico hasta validar
 *     en producción.
 *
 * Uso:
 *   npm run db:migrate:inventory-rework         (local)
 *   npm run db:migrate:inventory-rework:prod    (producción)
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "../_solo-este-tenant.js";

// ⛔ ESTA MIGRACIÓN ESTÁ SUPERADA Y NO DEBE EJECUTARSE (candado del 18/08/2026).
//
// Es el rework de ABRIL. Crea `inbound_products`, `inbound_batches`,
// `outbound_products`, `formulas` y `client_outbound_aliases`, que son
// exactamente las tablas que `migrate-inventario-rework.js` —con «a», el del
// 02/08/2026— ELIMINA. Lanzarla hoy le devuelve a un cliente el esquema viejo.
//
// `_module-migrations.js` ya la daba por superada y la sacó de la cadena de
// altas. Lo que faltaba era el candado en el propio fichero: hasta hoy
// `package.json` tenía DOS atajos apuntando aquí, y uno de ellos con
// `--env-file=.env.production`. Un `npm run db:migrate:inventory-rework:prod`
// escrito de memoria, o el autocompletado eligiendo mal entre dos nombres que
// solo se diferencian en tres letras, bastaba para romper producción. Los dos
// atajos se han quitado; esto es el segundo cerrojo, para que el peligro no
// dependa de que nadie los vuelva a escribir.
//
// Se conserva el fichero como histórico: cuenta cómo era el modelo anterior y
// hay migraciones posteriores que se leen mejor con esto delante.
if (!process.argv.includes("--soy-consciente-de-que-esto-devuelve-el-esquema-viejo")) {
  process.stderr.write(
    "\n⛔ migrate-inventory-rework.js (sin «a») está SUPERADA desde el 02/08/2026.\n\n" +
      "   Devuelve el esquema de inventario ANTERIOR: inbound_products,\n" +
      "   inbound_batches, outbound_products, formulas y client_outbound_aliases.\n\n" +
      "   Lo que seguramente buscas es la de después, que se llama casi igual:\n" +
      "     node --env-file=.env.local scripts/migrate-inventario-rework.js --dry-run\n\n"
  );
  process.exit(1);
}

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function tableExists(s, t, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table], transaction: t }
  );
  return rows.length > 0;
}

// ─── DDL: crea las 6 tablas si no existen ──────────────────────────────────

async function createInventoryTables(s, t, schema) {
  await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`, { transaction: t });

  // ── inbound_products ────────────────────────────────────────────────────
  await s.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."inbound_products" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      tags VARCHAR(255)[] NOT NULL DEFAULT '{}',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS inbound_products_name_idx ON "${schema}"."inbound_products"(name)`, { transaction: t });

  // ── inbound_batches ─────────────────────────────────────────────────────
  await s.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."inbound_batches" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      inbound_product_id UUID NOT NULL,
      supplier VARCHAR(255) NOT NULL,
      lot VARCHAR(255),
      entry_date DATE,
      kg DECIMAL(10,3) NOT NULL DEFAULT 0,
      kg_remaining DECIMAL(10,3) NOT NULL DEFAULT 0,
      packaging VARCHAR(255),
      purchase_price DECIMAL(10,2),
      notes TEXT,
      legacy_inventory_product_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS inbound_batches_product_idx ON "${schema}"."inbound_batches"(inbound_product_id)`, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS inbound_batches_entry_date_idx ON "${schema}"."inbound_batches"(entry_date)`, { transaction: t });
  await s.query(`CREATE UNIQUE INDEX IF NOT EXISTS inbound_batches_legacy_unique ON "${schema}"."inbound_batches"(legacy_inventory_product_id) WHERE legacy_inventory_product_id IS NOT NULL`, { transaction: t });

  // ── outbound_products ───────────────────────────────────────────────────
  await s.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."outbound_products" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      tags VARCHAR(255)[] NOT NULL DEFAULT '{}',
      default_sale_price DECIMAL(10,2),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS outbound_products_name_idx ON "${schema}"."outbound_products"(name)`, { transaction: t });

  // ── formulas ─────────────────────────────────────────────────────────────
  await s.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."formulas" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      outbound_product_id UUID NOT NULL,
      inbound_product_id UUID NOT NULL,
      qty_kg_per_output_kg DECIMAL(10,4) NOT NULL DEFAULT 1,
      client_id UUID,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS formulas_outbound_idx ON "${schema}"."formulas"(outbound_product_id)`, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS formulas_inbound_idx ON "${schema}"."formulas"(inbound_product_id)`, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS formulas_client_idx ON "${schema}"."formulas"(client_id)`, { transaction: t });
  // UNIQUE con COALESCE: trata client_id NULL como un valor concreto. Garantiza
  // como mucho una receta global por par (outbound, inbound).
  await s.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS formulas_outbound_inbound_client_unique
      ON "${schema}"."formulas"(outbound_product_id, inbound_product_id, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid))
  `, { transaction: t });

  // ── client_outbound_aliases ─────────────────────────────────────────────
  await s.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."client_outbound_aliases" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      outbound_product_id UUID NOT NULL,
      client_id UUID NOT NULL,
      alias_name VARCHAR(255) NOT NULL,
      custom_sale_price DECIMAL(10,2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS client_outbound_aliases_outbound_idx ON "${schema}"."client_outbound_aliases"(outbound_product_id)`, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS client_outbound_aliases_client_idx ON "${schema}"."client_outbound_aliases"(client_id)`, { transaction: t });
  await s.query(`CREATE UNIQUE INDEX IF NOT EXISTS client_outbound_aliases_product_client_unique ON "${schema}"."client_outbound_aliases"(outbound_product_id, client_id)`, { transaction: t });

  // ── stock_movements ──────────────────────────────────────────────────────
  await s.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'enum_stock_movements_reason' AND n.nspname = '${schema}'
      ) THEN
        CREATE TYPE "${schema}"."enum_stock_movements_reason" AS ENUM ('sale', 'manual', 'adjust', 'historical');
      END IF;
    END $$
  `, { transaction: t });

  await s.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."stock_movements" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      inbound_batch_id UUID NOT NULL,
      kg DECIMAL(10,3) NOT NULL,
      reason "${schema}"."enum_stock_movements_reason" NOT NULL DEFAULT 'manual',
      invoice_id UUID,
      invoice_line_id UUID,
      outbound_product_id UUID,
      client_id UUID,
      user_id UUID,
      moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS stock_movements_batch_idx ON "${schema}"."stock_movements"(inbound_batch_id)`, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS stock_movements_invoice_idx ON "${schema}"."stock_movements"(invoice_id)`, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS stock_movements_outbound_idx ON "${schema}"."stock_movements"(outbound_product_id)`, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS stock_movements_client_idx ON "${schema}"."stock_movements"(client_id)`, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS stock_movements_moved_at_idx ON "${schema}"."stock_movements"(moved_at)`, { transaction: t });

  log(`✓ ${schema}: 6 tablas + índices + enum asegurados`);
}

// ─── Migración de datos: inventory_products → modelos nuevos ───────────────

async function migrateLegacyRows(s, t, schema) {
  if (!(await tableExists(s, t, schema, "inventory_products"))) {
    log(`· ${schema}: no hay inventory_products, salto migración de datos`);
    return;
  }

  const [legacyRows] = await s.query(
    `SELECT id, supplier, entry_date, product_name, units, kg, packaging, lot,
            purchase_price, output_name, client_id, exit_date, output_kg,
            sale_price, notes
       FROM "${schema}"."inventory_products"`,
    { transaction: t }
  );

  if (legacyRows.length === 0) {
    log(`· ${schema}.inventory_products: 0 filas, nada que migrar`);
    return;
  }

  let migrated = 0;
  let skipped = 0;
  for (const row of legacyRows) {
    // Idempotencia: si ya hay un batch ligado a esta fila vieja, saltar
    const [existing] = await s.query(
      `SELECT id FROM "${schema}"."inbound_batches" WHERE legacy_inventory_product_id = $1 LIMIT 1`,
      { bind: [row.id], transaction: t }
    );
    if (existing.length > 0) { skipped++; continue; }

    // ── Dedupe inbound_product por nombre ────────────────────────────────
    const inboundName = (row.product_name || "").trim() || "(sin nombre)";
    let inboundProductId;
    const [existingInbound] = await s.query(
      `SELECT id FROM "${schema}"."inbound_products" WHERE name = $1 LIMIT 1`,
      { bind: [inboundName], transaction: t }
    );
    if (existingInbound.length > 0) {
      inboundProductId = existingInbound[0].id;
    } else {
      const [inserted] = await s.query(
        `INSERT INTO "${schema}"."inbound_products" (name) VALUES ($1) RETURNING id`,
        { bind: [inboundName], transaction: t }
      );
      inboundProductId = inserted[0].id;
    }

    // ── Crear inbound_batch ──────────────────────────────────────────────
    const kgIn = Number(row.kg) || 0;
    const kgOut = Number(row.output_kg) || 0;
    const kgRemaining = Math.max(0, kgIn - kgOut);

    const [batchRow] = await s.query(
      `INSERT INTO "${schema}"."inbound_batches"
         (inbound_product_id, supplier, lot, entry_date, kg, kg_remaining,
          packaging, purchase_price, notes, legacy_inventory_product_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      {
        bind: [
          inboundProductId,
          (row.supplier || "").trim() || "(sin proveedor)",
          row.lot,
          row.entry_date,
          kgIn,
          kgRemaining,
          row.packaging,
          row.purchase_price,
          row.notes,
          row.id,
        ],
        transaction: t,
      }
    );
    const batchId = batchRow[0].id;

    // ── Si tiene datos de salida, crear outbound + formula + movimiento ──
    const hasOutput =
      row.output_name || row.client_id || row.exit_date || kgOut > 0 || row.sale_price;

    if (hasOutput) {
      const outboundName = (row.output_name || "").trim() || inboundName;
      let outboundProductId;
      const [existingOutbound] = await s.query(
        `SELECT id FROM "${schema}"."outbound_products" WHERE name = $1 LIMIT 1`,
        { bind: [outboundName], transaction: t }
      );
      if (existingOutbound.length > 0) {
        outboundProductId = existingOutbound[0].id;
      } else {
        const [inserted] = await s.query(
          `INSERT INTO "${schema}"."outbound_products" (name, default_sale_price)
           VALUES ($1, $2) RETURNING id`,
          { bind: [outboundName, row.sale_price], transaction: t }
        );
        outboundProductId = inserted[0].id;
      }

      // Receta: kg input por kg output. Si output_kg = 0, 1:1.
      const qtyRatio = kgOut > 0 ? kgIn / kgOut : 1;
      const [existingFormula] = await s.query(
        `SELECT id FROM "${schema}"."formulas"
         WHERE outbound_product_id = $1 AND inbound_product_id = $2
           AND COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         LIMIT 1`,
        { bind: [outboundProductId, inboundProductId, row.client_id], transaction: t }
      );
      if (existingFormula.length === 0) {
        await s.query(
          `INSERT INTO "${schema}"."formulas"
             (outbound_product_id, inbound_product_id, qty_kg_per_output_kg, client_id)
           VALUES ($1, $2, $3, $4)`,
          {
            bind: [outboundProductId, inboundProductId, qtyRatio.toFixed(4), row.client_id],
            transaction: t,
          }
        );
      }

      // Movimiento histórico (kg negativo = salida ya consumida)
      if (kgOut > 0) {
        await s.query(
          `INSERT INTO "${schema}"."stock_movements"
             (inbound_batch_id, kg, reason, outbound_product_id, client_id,
              moved_at, notes)
           VALUES ($1, $2, 'historical', $3, $4, $5, $6)`,
          {
            bind: [
              batchId,
              -kgOut,
              outboundProductId,
              row.client_id,
              row.exit_date || new Date(),
              "Migrado desde inventory_products",
            ],
            transaction: t,
          }
        );
      }
    }
    migrated++;
  }

  log(`✓ ${schema}.inventory_products: ${migrated} migradas, ${skipped} ya procesadas`);
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function fetchTargetSlugs(s) {
  const [rows] = await s.query(
    `SELECT slug FROM master.tenants ORDER BY slug`
  );
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((r) => r.slug));
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: inventory rework (multi-tenant)          \n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  try {
    const [versionRows] = await sequelize.query("SHOW server_version");
    log(`PostgreSQL: ${versionRows[0]?.server_version ?? "?"}`);

    header("Obteniendo lista de tenants activos...");
    const slugs = await fetchTargetSlugs(sequelize);
    if (slugs.length === 0) {
      log("· No hay tenants activos. Nada que hacer.");
      await sequelize.close();
      process.exit(0);
    }
    log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

    header("Creando tablas nuevas y migrando datos (transacción global)...");
    await sequelize.transaction(async (t) => {
      for (const slug of slugs) {
        const schema = `crm_${slug}`;
        await createInventoryTables(sequelize, t, schema);
        await migrateLegacyRows(sequelize, t, schema);
      }
    });

    process.stdout.write("\n════════════════════════════════════════════════════\n");
    process.stdout.write(" ✓ Migración inventory rework completada              \n");
    process.stdout.write("════════════════════════════════════════════════════\n\n");

    await sequelize.close();
    process.exit(0);
  } catch (err) {
    await sequelize.close();
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
