/**
 * lib/clinica/planDesdeEntrevista.js — el Plan se rellena con lo que ya se
 * escribió en la entrevista inicial (09/09/2026, AV-0103).
 *
 * ── DE QUÉ PETICIÓN NACE ───────────────────────────────────────────────────
 * Silvia (Aumenta): «¿podrías poner el botón de la IA dentro de la ficha del
 * paciente, en el apartado de PLAN, para que se nos rellenen los apartados de
 * diagnóstico, motivo de consulta e información previa?».
 *
 * ── POR QUÉ ESTO NO ES UN TRABAJO PARA LA IA ───────────────────────────────
 * Porque no hay nada que redactar. El motivo de consulta y los antecedentes YA
 * ESTÁN ESCRITOS, palabra por palabra, en la entrevista inicial del paciente:
 * lo que hacía falta no era que alguien los redactara otra vez, era traerlos.
 * Copiar no cuesta un céntimo de la cuenta del centro, no puede inventarse
 * nada y sale igual siempre. Meter la IA aquí habría sido pagar por reescribir
 * peor lo que ya estaba bien escrito.
 *
 * ── Y POR QUÉ EL DIAGNÓSTICO NO SE RELLENA ─────────────────────────────────
 * ⚠️ La entrevista NO tiene un apartado de diagnóstico. Tiene «12. Impresión
 * clínica inicial», que es una HIPÓTESIS —«hipótesis inicial · necesidad de
 * evaluación · necesidad de derivación», lo dice su propia pista— y volcarla
 * en un campo que se llama «Diagnóstico» la convertiría en un diagnóstico por
 * el camino. Es exactamente lo que se le prohibió a la IA el 09/09 y no se
 * abre por la puerta de atrás. El diagnóstico lo escribe quien puede darlo.
 *
 * (Fichero nuevo en /lib, regla #2: el mapa de qué apartado va a qué campo lo
 * necesitan el endpoint y la pantalla, y escrito dos veces acabaría trayendo
 * cosas distintas según por dónde se pulse.)
 *
 * Puro: sin base y sin fetch. Prueba en `scripts/_smoke-plan-desde-entrevista.mjs`.
 */

/**
 * De qué apartados de la entrevista sale cada campo del Plan.
 *
 * «Información previa» junta cuatro porque eso es lo que significa: qué había
 * antes de que llegara. Van con su rótulo delante para que quien lo lea sepa de
 * dónde viene cada párrafo y pueda borrar lo que no quiera.
 */
export const DE_DONDE = Object.freeze({
  consultationReasons: Object.freeze(["motivoConsulta"]),
  previousInfo: Object.freeze([
    "antecedentesPersonales",
    "antecedentesFamiliares",
    "escolarLaboral",
    "intervencionesPrevias",
  ]),
});

/** Los campos del Plan que este volcado sabe rellenar. El diagnóstico no está. */
export const CAMPOS = Object.freeze(Object.keys(DE_DONDE));

const texto = (v) => {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean).join("\n");
  return typeof v === "string" ? v.trim() : "";
};

/**
 * El contenido de la entrevista, por clave de apartado.
 *
 * Los valores viven repartidos entre columnas de la sesión y su JSONB, así que
 * se los pasa ya resueltos quien llame (con `aFormulario`, como el PDF).
 */
export function volcadoDeEntrevista(valores = {}, apartados = []) {
  const rotulo = new Map((apartados ?? []).map((a) => [a.key, a.label]));
  const salida = {};
  for (const [campo, claves] of Object.entries(DE_DONDE)) {
    const trozos = [];
    for (const k of claves) {
      const t = texto(valores?.[k]);
      if (!t) continue;
      // Un solo apartado no necesita presentación; varios, sí.
      trozos.push(claves.length > 1 ? `${limpiarRotulo(rotulo.get(k) ?? k)}: ${t}` : t);
    }
    if (trozos.length) salida[campo] = trozos.join("\n\n");
  }
  return salida;
}

/** «3. Antecedentes personales» → «Antecedentes personales». */
function limpiarRotulo(label) {
  return String(label ?? "").replace(/^\s*\d+\.\s*/, "").trim();
}

/**
 * Lo que de verdad se va a escribir: solo lo que esté VACÍO en el plan.
 *
 * Nunca se pisa lo que la profesional haya escrito. Un botón que borra lo tuyo
 * se pulsa una vez y no se vuelve a pulsar nunca.
 */
export function loQueRellena(plan = {}, volcado = {}) {
  const cambios = {};
  for (const campo of CAMPOS) {
    if (texto(plan?.[campo])) continue;
    if (!texto(volcado?.[campo])) continue;
    cambios[campo] = volcado[campo];
  }
  return cambios;
}

/** Lo que se le dice a la persona después de pulsar. */
export function resumenDelVolcado(cambios = {}, plan = {}) {
  const rellenados = Object.keys(cambios);
  const yaEstaban = CAMPOS.filter((c) => texto(plan?.[c]) && !rellenados.includes(c));
  return {
    rellenados,
    yaEstaban,
    // El diagnóstico se nombra SIEMPRE, esté como esté: es la pregunta que
    // hizo el centro y la respuesta es que no se rellena solo.
    diagnostico: "El diagnóstico no se trae: la entrevista tiene una impresión clínica, que es una hipótesis, y no es lo mismo.",
  };
}
