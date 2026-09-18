/**
 * tiposDeBono — qué tipos de cita son BONOS y cuáles son citas sueltas
 * (18/09/2026, AV-… de Aumenta: «al crear un bono, al elegir el tipo de bono
 * que solo salgan las citas con bono y no todas»).
 *
 * ── POR QUÉ HACÍA FALTA ────────────────────────────────────────────────────
 * El desplegable de «Tipo de bono» se llenaba con el catálogo ENTERO porque
 * `/api/billing/bonos/tipos?todos=1` no lo recorta. En Aumenta eso son 72
 * tipos de cita (medido en producción el 18/09/2026) de los que solo CINCO
 * tienen algo que ver con bonos: 2 que el catálogo declara pack
 * (`sessionsCount > 1`) y 3 sueltos que ya llevan bonos dados. Buscar entre 72
 * lo que está en 5 es cómo se da un bono del tipo equivocado.
 *
 * ── LA REGLA, Y POR QUÉ NO ES SOLO «ES PACK» ───────────────────────────────
 * Un tipo es de bono si:
 *   · el catálogo lo declara pack (`sessionsCount > 1`) —el bono que el centro
 *     vende, aunque no lo haya comprado nadie todavía—, o
 *   · ya tiene bonos dados, vivos o cerrados, aunque hoy sea una cita suelta.
 *     Pasa de verdad (los tres de Aumenta): se vende un bono de 4 sesiones
 *     sobre un tipo normal, o se pasa el tipo a suelto después. Esconderlos
 *     sería esconder dinero, y al corregir uno no se encontraría su tipo.
 *
 * Es la misma regla que ya usaban por su cuenta la puerta de los grupos
 * (`/api/billing/bonos/tipos` sin `?todos=1`) y el filtro de `/facturacion/
 * bonos`; aquí tiene nombre y prueba en vez de estar copiada en tres sitios.
 *
 * ── EL RESTO NO SE BORRA, SE GUARDA DETRÁS ─────────────────────────────────
 * `repartirTiposDeBono` no filtra: PARTE. Dar un bono de 4 sesiones sobre un
 * tipo suelto es legítimo y se sigue pudiendo —el cajón enseña los otros con
 * un clic—, pero deja de ser lo primero que hay que descartar 67 veces.
 *
 * Puro, sin ORM: lo usan el navegador (los dos cajones de alta) y su prueba.
 * Lee los tres nombres con los que viaja el mismo dato —`sesionesDelTipo` (la
 * puerta de Facturación), `sesiones` (la ficha del cliente) y `sessionsCount`
 * (el EventType crudo de `/api/citas/event-types`)— para que quien lo llame no
 * tenga que normalizar antes.
 */

/** Las sesiones que el CATÁLOGO da a este tipo hoy (1 si no lo dice). */
export function sesionesDelCatalogo(tipo) {
  const n = Number(tipo?.sesionesDelTipo ?? tipo?.sesiones ?? tipo?.sessionsCount ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Cuántos bonos se han dado de este tipo, vivos y cerrados (0 si no viene). */
export function bonosDados(tipo) {
  const vivos = Number(tipo?.bonos) || 0;
  const cerrados = Number(tipo?.cerrados) || 0;
  return Math.max(0, vivos) + Math.max(0, cerrados);
}

/** ¿Este tipo de cita lleva bono? (ver la cabecera: pack del catálogo o con bonos dados) */
export function esTipoDeBono(tipo) {
  return sesionesDelCatalogo(tipo) > 1 || bonosDados(tipo) > 0;
}

/**
 * Parte el catálogo en los tipos de bono y el resto, conservando el orden.
 *
 * `hayResto` es lo que decide si el cajón enseña el «ver todos»: sin resto no
 * hay nada que abrir y el enlace sería una promesa vacía.
 */
export function repartirTiposDeBono(tipos = []) {
  const lista = Array.isArray(tipos) ? tipos : [];
  const deBono = lista.filter((t) => esTipoDeBono(t));
  const resto = lista.filter((t) => !esTipoDeBono(t));
  return { deBono, resto, hayResto: resto.length > 0 };
}

/**
 * Los que se PUEDEN DAR hoy: fuera lo que ya no está en el catálogo.
 *
 * La puerta de los grupos (`/api/billing/bonos/tipos`) inventa una fila por cada
 * tipo que tiene bonos y ya no existe —«(tipo de bono borrado del catálogo)»,
 * `enElCatalogo: false`—, y hace bien: es dinero que hay que poder ver y
 * filtrar. Lo que no se puede es DARLO otra vez; en el desplegable del alta esa
 * fila solo es una trampa (nutri_laura tiene una).
 *
 * Por eso no vive dentro de `repartirTiposDeBono`: el filtro de
 * `/facturacion/bonos` sí quiere enseñarla, y el cajón del alta no. Son dos
 * preguntas distintas —«¿lleva bono?» y «¿se puede dar?»— y se responden aparte.
 *
 * Quien no diga nada (los tipos crudos de `/api/citas/event-types`, que no
 * traen el campo) se queda: no saber no es lo mismo que estar borrado.
 */
export function tiposQueSePuedenDar(tipos = []) {
  const lista = Array.isArray(tipos) ? tipos : [];
  return lista.filter((t) => t?.enElCatalogo !== false);
}

/**
 * Los que enseña el desplegable.
 *
 * ⚠️ Con `todos` apagado pero SIN un solo tipo de bono devuelve el catálogo
 * entero: un centro que aún no ha puesto las sesiones a ningún tipo (hoy,
 * `demo_clinica`) se quedaría con un desplegable vacío y sin forma de dar su
 * primer bono. Un desplegable vacío no enseña la regla, parece roto.
 */
export function tiposParaElegirBono(tipos = [], { todos = false } = {}) {
  const { deBono } = repartirTiposDeBono(tipos);
  if (todos || deBono.length === 0) return Array.isArray(tipos) ? tipos : [];
  return deBono;
}
