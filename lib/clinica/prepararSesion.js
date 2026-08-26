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
 * ⚠️ La sesión que se crea así nace en `draft` y **con la fecha de la cita, que
 * es futura**. Eso es nuevo en el CRM —hasta hoy no había una sola sesión con
 * fecha por delante en ningún cliente— y por eso las estadísticas del centro
 * cortan por hoy (`hastaHoy`, en `lib/clinica/estadisticas.js`): una sesión
 * preparada para el jueves no es una sesión dada.
 */

/** Margen de cordura para una fecha que llega por la barra de direcciones. */
const DOS_ANOS_MS = 2 * 365 * 24 * 60 * 60 * 1000;

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
 */
export function colaDePreparacion(scheduledAt, ahora = new Date()) {
  const fecha = fechaDePreparacion(scheduledAt, ahora);
  return fecha ? `?preparar=1&fecha=${encodeURIComponent(fecha.toISOString())}` : "?preparar=1";
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
export function payloadDePreparacion({ patientId, therapistId, fecha, prepText } = {}) {
  if (!patientId) throw new Error("Falta el paciente");
  if (!therapistId) throw new Error("El paciente no tiene terapeuta asignado");
  const cuando = fecha instanceof Date && !Number.isNaN(fecha.getTime()) ? fecha : new Date();
  return {
    patientId: String(patientId),
    therapistId: String(therapistId),
    sessionDate: cuando.toISOString(),
    objectives: [],
    observations: { familyComments: "", nextSessionNotes: "", homeworkTasks: "", incidents: "" },
    prepText: String(prepText ?? "").trim(),
    status: "draft",
  };
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
