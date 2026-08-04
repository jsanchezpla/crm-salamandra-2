/**
 * Preguntas propias de un tipo de cita (04/08/2026, Rodrigo).
 *
 * ── POR QUÉ NO SE REUTILIZA EL MÓDULO FORMULARIOS ───────────────────────────
 * Durante unas horas esto fue un `form_id` que apuntaba a un formulario del
 * módulo Formularios. Sobre el papel era ahorrarse un constructor; en la
 * práctica obligaba a salir de la pantalla del tipo de cita, crear un
 * formulario completo —con su título, su texto de gracias y su página
 * pública— y volver a engancharlo, para acabar preguntando dos cosas. Y
 * arrastraba un módulo entero: sin `formularios` contratado no había manera de
 * pedir un dato al reservar.
 *
 * Aquí las preguntas VIVEN en el tipo de cita, en `form_questions`. Son cuatro
 * clases y a propósito no hay más:
 *   · `numero`  — una cifra (peso, horas de sueño…).
 *   · `escala`  — círculos del 1 al N (5 por defecto). Es lo que se contesta
 *                 de un toque en el móvil, que es donde se reserva.
 *   · `corto`   — una línea.
 *   · `largo`   — un párrafo.
 * Cada clase que se añade es una que hay que pintar en el widget, validar en el
 * servidor y enseñar en la ficha. Las que había en el formulario viejo (email,
 * teléfono, adjunto) ya se piden en la propia reserva.
 *
 * ── LAS RESPUESTAS SE GUARDAN CON SU PREGUNTA ───────────────────────────────
 * En `bookings.form_answers` va el TEXTO de la pregunta junto a la respuesta,
 * no solo su id. Si la profesional reescribe la pregunta el mes que viene, lo
 * que se contestó tiene que seguir leyéndose como se preguntó entonces.
 */

const texto = (v) => (v == null ? "" : String(v).trim());

export const TIPOS = ["numero", "escala", "corto", "largo"];

export const ETIQUETA_TIPO = {
  numero: "Número",
  escala: "Escala del 1 al N",
  corto: "Texto corto",
  largo: "Texto largo",
};

/** Tope de la escala: ni 1 (no es escala) ni 10+ (no se toca con el pulgar). */
const ESCALA_MIN = 2;
const ESCALA_MAX = 10;
export const ESCALA_POR_DEFECTO = 5;

const MAX_LARGO = { corto: 200, largo: 2000 };
/** Más de esto en una reserva no es un formulario, es otra cosa. */
export const MAX_PREGUNTAS = 12;

/**
 * Normaliza lo que llega del navegador o de JSONB. Descarta lo que no se pueda
 * pintar (sin enunciado, tipo inventado) en vez de guardarlo roto.
 */
export function normalizarPreguntas(bruto) {
  const raw = Array.isArray(bruto) ? bruto : [];
  const vistos = new Set();
  const out = [];

  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const label = texto(p.label).slice(0, 300);
    if (!label) continue; // una pregunta sin enunciado no es una pregunta
    const type = TIPOS.includes(p.type) ? p.type : "corto";

    // El id es lo que une respuesta y pregunta a lo largo del tiempo. Si no
    // viene (pregunta recién creada) o está repetido, se genera uno estable
    // por posición: `p1`, `p2`… No se usa crypto para que esto valga igual en
    // el navegador y en el servidor.
    let id = texto(p.id).slice(0, 40);
    if (!id || vistos.has(id)) id = `p${out.length + 1}`;
    while (vistos.has(id)) id = `${id}_`;
    vistos.add(id);

    const pregunta = { id, label, type, required: p.required === true };
    if (type === "escala") {
      const max = Number(p.max);
      pregunta.max = Number.isInteger(max) && max >= ESCALA_MIN && max <= ESCALA_MAX ? max : ESCALA_POR_DEFECTO;
    }
    const ayuda = texto(p.help).slice(0, 300);
    if (ayuda) pregunta.help = ayuda;

    out.push(pregunta);
    if (out.length >= MAX_PREGUNTAS) break;
  }
  return out;
}

/**
 * Valida lo que contesta quien reserva.
 *
 * Devuelve `{ ok: true, respuestas: [...] }` con la pregunta y la respuesta
 * juntas, o `{ ok: false, error }` con un mensaje para la pantalla. Solo se
 * queda con lo que la cita declara: lo que llegue de más se tira, que este
 * endpoint es público.
 */
export function validarRespuestas(preguntas, entrada) {
  const lista = normalizarPreguntas(preguntas);
  if (lista.length === 0) return { ok: true, respuestas: [] };

  const fuente = entrada && typeof entrada === "object" ? entrada : {};
  const respuestas = [];

  for (const p of lista) {
    const bruto = fuente[p.id];
    const vacio = bruto == null || texto(bruto) === "";

    if (vacio) {
      if (p.required) return { ok: false, error: `Falta contestar «${p.label}»` };
      continue; // las opcionales sin contestar no se guardan
    }

    let valor;
    if (p.type === "numero") {
      const n = Number(texto(bruto).replace(",", "."));
      if (!Number.isFinite(n)) return { ok: false, error: `«${p.label}» tiene que ser un número` };
      valor = n;
    } else if (p.type === "escala") {
      const n = Number(bruto);
      if (!Number.isInteger(n) || n < 1 || n > (p.max ?? ESCALA_POR_DEFECTO)) {
        return { ok: false, error: `«${p.label}» tiene que ser del 1 al ${p.max ?? ESCALA_POR_DEFECTO}` };
      }
      valor = n;
    } else {
      valor = texto(bruto).slice(0, MAX_LARGO[p.type]);
    }

    // El enunciado viaja con la respuesta: dentro de un año seguirá leyéndose
    // como se preguntó, aunque la pregunta se haya reescrito o borrado.
    respuestas.push({ id: p.id, label: p.label, type: p.type, valor });
  }

  return { ok: true, respuestas };
}

/** Lo que se guarda en `bookings.form_answers`. `null` si no hay preguntas. */
export function paquetePreguntas(preguntas, entrada) {
  const val = validarRespuestas(preguntas, entrada);
  if (!val.ok) return val;
  if (val.respuestas.length === 0) return { ok: true, paquete: null };
  return {
    ok: true,
    paquete: { respuestas: val.respuestas, submittedAt: new Date().toISOString() },
  };
}
