/**
 * lib/citas/vistaAgenda.js — cómo se PINTA la agenda de un centro: qué días
 * enseña la semana y entre qué horas (02/09/2026, AV-0020 y AV-0012 de
 * Aumenta; decidido por Rodrigo el mismo día).
 *
 * (Fichero nuevo en /lib, regla #2: lo leen el endpoint que se lo cuenta al
 * calendario y Configuración, y las dos reglas tienen casos que hay que fijar
 * con prueba —el margen, el tope, el centro sin horario—.)
 *
 * ── DE QUÉ QUEJAS NACE ─────────────────────────────────────────────────────
 * «Quitar sábado y domingo de la vista semanal» (AV-0020): la agenda pintaba
 * siete columnas y el centro no abre fines de semana; con cinco, cada día es
 * un 40 % más ancho. Y «ver el horario entero de un vistazo sin subir y
 * bajar» (AV-0012, desde un iPad de 685 px de alto): la rejilla iba de 07:00
 * a 22:00 con franjas de alto fijo, así que en esa pantalla no cabía ni media
 * jornada.
 *
 * ── LAS DOS REGLAS ─────────────────────────────────────────────────────────
 *  1. La SEMANA LABORAL es un ajuste POR CENTRO (`settings.citas.semanaLaboral`:
 *     «lv» = de lunes a viernes; cualquier otra cosa = la semana entera). Por
 *     centro y no global a propósito: hay centros que sí abren los sábados.
 *  2. Las HORAS salen del horario de apertura que el centro ya tiene puesto en
 *     Citas → Disponibilidad: de la franja más temprana a la más tardía, con
 *     media hora de margen a cada lado, redondeado a la media hora. Un centro
 *     sin horario puesto sigue viendo la rejilla de siempre (07:00–21:00).
 *
 *     ⚠️ Y SIEMPRE con las horas REALES de sus citas dentro (02/09/2026, tarde,
 *     cazado en la demo): FullCalendar no pinta lo que cae fuera de la rejilla,
 *     así que un centro con el horario de apertura a medias —la demo tiene
 *     franjas solo de mañana y citas a las 18:15— dejaba de VER la mitad de
 *     sus citas, sin ningún aviso. Por eso `vistaDe` recibe también la cita
 *     más temprana y la más tardía de los alrededores (la ruta las saca de
 *     `bookings`), y la rejilla es la unión de las dos cosas. Un centro sin
 *     horario pero con citas (Aumenta) se acota por sus citas.
 */

const SEMANA_LV = "lv";
const SEMANA_COMPLETA = "completa";
const VALORES = new Set([SEMANA_LV, SEMANA_COMPLETA]);

/** La semana laboral del centro, saneada: «lv» o «completa». */
export function semanaLaboralDe(tenant) {
  const v = String(tenant?.settings?.citas?.semanaLaboral ?? "").trim().toLowerCase();
  return VALORES.has(v) ? v : SEMANA_COMPLETA;
}

/** ¿Es un valor válido para guardar? */
export function esSemanaValida(v) {
  return VALORES.has(String(v ?? "").trim().toLowerCase());
}

/**
 * Los días que FullCalendar tiene que esconder (`hiddenDays`: 0 = domingo,
 * 6 = sábado). La semana completa no esconde ninguno.
 */
export function diasOcultos(semanaLaboral) {
  return semanaLaboral === SEMANA_LV ? [0, 6] : [];
}

// De 7 a 21 (03/09/2026, Aumenta): la rejilla «de siempre» cerraba a las 22
// y se pidió que por defecto enseñe de 7 a 21. Lo que caiga fuera se sigue
// viendo: el calendario grande pinta las 24 horas y arranca el desplazamiento
// aquí (CitasModule, `scrollTime`); este rango es el que se AJUSTA a la
// pantalla en la vista compacta y el que usan las columnas por terapeuta.
const HORA_MIN_DEFECTO = "07:00";
const HORA_MAX_DEFECTO = "21:00";

/** «HH:MM» (o «HH:MM:SS») → minutos desde medianoche, o null si no es una hora. */
export function aMinutos(hhmm) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

/** minutos → «HH:MM:SS», que es lo que pide FullCalendar; tope 24:00:00. */
export function aHoraFc(min) {
  const m = Math.max(0, Math.min(24 * 60, Math.round(min)));
  const h = Math.floor(m / 60);
  const mi = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00`;
}

/**
 * Entre qué horas se pinta la rejilla, a partir de las franjas de apertura del
 * centro (`[{ startTime, endTime }]`, las filas de `availability`).
 *
 *   · de la franja más temprana a la más tardía;
 *   · media hora de margen a cada lado (una cita puede empezar justo al abrir
 *     y hay que ver el borde), redondeado hacia fuera a la media hora;
 *   · nunca antes de las 00:00 ni después de las 24:00;
 *   · sin franjas, o con basura, la rejilla de siempre.
 */
export function horasDeApertura(franjas, { margenMin = 30 } = {}) {
  const inicios = [];
  const finales = [];
  for (const f of Array.isArray(franjas) ? franjas : []) {
    const a = aMinutos(f?.startTime);
    const b = aMinutos(f?.endTime);
    if (a == null || b == null || b <= a) continue;
    inicios.push(a);
    finales.push(b);
  }
  if (!inicios.length) {
    return { slotMinTime: `${HORA_MIN_DEFECTO}:00`, slotMaxTime: `${HORA_MAX_DEFECTO}:00`, desdeHorario: false };
  }
  const paso = 30;
  const desde = Math.floor((Math.min(...inicios) - margenMin) / paso) * paso;
  const hasta = Math.ceil((Math.max(...finales) + margenMin) / paso) * paso;
  return { slotMinTime: aHoraFc(desde), slotMaxTime: aHoraFc(hasta), desdeHorario: true };
}

/**
 * Lo que el calendario necesita saber de este centro, en una sola respuesta.
 * Es lo que devuelve `GET /api/citas/vista`.
 */
export function vistaDe(tenant, franjas, { citas = null } = {}) {
  const semanaLaboral = semanaLaboralDe(tenant);
  // La cita más temprana y la más tardía entran como una franja más: si caen
  // fuera del horario de apertura, la rejilla se abre hasta ellas.
  const deCitas = citas && aMinutos(citas.desde) != null && aMinutos(citas.hasta) != null && aMinutos(citas.hasta) > aMinutos(citas.desde)
    ? [{ startTime: citas.desde, endTime: citas.hasta }]
    : [];
  // Y si hay citas EN FIN DE SEMANA, el fin de semana no se esconde aunque el
  // ajuste diga lunes a viernes: un día escondido no se puede ni abrir ni
  // navegar, y una cita ahí desaparecería sin aviso (revisión 02/09/2026).
  const finDeSemanaConCitas = Boolean(citas?.finDeSemana);
  return {
    semanaLaboral,
    hiddenDays: finDeSemanaConCitas ? [] : diasOcultos(semanaLaboral),
    finDeSemanaConCitas,
    ...horasDeApertura([...(Array.isArray(franjas) ? franjas : []), ...deCitas]),
  };
}
