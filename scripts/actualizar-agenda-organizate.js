/**
 * actualizar-agenda-organizate.js — pone al día la agenda FUTURA con Organízate
 * cita a cita, por su id, sin pisar lo que el centro ya ha trabajado en el CRM.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── Por qué existe (02/09/2026) ────────────────────────────────────────────
 *
 * Olga (Aumenta) pide «otra copia de las agendas de Organízate» porque durante
 * la semana han ido cambiando horarios allí. La vez anterior (29/08,
 * `sincronizar-agenda-organizate.js`) se pudo borrar todo lo importado y
 * volver a crearlo porque nadie había trabajado encima. Ahora sí: el curso
 * arrancó el 01/09 y en producción hay 981 citas canceladas por los festivos
 * del calendario (31/08), asistencias marcadas el 1 y el 2, 11 sesiones
 * clínicas colgando de citas y un aviso a familia. Borrar y recrear se lo
 * llevaría todo por delante.
 *
 * Por eso este script hace lo que aquel dejó preparado: cada cita del CRM
 * lleva su id de Organízate en `additionalData` («Importada de Organízate
 * #126600 · …»), así que se cruza POR ID:
 *
 *   · la cita existe en los dos sitios → se actualiza solo lo que cambió
 *     (hora, duración, terapeuta, paciente, servicio); estado, notas, cobros y
 *     sesiones del CRM se quedan como están;
 *   · está en Organízate y no en el CRM → se crea;
 *   · está en el CRM y ya no en Organízate → se borra SOLO si no la ha vivido
 *     nadie (ni completada, ni falta, ni sesión, ni aviso colgando). Si no,
 *     se deja y se lista.
 *
 * ── El estado, que es donde se puede hacer daño ────────────────────────────
 *
 * El estado del CRM manda salvo dos casos, los dos a favor de Organízate como
 * fuente de la agenda:
 *   1. Organízate dice algo explícito (CANCELADA, REALIZADA, FALTA…) y en el
 *      CRM la cita sigue «confirmada» → se copia ese estado.
 *   2. La cita está cancelada en el CRM (los festivos del 31/08) pero en
 *      Organízate la han MOVIDO a otra hora y sigue viva → vuelve a confirmada.
 *      Una cita que el centro reprograma en su agenda es una cita real.
 *   Una cita completada o con falta en el CRM no cambia de estado nunca.
 *
 * ── Las reservas (bloqueos de agenda) ──────────────────────────────────────
 *
 * Nada cuelga de ellas, así que van por diferencia de conjuntos: se crean las
 * que faltan y se borran las que sobran (solo las marcadas de Organízate),
 * comparando terapeuta + hora + duración + texto.
 *
 * Datos: la misma carpeta que `sincronizar-agenda-organizate.js`
 * (`agenda-organizate.json` + `pacientes-limpio.json`). El volcado se saca en
 * vivo del planning de Organízate con la sesión abierta en Chrome; desde el
 * 02/09 trae también `nombreCompleto` por cita, que es lo que permite avisar
 * con nombre de los pacientes dados de alta allí y no aquí.
 *
 * Uso:
 *   node scripts/actualizar-agenda-organizate.js --datos <carpeta>
 *   node scripts/actualizar-agenda-organizate.js --datos <carpeta> --confirm
 *   … --desde 2026-09-02   → desde qué día se toca (por defecto, hoy)
 *   … --sin-reservas       → solo las citas
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { getTenantDb } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SIN_RESERVAS = args.includes("--sin-reservas");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";
const DATOS = args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null;
const HOY = new Date().toISOString().slice(0, 10);
const DESDE = args.includes("--desde") ? args[args.indexOf("--desde") + 1] : HOY;
if (!DATOS) {
  console.error("Falta --datos <carpeta con agenda-organizate.json y pacientes-limpio.json>");
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(DESDE)) {
  console.error(`--desde tiene que ser YYYY-MM-DD (recibido «${DESDE}»)`);
  process.exit(1);
}

const MARCA = "Importada de Organízate";
const SCHEMA = `crm_${SLUG}`;

const norm = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

/**
 * Agenda de Organízate → ficha del equipo, POR ID (misma tabla que
 * sincronizar-agenda-organizate.js, con Cristina, que el 02/09 ya tiene ficha).
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
  23: "Cristina Calderón Moreno",
};

/** Fichas dobles del origen: sus citas van a la ficha que se conservó. */
const DOBLES = { 122: 121, 250: 249, 372: 371, 167: 166 };

