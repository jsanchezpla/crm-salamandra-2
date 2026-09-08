/**
 * lib/clinica/loMio.js — qué le queda a una profesional de esta semana
 * (09/09/2026, AV-0078 de Aumenta).
 *
 * ── DE QUÉ QUEJA REAL NACE ─────────────────────────────────────────────────
 * Araceli: «no nos salen lo que deberíamos ir haciendo a la semana: registros,
 * informes, planes de intervención… Especialmente las personas que revisamos el
 * trabajo de las compis (Daniela y Araceli), estaría guay que pudiéramos ver
 * todas estas estadísticas, con el fin de poder dar el feedback a las compis».
 *
 * Son DOS cosas, y la primera es de todas y no solo de quien coordina: la lista
 * de lo pendiente no existía. Había que ir mirando paciente por paciente.
 *
 * (El permiso, en cambio, ya estaba resuelto desde el 02/09/2026 y nadie se
 * había enterado: `lib/clinica/coordinadoras.js` + `settings.clinica.
 * coordinadoras`, que en producción ya lleva a las dos coordinadoras. Lo que
 * hacía parecer que no funcionaba es que la Bandeja salía casi vacía.)
 *
 * ── EL REGISTRO SIN ESCRIBIR: POR QUÉ NO BASTA `bookingId` ─────────────────
 * Una sesión clínica guarda de qué cita es (`bookingId`) desde el 01/09/2026, y
 * antes de eso no podía. En Aumenta solo **231 de 23.342** sesiones lo tienen,
 * así que preguntar solo por ahí daría por «sin escribir» un montón de citas
 * cuyo registro está escrito y bien.
 *
 * Medido en producción el 09/09/2026, ventana de 7 días: 274 citas pasadas con
 * paciente; con la regla de solo `bookingId` salen **82** sin registro, y con
 * las dos reglas **36**. Más del doble de falsos. Y una lista de tareas que
 * reclama cosas ya hechas se deja de mirar a la segunda semana.
 *
 * Por eso el segundo camino: una sesión suelta del MISMO paciente el MISMO día,
 * y de la misma profesional (o sin firmar). La duda cae del lado de NO dar la
 * lata a quien ya escribió su registro.
 *
 * ⚠️ NO se reutiliza `sesionDeLaCita` de `prepararSesion.js`, y no por descuido:
 * aquella contesta a otra pregunta —«¿en qué nota clínica voy a ESCRIBIR?»— y
 * ahí la duda tiene que caer al revés, creando una sesión nueva, porque
 * escribir encima de una nota firmada por otra es peor que duplicar. Son dos
 * preguntas distintas sobre los mismos datos, y mezclarlas haría que arreglar
 * una estropeara la otra.
 *
 * Puro: sin base de datos y sin fetch. Prueba en `scripts/_smoke-lo-mio.mjs`.
 */

/** El día de Madrid de un instante, como 'AAAA-MM-DD'. */
export function diaDeMadrid(valor) {
  const t = valor instanceof Date ? valor : new Date(String(valor ?? ""));
  if (Number.isNaN(t.getTime())) return null;
  // `sv-SE` da 'AAAA-MM-DD' sin tener que recomponer nada a mano.
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(t);
}

/**
 * La ventana de «esta semana»: los últimos `dias` días contando hoy.
 *
 * Hacia atrás y no hacia delante a propósito: lo que falta por escribir es de
 * las citas que YA han pasado. Una cita del jueves no se reclama el martes.
 */
export function ventanaDeLaSemana(ahora = new Date(), { dias = 7 } = {}) {
  const fin = ahora instanceof Date ? new Date(ahora.getTime()) : new Date(ahora);
  if (Number.isNaN(fin.getTime())) return null;
  const inicio = new Date(fin.getTime() - Math.max(1, dias) * 24 * 60 * 60 * 1000);
  return { desde: inicio, hasta: fin, desdeDia: diaDeMadrid(inicio), hastaDia: diaDeMadrid(fin) };
}

