/**
 * migrate-tienda.js — la capa de escaparate sobre Inventario.
 *
 * ── QUÉ RESUELVE ───────────────────────────────────────────────────────────
 * Rodrigo, 25/08/2026: «quiero poder crear todo tipo de productos, desde ropa
 * hasta congeladores industriales, que se conecten a la tienda de una URL
 * elegida, que los pedidos vayan a Pedidos y que estén alojados en Inventario;
 * es el trío perfecto».
 *
 * ── POR QUÉ NO HAY UNA TABLA `productos` NUEVA ─────────────────────────────
 * Porque ya existe y es genérica a propósito. El rework de Inventario del
 * 02/08/2026 dejó UNA tabla `products` con su `unit` (ud/kg/g/l/ml/caja) y su
 * `sale_price`, justamente para que valga igual para guantes que para libros.
 * Un módulo «Productos» aparte sería una segunda tabla de productos, y entonces
 * habría dos sitios donde mirar el stock de la misma camiseta.
 *
 * Lo que le faltaba a `products` no era ser producto: era estar PUBLICADO.
 * Esta migración añade solo eso.
 *
 * ── LAS TRES PIEZAS ────────────────────────────────────────────────────────
 *  1. `products` gana los campos de escaparate (slug, descripción, fotos,
 *     publicado, IVA). `publicado` es distinto de `active`: `active` es «lo
 *     seguimos manejando», `publicado` es «se ve en la tienda». Un congelador
 *     descatalogado sigue activo en el almacén y no debe salir a la venta.
 *  2. `product_variants` — la talla y el color. Sin esto no se puede vender una
 *     camiseta, que es el caso que lo motivó.
 *  3. `orders` gana la dirección de envío. Un pedido de mostrador no la
 *     necesita; uno de la web, sí.
 *
 * `stock_movements` NO se toca salvo por `variant_id`: su ENUM ya tenía el tipo
 * `pedido` y su `order_id` desde el rework. El enganche estaba previsto.
 *
 * Aditiva e idempotente: todo `IF NOT EXISTS`, ninguna fila existente cambia.
 * Puede correr ANTES del despliegue sin romper lo que está sirviendo.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-tienda.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-tienda.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  // Solo los schemas que YA tienen Inventario: crear la tienda donde no hay
  // productos sería dejar tablas vacías en nueve clientes que no la han pedido.
  const { schemas, skipped } = await byTable(s, "products");
  if (skipped.length) console.log(`Sin Inventario (se saltan): ${skipped.length}`);
  if (!schemas.length) {
    console.log("Ningún schema tiene la tabla `products`. Nada que hacer.");
    await s.close();
    return;
  }

  console.log(`Schemas con Inventario: ${schemas.length}\n`);

  for (const schema of schemas) {
    const q = (sql) => s.query(sql.replaceAll("{S}", `"${schema}"`));
    console.log(`▶ ${schema}`);

    // ── 1. Escaparate en products ────────────────────────────────────────
    await q(`
      ALTER TABLE {S}.products
        ADD COLUMN IF NOT EXISTS slug          VARCHAR(160),
        ADD COLUMN IF NOT EXISTS description   TEXT,
        ADD COLUMN IF NOT EXISTS images        JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS publicado     BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS tax_rate      NUMERIC(5,2),
        ADD COLUMN IF NOT EXISTS sort_order    INTEGER NOT NULL DEFAULT 0
    `);
    // `publicado` arranca en false a propósito: activar el módulo no puede
    // sacar a la venta el material de oficina de una clínica.
    console.log("   ✓ products: slug, description, images, publicado, tax_rate, sort_order");

    await q(`
      CREATE UNIQUE INDEX IF NOT EXISTS products_slug_key
        ON {S}.products (slug) WHERE slug IS NOT NULL
    `);
    await q(`
      CREATE INDEX IF NOT EXISTS products_publicado_idx
        ON {S}.products (publicado) WHERE publicado = true
    `);
    console.log("   ✓ índices de slug y publicados");

    // ── 2. Variantes ─────────────────────────────────────────────────────
    await q(`
      CREATE TABLE IF NOT EXISTS {S}.product_variants (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id  UUID NOT NULL REFERENCES {S}.products(id) ON DELETE CASCADE,
        name        VARCHAR(120) NOT NULL,
        sku         VARCHAR(80),
        sale_price  NUMERIC(10,2),
        sort_order  INTEGER NOT NULL DEFAULT 0,
        active      BOOLEAN NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // `sale_price` nullable = hereda el del producto. Así una camiseta con
    // cuatro tallas al mismo precio se define una vez, y la XXL que cuesta dos
    // euros más se resuelve rellenando UN campo.
    await q(`
      CREATE INDEX IF NOT EXISTS product_variants_product_idx
        ON {S}.product_variants (product_id)
    `);
    console.log("   ✓ product_variants");

    // ── 3. La variante en los movimientos y en las líneas ────────────────
    await q(`
      ALTER TABLE {S}.stock_movements
        ADD COLUMN IF NOT EXISTS variant_id UUID
    `);
    await q(`
      ALTER TABLE {S}.order_lines
        ADD COLUMN IF NOT EXISTS variant_id   UUID,
        ADD COLUMN IF NOT EXISTS variant_name VARCHAR(120)
    `);
    // `variant_name` copiado, como ya se copia `product_name`: la línea de un
    // pedido de hace dos años tiene que seguir diciendo «Talla M» aunque esa
    // variante se haya borrado.
    console.log("   ✓ variant_id en stock_movements y order_lines");

    // ── 4. Dirección de envío del pedido ─────────────────────────────────
    await q(`
      ALTER TABLE {S}.orders
        ADD COLUMN IF NOT EXISTS shipping_address JSONB,
        ADD COLUMN IF NOT EXISTS origin           VARCHAR(20) NOT NULL DEFAULT 'manual',
        ADD COLUMN IF NOT EXISTS payment_session_id UUID
    `);
    // `origin` separa el pedido de la web del que teclea alguien en el CRM.
    // Es lo que permite mirar «cuánto vendemos online» sin adivinarlo, y lo
    // mismo que ya hace `SessionPack.origin` con los bonos.
    console.log("   ✓ orders: shipping_address, origin, payment_session_id");

    console.log("");
  }

  await s.close();
  console.log("✓ Migración de la tienda terminada.");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
