/**
 * Helpers de generación de slots para la landing pública del módulo Citas.
 *
 * Toda la lógica trabaja en zona horaria Europe/Madrid:
 *   - Las `Availability` se almacenan como TIME sin TZ y se interpretan como
 *     horas locales de Madrid.
 *   - Los `scheduledAt` (TIMESTAMPTZ) se convierten a componentes locales
 *     Madrid para comparar con la disponibilidad.
 *
 * Implementación pura con `Intl.DateTimeFormat` para evitar dependencias.
 */

import { esFestivo } from "./festivos.js";

const MADRID_TZ = "Europe/Madrid";

const _madridPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MADRID_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const _madridWeekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MADRID_TZ,
  weekday: "long",
});

const WEEKDAY_TO_JS = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

/**
 * Día de la semana (0=domingo .. 6=sábado, convención JS getDay) en Madrid.
 */
export function getMadridDayOfWeek(date) {
  const weekday = _madridWeekdayFormatter.format(date);
  return WEEKDAY_TO_JS[weekday];
}

/**
 * Componentes locales de Madrid: { year, month, day, hour, minute, second }.
 */
export function getMadridParts(date) {
  const parts = _madridPartsFormatter.formatToParts(date);
  const out = {};
  for (const p of parts) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
  };
}

/**
 * Construye un Date UTC que, expresado en Europe/Madrid, da YYYY-MM-DD HH:MM:00.
 *
 * Usa fixed-point con `Intl.DateTimeFormat` para resolver el offset real de
 * Madrid (verano +02:00 vs invierno +01:00) en la fecha solicitada.
 */
export function buildMadridDate(year, month, day, hour, minute) {
  // Primera aproximación: tratamos los componentes como si fueran UTC.
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  // Calculamos qué offset (minutos) tiene Madrid en ese instante.
  const offsetMin = _madridOffsetMinutesAt(new Date(utcGuess));
  // Ajustamos: la hora real UTC es la "local Madrid" menos el offset.
  return new Date(utcGuess - offsetMin * 60 * 1000);
}

function _madridOffsetMinutesAt(date) {
  const { year, month, day, hour, minute, second } = getMadridParts(date);
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return Math.round((asIfUtc - date.getTime()) / 60000);
}

/**
 * Devuelve el offset ISO ("+02:00" o "+01:00") de Madrid en el instante dado.
 */
export function madridOffsetString(date) {
  const minutes = _madridOffsetMinutesAt(date);
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, "0");
  const m = String(abs % 60).padStart(2, "0");
  return `${sign}${h}:${m}`;
}

/**
 * Devuelve "HH:MM" en hora local Madrid del Date dado.
 */
