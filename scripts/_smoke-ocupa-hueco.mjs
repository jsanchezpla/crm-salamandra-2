/**
 * _smoke-ocupa-hueco.mjs — comprueba QUÉ CITAS BLOQUEAN SU HORA.
 *
 * `ocupaHuecoWhere` / `noEsCarritoAbandonado` (lib/citas/booking.js) los usan
 * SEIS sitios a la vez: las horas libres del día, los días libres del mes, la
 * creación de reservas, el listado del panel, el calendario y "Mis citas" del
 * paciente. Si ese filtro se equivoca, o se vende dos veces la misma hora o
 * desaparecen citas buenas de la pantalla de la profesional. No tenía ni una
 * prueba.
 *
 * El sprint "cobrar al confirmar" INVIERTE su significado para un estado nuevo:
 * una cita con la tarjeta ya retenida ('authorized') está esperando a la
 * PROFESIONAL, no al paciente, así que puede tardar días y NO es un carrito
 * abandonado. Esta prueba fija ese comportamiento para que nadie lo rompa sin
 * enterarse.
 *
 * Crea citas de mentira en una fecha lejana, comprueba cuáles pasan el filtro y
 * las borra. Uso:
 *   node --env-file=.env.local scripts/_smoke-ocupa-hueco.mjs [slug]
 */

import { Op } from "sequelize";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { ocupaHuecoWhere } from "../lib/citas/booking.js";

const SLUG = process.argv[2] || "nutri_laura";
const MARCA = "smoke-hueco@example.com";
// Año 2099: imposible que choque con datos reales ni con la agenda de nadie.
const CUANDO = new Date("2099-03-15T10:00:00.000Z");

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };

const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
const manana = new Date(Date.now() + 24 * 60 * 60 * 1000);

/**
 * Cada caso: cómo está la cita y si DEBE bloquear su hora.
 * El "porqué" es lo que se rompería si el filtro cambiara.
 */
const CASOS = [
  { nombre: "confirmada y pagada", status: "confirmed", paymentStatus: "paid", hold: null, ocupa: true,
    porque: "es una cita de verdad en la agenda" },
  { nombre: "gratuita esperando confirmación", status: "pending", paymentStatus: "none", hold: null, ocupa: true,
    porque: "no hay pago de por medio, la hora es suya" },
  { nombre: "metiendo la tarjeta ahora", status: "pending", paymentStatus: "authorizing", hold: manana, ocupa: true,
    porque: "está dentro de su ventana para pagar" },
  { nombre: "abandonó el formulario de tarjeta", status: "pending", paymentStatus: "authorizing", hold: ayer, ocupa: false,
    porque: "se fue sin pagar: la hora debe volver a estar libre" },
  { nombre: "TARJETA RETENIDA esperando a la profesional", status: "pending", paymentStatus: "authorized", hold: null, ocupa: true,
    porque: "EL CASO NUEVO: hay dinero comprometido, la hora es suya aunque tarde días" },
  { nombre: "retenida con un hold viejo colgando", status: "pending", paymentStatus: "authorized", hold: ayer, ocupa: true,
    porque: "aunque quede un hold caducado, con dinero retenido NUNCA se libera la hora" },
  { nombre: "cobrando ahora mismo", status: "pending", paymentStatus: "capturing", hold: null, ocupa: true,
    porque: "la captura está en vuelo, nadie más puede quedarse esa hora" },
  { nombre: "el cobro falló", status: "pending", paymentStatus: "failed", hold: null, ocupa: true,
    porque: "la profesional lo está gestionando; la hora sigue reservada mientras decide" },
  { nombre: "carrito abandonado del flujo viejo", status: "pending", paymentStatus: "pending", hold: ayer, ocupa: false,
    porque: "comportamiento histórico: no debe cambiar" },
  { nombre: "cancelada", status: "cancelled", paymentStatus: "void", hold: null, ocupa: false,
    porque: "cancelada es cancelada" },
  { nombre: "no se presentó", status: "no_show", paymentStatus: "paid", hold: null, ocupa: false,
    porque: "la hora ya pasó y no vino" },
];

