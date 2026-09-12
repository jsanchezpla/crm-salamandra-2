/**
 * lib/clinica/diagnostico.js — el EXPEDIENTE de diagnóstico de un paciente:
 * qué productos hay, en qué estado está y cuántas horas lleva (12/09/2026,
 * Rodrigo con Isa, Aumenta).
 *
 * (Fichero nuevo en /lib, regla #2: la barra de horas la pintan la lista de
 * Diagnósticos, la ficha de la cita y el chip del calendario; el tope lo
 * comprueba el alta de citas; los productos los leen el alta del expediente y
 * el cobro. Escrito en cada sitio, la primera hora que uno contara distinto
 * dejaría a una familia con 11 h en un producto de 10. PURO a propósito: sin
 * ORM ni base de datos, para que lo importe también el navegador.)
 *
 * ── QUÉ ES UN DIAGNÓSTICO AQUÍ ─────────────────────────────────────────────
 * Un producto cerrado de horas —simple: 10 h (1 de entrevista + 9); completo:
 * 20 h (1 + 19)— que un paciente contrata, con un terapeuta asignado y una
 * barra 0→10 o 0→20 que se CALCULA desde las citas. Nunca un contador
 * guardado: la misma lección que los bonos (`lib/citas/packs.js`) — un
 * contador hay que acordarse de moverlo en cada cancelación, reprogramación y
 * falta, y basta olvidar uno para que mienta. Las citas son la verdad.
 *
 * ── QUÉ CUENTA COMO HORA ───────────────────────────────────────────────────
 * La regla de los bonos, sin inventar otra (`lib/citas/gastaSesion.js`):
 * completada, falta injustificada y cancelación tardía CUENTAN; cancelada a
 * tiempo o falta justificada NO; una cita futura RESERVA (suma a la barra y
 * bloquea el hueco). Cada cita vale `duration / 60` horas, salvo la entrevista,
 * que vale 1 sea cual sea su duración: es UNA entrevista, no un tramo de horas.
 * Si la entrevista se cancela tarde y se repite, la primera cuesta 1 h de las
 * hechas, igual que le costaría una sesión a un bono.
 *
 * ── EL FLUJO, EN ESTADOS ───────────────────────────────────────────────────
 *   entrevista  → nace el expediente y se abre la entrevista inicial (sin dinero)
 *   no_continua → «Parar»: cobro pendiente de la entrevista (50 €)
 *   en_curso    → «Seguir»: bono SIN TOPE del tipo DIAGNÓSTICO y cobro pendiente
 *                 del producto (la entrevista va dentro del precio)
 *   cerrado     → a mano; la unión con el informe es la segunda entrega
 *
 * Lo que no está aquí, a propósito: las filas (modelo `Diagnostico`), quién
 * puede parar/seguir/desbloquear (`lib/citas/quienDaBonos.js`, la misma regla
 * que dar bonos) y el bono en sí (`lib/citas/packs.js`, `estadoPack` con
 * `totalSessions` a null = sin tope).
 */

import { gastaSesion, reservaSesion } from "../citas/gastaSesion.js";
import { TRAMO_ENTREVISTA, DURACION_ENTREVISTA_MIN, duracionLimpia } from "../citas/altaDesdeDiagnostico.js";

export { TRAMO_ENTREVISTA, TRAMO_HORAS, TRAMOS, duracionLimpia } from "../citas/altaDesdeDiagnostico.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A dos decimales: las horas van de media en media y así la suma no arrastra decimales fantasma. */
const redondea = (n) => Math.round(Number(n) * 100) / 100;

// ── Productos ───────────────────────────────────────────────────────────────

/**
 * Los productos de fábrica. `conceptId` a null = el concepto se busca por
 * nombre entre los activos del catálogo (`conceptoDeProducto`). `precioEuros`
 * es la CAÍDA cuando no hay concepto que lo diga: en Aumenta «Diagnóstico
 * Simple» vale 350 € y «Diagnóstico Completo» 650 €, y el cobro sale del
 * concepto; sin concepto, de aquí.
 */
export const PRODUCTOS_DE_FABRICA = Object.freeze([
  Object.freeze({ key: "simple", nombre: "Diagnóstico simple", horas: 10, conceptId: null, precioEuros: 350 }),
  Object.freeze({ key: "completo", nombre: "Diagnóstico completo", horas: 20, conceptId: null, precioEuros: 650 }),
]);

/** Tope de horas de un producto y de un desbloqueo: por encima es una errata. */
export const HORAS_MAX_TOPE = 200;

