/**
 * lib/clinica/prepararSesion.js — dar de alta una sesión ANTES de darla.
 *
 * (Fichero nuevo en /lib, regla #2: el contrato de la URL lo escriben DOS
 * pantallas que no se conocen —el modal de una cita lo monta, la pantalla de
 * nueva sesión lo lee— y una cadena copiada a mano en dos ficheros se separa a
 * la primera. Igual que `lib/clients/volver.js`. Además, lo que se manda al
 * servidor para una sesión sin audio es justo lo que NO se puede equivocar, así
 * que se arma aquí y lo fija `scripts/_smoke-clinica-preparar.mjs`.)
 *
 * ── DE QUÉ QUEJA NACE (Aumenta, apuntada el 25/08/2026) ────────────────────
 * «Desde una cita no se puede preparar la sesión.» Y debajo había algo peor que
 * unos clics de más: **una sesión solo nacía subiendo un audio**, o sea que para
 * preparar una sesión había que haberla dado ya. El campo `prepText` existe
 * desde el sprint de julio y era inalcanzable justo en el momento en que sirve:
 * 22.045 sesiones registradas en Aumenta y CERO con preparación escrita.
 *
 * El servidor nunca fue el problema: `POST /api/clinica/sessions` ya tenía todos
 * los campos de audio como opcionales y ya aceptaba `prepText` en el alta. El
 * cerrojo estaba en la pantalla, que solo enseñaba la zona de soltar el fichero.
 *
 * ── UNA CITA, UN REGISTRO (01/09/2026, Rodrigo) ────────────────────────────
 * «Si estoy editando la sesión de una cita y salgo y entro, no me tiene que
 * generar una sesión nueva.» Las generaba: el enlace llevaba paciente y fecha,
 * y nada que dijera «esta sesión es la de ESTA cita». Desde hoy la cola lleva
 * también `cita=<id>`, la sesión guarda `bookingId`, y `sesionDeLaCita` (abajo)
 * decide si se continúa una que ya existe o se crea la primera.
 *
 * ⚠️ La sesión que se crea así nace en `draft` y **con la fecha de la cita, que
 * es futura**. Eso es nuevo en el CRM —hasta hoy no había una sola sesión con
 * fecha por delante en ningún cliente— y por eso las estadísticas del centro
 * cortan por hoy (`hastaHoy`, en `lib/clinica/estadisticas.js`): una sesión
 * preparada para el jueves no es una sesión dada.
 */

import { CLAVE_APARTADOS, CLAVE_PLANTILLA } from "./plantillas.js";

/** Margen de cordura para una fecha que llega por la barra de direcciones. */
const DOS_ANOS_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/** Los ids del CRM son UUID (ver los modelos): lo que no lo sea, no es un id. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lee una fecha que viene de fuera (la URL) y devuelve un Date o `null`.
 *
 * Se acota a propósito: el valor lo escribe quien quiera, y una sesión fechada
 * en el año 1300 o en el 3000 no la cazaría ningún listado — se quedaría en la
 * base sin que nadie la vuelva a ver. Ante la duda, `null`, y quien llama pone
 * la fecha de hoy.
 */
export function fechaDePreparacion(valor, ahora = new Date()) {
  if (valor instanceof Date) valor = valor.toISOString();
  const t = Date.parse(String(valor ?? "").trim());
  if (Number.isNaN(t)) return null;
  const centro =
    ahora instanceof Date && !Number.isNaN(ahora.getTime()) ? ahora.getTime() : Date.now();
  if (Math.abs(t - centro) > DOS_ANOS_MS) return null;
  return new Date(t);
}