async function main() {
  process.stdout.write(`\n═══ Smoke: ¿qué citas bloquean su hora? (${SLUG}) ═══\n\n`);

  const { models } = getTenantDb(SLUG);
  const { Booking, EventType } = models;

  const eventType = await EventType.findOne();
  if (!eventType) {
    process.stderr.write(`✗ ${SLUG} no tiene ningún tipo de cita; no se puede probar.\n\n`);
    process.exit(1);
  }

  // Limpieza previa por si una ejecución anterior murió a medias.
  await Booking.destroy({ where: { clientEmail: MARCA } });

  const creados = new Map();
  for (const [i, c] of CASOS.entries()) {
    const row = await Booking.create({
      eventTypeId: eventType.id,
      clientName: `Smoke ${i}`,
      clientEmail: MARCA,
      clientPhone: "+34600000000",
      // Cada caso a una hora distinta para que no solapen entre sí.
      scheduledAt: new Date(CUANDO.getTime() + i * 60 * 60 * 1000),
      duration: 30,
      modality: "online",
      status: c.status,
      paymentStatus: c.paymentStatus,
      holdExpiresAt: c.hold,
    });
    creados.set(row.id, c);
  }

  // La pregunta real: de todas ellas, ¿cuáles considera el filtro que ocupan hueco?
  const ocupan = await Booking.findAll({
    where: { ...ocupaHuecoWhere(), clientEmail: MARCA, id: { [Op.in]: [...creados.keys()] } },
    attributes: ["id"],
  });
  const idsOcupan = new Set(ocupan.map((r) => r.id));

  for (const [id, c] of creados) {
    const real = idsOcupan.has(id);
    const etiqueta = `${c.nombre} → ${c.ocupa ? "bloquea la hora" : "la hora queda libre"}`;
    if (real === c.ocupa) ok(etiqueta);
    else mal(`${etiqueta} — PERO el filtro dice lo contrario (${c.porque})`);
  }

  // ── CONTROL: ¿esta prueba distingue algo? ────────────────────────────────
  // Una prueba que pasaría igual con el código viejo no prueba nada. Aquí se
  // reproduce el filtro ANTERIOR al sprint (el que solo miraba 'pending') y se
  // exige que dé un resultado DISTINTO. Si algún día coincidieran, sería señal
  // de que el filtro nuevo ha perdido su gracia o de que el caso que lo
  // distingue ha desaparecido de la lista.
  const filtroViejo = {
    status: { [Op.notIn]: ["cancelled", "no_show"] },
    [Op.or]: [
      { status: { [Op.ne]: "pending" } },
      { paymentStatus: { [Op.ne]: "pending" } },
      { holdExpiresAt: { [Op.gt]: new Date() } },
    ],
  };
  const conViejo = await Booking.findAll({
    where: { ...filtroViejo, clientEmail: MARCA, id: { [Op.in]: [...creados.keys()] } },
    attributes: ["id"],
  });
  const idsViejo = new Set(conViejo.map((r) => r.id));
  const discrepan = [...creados].filter(([id]) => idsViejo.has(id) !== idsOcupan.has(id));

  process.stdout.write("\n  ── control ──\n");
  if (discrepan.length === 0) {
    mal("el filtro nuevo se comporta IGUAL que el viejo: esta prueba no está probando el cambio");
  } else {
    ok(`el filtro nuevo cambia el veredicto en ${discrepan.length} caso(s), luego la prueba discrimina:`);
    for (const [, c] of discrepan) {
      process.stdout.write(`      · "${c.nombre}" — el viejo la daba por ocupada y liberaba mal la hora\n`);
    }
  }

  const borradas = await Booking.destroy({ where: { clientEmail: MARCA } });
  process.stdout.write(`\n  · ${borradas} citas de prueba borradas\n`);

  process.stdout.write(
    fallos === 0
      ? "\n✓ TODO CORRECTO — el filtro distingue esperar al paciente de esperar a la profesional\n\n"
      : `\n✗ ${fallos} casos mal\n\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e?.message ?? e}\n${e?.stack ?? ""}\n\n`);
  process.exit(1);
});
