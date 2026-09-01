/**
 * lib/citas/categoriasBloqueo.js — de QUÉ es un bloqueo de agenda, y de qué
 * color se pinta esa clase de bloqueo en todo el centro (01/09/2026, Rodrigo).
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Dentro de bloqueos, poder hacer categorías. Las categorías de Aumenta son:
 * reunión de equipo, trabajo interno, gestión documental, valoraciones, libre
 * de pacientes, descanso. Tiene que tener color personalizable desde Admin para
 * que a todo el equipo le salga igual.»
 *
 * ── POR QUÉ NO BASTABA CON LA ETIQUETA ──────────────────────────────────────
 * Un bloqueo ya tenía `label`, pero es TEXTO LIBRE, y texto libre escrito por
 * quince personas no es una categoría: en producción «Reservado T.I.» convive
 * con «Reservado T.I» y «Reservado t.i.», y `lib/clinica/trabajoInterno.js`
 * tiene que normalizar minúsculas, tildes y puntos para que el sumatorio de
 * Productividad no se parta en tres. Eso es adivinar. Con una categoría de
 * verdad el centro deja de adivinar: se elige de una lista, se cuenta por su
 * clave y se pinta igual para todos.
 *
 * Y ese «igual para todos» es la mitad del encargo. Hasta hoy el color de un
 * bloqueo salía de la PERSONA (su `blockColor`) o, si no tenía, del centro
 * (`settings.citas.colorBloqueos`). Sirve para saber DE QUIÉN es una ausencia,
 * pero no para saber QUÉ es: la reunión de equipo del martes se pintaba de un
 * color en la fila de cada compañera. Por eso el color de la categoría manda
 * sobre el de la persona (ver `coloresBloqueo.js`): una categoría existe
 * justamente para leerse igual en toda la agenda.
 *
 * ── DÓNDE VIVE ──────────────────────────────────────────────────────────────
 * En `master.tenants.settings.citas.categoriasBloqueo`, el mismo mecanismo que
 * `settings.clinica.plantillas`, `referralSpecialties` o `performanceRoles`:
 * JSONB en master, sin tabla nueva. **La escribe el admin** (lo pidió así:
 * «personalizable desde Admin»), desde Configuración → Agenda.
 *
 * ── NACE VACÍA, A PROPÓSITO ─────────────────────────────────────────────────
 * Sin categorías guardadas la lista es `[]` y un bloqueo se comporta EXACTAMENTE
 * como ayer: su etiqueta libre, su color de persona o de centro. Las seis de
 * abajo son las de un centro clínico y se cargan con un botón («las de fábrica»)
 * o con `scripts/seed-categorias-bloqueo.js`; no se le meten a todo el mundo,
 * porque «Valoraciones» o «Libre de pacientes» no significan nada en una agencia
 * de management. El campo es opcional en todos los tenants y no estorba a quien
 * no lo use.
 *
 * ── LA CLAVE NO SE RENOMBRA NUNCA ───────────────────────────────────────────
 * Misma regla que los apartados de `lib/clinica/plantillas.js`: los bloqueos ya
 * guardados apuntan a la clave. Cambiar el título de una categoría cambia el
 * rótulo de la agenda, no a qué pertenecen los 300 bloqueos que ya la usaban.
 * Y borrar una categoría no rompe nada: sus bloqueos se quedan sin categoría
 * conocida y vuelven a pintarse con el color de siempre.
 */

import { COLOR_BLOQUEO_POR_DEFECTO } from "./coloresBloqueo.js";

/**
 * Las seis de Aumenta, con un color de arranque cada una (01/09/2026).
 *
 * Los colores son oscuros a propósito: `colorTextoSobre` les pone letra blanca
 * y la agenda se lee de un vistazo. Son un punto de partida —el centro los
 * cambia desde Configuración— pero tienen que salir distinguibles entre sí ya
 * de fábrica, o el primer día la agenda es un bloque del mismo tono.
 */
export const CATEGORIAS_CLINICA_BASE = Object.freeze([
  { key: "reunion_equipo", label: "Reunión de equipo", color: "#2563EB" },
  { key: "trabajo_interno", label: "Trabajo interno", color: "#7C3AED" },
  { key: "gestion_documental", label: "Gestión documental", color: "#B45309" },
  { key: "valoraciones", label: "Valoraciones", color: "#0F766E" },
  { key: "libre_pacientes", label: "Libre de pacientes", color: "#64748B" },
  { key: "descanso", label: "Descanso", color: "#DB2777" },
]);

/** Tope de sentido común: una lista más larga no se elige, se busca. */
export const MAX_CATEGORIAS = 24;
const MAX_LABEL = 60;

