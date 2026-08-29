/**
 * sincronizar-agenda-organizate.js — refresca la agenda FUTURA desde Organízate.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── Por qué existe (29/08/2026) ────────────────────────────────────────────
 *
 * La agenda del CRM es la foto que se sacó de Organízate el 02/08. El centro
 * siguió montando el curso allí, así que el 29/08 sobraba y faltaba:
 *
 *   · Organízate 13.187 citas · CRM 12.030 → +1.157, repartidas por todo el
 *     curso (~120 al mes): son altas nuevas, no un horario rehecho.
 *   · Las 1.827 citas sin terapeuta del CRM YA tienen dueña en Organízate: el
 *     centro repartió las agendas de las tres bajas entre las incorporaciones
 *     (Dania→Laura Fernández, Victoria→Raquel Torralbo, Laura A. Arroyo→Lucía
 *     González, y la logopedia sin nadie→Arantxa Garrote). No hacía falta
 *     preguntárselo: estaba escrito allí.
 *
 * ── El criterio, que lo eligió Rodrigo (29/08/2026) ────────────────────────
 *
 * **Refrescar el futuro**: se borran las citas futuras QUE VINIERON DE
 * ORGANÍZATE y se vuelve a crear la foto de hoy. Se puede hacer sin miedo
 * porque se comprobó antes contra producción que nadie había trabajado encima:
 * 0 citas creadas tras el volcado, 0 modificaciones desde el 26/08 (las 1.827
 * «tocadas» las tocó el script del «Era de»), y nada cuelga de `bookings`
 * (0 solicitudes de cambio, 0 avisos). Lo único que se pierde es el «Era de»,
 * que deja de hacer falta: ahora cada cita viene con su terapeuta.
 *
 * Lo que NO se borra: cualquier cita que no lleve la marca de Organízate. Si
 * el centro creó algo a mano, se queda.
 *
 * ── Lo que se arregla para la próxima vez ──────────────────────────────────
 *
 * Cada cita se guarda con su **id de Organízate** (`#126600`) en
 * `additionalData`. El volcado del 02/08 no lo hizo, y por eso esta vez hubo
 * que comparar por paciente+hora para saber qué era qué. Con el id, la
 * siguiente sincronización es exacta y no hace falta borrar nada.
 *
 * ── Las reservas ───────────────────────────────────────────────────────────
 *
 * Organízate tiene 10.468 bloques que NO son citas de paciente (coordinaciones,
 * reuniones de equipo, entrevistas iniciales). El volcado del 02/08 no los
 * trajo, así que el CRM enseñaba como libres huecos que están ocupados. Entran
 * como `team_blocks` y no como citas, por lo que explica TeamBlock.model.js:
 * una cita fantasma se colaría en recordatorios, WhatsApp y facturación.
 *
 * Uso:
 *   node scripts/sincronizar-agenda-organizate.js --datos <carpeta>
 *   node scripts/sincronizar-agenda-organizate.js --datos <carpeta> --confirm
 *   … --sin-reservas    → solo las citas
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { getTenantDb } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SIN_RESERVAS = args.includes("--sin-reservas");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";
const DATOS = args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null;
if (!DATOS) {
  console.error("Falta --datos <carpeta con agenda-organizate.json y pacientes-limpio.json>");
  process.exit(1);
}

const MARCA = "Importada de Organízate";
const HOY = new Date().toISOString().slice(0, 10);

const norm = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

/**
 * Agenda de Organízate → ficha del equipo en el CRM, POR ID y no por nombre:
 * en Organízate la logopeda nueva es «ARANCHA» y en el CRM «Arantxa», y las
 * cabeceras del planning van abreviadas («ISABEL V.», «RAQUEL TO»). Un cruce
 * por parecido podría darle la agenda de una a otra.
 */
const AGENDAS = {
  1: "Isabel Alberca Bolaños",
  3: "Laura Barrionuevo Machota",
  4: "Silvia Pérez Hernández",
  5: "Raquel Mesones Bernal",
  7: "Raquel Torralbo Samper",
  8: "Laura Fernández Mulero",
  10: "Elena Gutiérrez García",
  11: "Lucía Gonzalez Encinar",
  12: "Daniela de la Cruz Esteban",
  13: "Araceli Vigara Méndez",
  14: "Blanca Márquez Bascón",
  15: "Estefanía Bermejo Blázquez",
  17: "Isabel Vara Perea",
  18: "Arantxa Garrote Ortega",
  22: "Laura Garrido Rascón",
  23: null, // CRISTINA CALDERÓN: tiene agenda en Organízate pero NO ficha en el CRM (y hoy, 0 citas)
};

/** Fichas dobles del origen: sus citas van a la ficha que se conservó. */
const DOBLES = { 122: 121, 250: 249, 372: 371, 167: 166 };

/**
 * Altas de Organízate POSTERIORES al volcado del 02/08, que por eso no están
 * en `pacientes-limpio.json`. Sin esto sus citas se caen aunque la ficha ya
 * exista en el CRM: el cruce va id_pac → nombre → paciente, y el primer salto
 * lo da ese fichero. Se apuntan aquí en vez de reescribir el volcado, que es
 * la foto de aquel día y no se toca. Las creó
 * `alta-pacientes-nuevos-organizate.js` (29/08/2026).
 */
