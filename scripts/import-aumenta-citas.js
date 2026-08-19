// @vivo — Importación de la agenda de Organízate (commit 83cfa6f, 02/08/2026); citas.md la da por «ya ejecutada» y las 12.030 futuras están en producción. (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * import-aumenta-citas.js — la agenda de Organízate.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── Qué entra y qué no ─────────────────────────────────────────────────────
 *
 * Por defecto SOLO las citas FUTURAS, y es una decisión de Rodrigo (02/08/2026):
 *
 *   · 12.030 futuras (hasta junio de 2027) → **entran sí o sí**. No son
 *     historia: son el curso que empieza en septiembre, ya reservado semana a
 *     semana. Sin ellas la agenda del CRM arrancaría VACÍA y habría que
 *     reconstruir todos los huecos a mano.
 *   · 53.203 pasadas → esperan a que Aumenta decida. Llenarían el calendario
 *     del equipo con años de citas viejas. Con `--pasadas` entran también.
 *
 * Los datos salen de `organizate-citas.json`, que genera `extraer-citas.mjs` y
 * lleva su propio formato explicado dentro.
 *
 * ── Cómo se cruza cada cita ────────────────────────────────────────────────
 *
 * La cita trae el `id_pac` de Organízate, que aquí no vale de nada: hay que
 * llegar al paciente del CRM por nombre + apellidos, igual que hace
 * `import-aumenta.js`. Las cuatro fichas dobles se redirigen a la buena.
 *
 * Uso:
 *   node scripts/import-aumenta-citas.js              → simulación
 *   node scripts/import-aumenta-citas.js --confirm    → escribe las futuras
 *   node scripts/import-aumenta-citas.js --confirm --pasadas   → también las viejas
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { getTenantDb } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const PASADAS = args.includes("--pasadas");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";
const DATOS = (args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null) || "C:/Claude Code/migracion-aumenta";
const HOY = new Date().toISOString().slice(0, 10);

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

/** Mismo mapa que import-aumenta.js: los nombres NO coinciden literalmente. */
const TERAPEUTAS = {
  "ARACELI VIGARA MENDEZ": "Araceli Vigara Méndez",
  "BLANCA MARQUEZ BASCON": "Blanca Márquez Bascón",
  "DANIELA DE LA CRUZ ESTEBAN": "Daniela de la Cruz Esteban",
  "ELENA GUTIERREZ GARCIA": "Elena Gutiérrez García",
  "ESTEFANIA BERMEJO BLAZQUEZ": "Estefanía Bermejo Blázquez",
  "ISABEL ALBERCA BOLANOS": "Isabel Alberca Bolaños",
  "ISABEL VARA VARA PEREA": "Isabel Vara Perea",
  "LAURA BARRIONUEVO MACHOTA": "Laura Barrionuevo Machota",
  "LAURA.G GARRIDO": "Laura Garrido Rascón",
  "OLGA GARCIA ARCONES": "Olga García Arcones",
  "RAQUEL MESONES BERNAL": "Raquel Mesones Bernal",
  "ROSA SANCHEZ VELAZQUEZ": "Rosa María Sánchez Velázquez",
  "SILVIA PEREZ HERNANDEZ": "Silvia Pérez Hernández",
};

/** Fichas dobles: sus citas van a la ficha que se conservó. */
const DOBLES = { 122: 121, 250: 249, 372: 371, 167: 166 };

/** Estado en Organízate → estado de la cita en el CRM. */
const ESTADO = {
  realizada: "completed",
  cancelada: "cancelled",
  falta_no_justificada: "no_show",
  falta_justificada: "no_show",
  enfermedad: "cancelled",
  sin_confirmar: "pending",
};

/** «CUOTA LOGOPEDIA 45» → 45 minutos. No es el precio: son 30/45/60. */
function duracion(servicio) {
  const m = String(servicio ?? "").match(/\b(30|45|60|90)\b/);
  return m ? Number(m[1]) : 45;
}