/**
 * La cola que le cuelga el modal de una cita al enlace de preparar.
 *
 * Sin fecha válida se devuelve igualmente `?preparar=1`: el enlace tiene que
 * seguir llevando a la pantalla de preparar aunque la cita venga rara — la
 * pantalla pondrá hoy y quien escribe lo corrige, que es mucho mejor que un
 * enlace que no lleva a ninguna parte.
 *
 * ── Y DESDE EL 01/09/2026 LLEVA LA CITA (Rodrigo) ─────────────────────────
 * `cita=<id>` es lo que permite volver a la MISMA sesión en vez de abrir una
 * nueva. La fecha se queda porque sigue haciendo falta —es con la que nace el
 * registro cuando aún no existe—, pero ya no es lo que identifica la sesión:
 * se puede corregir a mano en el formulario, y dos citas seguidas del mismo
 * paciente caen el mismo día.
 *
 * ── Y EL PROFESIONAL DE LA CITA (01/09/2026, Rodrigo) ─────────────────────
 * «Si Isabel Vara es la terapeuta de un paciente pero la cita desde la que se
 * prepara la sesión está asignada a Silvia Hernández, el registro debe estar a
 * cargo de Silvia Hernández.» El registro nacía SIEMPRE firmado por el
 * terapeuta de referencia del paciente, así que cubrir una baja, un cambio de
 * turno o una segunda especialidad quedaba escrito a nombre de quien no la dio
 * — y en Aumenta la agenda ya reparte las citas por profesional.
 *
 * `prof=<id>` es solo la firma con la que NACE el registro: sigue siendo un
 * desplegable en la pantalla, y una sesión que ya existe conserva la suya (esta
 * cola no la pisa). Se cuelga únicamente si la cita tiene profesional: una sin
 * asignar no sabe nada mejor que la ficha del paciente.
 */
export function colaDePreparacion(
  scheduledAt,
  { bookingId = null, profesionalId = null, plantilla = null, ahora = new Date() } = {}
) {
  const fecha = fechaDePreparacion(scheduledAt, ahora);
  const q = new URLSearchParams({ preparar: "1" });
  if (fecha) q.set("fecha", fecha.toISOString());
  const cita = String(bookingId ?? "").trim();
  if (cita) q.set("cita", cita);
  const profesional = profesionalDePreparacion(profesionalId);
  if (profesional) q.set("prof", profesional);
  // Con qué PLANTILLA nace el registro (02/09/2026): la cita de valoración
  // inicial manda la de la entrevista; el resto no manda nada y la pantalla
  // usa la primera del centro, como siempre.
  const clave = plantillaDePreparacion(plantilla);
  if (clave) q.set("plantilla", clave);
  return `?${q.toString()}`;
}

/** La clave de plantilla que llega por la URL, o `""` si no tiene forma de clave. */
export function plantillaDePreparacion(valor) {
  const v = String(valor ?? "").trim();
  return /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(v) ? v : "";
}

/**
 * El profesional que llega por la URL, o `""`.
 *
 * Se acota como la fecha y por lo mismo: el valor lo escribe quien quiera en la
 * barra de direcciones, y aquí lo que se decide es la FIRMA de una nota clínica.
 * Con forma de id se pasa a la pantalla, que además lo contrasta con el equipo
 * del centro antes de ponerlo; sin ella, `""`, y firma el terapeuta del paciente
 * como toda la vida.
 */
export function profesionalDePreparacion(valor) {
  const v = String(valor ?? "").trim();
  return UUID_RE.test(v) ? v : "";
}

