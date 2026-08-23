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
 * No lo son. De los seis overrides que había el 17/08, TRES no tenían ninguna
 * etapa de «ganado» —aumenta, demo y sandbox terminaban en Nuevo, Contactado y
 * Descartado—, así que su «Convertidos» era un 0 que no podía subir por bien
 * que les fuera, y su conversión un 0 % en cuanto alguien descartara a alguien.
 * Lo destapó la prueba de humo de las etapas de Leads el 17/08/2026. (Desde el
 * 18/08 solo le pasa a aumenta: demo y sandbox usan el módulo base y su embudo
 * por defecto, ver abajo.)
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
 * Quien no esté aquí usa el módulo por defecto con `EMBUDO_POR_DEFECTO`.
 *
 * `demo` y `sandbox` salieron de aquí el 18/08/2026 al borrarse sus overrides:
 * la demo enseña desde entonces las cinco etapas por defecto (decisión de
 * Jorge: es el escaparate, y tiene que enseñar lo que verá quien compre), y
 * sandbox no existe como tenant en ningún entorno. Sus leads —los de la demo—
 * están todos en `new`, `contacted` o `lost`, que siguen dentro de las cinco.
 */
const EMBUDOS = {
  aumenta: ["new", "contacted", "lost"],
  nutri_laura: ["new", "contacted", "consulta_agendada", "consulta_realizada", "paciente", "lost"],
  retorika: ["new", "contacted", "qualified", "won", "lost"],
  spain_enzymes: ["new", "contacted", "qualified", "won", "lost"],
};

/**
 * El embudo de un cliente sin configuración propia (18/08/2026).
 *
 * Hasta hoy `etapasDe()` devolvía para ellos `ALLOWED_STAGES` entera: las 15,
 * incluidas las de nutrición y las que quedaron de Quality y Abarca. Daba igual
 * porque el módulo por defecto era una tabla sin botonera y no las pintaba. Al
 * promocionar el módulo de aumenta a base —que SÍ pinta una tarjeta y un botón
 * por etapa— quince tarjetas serían un despropósito, y además mentirían: nadie
 * puede pasar un lead a «Consulta agendada» en una consultora.
 *
 * Son las cinco estándar de la lista canónica, en el orden en que se recorren.
 * Comprobado en producción antes de fijarlas: los clientes que hoy usan el
 * módulo base tienen sus leads en `new`, `contacted` y `lost` (las cuatro
 * demos) o ninguno todavía (somos, gm_alvar_alonso). Nadie pierde una etapa
 * que use.
 *
 * `qualified` y `won` van dentro a propósito: es lo que hace que un cliente
 * nuevo tenga dónde apuntar un ganado, y por tanto que «Convertidos» le salga
 * en /leads/estadisticas (`tieneEtapaGanada`). Es la decisión de Jorge del
 * 18/08: cinco, no las tres de aumenta, porque tres es un cambio de DATO para
 * quien ya tuviera leads en «En seguimiento» o «Convertido».
 */
export const EMBUDO_POR_DEFECTO = ["new", "contacted", "qualified", "won", "lost"];
for (const e of EMBUDO_POR_DEFECTO) {
  // Si alguien renombra una etapa en stages.js y no aquí, mejor reventar al
  // arrancar que enseñar un botón que el PATCH rechaza.
  if (!ALLOWED_STAGES.includes(e)) throw new Error(`EMBUDO_POR_DEFECTO: «${e}» no está en ALLOWED_STAGES`);
}

/** Las etapas que ofrece ese cliente. Sin override, las cinco por defecto. */
export function etapasDe(slug) {
  return EMBUDOS[slug] ?? EMBUDO_POR_DEFECTO;
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
