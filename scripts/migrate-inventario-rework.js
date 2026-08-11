/**
 * migrate-inventario-rework.js — Inventario, rehecho de cero (02/08/2026).
 *
 * Decisión de Rodrigo: *«Inventario es un módulo hecho a medias. Pidieron algo
 * raro y al final ni lo compraron. Quiero un módulo más lógico y normal.»*
 *
 * ⚠️ ESTA MIGRACIÓN **BORRA TABLAS**. Es la única del proyecto que lo hace, así
 * que conviene entender por qué se puede:
 *
 * Comprobado en producción el 02/08/2026 antes de escribir una línea:
 *   · aumenta        → módulo activo, TODO A CERO
 *   · demo           → 5 productos, 5 lotes, 4 de salida: semilla del escaparate
 *   · spain_enzymes  → módulo ya desactivado, 0 filas
 *   · pedidos        → 22 pedidos y 42 líneas, TODOS en demo
 * Y confirmado por Rodrigo: *«son todos datos demo, nadie tiene nada»*.
 *
 * O sea: **no se pierde ningún dato real**. Si esto se ejecutara en un entorno
 * donde SÍ hubiera datos, sería destructivo — por eso el script CUENTA las filas
 * antes de borrar y **se planta** si encuentra algo en un schema que no sea
 * `crm_demo`, en vez de fiarse de lo que decía este comentario hace meses.
 *
 * Se puede forzar con `--forzar` (para reseñar la demo), y `--dry-run` enseña lo
 * que haría sin tocar nada.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-inventario-rework.js --dry-run
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-inventario-rework.js
 */

import { Sequelize } from "sequelize";
import { acotarSchemas } from "./_solo-este-tenant.js";

const DRY = process.argv.includes("--dry-run");
const FORZAR = process.argv.includes("--forzar");

function log(m) { process.stdout.write(`  ${m}\n`); }

/**
 * Schemas cuyos datos de inventario SÍ se pueden tirar sin preguntar.
 *
 * `crm_demo_golden` es la FOTO de la demo (la que se usa para restaurarla), así
 * que tiene exactamente los mismos datos falsos. Se descubrió al mirar
 * producción antes de desplegar: la salvaguarda habría parado la migración a
 * media lista de schemas, que es justo lo que pasó el 02/08 con
 * migrate-external-contacts. Mejor nombrarlo aquí que lanzar con `--forzar`,
 * que desactivaría la protección para TODOS.
 */
const SCHEMAS_DEMO = new Set(["crm_demo", "crm_demo_golden"]);

// Las que se van. Ver cabecera.
const TABLAS_VIEJAS = [
  "formulas",              // unir productos para fabricar otro: submódulo aparte si se pide
  "client_outbound_aliases", // vender con otro nombre por cliente: confirmado eliminar
  "inbound_batches",
  "inbound_products",
  "outbound_products",
];

