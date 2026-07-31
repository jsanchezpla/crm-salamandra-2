/**
 * dev-limpiar-pruebas.js — borra las citas y cobros de prueba que dejan los
 * smoke tests y las pruebas a mano en el navegador.
 *
 * Los smoke limpian lo suyo al terminar, pero una prueba interrumpida a mitad
 * (o un paseo por el widget a mano) deja filas sueltas que luego confunden:
 * aparecen en la lista de espera como si fueran solicitudes de verdad.
 *
 * ── POR QUÉ NO BASTA CON FILTRAR POR @example.com ────────────────────────────
 * Era la primera versión y estaba MAL: los seeds de desarrollo
 * (`seed-nutri-laura.js`) siembran sus citas de ejemplo con ese mismo dominio,
 * así que "borrar todo lo de @example.com" se llevó por delante los datos de
 * ejemplo del tenant además de la basura. En local se recuperan volviendo a
 * sembrar, pero el susto sobra.
 *
 * Ahora solo borra lo que llevan LOS PROPIOS scripts de prueba en el nombre
 * (`smoke-…`, `ui-…`), y siempre dentro de @example.com, que es un dominio
 * reservado por la RFC 2606 y por tanto imposible para una persona real.
 *
 * Es de DESARROLLO. Nunca contra producción.
 *
 * Uso:
 *   node --env-file=.env.local scripts/dev-limpiar-pruebas.js nutri_laura
 *   node --env-file=.env.local scripts/dev-limpiar-pruebas.js nutri_laura --dry
 */

import { Op } from "sequelize";
import { getTenantDb } from "../lib/db/tenantDb.js";

/** Prefijos que usan los scripts de prueba de este repo. Nada más se toca. */
const PREFIJOS_DE_PRUEBA = ["smoke%@example.com", "ui-%@example.com"];

async function main() {
  const [slug, ...resto] = process.argv.slice(2);
  const soloVer = resto.includes("--dry");
  if (!slug) {
    process.stderr.write("\n✗ Falta el slug.\n  Uso: dev-limpiar-pruebas.js <slug> [--dry]\n\n");
    process.exit(1);
  }

  const { models } = getTenantDb(slug);
  const { Booking, PaymentSession } = models;

  const citas = await Booking.findAll({
    where: { [Op.or]: PREFIJOS_DE_PRUEBA.map((p) => ({ clientEmail: { [Op.iLike]: p } })) },
    attributes: ["id", "clientEmail", "scheduledAt", "status", "paymentStatus"],
  });

  if (!citas.length) {
    process.stdout.write(`\n✓ ${slug}: no hay nada de prueba que borrar\n\n`);
    process.exit(0);
  }

  process.stdout.write(`\n▶ ${citas.length} cita(s) de prueba en ${slug}\n`);
  for (const c of citas) {
    process.stdout.write(
      `  · ${c.clientEmail} — ${new Date(c.scheduledAt).toISOString().slice(0, 16)} (${c.status}/${c.paymentStatus})\n`
    );
  }

  if (soloVer) {
    process.stdout.write("\n· --dry: no se ha borrado nada\n\n");
    process.exit(0);
  }

  const ids = citas.map((c) => c.id);
  const cobros = await PaymentSession.destroy({ where: { entityType: "booking", entityId: ids } });
  const borradas = await Booking.destroy({ where: { id: ids } });

  process.stdout.write(`\n✓ ${borradas} cita(s) y ${cobros} cobro(s) borrados\n`);
  process.stdout.write(
    "  Nota: las retenciones que hubiera en Stripe caducan solas; esto solo limpia la base.\n\n"
  );
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e?.message ?? e}\n\n`);
  process.exit(1);
});
