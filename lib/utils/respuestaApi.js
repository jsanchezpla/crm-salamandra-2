/**
 * lib/utils/respuestaApi.js — leer la respuesta de una llamada al API sin que
 * un HTML por medio acabe escrito en pantalla.
 *
 * (Fichero en /lib, regla #2. El motivo: quien contesta no siempre es el CRM.
 * Delante hay un nginx, y cuando el que responde es él —porque la app está
 * levantándose, porque el archivo pasa de su tope, porque se agotó el tiempo—
 * lo que llega es su página de error en HTML. El `await res.json()` de las
 * pantallas de subida revienta ahí con un SyntaxError, y como todas acaban en
 * `catch (e) { setError(e.message) }`, lo que el usuario lee es el mensaje del
 * parser de JavaScript.)
 *
 * ── DE DÓNDE SALE (04/09/2026, Aumenta) ─────────────────────────────────────
 *
 * Isa subió un PDF de 24,2 MB a la ficha de un paciente y le salió por pantalla
 * «Unexpected token '<', "<html> <h"... is not valid JSON».
 *
 * No era el tamaño: el tope por archivo son 25 MB y nginx deja pasar 40. El
 * contenedor estaba reiniciándose por un despliegue y tardó TRES SEGUNDOS en
 * levantarse — justo los que duró la subida. El 502 de nginx llegó en HTML y la
 * pantalla lo enseñó tal cual. Nadie podía adivinar de ahí que bastaba con
 * volver a intentarlo.
 *
 * El archivo grande de verdad se veía igual de mal, y ese caso es peor porque
 * no se arregla reintentando: si pasa del `client_max_body_size`, nginx corta
 * la petición antes de que llegue al CRM, así que el 413 con el mensaje bueno
 * («Archivo demasiado grande. Máximo: 25 MB») no se llega a enviar nunca.
 *
 * No era la primera vez. El Buzón ya se había topado con ello en agosto (Jorge,
 * 13/08/2026, adjuntando un PNG) y se curó por su cuenta, con esta misma
 * función escrita dentro de `modules/buzon/AyudaModule.jsx`. Ahí se quedó, y
 * las otras veintitantas pantallas que suben archivos siguieron con el
 * `res.json()` a pelo hasta que le tocó a Documentos. Por eso está aquí y no
 * allí.
 *
 * ── LO QUE ESTE FICHERO NO ARREGLA ──────────────────────────────────────────
 *
 * El corte de tres segundos sigue estando: esto no hace el despliegue sin
 * parada, solo cuenta lo que pasa en un idioma que se entiende.
 */

/**
 * Qué se le dice al usuario cuando la respuesta no venía del CRM.
 *
 * @param {number} status código HTTP de la respuesta.
 * @param {{ siGrande?: string }} [opciones] mensaje propio para el 413. Cada
 *   pantalla conoce su límite y cuántos archivos admite, y lo explica mejor que
 *   una frase genérica.
 */
export function mensajeDeRespuestaNoJson(status, opciones = {}) {
  if (status === 413) {
    return opciones.siGrande || "El archivo pesa demasiado para subirlo. Prueba con uno más ligero.";
  }
  if (status === 504) {
    return "El servidor ha tardado demasiado en responder. Vuelve a intentarlo.";
  }
  if (status === 502 || status === 503) {
    // Es el caso de Aumenta: casi siempre son los segundos de un despliegue.
    return "El CRM no responde ahora mismo. Suele ser una actualización y dura unos segundos: espera un poco y vuelve a intentarlo.";
  }
  if (status === 401 || status === 403) {
    return "Tu sesión ha caducado. Vuelve a entrar y repite la operación.";
  }
  if (status < 400) {
    return "El CRM ha respondido algo que no se entiende. Vuelve a intentarlo.";
  }
  return `No se ha podido completar (error ${status}). Vuelve a intentarlo.`;
}

/**
 * Lee la respuesta y devuelve SIEMPRE el objeto `{ ok, data, error }` con el
 * que habla el CRM, aunque el cuerpo no fuera JSON.
 *
 * Devolver esa misma forma es lo que permite meterlo en las pantallas que ya
 * existen sin tocarles la lógica: las que miran `res.ok`, las que miran `j.ok` y
 * las que leen `j.error` siguen funcionando igual, solo que ahora el error que
 * encuentran está escrito en castellano.
 *
 * @param {Response} res respuesta de `fetch`.
 * @param {{ siGrande?: string }} [opciones] ver `mensajeDeRespuestaNoJson`.
 */
export async function leerRespuestaApi(res, opciones = {}) {
  let texto;
  try {
    texto = await res.text();
  } catch {
    // La conexión se cortó a mitad de la respuesta.
    return { ok: false, error: "Se ha cortado la conexión con el CRM. Vuelve a intentarlo." };
  }

  // Un cuerpo vacío no es un fallo de por sí: así contesta un 204.
  if (!texto.trim()) {
    return res.ok ? { ok: true } : { ok: false, error: mensajeDeRespuestaNoJson(res.status, opciones) };
  }

  let objeto;
  try {
    objeto = JSON.parse(texto);
  } catch {
    return { ok: false, error: mensajeDeRespuestaNoJson(res.status, opciones) };
  }

  // JSON válido que no es un objeto (`null`, un número, una lista): quien llama
  // espera poder leer `.error` sin comprobar nada, y `null.error` es un fallo
  // tan feo como el que veníamos a quitar.
  if (!objeto || typeof objeto !== "object" || Array.isArray(objeto)) {
    return { ok: res.ok, data: objeto };
  }
  return objeto;
}