export function formatMadridTime(date) {
  const { hour, minute } = getMadridParts(date);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Convierte "HH:MM" o "HH:MM:SS" a minutos desde medianoche.
 */
export function timeStrToMinutes(value) {
  if (!value) return null;
  const parts = String(value).split(":");
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Parsea "YYYY-MM-DD" a { year, month, day }. Devuelve null si formato inválido.
 */
export function parseISODate(value) {
  if (!value || typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * Filtra las Availability aplicables a un EventType para un día de semana:
 *   - Primero busca las específicas (eventTypeId === eventType.id).
 *   - Si no hay, usa las globales (eventTypeId === null).
 */
export function pickAvailabilitiesForEventType(availabilities, eventTypeId, dayOfWeek) {
  const specific = availabilities.filter(
    (a) => a.eventTypeId === eventTypeId && a.dayOfWeek === dayOfWeek
  );
  if (specific.length > 0) return specific;
  return availabilities.filter((a) => a.eventTypeId === null && a.dayOfWeek === dayOfWeek);
}

/**
 * Genera los slots para una fecha concreta dado el EventType y sus
 * disponibilidades del día. Excluye los que solapan con bookings activos.
 *
 * @returns Array<{ time: "HH:MM", datetime: ISO string with Madrid offset }>
 */
/**
 * Los descansos se RESTAN del tiempo de la cita, no se suman por fuera
 * (07/08/2026, Rodrigo).
 *
 * «Se pone que la cita dure 60 minutos. Si en el tiempo previo se ponen 10, las
 * citas empezarán a las 5:10, 6:10, 7:10. Si es en el posterior, durarán hasta
 * y 50. El tiempo se resta del horario total de la cita, ya sea antes o después.»
 *
 * ── QUÉ CAMBIA ──────────────────────────────────────────────────────────────
 * Antes los buffers no hacían NADA al generar los huecos: el grid iba de
 * `duration` en `duration` y la cita ocupaba los 60 minutos enteros, así que
 * poner un descanso no se notaba en ninguna parte.
 *
 * Ahora el BLOQUE sigue durando `duration` —los huecos caen igual de espaciados,
 * cada 60 minutos— pero dentro del bloque el descanso no es tiempo de consulta:
 *
 *     duración 60, previo 10           bloque 5:00-6:00 → cita 5:10-6:00 (50')
 *     duración 60, posterior 10        bloque 5:00-6:00 → cita 5:00-5:50 (50')
 *     duración 60, previo 10, post 10  bloque 5:00-6:00 → cita 5:10-5:50 (40')
 *
 * Es lo contrario de sumarlos por fuera, que alargaría el bloque a 70 u 80 y
 * descuadraría la agenda entera: quien pone «60 minutos» quiere que la siguiente
 * empiece 60 minutos después.
 *
 * ── POR QUÉ AQUÍ ────────────────────────────────────────────────────────────
 * Lo comparten el generador de huecos, la comprobación del mes, el POST de la
 * reserva pública y el alta manual. Si cada uno hiciera su cuenta, el widget
 * ofrecería las 5:10 y el servidor la rechazaría por no caer en su rejilla.
 */

/** Minutos que se descuentan por delante. Nunca deja el bloque sin tiempo útil. */
export function desfaseDeInicio(eventType) {
  const antes = Math.max(0, Number(eventType?.bufferBefore) || 0);
  const despues = Math.max(0, Number(eventType?.bufferAfter) || 0);
  const total = Number(eventType?.duration) || 0;
  // Si los descansos se comen el bloque entero, se ignoran: una cita de 0
  // minutos no es una cita, y dejar la agenda vacía por un dato mal metido es
  // peor que ignorarlo. Se corrige en la pantalla de tipos de cita.
  if (antes + despues >= total) return 0;
  return antes;
}

/** Lo que dura la CITA de verdad, ya descontados los descansos. */
export function duracionDeContacto(eventType) {
  const total = Number(eventType?.duration) || 0;
  const antes = Math.max(0, Number(eventType?.bufferBefore) || 0);
  const despues = Math.max(0, Number(eventType?.bufferAfter) || 0);
  if (antes + despues >= total) return total;
  return total - antes - despues;
}

export function generateSlotsForDay({
  eventType,
  availabilities,
  date, // { year, month, day }
  existingBookings, // array de Booking con scheduledAt (Date) y duration (int)
  now = new Date(),
  blockedDates = null, // Set de "YYYY-MM-DD" (lib/citas/festivos.js)
}) {
  // Día bloqueado del centro (festivo, cierre por formación…): no hay huecos,
  // se mire el tipo de cita que se mire. La comprobación va AQUÍ y no en cada
  // llamador para que no se pueda olvidar en uno de ellos.
  if (esFestivo(blockedDates, date)) return [];

  const duration = eventType.duration;
  const minNoticeMs = (eventType.minNoticeHours ?? 0) * 60 * 60 * 1000;
  const noticeBoundary = new Date(now.getTime() + minNoticeMs);

  const slots = [];
  for (const av of availabilities) {
    const startMin = timeStrToMinutes(av.startTime);
    const endMin = timeStrToMinutes(av.endTime);
    if (startMin == null || endMin == null) continue;

    /*
     * El BLOQUE avanza de `duration` en `duration` —los huecos siguen cayendo
     * cada 60 minutos— pero la cita empieza `desfase` más tarde y dura menos:
     * los descansos se restan por dentro (ver la cabecera de este fichero).
     */
    const desfase = desfaseDeInicio(eventType);
    const contacto = duracionDeContacto(eventType);
    for (let m = startMin; m + duration <= endMin; m += duration) {
      const inicio = m + desfase;
      const hour = Math.floor(inicio / 60);
      const minute = inicio % 60;
      const slotStart = buildMadridDate(date.year, date.month, date.day, hour, minute);
      const slotEnd = new Date(slotStart.getTime() + contacto * 60 * 1000);

      // Excluir slots que no respeten la antelación mínima
      if (slotStart < noticeBoundary) continue;

      // Excluir slots que solapen con un booking activo (cualquier EventType
      // del tenant — el calendario es único)
      let overlaps = false;
      for (const b of existingBookings) {
        const bStart = new Date(b.scheduledAt);
        const bEnd = new Date(bStart.getTime() + b.duration * 60 * 1000);
        if (bStart < slotEnd && bEnd > slotStart) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      slots.push({
        time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        datetime: slotStart.toISOString(),
      });
    }
  }

  // Ordenar por hora ascendente y deduplicar (por si dos bloques producen el
  // mismo slot en el límite)
  const seen = new Set();
  const out = [];
  for (const s of slots.sort((a, b) => a.time.localeCompare(b.time))) {
    if (seen.has(s.time)) continue;
    seen.add(s.time);
    out.push(s);
  }
  return out;
}

/**
 * Versión más eficiente para el endpoint /availability/month: solo comprueba
 * si HAY algún slot disponible ese día, sin generarlos todos.
 */
export function dayHasAnySlot({ eventType, availabilities, date, existingBookings, now = new Date(), blockedDates = null }) {
  if (esFestivo(blockedDates, date)) return false;

  const duration = eventType.duration;
  const minNoticeMs = (eventType.minNoticeHours ?? 0) * 60 * 60 * 1000;
  const noticeBoundary = new Date(now.getTime() + minNoticeMs);

  for (const av of availabilities) {
    const startMin = timeStrToMinutes(av.startTime);
    const endMin = timeStrToMinutes(av.endTime);
    if (startMin == null || endMin == null) continue;

    // Mismo cálculo que `generateSlotsForDay`: si aquí no se restaran los
    // descansos, el mes marcaría en verde un día cuyos huecos no existen.
    const desfase = desfaseDeInicio(eventType);
    const contacto = duracionDeContacto(eventType);
    for (let m = startMin; m + duration <= endMin; m += duration) {
      const inicio = m + desfase;
      const hour = Math.floor(inicio / 60);
      const minute = inicio % 60;
      const slotStart = buildMadridDate(date.year, date.month, date.day, hour, minute);
      const slotEnd = new Date(slotStart.getTime() + contacto * 60 * 1000);

      if (slotStart < noticeBoundary) continue;

      let overlaps = false;
      for (const b of existingBookings) {
        const bStart = new Date(b.scheduledAt);
        const bEnd = new Date(bStart.getTime() + b.duration * 60 * 1000);
        if (bStart < slotEnd && bEnd > slotStart) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) return true;
    }
  }
  return false;
}

/**
 * Devuelve un Date que corresponde a las 00:00 del día actual en Madrid.
 */
export function getMadridTodayMidnight(now = new Date()) {
  const { year, month, day } = getMadridParts(now);
  return buildMadridDate(year, month, day, 0, 0);
}

/**
 * Convierte un Date a string ISO con offset Madrid:
 *   2026-05-30T09:00:00+02:00
 */
export function toMadridISOString(date) {
  const { year, month, day, hour, minute, second } = getMadridParts(date);
  const offset = madridOffsetString(date);
  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const HH = String(hour).padStart(2, "0");
  const MM = String(minute).padStart(2, "0");
  const SS = String(second).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}${offset}`;
}

export const MADRID_TIMEZONE = MADRID_TZ;
