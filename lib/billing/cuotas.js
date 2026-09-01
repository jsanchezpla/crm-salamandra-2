/**
 * lib/billing/cuotas.js — la cuota mensual de una familia: cuánto vale, si
 * toca este mes y qué cobro sale de ella (01/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: es la mitad decidible SIN base de datos de
 * «programar las cuotas mensualmente» —qué cuotas están vigentes en un mes,
 * cuánto se cobra de cada una y cuáles ya se generaron—, y así la fija
 * `scripts/_smoke-cuotas.mjs` sin levantar nada. El endpoint
 * `app/api/billing/cuotas/generar` solo pone las consultas y la transacción
 * alrededor.)
 *
 * ── LA REGLA QUE LO GOBIERNA TODO ──────────────────────────────────────────
 * Generar la cuota de un mes NO es cobrar. El cobro nace PENDIENTE: el dinero
 * todavía no ha entrado. Morosidad, el bloqueo del portal y «Facturar el mes»
 * miran `status = 'completed'`, así que un mes generado y no cobrado sigue
 * contando como impagado — que es la verdad. Quien recibe el dinero lo pasa a
 * cobrado desde Cobros (o lo hará la conciliación del banco).
 */

// Los metodos de cobro son UNA lista y vive en caja.js (quien los reparte en
// efectivo/tarjeta/banco). Se reexportan para que quien ya importaba de aqui
// no tenga que saber donde acabaron.
import { metodoValido, metodosValidos } from "./caja.js";

export { metodoValido, metodosValidos };

// Mismo redondeo a céntimos que el resto del dinero (lotesCuotas, prorrateo).
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Es un mes 'AAAA-MM' de verdad? (misma vara que lotesCuotas.js) */
export function mesValido(mes) {
  return MES_RE.test(String(mes ?? ""));
}

/** "2026-09" → "septiembre 2026". */
export function mesLegible(mes) {
  if (!mesValido(mes)) return String(mes ?? "");
  const [a, m] = String(mes).split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
}

/** Días que tiene ese mes (28-31). */
export function diasDelMes(mes) {
  if (!mesValido(mes)) return 0;
  const [a, m] = String(mes).split("-").map(Number);
  return new Date(a, m, 0).getDate(); // día 0 del mes siguiente
}

/** Último día del mes, 'AAAA-MM-DD'. */
export function ultimoDiaDe(mes) {
  const d = diasDelMes(mes);
  return d ? `${mes}-${String(d).padStart(2, "0")}` : null;
}

const soloFecha = (v) => {
  if (!v) return null;
  const s = typeof v === "string" ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10);
  return FECHA_RE.test(s) ? s : null;
};

/**
 * El TRAMO del mes que cubre una cuota: del día que empieza al día que
 * termina, con su factor de prorrateo.
 *
 * Generaliza `prorrateo.js` (que solo mira el alta) para cubrir también la
 * baja a mitad de mes — el mismo caso por el otro lado. Con la cuota entera
 * dentro del mes devuelve `completo: true` y factor 1, y ahí las dos piezas
 * dan exactamente lo mismo.
 *
 * Fuera del mes → null (esa cuota no toca).
 */
export function tramoDelMes(mes, { startDate, endDate } = {}) {
  const dias = diasDelMes(mes);
  if (!dias) return null;
  const primero = `${mes}-01`;
  const ultimo = ultimoDiaDe(mes);

  const alta = soloFecha(startDate);
  const baja = soloFecha(endDate);
  // Una fecha de alta ilegible se trata como «de siempre»: mejor generar de
  // más y que se vea, que dejar a una familia fuera por un dato sucio.
  const desde = alta && alta > primero ? alta : primero;
  const hasta = baja && baja < ultimo ? baja : ultimo;
  if (alta && alta > ultimo) return null; // empieza después de este mes
  if (baja && baja < primero) return null; // terminó antes de este mes
  if (desde > hasta) return null;

  const d1 = Number(desde.slice(8, 10));
  const d2 = Number(hasta.slice(8, 10));
  const diasCobrados = d2 - d1 + 1;
  return {
    desde,
    hasta,
    diasCobrados,
    diasDelMes: dias,
    factor: diasCobrados / dias,
    completo: diasCobrados === dias,
  };
}

