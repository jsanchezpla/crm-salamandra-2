/**
 * marcar-origen-citas-organizate.js — escribe DE QUIÉN ERA cada cita huérfana.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * Las 1.827 citas que la migración dejó sin profesional no son un bloque: 1.005
 * eran la agenda de tres profesionales que YA NO ESTÁN (Dania, Victoria Losada,
 * Laura A. Arroyo — bajas confirmadas, por eso no se dieron de alta en el
 * equipo) y 822 venían sin nadie TAMBIÉN en Organízate. Quien tiene que
 * repartirlas necesita saber de qué agenda viene cada una: «las de Dania se las
 * queda X» es una decisión; 1.827 casillas no.
 *
 * El importador no guardó ese nombre, así que se reconstruye desde el volcado
 * con la MISMA clave que usó él: paciente + fecha y hora. El resultado se anota
 * al final de `additionalData`, que ya dice «Importada de Organízate · CUOTA…»,
 * y la pantalla de citas sin profesional lo enseña como columna.
 *
 * El fichero de entrada (origen-citas-huerfanas.json) se genera en el portátil
 * desde el volcado (extraer-origen-huerfanas.mjs, FUERA del repo: son datos de
 * pacientes) y se sube al contenedor solo para esta pasada.
 *
 * Idempotente: una cita ya anotada se salta. Solo toca citas SIN profesional:
 * si alguien ya asignó una, su additionalData se queda como esté.
 *
 * Uso (en el VPS, tras subir el JSON):
 *   docker cp origen-citas-huerfanas.json crm-salamandra-app-1:/tmp/
 *   docker exec crm-salamandra-app-1 node scripts/marcar-origen-citas-organizate.js --datos /tmp            → simulación
 *   docker exec crm-salamandra-app-1 node scripts/marcar-origen-citas-organizate.js --datos /tmp --confirm  → escribe
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { getTenantDb } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";
const DATOS = (args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null) || "C:/Claude Code/migracion-aumenta";

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

/** La coletilla que se añade. La lee `origenDe()` en el endpoint de la pantalla. */
const coletilla = (origen) =>
  origen === "NADIE" ? "Sin profesional ya en Organízate" : `Agenda de ${origen}`;

async function main() {
  console.log(`\n${"═".repeat(62)}`);
  console.log(` ORIGEN DE LAS CITAS HUÉRFANAS → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  console.log(`${"═".repeat(62)}\n`);

  const { citas } = JSON.parse(readFileSync(path.join(DATOS, "origen-citas-huerfanas.json"), "utf8"));
  console.log(`Del fichero: ${citas.length} citas huérfanas con su origen\n`);

  const { models: m } = getTenantDb(SLUG);

  const pacientes = await m.Patient.findAll({ attributes: ["id", "firstName", "lastName"] });
  const porNombre = new Map();
  for (const p of pacientes) {
    const k = norm(`${p.firstName} ${p.lastName}`);
    if (!porNombre.has(k)) porNombre.set(k, p.id);
  }

  const n = { anotadas: 0, yaAnotadas: 0, yaAsignadas: 0, sinCruce: 0 };
  const porOrigen = {};

  for (const c of citas) {
    const patientId = porNombre.get(norm(c.paciente));
    if (!patientId) { n.sinCruce++; continue; }
    // La MISMA construcción de fecha que usó el importador: mismo instante.
    const cuando = new Date(`${c.fecha}T${c.hora}:00`);
    const b = await m.Booking.findOne({ where: { patientId, scheduledAt: cuando } });
    if (!b) { n.sinCruce++; continue; }
    if (b.teamMemberId) { n.yaAsignadas++; continue; }
    if (/Agenda de |Sin profesional ya en Organízate/.test(b.additionalData ?? "")) { n.yaAnotadas++; continue; }

    porOrigen[c.origen] = (porOrigen[c.origen] ?? 0) + 1;
    n.anotadas++;
    if (CONFIRM) {
      const base = b.additionalData?.trim() ? b.additionalData.trim() : "Importada de Organízate";
      await b.update({ additionalData: `${base} · ${coletilla(c.origen)}` });
    }
  }

  console.log(`  Anotadas       ${String(n.anotadas).padStart(6)}${CONFIRM ? "" : "   (se anotarían)"}`);
  console.log(`  Ya anotadas    ${String(n.yaAnotadas).padStart(6)}`);
  console.log(`  Ya asignadas   ${String(n.yaAsignadas).padStart(6)}   alguien les puso profesional: no se tocan`);
  console.log(`  Sin cruce      ${String(n.sinCruce).padStart(6)}   no están en el CRM (tampoco las creó el importador)`);
  console.log(`  Por origen: ${Object.entries(porOrigen).map(([k, v]) => `${k} ${v}`).join(" · ")}\n`);

  if (!CONFIRM) console.log(" SIMULACIÓN: nada escrito. Con --confirm se ejecuta.\n");
  process.exit(0);
}

main().catch((err) => { process.stderr.write(`\n✗ ${err?.stack ?? err}\n`); process.exit(1); });
