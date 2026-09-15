/**
 * lib/clients/organizaciones.js — Empresas y universidades con ficha propia
 * (15/09/2026, Rodrigo, a raíz del AV-0153 de Aumenta).
 *
 * (Fichero nuevo en /lib, regla #2: el tipo de ficha lo leen el listado, su
 * Excel, la ficha, el alta y Cobros. Copiada en cinco sitios, el filtro de un
 * sitio acabaría contando otra cosa que el de al lado.)
 *
 * ── QUÉ SE MODELA ───────────────────────────────────────────────────────────
 * Hay fichas que no son una persona ni una familia: la UNIVERSIDAD que manda
 * alumnos en prácticas y la EMPRESA con la que hay un acuerdo (las consultas
 * externas). En Aumenta ya existían así —vinieron de Organízate: la ficha de
 * UNIR paga y sus alumnos cuelgan de ella como pacientes—, pero nada las
 * distinguía de una familia y solo se encontraban con el buscador.
 *
 *   · `clients.tipo_ficha`        NULL (particular) | 'empresa' | 'universidad'.
 *   · `clients.universidad_id`    el alumno en prácticas → la ficha de su universidad.
 *   · `clients.empresa_id`        quien viene por una empresa → la ficha de la empresa.
 *   · `clients.pago_organizacion_pct`  cuánto de lo suyo paga esa universidad o
 *     empresa: 100 = todo, 0 = nada, entre medias = se reparte. NULL = sin decir.
 *
 * Donde los alumnos son PACIENTES de la ficha de la universidad (Aumenta) no
 * hace falta nada de lo de abajo: la universidad ya es quien paga.
 */

// Sin `import { Op } from "sequelize"` a propósito: este fichero lo importa
// también la ficha (componente de cliente), y con él el navegador se bajaría
// Sequelize entero. `{ columna: null }` ya es `IS NULL` para Sequelize.

export const TIPOS_FICHA = Object.freeze([
  { key: "particular", label: "Clientes", singular: "Cliente" },
  { key: "empresa", label: "Empresas", singular: "Empresa" },
  { key: "universidad", label: "Universidades", singular: "Universidad" },
]);

/** El valor que se guarda en la columna: NULL para el particular. */
export function normalizarTipoFicha(valor) {
  const t = String(valor ?? "").trim().toLowerCase();
  if (t === "empresa" || t === "universidad") return t;
  return null;
}

/** ¿Es un filtro de tipo que se entiende? «Todos» no filtra. */
export function esTipoDeFiltro(valor) {
  return TIPOS_FICHA.some((t) => t.key === valor);
}

/**
 * El trozo de `where` del filtro «Clientes / Empresas / Universidades».
 * `null` = no filtra (valor ausente o desconocido, como el resto de filtros).
 */
export function filtroPorTipoFicha(valor) {
  if (!esTipoDeFiltro(valor)) return null;
  if (valor === "particular") return { tipoFicha: null };
  return { tipoFicha: valor };
}

/** Qué columna lleva el vínculo con cada tipo de organización. */
export const CAMPO_VINCULO = Object.freeze({ universidad: "universidadId", empresa: "empresaId" });

/**
 * El porcentaje que paga la organización, limpio: entero o con dos decimales,
 * entre 0 y 100. Vacío = sin decir (NULL). Fuera de rango = `undefined`, que
 * la API convierte en un 422.
 */
export function normalizarPctOrganizacion(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(String(valor).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return Math.round(n * 100) / 100;
}

/**
 * La organización que paga (toda o una parte) lo de esta ficha, o null.
 *
 * Si la ficha es alumno en prácticas CON universidad, manda la universidad; si
 * no, la empresa. Una persona que fuera las dos cosas a la vez es rarísima, y
 * entonces se factura a la de las prácticas, que es la que la ficha marca.
 */
export function organizacionQuePaga(ficha) {
  if (!ficha) return null;
  const pct = ficha.pagoOrganizacionPct == null ? null : Number(ficha.pagoOrganizacionPct);
  if (ficha.esAlumnoPracticas && ficha.universidadId) {
    return { id: String(ficha.universidadId), tipo: "universidad", pct };
  }
  if (ficha.empresaId) return { id: String(ficha.empresaId), tipo: "empresa", pct };
  return null;
}

/**
 * Parte un importe entre la organización y la persona, en CÉNTIMOS: la suma de
 * las dos partes es siempre el importe exacto (el céntimo del redondeo se lo
 * queda la persona, que es la que recibe la factura pequeña).
 *
 * @returns {{ organizacion: number, persona: number }} en euros con 2 decimales
 */
export function repartirConOrganizacion(importe, pct) {
  const total = Math.round(Number(importe) * 100);
  if (!Number.isFinite(total) || total <= 0) return { organizacion: 0, persona: 0 };
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  const org = Math.floor((total * p) / 100);
  return { organizacion: org / 100, persona: (total - org) / 100 };
}

/**
 * Cómo queda un cobro nuevo de esta ficha si se reparte con su organización:
 * la lista de filas que hay que crear, cada una con su `clientId` y su importe.
 * Sin organización o sin porcentaje, UNA fila a nombre de la ficha (lo de
 * siempre). Nunca devuelve una fila de 0 €.
 */
export function filasDelCobroRepartido({ clientId, importe, organizacion }) {
  const entera = [{ clientId: String(clientId), importe: Math.round(Number(importe) * 100) / 100, parte: null }];
  if (!organizacion?.id || organizacion.pct == null || !(Number(organizacion.pct) > 0)) return entera;
  const { organizacion: deOrg, persona } = repartirConOrganizacion(importe, organizacion.pct);
  const filas = [];
  if (deOrg > 0) filas.push({ clientId: organizacion.id, importe: deOrg, parte: "organizacion" });
  if (persona > 0) filas.push({ clientId: String(clientId), importe: persona, parte: "persona" });
  return filas.length ? filas : entera;
}
