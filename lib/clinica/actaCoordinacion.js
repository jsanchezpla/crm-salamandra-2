/**
 * Cómo se lee lo que se TECLEA en el acta de una coordinación (13/09/2026, Aumenta).
 *
 * (Fichero nuevo en /lib, regla 2: la regla de troceo del acta tiene que vivir
 * una sola vez, ser pura y tener prueba —`scripts/_smoke-acta-coordinacion.mjs`—;
 * hasta hoy estaba mal y suelta en `app/api/clinica/coordinations/route.js`.)
 *
 * Temas, Acuerdos y Próximos pasos son frases: se parten por LÍNEAS (la
 * convención de las listas del CRM, ver plantillas.js `desdeFormulario`). La
 * coma NO parte: «Reforzar pautas en casa, revisar en un mes» es UN acuerdo.
 * Hasta hoy el POST hacía split(",") y las 3 actas escritas a mano en Aumenta
 * salieron troceadas a media frase.
 *
 * A diferencia de `desdeFormulario`, aquí se quita la viñeta escrita a mano
 * («- », «• », «1. », «a) »): la pantalla pinta la suya. Guion, asterisco,
 * número y letra solo son viñeta con espacio detrás o solos en la línea, para
 * no comerse «-5 %», «10.30», «1.5 h» ni «+34».
 *
 * Participantes sí se parte por comas (el campo lo avisa), por «;» y por líneas,
 * como el importador (`trocearAsistentes`).
 * Un array no se re-parte: cada elemento ya es un punto; solo se limpia.
 */
const SALTO = /\r\n|\r|\n/;
const VINETA = /^(?:[•·▪◦●○►→✓✔]\s*|[-–—*+](?:\s+|$)|\d{1,2}[.)]-?(?:\s+|$)|[a-z]\)(?:\s+|$))/i;

function textoLimpio(v) {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** Una línea sin la viñeta escrita a mano (y sin espacios a los lados). */
export function sinVineta(linea) {
  return textoLimpio(linea).replace(VINETA, "").trim();
}

/** Temas, acuerdos, próximos pasos: texto → una cadena por línea; array → limpio. */
export function lineasDelFormulario(valor) {
  if (Array.isArray(valor)) return valor.map(textoLimpio).filter(Boolean);
  const t = textoLimpio(valor);
  return t ? t.split(SALTO).map(sinVineta).filter(Boolean) : [];
}

/** Participantes: texto → por comas, «;» o líneas; array → objetos tal cual, textos limpios. */
export function asistentesDelFormulario(valor) {
  if (Array.isArray(valor)) {
    return valor
      .map((p) => (p && typeof p === "object" && !Array.isArray(p) ? p : textoLimpio(p)))
      .filter(Boolean);
  }
  const t = textoLimpio(valor);
  return t ? t.split(/[,;\r\n]+/).map((x) => x.trim()).filter(Boolean) : [];
}

/**
 * Recompone un campo troceado por el split(",") de antes del 13/09/2026: vuelve
 * a unir con ", " y lo parte por sus líneas. NO es idempotente (sobre un acta ya
 * reparada uniría sus líneas en una): solo para filas que nunca se repararon;
 * lo usa scripts/reparar-coordinaciones-troceadas.js, que lo comprueba antes.
 *
 * Lo que no puede devolver: donde se escribió «a,b» queda «a, b», y una línea
 * que acababa en coma se une con la siguiente (el trim del split viejo se comió
 * ese salto). No se pierde texto.
 */
export function repararTroceado(arr) {
  return lineasDelFormulario((Array.isArray(arr) ? arr : []).filter((x) => typeof x === "string").join(", "));
}