/**
 * El mes 'AAAA-MM' que es HOY en Madrid (01/09/2026, Rodrigo: «la morosidad
 * tiene que saltar a día 1 de cada mes», y es universal). El servidor va en
 * UTC: sin la zona, la noche del 31 al 1 la morosidad saltaría una hora tarde
 * en invierno y dos en verano.
 */
export function mesVigente(ahora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit",
  }).format(ahora).slice(0, 7);
}

/**
 * ¿Esta familia DEBE cuota el mes M? — alguna de sus cuotas cubre algún día
 * de ese mes (01/09/2026, Rodrigo: un paciente de enero a marzo solo aparece
 * en la morosidad de enero, febrero y marzo). Misma vara que la generación:
 * apagada sin fecha de baja = en pausa, no debe nada.
 */
export function debeElMes(cuotas, mes) {
  return (Array.isArray(cuotas) ? cuotas : []).some((c) => {
    if (c?.active === false && !c?.endDate) return false;
    return tramoDelMes(mes, c) !== null;
  });
}

/**
 * Una cuota está DE BAJA cuando se apagó o cuando su fecha de fin ya pasó —
 * aunque nadie la apagara a mano: los «va de enero a marzo» caducan solos y
 * caen al cuadro de bajas, sin salir del grupo (01/09/2026, Rodrigo).
 */
export function cuotaDeBaja(cuota, hoy) {
  if (cuota?.active === false) return true;
  const fin = soloFecha(cuota?.endDate);
  const dia = soloFecha(hoy);
  return !!(fin && dia && fin < dia);
}

/**
 * La fecha de BAJA que corresponde a «durante N meses» (01/09/2026, Rodrigo:
 * «hay que revisar si se puede meter a un paciente durante un número concreto
 * de meses en una cuota y luego se le da de baja»).
 *
 * Se podía —escribiendo la fecha de fin a mano— pero contar los meses era
 * trabajo del usuario, y ahí se equivoca cualquiera: «tres meses desde el 15
 * de septiembre» no es el 15 de diciembre, es el 30 de noviembre.
 *
 * EL MES DEL ALTA CUENTA COMO EL PRIMERO: alta el 15/09 durante 3 meses =
 * septiembre, octubre y noviembre, y la baja cae el 30/11. Es como lo dice el
 * centro («viene de septiembre a noviembre») y encaja con el prorrateo: el mes
 * del alta se cobra por días, los de en medio enteros, y el de la baja entero
 * por caer justo en su último día.
 */
export function bajaTrasMeses(startDate, meses) {
  const alta = soloFecha(startDate);
  const n = Math.trunc(Number(meses));
  if (!alta || !Number.isFinite(n) || n < 1) return null;
  const [anio, mes] = alta.split("-").map(Number);
  // Meses desde enero en base 0; el alta ya es el primero, de ahí el n - 1.
  const total = mes - 1 + (n - 1);
  const a = anio + Math.floor(total / 12);
  const m = (total % 12) + 1;
  return ultimoDiaDe(`${a}-${String(m).padStart(2, "0")}`);
}

/**
 * Cuántos MESES cubre una cuota con fecha de fin — el inverso de
 * `bajaTrasMeses`, para poder decirlo en la pantalla («desde 01/09/2026 · baja
 * 30/11/2026 · 3 meses») en vez de obligar a contar con los dedos. Sin fecha
 * de baja no hay número: es indefinida.
 */
export function mesesDeTramo(startDate, endDate) {
  const alta = soloFecha(startDate);
  const baja = soloFecha(endDate);
  if (!alta || !baja || baja < alta) return null;
  const [a1, m1] = alta.split("-").map(Number);
  const [a2, m2] = baja.split("-").map(Number);
  return (a2 - a1) * 12 + (m2 - m1) + 1;
}

