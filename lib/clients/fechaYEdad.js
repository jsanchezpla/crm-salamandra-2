/**
 * fechaYEdad — «12/03/2015 · 8 años», el dato que va al lado de un nombre en la
 * ficha (18/09/2026, AV-0210 de Aumenta, Olga: «necesitamos que en la ficha del
 * cliente aparezca la fecha de nacimiento + edad tanto de ellos si nos lo han
 * dado como de los pacientes; al lado del nombre es un dato importante para
 * manejar las terapeutas»).
 *
 * Esto es PRESENTACIÓN, no cálculo: la edad la sigue calculando `edadDesde`
 * (`formularioAlta.js`) cuando hay que calcularla, y los pacientes llegan con la
 * suya ya resuelta por `lib/clinica/edad.js` —que sabe que la fecha manda sobre
 * la casilla «Edad» escrita a mano—. Aquí solo se juntan las dos cosas en una
 * línea, para que la ficha, la sección de pacientes y cualquier otra pantalla
 * escriban lo mismo y no aparezcan tres formatos distintos del mismo dato.
 *
 * Medido en producción el 18/09/2026 antes de escribirlo: en Aumenta 1.000 de
 * los 1.202 pacientes tienen fecha de nacimiento y solo 3 de las 1.110 familias
 * la tienen. De ahí el «si nos lo han dado»: sin dato no se pinta nada —ni un
 * guion ni un hueco—, así que `texto` vacío significa «no se enseña».
 */

import { edadDesde } from "./formularioAlta.js";

/** «2015-03-12» (o cualquier ISO) → «12/03/2015»; "" si no hay fecha o no se entiende. */
export function fechaCorta(birthDate) {
  if (!birthDate) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthDate));
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** «8 años», «1 año»; "" si no hay edad. */
export function textoEdad(edad) {
  if (edad == null || !Number.isInteger(edad) || edad < 0 || edad > 120) return "";
  return edad === 1 ? "1 año" : `${edad} años`;
}

/**
 * La fecha de nacimiento y la edad de alguien, listas para pintar.
 *
 * `edad` se pasa cuando ya viene resuelta del servidor (el serializador de
 * pacientes la manda en `edad`, y sabe usar la columna `age` de quien no tiene
 * fecha). Sin ella se calcula desde la fecha.
 *
 * Devuelve `{ fecha, edad, texto }`. `texto` es lo que se enseña:
 *   · con las dos cosas → «12/03/2015 · 8 años»
 *   · solo fecha        → «12/03/2015»   (fecha de hace 130 años, ilegible…)
 *   · solo edad         → «8 años»       (fichas viejas sin fecha)
 *   · sin nada          → ""             (no se pinta)
 */
export function fechaYEdad(birthDate, { edad } = {}) {
  const fecha = fechaCorta(birthDate);
  const anos = edad === undefined ? edadDesde(birthDate) : edad;
  const texto = textoEdad(anos);
  return {
    fecha,
    edad: texto ? anos : null,
    texto: [fecha, texto].filter(Boolean).join(" · "),
  };
}
