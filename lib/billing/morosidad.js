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

import { importeBuscado, casaImporte } from "./importeBuscado.js";

/*
 * ── POR PACIENTE, NO POR FAMILIA (15/09/2026, Rodrigo) ─────────────────────
 * «La morosidad sale por cliente cuando debería salir por paciente.» Con dos
 * hermanos en terapia, la familia salía una vez y al día en cuanto pagaba UNO
 * de los dos; el otro no aparecía nunca. Medido en Aumenta: 78 familias con 2
 * o 3 pacientes activos.
 *
 * Así que cada fila es un paciente, y lo que hay que decidir es de quién es
 * cada cuota y cada cobro. Las dos reglas de abajo, y solo esas:
 *
 *  - La cuota con `patientId` es de ese paciente. La que no lo lleva es de la
 *    familia entera y cubre a todos sus pacientes (35 cuotas en Aumenta, 33 de
 *    familias con varios hijos).
 *  - El cobro con `patientId` es de ese paciente, lo pague quien lo pague (la
 *    fundación que paga la cuota de este niño). El que no lo lleva, a nombre
 *    de la familia o de quien paga sus cuotas, cuenta para todos sus pacientes:
 *    el CRM no sabe de cuál es y no se lo inventa. Por eso la fila lo dice
 *    (`compartido`), para que nadie sume dos veces la misma deuda.
 */

/** Las cuotas que tocan a este paciente: las suyas y las de su familia sin paciente. */
export function cuotasDelPaciente(paciente, cuotas = []) {
  const pid = String(paciente?.id ?? "");
  const cid = String(paciente?.clientId ?? "");
  return (cuotas ?? []).filter((c) =>
    c?.patientId ? String(c.patientId) === pid : !!c?.clientId && String(c.clientId) === cid
  );
}

/**
 * ¿Cuenta este cobro para este paciente? `pagadores` son los clientes a cuyo
 * nombre puede nacer su cobro: la familia y quien pague alguna de sus cuotas.
 */
export function cobroDelPaciente(paciente, cobro, pagadores = new Set()) {
  if (cobro?.patientId) return String(cobro.patientId) === String(paciente?.id ?? "");
  return !!cobro?.clientId && pagadores.has(String(cobro.clientId));
}

/** La familia y quienes pagan las cuotas del paciente, como ids en texto. */
export function pagadoresDelPaciente(paciente, cuotasSuyas = []) {
  const s = new Set();
  if (paciente?.clientId) s.add(String(paciente.clientId));
  for (const c of cuotasSuyas ?? []) {
    if (c?.payerClientId) s.add(String(c.payerClientId));
    else if (c?.clientId) s.add(String(c.clientId));
  }
  return s;
}

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
  // Un número busca además el importe exacto: lo que debe o lo que vale su
  // cuota (AV-0136, 15/09/2026).
  const importe = importeBuscado(q);
  return (morosos ?? []).filter((m) => {
    if (casaImporte([m?.debe, ...(m?.importes ?? [])], importe)) return true;
    // Por el paciente y por su familia: se busca a un niño por su nombre o por
    // el apellido de los padres, que no siempre es el suyo.
    const donde = [m?.name, m?.familia, m?.email, m?.phone, ...(m?.conceptos ?? []), ...(m?.pacientes ?? [])];
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
export function resumenDeMorosidad({ conCuota = [], sinCuota = [], alDia = 0, pacientes = 0 } = {}) {
  return {
    conCuota: `${conCuota.length} ${conCuota.length === 1 ? "paciente debe" : "pacientes deben"} este mes`,
    sinCuota: `${sinCuota.length} ${sinCuota.length === 1 ? "paciente activo" : "pacientes activos"} sin cuota escrita`,
    alDia: `${alDia} al día · ${pacientes} ${pacientes === 1 ? "paciente activo" : "pacientes activos"}`,
  };
}
