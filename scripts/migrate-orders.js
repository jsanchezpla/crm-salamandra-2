/**
 * migrate-orders.js — las tablas de Pedidos, por fin en el mapa (03/09/2026).
 *
 * ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
 * `orders`, `order_lines` y `order_settings` solo las creaba
 * `scripts/_hechos/add-orders-module-spain-enzymes.js`, con el slug escrito
 * dentro. Es decir: activar Pedidos en un cliente nuevo con `enable-module.js`
 * ponía la fila en `master.tenant_modules` y el menú, y NINGUNA tabla debajo.
 * Se vio el día que Pedidos pasó a colgar de Productos y hubo que poder
 * provisionar el trío de fábrica.
 *
 * ── POR QUÉ NO HAY ENUM DE POSTGRES ─────────────────────────────────────────
 * El script histórico creaba `enum_orders_status` como tipo del schema. Un tipo
 * es propiedad del schema y las fotos doradas de las demos se copian sin él,
 * así que aquí `status` es VARCHAR con CHECK: mismos valores, sin tipo que
 * copiar. El modelo Sequelize sigue declarando ENUM y le da igual: solo lee y
 * escribe cadenas.
 *
 * Los schemas que YA tienen las tablas (spain_enzymes, demo, laura_ubeda…) no
 * se tocan: todo es IF NOT EXISTS y el CHECK solo se añade donde la columna se
 * crea aquí. Idempotente y aditiva.
 *
 * Sin FK a `clients` ni a `invoices` a propósito, como en el histórico: son
 * tablas de otros módulos y no todo cliente con Pedidos las tiene en el mismo
 * orden. Las asociaciones lógicas las pone `lib/db/tenantDb.js`.
 *
 * Elige los schemas POR MÓDULO (`byModule`): crear las tres tablas de Pedidos
 * en un cliente que no las ha comprado sería justo lo que la cabecera de
 * `_schema-targets.js` prohíbe.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-orders.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-orders.js
 */

import { Sequelize } from "sequelize";
import { byModule, tableExists } from "./_schema-targets.js";

const ESTADOS = ["draft", "confirmed", "preparing", "shipped", "completed", "cancelled"];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  const { schemas } = await byModule(s, ["orders", "tienda"]);
  if (!schemas.length) {
    console.log("Ningún tenant tiene Pedidos. Nada que hacer.");
    await s.close();
    return;
  }
  console.log(`Schemas con Pedidos: ${schemas.length}\n`);

  for (const schema of schemas) {
    console.log(`▶ ${schema}`);

    // ── orders ───────────────────────────────────────────────────────────
    if (await tableExists(s, schema, "orders")) {
      console.log("   · orders ya existe");
    } else {
      await s.query(`
        CREATE TABLE IF NOT EXISTS "${schema}"."orders" (
          id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id          UUID NOT NULL,
          status             VARCHAR(20) NOT NULL DEFAULT 'draft'
                             CHECK (status IN (${ESTADOS.map((e) => `'${e}'`).join(", ")})),
          subtotal           NUMERIC(12,2) NOT NULL DEFAULT 0,
          transport_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
          total              NUMERIC(12,2) NOT NULL DEFAULT 0,
          scheduled_date     DATE,
          delivered_at       TIMESTAMPTZ,
          invoice_id         UUID,
          notes              TEXT,
          custom_fields      JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      console.log("   ✓ orders");
    }
    await s.query(`CREATE INDEX IF NOT EXISTS "orders_client_id_idx" ON "${schema}"."orders" (client_id)`);
    await s.query(`CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "${schema}"."orders" (status)`);
    await s.query(`CREATE INDEX IF NOT EXISTS "orders_invoice_id_idx" ON "${schema}"."orders" (invoice_id)`);

    // ── order_lines ──────────────────────────────────────────────────────
    // `product_id` desde el primer día: el nombre viejo (`outbound_product_id`)
    // lo renombra el rework de Inventario donde lo encuentre.
    if (await tableExists(s, schema, "order_lines")) {
      console.log("   · order_lines ya existe");
    } else {
      await s.query(`
        CREATE TABLE IF NOT EXISTS "${schema}"."order_lines" (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id      UUID NOT NULL REFERENCES "${schema}"."orders"(id) ON DELETE CASCADE,
          product_id    UUID,
          product_name  VARCHAR(255) NOT NULL,
          quantity      NUMERIC(12,3) NOT NULL DEFAULT 1,
          unit_price    NUMERIC(10,2) NOT NULL DEFAULT 0,
          line_total    NUMERIC(12,2) NOT NULL DEFAULT 0,
          notes         TEXT,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      console.log("   ✓ order_lines");
    }
    await s.query(`CREATE INDEX IF NOT EXISTS "order_lines_order_id_idx" ON "${schema}"."order_lines" (order_id)`);
    await s.query(`CREATE INDEX IF NOT EXISTS "order_lines_product_id_idx" ON "${schema}"."order_lines" (product_id)`);

    // ── order_settings ───────────────────────────────────────────────────
    // Sin fila inicial: el endpoint devuelve los valores por defecto si no
    // hay ninguna y la crea al guardar (app/api/orders/settings/route.js).
    if (await tableExists(s, schema, "order_settings")) {
      console.log("   · order_settings ya existe");
    } else {
      await s.query(`
        CREATE TABLE IF NOT EXISTS "${schema}"."order_settings" (
          id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          transport_price     NUMERIC(10,2) NOT NULL DEFAULT 0,
          transport_vat_rate  NUMERIC(5,2) NOT NULL DEFAULT 21,
          default_vat_rate    NUMERIC(5,2) NOT NULL DEFAULT 21,
          created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      console.log("   ✓ order_settings");
    }
  }

  await s.close();
  console.log("\n✓ Hecho");
}

main().catch((err) => {
  console.error(`\n✗ Error: ${err.message}`);
  process.exit(1);
});
