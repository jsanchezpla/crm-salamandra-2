/**
 * _smoke-valoracion-inicial.mjs — la primera visita se ofrece UNA vez.
 *
 * La clienta detectó que ocultarla en el listado de citas no bastaba: seguía
 * apareciendo en los botones de «Rellenar documentos», y por ahí se llegaba
 * igual. De ahí el helper único (`lib/citas/valoracionInicial.js`) y el corte
 * en servidor: esconder un botón no es impedir nada.
 *
 * Lo que se fija aquí:
 *   · quien NO la ha tenido, puede reservarla;
 *   · quien ya la tuvo, NO — y la API lo rechaza aunque fuerce la petición;
 *   · una valoración CANCELADA la devuelve (quien anuló por un imprevisto no se
 *     queda sin poder pedirla nunca);
 *   · un 'no_show' SÍ la gasta (el hueco se dio y se perdió);
 *   · el correo se cruza sin distinguir mayúsculas;
 *   · un centro sin tipo marcado como valoración no limita nada;
 *   · y el control que da sentido al resto: las citas NORMALES no se ven
 *     afectadas por ninguna de estas reglas.
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-valoracion-inicial.mjs [slug]
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { puedeReservarValoracionInicial } from "../lib/citas/valoracionInicial.js";
import { signPortalSession } from "../lib/citas/portalSession.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const MARCA = "smoke-valoracion";
const IP_PRUEBA = `203.0.113.${20 + Math.floor(Math.random() * 200)}`;

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

const correo = (q) => `${MARCA}-${q}@example.com`;

async function main() {
  process.stdout.write(`\n═══ Smoke: la valoración inicial se ofrece UNA vez (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`no existe el tenant ${SLUG}`);

  const { models } = getTenantDb(SLUG);
  const { Booking, EventType } = models;

  // El tipo marcado como valoración; si el tenant no tiene, se marca uno para
  // la prueba y se deja como estaba al terminar.
  let valoracion = await EventType.findOne({ where: { isInitialAssessment: true } });
  let marcadoPorLaPrueba = false;
  if (!valoracion) {
    valoracion = await EventType.findOne({ where: { active: true }, order: [["order", "ASC"]] });
    await valoracion.update({ isInitialAssessment: true });
    marcadoPorLaPrueba = true;
  }
  const otroTipo = await EventType.findOne({
    where: { active: true, isInitialAssessment: false },
    order: [["order", "ASC"]],
  });

  /** Deja una cita de valoración en el estado que se quiera probar. */
  const citaDeValoracion = (email, status) =>
    Booking.create({
      eventTypeId: valoracion.id,
      scheduledAt: new Date(Date.now() - 3 * 86400000),
      duration: valoracion.duration,
      modality: "online",
      status,
      clientName: `Smoke ${status}`,
      clientEmail: email,
      clientPhone: "+34600321321",
      paymentStatus: "none",
    });

  try {
    paso("El helper, que es la única fuente de verdad");
    esperar(
      (await puedeReservarValoracionInicial(models, correo("nueva"))).puede === true,
      "quien no la ha tenido nunca, puede"
    );

    await citaDeValoracion(correo("tuvo"), "completed");
    esperar(
      (await puedeReservarValoracionInicial(models, correo("tuvo"))).puede === false,
      "quien ya la hizo, no"
    );

    await citaDeValoracion(correo("cancelo"), "cancelled");
    esperar(
      (await puedeReservarValoracionInicial(models, correo("cancelo"))).puede === true,
      "una CANCELADA se la devuelve: anular por un imprevisto no puede dejarte fuera"
    );

    await citaDeValoracion(correo("falto"), "no_show");
    esperar(
      (await puedeReservarValoracionInicial(models, correo("falto"))).puede === false,
      "un 'no_show' SÍ la gasta: el hueco se dio y se perdió"
    );

    await citaDeValoracion(`${MARCA}-MAYUS@Example.COM`, "confirmed");
    esperar(
      (await puedeReservarValoracionInicial(models, correo("mayus"))).puede === false,
      "el correo se cruza sin distinguir mayúsculas"
    );

    paso("El servidor CORTA, no solo esconde el botón");
    const hora = new Date(Date.now() + 9 * 86400000).toISOString();
    // Con sesión de portal: si la puerta de IDENTIDAD está encendida corta
    // antes que esta, y la prueba mediría esa y no la que quiere medir.
    const forzar = async (email, tipoId) =>
      fetch(`${BASE}/api/public/c/${SLUG}/book`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-real-ip": IP_PRUEBA,
          Authorization: `Bearer ${await signPortalSession({ email, tenant: SLUG })}`,
        },
        body: JSON.stringify({
          eventTypeId: tipoId, scheduledAt: hora,
          clientName: "Smoke Forzada", clientEmail: email, clientPhone: "+34600321321",
        }),
      });

    const r = await forzar(correo("tuvo"), valoracion.id);
    const j = await r.json();
    esperar(r.status === 409, `se rechaza aunque fuerce la petición (HTTP ${r.status})`);
    esperar(
      j?.codigo === "VALORACION_YA_REALIZADA",
      `con un código que la pantalla entiende ('${j?.codigo}')`
    );

    paso("Lo que NO debe verse afectado");
    if (otroTipo) {
      const rn = await forzar(correo("tuvo"), otroTipo.id);
      esperar(
        rn.status !== 409 || (await rn.json())?.codigo !== "VALORACION_YA_REALIZADA",
        "una cita NORMAL de esa misma persona no la bloquea esta regla"
      );
    } else {
      ok("(este tenant solo tiene el tipo de valoración: no hay control que hacer)");
    }

    esperar(
      (await puedeReservarValoracionInicial({}, correo("nueva"))).puede === true,
      "sin poder consultar se DEJA pasar: cerrar por un fallo dejaría fuera a quien nunca ha venido"
    );
  } finally {
    await Booking.destroy({ where: { clientEmail: { [Op.iLike]: `${MARCA}-%` } }, force: true });
    if (marcadoPorLaPrueba) await valoracion.update({ isInitialAssessment: false });
  }

  process.stdout.write(fallos ? `\n═══ ${fallos} fallo(s) ═══\n` : `\n═══ Todo en orden ═══\n`);
  process.exit(fallos ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