const ALTAS_POSTERIORES = {
  1269: { nombre: "Leo", apellidos: "Machio Díez de Baldeón" },
  1270: { nombre: "GUILLERMO", apellidos: "Muñoz Nieto" },
};

/** Estado en Organízate → estado de la cita. Lo que no diga nada, confirmada. */
const ESTADO = {
  "REALIZADA": "completed",
  "CANCELADA": "cancelled",
  "FALTA NO JUSTIFICADA": "no_show",
  "FALTA JUSTIFICADA": "no_show",
  "ENFERMEDAD": "cancelled",
};

/**
 * El desfase de Madrid EN ESE INSTANTE, para que cada cita se guarde a su hora
 * real. No vale `new Date("2026-09-01T10:00:00")`: eso depende de la zona del
 * proceso, y es exactamente lo que rompió el volcado del 02/08 (corrió en UTC
 * y toda la agenda salió dos horas tarde). Con el cambio de hora del 25 de
 * octubre en mitad del curso, media agenda va a +2 y la otra media a +1.
 */
function desfaseMadrid(ms) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid",
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const o = {};
  p.forEach((x) => { o[x.type] = x.value; });
  return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second) - ms;
}

function instanteMadrid(fecha, hora) {
  const [Y, M, D] = fecha.split("-").map(Number);
  const [h, mi] = hora.split(":").map(Number);
  const tentativa = Date.UTC(Y, M - 1, D, h, mi);
  // Dos pasadas: la primera puede caer justo en el borde del cambio de hora.
  let ms = tentativa - desfaseMadrid(tentativa);
  ms = tentativa - desfaseMadrid(ms);
  return new Date(ms);
}

const sumarMin = (d, min) => new Date(d.getTime() + min * 60000);

