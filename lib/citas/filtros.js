/**
 * lib/citas/filtros.js — el filtro por profesional del calendario.
 *
 * Fichero puro y SIN dependencias a propósito (regla #2): lo importan el
 * endpoint del calendario y el componente de la agenda, que es cliente. Si esto
 * viviera en `visibilidad.js` —que importa `Op` de Sequelize— el navegador se
 * traería Sequelize entero para leer una cadena de trece letras.
 *
 * ── DE QUÉ FALLO REAL NACE (25/08/2026, Rodrigo) ────────────────────────────
 *
 * «En el calendario se solapan agendas. Estoy seleccionando solo el de una
 * terapeuta y me aparecen solapados otras dos aunque están desactivados del
 * menú.»
 *
 * No se colaban las de otras dos: se colaban las que no son de NADIE. El
 * endpoint del calendario, al filtrar por profesional, metía SIEMPRE las citas
 * con `team_member_id IS NULL` «para no perderlas de vista». Medido en
 * producción el 25/08/2026, semana del 7 al 13 de septiembre, filtrando por la
 * profesional con más agenda de Aumenta:
 *
 *     103 citas en pantalla · 33 suyas · 70 sin profesional
 *
 * Dos de cada tres cosas que veía no eran suyas. Y como los 57 tipos de cita de
 * Aumenta no tienen color, las 70 caían al verde por defecto `#3F6E5B`, que es
 * EXACTAMENTE el mismo verde que usan las citas de los 3 miembros del equipo
 * que no tienen color de avatar. De ahí que se leyeran como «de otras dos».
 *
 * ── POR QUÉ SE PUEDE QUITAR AQUELLA EXCEPCIÓN ───────────────────────────────
 *
 * Porque las citas sin profesional YA tienen su sitio: `/citas/sin-profesional`,
 * en el menú, que existe justo para repartirlas. No hacen falta 1.827 recordatorios
 * encima de la agenda de cada persona. Un filtro que enseña lo que no le has
 * pedido no es un recordatorio: es un filtro roto, y enseña además nombres de
 * pacientes que no le tocan a quien mira.
 *
 * Lo que NO cambia es la regla de quien solo ve lo suyo (`soloLoSuyo` en
 * `visibilidad.js`): ahí las sin asignar siguen entrando, y es deliberado —en
 * nutri_laura son la mitad de la agenda y entran por la web sin profesional.
 * Una cosa es «qué puedo ver» y otra «qué he pedido ver».
 *
 * ── Y PARA NO PERDERLAS DE VISTA, AHORA SE PIDEN ────────────────────────────
 *
 * `Sin asignar` es una opción más del desplegable de profesional. Elegirla
 * enseña solo las que no son de nadie; combinarla con una persona enseña las
 * dos cosas. Antes esa combinación era la única posible y no se podía apagar.
 */

/**
 * El valor que representa «sin profesional» dentro de `teamMemberIds`.
 *
 * No es un UUID a propósito: así no puede chocar nunca con el id de una ficha
 * de equipo, ni siquiera por accidente.
 */
export const SIN_PROFESIONAL = "sin-asignar";

/** El verde de las citas que no llevan color de persona ni de tipo. */
export const COLOR_CITA_POR_DEFECTO = "#3F6E5B";

/** Las fichas de equipo llevan UUID (`models/tenant/TeamMember.model.js`). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Trocea el `teamMemberIds` que llega por la query.
 *
 * Devuelve `null` cuando NO hay filtro que aplicar (parámetro ausente, vacío o
 * con solo comas), que es como decir «todos»: es el mismo contrato que el
 * `MultiSelect` de la pantalla, donde la lista vacía no existe y quedarse sin
 * nada marcado vuelve a «Todos».
 *
 * ⚠️ **Lo que no es un UUID se tira**, no se pasa a la consulta. `team_member_id`
 * es `uuid` en PostgreSQL: meterle `undefined` —lo que escribe un `+` con una
 * variable vacía— no devuelve cero filas, revienta con un 22P02 y el calendario
 * se queda en blanco. Se vio en local el 25/08/2026 mandando la query a mano, y
 * ya pasaba antes de que `sin-asignar` existiera. Si al limpiar no queda ningún
 * id y tampoco se pidieron las sin asignar, vuelve `null` («todos»): un filtro
 * mal escrito enseña de más, nunca una pantalla vacía que se lee como «han
 * desaparecido las citas».
 *
 * @param {string|null} csv
 * @returns {{ ids: string[], incluirSinAsignar: boolean } | null}
 */
export function trocearFiltroDeProfesionales(csv) {
  if (typeof csv !== "string") return null;
  const pedidos = csv.split(",").map((s) => s.trim()).filter(Boolean);
  if (pedidos.length === 0) return null;

  const incluirSinAsignar = pedidos.includes(SIN_PROFESIONAL);
  const ids = pedidos.filter((v) => v !== SIN_PROFESIONAL && UUID_RE.test(v));
  if (ids.length === 0 && !incluirSinAsignar) return null;
  return { ids, incluirSinAsignar };
}
