// @vivo — Rellena `payments.invoice_text` en los cobros de cuota que ya estaban generados cuando se añadió la columna, traduciendo los nombres internos de su nota al «Texto en la factura» de cada concepto. Se ejecutó el 09/09/2026.
/**
 * backfill-payments-invoice-text.js — la línea de factura de lo ya generado
 * (09/09/2026).
 *
 *   docker exec crm-salamandra-app-1 node scripts/backfill-payments-invoice-text.js [aumenta] [--desde=2026-09] [--confirm] [--detalle]
 *
 * ENSAYA POR DEFECTO. Solo escribe con `--confirm`.
 *
 * ── QUÉ ARREGLA ────────────────────────────────────────────────────────────
 * Desde hoy el cobro de una cuota nace con dos frases: la NOTA, que lleva los
 * nombres internos de los conceptos y es la que ve el centro en Cobros, y el
 * TEXTO DE FACTURA, que lleva el «Texto en la factura» de cada concepto y es
 * lo único que ve la familia. Los cobros generados ANTES solo tienen la nota,
 * así que al facturarlos saldría impreso «Cuota Logopedia 45x1 + Cuota T.O.
 * 45x1» — la terapia del niño en un documento fiscal.
 *
 * ── CÓMO LO CALCULA ────────────────────────────────────────────────────────
 * No reconstruye el cobro: TRADUCE su propia nota, que es la única fuente de
 * lo que se decidió aquel día. La nota que escribe `notaDeCobro` tiene la
 * forma
 *
 *     Cuota septiembre 2026 — Cuota Logopedia 45x1 + Cuota T.O. 45x1 — 3 de 4 sesiones
 *     └── el mes ──────────┘   └── los conceptos ─────────────────┘   └─ el rótulo ─┘
 *
 * y solo se toca el trozo del medio, concepto a concepto y por nombre exacto.
 * El mes y el rótulo del prorrateo se quedan como están: explican el importe y
 * son igual de válidos para la familia.
 *
 * Si algún nombre de ese trozo no está en el catálogo (lo renombraron después),
 * ese cobro NO se toca y se cuenta aparte: prefiere quedarse como estaba a
 * imprimir media frase.
 *
 * Solo toca cobros de cuota (`cuota_id` no nulo) sin `invoice_text`, y NUNCA
 * uno que ya esté facturado (`invoice_id`): esa línea ya está impresa y
 * numerada. Idempotente.
 */

import { Sequelize, QueryTypes } from "sequelize";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--")) ?? "aumenta";
const CONFIRMAR = args.includes("--confirm");
const DETALLE = args.includes("--detalle");
const desdeArg = args.find((a) => a.startsWith("--desde="))?.split("=")[1];
const DESDE = desdeArg && /^\d{4}-\d{2}$/.test(desdeArg) ? `${desdeArg}-01` : "2026-09-01";

const log = (m = "") => process.stdout.write(`${m}\n`);
const SEP = " — ";

/**
 * Traduce el trozo de conceptos de una nota. Devuelve `null` si no hay nada
 * que traducir o si algún nombre no se reconoce (ver cabecera).
 */
export function traducirNota(nota, textoPorNombre) {
  const partes = String(nota ?? "").split(SEP);
  if (partes.length < 2) return null; // solo «Cuota septiembre 2026»: nada que traducir
  const conceptos = partes[1].split(" + ").map((s) => s.trim());
  if (!conceptos.length || conceptos.some((n) => !textoPorNombre.has(n))) return null;
  const traducidos = conceptos.map((n) => textoPorNombre.get(n));
  if (traducidos.join(" + ") === partes[1]) return null; // ya decía lo mismo
  return [partes[0], traducidos.join(" + "), ...partes.slice(2)].join(SEP);
}

async function main() {
  if (!/^[a-z0-9_]+$/.test(slug) || !process.env.DATABASE_URL) {
    process.stderr.write("\nUso: node scripts/backfill-payments-invoice-text.js <slug> [--desde=AAAA-MM] [--confirm] [--detalle]\n\n");
    process.exit(1);
  }
  const S = `crm_${slug}`;
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const q = (sql, bind) => s.query(sql, { bind, type: QueryTypes.SELECT });

  log("\n════════════════════════════════════════════════════");
  log(` Texto de factura de los cobros ya generados — ${slug}`);
  log(` Desde ${DESDE} · ${CONFIRMAR ? "ESCRIBIENDO" : "ENSAYO (no escribe)"}`);
  log("════════════════════════════════════════════════════\n");

  const conceptos = await q(`SELECT name, description FROM "${S}".billing_concepts`);
  const textoPorNombre = new Map(
    conceptos.map((c) => [c.name, (String(c.description ?? "").trim() || c.name)])
  );

  const cobros = await q(
    `SELECT id, notes, amount, period_month::text AS mes
       FROM "${S}".payments
      WHERE cuota_id IS NOT NULL AND invoice_text IS NULL AND invoice_id IS NULL
        AND period_month >= $1
      ORDER BY period_month, id`,
    [DESDE]
  );

  const cambios = [], sinTraduccion = [];
  for (const c of cobros) {
    const nuevo = traducirNota(c.notes, textoPorNombre);
    if (!nuevo) { sinTraduccion.push(c); continue; }
    cambios.push({ id: c.id, antes: c.notes, texto: nuevo });
  }

  log(`Cobros de cuota sin texto de factura y sin facturar: ${cobros.length}`);
  log(`  A rellenar:        ${cambios.length}`);
  log(`  Se quedan igual:   ${sinTraduccion.length}  (su nota no lleva conceptos reconocibles)`);

  if (cambios.length) {
    log(`\nEjemplos de cómo quedarían:\n`);
    for (const c of cambios.slice(0, DETALLE ? cambios.length : 6)) {
      log(`   antes: ${c.antes}`);
      log(`   ahora: ${c.texto}\n`);
    }
  }
  if (DETALLE && sinTraduccion.length) {
    log(`Notas que no se han sabido traducir:`);
    for (const c of sinTraduccion.slice(0, 20)) log(`   ${c.notes ?? "(sin nota)"}`);
  }

  if (!CONFIRMAR) {
    log("(ensayo: no se ha escrito nada — añade --confirm)\n");
    await s.close();
    return;
  }
  if (!cambios.length) { log("\n✓ Nada que rellenar\n"); await s.close(); return; }

  await s.transaction(async (t) => {
    for (const c of cambios) {
      await s.query(`UPDATE "${S}".payments SET invoice_text = $1, updated_at = now() WHERE id = $2`, {
        bind: [c.texto, c.id],
        transaction: t,
      });
    }
  });
  log(`\n✓ ${cambios.length} cobro(s) con su texto de factura\n`);
  await s.close();
}

// Importable por el smoke sin correr nada.
if (process.argv[1] && process.argv[1].endsWith("backfill-payments-invoice-text.js")) {
  main().catch((e) => {
    process.stderr.write(`\n✗ ${e.message}\n`);
    process.exit(1);
  });
}