async function main() {
  console.log(`\n${"═".repeat(64)}`);
  console.log(` AGENDA DE ORGANÍZATE → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  console.log(`${"═".repeat(64)}\n`);

  const volcado = JSON.parse(readFileSync(path.join(DATOS, "agenda-organizate.json"), "utf8"));
  const fichas = JSON.parse(readFileSync(path.join(DATOS, "pacientes-limpio.json"), "utf8")).fichas;
  const srcPorId = new Map(fichas.map((f) => [Number(f.id_pac), f]));
  console.log(`Volcado del ${volcado.extraido?.slice(0, 10)} · ${volcado.totales.citas} citas · ${volcado.totales.reservas} reservas`);
  console.log(`Rango: ${volcado.rango.desde} → ${volcado.rango.hasta}\n`);

  const { models: m, sequelize } = getTenantDb(SLUG);
  const { Op } = sequelize.Sequelize;

  const pacientes = await m.Patient.findAll({
    attributes: ["id", "firstName", "lastName", "clientId"],
    include: [{ model: m.Client, as: "client", attributes: ["id", "email", "phone"] }],
  });
  const porNombre = new Map();
  for (const p of pacientes) {
    const k = norm(`${p.firstName} ${p.lastName}`);
    if (!porNombre.has(k)) porNombre.set(k, p);
  }

  const equipo = await m.TeamMember.findAll({ attributes: ["id", "displayName"] });
  const equipoPorNombre = new Map(equipo.map((e) => [norm(e.displayName), e.id]));

  // ── Preparar las citas ───────────────────────────────────────────────────
  const listas = [];
  const n = { sinPaciente: 0, sinTerapeuta: 0, pasadas: 0 };
  const pacientesDesconocidos = new Map(); // idPac → cuántas citas se quedan fuera
  const agendasSinFicha = new Map();

  for (const c of volcado.citas) {
    if (c.fecha < HOY) { n.pasadas++; continue; }

    const src = srcPorId.get(DOBLES[Number(c.idPac)] ?? Number(c.idPac)) ?? ALTAS_POSTERIORES[Number(c.idPac)];
    const p = src ? porNombre.get(norm(`${src.nombre} ${src.apellidos}`)) : null;
    if (!p) {
      n.sinPaciente++;
      pacientesDesconocidos.set(c.idPac, (pacientesDesconocidos.get(c.idPac) ?? 0) + 1);
      continue;
    }

    const destino = AGENDAS[Number(c.idEmp)];
    const teamMemberId = destino ? (equipoPorNombre.get(norm(destino)) ?? null) : null;
    if (!teamMemberId) {
      n.sinTerapeuta++;
      agendasSinFicha.set(c.idEmp, (agendasSinFicha.get(c.idEmp) ?? 0) + 1);
    }

    listas.push({ c, p, teamMemberId, estado: ESTADO[norm(c.estado)] ?? "confirmed" });
  }

  // ── Preparar las reservas ────────────────────────────────────────────────
  const bloques = [];
  if (!SIN_RESERVAS) {
    for (const r of volcado.reservas) {
      if (r.fecha < HOY) continue;
      const destino = AGENDAS[Number(r.idEmp)];
      const teamMemberId = destino ? (equipoPorNombre.get(norm(destino)) ?? null) : null;
      if (!teamMemberId) continue; // sin ficha en el CRM no hay agenda que bloquear
      const inicio = instanteMadrid(r.fecha, r.hora);
      bloques.push({
        teamMemberId,
        startAt: inicio,
        endAt: sumarMin(inicio, r.dur || 15),
        label: (r.texto || "Reservado").slice(0, 120),
        notes: `${MARCA} · reserva del planning`,
      });
    }
  }

  // ── Qué hay ahora ────────────────────────────────────────────────────────
  const desdeHoy = { [Op.gte]: new Date(`${HOY}T00:00:00Z`) };
  const aBorrar = await m.Booking.count({
    where: { scheduledAt: desdeHoy, additionalData: { [Op.like]: `${MARCA}%` } },
  });
  const ajenas = await m.Booking.count({
    where: {
      scheduledAt: desdeHoy,
      [Op.or]: [{ additionalData: null }, { additionalData: { [Op.notLike]: `${MARCA}%` } }],
    },
  });

  console.log("── LO QUE VA A PASAR ─────────────────────────────────────────\n");
  console.log(`  Citas futuras de Organízate que se borran   ${String(aBorrar).padStart(6)}`);
  console.log(`  Citas futuras que NO se tocan (ajenas)      ${String(ajenas).padStart(6)}`);
  console.log(`  Citas que se crean                          ${String(listas.length).padStart(6)}`);
  console.log(`  …con terapeuta                              ${String(listas.filter((x) => x.teamMemberId).length).padStart(6)}`);
  console.log(`  …sin terapeuta                              ${String(n.sinTerapeuta).padStart(6)}`);
  console.log(`  Citas fuera (paciente que no está en el CRM)${String(n.sinPaciente).padStart(6)}   de ${pacientesDesconocidos.size} pacientes`);
  console.log(`  Bloqueos de agenda que se crean             ${String(bloques.length).padStart(6)}\n`);

  if (pacientesDesconocidos.size) {
    const top = [...pacientesDesconocidos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    console.log("  ⚠️  Pacientes de Organízate que no están en el CRM (id_pac:citas):");
    console.log(`      ${top.map(([id, k]) => `${id}:${k}`).join("  ")}${pacientesDesconocidos.size > 15 ? "  …" : ""}\n`);
  }
  if (agendasSinFicha.size) {
    console.log(`  ⚠️  Agendas sin ficha de equipo: ${[...agendasSinFicha.entries()].map(([id, k]) => `emp${id} (${k} citas)`).join(", ")}\n`);
  }

  if (!CONFIRM) {
    console.log(`${"═".repeat(64)}`);
    console.log(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.");
    console.log(`${"═".repeat(64)}\n`);
    process.exit(0);
  }

  console.log("⚠️  Escribiendo…\n");
  let creadas = 0, borradas = 0, bloqueadas = 0, bloquesBorrados = 0;

  await sequelize.transaction(async (t) => {
    let tipo = await m.EventType.findOne({ where: { name: "Sesión (importada)" }, transaction: t });
    if (!tipo) {
      tipo = await m.EventType.create({
        name: "Sesión (importada)",
        slug: "sesion-importada",
        duration: 45,
        description: "Citas traídas de Organízate.",
      }, { transaction: t });
    }

    borradas = await m.Booking.destroy({
      where: { scheduledAt: desdeHoy, additionalData: { [Op.like]: `${MARCA}%` } },
      transaction: t,
    });

    for (const { c, p, teamMemberId, estado } of listas) {
      await m.Booking.create({
        eventTypeId: tipo.id,
        clientName: `${p.firstName} ${p.lastName}`.trim(),
        clientEmail: p.client?.email ?? null,
        clientPhone: p.client?.phone ?? "",
        scheduledAt: instanteMadrid(c.fecha, c.hora),
        duration: c.dur || 45,
        modality: "presencial",
        status: estado,
        teamMemberId,
        patientId: p.id,
        clientId: p.clientId,
        additionalData: `${MARCA} #${c.idCita}${c.servicio ? ` · ${c.servicio}` : ""}`,
      }, { transaction: t });
      creadas++;
    }

    if (!SIN_RESERVAS) {
      bloquesBorrados = await m.TeamBlock.destroy({
        where: { startAt: desdeHoy, notes: { [Op.like]: `${MARCA}%` } },
        transaction: t,
      });
      for (const b of bloques) {
        await m.TeamBlock.create(b, { transaction: t });
        bloqueadas++;
      }
    }
  });

  console.log("── ESCRITO ───────────────────────────────────────────────────\n");
  console.log(`  Citas borradas    ${String(borradas).padStart(6)}`);
  console.log(`  Citas creadas     ${String(creadas).padStart(6)}`);
  console.log(`  Bloqueos borrados ${String(bloquesBorrados).padStart(6)}`);
  console.log(`  Bloqueos creados  ${String(bloqueadas).padStart(6)}\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.stack ?? err}\n`);
  process.exit(1);
});
