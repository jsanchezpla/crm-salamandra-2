/**
 * Agregación de productividad del equipo (consulta a BD). Separado de
 * productivity.js para que ese quede puro (client-safe) y este pueda importar
 * Sequelize. Lo usan el endpoint /productividad y el /dashboard.
 */

import { Op, fn, col } from "sequelize";
import { computeProductivity } from "./productivity.js";
import { clasificarBloqueo, valoracionEsInterna, desgloseDeCita, minutosDentroDe } from "./trabajoInterno.js";

// Citas que cuentan como intervención directa: agendadas y no anuladas.
const DIRECT_STATUSES = ["confirmed", "completed"];

/**
 * `EventType`, `TeamBlock` y `PatientTherapist` son OPCIONALES (31/08/2026):
 * con ellos, la agregación separa además el trabajo interno (bloqueos
 * T.I./equipo y valoraciones a pacientes sin asignar — lib/clinica/
 * trabajoInterno.js) y desglosa las citas en bono/taller/normal. Sin ellos
 * (el dashboard y la portada, que solo quieren el total), todo sigue igual.
 */
export async function aggregateTeamProductivity({ Booking, TeamMember, EventType, TeamBlock, PatientTherapist, year, month }) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const detallado = Boolean(EventType);

  const minutesByMember = {};
  const internasPorMiembro = new Map(); // id → { tiMin, equipoMin, valInternaMin, bono, taller, normal }
  const detalleDe = (id) => {
    if (!internasPorMiembro.has(id)) {
      internasPorMiembro.set(id, { tiMin: 0, equipoMin: 0, valInternaMin: 0, bono: 0, taller: 0, normal: 0 });
    }
    return internasPorMiembro.get(id);
  };

  if (!detallado) {
    const agg = await Booking.findAll({
      attributes: ["teamMemberId", [fn("SUM", col("duration")), "minutes"]],
      where: {
        teamMemberId: { [Op.ne]: null },
        status: { [Op.in]: DIRECT_STATUSES },
        scheduledAt: { [Op.gte]: start, [Op.lt]: end },
      },
      group: ["team_member_id"],
      raw: true,
    });
    for (const r of agg) minutesByMember[r.teamMemberId] = Number(r.minutes) || 0;
  } else {
    // Fila a fila: hace falta saber de qué tipo es cada cita (valoración,
    // taller, bono) y de qué paciente. Un mes de un centro son cientos de
    // citas, no miles: cabe de sobra.
    const citas = await Booking.findAll({
      where: {
        teamMemberId: { [Op.ne]: null },
        status: { [Op.in]: DIRECT_STATUSES },
        scheduledAt: { [Op.gte]: start, [Op.lt]: end },
      },
      attributes: ["teamMemberId", "duration", "packId", "patientId", "eventTypeId"],
      raw: true,
    });
    const tipos = await EventType.findAll({ attributes: ["id", "name", "isInitialAssessment"], raw: true });
    const tipoDe = new Map(tipos.map((t) => [t.id, t]));

    // Los terapeutas asignados de los pacientes con valoración este mes.
    const pacientesValoracion = [
      ...new Set(
        citas
          .filter((c) => tipoDe.get(c.eventTypeId)?.isInitialAssessment && c.patientId)
          .map((c) => c.patientId)
      ),
    ];
    const asignados = new Map(); // patientId → [teamMemberId]
    if (PatientTherapist && pacientesValoracion.length) {
      const filas = await PatientTherapist.findAll({
        where: { patientId: { [Op.in]: pacientesValoracion } },
        attributes: ["patientId", "teamMemberId"],
        raw: true,
      });
      for (const f of filas) {
        if (!asignados.has(f.patientId)) asignados.set(f.patientId, []);
        asignados.get(f.patientId).push(f.teamMemberId);
      }
    }

    for (const c of citas) {
      const tipo = tipoDe.get(c.eventTypeId);
      const min = Number(c.duration) || 0;
      const d = detalleDe(c.teamMemberId);
      const esValoracion = Boolean(tipo?.isInitialAssessment);
      if (
        esValoracion &&
        valoracionEsInterna({ teamMemberId: c.teamMemberId, terapeutasDelPaciente: asignados.get(c.patientId) ?? [] })
      ) {
        // Valoración a paciente no asignado: captación, no atención directa.
        d.valInternaMin += min;
        continue;
      }
      minutesByMember[c.teamMemberId] = (minutesByMember[c.teamMemberId] ?? 0) + min;
      d[desgloseDeCita({ packId: c.packId, eventTypeName: tipo?.name })] += 1;
    }

    // Las horas internas que el centro YA apunta en la agenda: bloqueos
    // «Reservado T.I.» y «REUNIÓN EQUIPO» (texto libre en tres grafías,
    // normalizado en trabajoInterno.js), recortados al mes.
    if (TeamBlock) {
      const bloqueos = await TeamBlock.findAll({
        where: { teamMemberId: { [Op.ne]: null }, startAt: { [Op.lt]: end }, endAt: { [Op.gt]: start } },
        attributes: ["teamMemberId", "label", "categoryKey", "startAt", "endAt"],
        raw: true,
      });
      for (const b of bloqueos) {
        // La CATEGORÍA manda sobre el texto (01/09/2026): ver trabajoInterno.js.
        const clase = clasificarBloqueo(b.label, b.categoryKey);
        if (!clase) continue;
        const min = minutosDentroDe(b.startAt, b.endAt, start, end);
        if (!min) continue;
        const d = detalleDe(b.teamMemberId);
        if (clase === "ti") d.tiMin += min;
        else d.equipoMin += min;
      }
    }
  }

  const members = await TeamMember.findAll({
    where: { status: "active" },
    attributes: ["id", "displayName", "position", "avatarColor", "weeklyDirectHours"],
    order: [["displayName", "ASC"]],
  });

  const h = (min) => Math.round((min / 60) * 10) / 10;
  const rows = members.map((m) => {
    const prod = computeProductivity({
      directMinutes: minutesByMember[m.id] ?? 0,
      weeklyDirectHours: m.weeklyDirectHours,
      year,
      month,
    });
    const fila = {
      therapistId: m.id,
      name: m.displayName,
      position: m.position ?? "",
      color: m.avatarColor ?? "#1B3A2D",
      weeklyDirectHours: m.weeklyDirectHours ?? null,
      directHours: prod.directHours,
      availableHours: prod.availableHours,
      pct: prod.pct,
    };
    if (detallado) {
      const d = internasPorMiembro.get(m.id) ?? { tiMin: 0, equipoMin: 0, valInternaMin: 0, bono: 0, taller: 0, normal: 0 };
      fila.tiHours = h(d.tiMin);
      fila.equipoHours = h(d.equipoMin);
      fila.valoracionesInternasHours = h(d.valInternaMin);
      fila.internalHours = h(d.tiMin + d.equipoMin + d.valInternaMin);
      fila.desglose = { bono: d.bono, taller: d.taller, normal: d.normal };
    }
    return fila;
  });
  rows.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));

  const withPct = rows.filter((r) => r.pct != null);
  const totalDirectHours = Math.round(rows.reduce((s, r) => s + (r.directHours || 0), 0) * 10) / 10;
  const teamPct = withPct.length ? Math.round(withPct.reduce((s, r) => s + r.pct, 0) / withPct.length) : null;
  const configuredCount = rows.filter((r) => r.weeklyDirectHours != null).length;

  const totals = { totalDirectHours, teamPct, memberCount: rows.length, configuredCount };
  if (detallado) {
    totals.totalInternalHours = Math.round(rows.reduce((s, r) => s + (r.internalHours || 0), 0) * 10) / 10;
  }
  return { rows, totals };
}