/** dd/mm/aaaa a partir de 'AAAA-MM-DD'. */
const enCristiano = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

/**
 * La frase que queda ESCRITA en el cobro cuando el mes va partido —«desde el
 * 13/09/2026 (18/30 días)»—, que es lo que evita la llamada de la familia
 * preguntando por el importe raro. Mes entero → null.
 */
export function rotuloDeTramo(tramo) {
  if (!tramo || tramo.completo) return null;
  const dias = `(${tramo.diasCobrados}/${tramo.diasDelMes} días)`;
  const empiezaTarde = Number(tramo.desde.slice(8, 10)) > 1;
  const terminaAntes = tramo.hasta !== ultimoDiaDe(tramo.desde.slice(0, 7));
  if (empiezaTarde && terminaAntes) return `del ${enCristiano(tramo.desde)} al ${enCristiano(tramo.hasta)} ${dias}`;
  if (empiezaTarde) return `desde el ${enCristiano(tramo.desde)} ${dias}`;
  return `hasta el ${enCristiano(tramo.hasta)} ${dias}`;
}

/**
 * Cuánto vale la cuota AL MES, antes de prorratear.
 *
 * Con `amount` escrito manda ese número (el precio pactado con esa familia).
 * Sin él, la suma de sus conceptos del catálogo — así una subida de tarifa se
 * aplica cambiando el concepto y no 300 filas. Un concepto que ya no exista
 * suma 0 y se cuenta aparte, para poder avisar en vez de cobrar de menos en
 * silencio.
 */
export function importeDeCuota(cuota, conceptosPorId = new Map()) {
  const escrito = cuota?.amount;
  if (escrito !== null && escrito !== undefined && escrito !== "") {
    const n = Number(escrito);
    if (Number.isFinite(n)) return { importe: round2(n), fuente: "pactado", conceptosPerdidos: [] };
  }
  const ids = Array.isArray(cuota?.conceptIds) ? cuota.conceptIds : [];
  let suma = 0;
  const perdidos = [];
  for (const id of ids) {
    const c = conceptosPorId.get(String(id));
    if (!c) { perdidos.push(String(id)); continue; }
    suma += Number(c.unitPrice) || 0;
  }
  return { importe: round2(suma), fuente: "conceptos", conceptosPerdidos: perdidos };
}

/** Los nombres de los conceptos de la cuota, para rotular el cobro. */
export function nombresDeConceptos(cuota, conceptosPorId = new Map()) {
  const ids = Array.isArray(cuota?.conceptIds) ? cuota.conceptIds : [];
  return ids.map((id) => conceptosPorId.get(String(id))?.name).filter(Boolean);
}

/**
 * La fecha del cobro generado: el día de cobro de la cuota dentro de ese mes,
 * RECORTADO al último día real (un 31 en febrero no existe) y nunca antes del
 * día en que la cuota empieza. Sin día configurado, el primero del tramo.
 */
export function fechaDeCobro(mes, cuota, tramo) {
  const dias = diasDelMes(mes);
  if (!dias) return null;
  const dia = Number(cuota?.dayOfMonth);
  if (!Number.isFinite(dia) || dia < 1) return tramo?.desde ?? `${mes}-01`;
  const recortado = `${mes}-${String(Math.min(Math.trunc(dia), dias)).padStart(2, "0")}`;
  const minimo = tramo?.desde ?? `${mes}-01`;
  return recortado < minimo ? minimo : recortado;
}

/** La nota que queda escrita en el cobro: «Cuota septiembre 2026 — Logopedia». */
export function notaDeCobro({ mes, conceptos = [], rotulo = null }) {
  const partes = [`Cuota ${mesLegible(mes)}`];
  if (conceptos.length) partes.push(conceptos.join(" + "));
  if (rotulo) partes.push(rotulo);
  return partes.join(" — ");
}

