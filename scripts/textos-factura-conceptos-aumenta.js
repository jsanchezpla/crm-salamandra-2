// @vivo — Pone a cada concepto de cuota de Aumenta el «Texto en la factura» que le corresponde, para que la factura de la familia no diga qué terapia hace su hijo. Se ejecutó el 09/09/2026; se relanza si se añaden conceptos de cuota.
/**
 * textos-factura-conceptos-aumenta.js — el otro nombre de cada concepto
 * (09/09/2026, Rodrigo: «hay un problema con los conceptos, no corresponden a
 * las cuotas de la forma en la que sí corresponden en Organízate… normalmente
 * son Terapia 1h semanal etc»).
 *
 *   docker exec crm-salamandra-app-1 node scripts/textos-factura-conceptos-aumenta.js [--confirm] [--pisar]
 *
 * ENSAYA POR DEFECTO. Solo escribe con `--confirm`.
 *
 * ── DE DÓNDE VIENE ─────────────────────────────────────────────────────────
 * En el Organízate cada cuota (Cursos → Zona pacientes) tiene DOS campos:
 * «Nombre» —el interno, «CUOTA LOGOPEDIA 60X1»— y «Concepto factura», que es
 * lo que se imprime. Leídos los 46 el 09/09/2026, **ninguno** dice la terapia:
 * todos hablan de «Terapia» a secas, así que logopedia, pedagogía, psicología
 * y T.O. de la misma dosis facturan con la misma frase. La factura de una
 * familia no tiene por qué decir qué terapias recibe su hijo.
 *
 * El volcado del 01/09 se trajo solo el primer campo: creó los conceptos con
 * el nombre interno y dejó en `description` una nota del propio volcado
 * («Cuota mensual (CUOTA LOGOPEDIA 45X1 en el Organízate)»). Y `description`
 * es justo lo que el CRM imprime — se llama «Texto en la factura» en
 * Configuración → Conceptos.
 *
 * ── QUÉ HACE ───────────────────────────────────────────────────────────────
 * A cada concepto de cuota le pone como texto de factura el del catálogo que
 * Rodrigo dictó el 31/08 («Terapia 45 min semanales»), que es el equivalente
 * genérico y **coincide al céntimo** con el precio de su cuota. El nombre
 * interno NO se toca: es el que distingue las terapias y del que dependen el
 * prorrateo por sesiones, saber qué cita paga qué cuota y las carpetas de
 * «Fichas a completar».
 *
 * Por defecto solo pisa lo que escribió el volcado (las notas «Cuota mensual
 * (… en el Organízate)») y lo que esté vacío. Un texto escrito por el centro
 * se respeta y se lista, salvo con `--pisar`.
 *
 * Los cobros YA generados no cambian solos: llevan su línea de factura
 * congelada. Para ellos, `scripts/backfill-payments-invoice-text.js`.
 */

import { Sequelize, QueryTypes } from "sequelize";

const args = process.argv.slice(2);
const CONFIRMAR = args.includes("--confirm");
const PISAR = args.includes("--pisar");
const SCHEMA = "crm_aumenta"; // el catálogo ES de Aumenta: sus cuotas, su Organízate

const log = (m = "") => process.stdout.write(`${m}\n`);

/**
 * Concepto del CRM → el texto con el que sale impreso. La derecha son nombres
 * del catálogo que ya existe (los 31/08), no frases inventadas: por eso el
 * centro los reconoce. Cada línea lleva el precio de los dos lados, que es lo
 * que hace comprobable el emparejamiento — y coinciden todos.
 */
const TEXTO_DE_FACTURA = {
  // 105 €
  "Cuota Logopedia 30x1": "Terapia 30 min semanales",
  "Cuota T.O. 30x1": "Terapia 30 min semanales",
  // 145 €
  "Cuota Logopedia 45x1": "Terapia 45 min semanales",
  "Cuota Pedagogía 45x1": "Terapia 45 min semanales",
  "Cuota Psicología 45x1": "Terapia 45 min semanales",
  "Cuota T.O. 45x1": "Terapia 45 min semanales",
  // 190 €
  "Cuota Logopedia 60x1": "Terapia 1 h semanal",
  "Cuota Pedagogía 60x1": "Terapia 1 h semanal",
  "Cuota Psicología 60x1": "Terapia 1 h semanal",
  "Cuota T.O. 60x1": "Terapia 1 h semanal",
  // 290 €
  "Cuota Logopedia 45x2": "2 sesiones de 45 min semanales",
  "Cuota Pedagogía 45x2": "2 sesiones de 45 min semanales",
  "Cuota Psicología 2x45": "2 sesiones de 45 min semanales",
  "Cuota T.O. 45x2": "2 sesiones de 45 min semanales",
  // 380 €
  "Cuota Logopedia 60x2": "2 sesiones de 1 h semanales",
  "Cuota Psicología 60x2": "2 sesiones de 1 h semanales",
  "Cuota T.O. 60x2": "2 sesiones de 1 h semanales",
  // Grupales: el catálogo ya los tenía con su nombre de factura.
  "Cuota HHSS": "Grupal 1 h semanal", // 80 €
  "Cuota HHSS 1h 30": "Grupal 1 h 30 semanales", // 120 €
  "Cuota Refuerzo / TT.EE. 1 día": "Grupal: 1 sesión semanal de 1 h", // 55 €
  "Cuota Refuerzo / TT.EE. 2 días": "Grupal: 2 sesiones semanales de 1 h", // 85 €
  /*
   * 335 € = 190 + 145, y no hay un genérico para la suma. Se escribe siguiendo
   * la forma de los demás; en el Organízate la frase existe pero está cortada a
   * mitad de palabra («1 sesión de 45 minutos semanal y 1 sesión de 1 h»),
   * porque ese campo suyo son 50 caracteres.
   */
  "Cuota T.O. 60+45": "1 sesión de 45 min y 1 sesión de 1 h semanales",
};

