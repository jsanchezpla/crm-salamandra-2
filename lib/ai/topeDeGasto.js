/**
 * lib/ai/topeDeGasto.js — las reglas del TOPE MENSUAL de gasto de IA de un
 * centro (14/09/2026). Puro: sin base, sin red, sin nada de servidor.
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * El 10/09/2026, a media tarde, la cuenta de Anthropic de Aumenta se quedó sin
 * saldo con doce personas usando la IA. Nada avisó ANTES: el único aviso
 * (`lib/ai/avisoDeCuentaIa.js`) salta cuando el proveedor ya ha rechazado la
 * llamada, y para entonces no hay nada que hacer hasta que alguien recarga.
 * Desde el 11/09 `master.ai_uso` guarda lo que cuesta cada llamada, pero nadie
 * lo comparaba con nada. Con esto, dirección fija un tope al mes (en € o en $)
 * en Configuración → Conexiones: al 80 % se le avisa por la campana y al 100 %
 * quien no es administrador deja de poder usar la IA hasta el día 1.
 *
 * ── POR QUÉ EN /lib Y POR QUÉ DOS FICHEROS (regla #2) ──────────────────────
 * Estas reglas las usan `vetoAi` (`lib/ai/aiAccess.js`), el portal público de
 * Soporte, el PATCH y el GET de `/api/tenant/settings`, el GET de consumo y la
 * tarjeta `modules/config/tarjetas/TopeIA.jsx`, que es de CLIENTE. Por eso
 * este fichero solo importa `./precios.js` y `../utils/madridDate.js`, puros
 * los dos: cualquier import de servidor (Sequelize, la base) acabaría en el
 * paquete del navegador y rompería el build. Lo que sí toca la base —sumar el
 * gasto del mes y poner la campana— vive en `lib/ai/frenoDeGasto.js`. Es el
 * mismo reparto que `proveedores.js` frente a `proveedorIa.js`. Lo vigila una
 * prueba (`scripts/_smoke-tope-gasto-ia.mjs`).
 *
 * ── LO QUE NO ES ───────────────────────────────────────────────────────────
 * No es el saldo de la cuenta: con clave propia (BYOK) no hay forma de leerlo.
 * Es la suma del coste ESTIMADO de `master.ai_uso` (Claude, ChatGPT y Whisper
 * juntos, con precios públicos). No ve lo gastado con la misma clave fuera del
 * CRM. Para un corte exacto, el límite se pone también en la consola del
 * proveedor, y la tarjeta lo dice.
 *
 * ── COMPARAR EN ENTEROS ────────────────────────────────────────────────────
 * Nunca se compara una proporción en coma flotante: con 60 € de tope (66 $),
 * 52,80 / 66 da 0.7999999999999999 y el aviso del 80 % no saldría mientras la
 * tarjeta dice «80 %». Todo se pasa a micro-dólares enteros antes de comparar.
 */

import { USD_POR_EUR } from "./precios.js";
import { madridYearMonth } from "../utils/madridDate.js";

/** A partir de qué porcentaje del tope se avisa a los administradores. */
export const TRAMO_DE_AVISO = 80;
/** Importe mínimo y máximo de un tope, en su moneda. */
export const LIMITES_DEL_TOPE = Object.freeze({ min: 1, max: 5000 });
export const MONEDAS_DEL_TOPE = Object.freeze(["EUR", "USD"]);
/** Lo que lleva la respuesta 429 de un freno, para que una pantalla lo distinga. */
export const MOTIVO_TOPE = "tope_ia";
/** El `type` de la campana del 80 % y del 100 %. */
export const TIPO_AVISO_TOPE = "ia_tope";

const PROBLEMA_IMPORTE = "El tope tiene que ser un importe entre 1 y 5.000.";
const PROBLEMA_MONEDA = "La moneda del tope es € o $.";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const micro = (usd) => Math.round((Number(usd) || 0) * 1_000_000);