/** Altas de Organízate posteriores al volcado de fichas del 02/08 (ver alta-pacientes-nuevos-organizate.js). */
const ALTAS_POSTERIORES = {
  1269: { nombre: "Leo", apellidos: "Machio Díez de Baldeón" },
  1270: { nombre: "GUILLERMO", apellidos: "Muñoz Nieto" },
  1271: { nombre: "Lucas", apellidos: "Herranz Fernández" }, // 02/09/2026
  // 06/09/2026: el planning solo trae «LUCAS GABRIEL»; el centro completó los
  // apellidos en el CRM (misma entrada que volcar-cobros-organizate.js).
  1266: { nombre: "Lucas Gabriel", apellidos: "Ginghina Gorga" },
};

/** Estado en Organízate → estado de la cita. «- Sin estado -» no dice nada. */
const ESTADO = {
  "REALIZADA": "completed",
  "CANCELADA": "cancelled",
  "FALTA NO JUSTIFICADA": "no_show",
  "FALTA JUSTIFICADA": "no_show",
  "ENFERMEDAD": "cancelled",
};

/** Estados que el centro ha puesto viviendo la cita: no se tocan nunca. */
const VIVIDOS = new Set(["completed", "no_show"]);

/**
 * Los festivos del centro (`blocked_days`). El 31/08 el centro canceló en el
 * CRM las 981 citas que caían en festivo con este motivo, y Organízate no sabe
 * nada de eso: allí las citas de esos días siguen vivas. Una cita nueva (o
 * movida) que caiga en festivo entra ya cancelada con el mismo motivo, para
 * no deshacer con la sincronización lo que el centro hizo a mano.
 */
const MOTIVO_FESTIVO = "Cierre del centro: festivo del calendario 2026-27 (circular)";

// ── Horas de Madrid (copiado de sincronizar-agenda-organizate.js) ──────────
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
  let ms = tentativa - desfaseMadrid(tentativa);
  ms = tentativa - desfaseMadrid(ms);
  return new Date(ms);
}

