/**
 * _smoke-citas-sin-profesional.mjs — la pantalla solo debe pedir lo que hay que hacer.
 *
 * «Citas sin profesional» existe para repartir las citas a las que les falta
 * quién las atiende. No filtraba por estado, asi que salian tambien las
 * CANCELADAS y las faltas. En nutri_laura eran lo UNICO que salia —cinco citas
 * canceladas—, o sea que la pantalla pedia asignar profesional a citas que no
 * va a atender nadie.
 *
 * Lo que se fija aqui:
 *   · las canceladas y los 'no_show' NO salen;
 *   · los carritos abandonados (empezo a reservar y no puso la tarjeta)
 *     tampoco: eso es un intento, no una cita;
 *   · lo que si hay que repartir sigue saliendo —el control que da sentido a
 *     lo anterior, porque un filtro de mas dejaria la pantalla vacia y nadie
 *     lo notaria—;
 *   · el CONTADOR y las FILAS salen del mismo sitio: si el numero de arriba no
 *     cuadra con lo que se ve, nadie se fia de la pantalla;
 *   · una cita ya asignada no aparece.
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-citas-sin-profesional.mjs [slug]
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { signAccessToken } from "../lib/auth/jwt.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const MARCA = "smoke-sinprof";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

async function main() {
  process.stdout.write(`\n═══ Smoke: citas sin profesional (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`no existe el tenant ${SLUG}`);

  const { models } = getTenantDb(SLUG);
  const { Booking, EventType, TeamMember } = models;

  const admin = await User.findOne({ where: { tenantId: tenant.id, role: "admin" } });
  const token = await signAccessToken({
    userId: admin.id, email: admin.email, role: admin.role, tenantSlug: SLUG,
  });
  const H = { "Content-Type": "application/json", Cookie: `access_token=${token}` };

  const eventType = await EventType.findOne({ where: { active: true }, order: [["order", "ASC"]] });
  // Tener el modelo no garantiza tener la tabla: en local, nutri_laura no tiene
  // `team_members`. Sin plantilla no se puede probar el caso "ya asignada",
  // pero el resto de la prueba —que es lo que importa— sigue valiendo.
  let alguien = null;
  try {
    alguien = await TeamMember.findOne();
  } catch {
    process.stdout.write("  · sin tabla de equipo en este entorno: se salta el caso «ya asignada»\n");
  }

  /** Una cita futura, sin profesional salvo que se diga. */
  const crear = (dias, extra) =>
    Booking.create({
      eventTypeId: eventType.id,
      scheduledAt: new Date(Date.now() + dias * 86400000),
      duration: eventType.duration,
      modality: "online",
      clientName: `${MARCA} ${extra.status ?? "x"}`,
      clientEmail: `${MARCA}-${extra.marca}@example.com`,
      clientPhone: "+34600999888",
      teamMemberId: null,
      paymentStatus: "none",
      ...extra,
    });

  try {
    paso("Preparando citas en todos los estados");
    await crear(31, { marca: "confirmada", status: "confirmed" });
    await crear(32, { marca: "pendiente", status: "pending" });
    await crear(33, { marca: "cancelada", status: "cancelled" });
    await crear(34, { marca: "falta", status: "no_show" });
    // Carrito abandonado: reserva a medias cuyo reloj ya vencio.
    await crear(35, {
      marca: "carrito", status: "pending", paymentStatus: "authorizing",
      holdExpiresAt: new Date(Date.now() - 60_000),
    });
    if (alguien) await crear(36, { marca: "asignada", status: "confirmed", teamMemberId: alguien.id });
    ok(
      `${alguien ? 6 : 5} citas creadas: confirmada, pendiente, cancelada, falta, carrito` +
      (alguien ? " y una ya asignada" : "")
    );

    paso("Lo que devuelve la pantalla");
    const r = await fetch(`${BASE}/api/citas/sin-profesional?limit=500`, { headers: H });
    const j = await r.json();
    esperar(r.status === 200, `responde (HTTP ${r.status})`);

    const mias = (j.data?.citas ?? []).filter((c) => String(c.paciente ?? "").startsWith(MARCA));
    const nombres = mias.map((c) => c.paciente);

    esperar(
      nombres.some((n) => n.includes("confirmed")),
      "la confirmada SI sale: es la que hay que repartir"
    );
    esperar(
      nombres.some((n) => n.includes("pending")) ,
      "la pendiente tambien: sigue siendo una cita de alguien"
    );
    esperar(
      !nombres.some((n) => n.includes("cancelled")),
      "la CANCELADA no sale"
    );
    esperar(
      !nombres.some((n) => n.includes("no_show")),
      "la falta ('no_show') tampoco"
    );
    esperar(
      mias.length === 2,
      `ni el carrito abandonado ni la ya asignada (salen ${mias.length}, deberian ser 2: ${nombres.join(", ")})`
    );

    paso("El numero de arriba cuadra con lo que se ve");
    // El total es de TODAS las del tenant, no solo las de la prueba, asi que se
    // compara contra el propio listado sin limite: lo que no puede pasar es que
    // el contador prometa mas filas de las que hay.
    const todasLasFilas = (j.data?.citas ?? []).length;
    esperar(
      j.data?.total === todasLasFilas,
      `total=${j.data?.total} y filas=${todasLasFilas}`
    );
    const sumaDepto = Object.values(j.data?.porDepartamento ?? {}).reduce((a, b) => a + b, 0);
    esperar(
      sumaDepto === j.data?.total,
      `y los grupos por departamento suman lo mismo (${sumaDepto})`
    );
  } finally {
    await Booking.destroy({ where: { clientEmail: { [Op.iLike]: `${MARCA}-%` } }, force: true });
  }

  process.stdout.write(fallos ? `\n═══ ${fallos} fallo(s) ═══\n` : `\n═══ Todo en orden ═══\n`);
  process.exit(fallos ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