/** Un producto tal como llega de `settings`, limpio; o null si no vale. */
function normalizaProducto(p) {
  if (!p || typeof p !== "object") return null;
  const key = typeof p.key === "string" ? p.key.trim().toLowerCase() : "";
  if (!/^[a-z0-9_-]{1,40}$/.test(key)) return null;
  const horas = Number(p.horas);
  if (!Number.isFinite(horas) || horas <= 0 || horas > HORAS_MAX_TOPE) return null;
  const nombre =
    typeof p.nombre === "string" && p.nombre.trim() ? p.nombre.trim().slice(0, 120) : `Diagnóstico ${key}`;
  const conceptId = typeof p.conceptId === "string" && UUID_RE.test(p.conceptId) ? p.conceptId : null;
  const precio = Number(p.precioEuros);
  const deFabrica = PRODUCTOS_DE_FABRICA.find((f) => f.key === key);
  const precioEuros = Number.isFinite(precio) && precio >= 0 ? redondea(precio) : (deFabrica?.precioEuros ?? null);
  return Object.freeze({ key, nombre, horas: Math.round(horas * 10) / 10, conceptId, precioEuros });
}

/**
 * Los productos de diagnóstico del centro: `settings.clinica.diagnosticos`
 * (`[{ key, nombre, horas, conceptId }]`), con caída a los de fábrica.
 *
 * La caída es el caso por defecto: ningún centro los tiene guardados hoy. Una
 * lista guardada que no tenga NINGÚN producto válido también cae a fábrica —
 * mejor los dos de siempre que una pantalla sin nada que elegir—; una entrada
 * mal escrita entre otras buenas se descarta sola, y una clave repetida se
 * queda con la primera.
 */
export function productosDe(tenant) {
  const lista = tenant?.settings?.clinica?.diagnosticos;
  if (!Array.isArray(lista)) return PRODUCTOS_DE_FABRICA;
  const vistos = new Set();
  const salida = [];
  for (const p of lista) {
    const n = normalizaProducto(p);
    if (!n || vistos.has(n.key)) continue;
    vistos.add(n.key);
    salida.push(n);
  }
  return salida.length ? Object.freeze(salida) : PRODUCTOS_DE_FABRICA;
}

/** El producto de esa clave para ese centro, o null. */
export function productoDe(tenant, key) {
  const k = String(key ?? "").trim().toLowerCase();
  return productosDe(tenant).find((p) => p.key === k) ?? null;
}

/** Por qué nombre se reconoce el concepto de cada producto de fábrica cuando nadie fijó `conceptId`. */
const NOMBRE_DEL_CONCEPTO = Object.freeze({
  simple: /diagn.*simple/i,
  completo: /diagn.*completo/i,
});

