/**
 * lib/billing/morosidad.js — cómo se lee la lista de morosos (09/09/2026).
 *
 * ── DE QUÉ PETICIÓN NACE ───────────────────────────────────────────────────
 * Rosa (Aumenta), 09/09/2026: «está dividido en dos partes, no sé si todo es
 * moroso, en una parte figura los nombres de los padres y pone como si debiera
 * 1 mes, no sé si se puede ver y no soy capaz pero lo suyo es ver el importe
 * concreto que debe y a qué pertenece». Y aparte, sobre el buscador de esa
 * misma pantalla: «NO FUNCIONA EL BUSCADOR».
 *
 * ── LO QUE PASABA, Y NO ERA UN FALLO ───────────────────────────────────────
 * La lista mezcla DOS poblaciones que no se parecen en nada:
 *
 *  1. La familia que tiene una cuota escrita y no ha pagado (o ha pagado el mes
 *     a medias). De esa el CRM sabe cuánto esperaba cobrar, así que puede decir
 *     «debe 60 €» — y sabe de qué, porque la cuota lleva sus conceptos.
 *  2. La familia con paciente activo y NINGUNA cuota escrita. De esa el CRM no
 *     sabe nada: no hay importe que enseñar, así que le pintaba «1 mes»,
 *     «2 meses»… que es lo único que puede contar.
 *
 * En Aumenta la segunda son 683 de las 959 familias con paciente activo, o sea
 * que la lista está casi entera hecha de gente de la que no se sabe el importe.
 * Desde fuera eso se lee como «la morosidad no dice lo que debe», y por eso la
 * respuesta no es calcular nada nuevo: es SEPARARLAS y decir cuál es cuál.
 *
 * ⚠️ Y NO se recalcula el mes de la segunda población para inventarle un
 * importe. Ya se probó el 07/09 y salió caro: al recalcular, el «Descuento
 * reserva ya abonada» de −30 € volvía a pedirse y la pantalla acusaba a unas 95
 * familias de deber 30 € que no debían. Lo que el CRM no sabe, no lo dice.
 *
 * Puro: sin base y sin fetch. Prueba en `scripts/_smoke-morosidad.mjs`.
 */

const sinAcentos = (t) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * Parte la lista en las dos poblaciones de arriba.
 *
 * `conCuota` es la morosidad de verdad: alguien con una cuota escrita que no la
 * ha pagado. `sinCuota` no es morosidad, es trabajo pendiente del centro, y por
 * eso va con su propio rótulo en vez de disfrazada de deuda.
 */
export function repartirMorosos(morosos = []) {
  const conCuota = [];
  const sinCuota = [];
  for (const m of morosos ?? []) (m?.tieneCuota ? conCuota : sinCuota).push(m);
  return { conCuota, sinCuota };
}

/**
 * El buscador de la pantalla, aplicado también a los morosos.
 *
 * La lista llega ENTERA del servidor (no se pagina), así que se filtra aquí sin
 * pedir nada: escribir un apellido tiene que mover las dos listas de la
 * pantalla, no solo la de cobros. Busca por nombre, correo, teléfono y por el
 * concepto de la cuota, que es lo que Rosa llama «a qué pertenece».
 */
export function filtrarMorosos(morosos = [], texto = "") {
  const q = sinAcentos(texto);
  if (!q) return morosos ?? [];
  return (morosos ?? []).filter((m) => {
    const donde = [m?.name, m?.email, m?.phone, ...(m?.conceptos ?? [])];
    return donde.some((v) => sinAcentos(v).includes(q));
  });
}

/**
 * Qué pone la etiqueta de cada fila.
 *
 * Un importe siempre gana a un número de meses: «debe 60 €» se entiende y
 * «1 mes» hay que ir a buscarlo. Y cuando no hay cuota se dice eso mismo, en
 * vez de contar meses de una deuda que nadie ha escrito.
 */
export function etiquetaDeMoroso(m = {}) {
  if (m.debe != null) return { texto: `debe ${importe(m.debe)}`, tono: "importe" };
  if (!m.tieneCuota) return { texto: "sin cuota escrita", tono: "sinCuota" };
  const n = Number(m.mesesSeguidos ?? 0);
  if (n <= 0) return { texto: "este mes", tono: "leve" };
  return { texto: n === 1 ? "1 mes" : `${n} meses`, tono: n >= 3 ? "grave" : n === 2 ? "medio" : "leve" };
}

/** 60 → «60,00 €». Sin Intl para que la prueba no dependa del locale del sistema. */
function importe(n) {
  const v = Number(n ?? 0);
  return `${v.toFixed(2).replace(".", ",")} €`;
}

/**
 * La frase de cabecera de cada bloque. Va aquí y no en el JSX porque las
 * cuentas que resume (cuántos deben de verdad y cuántos no tienen cuota) son
 * justo lo que se estaba leyendo mal.
 */
export function resumenDeMorosidad({ conCuota = [], sinCuota = [], alDia = 0, familias = 0 } = {}) {
  return {
    conCuota: `${conCuota.length} ${conCuota.length === 1 ? "familia debe" : "familias deben"} este mes`,
    sinCuota: `${sinCuota.length} ${sinCuota.length === 1 ? "familia" : "familias"} con paciente activo y sin cuota escrita`,
    alDia: `${alDia} al día · ${familias} familias con paciente activo`,
  };
}