/** La descripción que dejó el volcado del 01/09, y que sí se puede pisar. */
const esDelVolcado = (t) => !String(t ?? "").trim() || /^Cuota mensual \(.*en el Organízate\)/i.test(String(t).trim());

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  log("\n════════════════════════════════════════════════════");
  log(" Texto en la factura de los conceptos de cuota — aumenta");
  log(` ${CONFIRMAR ? "ESCRIBIENDO" : "ENSAYO (no escribe)"}${PISAR ? " · pisa también lo escrito a mano" : ""}`);
  log("════════════════════════════════════════════════════\n");

  const conceptos = await s.query(
    `SELECT id, name, description, unit_price FROM "${SCHEMA}".billing_concepts ORDER BY name`,
    { type: QueryTypes.SELECT }
  );
  const porNombre = new Map(conceptos.map((c) => [c.name, c]));

  const cambios = [], iguales = [], respetados = [], sinConcepto = [], sinDestino = [];

  for (const [nombre, texto] of Object.entries(TEXTO_DE_FACTURA)) {
    const c = porNombre.get(nombre);
    if (!c) { sinConcepto.push(nombre); continue; }
    // El texto de factura elegido tiene que existir como concepto del catálogo
    // (menos el de 60+45, que se escribe aquí): si no, es que alguien lo
    // renombró y este mapa se quedó viejo.
    if (!porNombre.has(texto) && nombre !== "Cuota T.O. 60+45") sinDestino.push(`${nombre} → ${texto}`);
    const equivalente = porNombre.get(texto);
    if (equivalente && Number(equivalente.unit_price) !== Number(c.unit_price)) {
      sinDestino.push(`${nombre} (${c.unit_price} €) → ${texto} (${equivalente.unit_price} €): NO cuadran los precios`);
      continue;
    }
    if (String(c.description ?? "").trim() === texto) { iguales.push(nombre); continue; }
    if (!esDelVolcado(c.description) && !PISAR) { respetados.push(`${nombre}: «${c.description}»`); continue; }
    cambios.push({ id: c.id, nombre, antes: c.description, texto, precio: c.unit_price });
  }

  if (cambios.length) {
    log(`▶ ${cambios.length} concepto(s) a cambiar:\n`);
    for (const c of cambios) log(`   ${c.nombre.padEnd(32)} ${String(c.precio).padStart(7)} €   →  «${c.texto}»`);
    log("");
  }
  if (iguales.length) log(`· ${iguales.length} ya lo tenían puesto`);
  if (respetados.length) {
    log(`\n⚠️  ${respetados.length} con un texto escrito a mano, NO se tocan (--pisar para forzarlos):`);
    for (const r of respetados) log(`   ${r}`);
  }
  if (sinConcepto.length) log(`\n· ${sinConcepto.length} del mapa que no están en el catálogo: ${sinConcepto.join(", ")}`);
  if (sinDestino.length) {
    log(`\n✗ ${sinDestino.length} sin equivalente válido en el catálogo — REVISAR:`);
    for (const d of sinDestino) log(`   ${d}`);
  }

  // Los conceptos de cuota que nadie ha mapeado: se dicen, para que no pasen
  // desapercibidos y acaben imprimiendo su nombre interno.
  const huerfanos = conceptos.filter((c) => /^Cuota /i.test(c.name) && !(c.name in TEXTO_DE_FACTURA));
  if (huerfanos.length) {
    log(`\n⚠️  ${huerfanos.length} concepto(s) «Cuota …» sin texto de factura en este mapa:`);
    for (const h of huerfanos) log(`   ${h.name} (${h.unit_price} €)`);
  }

  if (!CONFIRMAR) {
    log("\n(ensayo: no se ha escrito nada — añade --confirm)\n");
    await s.close();
    return;
  }
  if (!cambios.length) { log("\n✓ Nada que cambiar\n"); await s.close(); return; }

  await s.transaction(async (t) => {
    for (const c of cambios) {
      await s.query(
        `UPDATE "${SCHEMA}".billing_concepts SET description = $1, updated_at = now() WHERE id = $2`,
        { bind: [c.texto, c.id], transaction: t }
      );
    }
  });
  log(`\n✓ ${cambios.length} concepto(s) actualizados\n`);
  await s.close();
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e.message}\n`);
  process.exit(1);
});
