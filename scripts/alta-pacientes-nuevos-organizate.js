/**
 * alta-pacientes-nuevos-organizate.js — las altas de Organízate posteriores
 * al volcado del 02/08 (dos el 29/08/2026, una más el 02/09/2026).
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * Al sincronizar la agenda con Organízate, 2 citas de 13.187 se quedaron fuera
 * porque su paciente no existe en el CRM: son altas que el centro hizo DESPUÉS
 * del volcado (`pacientes-limpio.json` es del 02/08 y no los tiene). Las dos
 * son primeras visitas de la semana en que arranca el curso, así que sin ficha
 * la agenda de esas dos terapeutas enseñaría el hueco vacío.
 *
 * Los datos salen de la ficha de cada uno en Organízate
 * (`opcion=pacientes&vista=pacientes_edit`), leída el día que se apunta cada
 * uno. Se copian aquí en vez de en un JSON aparte porque son pocos y así se
 * ve de dónde vienen; cada sincronización de agenda que encuentre un paciente
 * nuevo allí añade su entrada aquí.
 *
 * Convención de la casa, mirada en producción antes de escribir esto:
 *   · el paciente ADULTO es su propio cliente, con su NIF;
 *   · el menor cuelga de un cliente a nombre del tutor de contacto, y los dos
 *     tutores van en `guardians` (un cliente, dos personas).
 *
 * Es idempotente: si el paciente ya está (por nombre + fecha de nacimiento), no
 * hace nada. Después hay que volver a pasar `sincronizar-agenda-organizate.js`
 * para que entren sus citas.
 *
 * Uso:
 *   node scripts/alta-pacientes-nuevos-organizate.js
 *   node scripts/alta-pacientes-nuevos-organizate.js --confirm
 */

import { getTenantDb } from "../lib/db/tenantDb.js";
import { normalizeGuardians } from "../lib/clients/guardians.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";
const HOY = new Date().toISOString().slice(0, 10);

const norm = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

/** Tal cual están en Organízate el 29/08/2026. `idPac` es su id de allí. */
const ALTAS = [
  {
    idPac: 1270,
    firstName: "GUILLERMO",
    lastName: "Muñoz Nieto",
    birthDate: "1984-12-16",
    dni: "49018148L",
    address: "Calle Rosa Montero 43",
    city: "Illescas",
    postalCode: "45200",
    phone: "662400857",
    email: null,
    notes: "DIAGNÓSTICO SOLICITADO TEA",
    enrollmentDate: "2026-09-01", // su primera cita: valoración con Isabel Alberca
    // Adulto: es su propio cliente y no lleva tutores.
    cliente: { nombre: "GUILLERMO Muñoz Nieto", nif: "49018148L" },
    tutores: [],
  },
  {
    idPac: 1269,
    firstName: "Leo",
    lastName: "Machio Díez de Baldeón",
    birthDate: "2019-11-02",
    dni: null,
    address: "C/ Flameno 1 V9",
    city: "El viso de San Juan",
    postalCode: "45215",
    phone: "622491811",
    email: "candecande80@hotmail.com",
    notes: "Organízate: «No necesitan factura».",
    enrollmentDate: "2026-09-07", // su primera cita: entrevista inicial con Laura Barrionuevo
    // Menor con los dos progenitores: un cliente a nombre de quien tiene el
    // contacto (la madre) y las dos personas en `guardians`.
    cliente: { nombre: "Candela Díez de Baldeón Gómez", nif: "05689502S" },
    tutores: [
      { name: "Candela Díez de Baldeón Gómez", relationship: "madre", dni: "05689502S", phone: "622491811", email: "candecande80@hotmail.com" },
      { name: "David Machio Renes", relationship: "padre", dni: "49000800J", phone: null, email: null },
    ],
  },
  {
    // 02/09/2026: la ficha en Organízate solo tiene nombre, fecha de nacimiento
    // y móvil (pestaña Tutores vacía, sin DNI ni dirección). Menor sin tutor
    // conocido: el cliente va a su nombre con ese móvil, y el centro completa
    // quién es la familia cuando venga a la entrevista.
    idPac: 1271,
    firstName: "Lucas",
    lastName: "Herranz Fernández",
    birthDate: "2012-05-20",
    dni: null,
    address: null,
    city: null,
    postalCode: null,
    phone: "655760825",
    email: null,
    notes: "Organízate: ficha sin tutores, DNI ni dirección (solo móvil).",
    enrollmentDate: "2026-09-07", // su primera cita: entrevista inicial con Isabel Alberca
    cliente: { nombre: "Lucas Herranz Fernández", nif: null },
    tutores: [],
  },
];

async function main() {
  console.log(`\n${"═".repeat(64)}`);
  console.log(` ALTAS NUEVAS DE ORGANÍZATE → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  console.log(`${"═".repeat(64)}\n`);

  const { models: m, sequelize } = getTenantDb(SLUG);

  const pacientes = await m.Patient.findAll({ attributes: ["id", "firstName", "lastName", "birthDate"] });
  const yaEstan = new Set(pacientes.map((p) => `${norm(`${p.firstName} ${p.lastName}`)}|${String(p.birthDate).slice(0, 10)}`));

  const pendientes = ALTAS.filter((a) => !yaEstan.has(`${norm(`${a.firstName} ${a.lastName}`)}|${a.birthDate}`));

  for (const a of ALTAS) {
    const nuevo = pendientes.includes(a);
    console.log(`  ${nuevo ? "+" : "·"} ${a.firstName} ${a.lastName} (id_pac ${a.idPac}, ${a.birthDate})  ${nuevo ? "se crea" : "YA ESTÁ, no se toca"}`);
    if (nuevo) console.log(`      cliente «${a.cliente.nombre}»${a.tutores.length ? ` · ${a.tutores.length} tutores` : " · sin tutores (adulto)"}`);
  }
  console.log();

  if (!pendientes.length) {
    console.log(" No hay nada que crear.\n");
    process.exit(0);
  }
  if (!CONFIRM) {
    console.log(`${"═".repeat(64)}`);
    console.log(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.");
    console.log(`${"═".repeat(64)}\n`);
    process.exit(0);
  }

  console.log("⚠️  Escribiendo…\n");
  await sequelize.transaction(async (t) => {
    for (const a of pendientes) {
      const contacto = a.tutores.find((x) => x.email || x.phone) ?? null;
      const cliente = await m.Client.create({
        type: "individual",
        name: a.cliente.nombre,
        taxId: a.cliente.nif || null,
        fiscalAddress: a.address || null,
        fiscalCity: a.city || null,
        email: contacto?.email ?? a.email ?? null,
        phone: contacto?.phone ?? a.phone ?? null,
        status: "active",
        guardians: normalizeGuardians(a.tutores),
        customFields: { origen: "organizate", importadoEl: HOY, idPacOrganizate: a.idPac },
      }, { transaction: t });

      await m.Patient.create({
        clientId: cliente.id,
        firstName: a.firstName,
        lastName: a.lastName,
        birthDate: a.birthDate,
        dni: a.dni,
        address: a.address || null,
        specialties: [],
        enrollmentDate: a.enrollmentDate,
        status: "active",
        notes: `${a.notes} · Alta traída de Organízate el ${HOY} (id_pac ${a.idPac}).`,
      }, { transaction: t });

      console.log(`  ✓ ${a.firstName} ${a.lastName}`);
    }
  });

  console.log("\n  Hecho. Ahora toca volver a pasar sincronizar-agenda-organizate.js");
  console.log("  para que entren sus citas.\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.stack ?? err}\n`);
  process.exit(1);
});