async function main() {
  console.log(`\n${"═".repeat(62)}`);
  console.log(` AGENDA DE AUMENTA → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  console.log(` Alcance: ${PASADAS ? "TODAS las citas" : "solo las FUTURAS (a partir de hoy)"}`);
  console.log(`${"═".repeat(62)}\n`);

  const fichero = JSON.parse(readFileSync(path.join(DATOS, "organizate-citas.json"), "utf8"));
  const pacientesSrc = JSON.parse(readFileSync(path.join(DATOS, "pacientes-limpio.json"), "utf8")).fichas;
  const srcPorId = new Map(pacientesSrc.map((f) => [Number(f.id_pac), f]));

  const citas = fichero.citas.filter((c) => PASADAS || c.fecha > HOY);
  console.log(`Del fichero: ${fichero.total} citas · se van a tratar ${citas.length}\n`);

  const { models: m, sequelize } = getTenantDb(SLUG);

  // ── Índices para cruzar ─────────────────────────────────────────────────
  const pacientes = await m.Patient.findAll({
    attributes: ["id", "firstName", "lastName", "clientId"],
    include: [{ model: m.Client, as: "client", attributes: ["id", "name", "email", "phone"] }],
  });
  const porNombre = new Map();
  for (const p of pacientes) {
    const k = norm(`${p.firstName} ${p.lastName}`);
    if (!porNombre.has(k)) porNombre.set(k, p);
  }

  const equipo = await m.TeamMember.findAll({ attributes: ["id", "displayName"] });
  const equipoPorNombre = new Map(equipo.map((e) => [norm(e.displayName), e.id]));

  // Un tipo de cita para lo importado. No se reutilizan los del centro para no
  // mezclar la agenda histórica con lo que configuren ellos.
  let tipo = await m.EventType.findOne({ where: { name: "Sesión (importada)" } });

  // ── Medir antes de escribir ─────────────────────────────────────────────
  const n = { ok: 0, sinPaciente: 0, sinTerapeuta: 0 };
  const porEstado = {};
  const listas = [];

  for (const c of citas) {
    const src = srcPorId.get(DOBLES[Number(c.id_pac)] ?? Number(c.id_pac));
    if (!src) { n.sinPaciente++; continue; }
    const p = porNombre.get(norm(`${src.nombre} ${src.apellidos}`));
    if (!p) { n.sinPaciente++; continue; }

    const destino = c.terapeuta ? TERAPEUTAS[norm(c.terapeuta)] : null;
    const teamMemberId = destino ? (equipoPorNombre.get(norm(destino)) ?? null) : null;
    if (!teamMemberId) n.sinTerapeuta++;

    // Una cita del FUTURO no puede estar "realizada". El extractor marca
    // `realizada` por defecto cuando la entrada no dice otra cosa, y eso vale
    // para el archivo, no para lo que aún no ha pasado: esas quedan CONFIRMADAS,
    // que es lo que son. Las canceladas y las faltas sí se respetan aunque sean
    // futuras (una cancelación se anota por adelantado).
    let estado = ESTADO[c.estado] ?? "confirmed";
    if (c.fecha > HOY && estado === "completed") estado = "confirmed";
    porEstado[estado] = (porEstado[estado] ?? 0) + 1;
    n.ok++;
    listas.push({ c, p, teamMemberId, estado });
  }

  console.log("── LO QUE SE VA A CREAR ──────────────────────────────────────\n");
  console.log(`  Citas                    ${String(n.ok).padStart(6)}`);
  console.log(`  …sin profesional         ${String(n.sinTerapeuta).padStart(6)}   estaban a nombre de «NADIE» o de una baja`);
  console.log(`  Sin paciente que cruzar  ${String(n.sinPaciente).padStart(6)}`);
  console.log(`  Por estado: ${Object.entries(porEstado).map(([k, v]) => `${k} ${v}`).join(" · ")}\n`);
  if (listas.length) {
    const fechas = listas.map((x) => x.c.fecha).sort();
    console.log(`  Periodo: ${fechas[0]} → ${fechas[fechas.length - 1]}\n`);
  }

  if (!CONFIRM) {
    console.log(`${"═".repeat(62)}`);
    console.log(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.");
    console.log(`${"═".repeat(62)}\n`);
    process.exit(0);
  }

  console.log("⚠️  Escribiendo…\n");
  let creadas = 0, yaEstaban = 0;

  await sequelize.transaction(async (t) => {
    if (!tipo) {
      tipo = await m.EventType.create({
        name: "Sesión (importada)",
        slug: "sesion-importada",
        duration: 45,
        description: "Citas traídas de Organízate en la migración del 02/08/2026.",
      }, { transaction: t });
    }

    // Idempotencia por (paciente, fecha y hora): reejecutar no duplica agenda.
    const yaHay = new Set(
      (await m.Booking.findAll({ attributes: ["patientId", "scheduledAt"], transaction: t }))
        .map((b) => `${b.patientId}|${new Date(b.scheduledAt).toISOString().slice(0, 16)}`)
    );

    for (const { c, p, teamMemberId, estado } of listas) {
      const cuando = new Date(`${c.fecha}T${c.hora ?? "09:00"}:00`);
      const clave = `${p.id}|${cuando.toISOString().slice(0, 16)}`;
      if (yaHay.has(clave)) { yaEstaban++; continue; }
      yaHay.add(clave);

      await m.Booking.create({
        eventTypeId: tipo.id,
        clientName: `${p.firstName} ${p.lastName}`.trim(),
        // Puede ir vacío: desde el 02/08 el correo no es obligatorio en una cita.
        clientEmail: p.client?.email ?? null,
        clientPhone: p.client?.phone ?? "",
        scheduledAt: cuando,
        duration: duracion(c.servicio),
        modality: "presencial",
        status: estado,
        teamMemberId,
        patientId: p.id,
        clientId: p.clientId,
        additionalData: c.servicio ? `Importada de Organízate · ${c.servicio}` : "Importada de Organízate",
      }, { transaction: t });
      creadas++;
    }
  });

  console.log("── ESCRITO ───────────────────────────────────────────────────\n");
  console.log(`  Citas creadas   ${String(creadas).padStart(6)}   (${yaEstaban} ya estaban)\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.stack ?? err}\n`);
  process.exit(1);
});
