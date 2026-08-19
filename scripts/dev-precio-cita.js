// @vivo — Utilidad de DESARROLLO genérica por slug para ver, poner (euros → céntimos con redondeo) o quitar (`--quitar`) el precio del primer tipo de cita y… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * dev-precio-cita.js — pone o quita el precio de un tipo de cita, para poder
 * probar el flujo de cobro en local sin entrar al CRM.
 *
 * En producción esto lo hace la profesional desde su pantalla de Configuración;
 * esto es solo para desarrollo.
 *
 * Uso:
 *   node --env-file=.env.local scripts/dev-precio-cita.js nutri_laura            (ver)
 *   node --env-file=.env.local scripts/dev-precio-cita.js nutri_laura 45         (45,00 €)
 *   node --env-file=.env.local scripts/dev-precio-cita.js nutri_laura --quitar
 */

import { getTenantDb } from "../lib/db/tenantDb.js";

async function main() {
  const [slug, arg] = process.argv.slice(2);
  if (!slug) {
    process.stderr.write("\n✗ Falta el slug.\n  Uso: dev-precio-cita.js <slug> [euros|--quitar]\n\n");
    process.exit(1);
  }

  const { models } = getTenantDb(slug);
  const tipos = await models.EventType.findAll({ order: [["order", "ASC"]] });
  if (!tipos.length) {
    process.stderr.write(`\n✗ ${slug} no tiene tipos de cita.\n\n`);
    process.exit(1);
  }

  if (arg === undefined) {
    process.stdout.write(`\n▶ Tipos de cita de ${slug}\n`);
    for (const t of tipos) {
      const p = t.price == null ? "sin precio (gratuita)" : `${(t.price / 100).toFixed(2)} €`;
      process.stdout.write(`  · ${t.name} — ${p}\n`);
    }
    process.stdout.write("\n");
    process.exit(0);
  }

  const quitar = arg === "--quitar";
  let centimos = null;
  if (!quitar) {
    const euros = Number(String(arg).replace(",", "."));
    if (!Number.isFinite(euros) || euros <= 0) {
      process.stderr.write(`\n✗ "${arg}" no es un importe válido en euros.\n\n`);
      process.exit(1);
    }
    // A céntimos con redondeo, nunca con truncado: 44,999 tiene que ser 4500.
    centimos = Math.round(euros * 100);
  }

  const objetivo = tipos[0];
  await objetivo.update({ price: centimos });
  process.stdout.write(
    quitar
      ? `\n✓ "${objetivo.name}" vuelve a ser gratuita\n\n`
      : `\n✓ "${objetivo.name}" cuesta ahora ${(centimos / 100).toFixed(2)} €\n\n`
  );
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e?.message ?? e}\n\n`);
  process.exit(1);
});
