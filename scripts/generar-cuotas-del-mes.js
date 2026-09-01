// @vivo — El botón «Generar el mes» desde la terminal, para lanzarlo en el VPS cuando no se quiere pasar por la pantalla. Se repite CADA MES y en cualquier tenant con cuotas (--slug, --mes).
/**
 * generar-cuotas-del-mes.js — el botón «Generar el mes» desde la terminal
 * (01/09/2026).
 *
 * Lo mismo que hace `POST /api/billing/cuotas/generar`, para cuando hay que
 * lanzarlo desde el VPS (el primer mes de Aumenta: 260 cuotas recién sembradas
 * por `sembrar-cuotas-desde-aprendidas.js`).
 *
 * **La decisión de qué se genera NO se reimplementa aquí**: se pide a
 * `lib/billing/cuotas.js` `planDeCuotasDelMes`, la misma pieza que usa el
 * endpoint. Este fichero solo pone las consultas y la transacción alrededor,
 * igual que él. Si algún día cambia la regla del prorrateo o de la vigencia,
 * cambia en un sitio y los dos caminos la heredan.
 *
 * Los cobros nacen PENDIENTES: generar no es cobrar. Y relanzar no duplica
 * (`payments.cuota_id` + comprobación bajo lock dentro de la transacción).
 *
 * EN SECO por defecto. `--confirm` para escribir.
 *
 * Uso VPS:
 *   docker exec crm-salamandra-app-1 node scripts/generar-cuotas-del-mes.js --mes 2026-09 [--slug aumenta] [--confirm]
 */

import { getTenantDb } from "../lib/db/tenantDb.js";
import { planDeCuotasDelMes, mesValido, mesLegible, ultimoDiaDe } from "../lib/billing/cuotas.js";
import { Op } from "sequelize";

const METODO_POR_DEFECTO = "transfer"; // el mismo que el endpoint

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const valorDe = (nombre, porDefecto) => {
    const i = args.indexOf(nombre);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : porDefecto;
  };
  const mes = valorDe("--mes", null);
  const slug = valorDe("--slug", "aumenta");

  if (!mesValido(mes)) {
    process.stderr.write("✗ Falta --mes AAAA-MM\n");
    process.exit(1);
  }

  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(` Generar las cuotas de ${mesLegible(mes)} — ${slug}\n`);
  process.stdout.write(`${confirm ? "" : " (EN SECO)\n"}`);
  process.stdout.write("════════════════════════════════════════════════════\n\n");

  const { sequelize, models } = getTenantDb(slug);
  const { Cuota, Client, BillingConcept, Payment } = models;
  const primero = `${mes}-01`;

  const cuotas = await Cuota.findAll({
    where: {
      startDate: { [Op.lte]: ultimoDiaDe(mes) },
      [Op.or]: [{ endDate: null }, { endDate: { [Op.gte]: primero } }],
    },
    include: [{ model: Client, as: "client", attributes: ["id", "name", "fiscalName"] }],
  });
  const conceptos = await BillingConcept.findAll({ attributes: ["id", "name", "unitPrice"] });
  const yaGenerados = cuotas.length
    ? await Payment.findAll({
        where: { cuotaId: { [Op.in]: cuotas.map((c) => c.id) }, periodMonth: primero },
        attributes: ["cuotaId"],
      })
    : [];

  const { aGenerar, repetidas, sinImporte } = planDeCuotasDelMes({
    mes,
    cuotas: cuotas.map((c) => ({
      ...c.toJSON(),
      nombre: c.client?.fiscalName || c.client?.name || "(ficha no encontrada)",
    })),
    conceptos: conceptos.map((c) => ({ id: c.id, name: c.name, unitPrice: c.unitPrice })),
    yaGenerados: yaGenerados.map((p) => String(p.cuotaId)),
  });

  const total = aGenerar.reduce((s, f) => s + f.importe, 0);
  process.stdout.write(`Cuotas vigentes en el mes:      ${cuotas.length}\n`);
  process.stdout.write(`Cobros a generar:               ${aGenerar.length}  (${total.toFixed(2)} €)\n`);
  process.stdout.write(`Ya tenían cobro de este mes:    ${repetidas.length}\n`);
  process.stdout.write(`Sin importe (no se generan):    ${sinImporte.length}\n`);
  const prorrateadas = aGenerar.filter((f) => f.rotulo).length;
  if (prorrateadas) process.stdout.write(`De ellas, prorrateadas:         ${prorrateadas}\n`);
  const sinMetodo = aGenerar.filter((f) => !f.method).length;
  if (sinMetodo) {
    process.stdout.write(`Sin método propio:              ${sinMetodo}  → se registran como '${METODO_POR_DEFECTO}'\n`);
  }

  if (!confirm) {
    process.stdout.write("\nEN SECO: no se ha escrito nada. Repite con --confirm.\n");
    await sequelize.close();
    return;
  }

  let creados = 0;
  let fallados = 0;
  for (const fila of aGenerar) {
    try {
      // Mismo candado que el endpoint: se comprueba DENTRO de la transacción.
      await sequelize.transaction(async (t) => {
        const existe = await Payment.findOne({
          where: { cuotaId: fila.cuotaId, periodMonth: fila.periodMonth },
          attributes: ["id"],
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (existe) return;
        await Payment.create(
          {
            clientId: fila.clientId,
            patientId: fila.patientId,
            conceptId: fila.conceptId,
            cuotaId: fila.cuotaId,
            periodMonth: fila.periodMonth,
            amount: fila.importe,
            paidAt: fila.paidAt,
            method: fila.method || METODO_POR_DEFECTO,
            status: "pending", // generar NO es cobrar
            notes: fila.notes,
          },
          { transaction: t }
        );
        creados++;
      });
    } catch (e) {
      fallados++;
      process.stdout.write(`  ✗ ${fila.nombre}: ${e.message.split("\n")[0]}\n`);
    }
  }

  process.stdout.write(`\n✓ ${creados} cobros creados, PENDIENTES de cobrar.\n`);
  if (fallados) process.stdout.write(`✗ ${fallados} fallaron (arriba).\n`);
  process.stdout.write("  Están en Facturación → Cobros. Según entre el dinero se pasan a cobrados.\n");

  await sequelize.close();
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e.message}\n`);
  process.exit(1);
});
