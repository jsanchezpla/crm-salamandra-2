/**
 * lib/leads/embudos.js — qué etapas ofrece el embudo de cada cliente.
 *
 * Fichero nuevo en /lib (regla #2). El motivo, en una frase: **el servidor no
 * podía saber qué embudo tiene nadie**, y eso hacía que una pantalla suya
 * mintiera.
 *
 * ── DE DÓNDE SALE ──────────────────────────────────────────────────────────
 * Las etapas de cada cliente están escritas dentro de su componente de React
 * (`modules/overrides/{slug}/LeadsModule.jsx`), que es "use client" y no se
 * puede importar desde el servidor. Así que `lib/leads/estadisticas.js`, que
 * calcula la conversión, solo sabía dividir: para él todos los embudos son
 * iguales.
 *
 * No lo son. De los seis overrides, TRES no tienen ninguna etapa de «ganado»
 * —aumenta, demo y sandbox terminan en Nuevo, Contactado y Descartado—, así que
 * su «Convertidos» es un 0 que no puede subir por bien que les vaya, y su
 * conversión un 0 % en cuanto alguien descarte a alguien. Lo destapó la prueba
 * de humo de las etapas de Leads el 17/08/2026.
 *
 * ── POR QUÉ SE DECLARA AQUÍ Y NO SE UNIFICAN LOS COMPONENTES ───────────────
 * Porque los siete embudos se quedan separados a propósito (decisión de Jorge,
 * 17/08/2026: «si cambio uno y se cambian los demás se podría romper todo»).
 * Esto NO los toca: solo declara, para quien mira desde el servidor, lo que
 * cada uno ya dice. Cada componente sigue pintando lo suyo como quiera.
 *
 * ⚠️ EL PRECIO DE ESO ES QUE HAY DOS COPIAS DE LA MISMA LISTA. Si alguien añade
 * una etapa a un override y no la añade aquí, esta se queda vieja EN SILENCIO.
 * El sitio donde cazar esa desviación es `scripts/_smoke-leads-etapas.mjs`, que
 * ya lee los componentes uno por uno: comparar su lista con la de aquí es la
 * comprobación que falta.
 *
 * ── LOS SLUGS VAN CON GUIÓN BAJO ───────────────────────────────────────────
 * Las carpetas de `modules/overrides/` usan guión (`nutri-laura`) por
 * convención cosmética, pero aquí la clave es el slug de la BASE DE DATOS, que
 * es lo que trae `tenant.slug` y lleva guión bajo (`nutri_laura`). Escribirlo
 * con guión no da error: deja al cliente cayendo en el embudo por defecto.
 */

import { ALLOWED_STAGES } from "./stages.js";

/**
 * Etapas terminales. Un embudo sin saber cuáles cierran no es un embudo: es una
 * lista. Los tres nombres de «ganado» son de tres overrides distintos.
 *
 * Vivían dentro de `estadisticas.js`; se mudan aquí porque son vocabulario del
 * embudo, no de las cifras, y ahora las necesitan los dos.
 */
export const GANADAS = new Set(["won", "closed_yes", "paciente"]);
export const PERDIDAS = new Set(["lost", "closed_no"]);

/**
 * Lo que ofrece el embudo de cada cliente, copiado de su `LeadsModule.jsx`.
 * Quien no esté aquí usa el módulo por defecto, que no tiene botonera propia y
 * acepta cualquier etapa de la lista canónica.
 */
const EMBUDOS = {
  aumenta: ["new", "contacted", "lost"],
  demo: ["new", "contacted", "lost"],
  nutri_laura: ["new", "contacted", "consulta_agendada", "consulta_realizada", "paciente", "lost"],
  retorika: ["new", "contacted", "qualified", "won", "lost"],
  sandbox: ["new", "contacted", "lost"],
  spain_enzymes: ["new", "contacted", "qualified", "won", "lost"],
};

/** Las etapas que ofrece ese cliente. Sin override, todas las canónicas. */
export function etapasDe(slug) {
  return EMBUDOS[slug] ?? ALLOWED_STAGES;
}

/**
 * ¿Puede este embudo dar a alguien por ganado?
 *
 * Es la pregunta que separa «todavía no han convertido a nadie» —un 0 que
 * significa algo— de «aquí no se puede convertir a nadie», que es un 0 que solo
 * puede confundir.
 */
export function tieneEtapaGanada(slug) {
  return etapasDe(slug).some((e) => GANADAS.has(e));
}
