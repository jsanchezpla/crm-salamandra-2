/**
 * backfill-cuotas-reserva.js — la reserva que ya se descontó en septiembre pasa
 * a vivir en su cuota (09/09/2026).
 *
 * ── QUÉ ARREGLA ────────────────────────────────────────────────────────────
 * El 01/09/2026 `descontar-reservas-septiembre.js` restó los 30 € de la reserva
 * de plaza a los cobros de septiembre YA generados y lo dejó escrito en su nota
 * («Reserva de plaza ya abonada: −30 €»). Pero la rebaja se quedó en el cobro,
 * no en la cuota, y eso tiene dos consecuencias feas:
 *
 *   · **La rebaja se pierde al tocar la cuota.** Desde el 05/09 el cobro
 *     pendiente del mes en curso se rehace solo cuando su cuota cambia
 *     (`sincronizarCobroDelMes`). Al rehacerlo se calculaba a tarifa entera, así
 *     que cambiar el día de cobro de una familia le subía el recibo 30 €.
 *   · **La cuota no sabe explicar su propio importe**, y el mes que viene nadie
 *     recuerda por qué septiembre fue más barato.
 *
 * ── QUÉ HACE ───────────────────────────────────────────────────────────────
 * Lee los cobros de cuota de un mes cuya nota lleva la frase de la reserva, saca
 * el importe descontado y lo escribe en su cuota: `reserva_abonada` = ese
 * importe y `reserva_aplicada_en` = ese mes. Con el mes puesto la reserva NO
 * se vuelve a descontar en octubre — que es justo lo que hay que garantizar.
 *
 * No toca ni un euro: los cobros se quedan exactamente como están. Idempotente
 * (una cuota que ya lo tenga se salta). En seco por defecto.
 *
 * Uso VPS: docker exec -w /app crm-salamandra-app-1 node scripts/backfill-cuotas-reserva.js [--slug aumenta] [--mes 2026-09] [--confirm] [--detalle]
 */

import { Op } from "sequelize";
import { getTenantDb } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const confirmar = args.includes("--confirm");
const detalle = args.includes("--detalle");
const valorDe = (f, pd) => (args.includes(f) ? args[args.indexOf(f) + 1] : pd);
const SLUG = valorDe("--slug", "aumenta");
const MES = valorDe("--mes", "2026-09");

const log = (m) => process.stdout.write(`  ${m}\n`);

/**
 * El importe que la nota dice que se descontó por la reserva.
 *
 * Las dos formas que escribieron los scripts del 01/09: «Reserva de plaza ya
 * abonada: −30 €» y «2 reservas de plaza ya abonadas: −60 €». El signo es el
 * menos tipográfico (U+2212), no el guion.
 */
function reservaDeLaNota(notes) {
  const m = String(notes ?? "").match(/reservas?\s+de\s+plaza\s+ya\s+abonadas?:\s*[−-]\s*([\d.,]+)\s*€/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

async function main() {
  process.stdout.write(`\n▶ La reserva de ${MES} baja a su cuota — ${SLUG}${confirmar ? "" : "  (EN SECO)"}\n\n`);
  const { models } = getTenantDb(SLUG);
  const { Payment, Cuota } = models;
  if (!Payment || !Cuota) throw new Error(`${SLUG} no tiene facturación`);

  const cobros = await Payment.findAll({
    where: {
      periodMonth: `${MES}-01`,
      cuotaId: { [Op.ne]: null },
      notes: { [Op.iLike]: "%reserva%de plaza%" },
    },
    attributes: ["id", "cuotaId", "amount", "notes"],
    raw: true,
  });
  log(`Cobros de ${MES} con la frase de la reserva: ${cobros.length}`);

  const porCuota = new Map();
  let sinLeer = 0;
  for (const c of cobros) {
    const importe = reservaDeLaNota(c.notes);
    if (!importe) { sinLeer++; continue; }
    // Con dos cobros de la misma cuota (no debería, hay índice único) manda el mayor.
    const antes = porCuota.get(String(c.cuotaId)) ?? 0;
    porCuota.set(String(c.cuotaId), Math.max(antes, importe));
  }
  if (sinLeer) log(`· ${sinLeer} con la frase pero sin importe legible: se dejan`);

  const cuotas = await Cuota.findAll({
    where: { id: { [Op.in]: [...porCuota.keys()] } },
    attributes: ["id", "reservaAbonada", "reservaAplicadaEn"],
    raw: true,
  });
  const yaPuestas = cuotas.filter((c) => c.reservaAbonada != null).length;
  const aEscribir = cuotas.filter((c) => c.reservaAbonada == null);

  log(`\nCuotas: ${cuotas.length} · ${yaPuestas} ya la tenían · ${aEscribir.length} por escribir`);
  const suma = aEscribir.reduce((s, c) => s + (porCuota.get(String(c.id)) ?? 0), 0);
  log(`Reservas a apuntar: ${suma.toFixed(2)} €`);
  if (detalle) {
    const cuenta = {};
    for (const c of aEscribir) {
      const v = porCuota.get(String(c.id));
      cuenta[v] = (cuenta[v] ?? 0) + 1;
    }
    for (const [v, n] of Object.entries(cuenta)) log(`  · ${n} cuotas de ${v} €`);
  }

  if (!confirmar) {
    process.stdout.write("\n(en seco: repite con --confirm para escribir)\n\n");
    return;
  }

  let escritas = 0;
  for (const c of aEscribir) {
    // Model.update por WHERE y no instancia.update: aquí solo se escriben dos
    // columnas y no hace falta traer la fila entera.
    await Cuota.update(
      { reservaAbonada: porCuota.get(String(c.id)), reservaAplicadaEn: MES },
      { where: { id: c.id } }
    );
    escritas++;
  }
  log(`\n✓ ${escritas} cuotas con su reserva apuntada y marcada como usada en ${MES}`);
  process.stdout.write("\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    process.stderr.write(`\n✗ ${e.message}\n`);
    process.exit(1);
  });
