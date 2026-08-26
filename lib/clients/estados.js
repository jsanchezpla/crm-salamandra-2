/**
 * lib/clients/estados.js — el estado de una ficha: si esa persona viene, si
 * nunca llegó a venir, o si ya no viene.
 *
 * (Fichero nuevo en /lib, regla #2: la lista de estados estaba escrita TRES
 * veces —la ficha base, la ficha de Laura y el listado— con los mismos cinco
 * valores copiados a mano. Tres copias de una lista garantizan que el día que
 * alguien añada un estado, dos pantallas se queden diciendo otra cosa. Aquí es
 * una sola, y la fija `scripts/_smoke-clientes-estados.mjs`.)
 *
 * ── DE QUÉ PETICIÓN NACE (Lau, Aumenta, 14/08/2026) ────────────────────────
 * Lau quería sacar de en medio las fichas de «gente que llamó o dejó sus datos
 * pero nunca llegó a empezar». La primera lectura fue borrarlas, y eso se cayó
 * solo: 21 de esas fichas tienen 127 facturas cobradas repartidas en cinco
 * ejercicios, y `invoices.client_id` es ON DELETE CASCADE. Lo que hacía falta
 * no era borrar a nadie: era **poder decirlo**.
 *
 * ── POR QUÉ NO HACE FALTA NINGUNA COLUMNA NUEVA ───────────────────────────
 * `clients.status` ya es `ENUM('active','inactive','prospect')` y `prospect`
 * estaba sin estrenar: 0 fichas en Aumenta. Es exactamente «no llegó a ser
 * cliente». Así que el estado va en la COLUMNA, no en `customFields`.
 *
 * ⚠️ Y NO es el mismo campo que el chip que se veía hasta hoy. Ese leía el
 * embudo comercial (`customFields.seStatus`), que está **vacío en las 1.083
 * fichas de Aumenta**: el código caía a `"new"` por defecto, así que una
 * familia con cuatro años de historia y 127 facturas salía como «Nuevo».
 * Medido el 26/08/2026 en los siete tenants que tienen fichas: el embudo no lo
 * ha usado nadie nunca — todo valor no vacío es el `new` que pone el alta, o
 * una ficha suelta que alguien tocó una vez.
 *
 * ── SOLO EN PERFIL SALUD, A PROPÓSITO ─────────────────────────────────────
 * En un cliente comercial la columna ya significa otra cosa: la tienda marca
 * `prospect` a quien ha comprado una vez y todavía no es cartera
 * (`lib/tienda/pedidoDesdeTienda.js`), y laura_ubeda tiene sus 183 fichas así.
 * Enseñarles «No vino» sería mentir sobre gente que sí compró. Los comerciales
 * se quedan exactamente como estaban, con su embudo; el día que alguno lo pida,
 * se decide su rótulo y se enciende. Es la regla #16: mismo dato, otro nombre.
 */

import { perfilDeAlta, PERFIL_SALUD } from "./formularioAlta.js";

export const ACTIVO = "active";
export const NO_VINO = "prospect";
export const BAJA = "inactive";

/** Los tres valores de la columna, en el orden en que se enseñan. */
export const ESTADOS_FICHA = [ACTIVO, NO_VINO, BAJA];

const CATALOGO = [
  {
    key: ACTIVO,
    label: "Activo",
    ayuda: "Viene, o se cuenta con que venga.",
    dot: "bg-emerald-400",
    bg: "bg-emerald-100 text-emerald-700",
  },
  {
    key: NO_VINO,
    label: "No vino",
    ayuda:
      "Llamó o dejó sus datos, pero nunca llegó a empezar. La ficha se queda entera; solo deja de reclamar datos que faltan.",
    dot: "bg-amber-400",
    bg: "bg-amber-100 text-amber-700",
  },
  {
    key: BAJA,
    label: "Baja",
    ayuda:
      "Vino y ya no viene. Se conserva entera y se le puede seguir dando hora; deja de reclamar datos que faltan.",
    dot: "bg-neutral-400",
    bg: "bg-neutral-200 text-neutral-600",
  },
];

/**
 * ¿Esta ficha usa el estado de la columna, o el embudo comercial de siempre?
 *
 * `tieneModulo` es `hasModule` del contexto (servidor) o un `Set.has` (cliente),
 * igual que en `perfilDeAlta`: se pregunta por MÓDULO y nunca por slug.
 */
export function usaEstadoDeFicha(tieneModulo) {
  return usaEstadoDePerfil(perfilDeAlta(tieneModulo));
}

/**
 * Lo mismo para quien YA tiene el perfil resuelto: las fichas lo reciben como
 * prop desde la página, y volver a deducirlo de los módulos en el cliente sería
 * calcular dos veces la misma respuesta con dos fuentes distintas.
 */
export function usaEstadoDePerfil(perfil) {
  return perfil === PERFIL_SALUD;
}

/** Los tres estados con su rótulo y su color, para pintar el selector. */
export function estadosDeFicha() {
  return CATALOGO.map((e) => ({ ...e }));
}

/** Lo que se lee en el chip. Un valor desconocido se dice tal cual, no se traga. */
export function etiquetaDeEstado(estado) {
  return CATALOGO.find((e) => e.key === estado)?.label ?? String(estado ?? "");
}

/** El color del chip. Sin estado conocido, el de «Activo», que es el defecto de la columna. */
export function tonoDeEstado(estado) {
  const e = CATALOGO.find((x) => x.key === estado) ?? CATALOGO[0];
  return { dot: e.dot, bg: e.bg };
}

/** ¿Es uno de los tres? Lo usa el endpoint: el valor llega por el cuerpo del PUT. */
export function esEstadoDeFicha(valor) {
  return ESTADOS_FICHA.includes(String(valor ?? "").trim());
}

/**
 * ¿Esta ficha deja de reclamar los datos que le faltan?
 *
 * «No vino» y «Baja» son distintas para quien lee la ficha —una nunca empezó,
 * la otra terminó— pero para «Fichas a completar» son lo mismo: no hay que
 * perseguir el teléfono de alguien que no viene. Se escribe aquí y no en el
 * SQL de `urgentes.js` para que añadir un cuarto estado no se olvide de una de
 * las dos pantallas.
 */
export function dejaDeReclamar(estado) {
  return estado === NO_VINO || estado === BAJA;
}