/** Las claves de fábrica son `snake_case`; las nuevas salen del slug del título. */
const CLAVE_RE = /^[a-z][a-z0-9_]{0,47}$/;
const HEX_RE = /^#[0-9A-F]{6}$/;

/**
 * «Gestión documental» → `gestion_documental`. Sin tildes, sin eñes y sin
 * signos: la clave viaja en la URL de un filtro y se compara con `===`.
 */
export function claveDesdeTitulo(titulo) {
  const base = String(titulo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  // Una clave tiene que empezar por letra: «1 a 1» daría `1_a_1`, que no pasa
  // el patrón y dejaría la categoría sin sitio donde guardarse.
  return /^[a-z]/.test(base) ? base : `cat_${base}`.slice(0, 48).replace(/_+$/, "");
}

/**
 * Deja una lista de categorías como se guarda, o `[]` si no hay nada
 * aprovechable. Tolerante con lo escrito a mano y con lo que llegue roto: esto
 * acaba en un JSONB de master y lo lee la agenda de todo el mundo.
 *
 * @param lista    lo que manda el navegador
 * @param previas  las que ya estaban, para CONSERVAR la clave de las que solo
 *                 cambian de título (ver cabecera).
 */
export function normalizarCategorias(lista, { previas = [] } = {}) {
  if (!Array.isArray(lista)) return [];

  // Título de antes → su clave. Renombrar «Descanso» a «Pausa» tiene que dejar
  // los bloqueos donde estaban, así que primero se busca por la clave que venga
  // y, si no viene, por el título anterior.
  const porClave = new Map(previas.filter((c) => c?.key).map((c) => [c.key, c]));

  const salida = [];
  const usadas = new Set();

  for (const cruda of lista) {
    if (!cruda || typeof cruda !== "object") continue;

    const label = String(cruda.label ?? "").trim().slice(0, MAX_LABEL);
    if (!label) continue; // una categoría sin título no se puede elegir

    // La clave: la que venga si es válida y ya existía, o una nueva del título.
    let key = typeof cruda.key === "string" ? cruda.key.trim().toLowerCase() : "";
    if (!CLAVE_RE.test(key)) key = "";
    if (key && !porClave.has(key) && usadas.has(key)) key = "";
    if (!key) key = claveDesdeTitulo(label);
    if (!CLAVE_RE.test(key)) continue;

    // Dos categorías con la misma clave se comerían la una a la otra al pintar.
    if (usadas.has(key)) {
      let n = 2;
      while (usadas.has(`${key}_${n}`) && n < 50) n += 1;
      key = `${key}_${n}`;
      if (!CLAVE_RE.test(key)) continue;
    }

    const color = limpiaColorCategoria(cruda.color);
    salida.push({ key, label, color: color ?? COLOR_BLOQUEO_POR_DEFECTO });
    usadas.add(key);

    if (salida.length >= MAX_CATEGORIAS) break;
  }

  return salida;
}

/**
 * `#2563eb ` → `#2563EB`, y `null` a lo que no sea un hex de seis. Se guarda en
 * mayúsculas como el resto de colores del CRM (`limpiaColorBloqueo`).
 */
export function limpiaColorCategoria(valor) {
  if (typeof valor !== "string") return null;
  const v = valor.trim().toUpperCase();
  return HEX_RE.test(v) ? v : null;
}

/**
 * Las categorías EFECTIVAS de un centro: las suyas, o ninguna.
 *
 * Nunca cae a las de fábrica sola. Cargarlas es una decisión del centro (un
 * botón en Configuración), no algo que le pase por la espalda a un cliente que
 * no las ha pedido — ver cabecera.
 */
export function categoriasDe(tenant) {
  const guardadas = tenant?.settings?.citas?.categoriasBloqueo;
  if (!Array.isArray(guardadas)) return [];
  // Se normaliza también AL LEER: una config escrita a mano en la base, o de una
  // versión anterior, no puede tumbar la agenda.
  return normalizarCategorias(guardadas, { previas: guardadas });
}

/** La categoría de una clave, o `null` si ya no existe (se borró). */
export function categoriaDe(key, categorias) {
  if (!key || !Array.isArray(categorias)) return null;
  return categorias.find((c) => c.key === key) ?? null;
}

/**
 * La clave que se guarda en el bloqueo: la que venga si el centro la tiene dada
 * de alta, o `null`. Inventarse una categoría desde el navegador no vale — la
 * lista la decide dirección.
 */
export function claveValida(key, categorias) {
  const limpia = typeof key === "string" ? key.trim().toLowerCase() : "";
  if (!limpia) return null;
  return categoriaDe(limpia, categorias) ? limpia : null;
}