/**
 * El PLAN de generación de un mes: qué cobro sale de cada cuota vigente, cuál
 * ya está generado y cuál no se puede generar.
 *
 * @param {object} p
 * @param {string} p.mes        'AAAA-MM'
 * @param {Array}  p.cuotas     filas planas de Cuota (con `client`/`patient` ya resueltos si se quieren rotular)
 * @param {Array}  p.conceptos  [{ id, name, unitPrice }] del catálogo
 * @param {Array}  p.yaGenerados ids de cuota que YA tienen cobro ese mes (payments.cuota_id)
 * @param {Array}  p.metodos    filtro opcional de métodos ('cash'|'card'|'transfer'|'direct_debit')
 * @returns {{ aGenerar: Array, repetidas: Array, sinImporte: Array }}
 *   `aGenerar`: { cuotaId, clientId, patientId, nombre, paciente, importe,
 *   method, paidAt, periodMonth, notes, conceptId, tramo, rotulo }
 */
export function planDeCuotasDelMes({ mes, cuotas = [], conceptos = [], yaGenerados = [], metodos = null } = {}) {
  if (!mesValido(mes)) return { aGenerar: [], repetidas: [], sinImporte: [] };
  const porId = new Map(conceptos.map((c) => [String(c.id), c]));
  const hechas = new Set(yaGenerados.map(String));
  const filtro = Array.isArray(metodos) && metodos.length ? new Set(metodos) : null;

  const aGenerar = [];
  const repetidas = [];
  const sinImporte = [];

  for (const cuota of cuotas) {
    // Apagada y SIN fecha de baja = en pausa: no genera ningun mes. Apagada
    // CON fecha de baja si genera hasta esa fecha — el mes de la baja se cobra
    // prorrateado, y de eso ya se encarga el tramo.
    if (cuota?.active === false && !cuota?.endDate) continue;
    const tramo = tramoDelMes(mes, cuota);
    if (!tramo) continue;
    // El filtro por método se aplica DESPUÉS de la vigencia: «solo las de
    // banco» tiene que enseñar el mismo tramo y el mismo importe que el lote
    // entero, no un cálculo distinto.
    if (filtro && !filtro.has(cuota.method)) continue;

    const { importe: mensual, conceptosPerdidos } = importeDeCuota(cuota, porId);
    const rotulo = rotuloDeTramo(tramo);
    const nombres = nombresDeConceptos(cuota, porId);
    const ids = Array.isArray(cuota.conceptIds) ? cuota.conceptIds : [];
    const fila = {
      cuotaId: String(cuota.id),
      clientId: cuota.clientId ? String(cuota.clientId) : null,
      patientId: cuota.patientId ? String(cuota.patientId) : null,
      nombre: cuota.nombre ?? null,
      paciente: cuota.paciente ?? null,
      // Prorrateado por el tramo: el mes de alta (o el de baja) no se cobra entero.
      importe: round2(mensual * tramo.factor),
      importeMensual: mensual,
      method: cuota.method ?? null,
      periodMonth: `${mes}-01`,
      paidAt: fechaDeCobro(mes, cuota, tramo),
      // Solo con UN concepto: una cuota compuesta no se puede partir por
      // terapia, y es exactamente lo que `payments.concept_id` significa.
      conceptId: ids.length === 1 ? String(ids[0]) : null,
      conceptos: nombres,
      tramo,
      rotulo,
      notes: notaDeCobro({ mes, conceptos: nombres, rotulo }),
      conceptosPerdidos,
    };

    if (hechas.has(fila.cuotaId)) { repetidas.push(fila); continue; }
    // Un cobro de 0 € no es un cobro: sería una fila muerta en Cobros y una
    // línea de 0 € en la factura del mes.
    if (!(fila.importe > 0)) {
      sinImporte.push({ ...fila, motivo: conceptosPerdidos.length ? "sus conceptos ya no existen" : "importe 0" });
      continue;
    }
    aGenerar.push(fila);
  }

  const orden = (a, b) => String(a.nombre ?? "").localeCompare(String(b.nombre ?? ""), "es");
  aGenerar.sort(orden);
  repetidas.sort(orden);
  sinImporte.sort(orden);
  return { aGenerar, repetidas, sinImporte };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * limpiarCuota(body) — qué acepta el alta o la edición de una cuota (mismo
 * patrón que `conceptosCatalogo.limpiarConcepto`: lo comparten la API y el
 * formulario, para que no diverjan).
 *
 * Con `parcial` solo viaja lo que trae el cuerpo: una edición no puede
 * inventarse los campos que no mandó la pantalla. El importe acepta vacío
 * explícito (`null`) y eso SIGNIFICA algo — «lo que digan sus conceptos» —,
 * así que no se confunde con «no lo mandes».
 */
export function limpiarCuota(body, { parcial = false } = {}) {
  const valores = {};
  const b = body || {};

  if (!parcial || "clientId" in b) {
    const id = String(b.clientId ?? "");
    if (!UUID_RE.test(id)) return { valores: null, problema: "Falta el cliente que paga la cuota" };
    valores.clientId = id;
  }
  if (!parcial || "patientId" in b) {
    const id = b.patientId ? String(b.patientId) : null;
    if (id && !UUID_RE.test(id)) return { valores: null, problema: "El paciente no es válido" };
    valores.patientId = id;
  }
  if (!parcial || "conceptIds" in b) {
    const ids = (Array.isArray(b.conceptIds) ? b.conceptIds : []).map(String).filter((x) => UUID_RE.test(x));
    valores.conceptIds = [...new Set(ids)];
  }
  if (!parcial || "amount" in b) {
    if (b.amount === null || b.amount === undefined || b.amount === "") {
      valores.amount = null; // = la suma de sus conceptos
    } else {
      const n = Number(b.amount);
      if (!Number.isFinite(n)) return { valores: null, problema: "El importe tiene que ser un número" };
      valores.amount = round2(n);
    }
  }
  if (!parcial || "method" in b) {
    const m = b.method ? String(b.method) : null;
    if (m && !metodoValido(m)) return { valores: null, problema: "El método de cobro no es válido" };
    valores.method = m;
  }
  if (!parcial || "dayOfMonth" in b) {
    if (b.dayOfMonth === null || b.dayOfMonth === undefined || b.dayOfMonth === "") {
      valores.dayOfMonth = null;
    } else {
      const n = Math.trunc(Number(b.dayOfMonth));
      if (!Number.isFinite(n) || n < 1 || n > 31) return { valores: null, problema: "El día de cobro tiene que estar entre 1 y 31" };
      valores.dayOfMonth = n;
    }
  }
  if (!parcial || "startDate" in b) {
    const f = soloFecha(b.startDate);
    if (!f) return { valores: null, problema: "La fecha de alta tiene que ser 'AAAA-MM-DD'" };
    valores.startDate = f;
  }
  if (!parcial || "endDate" in b) {
    if (b.endDate === null || b.endDate === undefined || b.endDate === "") {
      valores.endDate = null;
    } else {
      const f = soloFecha(b.endDate);
      if (!f) return { valores: null, problema: "La fecha de baja tiene que ser 'AAAA-MM-DD'" };
      valores.endDate = f;
    }
  }
  if ("active" in b) valores.active = !!b.active;
  if (!parcial || "notes" in b) {
    const t = typeof b.notes === "string" ? b.notes.trim() : "";
    valores.notes = t ? t.slice(0, 2000) : null;
  }

  // La baja no puede ser anterior al alta: sería una cuota que nunca existió.
  const alta = valores.startDate;
  const baja = valores.endDate;
  if (alta && baja && baja < alta) {
    return { valores: null, problema: "La fecha de baja no puede ser anterior a la de alta" };
  }
  return { valores, problema: null };
}
