/**
 * lib/citas/ausencias.js — «Vacaciones»: quitar de la agenda los tramos en que
 * alguien no está (06/08/2026, Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten las dos rutas públicas de
 * disponibilidad, la agenda del panel y el alta manual de citas. La misma
 * razón por la que `festivos.js` vive aquí.)
 *
 * ── EN QUÉ SE DIFERENCIA DE UN FESTIVO ──────────────────────────────────────
 * Un festivo cierra el CENTRO un DÍA entero. Unas vacaciones son de UNA persona
 * y llevan hora: «me voy el viernes a las 14:00 y vuelvo el lunes a las 10:00».
 * Por eso el festivo se resuelve con un Set de fechas y esto necesita restar
 * intervalos de verdad.
 *
 * ── A QUIÉN AFECTA ──────────────────────────────────────────────────────────
 * Un bloqueo CON `teamMemberId` solo tapa los huecos de esa persona: quien no
 * lleva seguimiento con ella sigue viendo la agenda entera, que es lo correcto
 * —el centro no cierra porque una nutricionista se vaya—. Un bloqueo SIN
 * `teamMemberId` tapa los de todo el mundo: la mudanza, la formación interna,
 * el puente que no estaba en el calendario.
 *
 * Restar puede PARTIR un tramo en dos: si el centro abre de 9 a 18 y alguien
 * se ausenta de 12 a 13, quedan dos huecos (9-12 y 13-18), no uno con un
 * agujero invisible dentro.
 */
import { Op } from "sequelize";
import { getMadridParts } from "./slots.js";

/** "HH:MM[:SS]" → minutos desde medianoche. `null` si no es una hora. */
function aMinutos(hora) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hora ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** minutos → "HH:MM", que es como se guardan las disponibilidades. */
function aHora(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Los minutos que un bloqueo ocupa DENTRO de un día concreto.
 *
 * Un bloqueo de dos semanas tapa el día entero de los días de en medio, medio
 * día el primero y medio el último. Devuelve `null` si no toca ese día.
 *
 * Se compara en hora de MADRID, que es la que ve el centro, con el mismo
 * `getMadridParts` que usa el resto del módulo. Guardar instantes y comparar en
 * local es justo lo que hace que el cambio de hora no descuadre nada.
 *
 * @param bloqueo  { startAt, endAt } — instantes (Date o ISO)
 */
export function minutosOcupados(bloqueo, { year, month, day }) {
  const desde = new Date(bloqueo.startAt);
  const hasta = new Date(bloqueo.endAt);
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) return null;
  if (hasta <= desde) return null;

  const p1 = getMadridParts(desde);
  const p2 = getMadridParts(hasta);
  const clave = year * 10000 + month * 100 + day;
  const cIni = p1.year * 10000 + p1.month * 100 + p1.day;
  const cFin = p2.year * 10000 + p2.month * 100 + p2.day;

  if (clave < cIni || clave > cFin) return null;

  // Empieza a medianoche salvo el primer día; acaba a las 24:00 salvo el último.
  const inicio = clave === cIni ? p1.hour * 60 + p1.minute : 0;
  const fin = clave === cFin ? p2.hour * 60 + p2.minute : 24 * 60;
  if (fin <= inicio) return null;
  return { inicio, fin };
}

/**
 * Resta de las disponibilidades los tramos bloqueados de ese día.
 *
 * @param disponibilidades tramos { startTime, endTime, ... } ya filtrados por día
 * @param bloqueos         filas de `team_blocks` que aplican a quien pregunta
 * @param fecha            { year, month, day }
 * @returns los tramos que quedan libres, ordenados por hora
 */
export function restarAusencias(disponibilidades, bloqueos, fecha) {
  const lista = disponibilidades ?? [];
  if (!bloqueos || bloqueos.length === 0) return lista;

  const ocupados = [];
  for (const b of bloqueos) {
    const tramo = minutosOcupados(b, fecha);
    if (tramo) ocupados.push(tramo);
  }
  if (ocupados.length === 0) return lista;

  const libres = [];
  for (const disp of lista) {
    const desde = aMinutos(disp.startTime);
    const hasta = aMinutos(disp.endTime);
    if (desde == null || hasta == null || hasta <= desde) continue;

    // Se arranca con el tramo entero y se le va quitando cada bloqueo. Cada
    // resta puede partir un trozo en dos, de ahí la lista.
    let trozos = [{ desde, hasta }];
    for (const oc of ocupados) {
      const siguiente = [];
      for (const t of trozos) {
        if (oc.fin <= t.desde || oc.inicio >= t.hasta) {
          siguiente.push(t); // no se tocan
          continue;
        }
        if (oc.inicio > t.desde) siguiente.push({ desde: t.desde, hasta: oc.inicio });
        if (oc.fin < t.hasta) siguiente.push({ desde: oc.fin, hasta: t.hasta });
        // Si el bloqueo cubre el trozo entero, no se añade nada: desaparece.
      }
      trozos = siguiente;
      if (trozos.length === 0) break;
    }

    for (const t of trozos) {
      libres.push({ ...disp, startTime: aHora(t.desde), endTime: aHora(t.hasta) });
    }
  }

  return libres.sort((a, b) => aMinutos(a.startTime) - aMinutos(b.startTime));
}

/**
 * Los bloqueos que aplican a quien pregunta, en un rango de fechas.
 *
 * Devuelve `[]` si el tenant no tiene la tabla (schema sin migrar): un centro
 * sin vacaciones configuradas tiene que seguir dando cita, no quedarse sin
 * agenda por una migración pendiente. Mismo criterio que `cargarFestivos`.
 *
 * @param profesionalId  a quién se le mira la agenda; `null` = solo los del centro
 */
export async function cargarAusencias(tenantModels, { desde, hasta, profesionalId = null } = {}) {
  const { TeamBlock } = tenantModels ?? {};
  if (!TeamBlock) return [];
  try {
    const where = {
      // Se solapa con el rango: empieza antes de que acabe y acaba después de
      // que empiece. Sin esto, un bloqueo de tres semanas que arranca el mes
      // anterior no saldría al pedir los días de este.
      startAt: { [Op.lt]: hasta },
      endAt: { [Op.gt]: desde },
    };
    // Los del centro (sin persona) aplican siempre; los de una persona, solo si
    // es la suya.
    where[Op.or] = profesionalId
      ? [{ teamMemberId: null }, { teamMemberId: profesionalId }]
      : [{ teamMemberId: null }];

    const filas = await TeamBlock.findAll({
      where,
      attributes: ["id", "teamMemberId", "startAt", "endAt", "label"],
      order: [["startAt", "ASC"]],
    });
    return filas.map((f) => f.toJSON());
  } catch {
    return [];
  }
}
