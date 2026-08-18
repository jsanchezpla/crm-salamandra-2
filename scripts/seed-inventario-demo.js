/**
 * seed-inventario-demo.js — llena el almacén del tenant `demo` (02/08/2026).
 *
 * El rework de Inventario dejó la demo vacía, y la demo es el escaparate: una
 * pantalla en blanco no enseña nada. Se siembra con **material de un centro
 * clínico**, no con producto químico como antes, porque es lo que se enseña.
 *
 * Los datos están elegidos para que se vean las cuatro cosas que hace el módulo:
 *
 *   · Unidades DISTINTAS (unidades, cajas, litros, paquetes) — el arreglo de
 *     fondo del rework.
 *   · Algún producto **bajo mínimo**, para que se vea el aviso.
 *   · Entradas con proveedor, lote y caducidad.
 *   · Salidas y algún ajuste con su motivo, para que la ficha tenga histórico.
 *
 * SOLO toca `crm_demo`. Es idempotente: si ya hay productos, no hace nada (con
 * `--rehacer` los borra y los vuelve a poner).
 *
 * ── YA NO HACE FALTA PARA QUE LA DEMO TENGA ALMACÉN (18/08/2026) ────────────
 *
 * Nació porque `seed-sandbox-data.js` sembraba el inventario con los modelos
 * que el rework del 02/08 había borrado, y dejaba el almacén vacío. Como aquel
 * fallo se tragaba solo, esto se escribió al lado en vez de arreglarlo, y quedó
 * sin que lo llamara NADIE: ni el rebuild del escaparate, ni un atajo de
 * `package.json`. La demo de producción se sembró a mano desde aquí una vez, y
 * ahí se quedó la cosa.
 *
 * El 18/08 se arregló el sembrado de verdad, con un catálogo genérico que
 * comparten las cuatro demos (decisión de Jorge). Así que esto ya no es la
 * forma de que la demo tenga almacén: es un EXTRA opcional, a mano, para
 * ponerle a `demo` un catálogo de centro clínico en vez del genérico. Si se
 * lanza después del rebuild SUMA seis productos a los que ya hay; con
 * `--rehacer` los sustituye.
 *
 * Uso: node --env-file=.env.local scripts/seed-inventario-demo.js
 */

import { Sequelize } from "sequelize";

const REHACER = process.argv.includes("--rehacer");
const SCHEMA = "crm_demo";

function log(m) { process.stdout.write(`  ${m}\n`); }

const PROVEEDORES = [
  { name: "Suministros Clínicos Ibéricos", taxId: "B84512309", email: "pedidos@sciberica.es", contactName: "Marta Ureña" },
  { name: "Papelería Guadarrama", taxId: "B79004412", email: "hola@papeleriaguadarrama.es", contactName: "Luis Pardo" },
  { name: "Editorial Aprende+", taxId: "B12388741", email: "distribucion@aprendemas.es", contactName: "Nuria Casals" },
];

// stock = suma de movimientos; aquí se declara lo que se quiere ver.
const PRODUCTOS = [
  { name: "Guantes de nitrilo talla M", sku: "GN-M", category: "Material fungible", unit: "caja",
    purchasePrice: 4.8, salePrice: null, minStock: 5, entradas: [{ prov: 0, cant: 24, coste: 4.8, lote: "L-2411", cad: "2027-04-30" }],
    salidas: [{ cant: 6, motivo: "Consumo de consultas" }] },
  { name: "Gel hidroalcohólico", sku: "GEL-1L", category: "Material fungible", unit: "l",
    purchasePrice: 3.2, salePrice: null, minStock: 10, entradas: [{ prov: 0, cant: 20, coste: 3.2, cad: "2027-01-31" }],
    salidas: [{ cant: 13, motivo: "Reposición de dispensadores" }] },
  { name: "Folios A4 80g", sku: "A4-80", category: "Oficina", unit: "paquete",
    purchasePrice: 3.95, salePrice: null, minStock: 8, entradas: [{ prov: 1, cant: 40, coste: 3.95 }],
    salidas: [{ cant: 35, motivo: "Consumo de informes y fichas" }] },
  { name: "Cuaderno de trabajo — Atención y memoria", sku: "CT-AM", category: "Material de trabajo", unit: "ud",
    purchasePrice: 6.5, salePrice: 12, minStock: 6, entradas: [{ prov: 2, cant: 30, coste: 6.5 }],
    salidas: [{ cant: 11, motivo: "Entregados a familias" }] },
  { name: "Juego de tarjetas — Habilidades sociales", sku: "TJ-HHSS", category: "Material de trabajo", unit: "ud",
    purchasePrice: 14, salePrice: 24, minStock: null, entradas: [{ prov: 2, cant: 12, coste: 14 }],
    salidas: [{ cant: 3, motivo: "Entregados a familias" }] },
  { name: "Pañuelos de papel", sku: "PAN-100", category: "Material fungible", unit: "caja",
    purchasePrice: 1.1, salePrice: null, minStock: 12, entradas: [{ prov: 1, cant: 30, coste: 1.1 }],
    salidas: [{ cant: 22, motivo: "Consumo de despachos" }],
    ajuste: { cant: -3, motivo: "Se mojaron con una fuga del radiador" } },
];

async function tableExists(s, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
    { bind: [SCHEMA, table] }
  );
  return rows.length > 0;
}
async function contar(s, table) {
  const [rows] = await s.query(`SELECT COUNT(*)::int AS n FROM "${SCHEMA}"."${table}"`);
  return rows[0]?.n ?? 0;
}
/** Fecha relativa a hoy, en ISO corto. Los seeds no pueden llevar fechas fijas o
 *  envejecen: a los seis meses el escaparate enseña movimientos de "hace un año". */
function haceDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("Falta DATABASE_URL\n"); process.exit(1); }

  const s = new Sequelize(url, { logging: false });
  try {
    await s.authenticate();

    if (!(await tableExists(s, "products"))) {
      process.stderr.write(`\n✗ ${SCHEMA} no tiene la tabla products. Lanza antes migrate-inventario-rework.js\n\n`);
      process.exit(1);
    }

    const yaHay = await contar(s, "products");
    if (yaHay > 0 && !REHACER) {
      process.stdout.write(`\n· ${SCHEMA} ya tiene ${yaHay} producto(s). Nada que hacer (--rehacer para rehacerlo).\n\n`);
      return;
    }
    if (yaHay > 0) {
      await s.query(`DELETE FROM "${SCHEMA}"."stock_movements"`);
      await s.query(`DELETE FROM "${SCHEMA}"."stock_entries"`);
      await s.query(`DELETE FROM "${SCHEMA}"."products"`);
      log(`limpiados ${yaHay} producto(s) anteriores`);
    }

    process.stdout.write(`\n▶ Sembrando el almacén de ${SCHEMA}\n\n`);

    // Proveedores (los del almacén; puede que ya existan de otra semilla).
    const provIds = [];
    for (const p of PROVEEDORES) {
      const [ya] = await s.query(
        `SELECT id FROM "${SCHEMA}"."suppliers" WHERE lower(name)=lower($1) LIMIT 1`,
        { bind: [p.name] }
      );
      if (ya.length) { provIds.push(ya[0].id); continue; }
      const [ins] = await s.query(
        `INSERT INTO "${SCHEMA}"."suppliers" (id, name, tax_id, email, contact_name, active, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, TRUE, NOW(), NOW()) RETURNING id`,
        { bind: [p.name, p.taxId, p.email, p.contactName] }
      );
      provIds.push(ins[0].id);
    }
    log(`${provIds.length} proveedores listos`);

    let nMov = 0;
    for (const prod of PRODUCTOS) {
      const [pr] = await s.query(
        `INSERT INTO "${SCHEMA}"."products"
           (id, name, sku, category, unit, purchase_price, sale_price, min_stock, active, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), NOW()) RETURNING id`,
        { bind: [prod.name, prod.sku, prod.category, prod.unit, prod.purchasePrice, prod.salePrice, prod.minStock] }
      );
      const productId = pr[0].id;

      for (const e of prod.entradas) {
        const fecha = haceDias(45);
        const [en] = await s.query(
          `INSERT INTO "${SCHEMA}"."stock_entries"
             (id, product_id, supplier_id, entry_date, quantity, unit_cost, lot, expiry_date, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING id`,
          { bind: [productId, provIds[e.prov], fecha, e.cant, e.coste, e.lote ?? null, e.cad ?? null] }
        );
        await s.query(
          `INSERT INTO "${SCHEMA}"."stock_movements"
             (id, product_id, quantity, type, reason, entry_id, moved_at, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, 'entrada', $3, $4, $5, NOW(), NOW())`,
          { bind: [productId, e.cant, e.lote ? `Entrada · lote ${e.lote}` : "Entrada de mercancía", en[0].id, `${fecha}T12:00:00`] }
        );
        nMov++;
      }

      for (const sal of prod.salidas ?? []) {
        await s.query(
          `INSERT INTO "${SCHEMA}"."stock_movements"
             (id, product_id, quantity, type, reason, moved_at, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, 'salida', $3, $4, NOW(), NOW())`,
          { bind: [productId, -Math.abs(sal.cant), sal.motivo, `${haceDias(12)}T10:30:00`] }
        );
        nMov++;
      }

      if (prod.ajuste) {
        await s.query(
          `INSERT INTO "${SCHEMA}"."stock_movements"
             (id, product_id, quantity, type, reason, moved_at, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, 'ajuste', $3, $4, NOW(), NOW())`,
          { bind: [productId, prod.ajuste.cant, prod.ajuste.motivo, `${haceDias(4)}T17:45:00`] }
        );
        nMov++;
      }

      log(`✓ ${prod.name}`);
    }

    // Comprobación: el stock resultante es el que se quería enseñar.
    const [resumen] = await s.query(`
      SELECT p.name, p.unit, p.min_stock,
             COALESCE(SUM(m.quantity), 0) AS stock
        FROM "${SCHEMA}"."products" p
        LEFT JOIN "${SCHEMA}"."stock_movements" m ON m.product_id = p.id
       GROUP BY p.id, p.name, p.unit, p.min_stock
       ORDER BY p.name
    `);
    process.stdout.write(`\n  Stock resultante (${nMov} movimientos):\n`);
    let bajos = 0;
    for (const r of resumen) {
      const bajo = r.min_stock !== null && Number(r.stock) < Number(r.min_stock);
      if (bajo) bajos++;
      log(`${bajo ? "⚠" : "·"} ${r.name}: ${Number(r.stock)} ${r.unit}${bajo ? `  (mínimo ${Number(r.min_stock)})` : ""}`);
    }
    process.stdout.write(`\n✓ Almacén de la demo sembrado · ${bajos} producto(s) bajo mínimo para que se vea el aviso\n\n`);
  } finally {
    await s.close();
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.message ?? err}\n`);
  process.exit(1);
});