async function listSchemas(s) {
  const [rows] = await s.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
  );
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSchemas(rows.map((r) => r.schema_name));
}
async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}
async function columnExists(s, schema, table, column) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
    { bind: [schema, table, column] }
  );
  return rows.length > 0;
}
async function contar(s, schema, table) {
  if (!(await tableExists(s, schema, table))) return 0;
  const [rows] = await s.query(`SELECT COUNT(*)::int AS n FROM "${schema}"."${table}"`);
  return rows[0]?.n ?? 0;
}
async function ensureUuidFn(s) {
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* sin permiso */ }
  try { await s.query(`SELECT gen_random_uuid()`); return true; } catch { return false; }
}
async function constraintExists(s, schema, name) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.conname=$2`,
    { bind: [schema, name] }
  );
  return rows.length > 0;
}
async function intentarFk(s, schema, nombre, sql) {
  try {
    await s.query(sql);
  } catch (err) {
    const msg = err?.parent?.message ?? err?.message ?? "";
    if (err?.parent?.code === "42830" || /no unique constraint matching/i.test(msg)) {
      log(`⚠ ${schema}: sin FK ${nombre} (tabla referenciada sin clave primaria; schema de copia)`);
      return;
    }
    throw err;
  }
}

/** Lo que hay hoy en el inventario viejo de este schema. */
async function inventarioViejo(s, schema) {
  const partes = {};
  let total = 0;
  for (const t of [...TABLAS_VIEJAS, "stock_movements"]) {
    const n = await contar(s, schema, t);
    if (n) partes[t] = n;
    total += n;
  }
  return { partes, total };
}

async function processSchema(s, schema, uuidDefault) {
  const tieneInventario =
    (await tableExists(s, schema, "inbound_products")) ||
    (await tableExists(s, schema, "products")) ||
    (await tableExists(s, schema, "outbound_products"));
  if (!tieneInventario) {
    log(`· ${schema}: sin inventario, se salta`);
    return;
  }

  // ── Salvaguarda: no borrar datos que alguien crea suyos ──────────────────
  const viejo = await inventarioViejo(s, schema);
  if (viejo.total > 0 && !SCHEMAS_DEMO.has(schema) && !FORZAR) {
    const detalle = Object.entries(viejo.partes).map(([t, n]) => `${t}=${n}`).join(", ");
    throw new Error(
      `${schema} tiene datos de inventario (${detalle}).\n` +
      `    Este rework se aprobó porque NO había datos reales. Revísalo antes de seguir.\n` +
      `    Si de verdad son descartables: vuelve a lanzarlo con --forzar.`
    );
  }
  if (viejo.total > 0) log(`· ${schema}: ${viejo.total} filas viejas (demo/forzado) → se borran`);

  const pk = uuidDefault ? "DEFAULT gen_random_uuid()" : "";

  // ── products ─────────────────────────────────────────────────────────────
  if (!(await tableExists(s, schema, "products"))) {
    if (DRY) log(`[dry] ${schema}: crearía products`);
    else {
      await s.query(`
        CREATE TABLE "${schema}"."products" (
          id             UUID PRIMARY KEY ${pk},
          name           VARCHAR(200) NOT NULL,
          sku            VARCHAR(60),
          category       VARCHAR(80),
          unit           VARCHAR(20) NOT NULL DEFAULT 'ud',
          purchase_price NUMERIC(10,2),
          sale_price     NUMERIC(10,2),
          min_stock      NUMERIC(12,3),
          active         BOOLEAN NOT NULL DEFAULT TRUE,
          notes          TEXT,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // CHECK en vez de ENUM de Postgres: añadir una unidad nueva es un ALTER
      // trivial, mientras que ampliar un tipo ENUM en 10 schemas es un suplicio.
      await s.query(`
        ALTER TABLE "${schema}"."products" ADD CONSTRAINT products_unit_chk
          CHECK (unit IN ('ud','kg','g','l','ml','caja','paquete'))
      `);
      log(`✓ ${schema}: tabla products creada`);
    }
  } else log(`· ${schema}: products ya existía`);

  if (!DRY) {
    await s.query(`CREATE INDEX IF NOT EXISTS "products_name_idx"     ON "${schema}"."products" (name)`);
    await s.query(`CREATE INDEX IF NOT EXISTS "products_active_idx"   ON "${schema}"."products" (active)`);
    await s.query(`CREATE INDEX IF NOT EXISTS "products_category_idx" ON "${schema}"."products" (category)`);
  }

  // ── stock_entries ────────────────────────────────────────────────────────
  if (!(await tableExists(s, schema, "stock_entries"))) {
    if (DRY) log(`[dry] ${schema}: crearía stock_entries`);
    else {
      await s.query(`
        CREATE TABLE "${schema}"."stock_entries" (
          id          UUID PRIMARY KEY ${pk},
          product_id  UUID NOT NULL,
          supplier_id UUID,
          entry_date  DATE NOT NULL,
          quantity    NUMERIC(12,3) NOT NULL,
          unit_cost   NUMERIC(10,2),
          lot         VARCHAR(80),
          expiry_date DATE,
          cost_id     UUID,
          notes       TEXT,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      log(`✓ ${schema}: tabla stock_entries creada`);
    }
  } else log(`· ${schema}: stock_entries ya existía`);

  // ── stock_movements: se rehace entera (cambia de columnas) ───────────────
  //
  // OJO: solo si sigue teniendo la forma VIEJA. Sin esta comprobación el script
  // borraba y recreaba la tabla en cada ejecución, y el día que hubiera
  // movimientos de verdad una segunda pasada se los llevaría por delante sin
  // avisar. Una migración tiene que poder ejecutarse dos veces sin hacer daño.
  const movimientosYaNuevos =
    (await tableExists(s, schema, "stock_movements")) &&
    (await columnExists(s, schema, "stock_movements", "product_id"));

  if (!DRY && movimientosYaNuevos) {
    log(`· ${schema}: stock_movements ya estaba rehecha`);
  } else if (!DRY) {
    if (await tableExists(s, schema, "stock_movements")) {
      // Ya está comprobado arriba que no hay datos que salvar.
      await s.query(`DROP TABLE "${schema}"."stock_movements" CASCADE`);
      log(`✓ ${schema}: stock_movements vieja eliminada`);
    }
    await s.query(`
      CREATE TABLE "${schema}"."stock_movements" (
        id             UUID PRIMARY KEY ${pk},
        product_id     UUID NOT NULL,
        quantity       NUMERIC(12,3) NOT NULL,
        type           VARCHAR(20) NOT NULL DEFAULT 'ajuste',
        reason         VARCHAR(255),
        entry_id       UUID,
        order_id       UUID,
        team_member_id UUID,
        moved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await s.query(`
      ALTER TABLE "${schema}"."stock_movements" ADD CONSTRAINT stock_movements_type_chk
        CHECK (type IN ('entrada','salida','ajuste','pedido'))
    `);
    log(`✓ ${schema}: stock_movements nueva creada`);
  }

  if (!DRY) {
    for (const [t, idx, col] of [
      ["stock_entries", "stock_entries_product_idx", "product_id"],
      ["stock_entries", "stock_entries_supplier_idx", "supplier_id"],
      ["stock_entries", "stock_entries_date_idx", "entry_date"],
      ["stock_entries", "stock_entries_cost_idx", "cost_id"],
      ["stock_entries", "stock_entries_expiry_idx", "expiry_date"],
      ["stock_movements", "stock_movements_product_idx", "product_id"],
      ["stock_movements", "stock_movements_date_idx", "moved_at"],
      ["stock_movements", "stock_movements_order_idx", "order_id"],
      ["stock_movements", "stock_movements_entry_idx", "entry_id"],
    ]) {
      await s.query(`CREATE INDEX IF NOT EXISTS "${idx}" ON "${schema}"."${t}" (${col})`);
    }
  }

  // ── Claves ajenas ────────────────────────────────────────────────────────
  if (!DRY) {
    // RESTRICT: borrar un producto con movimientos se llevaría por delante el
    // histórico del almacén. Para retirarlo está `active = false`.
    if (!(await constraintExists(s, schema, "stock_entries_product_fk"))) {
      await intentarFk(s, schema, "stock_entries_product_fk", `
        ALTER TABLE "${schema}"."stock_entries" ADD CONSTRAINT stock_entries_product_fk
          FOREIGN KEY (product_id) REFERENCES "${schema}"."products"(id) ON DELETE RESTRICT`);
    }
    if (!(await constraintExists(s, schema, "stock_movements_product_fk"))) {
      await intentarFk(s, schema, "stock_movements_product_fk", `
        ALTER TABLE "${schema}"."stock_movements" ADD CONSTRAINT stock_movements_product_fk
          FOREIGN KEY (product_id) REFERENCES "${schema}"."products"(id) ON DELETE RESTRICT`);
    }
    // La entrada sí se puede borrar: el movimiento se queda huérfano pero el
    // stock no cambia, que es lo que importa.
    if (!(await constraintExists(s, schema, "stock_movements_entry_fk"))) {
      await intentarFk(s, schema, "stock_movements_entry_fk", `
        ALTER TABLE "${schema}"."stock_movements" ADD CONSTRAINT stock_movements_entry_fk
          FOREIGN KEY (entry_id) REFERENCES "${schema}"."stock_entries"(id) ON DELETE SET NULL`);
    }
    if (await tableExists(s, schema, "suppliers")) {
      if (!(await constraintExists(s, schema, "stock_entries_supplier_fk"))) {
        await intentarFk(s, schema, "stock_entries_supplier_fk", `
          ALTER TABLE "${schema}"."stock_entries" ADD CONSTRAINT stock_entries_supplier_fk
            FOREIGN KEY (supplier_id) REFERENCES "${schema}"."suppliers"(id) ON DELETE SET NULL`);
      }
    } else {
      log(`⚠ ${schema}: sin suppliers — lanza antes migrate-suppliers.js`);
    }
    if (await tableExists(s, schema, "costs")) {
      if (!(await constraintExists(s, schema, "stock_entries_cost_fk"))) {
        await intentarFk(s, schema, "stock_entries_cost_fk", `
          ALTER TABLE "${schema}"."stock_entries" ADD CONSTRAINT stock_entries_cost_fk
            FOREIGN KEY (cost_id) REFERENCES "${schema}"."costs"(id) ON DELETE SET NULL`);
      }
    }
  }

  // ── order_lines: outbound_product_id → product_id ────────────────────────
  if (await tableExists(s, schema, "order_lines")) {
    const tieneViejo = await columnExists(s, schema, "order_lines", "outbound_product_id");
    const tieneNuevo = await columnExists(s, schema, "order_lines", "product_id");
    if (tieneViejo && !tieneNuevo) {
      if (DRY) log(`[dry] ${schema}: renombraría order_lines.outbound_product_id → product_id`);
      else {
        await s.query(`ALTER TABLE "${schema}"."order_lines" RENAME COLUMN outbound_product_id TO product_id`);
        log(`✓ ${schema}: order_lines.product_id renombrada`);
      }
    } else if (!tieneNuevo && !DRY) {
      await s.query(`ALTER TABLE "${schema}"."order_lines" ADD COLUMN product_id UUID`);
      log(`✓ ${schema}: order_lines.product_id añadida`);
    }
    if (!DRY) {
      // Apuntaba a outbound_products, que desaparece: fuera la FK vieja.
      await s.query(`ALTER TABLE "${schema}"."order_lines" DROP CONSTRAINT IF EXISTS order_lines_outbound_product_id_fkey`);
      // Y a NULL los ids que quedaron colgando: apuntan a un catálogo que ya no
      // existe, así que la FK nueva los rechazaría (lo hizo, en la primera
      // ejecución). La línea NO se pierde ni cambia de importe: `product_name` y
      // `unit_price` son foto del momento justo para esto.
      const [huerfanas] = await s.query(`
        UPDATE "${schema}"."order_lines" ol SET product_id = NULL
        WHERE product_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "${schema}"."products" p WHERE p.id = ol.product_id)
        RETURNING 1
      `);
      if (huerfanas.length) log(`· ${schema}: ${huerfanas.length} línea(s) de pedido apuntaban al catálogo viejo → sin producto`);
      await s.query(`CREATE INDEX IF NOT EXISTS "order_lines_product_idx" ON "${schema}"."order_lines" (product_id)`);
      if (!(await constraintExists(s, schema, "order_lines_product_fk"))) {
        // SET NULL: un pedido viejo no puede desaparecer porque se retire un
        // producto. `productName` y `unitPrice` son foto del momento y aguantan.
        await intentarFk(s, schema, "order_lines_product_fk", `
          ALTER TABLE "${schema}"."order_lines" ADD CONSTRAINT order_lines_product_fk
            FOREIGN KEY (product_id) REFERENCES "${schema}"."products"(id) ON DELETE SET NULL`);
      }
    }
  }

  // ── Y ahora sí: fuera las viejas ─────────────────────────────────────────
  for (const t of TABLAS_VIEJAS) {
    if (!(await tableExists(s, schema, t))) continue;
    if (DRY) { log(`[dry] ${schema}: borraría ${t} (${await contar(s, schema, t)} filas)`); continue; }
    await s.query(`DROP TABLE "${schema}"."${t}" CASCADE`);
    log(`✓ ${schema}: ${t} eliminada`);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("Falta DATABASE_URL\n"); process.exit(1); }

  const s = new Sequelize(url, { logging: false });
  try {
    await s.authenticate();
    const uuidDefault = await ensureUuidFn(s);
    const schemas = await listSchemas(s);
    process.stdout.write(`\n▶ Inventario rehecho · ${schemas.length} schema(s)${DRY ? "  [DRY-RUN]" : ""}\n\n`);
    for (const schema of schemas) await processSchema(s, schema, uuidDefault);
    process.stdout.write(DRY ? "\n✓ Dry-run terminado (nada tocado)\n\n" : "\n✓ Migración completada\n\n");
  } finally {
    await s.close();
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.message ?? err}\n`);
  process.exit(1);
});
