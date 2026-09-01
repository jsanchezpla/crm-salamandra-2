// @vivo — Herramienta genérica por --slug: tiende el puente de `clients.cuota_concept_ids` a `billing_cuotas` en CUALQUIER tenant que llegue con las cuotas aprendidas de un sistema viejo. Se ejecutó en aumenta el 01/09/2026, pero se repite con otro cliente (criterio de scripts/_hechos/README.md).
/**
 * sembrar-cuotas-desde-aprendidas.js — de la cuota APRENDIDA a la cuota
 * ASIGNADA (01/09/2026).
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 * El volcado del Organízate (`volcar-cuotas-organizate.js`, 01/09/2026) dejó
 * `clients.cuota_concept_ids` relleno en 260 familias de Aumenta: qué conceptos
 * componen la cuota de cada una. Eso sirve para que el drawer de cobro se
 * rellene solo, pero NO sabe decir quién debe pagar este mes: no tiene fecha de
 * alta, ni baja, ni método, así que no se puede programar.
 *
 * Este script tiende el puente: una fila en `billing_cuotas` por familia, con
 * los mismos conceptos. A partir de ahí, «Generar el mes» crea los cobros de
 * todas de una pasada.
 *
 * ── Las tres decisiones que lleva dentro ───────────────────────────────────
 *
 * 1. **El importe se deja a NULL**, que en una cuota significa «lo que digan
 *    sus conceptos». No es pereza: 8 de los 47 conceptos del catálogo están a
 *    0 € esperando a que el centro les ponga precio, y con el importe a NULL,
 *    el día que Rosa los rellene las cuotas se corrigen SOLAS. Congelando la
 *    suma de hoy habría que volver a pasar por 260 filas.
 *
 * 2. **El método se deja a NULL**: el volcado no lo trae y no se inventa. La
 *    pantalla de generación dice cuántas van sin método y con cuál se
 *    registrarían (Banco), que es mejor que descubrirlo después.
 *
 * 3. **Sin paciente**: la cuota aprendida es de la FAMILIA (el volcado suma las
 *    de los hermanos). Repartirla por paciente sería inventarse el reparto.
 *
 * EN SECO por defecto. `--confirm` para escribir. Nunca toca una familia que ya
 * tenga cuota activa, así que relanzarlo no duplica.
 *
 * Uso VPS:
 *   docker exec crm-salamandra-app-1 node scripts/sembrar-cuotas-desde-aprendidas.js [--slug aumenta] [--desde 2026-09-01] [--confirm]
 */

import { Sequelize } from "sequelize";

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const valorDe = (nombre, porDefecto) => {
    const i = args.indexOf(nombre);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : porDefecto;
  };
  const slug = valorDe("--slug", "aumenta");
  const desde = valorDe("--desde", "2026-09-01");
  const schema = `crm_${slug}`;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
    process.stderr.write("✗ --desde tiene que ser AAAA-MM-DD\n");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(` Sembrar cuotas asignadas desde las aprendidas — ${schema}\n`);
  process.stdout.write(` Vigentes desde el ${desde}${confirm ? "" : "   (EN SECO)"}\n`);
  process.stdout.write("════════════════════════════════════════════════════\n\n");

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const q = async (sql, replacements) =>
    (await s.query(sql, replacements ? { replacements } : undefined))[0];

  // Familias con cuota aprendida y SIN cuota asignada viva.
  const familias = await q(
    `SELECT c.id, c.cuota_concept_ids
       FROM "${schema}".clients c
      WHERE c.cuota_concept_ids IS NOT NULL
        AND jsonb_array_length(c.cuota_concept_ids) > 0
        AND NOT EXISTS (
          SELECT 1 FROM "${schema}".billing_cuotas k
           WHERE k.client_id = c.id AND k.active = true
        )`
  );

  const conceptos = await q(`SELECT id, name, unit_price FROM "${schema}".billing_concepts`);
  const porId = new Map(conceptos.map((c) => [String(c.id), c]));

  let sinPrecio = 0;
  let huerfanos = 0;
  let importeTotal = 0;
  const filas = [];

  for (const f of familias) {
    const ids = (Array.isArray(f.cuota_concept_ids) ? f.cuota_concept_ids : []).map(String);
    const vivos = ids.filter((id) => porId.has(id));
    if (vivos.length !== ids.length) huerfanos++;
    if (!vivos.length) continue; // sin un solo concepto vivo no hay cuota que sembrar
    const importe = vivos.reduce((acc, id) => acc + Number(porId.get(id).unit_price || 0), 0);
    if (importe === 0) sinPrecio++;
    importeTotal += importe;
    filas.push({ clientId: f.id, ids: vivos, importe });
  }

  process.stdout.write(`Familias con cuota aprendida y sin cuota asignada: ${familias.length}\n`);
  process.stdout.write(`Se sembrarían: ${filas.length} cuotas\n`);
  process.stdout.write(`Importe mensual que sumarían: ${importeTotal.toFixed(2)} €\n`);
  if (sinPrecio) {
    process.stdout.write(
      `⚠ ${sinPrecio} quedarían a 0 € porque sus conceptos aún no tienen precio.\n` +
      `  NO es un error: el importe va a NULL, así que se corrigen solas en cuanto\n` +
      `  el centro les ponga precio en Configuración → Conceptos y cuotas.\n`
    );
  }
  if (huerfanos) {
    process.stdout.write(`⚠ ${huerfanos} familias tenían algún concepto que ya no existe: se ignora ese concepto.\n`);
  }

  if (!confirm) {
    process.stdout.write("\nEN SECO: no se ha escrito nada. Repite con --confirm para sembrar.\n");
    await s.close();
    return;
  }

  const t = await s.transaction();
  try {
    for (const fila of filas) {
      await s.query(
        `INSERT INTO "${schema}".billing_cuotas
           (client_id, concept_ids, amount, method, start_date, active, notes, created_at, updated_at)
         VALUES (:clientId, CAST(:ids AS jsonb), NULL, NULL, :desde, true, :nota, now(), now())`,
        {
          replacements: {
            clientId: fila.clientId,
            ids: JSON.stringify(fila.ids),
            desde,
            nota: "Alta automática desde la cuota aprendida del volcado del Organízate (01/09/2026).",
          },
          transaction: t,
        }
      );
    }
    await t.commit();
    process.stdout.write(`\n✓ ${filas.length} cuotas sembradas.\n`);
    process.stdout.write("  Siguiente paso: Facturación → Cuotas → «Generar el mes».\n");
  } catch (e) {
    await t.rollback();
    throw e;
  }

  await s.close();
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e.message}\n`);
  process.exit(1);
});
