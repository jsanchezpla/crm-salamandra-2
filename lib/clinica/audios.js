/**
 * lib/clinica/audios.js — VARIOS audios en un mismo registro, y los topes que
 * los reparten en tandas que caben por el tubo.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten la PANTALLA —que agrupa los
 * audios pendientes antes de subirlos— y los TRES endpoints que transcriben.
 * Con una copia en cada sitio, el tope del navegador y el del servidor se
 * separarían al primer retoque y la tanda que el cliente da por buena moriría
 * en el proxy.)
 *
 * ── DE QUÉ QUEJA NACE (Rodrigo, 04/09/2026) ────────────────────────────────
 * «Queremos subir más de un audio a la transcripción por audio antes de ponerlo
 * a transcribir.» Hasta hoy el registro admitía UN audio: el segundo sustituía
 * al primero y su transcripción se perdía. Quien graba la sesión en tres notas
 * de voz —lo normal cuando se dicta entre paciente y paciente, o cuando el
 * audio llega por WhatsApp partido— tenía que procesarlas de una en una y
 * pegar el texto a mano.
 *
 * ── POR QUÉ HAY TANDAS Y NO UNA PETICIÓN CON TODO ──────────────────────────
 * El nginx que hay delante del CRM corta los cuerpos a 30 MB. Un audio suelto
 * cabe siempre (OpenAI no acepta más de 25 MB), pero cinco no. Se agrupan en
 * tandas de `MAX_BYTES_POR_TANDA` y se mandan una detrás de otra; DENTRO de
 * cada tanda el servidor transcribe en paralelo, que es donde está el tiempo
 * ganado.
 */

/** El tope de la API de transcripción de OpenAI. Por audio, no por tanda. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * Cuántos audios admite un registro. Ocho da de sobra para una sesión dictada
 * a trozos y deja el gasto acotado: cada uno se paga por minuto transcrito.
 */
export const MAX_AUDIOS = 8;

/**
 * Lo que puede pesar UNA petición. Por debajo de los 30 MB del nginx del CRM,
 * con margen para las lindes del multipart y los campos que viajan al lado.
 */
export const MAX_BYTES_POR_TANDA = 20 * 1024 * 1024;

/** Cuántos audios se transcriben A LA VEZ dentro de una tanda. */
export const A_LA_VEZ = 4;

/**
 * Reparte ficheros en tandas que caben por el tubo: ni más de
 * `MAX_BYTES_POR_TANDA` ni más de `MAX_AUDIOS` por petición.
 *
 * Un fichero que él solo pasa del tope se va en su propia tanda: el que decide
 * si es demasiado grande es OpenAI (25 MB), no esta función, y partirlo aquí
 * sería adivinar.
 */
export function repartirEnTandas(ficheros, { maxBytes = MAX_BYTES_POR_TANDA, maxPorTanda = MAX_AUDIOS } = {}) {
  const tandas = [];
  let actual = [];
  let bytes = 0;
  for (const f of ficheros ?? []) {
    const peso = typeof f?.size === "number" ? f.size : 0;
    if (actual.length && (actual.length >= maxPorTanda || bytes + peso > maxBytes)) {
      tandas.push(actual);
      actual = [];
      bytes = 0;
    }
    actual.push(f);
    bytes += peso;
  }
  if (actual.length) tandas.push(actual);
  return tandas;
}

/**
 * El texto de varios audios, en el orden en que se subieron.
 *
 * Sin rótulos ni «— audio 2 —» por el medio: para quien lee el registro es UNA
 * sesión contada del tirón, y una marca de máquina dentro del material acabaría
 * copiada en un apartado. Los vacíos se caen: un audio mudo no aporta ni un
 * salto de línea.
 */
export function juntarTranscripciones(textos) {
  return (textos ?? [])
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * La duración total de lo transcrito. `null` si de ningún audio se supo —
 * distinguirlo de un cero importa: cero segundos es «no hubo audio» en la
 * ficha de la sesión.
 */
export function duracionTotal(duraciones) {
  const buenas = (duraciones ?? []).filter((d) => typeof d === "number" && Number.isFinite(d));
  return buenas.length ? buenas.reduce((a, b) => a + b, 0) : null;
}