/** ¿La URL pide abrir directamente la preparación? */
export function pidePreparar(valor) {
  const v = String(valor ?? "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "si";
}

/**
 * El valor que entiende un `<input type="datetime-local">`, en hora LOCAL.
 *
 * `toISOString()` no vale aquí: devuelve UTC, y en España el input enseñaría la
 * cita de las 17:00 como las 15:00. El navegador manda de vuelta hora local, así
 * que la conversión es simétrica y no se pierde nada por el camino.
 */
export function paraInputLocal(fecha) {
  // `new Date(null)` NO es una fecha inválida: es el 1 de enero de 1970. Sin
  // este corte, un valor que falta se pinta como 1970 en el input y quien lo ve
  // cree que el CRM ha calculado algo, en vez de que no ha recibido nada.
  if (fecha == null || fecha === "") return "";
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * El cuerpo del `POST /api/clinica/sessions` para una sesión SIN audio.
 *
 * Lo que importa de esta función es lo que NO devuelve: ni `aiTranscription`, ni
 * `aiStructured`, ni `audioDurationSec`, ni `aiReviewedAt`. Una sesión preparada
 * no ha pasado por Whisper ni por Claude, y mandar esos campos vacíos la haría
 * parecer una sesión transcrita y revisada — el cajón de la ficha enseña
 * «Transcrito y estructurado por IA» en cuanto hay `aiReviewedAt`.
 *
 * Nace en `draft` («Borrador», gris en la ficha) porque eso es exactamente lo
 * que es: está apuntada, no dada. Al escribirla después de la sesión, el mismo
 * cajón la deja en su sitio.
 */
export function payloadDePreparacion({ patientId, therapistId, fecha, prepText, bookingId, plantilla = null, apartados = null } = {}) {
  if (!patientId) throw new Error("Falta el paciente");
  if (!therapistId) throw new Error("El paciente no tiene terapeuta asignado");
  const cuando = fecha instanceof Date && !Number.isNaN(fecha.getTime()) ? fecha : new Date();
  const cita = String(bookingId ?? "").trim();
  // La FOTO de la plantilla con la que nace el borrador (02/09/2026): sin
  // ella, un borrador preparado para una entrevista inicial se abriría después
  // con la plantilla de siempre. Solo si se pide: el resto sigue igual.
  const clave = plantillaDePreparacion(plantilla);
  const foto = clave
    ? { [CLAVE_PLANTILLA]: clave, [CLAVE_APARTADOS]: (Array.isArray(apartados) ? apartados : []).map((a) => ({ ...a })) }
    : null;
  return {
    patientId: String(patientId),
    therapistId: String(therapistId),
    sessionDate: cuando.toISOString(),
    objectives: [],
    observations: { familyComments: "", nextSessionNotes: "", homeworkTasks: "", incidents: "" },
    prepText: String(prepText ?? "").trim(),
    status: "draft",
    // De qué cita sale (01/09/2026). Se manda SOLO si hay: una sesión escrita
    // desde la ficha del paciente no nace de ninguna cita, y `bookingId: null`
    // en el cuerpo diría lo mismo pero obligaría al endpoint a distinguir «no
    // viene» de «viene vacío».
    ...(cita ? { bookingId: cita } : {}),
    ...(foto ? { contentSections: foto } : {}),
  };
}

/* ═══ Una cita, un registro ════════════════════════════════════════════════ */

/**
 * ¿Cuál de las sesiones de este paciente es LA de esta cita?
 *
 * ── DE QUÉ QUEJA NACE (Rodrigo, 01/09/2026) ────────────────────────────────
 * «Si estoy editando la sesión de una cita y salgo y entro, no me tiene que
 * generar una sesión nueva: tiene que seguir editando la misma hasta que le dé
 * a finalizar.» Antes de esto, cada vuelta al modal abría un formulario en
 * blanco y guardarlo creaba OTRA sesión del mismo día; la primera se quedaba
 * en la ficha con la preparación dentro y había que ir a buscarla a mano por la
 * pestaña de sesiones.
 *
 * Se busca por DOS caminos, y el orden importa:
 *
 *  1. **Por la cita** (`bookingId`), que es la respuesta correcta y la única
 *     que no se puede confundir. Es lo que se guarda desde hoy.
 *
 *  2. **Por paciente y hora exacta**, solo como ADOPCIÓN de lo ya escrito: las
 *     sesiones preparadas desde el 26/08 no pudieron guardar de qué cita eran,
 *     y son justo las que hoy se duplican. Quien llama adopta la que salga por
 *     aquí (le pone el `bookingId`), así que este camino se usa UNA vez por
 *     sesión y luego ya entra por el primero.
 *
 * El segundo camino exige la hora EXACTA de la cita a propósito. Casar por día
 * sería peor que no casar: un paciente con dos sesiones el mismo martes —dos
 * citas seguidas, o una sesión suelta escrita desde su ficha— se llevaría a
 * editar la equivocada, y encima escribiría encima de una nota clínica ya
 * firmada. Ante la duda, `null`, y se crea una sesión nueva: eso se ve y se
 * corrige; escribir en la sesión de otro día, no.
 *
 * Una sesión de TALLER nunca se adopta: su cuerpo lo escribe quien da el taller
 * y se copia a los asistentes (`tallerSesionId`), así que editarla desde la
 * cita de uno solo desharía el trabajo del grupo.
 *
 * @param {Array} sesiones  las del paciente, tal como las devuelve la API
 * @param {{ bookingId?: string, scheduledAt?: string|Date }} cita
 * @returns {{ sesion: object, via: "cita"|"fecha" }|null}
 */
export function sesionDeLaCita(sesiones, { bookingId = null, scheduledAt = null } = {}) {
  const lista = Array.isArray(sesiones) ? sesiones : [];
  const cita = String(bookingId ?? "").trim();
  // Sin cita no hay nada que continuar: se llega así desde «Nuevo registro» de
  // la ficha del paciente, y ahí lo correcto es empezar una sesión nueva. El
  // camino de abajo existe SOLO para adoptar una sesión A una cita, así que
  // sin cita ni se intenta — o una sesión suelta a la misma hora se abriría
  // sola, y quien venía a escribir una nueva escribiría encima de otra.
  if (!cita) return null;

  // Si hubiera más de una apuntada a la misma cita (adopción a mano, una
  // carrera entre dos pestañas), gana la más reciente: es la que se estaba
  // escribiendo. El índice no es único justo para que esto no sea un 500.
  const suyas = lista.filter((s) => String(s?.bookingId ?? "").trim() === cita);
  if (suyas.length) return { sesion: masReciente(suyas), via: "cita" };

  const t = scheduledAt ? Date.parse(scheduledAt instanceof Date ? scheduledAt.toISOString() : scheduledAt) : NaN;
  if (Number.isNaN(t)) return null;

  const candidatas = lista.filter((s) => {
    // Una sesión que ya es de OTRA cita no se toca: es de otra cita.
    if (String(s?.bookingId ?? "").trim()) return false;
    if (s?.tallerSesionId) return false;
    const st = Date.parse(s?.sessionDate ?? "");
    return !Number.isNaN(st) && st === t;
  });
  // Dos sesiones sueltas a la misma hora exacta es un empate que no se puede
  // deshacer sin adivinar: mejor una sesión nueva que escribir en la de otro.
  if (candidatas.length !== 1) return null;
  return { sesion: candidatas[0], via: "fecha" };
}

/** La última escrita, por si hay más de una candidata. */
function masReciente(sesiones) {
  return sesiones.reduce((mejor, s) => {
    const a = Date.parse(s?.updatedAt ?? s?.createdAt ?? s?.sessionDate ?? "");
    const b = Date.parse(mejor?.updatedAt ?? mejor?.createdAt ?? mejor?.sessionDate ?? "");
    if (Number.isNaN(a)) return mejor;
    if (Number.isNaN(b)) return s;
    return a > b ? s : mejor;
  });
}

/**
 * El final de un periodo de estadísticas, sin pasar de ahora.
 *
 * Vive aquí y no en `lib/clinica/estadisticas.js` porque existe POR esto: desde
 * hoy una sesión puede nacer con fecha FUTURA —la del jueves, preparada desde
 * una cita— y una sesión preparada no es una sesión dada. Sin este corte, la
 * actividad del centro contaría como trabajo hecho lo que aún no ha ocurrido, y
 * quien mira el panel no tendría manera de notarlo.
 *
 * Se corta por la FECHA y no por el estado a propósito: en las demos hay 39
 * sesiones en `draft` que sí se dieron —el sembrado las deja a medio escribir—,
 * así que lo que separa una preparada de una a medias no es la etiqueta, es que
 * todavía no ha pasado. El día que se escribió esto no había una sola sesión con
 * fecha por delante en ningún cliente: no mueve ningún número de hoy.
 */
export function hastaHoy(fin, ahora = new Date()) {
  const tope = ahora instanceof Date && !Number.isNaN(ahora.getTime()) ? ahora : new Date();
  // Mismo cuidado que arriba con `new Date(null)`: un final vacío tomado por
  // 1970 dejaría el recuento de sesiones en cero sin decir por qué.
  if (fin == null || fin === "") return tope;
  const d = fin instanceof Date ? fin : new Date(fin);
  if (Number.isNaN(d.getTime())) return tope;
  return d > tope ? tope : d;
}

/* ═══ «Próximas sesiones» → la preparación de la siguiente ═════════════════ */

/**
 * La clave del apartado «Próximas sesiones» del registro. NO se renombra nunca
 * (misma regla que el resto de apartados, `lib/clinica/plantillas.js`).
 */
export const CLAVE_PROXIMAS = "nextSessionNotes";

/**
 * ── EL ENCARGO (01/09/2026, Rodrigo) ────────────────────────────────────────
 * «Todo lo que sea Próximas sesiones se tiene que registrar automáticamente
 * como borrador para la siguiente preparación.»
 *
 * Y hasta hoy no iba a ninguna parte: se escribía al cerrar la sesión del
 * martes, se guardaba en `observations.nextSessionNotes`, y el jueves la
 * preparación abría EN BLANCO. Para recuperarlo había que salir del formulario,
 * abrir la sesión anterior en la ficha y copiar a mano. En Aumenta, con 22.064
 * sesiones, había ONCE con preparación escrita: no es que no lo usaran, es que
 * empezar de cero cada vez no lo hace nadie.
 *
 * ── LO QUE HACE Y LO QUE NO ─────────────────────────────────────────────────
 * Devuelve el texto que la profesional dejó apuntado para la próxima vez, para
 * que la pantalla lo escriba en el recuadro de Preparación. Y ya: **no crea
 * ninguna sesión y no guarda nada**. Se eligió así a propósito frente a la otra
 * forma posible —que al cerrar un registro el CRM diera de alta el borrador de
 * la siguiente cita—, porque eso llenaría la historia clínica de registros que
 * nadie ha abierto, y una nota clínica que aparece sola es peor que un recuadro
 * vacío. Aquí lo que aparece es una PROPUESTA en pantalla: si vale, se guarda
 * al guardar; si no, se borra y no ha pasado nada.
 *
 * ── LA SESIÓN ANTERIOR, NO LA ÚLTIMA ────────────────────────────────────────
 * Se busca la más reciente ANTES de esta, no la última de la lista. No es lo
 * mismo desde que una sesión puede nacer con fecha futura (se prepara la del
 * jueves el martes): sin el corte, preparar la del jueves se traería lo que se
 * apuntó… en la del viernes que ya estaba preparada. Y se excluye la propia,
 * que si no una sesión ya escrita se heredaría a sí misma.
 *
 * @param {Array} sesiones   las del paciente, como las devuelve la API
 * @param {{ antesDe: Date|string, excluirId?: string|null }} opciones
 * @returns {{ texto: string, sesion: object }|null}
 */
export function proximasSesionesPendientes(sesiones, { antesDe, excluirId = null } = {}) {
  const lista = Array.isArray(sesiones) ? sesiones : [];
  const tope = antesDe instanceof Date ? antesDe.getTime() : Date.parse(antesDe ?? "");
  if (Number.isNaN(tope)) return null;
  const fuera = String(excluirId ?? "").trim();

  let mejor = null;
  let mejorT = -Infinity;
  for (const s of lista) {
    if (!s || (fuera && String(s.id ?? "") === fuera)) continue;
    const t = Date.parse(s.sessionDate ?? "");
    if (Number.isNaN(t) || t >= tope) continue;
    const texto = proximasDe(s);
    if (!texto) continue;
    if (t > mejorT) {
      mejorT = t;
      mejor = { texto, sesion: s };
    }
  }
  return mejor;
}

/**
 * El texto de «Próximas sesiones» de una sesión, mire donde mire.
 *
 * Normalmente está en `observations` —es un apartado de fábrica y tiene columna
 * propia—, pero un centro que se monte su plantilla puede haberlo escrito en el
 * JSONB de apartados, y ahí también cuenta. Una lista se junta en líneas, que
 * es la convención de `aFormulario`.
 */
function proximasDe(sesion) {
  const obs =
    sesion?.observations && typeof sesion.observations === "object" && !Array.isArray(sesion.observations)
      ? sesion.observations
      : {};
  const cs =
    sesion?.contentSections && typeof sesion.contentSections === "object" && !Array.isArray(sesion.contentSections)
      ? sesion.contentSections
      : {};
  const bruto = obs[CLAVE_PROXIMAS] ?? cs[CLAVE_PROXIMAS];
  if (Array.isArray(bruto)) return bruto.map((x) => String(x ?? "").trim()).filter(Boolean).join("\n");
  return String(bruto ?? "").trim();
}