/**
 * ¿Esta cita pide un registro de sesión?
 *
 * Solo las que ya han pasado, tienen paciente y de verdad se dieron. Una falta
 * (`no_show`) o una cita anulada NO piden registro: reclamarlas sería trabajo
 * inventado, y en un centro con 12.000 citas al trimestre eso ahoga la lista.
 */
export function citaPideRegistro(cita, ahora = new Date()) {
  if (!cita?.patientId) return false;
  if (!["confirmed", "completed"].includes(String(cita?.status ?? ""))) return false;
  const t = new Date(cita?.scheduledAt ?? "");
  if (Number.isNaN(t.getTime())) return false;
  return t.getTime() <= (ahora instanceof Date ? ahora : new Date(ahora)).getTime();
}

/** La más reciente de varias sesiones candidatas. */
function masReciente(sesiones) {
  return sesiones.reduce((mejor, s) => {
    const a = Date.parse(s?.updatedAt ?? s?.createdAt ?? s?.sessionDate ?? "");
    const b = Date.parse(mejor?.updatedAt ?? mejor?.createdAt ?? mejor?.sessionDate ?? "");
    if (Number.isNaN(a)) return mejor;
    if (Number.isNaN(b)) return s;
    return a > b ? s : mejor;
  }, sesiones[0]);
}

/**
 * ¿Está escrito el registro de esta cita? Por los dos caminos, en orden.
 *
 * @returns {{ sesion: object, via: "cita"|"dia" }|null}
 */
export function registroDeLaCita(cita, sesiones = []) {
  const lista = Array.isArray(sesiones) ? sesiones : [];
  const suyas = lista.filter((s) => String(s?.bookingId ?? "") === String(cita?.id ?? ""));
  if (suyas.length) return { sesion: masReciente(suyas), via: "cita" };

  const dia = diaDeMadrid(cita?.scheduledAt);
  if (!dia) return null;
  const candidatas = lista.filter((s) => {
    if (String(s?.patientId ?? "") !== String(cita?.patientId ?? "")) return false;
    // Una sesión que ya es de OTRA cita no cuenta como el registro de esta.
    if (String(s?.bookingId ?? "").trim()) return false;
    // El taller lo escribe quien lo da y se copia a los asistentes: esa sesión
    // no es «el registro que le falta a esta terapeuta».
    if (s?.tallerSesionId) return false;
    // De la misma profesional, o sin firmar (los 4.297 registros importados).
    const suya = String(s?.therapistId ?? "");
    if (suya && String(cita?.teamMemberId ?? "") && suya !== String(cita.teamMemberId)) return false;
    return diaDeMadrid(s?.sessionDate) === dia;
  });
  if (!candidatas.length) return null;
  return { sesion: masReciente(candidatas), via: "dia" };
}

/** Los estados en los que un registro existe pero todavía no está escrito del todo. */
const A_MEDIAS = new Set(["draft", "ai_pending"]);

/**
 * Las citas de la ventana que no tienen registro, y las que lo tienen a medias.
 *
 * @returns {{ sinEmpezar: Array, aMedias: Array }} cada elemento
 *   `{ cita, sesion }` — `sesion` es null en las sin empezar.
 */
export function citasSinRegistro(citas = [], sesiones = [], { ahora = new Date() } = {}) {
  const sinEmpezar = [];
  const aMedias = [];
  for (const cita of Array.isArray(citas) ? citas : []) {
    if (!citaPideRegistro(cita, ahora)) continue;
    const hallado = registroDeLaCita(cita, sesiones);
    if (!hallado) { sinEmpezar.push({ cita, sesion: null }); continue; }
    if (A_MEDIAS.has(String(hallado.sesion?.status ?? ""))) aMedias.push({ cita, sesion: hallado.sesion });
  }
  return { sinEmpezar, aMedias };
}
