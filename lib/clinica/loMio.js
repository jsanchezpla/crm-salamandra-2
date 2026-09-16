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
 *
 * ── UN DÍA QUE EL CENTRO CERRÓ NO PIDE REGISTROS (16/09/2026, AV-0165) ──────
 * Raquel: «me aparece por registrar la sesión de Paula del lunes 14, cuando ese
 * día fue fiesta y por eso no hubo sesión». Y así era: el 14/09 estaba dado de
 * alta como «Festivo local» desde el 31/08, y el centro canceló 62 de sus 64
 * citas de golpe. La de Paula se creó DESPUÉS de esa limpieza, insistiendo
 * sobre el aviso de festivo que ya da el alta de citas, y se quedó viva.
 *
 * Así que la Bandeja reclamaba un registro de un día que el CRM sabía cerrado.
 * Con `diasCerrados` (las claves 'AAAA-MM-DD' de `blocked_days`) deja de
 * hacerlo… pero SOLO si la cita está `confirmed`, que es «aquí quedó puesta» y
 * nadie volvió a tocarla. Una `completed` se sigue pidiendo: alguien dijo
 * expresamente que esa sesión se dio, y un centro cerrado con una sesión dentro
 * —una urgencia, una recuperación— es raro pero posible, y ahí callar sería
 * perder trabajo de verdad en silencio.
 */
export function citaPideRegistro(cita, ahora = new Date(), { diasCerrados = null } = {}) {
  if (!cita?.patientId) return false;
  const estado = String(cita?.status ?? "");
  if (!["confirmed", "completed"].includes(estado)) return false;
  const t = new Date(cita?.scheduledAt ?? "");
  if (Number.isNaN(t.getTime())) return false;
  if (estado === "confirmed" && diasCerrados?.size) {
    const dia = diaDeMadrid(cita.scheduledAt);
    if (dia && diasCerrados.has(dia)) return false;
  }
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
export function registroDeLaCita(cita, sesiones = [], { citasQueExisten = null } = {}) {
  const lista = Array.isArray(sesiones) ? sesiones : [];
  // ── UN REGISTRO DE UNA CITA BORRADA NO ES «DE OTRA CITA» (15/09/2026, AV-0140)
  // Laura escribió el registro del 10/09 y después se borró la cita y se creó
  // otra igual: el registro se quedó apuntando a un id que ya no existe y la
  // Bandeja reclamaba la cita nueva. Con `citasQueExisten` (los ids vivos), un
  // enlace a una cita que no está se trata como si no tuviera cita y casa por
  // día. Sin el conjunto, se comporta como siempre.
  const deOtraCita = (s) => {
    const b = String(s?.bookingId ?? "").trim();
    if (!b) return false;
    return citasQueExisten ? citasQueExisten.has(b) : true;
  };
  const suyas = lista.filter((s) => String(s?.bookingId ?? "") === String(cita?.id ?? ""));
  if (suyas.length) return { sesion: masReciente(suyas), via: "cita" };

  const dia = diaDeMadrid(cita?.scheduledAt);
  if (!dia) return null;
  const candidatas = lista.filter((s) => {
    if (String(s?.patientId ?? "") !== String(cita?.patientId ?? "")) return false;
    // Una sesión que ya es de OTRA cita no cuenta como el registro de esta.
    if (deOtraCita(s)) return false;
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
export function citasSinRegistro(citas = [], sesiones = [], { ahora = new Date(), citasQueExisten = null, diasCerrados = null } = {}) {
  const sinEmpezar = [];
  const aMedias = [];
  for (const cita of Array.isArray(citas) ? citas : []) {
    if (!citaPideRegistro(cita, ahora, { diasCerrados })) continue;
    const hallado = registroDeLaCita(cita, sesiones, { citasQueExisten });
    if (!hallado) { sinEmpezar.push({ cita, sesion: null }); continue; }
    if (A_MEDIAS.has(String(hallado.sesion?.status ?? ""))) aMedias.push({ cita, sesion: hallado.sesion });
  }
  return { sinEmpezar, aMedias };
}