/** Sin acentos, sin mayúsculas, sin espacios de más: para comparar nombres escritos a mano. */
function simplifica(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Qué concepto del catálogo cobra este producto, entre los `conceptos` del
 * centro (filas de `billing_concepts` o su JSON): el fijado por `conceptId`
 * si lo hay, o si no uno ACTIVO por nombre — /diagn.*simple/ y
 * /diagn.*completo/ para los de fábrica, el nombre exacto para uno propio del
 * centro. Null si no hay ninguno: entonces el cobro sale de `precioEuros`.
 */
export function conceptoDeProducto(producto, conceptos = []) {
  if (!producto) return null;
  const lista = Array.isArray(conceptos) ? conceptos.filter(Boolean) : [];
  if (producto.conceptId) return lista.find((c) => String(c.id) === String(producto.conceptId)) ?? null;
  const activos = lista.filter((c) => c.active !== false);
  const re = NOMBRE_DEL_CONCEPTO[producto.key];
  if (re) return activos.find((c) => re.test(String(c.name ?? ""))) ?? null;
  const buscado = simplifica(producto.nombre);
  return buscado ? (activos.find((c) => simplifica(c.name) === buscado) ?? null) : null;
}

// ── Estados ─────────────────────────────────────────────────────────────────

export const ESTADOS = Object.freeze(["entrevista", "no_continua", "en_curso", "cerrado"]);

/** Los que salen en «En curso»; el resto va a «Cerrados». */
export const ESTADOS_ABIERTOS = Object.freeze(["entrevista", "en_curso"]);

export const ROTULO_ESTADO = Object.freeze({
  entrevista: "Entrevista inicial",
  no_continua: "No continúa",
  en_curso: "En curso",
  cerrado: "Cerrado",
});

/*
 * A dónde se puede ir desde cada estado. `no_continua` no vuelve a `en_curso`
 * en esta entrega a propósito: ya nació el cobro de la entrevista, y seguir
 * después obligaría a decidir qué pasa con él. Si alguien lo pide, se abre
 * aquí con su regla, no en un endpoint.
 */
const TRANSICIONES = Object.freeze({
  entrevista: Object.freeze(["no_continua", "en_curso", "cerrado"]),
  no_continua: Object.freeze(["cerrado"]),
  en_curso: Object.freeze(["cerrado"]),
  cerrado: Object.freeze([]),
});

/** ¿Se puede pasar de un estado al siguiente? Un estado desconocido no va a ningún sitio. */
export function puedePasarA(estado, siguiente) {
  return (TRANSICIONES[estado] ?? []).includes(siguiente);
}

/** ¿El expediente sigue vivo (entrevista pendiente o en curso)? */
export function estaAbierto(expediente) {
  return ESTADOS_ABIERTOS.includes(expediente?.status);
}

// ── La entrevista inicial ───────────────────────────────────────────────────

/**
 * Lo fijo de la entrevista inicial de un diagnóstico: cómo se titula la cita,
 * cuánto dura, qué dice su «cobro» mientras no se decide nada, y cuánto se
 * cobra si la familia NO sigue (50 €, o el concepto «Entrevista Inicial» del
 * centro si lo tiene: `cobroDeLaEntrevista`).
 */
export const ENTREVISTA = Object.freeze({
  titulo: "Entrevista inicial",
  duracionMin: DURACION_ENTREVISTA_MIN,
  cobroTexto: "Diagnóstico: el cobro nace al decidir si sigue",
  importeEuros: 50,
  textoSinConcepto: "Entrevista inicial de diagnóstico",
});

/** Euros de un DECIMAL del catálogo (llega como texto), o null si no es un importe. */
function eurosDe(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? redondea(n) : null;
}

/**
 * El cobro PENDIENTE que nace al «Parar el diagnóstico»: el concepto
 * «Entrevista Inicial» del centro (el que lleva el tipo de cita marcado como
 * valoración inicial, `isInitialAssessment`) si existe y tiene precio; si no,
 * 50 € con el texto de fábrica.
 */
export function cobroDeLaEntrevista(concepto = null) {
  const precio = eurosDe(concepto?.unitPrice);
  const conPrecio = precio !== null && precio > 0;
  return {
    conceptId: conPrecio ? (concepto?.id ?? null) : null,
    texto: conPrecio && concepto?.name ? String(concepto.name).trim().slice(0, 200) : ENTREVISTA.textoSinConcepto,
    importeEuros: conPrecio ? precio : ENTREVISTA.importeEuros,
  };
}

/** «50», «47,50»: euros como se escriben en una nota. */
function formatoEuros(n) {
  const v = redondea(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",");
}

/**
 * El cobro PENDIENTE que nace al «Seguir con el diagnóstico»: el precio del
 * concepto del producto (350 € / 650 € en Aumenta) o, sin concepto con precio,
 * el `precioEuros` del producto. La entrevista va DENTRO de este precio: no se
 * suma nada por ella.
 *
 * ── Y SE DESCUENTA LA ENTREVISTA YA COBRADA (12/09/2026, Aumenta) ─────────
 * «Los 50 € de la entrevista inicial de Lea descuentan del importe de la
 * valoración completa»: cuando la familia ya pagó (o debe) la entrevista
 * —hecha como entrevista de terapia antes de decidir el diagnóstico, o
 * cobrada al parar—, el producto nace por `precio − descuento`, nunca por
 * debajo de 0, y la nota lo dice. `descuentoEuros` sale de
 * `descuentoDeLaEntrevista` (`adoptarEnDiagnostico.js`) con el cobro atado por
 * `entrevistaPaymentId`. Sin descuento, exactamente lo de siempre.
 */
export function cobroDelProducto(producto, concepto = null, { descuentoEuros = 0 } = {}) {
  const precio = eurosDe(concepto?.unitPrice);
  const conPrecio = precio !== null && precio > 0;
  const base = conPrecio ? precio : eurosDe(producto?.precioEuros);
  let texto =
    conPrecio && concepto?.name
      ? String(concepto.name).trim().slice(0, 200)
      : String(producto?.nombre ?? "Diagnóstico").slice(0, 200);
  // Sin precio no hay de dónde descontar: el descuento se queda en 0 y la
  // nota no promete una rebaja sobre nada.
  const descuento = base !== null ? (eurosDe(descuentoEuros) ?? 0) : 0;
  const importeEuros = base === null ? null : descuento > 0 ? redondea(Math.max(0, base - descuento)) : base;
  if (descuento > 0) texto = `${texto} (descontada la entrevista inicial de ${formatoEuros(descuento)} €)`;
  return {
    conceptId: conPrecio ? (concepto?.id ?? null) : (producto?.conceptId ?? null),
    texto,
    importeEuros,
    descuentoEuros: descuento,
  };
}

// ── El tipo de cita DIAGNÓSTICO ─────────────────────────────────────────────

/**
 * ¿Es este el tipo de cita del diagnóstico? El que tiene `informe_tipo =
 * 'diagnostico'` Y se llama DIAGN…: en Aumenta es «DIAGNÓSTICO» (60 min,
 * oculto). NO es el tipo «ENTREVISTA INICIAL» de terapia
 * (`isInitialAssessment`), aunque la entrevista del diagnóstico se registre
 * con la misma plantilla.
 */
export function esTipoDiagnostico(eventType) {
  if (!eventType) return false;
  const informe = eventType.informeTipo ?? eventType.informe_tipo;
  return informe === "diagnostico" && /^diagn/i.test(String(eventType.name ?? "").trim());
}

/** El tipo DIAGNÓSTICO entre los del centro (el primero que lo sea), o null. */
export function tipoDiagnosticoDe(tipos = []) {
  return (Array.isArray(tipos) ? tipos : []).find(esTipoDiagnostico) ?? null;
}

// ── Horas ───────────────────────────────────────────────────────────────────

/** Las horas que valen esta cita para la barra: la entrevista, 1; el resto, su duración. */
function horasDeLaCita(cita) {
  if (cita?.diagnosticoTramo === TRAMO_ENTREVISTA) return 1;
  const min = Number(cita?.duration);
  return Number.isFinite(min) && min > 0 ? min / 60 : 0;
}

/** El tope del expediente como número (la columna es DECIMAL y puede llegar como texto). */
function horasMaxDe(expediente) {
  const n = Number(expediente?.horasMax ?? expediente?.horas_max);
  return Number.isFinite(n) && n > 0 ? redondea(n) : 0;
}

/**
 * Cuántas horas lleva un diagnóstico, contadas desde sus citas.
 *
 * `citas` son las reservas con `diagnosticoId` = este expediente (con
 * `status`, `scheduledAt`, `cancelledAt`, `noShowJustified`, `duration` y
 * `diagnosticoTramo`). `ahora` solo decide las canceladas antiguas sin
 * `cancelledAt`, como en los bonos.
 *
 * Devuelve los cuatro tramos de la barra, que SUMAN el tope:
 *   { max, entrevista (0|1), hechas, reservadas, libres, ocupadas, agotado, citas }
 *   · `entrevista`  1 en cuanto la entrevista se ha dado (o costado)
 *   · `hechas`      horas de sesiones gastadas, sin la entrevista
 *   · `reservadas`  horas de citas futuras (bloquean, aún no gastadas)
 *   · `libres`      lo que queda hasta `max`, nunca negativo
 *   · `ocupadas`    entrevista + hechas + reservadas (lo que compara `cabeHora`)
 *   · `agotado`     ocupadas ≥ max
 *   · `citas`       cuántas citas cuentan (gastadas o reservadas)
 */
export function horasDe({ expediente, citas, ahora = new Date() } = {}) {
  const max = horasMaxDe(expediente);
  let entrevista = 0;
  let hechas = 0;
  let reservadas = 0;
  let n = 0;

  for (const cita of Array.isArray(citas) ? citas : []) {
    const h = horasDeLaCita(cita);
    if (gastaSesion(cita, ahora)) {
      n++;
      // La primera entrevista gastada llena su tramo; una segunda (la primera
      // se canceló tarde y se repitió) cuesta 1 h de las hechas.
      if (cita?.diagnosticoTramo === TRAMO_ENTREVISTA && entrevista === 0) entrevista = 1;
      else hechas += h;
    } else if (reservaSesion(cita)) {
      n++;
      reservadas += h;
    }
  }

  hechas = redondea(hechas);
  reservadas = redondea(reservadas);
  const ocupadas = redondea(entrevista + hechas + reservadas);
  return {
    max,
    entrevista,
    hechas,
    reservadas,
    libres: redondea(Math.max(0, max - ocupadas)),
    ocupadas,
    agotado: ocupadas >= max,
    citas: n,
  };
}

/** «3», «2,5»: horas como se leen en la barra. */
export function formatoHoras(n) {
  const v = redondea(Number(n) || 0);
  return Number.isInteger(v) ? String(v) : String(v).replace(".", ",");
}

/** La frase del 422 cuando una cita no cabe: la misma para todos los que la den. */
export function mensajeTope(max) {
  return `El diagnóstico ya tiene sus ${formatoHoras(max)} h: desbloquéalas desde Diagnósticos`;
}

/**
 * ¿Cabe una cita de `duracionMin` minutos en lo que queda? Se compara con las
 * OCUPADAS —hechas y reservadas, entrevista incluida—: una hora reservada ya
 * no está libre aunque no se haya dado. Devuelve `{ cabe, despues, max,
 * mensaje }`; `mensaje` es la frase del 422 cuando no cabe, null si cabe.
 */
export function cabeHora(horas, duracionMin) {
  const min = Number(duracionMin);
  const h = Number.isFinite(min) && min > 0 ? min / 60 : 0;
  const ocupadas = Number.isFinite(Number(horas?.ocupadas))
    ? Number(horas.ocupadas)
    : (Number(horas?.entrevista) || 0) + (Number(horas?.hechas) || 0) + (Number(horas?.reservadas) || 0);
  const max = Number(horas?.max) || 0;
  const despues = redondea(ocupadas + h);
  const cabe = despues <= max + 1e-9;
  return { cabe, despues, max, mensaje: cabe ? null : mensajeTope(max) };
}

/**
 * ¿Se puede subir el tope a `nuevoMax`? Solo hacia arriba, de media en media
 * hora y por debajo del tope absoluto: bajar horas a un expediente con citas
 * dadas es reescribir lo que ya pasó. Devuelve `{ ok, motivo }`.
 */
export function puedeDesbloquear(horasMaxActual, nuevoMax) {
  const actual = Number(horasMaxActual) || 0;
  const nuevo = Number(nuevoMax);
  if (!Number.isFinite(nuevo)) return { ok: false, motivo: "Las horas tienen que ser un número" };
  if (Math.round(nuevo * 2) !== nuevo * 2) return { ok: false, motivo: "Las horas van de media en media" };
  if (nuevo <= actual) return { ok: false, motivo: `Tienen que ser más de las ${formatoHoras(actual)} h que ya tiene` };
  if (nuevo > HORAS_MAX_TOPE) return { ok: false, motivo: `Como mucho ${HORAS_MAX_TOPE} h` };
  return { ok: true, motivo: null };
}

/** «3 de 10 h», y «· 2 reservadas» si hay citas por delante. Lo usado = entrevista + hechas. */
export function rotuloDeBarra(horas) {
  const usadas = redondea((Number(horas?.entrevista) || 0) + (Number(horas?.hechas) || 0));
  const base = `${formatoHoras(usadas)} de ${formatoHoras(horas?.max)} h`;
  const r = redondea(Number(horas?.reservadas) || 0);
  return r > 0 ? `${base} · ${formatoHoras(r)} reservada${r === 1 ? "" : "s"}` : base;
}

/**
 * Los cuatro tramos de la barra con su anchura en %, en el orden en que se
 * pintan: [entrevista | hechas | reservadas | libres]. Si `max` es 0, todo a 0.
 */
export function tramosDeBarra(horas) {
  const max = Number(horas?.max) || 0;
  const pct = (h) => (max > 0 ? Math.max(0, Math.min(100, redondea(((Number(h) || 0) / max) * 100))) : 0);
  return [
    { clave: "entrevista", horas: Number(horas?.entrevista) || 0, pct: pct(horas?.entrevista) },
    { clave: "hechas", horas: Number(horas?.hechas) || 0, pct: pct(horas?.hechas) },
    { clave: "reservadas", horas: Number(horas?.reservadas) || 0, pct: pct(horas?.reservadas) },
    { clave: "libres", horas: Number(horas?.libres) || 0, pct: pct(horas?.libres) },
  ];
}

// ── El bono sin tope ────────────────────────────────────────────────────────

/**
 * ¿Es un bono SIN TOPE (el del diagnóstico)? `session_packs.total_sessions`
 * a NULL. Se mira el null EXPLÍCITO —que es lo que devuelve la columna y lo
 * que serializa `estadoPack` en `total`—: un objeto al que simplemente le
 * falte la clave sigue siendo lo que era.
 */
export function esBonoSinTope(pack) {
  if (!pack || typeof pack !== "object") return false;
  if (pack.totalSessions === null) return true;
  return pack.totalSessions === undefined && pack.total === null;
}