/*
 * Lo que teclea una persona en España: «60», «60,5», «1.500» o «1.500,25».
 * Con coma, los puntos son de miles; sin coma, un punto seguido de grupos de
 * tres cifras también («1.500» son mil quinientos, no uno y medio). El resto,
 * número normal. Devuelve NaN si no es un número.
 */
function numeroTecleado(x) {
  if (typeof x === "number") return x;
  let s = String(x).replace(/[\s€$]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/*
 * Dos decimales redondeando como se redondea a mano (60,555 → 60,56). Con
 * `Math.round(n * 100)` saldría 60,55, porque 60.555 se guarda como
 * 60.55499999…; subiendo el exponente en el TEXTO no hay ese error.
 */
function dosDecimales(n) {
  const porExponente = Math.round(Number(`${n}e2`)) / 100;
  return Number.isFinite(porExponente) ? porExponente : Math.round(n * 100) / 100;
}

/**
 * Lo que llega del PATCH, listo para guardar.
 *   `null`, `""`, `undefined` o `{ importe: null | "" }` → `{ valor: null }` (quitar el tope)
 *   `{ importe, moneda? }` → `{ valor: { importe, moneda } }` con 2 decimales y
 *   € por defecto; fuera de 1–5.000 o sin moneda válida → `problema` con la frase.
 * Cualquier otra clave se descarta: añadir mañana un `modo` no exige migrar.
 */
export function topeParaGuardar(entrada) {
  if (entrada === null || entrada === undefined || entrada === "") return { valor: null, problema: null };
  let importeCrudo;
  let monedaCruda;
  if (typeof entrada === "number" || typeof entrada === "string") {
    importeCrudo = entrada;
  } else if (typeof entrada === "object" && !Array.isArray(entrada)) {
    importeCrudo = entrada.importe;
    monedaCruda = entrada.moneda;
  } else {
    return { valor: null, problema: PROBLEMA_IMPORTE };
  }
  if (importeCrudo === null || importeCrudo === undefined || String(importeCrudo).trim() === "") {
    return { valor: null, problema: null };
  }
  const n = numeroTecleado(importeCrudo);
  if (!Number.isFinite(n)) return { valor: null, problema: PROBLEMA_IMPORTE };
  const importe = dosDecimales(n);
  if (importe < LIMITES_DEL_TOPE.min || importe > LIMITES_DEL_TOPE.max) return { valor: null, problema: PROBLEMA_IMPORTE };
  const moneda = monedaCruda === undefined || monedaCruda === null || monedaCruda === "" ? "EUR" : monedaCruda;
  if (!MONEDAS_DEL_TOPE.includes(moneda)) return { valor: null, problema: PROBLEMA_MONEDA };
  return { valor: { importe, moneda }, problema: null };
}

/**
 * El tope guardado en `settings.integrations`, leído con TOLERANCIA: lo que no
 * tenga un importe positivo o una moneda conocida cuenta como «sin tope» (un
 * JSON a medias no puede frenar a nadie). Moneda ausente → €.
 */
export function leerTope(integrations) {
  const t = integrations?.iaTopeMensual;
  if (!t || typeof t !== "object" || Array.isArray(t)) return null;
  const importe = typeof t.importe === "number" ? t.importe : Number.NaN;
  if (!Number.isFinite(importe) || importe <= 0) return null;
  const moneda = t.moneda === undefined || t.moneda === null ? "EUR" : t.moneda;
  if (!MONEDAS_DEL_TOPE.includes(moneda)) return null;
  return { importe, moneda };
}

/** El tope en dólares, que es en lo que se apunta el coste (6 decimales). */
export function topeEnUsd({ importe, moneda }) {
  const usd = moneda === "USD" ? Number(importe) : Number(importe) * USD_POR_EUR;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * Cómo va el mes frente al tope.
 *   `sin_tope` · `bien` (menos del 80 %) · `aviso` (80 % o más) · `alcanzado` (100 % o más)
 * `porcentaje` va redondeado hacia abajo: con el 99,9 % se dice 99, no 100.
 */
export function estadoDelTope({ gastadoUsd, tope }) {
  if (!tope) return { nivel: "sin_tope" };
  const topeUsd = topeEnUsd(tope);
  const g = Math.max(0, micro(gastadoUsd));
  const t = micro(topeUsd);
  if (t <= 0) return { nivel: "sin_tope" };
  const porcentaje = Math.floor((g * 100) / t);
  const nivel = g >= t ? "alcanzado" : g * 100 >= t * TRAMO_DE_AVISO ? "aviso" : "bien";
  return { nivel, porcentaje, gastadoUsd: g / 1_000_000, topeUsd, importe: tope.importe, moneda: tope.moneda };
}

/**
 * Qué se hace con una llamada. El administrador NUNCA se frena (es quien puede
 * subir el tope), pero su uso también dispara las campanas.
 */
export function decidirConTope(estado, { esAdmin = false } = {}) {
  const nivel = estado?.nivel;
  return {
    permitir: !(nivel === "alcanzado" && !esAdmin),
    avisarTramo: nivel === "aviso" ? TRAMO_DE_AVISO : nivel === "alcanzado" ? 100 : null,
  };
}

function formatear(n, moneda) {
  const texto = (Number(n) || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${texto} ${moneda === "USD" ? "$" : "€"}`;
}

/** Unos dólares en la moneda del tope: «48,00 €» (convertidos) o «52,80 $». */
export function importeEnMoneda(usd, moneda) {
  return formatear(moneda === "USD" ? Number(usd) : (Number(usd) || 0) / USD_POR_EUR, moneda);
}

/** El importe de un tope tal cual se fijó: «60,00 €». Sin ida y vuelta por dólares. */
export function importeDelTope(tope) {
  return formatear(tope?.importe, tope?.moneda);
}

/** «1 de octubre»: el día que vuelve la IA, con el mes de MADRID. */
export function primeroDelMesSiguiente(ahora = new Date()) {
  const { month } = madridYearMonth(ahora);
  return `1 de ${MESES[month % 12]}`;
}

/**
 * La frase de quien se frena. Sin cifras (el gasto es cosa de dirección) y sin
 * «saldo»: el saldo de la cuenta puede estar lleno; lo que se ha alcanzado es
 * un tope que ha puesto el centro.
 */
export function mensajeDeTopeAlcanzado(ahora = new Date()) {
  return `Este mes el centro ha llegado al tope de gasto de IA que ha fijado dirección. La IA vuelve el ${primeroDelMesSiguiente(ahora)}, o antes si dirección sube el tope en Configuración → Conexiones.`;
}

/**
 * La razón corta, para la IA que no pasa por `vetoAi` y no tiene a quién
 * responder (el portal de Soporte la pone en «Sin clasificar: …» de la campana
 * `ticket_new`).
 */
export const FRASE_CORTA_DE_TOPE = "el centro ha llegado al tope de gasto de IA de este mes";

/** Título y cuerpo de la campana de los administradores, en la moneda del tope. */
export function textoDelAvisoDeTope(estado, tramo, ahora = new Date()) {
  const cifras = `${importeEnMoneda(estado?.gastadoUsd, estado?.moneda)} de ${importeDelTope(estado)}.`;
  if (tramo === 100) {
    return {
      title: "Tope de IA alcanzado: el equipo no puede usarla hasta el día 1",
      body: `${cifras} Los administradores pueden seguir usándola. Puedes subir el tope en Configuración → Conexiones.`,
    };
  }
  return {
    title: `La IA ha llegado al ${TRAMO_DE_AVISO} % del tope de este mes`,
    body: `${cifras} Al llegar al 100 %, quien no es administrador no podrá usar la IA hasta el ${primeroDelMesSiguiente(ahora)}. Puedes subir el tope en Configuración → Conexiones.`,
  };
}

/** Cómo se escribe un tope en la auditoría y en el recibo por correo: «60,00 € al mes». */
export function resumenDelTope(v) {
  const t = leerTope({ iaTopeMensual: v });
  return t ? `${importeDelTope(t)} al mes` : "(sin tope)";
}