const fmtMadrid = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});
/** «2026-09-02 16:15» en hora de Madrid, para leer y comparar. */
const enMadrid = (d) => fmtMadrid.format(d).replace("T", " ");
const fechaMadrid = (d) => enMadrid(d).slice(0, 10);
const sumarMin = (d, min) => new Date(d.getTime() + min * 60000);
const idOrganizate = (b) => (String(b.additionalData ?? "").match(/#(\d+)/) || [])[1] ?? null;
const etiquetaReserva = (texto) => (texto || "Reservado").slice(0, 120);
const n6 = (x) => String(x).padStart(6);

async function main() {
  console.log(`\n${"═".repeat(64)}`);
  console.log(` AGENDA DE ORGANÍZATE → tenant "${SLUG}" (cita a cita, por id)`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  console.log(`${"═".repeat(64)}\n`);

  const volcado = JSON.parse(readFileSync(path.join(DATOS, "agenda-organizate.json"), "utf8"));
  const fichas = JSON.parse(readFileSync(path.join(DATOS, "pacientes-limpio.json"), "utf8")).fichas;
  const srcPorId = new Map(fichas.map((f) => [Number(f.id_pac), f]));
  console.log(`Volcado del ${volcado.extraido?.slice(0, 16).replace("T", " ")} · ${volcado.totales.citas} citas · ${volcado.totales.reservas} reservas`);
  console.log(`Rango del volcado: ${volcado.rango.desde} → ${volcado.rango.hasta} · se toca desde el ${DESDE}\n`);

  const { models: m, sequelize } = getTenantDb(SLUG);
  const { Op, QueryTypes } = sequelize.Sequelize;
  const desdeInstante = instanteMadrid(DESDE, "00:00");

  // ── Quién es quién ───────────────────────────────────────────────────────
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
  const nombreEquipo = new Map(equipo.map((e) => [e.id, e.displayName]));
  const terapeutaDe = (idEmp) => {
    const destino = AGENDAS[Number(idEmp)];
    return destino ? (equipoPorNombre.get(norm(destino)) ?? null) : null;
  };
  const pacienteDe = (c) => {
    // La tabla de altas manda sobre el volcado del 02/08: el 1266 estaba allí
    // solo con el nombre de pila y el centro le completó los apellidos en el CRM.
    const idPac = DOBLES[Number(c.idPac)] ?? Number(c.idPac);
    const src = ALTAS_POSTERIORES[idPac] ?? srcPorId.get(idPac);
    if (src) return porNombre.get(norm(`${src.nombre} ${src.apellidos}`)) ?? null;
    // Alta hecha en Organízate después del volcado de fichas: el planning trae el nombre completo.
    return c.nombreCompleto ? (porNombre.get(norm(c.nombreCompleto)) ?? null) : null;
  };
  let festivos = new Set();
  try {
    festivos = new Set((await m.BlockedDay.findAll({ attributes: ["date"] })).map((b) => String(b.date).slice(0, 10)));
  } catch { /* schema sin blocked_days: no hay festivos que respetar */ }
  console.log(`Festivos del centro: ${festivos.size}${festivos.size ? ` (${[...festivos].sort().slice(0, 4).join(", ")}…)` : ""}`);

  // ── Lo que hay en el CRM con marca de Organízate (TODAS, para cruzar por id) ──
  const existentes = await m.Booking.findAll({
    where: { additionalData: { [Op.like]: `${MARCA}%` } },
    attributes: ["id", "scheduledAt", "duration", "teamMemberId", "patientId", "clientId", "clientName", "status", "additionalData", "cancellationReason"],
  });
  const porIdOrg = new Map();
  for (const b of existentes) {
    const k = idOrganizate(b);
    if (k) porIdOrg.set(k, b);
  }
  console.log(`En el CRM: ${existentes.length} citas con marca de Organízate (${porIdOrg.size} con id)\n`);

  let tipo = await m.EventType.findOne({ where: { name: "Sesión (importada)" } });

  // ── Cruce cita a cita ────────────────────────────────────────────────────
  const crear = [], actualizar = [];
  const vistas = new Set();
  const n = { fuera: 0, sinPaciente: 0, sinTerapeuta: 0, iguales: 0, movidas: 0, duracion: 0, terapeuta: 0, paciente: 0, servicio: 0, estado: 0, reactivadas: 0, festivo: 0 };
  const pacientesDesconocidos = new Map(); // idPac → { nombre, citas }
  const agendasSinFicha = new Map();
  const conflictosEstado = [];
  const reactivadas = [];
  const porTerapeuta = new Map(); // nombre → { creadas, movidas, borradas, cambios }
  const cuenta = (teamMemberId, campo) => {
    const k = nombreEquipo.get(teamMemberId) ?? "(sin terapeuta)";
    const r = porTerapeuta.get(k) ?? { creadas: 0, movidas: 0, cambios: 0, borradas: 0 };
    r[campo]++;
    porTerapeuta.set(k, r);
  };

  for (const c of volcado.citas) {
    const existente = porIdOrg.get(String(c.idCita)) ?? null;
    if (existente) vistas.add(String(c.idCita));
    // Solo el futuro: una cita del pasado se deja como esté (sí se atiende si
    // en el CRM sigue en el futuro, porque entonces la han movido hacia atrás).
    if (c.fecha < DESDE && !(existente && existente.scheduledAt >= desdeInstante)) { n.fuera++; continue; }

    const p = pacienteDe(c);
    if (!p) {
      n.sinPaciente++;
      const d = pacientesDesconocidos.get(c.idPac) ?? { nombre: c.nombreCompleto || "?", citas: 0, yaEnCrm: 0 };
      d.citas++;
      if (existente) d.yaEnCrm++;
      pacientesDesconocidos.set(c.idPac, d);
      continue; // sin ficha no se crea; si ya existía se deja tal cual
    }
    const teamMemberId = terapeutaDe(c.idEmp);
    if (!teamMemberId) {
      n.sinTerapeuta++;
      agendasSinFicha.set(c.idEmp, (agendasSinFicha.get(c.idEmp) ?? 0) + 1);
    }
    const scheduledAt = instanteMadrid(c.fecha, c.hora);
    const duration = c.dur || 45;
    const additionalData = `${MARCA} #${c.idCita}${c.servicio ? ` · ${c.servicio}` : ""}`;
    const estadoOrg = ESTADO[norm(c.estado)]; // undefined = «- Sin estado -»

    if (!existente) {
      const fila = {
        eventTypeId: tipo?.id ?? null,
        clientName: `${p.firstName} ${p.lastName}`.trim(),
        clientEmail: p.client?.email ?? null,
        clientPhone: p.client?.phone ?? "",
        scheduledAt,
        duration,
        modality: "presencial",
        status: estadoOrg ?? "confirmed",
        teamMemberId,
        patientId: p.id,
        clientId: p.clientId,
        additionalData,
      };
      if (estadoOrg === "cancelled") { fila.cancelledAt = new Date(); fila.cancellationReason = `Organízate: ${c.estado}`; }
      if (estadoOrg === "no_show") fila.noShowJustified = norm(c.estado) === "FALTA JUSTIFICADA";
      if (!estadoOrg && festivos.has(c.fecha)) {
        fila.status = "cancelled"; fila.cancelledAt = new Date(); fila.cancellationReason = MOTIVO_FESTIVO;
        n.festivo++;
      }
      crear.push({ c, fila });
      cuenta(teamMemberId, "creadas");
      continue;
    }

    const cambios = {};
    const movida = existente.scheduledAt.getTime() !== scheduledAt.getTime();
    if (movida) { cambios.scheduledAt = scheduledAt; n.movidas++; }
    if (existente.duration !== duration) { cambios.duration = duration; n.duracion++; }
    if (teamMemberId && existente.teamMemberId !== teamMemberId) { cambios.teamMemberId = teamMemberId; n.terapeuta++; }
    if (existente.patientId !== p.id) {
      cambios.patientId = p.id; cambios.clientId = p.clientId; cambios.clientName = `${p.firstName} ${p.lastName}`.trim();
      n.paciente++;
    }
    if (existente.additionalData !== additionalData) { cambios.additionalData = additionalData; n.servicio++; }

    if (estadoOrg) {
      if (existente.status !== estadoOrg) {
        if (VIVIDOS.has(existente.status) || existente.status === "cancelled") {
          conflictosEstado.push({ idCita: c.idCita, crm: existente.status, organizate: c.estado, cuando: enMadrid(scheduledAt) });
        } else {
          cambios.status = estadoOrg; n.estado++;
          if (estadoOrg === "cancelled") { cambios.cancelledAt = new Date(); cambios.cancellationReason = `Organízate: ${c.estado}`; }
          if (estadoOrg === "no_show") cambios.noShowJustified = norm(c.estado) === "FALTA JUSTIFICADA";
        }
      }
    } else if (movida && existente.status === "cancelled" && !festivos.has(c.fecha)) {
      cambios.status = "confirmed"; cambios.cancelledAt = null; cambios.cancellationReason = null;
      n.reactivadas++;
      reactivadas.push({ idCita: c.idCita, de: enMadrid(existente.scheduledAt), a: enMadrid(scheduledAt), motivo: existente.cancellationReason });
    } else if (movida && festivos.has(c.fecha) && ["confirmed", "pending"].includes(existente.status)) {
      cambios.status = "cancelled"; cambios.cancelledAt = new Date(); cambios.cancellationReason = MOTIVO_FESTIVO;
      n.festivo++;
    }

    if (Object.keys(cambios).length) {
      actualizar.push({ c, existente, cambios, movida });
      cuenta(cambios.teamMemberId ?? existente.teamMemberId, movida ? "movidas" : "cambios");
    } else {
      n.iguales++;
    }
  }

  // ── Las que ya no están en Organízate ────────────────────────────────────
  const candidatas = existentes.filter((b) =>
    b.scheduledAt >= desdeInstante
    && fechaMadrid(b.scheduledAt) <= volcado.rango.hasta
    && idOrganizate(b) && !vistas.has(idOrganizate(b)));

  const conCola = new Set();
  if (candidatas.length) {
    const ids = candidatas.map((b) => b.id);
    for (const t of ["booking_change_requests", "client_notices", "clinic_sessions", "taller_asistencias", "taller_cita_terapeutas", "taller_sesiones"]) {
      try {
        const filas = await sequelize.query(
          `SELECT DISTINCT booking_id FROM "${SCHEMA}"."${t}" WHERE booking_id IN (:ids)`,
          { replacements: { ids }, type: QueryTypes.SELECT },
        );
        filas.forEach((f) => conCola.add(f.booking_id));
      } catch { /* la tabla no existe en este schema: nada cuelga de ahí */ }
    }
  }
  const borrar = [], conservar = [];
  for (const b of candidatas) {
    if (VIVIDOS.has(b.status) || conCola.has(b.id)) conservar.push(b);
    else { borrar.push(b); cuenta(b.teamMemberId, "borradas"); }
  }

  // ── Las reservas, por diferencia de conjuntos ─────────────────────────────
  const bloquesCrear = [], bloquesBorrar = [];
  let bloquesIguales = 0, bloquesConCola = 0;
  if (!SIN_RESERVAS) {
    const deseados = new Map();
    for (const r of volcado.reservas) {
      if (r.fecha < DESDE) continue;
      const teamMemberId = terapeutaDe(r.idEmp);
      if (!teamMemberId) continue;
      const startAt = instanteMadrid(r.fecha, r.hora);
      const endAt = sumarMin(startAt, r.dur || 15);
      const label = etiquetaReserva(r.texto);
      const k = `${teamMemberId}|${startAt.toISOString()}|${endAt.toISOString()}|${label}`;
      if (!deseados.has(k)) deseados.set(k, { teamMemberId, startAt, endAt, label, notes: `${MARCA} · reserva del planning` });
    }
    const actuales = await m.TeamBlock.findAll({
      where: { startAt: { [Op.gte]: desdeInstante }, notes: { [Op.like]: `${MARCA}%` } },
      attributes: ["id", "teamMemberId", "startAt", "endAt", "label"],
    });
    const vistos = new Set();
    const sobran = [];
    for (const b of actuales) {
      const k = `${b.teamMemberId}|${b.startAt.toISOString()}|${b.endAt.toISOString()}|${b.label}`;
      if (deseados.has(k) && !vistos.has(k)) { vistos.add(k); bloquesIguales++; }
      else sobran.push(b);
    }
    for (const [k, v] of deseados) if (!vistos.has(k)) bloquesCrear.push(v);
    if (sobran.length) {
      const ids = sobran.map((b) => b.id);
      const enlazados = new Set();
      for (const t of ["documents", "taller_sesiones"]) {
        try {
          const filas = await sequelize.query(
            `SELECT DISTINCT team_block_id FROM "${SCHEMA}"."${t}" WHERE team_block_id IN (:ids)`,
            { replacements: { ids }, type: QueryTypes.SELECT },
          );
          filas.forEach((f) => enlazados.add(f.team_block_id));
        } catch { /* sin tabla, sin enlaces */ }
      }
      for (const b of sobran) {
        if (enlazados.has(b.id)) bloquesConCola++;
        else bloquesBorrar.push(b);
      }
    }
  }

  // ── El informe ───────────────────────────────────────────────────────────
  console.log("── LO QUE VA A PASAR ─────────────────────────────────────────\n");
  console.log(`  Citas iguales en los dos sitios             ${n6(n.iguales)}`);
  console.log(`  Citas que se crean (nuevas en Organízate)   ${n6(crear.length)}`);
  console.log(`  Citas que se actualizan                     ${n6(actualizar.length)}`);
  console.log(`    …de hora o día                            ${n6(n.movidas)}`);
  console.log(`    …de duración                              ${n6(n.duracion)}`);
  console.log(`    …de terapeuta                             ${n6(n.terapeuta)}`);
  console.log(`    …de paciente                              ${n6(n.paciente)}`);
  console.log(`    …de servicio (texto)                      ${n6(n.servicio)}`);
  console.log(`    …de estado (lo dice Organízate)           ${n6(n.estado)}`);
  console.log(`    …canceladas aquí que allí han movido      ${n6(n.reactivadas)}   → vuelven a confirmada`);
  console.log(`  Nuevas o movidas que caen en festivo        ${n6(n.festivo)}   → entran canceladas, como las del 31/08`);
  console.log(`  Citas que se borran (ya no están allí)      ${n6(borrar.length)}`);
  console.log(`  Citas que ya no están allí pero se conservan${n6(conservar.length)}   (vividas o con sesión/aviso colgando)`);
  console.log(`  Citas fuera del rango (pasado)              ${n6(n.fuera)}`);
  console.log(`  Citas sin paciente en el CRM                ${n6(n.sinPaciente)}   de ${pacientesDesconocidos.size} pacientes`);
  console.log(`  Citas de agendas sin ficha de equipo        ${n6(n.sinTerapeuta)}`);
  if (!SIN_RESERVAS) {
    console.log(`  Bloqueos iguales                            ${n6(bloquesIguales)}`);
    console.log(`  Bloqueos que se crean                       ${n6(bloquesCrear.length)}`);
    console.log(`  Bloqueos que se borran                      ${n6(bloquesBorrar.length)}`);
    if (bloquesConCola) console.log(`  Bloqueos que sobran pero tienen documentos  ${n6(bloquesConCola)}   (se conservan)`);
  }
  console.log();

  if (porTerapeuta.size) {
    console.log("  Por terapeuta (creadas / movidas / otros cambios / borradas):");
    for (const [k, r] of [...porTerapeuta.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`    ${k.padEnd(30)} ${String(r.creadas).padStart(4)} / ${String(r.movidas).padStart(4)} / ${String(r.cambios).padStart(4)} / ${String(r.borradas).padStart(4)}`);
    }
    console.log();
  }
  if (pacientesDesconocidos.size) {
    console.log("  ⚠️  Pacientes de Organízate que no están en el CRM (id_pac · nombre · citas):");
    for (const [id, d] of [...pacientesDesconocidos.entries()].sort((a, b) => b[1].citas - a[1].citas).slice(0, 25)) {
      console.log(`      ${String(id).padStart(5)} · ${d.nombre.padEnd(40)} · ${d.citas} citas${d.yaEnCrm ? ` (${d.yaEnCrm} ya en el CRM, se dejan)` : ""}`);
    }
    console.log();
  }
  if (agendasSinFicha.size) {
    console.log(`  ⚠️  Agendas sin ficha de equipo: ${[...agendasSinFicha.entries()].map(([id, k]) => `emp${id} (${k} citas)`).join(", ")}\n`);
  }
  if (conflictosEstado.length) {
    console.log(`  Estados distintos que se respetan tal cual están en el CRM (${conflictosEstado.length}):`);
    for (const x of conflictosEstado.slice(0, 15)) console.log(`      #${x.idCita} ${x.cuando} · CRM ${x.crm} · Organízate «${x.organizate}»`);
    console.log();
  }
  if (reactivadas.length) {
    console.log(`  Canceladas en el CRM que Organízate ha movido (vuelven a confirmada) (${reactivadas.length}):`);
    for (const x of reactivadas.slice(0, 15)) console.log(`      #${x.idCita} ${x.de} → ${x.a} · estaba cancelada por «${(x.motivo ?? "").slice(0, 50)}»`);
    console.log();
  }
  if (conservar.length) {
    console.log(`  Ya no están en Organízate pero se conservan (${conservar.length}):`);
    for (const b of conservar.slice(0, 15)) console.log(`      #${idOrganizate(b)} ${enMadrid(b.scheduledAt)} · ${b.clientName} · ${b.status}${conCola.has(b.id) ? " · con sesión/aviso" : ""}`);
    console.log();
  }
  const muestra = (lista, f) => lista.slice(0, 8).map(f).join("\n");
  if (crear.length) console.log(`  Muestra de las nuevas:\n${muestra(crear, ({ c, fila }) => `      #${c.idCita} ${c.fecha} ${c.hora} ${String(c.dur).padStart(3)}' · ${nombreEquipo.get(fila.teamMemberId) ?? "?"} · ${fila.clientName} · ${c.servicio}`)}\n`);
  if (actualizar.length) console.log(`  Muestra de las actualizadas:\n${muestra(actualizar, ({ c, existente, cambios }) => `      #${c.idCita} ${existente.clientName}: ${Object.keys(cambios).map((k) => k === "scheduledAt" ? `${enMadrid(existente.scheduledAt)} → ${enMadrid(cambios.scheduledAt)}` : k === "teamMemberId" ? `terapeuta → ${nombreEquipo.get(cambios.teamMemberId)}` : k === "duration" ? `${existente.duration}' → ${cambios.duration}'` : k).join(", ")}`)}\n`);
  if (borrar.length) console.log(`  Muestra de las que se borran:\n${muestra(borrar, (b) => `      #${idOrganizate(b)} ${enMadrid(b.scheduledAt)} · ${nombreEquipo.get(b.teamMemberId) ?? "?"} · ${b.clientName} · ${b.status}`)}\n`);

  if (!CONFIRM) {
    console.log(`${"═".repeat(64)}`);
    console.log(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.");
    console.log(`${"═".repeat(64)}\n`);
    process.exit(0);
  }

  console.log("⚠️  Escribiendo…\n");
  const hecho = { creadas: 0, actualizadas: 0, borradas: 0, bloquesCreados: 0, bloquesBorrados: 0 };
  await sequelize.transaction(async (t) => {
    if (!tipo && crear.length) {
      tipo = await m.EventType.create({
        name: "Sesión (importada)", slug: "sesion-importada", duration: 45, description: "Citas traídas de Organízate.",
      }, { transaction: t });
      crear.forEach((x) => { x.fila.eventTypeId = tipo.id; });
    }
    for (const { existente, cambios } of actualizar) {
      await existente.update(cambios, { transaction: t });
      hecho.actualizadas++;
    }
    for (const { fila } of crear) {
      await m.Booking.create(fila, { transaction: t });
      hecho.creadas++;
    }
    if (borrar.length) {
      hecho.borradas = await m.Booking.destroy({ where: { id: borrar.map((b) => b.id) }, transaction: t });
    }
    if (!SIN_RESERVAS) {
      if (bloquesBorrar.length) {
        hecho.bloquesBorrados = await m.TeamBlock.destroy({ where: { id: bloquesBorrar.map((b) => b.id) }, transaction: t });
      }
      for (const b of bloquesCrear) {
        await m.TeamBlock.create(b, { transaction: t });
        hecho.bloquesCreados++;
      }
    }
  });

  console.log("── ESCRITO ───────────────────────────────────────────────────\n");
  console.log(`  Citas creadas        ${n6(hecho.creadas)}`);
  console.log(`  Citas actualizadas   ${n6(hecho.actualizadas)}`);
  console.log(`  Citas borradas       ${n6(hecho.borradas)}`);
  console.log(`  Bloqueos creados     ${n6(hecho.bloquesCreados)}`);
  console.log(`  Bloqueos borrados    ${n6(hecho.bloquesBorrados)}\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.stack ?? err}\n`);
  process.exit(1);
});
