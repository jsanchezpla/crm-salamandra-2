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
export const GANADAS = new Set([
  "won",
  "closed_yes",
  "paciente",
  // Booking: se gana cuando la fecha se cierra. `actuacion_realizada` va DESPUÉS
  // de ganar —el bolo ya se tocó—, así que también cuenta: si no, el día del
  // concierto la conversión BAJARÍA, que es lo contrario de lo que pasó.
  "fecha_confirmada",
  "actuacion_realizada",
]);
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
  // `paciente` entra el 26/08/2026 (Jorge). Hasta ese día el embudo de Aumenta
  // terminaba en Nuevo / Contactado / Descartado: no había dónde decir que la
  // cosa salió bien, así que su embudo no podía medir si convierten y
  // /leads/estadisticas no les enseñaba «Convertidos». La etapa NO se inventa:
  // es la misma que ya usa nutri_laura y ya cuenta como ganada, y en un centro
  // de psicología «ganado» es exactamente que la persona entre como paciente.
  aumenta: ["new", "contacted", "paciente", "lost"],
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

/**
 * El embudo del módulo `booking` (24/08/2026).
 *
 * ── POR QUÉ VA POR MÓDULO Y NO POR SLUG ────────────────────────────────────
 * Todo lo de arriba es un mapa de CLIENTES: quien no está, cae en las cinco por
 * defecto. Este no. Es la primera entrada que se decide por MÓDULO, y es una
 * decisión de Rodrigo (24/08/2026) al crear `booking`: la siguiente agencia de
 * management que se dé de alta tiene que salir con este embudo de fábrica, sin
 * que nadie se acuerde de escribir su slug aquí. Es el mismo criterio que ya
 * usa `lib/clients/vocabulario.js` para decidir si el cliente se llama
 * «paciente», y por el mismo motivo: una lista escrita a mano de algo que crece
 * siempre acaba faltándole el último.
 *
 * El mapa por slug de arriba MANDA sobre esto, para que un cliente con embudo
 * propio no lo pierda el día que compre `booking`. Hoy no se da el caso.
 */
export const EMBUDO_BOOKING = [
  "new",
  "propuesta_enviada",
  "respuesta_recibida",
  "negociando_cache",
  "fecha_confirmada",
  "actuacion_realizada",
  "lost",
];

// Los embudos por slug entran en la comprobación desde el 26/08/2026: hasta ese
// día solo se miraban el por defecto y el de booking, así que una errata dentro
// de `EMBUDOS` pasaba sin ruido y dejaba al cliente con un botón que su propio
// servidor rechaza.
for (const e of [...EMBUDO_POR_DEFECTO, ...EMBUDO_BOOKING, ...Object.values(EMBUDOS).flat()]) {
  // Si alguien renombra una etapa en stages.js y no aquí, mejor reventar al
  // arrancar que enseñar un botón que el PATCH rechaza.
  if (!ALLOWED_STAGES.includes(e)) throw new Error(`Embudo: «${e}» no está en ALLOWED_STAGES`);
}

/**
 * Las etapas que ofrece ese cliente.
 *
 * `tieneModulo` es opcional y es `hasModule` del contexto de tenant. Se añadió
 * con `booking`: sin él la firma de siempre sigue funcionando igual, porque
 * quien no lo pasa nunca entra en la rama del módulo. Orden de prioridad:
 * embudo propio del cliente → embudo de módulo → las cinco por defecto.
 */
export function etapasDe(slug, tieneModulo = null) {
  const propio = Object.prototype.hasOwnProperty.call(EMBUDOS, slug) ? EMBUDOS[slug] : null;
  if (propio) return propio;
  if (typeof tieneModulo === "function" && tieneModulo("booking")) return EMBUDO_BOOKING;
  return EMBUDO_POR_DEFECTO;
}

/**
 * ¿Ofrece ESE cliente esta etapa?
 *
 * ── POR QUÉ NO BASTA CON `ALLOWED_STAGES` (26/08/2026) ─────────────────────
 * La lista canónica dice qué etapas EXISTEN en el CRM —veinte—, no cuáles
 * ofrece cada embudo, que son entre cuatro y siete. Las cuatro puertas por las
 * que puede entrar una etapa (el alta, el PATCH y los dos importadores) miraban
 * la lista general, así que se podía meter a alguien en una etapa que su
 * pantalla no tiene: saldría con su chip pero sin fila donde ponerse, y los
 * contadores de la cabecera dejarían de sumar el total.
 *
 * No es un caso raro de un cliente: medido el 26/08/2026, **7 de las 20 etapas
 * no las ofrece NINGÚN embudo** (proposal, negotiation, in_progress,
 * demo_scheduled, demo_done, closed_yes, closed_no). La puerta estaba abierta en
 * los ocho clientes con leads. Que hoy no haya ni un caso —todos están en
 * new/contacted/lost— es suerte, no diseño.
 *
 * Se pregunta por el embudo y NO se ha tocado `ALLOWED_STAGES`: aquella sigue
 * siendo la lista de lo que el CRM sabe nombrar, y de ella salen los rótulos del
 * Excel y de las pantallas compartidas. Esto es la otra pregunta.
 */
export function aceptaEtapa(slug, etapa, tieneModulo = null) {
  return etapasDe(slug, tieneModulo).includes(String(etapa ?? "").trim());
}

/**
 * ¿Puede este embudo dar a alguien por ganado?/**
 * ¿Puede este embudo dar a alguien por ganado?
 *
 * Es la pregunta que separa «todavía no han convertido a nadie» —un 0 que
 * significa algo— de «aquí no se puede convertir a nadie», que es un 0 que solo
 * puede confundir.
 */
/**
 * A qué etapa se mueve un interesado cuando el CRM se entera de que ya tiene
 * ficha (26/08/2026, Jorge: «que lo marque el CRM solo»).
 *
 * ── POR QUÉ LO DECIDE EL SERVIDOR Y NO CADA PANTALLA ───────────────────────
 * Hasta hoy lo decidía el navegador: la ficha de Laura mandaba `paciente` a
 * mano y la de spain_enzymes `won`, cada una escrita dentro de su componente.
 * Eso tiene dos problemas. Uno, que la pantalla de un cliente nuevo no sabría
 * qué mandar. Y dos, que si el segundo de los dos avisos que manda el navegador
 * falla —está documentado que puede—, el cliente queda creado y el interesado
 * sin mover, o sea con la ficha hecha y el embudo diciendo que sigue pendiente.
 * Decidiéndolo aquí, el CRM lo marca aunque quien avise no diga nada.
 *
 * Devuelve `null` cuando el embudo no tiene ninguna etapa ganada (nadie hoy) y
 * también en BOOKING, y esto último no es un descuido: allí ganar es que se
 * cierre la FECHA, no que el contratante tenga ficha. Un festival puede estar
 * fichado en el CRM y no haber contratado nada; moverlo a «Fecha confirmada»
 * por darle de alta sería decir que hay bolo.
 *
 * De las ganadas del embudo se coge la PRIMERA que aparezca en él, que es la
 * más temprana: en un embudo con varias (booking tiene dos) la última significa
 * algo que todavía no ha pasado.
 */
export function etapaAlGanar(slug, tieneModulo = null) {
  if (typeof tieneModulo === "function" && tieneModulo("booking") && !EMBUDOS[slug]) return null;
  return etapasDe(slug, tieneModulo).find((e) => GANADAS.has(e)) ?? null;
}

export function tieneEtapaGanada(slug, tieneModulo = null) {
  return etapasDe(slug, tieneModulo).some((e) => GANADAS.has(e));
}
