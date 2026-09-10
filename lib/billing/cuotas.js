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

/** Las citas de la cuota en el mapa de `citasParaProrrateo.js`: paciente primero, si no la familia. */
export function citasDeLaCuota(mapa, cuota) {
  if (!mapa || !cuota) return null;
  if (cuota.patientId && mapa[`p:${cuota.patientId}`]) return mapa[`p:${cuota.patientId}`];
  if (!cuota.patientId && cuota.clientId && mapa[`c:${cuota.clientId}`]) return mapa[`c:${cuota.clientId}`];
  return null;
}

/**
 * Las citas de UNA terapia —o de las que lleva una cuota— dentro de las del
 * paciente (08/09/2026, Rosa).
 *
 * Un niño con pedagogía tres martes y psicología uno tiene cuatro citas en el
 * mes, y hasta hoy las cuatro contaban para las dos cuotas por igual: la
 * psicología, que se da 1 de 5 martes, salía cobrada como si viniera tres.
 * Cada cita sabe qué concepto la cubre (`cobro_concept_id`), así que la parte
 * de cada servicio se cuenta con SUS sesiones.
 *
 * `conceptId` admite un id o una lista (los conceptos de la cuota entera).
 * Eso último no es un adorno: en AV-0082 la única cita de la familia en
 * septiembre era una ENTREVISTA INICIAL —que no es ninguno de los dos
 * servicios de su cuota— y el mes de alta salió cobrado «1 de 5 sesiones»,
 * 36,42 € de 182,11 €. Una cita que la cuota no paga no puede marcarle el
 * ritmo.
 *
 * Sin ninguna cita atada a un concepto —las 13.408 viejas de Aumenta, o un
 * centro que cobra las citas por texto libre— se devuelven todas, que es lo
 * que había. Si las hay atadas pero ninguna es de estos conceptos, la lista
 * sale vacía y el tramo se prorratea por días: mejor eso que ponerle a la
 * logopedia el ritmo de la psicología.
 */
export function citasDelConcepto(citas, conceptId) {
  if (!Array.isArray(citas) || !citas.length) return citas;
  const quiero = new Set((Array.isArray(conceptId) ? conceptId : [conceptId]).filter(Boolean).map(String));
  if (!quiero.size) return citas;
  const atadas = citas.filter((c) => c?.conceptId);
  if (!atadas.length) return citas;
  return atadas.filter((c) => quiero.has(String(c.conceptId)));
}

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
export function tramoDelMes(mes, { startDate, endDate } = {}, { citas = null } = {}) {
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
  const tramo = {
    desde,
    hasta,
    diasCobrados,
    diasDelMes: dias,
    factor: diasCobrados / dias,
    completo: diasCobrados === dias,
    sesiones: null,
  };
  /*
   * ── POR SESIONES, CUANDO SE SABE (07/09/2026, AV-0062 de Aumenta) ─────────
   * Rosa: «viene 3 sesiones de 4 y el sistema calcula 20 días de 30». Una
   * cuota de un centro clínico es por sesiones semanales, así que el mes de
   * alta (o de baja) se paga por las sesiones que caen dentro del tramo sobre
   * las que ese patrón semanal tiene en el mes entero. Las citas las trae
   * quien llama (`lib/billing/citasParaProrrateo.js`); sin citas en el tramo,
   * por días, que es lo de siempre y lo que ve el cajón de cobros.
   */
  if (!tramo.completo && Array.isArray(citas) && citas.length) {
    const s = sesionesDelTramo(mes, tramo, citas);
    /*
     * UNA SOLA SESIÓN NO DIBUJA UN PATRÓN (08/09/2026, AV-0082). El patrón
     * semanal se deduce de los días con cita del tramo; con una sola cita lo
     * que hay no es un patrón, es un punto, y sale un «1 de 5 sesiones» que en
     * realidad dice «esta agenda está a medias». Pasa en cada alta que se deja
     * hecha antes de meter las citas del mes. En un tramo de una semana o
     * menos sí es lo esperable —quien empieza el día 26 tiene una— y ahí se
     * cuenta. En los demás casos, por días, que es lo de siempre y no inventa.
     */
    const dibujanPatron = s && (s.enElTramo > 1 || diasCobrados <= 7);
    if (s && dibujanPatron && s.enElMes > 0 && s.enElTramo > 0) {
      tramo.sesiones = s;
      tramo.factor = Math.min(1, s.enElTramo / s.enElMes);
    }
  }
  return tramo;
}

/**
 * Cuántas sesiones caen en el tramo y cuántas tendría el mes entero con ese
 * patrón semanal. `citas` = [{ scheduledAt }] del mes, sin las canceladas.
 *
 * El patrón son los días de la semana en los que hay cita DENTRO del tramo:
 * un «60x1» los viernes da 1 día; un «45x2» martes y jueves, 2. Las sesiones
 * del mes entero son cuántos de esos días de la semana tiene el mes. Así el
 * alta del día 11 con cita los viernes sale 3 de 4 (4, 11, 18, 25), que es
 * la cuenta que hace el centro. Devuelve null sin citas en el tramo.
 *
 * Se cuentan DÍAS con cita, no citas (08/09/2026): las dos partes de la
 * fracción tienen que medir lo mismo, y la de abajo son días del mes. Con dos
 * hermanos en la misma terapia y una cuota de la familia entera, las citas del
 * tramo se doblaban —6 sobre 5 martes— y el mes de alta salía cobrado entero.
 *
 * ── Y EL PATRÓN NO PUEDE SER MÁS GRANDE QUE EL RITMO (10/09/2026, Rodrigo) ──
 *
 * Leo empieza logopedia «45x1» el jueves 10 y sigue los miércoles 16, 23 y 30:
 * cuatro sesiones, una por semana. Coger todos los días de la semana con cita
 * daba un patrón de DOS días —jueves y miércoles— y un mes de 9 sesiones, así
 * que sus 4 salían cobradas 4 de 9: 64,44 € de una cuota de 145 €. La primera
 * sesión cae a menudo en otro día (es el hueco que había esa semana), y eso no
 * convierte una terapia semanal en dos.
 *
 * El ritmo lo dicen las propias citas: cuántas caen en una MISMA semana. Con
 * ese número se queda el patrón —los días de la semana más repetidos, y a
 * igualdad el del último día con cita, que es el que ya se ha asentado—, y el
 * jueves suelto deja de contar para el mes entero aunque siga contando como
 * sesión suya. Leo: 4 de 5 miércoles, 116 €, que es la cuenta del centro.
 */
export function sesionesDelTramo(mes, tramo, citas = []) {
  const dias = diasDelMes(mes);
  if (!dias || !tramo?.desde || !tramo?.hasta) return null;
  const enTramo = [];
  for (const c of Array.isArray(citas) ? citas : []) {
    const f = fechaMadrid(c?.scheduledAt);
    if (!f) continue;
    if (f >= tramo.desde && f <= tramo.hasta) enTramo.push(f);
  }
  if (!enTramo.length) return null;
  const conCita = [...new Set(enTramo)].sort();
  const patron = patronSemanal(conCita);
  let enElMes = 0;
  for (let d = 1; d <= dias; d++) {
    const f = `${mes}-${String(d).padStart(2, "0")}`;
    if (patron.has(diaDeLaSemana(f))) enElMes++;
  }
  return { enElTramo: conCita.length, enElMes };
}

/** El día de la semana de 'AAAA-MM-DD' (0 = domingo). A mediodía, para no bailar. */
const diaDeLaSemana = (f) => new Date(`${f}T12:00:00Z`).getUTCDay();

/** El lunes de su semana: la clave con la que se agrupan las sesiones por semanas. */
function semanaDe(f) {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Los días de la semana en los que se da esa terapia, como mucho tantos como
 * sesiones tiene su semana. `conCita` son los días con cita del tramo, únicos
 * y ordenados.
 */
function patronSemanal(conCita) {
  const porSemana = new Map();
  const porDia = new Map();
  for (const f of conCita) {
    const s = semanaDe(f);
    porSemana.set(s, (porSemana.get(s) ?? 0) + 1);
    const w = diaDeLaSemana(f);
    // Cuántas veces se repite ese día de la semana, y cuándo fue la última.
    porDia.set(w, { veces: (porDia.get(w)?.veces ?? 0) + 1, ultima: f });
  }
  const porSemanaMax = Math.max(...porSemana.values());
  const orden = [...porDia.entries()].sort(
    (a, b) => b[1].veces - a[1].veces || (a[1].ultima < b[1].ultima ? 1 : -1)
  );
  return new Set(orden.slice(0, Math.max(1, porSemanaMax)).map(([w]) => w));
}

/** 'AAAA-MM-DD' de una cita en hora de Madrid (las citas se guardan en UTC). */
function fechaMadrid(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
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

/** El día que es HOY en Madrid ('AAAA-MM-DD'), por la misma razón que arriba. */
export function hoyVigente(ahora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(ahora);
}

/**
 * cuadrarBajaYActiva(actual, cambios, { hoy, activaEnElCuerpo }) — que la fila
 * no diga dos cosas a la vez (04/09/2026).
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * Rodrigo: «cuando añado un paciente a una nueva cuota a veces da problemas y
 * se da de baja solo». Estaba en la auditoría de Aumenta, con 32 segundos entre
 * las dos líneas: cuota creada a las 13:37:24 (activa, hasta el 30/06/2027) y
 * `cuota.ended` a las 13:37:56 — lo único que hizo él fue corregirle la fecha
 * de alta. El drawer de edición manda SIEMPRE `endDate`, aunque no se toque, y
 * la ruta apagaba la cuota en cuanto veía una fecha de baja en el cuerpo.
 *
 * La idea, una sola: **solo una fecha de baja YA PASADA contradice a `active:
 * true`**. Una futura no — es exactamente lo que crea «durante N meses», y el
 * alta la deja activa; apagarla al editar sería que la misma cuota valiera una
 * cosa creándola y otra tocándola. Y solo si la fecha CAMBIA: reenviar la que
 * ya tenía no es dar de baja a nadie.
 *
 * Dar de baja de verdad sigue siendo el botón, que manda `active` explícito
 * (`activaEnElCuerpo`) y manda sobre todo esto.
 */
export function cuadrarBajaYActiva(actual, cambios, { hoy, activaEnElCuerpo = false } = {}) {
  const salida = { ...(cambios || {}) };
  const finAntes = soloFecha(actual?.endDate);
  const finNuevo = "endDate" in salida ? soloFecha(salida.endDate) : finAntes;
  const dia = soloFecha(hoy) || hoyVigente();
  const yaPasó = !!finNuevo && finNuevo <= dia;

  // Poner una baja que ya pasó apaga la cuota.
  if (yaPasó && finNuevo !== finAntes && !activaEnElCuerpo) salida.active = false;
  // Y reactivarla sin quitar esa baja borraría la baja sin querer: se quita.
  if (salida.active === true && yaPasó && !("endDate" in salida)) salida.endDate = null;
  return salida;
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
  /*
   * Por sesiones cuando se ha podido contar (AV-0062): «3 de 4 sesiones».
   * Y SIN fracción cuando la cuota lleva servicios que no fueron por el mismo
   * camino —uno por sus sesiones y otro por días, por no tener citas puestas—:
   * ahí ninguna de las dos fracciones describe el importe, así que se calla y
   * queda la fecha, que es lo que de verdad explica el cobro (08/09/2026).
   */
  const cuenta = tramo.mixto
    ? ""
    : tramo.sesiones
      ? ` (${tramo.sesiones.enElTramo} de ${tramo.sesiones.enElMes} sesiones)`
      : ` (${tramo.diasCobrados}/${tramo.diasDelMes} días)`;
  const empiezaTarde = Number(tramo.desde.slice(8, 10)) > 1;
  const terminaAntes = tramo.hasta !== ultimoDiaDe(tramo.desde.slice(0, 7));
  if (empiezaTarde && terminaAntes) return `del ${enCristiano(tramo.desde)} al ${enCristiano(tramo.hasta)}${cuenta}`;
  if (empiezaTarde) return `desde el ${enCristiano(tramo.desde)}${cuenta}`;
  return `hasta el ${enCristiano(tramo.hasta)}${cuenta}`;
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
    // Un importe pactado a mano es el total del mes: se prorratea entero, sin
    // descuentos que separar.
    if (Number.isFinite(n)) return { importe: round2(n), mensualProrrateable: round2(n), fijo: 0, fuente: "pactado", conceptosPerdidos: [] };
  }
  const ids = Array.isArray(cuota?.conceptIds) ? cuota.conceptIds : [];
  let suma = 0;
  let fijo = 0;
  const perdidos = [];
  for (const id of ids) {
    const c = conceptosPorId.get(String(id));
    if (!c) { perdidos.push(String(id)); continue; }
    const precio = Number(c.unitPrice) || 0;
    // Un concepto NEGATIVO es un descuento por algo ya abonado («Descuento
    // reserva ya abonada», −30 € en el catálogo de Aumenta): esos 30 € se
    // pagaron enteros, así que se restan enteros y NO se prorratean
    // (07/09/2026, vuelta de AV-0062: Rosa lo cuenta así, «190/4 = 47,50 × 3
    // sesiones = 142,50 − 30 de reserva = 112,50»).
    if (precio < 0) fijo += precio;
    else suma += precio;
  }
  return { importe: round2(suma + fijo), mensualProrrateable: round2(suma), fijo: round2(fijo), fuente: "conceptos", conceptosPerdidos: perdidos };
}

/**
 * El tramo cobrado de una cuota REPARTIENDO POR CONCEPTO (08/09/2026, Rosa de
 * Aumenta: «la parte proporcional la sigue calculando mal»).
 *
 * Un factor único para toda la cuota vale mientras la cuota es una sola
 * terapia. Con dos —«Pedagogía 60x1» + «Psicología 60x1», 190 € cada una— las
 * sesiones se mezclaban y las dos pagaban lo mismo, cuando la pedagogía se da
 * 3 de 5 martes (114 €) y la psicología 1 de 5 (38 €). Así que cada concepto
 * se prorratea con las suyas y se suman.
 *
 * Devuelve null —y manda el camino de siempre— cuando no hay nada que repartir:
 * sin citas, con importe pactado a mano (es un total, no se puede partir por
 * terapia) o cuando ningún concepto llegó a contar sesiones.
 *
 * Los conceptos NEGATIVOS (el descuento por la reserva ya abonada) se quedan
 * fuera a propósito: van enteros, como en `importeDeCuota`.
 *
 * El tramo que sale lleva las sesiones SUMADAS («4 de 10 sesiones») y el
 * factor que de verdad se ha aplicado, para que el rótulo del cobro cuente la
 * misma historia que el importe.
 */
export function repartoPorConcepto(mes, cuota, { conceptosPorId = new Map(), citas = null } = {}) {
  if (!Array.isArray(citas) || !citas.length) return null;
  const escrito = cuota?.amount;
  if (escrito !== null && escrito !== undefined && escrito !== "" && Number.isFinite(Number(escrito))) return null;

  const ids = Array.isArray(cuota?.conceptIds) ? cuota.conceptIds : [];
  let base = null;
  let importe = 0;
  let mensual = 0;
  let enElTramo = 0;
  let enElMes = 0;
  let contadas = false;
  let todos = true; // ¿fueron TODOS los servicios por sesiones?
  for (const id of ids) {
    const c = conceptosPorId.get(String(id));
    const precio = Number(c?.unitPrice) || 0;
    if (!c || precio < 0) continue;
    const t = tramoDelMes(mes, cuota, { citas: citasDelConcepto(citas, id) });
    if (!t) continue;
    base ||= t;
    importe += precio * t.factor;
    mensual += precio;
    if (t.sesiones) {
      contadas = true;
      enElTramo += t.sesiones.enElTramo;
      enElMes += t.sesiones.enElMes;
    } else todos = false;
  }
  if (!base || !contadas) return null;
  return {
    importe: round2(importe),
    tramo: {
      ...base,
      factor: mensual > 0 ? importe / mensual : base.factor,
      sesiones: { enElTramo, enElMes },
      // Unos por sesiones y otros por días: que el rótulo no finja una cuenta
      // única que no se ha hecho.
      mixto: !todos,
    },
  };
}

/** Los nombres de los conceptos de la cuota, para rotular el cobro. */
export function nombresDeConceptos(cuota, conceptosPorId = new Map()) {
  const ids = Array.isArray(cuota?.conceptIds) ? cuota.conceptIds : [];
  return ids.map((id) => conceptosPorId.get(String(id))?.name).filter(Boolean);
}

/**
 * Lo mismo, pero con el que va IMPRESO: el «Texto en la factura» de cada
 * concepto (`description`) y, si está vacío, su nombre — la misma regla que
 * `lineaDesdeConcepto` aplica cuando se elige un concepto a mano.
 *
 * Son dos listas y no una porque son dos públicos (09/09/2026, Aumenta): el
 * centro necesita leer «Cuota Logopedia 45x1» en Cobros para saber qué terapia
 * paga esa familia, y la familia recibe «Terapia 45 min semanales», que no dice
 * ninguna. Es el par «Nombre» / «Concepto factura» de las cuotas del
 * Organízate, donde el segundo es genérico a propósito.
 */
export function textosDeFacturaDeConceptos(cuota, conceptosPorId = new Map()) {
  const ids = Array.isArray(cuota?.conceptIds) ? cuota.conceptIds : [];
  return ids
    .map((id) => {
      const c = conceptosPorId.get(String(id));
      if (!c) return null;
      const texto = typeof c.description === "string" ? c.description.trim() : "";
      return texto || c.name || null;
    })
    .filter(Boolean);
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

/**
 * La nota que queda escrita en el cobro: «Cuota septiembre 2026 — Logopedia».
 *
 * `motivos` son las explicaciones que van DETRÁS del rótulo, con el mismo molde
 * que ya leen `lib/billing/motivoDelCobro.js` (el cuadro «de dónde sale esta
 * cifra» del cajón de cobrar) y `scripts/backfill-payments-invoice-text.js`.
 * Hoy solo lo usa la reserva de plaza; el volcado de Organízate escribía los
 * suyos a mano con este mismo separador.
 */
export function notaDeCobro({ mes, conceptos = [], rotulo = null, motivos = [] }) {
  const partes = [`Cuota ${mesLegible(mes)}`];
  if (conceptos.length) partes.push(conceptos.join(" + "));
  if (rotulo) partes.push(rotulo);
  for (const m of motivos) if (m) partes.push(m);
  return partes.join(" — ");
}

/**
 * La reserva de plaza que la familia ya pagó, descontada del PRIMER mes
 * (09/09/2026, Aumenta: «en cuotas que estamos creando, deja pendiente 30 €»).
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * En verano las familias pagan 30 € para guardar la plaza del curso siguiente,
 * y ese dinero se descuenta del primer mes. El 01/09/2026 eso se hizo con un
 * script de una sola vez (`scripts/descontar-reservas-septiembre.js`) contra
 * los cobros de septiembre YA generados: 242 cobros salieron con su «Reserva de
 * plaza ya abonada: −30 €» escrito en la nota.
 *
 * Pero la rebaja se quedó en aquellos cobros, no en la cuota. Así que cada
 * cuota que el centro da de alta DESDE ENTONCES genera el mes entero, la
 * familia paga lo suyo menos los 30 € que ya adelantó, y quedan 30 € pendientes
 * que nadie debe. Eso es lo que ven ellas.
 *
 * ── LAS DOS REGLAS ─────────────────────────────────────────────────────────
 * · **Se descuenta UNA vez.** `reservaAplicadaEn` guarda el mes en el que se
 *   aplicó; octubre vuelve a salir con la cuota entera. Mientras esté vacío se
 *   aplica al primer mes que se genere, sea cual sea.
 * · **No se prorratea**, igual que los conceptos negativos: la reserva se pagó
 *   entera, así que se resta entera aunque el mes de alta sea a medias.
 *
 * Y nunca deja el cobro por debajo de cero: si la reserva es mayor que el mes
 * (una cuota de 25 € con 30 € de reserva), se descuenta lo que cabe y el resto
 * se pierde a propósito — arrastrar un saldo a favor entre meses es otra cosa
 * y no la hace esto.
 *
 * @returns {{ importe: number, motivo: string }|null} `null` si no hay nada que descontar.
 */
export function descuentoDeReserva(cuota, mes, bruto) {
  const abonada = reservaPendiente(cuota, mes);
  if (!(abonada > 0)) return null;
  const cabe = Math.min(abonada, round2(Math.max(0, Number(bruto) || 0)));
  if (!(cabe > 0)) return null;
  const eur = Number.isInteger(cabe) ? String(cabe) : cabe.toFixed(2);
  return { importe: cabe, motivo: `Reserva de plaza ya abonada: −${eur} €` };
}

/**
 * Cuánta reserva le queda por descontar a UNA cuota en ese mes, ANTES de saber
 * si cabe en el importe. 0 si no pagó ninguna o si ya se gastó en otro mes.
 *
 * Sale aparte de `descuentoDeReserva` porque el cajón de Cobros la necesita
 * antes de tener el bruto delante: primero prorratea la tarifa del catálogo y
 * solo entonces le resta lo que NO se prorratea (10/09/2026).
 */
export function reservaPendiente(cuota, mes) {
  const abonada = Number(cuota?.reservaAbonada);
  if (!Number.isFinite(abonada) || abonada <= 0) return 0;
  const aplicadaEn = cuota?.reservaAplicadaEn ? String(cuota.reservaAplicadaEn) : null;
  // Ya se descontó en OTRO mes: este va entero.
  if (aplicadaEn && aplicadaEn !== mes) return 0;
  return round2(abonada);
}

/**
 * La de TODAS las cuotas que se están cobrando a la vez: el cajón rellena con
 * la suma de las cuotas de la familia, así que la reserva también se suma.
 */
export function reservaDeLasCuotas(cuotas, mes) {
  return round2((Array.isArray(cuotas) ? cuotas : []).reduce((s, c) => s + reservaPendiente(c, mes), 0));
}

/**
 * El PLAN de generación de un mes: qué cobro sale de cada cuota vigente, cuál
 * ya está generado y cuál no se puede generar.
 *
 * @param {object} p
 * @param {string} p.mes        'AAAA-MM'
 * @param {Array}  p.cuotas     filas planas de Cuota (con `client`/`patient` ya resueltos si se quieren rotular)
 * @param {Array}  p.conceptos  [{ id, name, description, unitPrice }] del catálogo
 *                              (`description` es el «Texto en la factura»: sin
 *                              él la línea de la factura sale con el nombre
 *                              interno del concepto)
 * @param {Array}  p.yaGenerados ids de cuota que YA tienen cobro ese mes (payments.cuota_id)
 * @param {Array}  p.metodos    filtro opcional de métodos ('cash'|'card'|'transfer'|'direct_debit')
 * @returns {{ aGenerar: Array, repetidas: Array, sinImporte: Array }}
 *   `aGenerar`: { cuotaId, clientId, patientId, nombre, paciente, importe,
 *   method, paidAt, periodMonth, notes, invoiceText, conceptId, tramo, rotulo }
 */
export function planDeCuotasDelMes({ mes, cuotas = [], conceptos = [], yaGenerados = [], metodos = null, citasPorClave = null } = {}) {
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
    // Las citas del mes de ese paciente (o familia), si quien llama las trae:
    // con ellas el mes de alta se prorratea por sesiones (AV-0062).
    // Y solo cuentan las citas de lo que ESTA cuota paga: una entrevista
    // inicial suelta no le marca el ritmo a la mensualidad (AV-0082).
    const citasCuota = citasDelConcepto(citasDeLaCuota(citasPorClave, cuota), cuota?.conceptIds);
    const tramo = tramoDelMes(mes, cuota, { citas: citasCuota });
    if (!tramo) continue;
    // El filtro por método se aplica DESPUÉS de la vigencia: «solo las de
    // banco» tiene que enseñar el mismo tramo y el mismo importe que el lote
    // entero, no un cálculo distinto.
    if (filtro && !filtro.has(cuota.method)) continue;

    const { importe: mensual, mensualProrrateable, fijo, conceptosPerdidos } = importeDeCuota(cuota, porId);
    // Y CADA TERAPIA POR SUS SESIONES (08/09/2026): las tres de pedagogía no
    // pueden pagar también la parte de la psicología. Sin nada que repartir
    // devuelve null y queda el factor único del tramo, que es lo de siempre.
    const reparto = repartoPorConcepto(mes, cuota, { conceptosPorId: porId, citas: citasCuota });
    const tramoCobrado = reparto?.tramo ?? tramo;
    const rotulo = rotuloDeTramo(tramoCobrado);
    const nombres = nombresDeConceptos(cuota, porId);
    const textosFactura = textosDeFacturaDeConceptos(cuota, porId);
    const ids = Array.isArray(cuota.conceptIds) ? cuota.conceptIds : [];
    /*
     * Lo que costaría el mes ANTES de la reserva: el prorrateo (por sesiones si
     * se puede, si no por días) más los conceptos negativos, que van enteros.
     */
    const bruto = round2((reparto ? reparto.importe : mensualProrrateable * tramo.factor) + fijo);
    // Y la reserva de plaza que ya pagó en verano, si le queda por descontar
    // (09/09/2026). Ver `descuentoDeReserva`: se resta entera y una sola vez.
    const reserva = descuentoDeReserva(cuota, mes, bruto);
    const fila = {
      cuotaId: String(cuota.id),
      // A nombre de quién nace el cobro: del PAGADOR si la cuota lo tiene (la
      // fundación que paga la de este niño, 07/09/2026) y si no de la familia.
      // Así «Facturar el mes» le saca su factura al pagador sin saber nada de
      // esto: agrupa por `clientId` del cobro, como siempre. La familia queda
      // apuntada aparte para quien tenga que decir de quién era.
      clientId: cuota.payerClientId
        ? String(cuota.payerClientId)
        : cuota.clientId ? String(cuota.clientId) : null,
      familiaId: cuota.clientId ? String(cuota.clientId) : null,
      payerClientId: cuota.payerClientId ? String(cuota.payerClientId) : null,
      pagador: cuota.pagador ?? null,
      patientId: cuota.patientId ? String(cuota.patientId) : null,
      nombre: cuota.nombre ?? null,
      paciente: cuota.paciente ?? null,
      /*
       * Prorrateado por el tramo: el mes de alta (o el de baja) no se cobra
       * entero. Los descuentos por algo ya abonado (conceptos negativos) van
       * ENTEROS y fuera del prorrateo: la reserva de plaza se pagó completa.
       */
      importe: round2(bruto - (reserva?.importe ?? 0)),
      importeMensual: mensual,
      /*
       * Lo que hay que escribir en la CUOTA cuando este cobro se cree, para
       * que la reserva no se descuente otra vez el mes que viene. Va en la fila
       * y no lo escribe esto porque `planDeCuotasDelMes` es puro y no toca la
       * base: quien crea el cobro lo estampa en la misma transacción.
       */
      reservaAplicada: reserva ? { mes, importe: reserva.importe } : null,
      method: cuota.method ?? null,
      periodMonth: `${mes}-01`,
      paidAt: fechaDeCobro(mes, cuota, tramo),
      // Solo con UN concepto: una cuota compuesta no se puede partir por
      // terapia, y es exactamente lo que `payments.concept_id` significa.
      conceptId: ids.length === 1 ? String(ids[0]) : null,
      conceptos: nombres,
      tramo: tramoCobrado,
      rotulo,
      notes: notaDeCobro({ mes, conceptos: nombres, rotulo, motivos: reserva ? [reserva.motivo] : [] }),
      /*
       * La línea que verá la familia (09/09/2026, Rodrigo: «los conceptos de
       * las facturas no deben ir aparejados a un texto aparte tipo "(viene de
       * organizate)" o "(30 euros menos de reserva)": simplemente y llanamente
       * el concepto»). Ni el mes, ni el rótulo del prorrateo, ni de dónde salió
       * el dato: eso es la NOTA, y la nota se queda dentro.
       *
       * Sin conceptos —una cuota de importe pactado a mano— no hay nada que
       * imprimir y se factura por la nota, que es lo de siempre.
       */
      invoiceText: textosFactura.length ? textosFactura.join(" + ") : null,
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
  // Quién paga, si no es la familia (07/09/2026, Registro: «una fundación o
  // una empresa que paga la cuota de un niño todos los meses hay que
  // facturarla a mano cada mes»). Vacío = paga la familia, lo de siempre.
  if (!parcial || "payerClientId" in b) {
    const id = b.payerClientId ? String(b.payerClientId) : null;
    if (id && !UUID_RE.test(id)) return { valores: null, problema: "El pagador no es válido" };
    valores.payerClientId = id;
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
  /*
   * La reserva de plaza ya pagada (09/09/2026). Vacío o 0 = no pagó ninguna,
   * que es lo normal.
   *
   * `reservaAplicadaEn` (el mes en el que ya se descontó) NO se toca aquí
   * salvo que venga en el cuerpo: lo escribe el que genera el mes. Quien sí lo
   * borra —para que la reserva vuelva a estar por descontar— es el PATCH,
   * cuando el importe de verdad cambia; hacerlo aquí lo borraría también en
   * cada edición que reenvía el campo sin tocarlo, y el descuento se repetiría
   * el mes siguiente.
   */
  if (!parcial || "reservaAbonada" in b) {
    if (b.reservaAbonada === null || b.reservaAbonada === undefined || b.reservaAbonada === "") {
      valores.reservaAbonada = null;
    } else {
      const n = Number(b.reservaAbonada);
      if (!Number.isFinite(n) || n < 0) return { valores: null, problema: "La reserva ya abonada tiene que ser un importe positivo" };
      valores.reservaAbonada = n > 0 ? round2(n) : null;
    }
  }
  if ("reservaAplicadaEn" in b) {
    const m = b.reservaAplicadaEn ? String(b.reservaAplicadaEn) : null;
    if (m && !mesValido(m)) return { valores: null, problema: "El mes de la reserva tiene que ser 'AAAA-MM'" };
    valores.reservaAplicadaEn = m;
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
  // El pagador es OTRA ficha: si es la propia familia, se deja vacío y ya.
  if (valores.payerClientId && valores.clientId && valores.payerClientId === valores.clientId) {
    return { valores: null, problema: "El pagador es la propia familia: déjalo vacío para que pague ella" };
  }
  return { valores, problema: null };
}

/* ── EL COBRO DEL MES EN CURSO SIGUE A SU CUOTA (05/09/2026) ────────────────
 *
 * Hasta hoy el cobro era una FOTO: nacía al pulsar «Generar el mes» y ahí se
 * quedaba. De ahí los dos avisos de Aumenta del 04/09: asignar una cuota no
 * hacía aparecer nada en Cobros (AV-0048) y editarla no cambiaba el cobro ya
 * generado, que seguía enseñando las terapias viejas (AV-0046). Las dos son la
 * misma: nadie mantenía al día el cobro PENDIENTE del mes en curso.
 *
 * Aquí vive la mitad decidible sin base de datos —si ese cobro se puede tocar y
 * qué habría que cambiarle—; quien lo aplica es `lib/billing/cobroDeCuota.js`.
 * `planDeCuotasDelMes` sigue siendo el dueño de QUÉ cobro sale de una cuota:
 * esto solo compara lo que hay con lo que debería haber.
 */

/** 'AAAA-MM-DD' de una fecha venga como venga (Date, ISO o ya suelta). */
function fechaSuelta(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  return FECHA_RE.test(s.slice(0, 10)) ? s.slice(0, 10) : null;
}

/**
 * ¿La nota del cobro la escribió el programa o una persona?
 *
 * Solo se pisa la del programa. Si alguien escribió a mano en Cobros por qué
 * ese mes es distinto, rehacer el cobro no puede borrárselo: ese texto es el
 * único sitio donde vive esa explicación.
 */
export function esNotaAutomatica(notas) {
  return /^Cuota\s+[a-záéíóúñ]+\s+\d{4}/i.test(String(notas ?? "").trim());
}

/**
 * ¿Se puede rehacer este cobro, o hay que dejarlo en paz?
 *
 * Solo se toca el cobro que todavía no es dinero ni papel: pendiente, sin
 * factura y sin nada del mundo real colgando (Stripe, el banco, una sesión de
 * pago abierta). En cuanto entró el dinero o se emitió la factura, el cobro
 * deja de ser un plan y pasa a ser un hecho — y un hecho no se reescribe
 * porque alguien haya cambiado la cuota después.
 *
 * @returns {{ ok: boolean, motivo: string|null }}
 */
export function cobroSePuedeRehacer(pago) {
  if (!pago) return { ok: false, motivo: "no hay cobro" };
  if (pago.status !== "pending") return { ok: false, motivo: "el cobro ya no está pendiente" };
  if (pago.invoiceId) return { ok: false, motivo: "el cobro ya está en una factura" };
  if (pago.stripePaymentIntentId) return { ok: false, motivo: "el cobro tiene un pago de Stripe detrás" };
  if (pago.bankTransactionId) return { ok: false, motivo: "el cobro ya está casado con un movimiento del banco" };
  if (pago.paymentSessionId) return { ok: false, motivo: "el cobro tiene un pago en marcha" };
  return { ok: true, motivo: null };
}

/**
 * Qué habría que cambiarle al cobro para que dijera lo que dice HOY su cuota.
 *
 * Devuelve solo los campos que de verdad cambian (o `null` si ya está al día),
 * para que un `update` sin cambios no ensucie el rastro ni el `updated_at`.
 *
 * El método SÍ se sincroniza: si la familia pasa de efectivo a domiciliación,
 * el recibo que todavía no se ha pasado tiene que salir por donde toca. La
 * nota, solo si la escribió el programa (`esNotaAutomatica`).
 *
 * @param pago fila de Payment (importe puede venir como cadena de DECIMAL)
 * @param fila la que devuelve `planDeCuotasDelMes` para esa cuota y ese mes
 */
export function cambiosDelCobro(pago, fila) {
  if (!pago || !fila) return null;
  const cambios = {};

  if (round2(Number(pago.amount)) !== round2(Number(fila.importe))) cambios.amount = fila.importe;

  const conceptoAhora = pago.conceptId ? String(pago.conceptId) : null;
  const conceptoNuevo = fila.conceptId ? String(fila.conceptId) : null;
  if (conceptoAhora !== conceptoNuevo) cambios.conceptId = conceptoNuevo;

  const fechaAhora = fechaSuelta(pago.paidAt);
  if (fila.paidAt && fechaAhora !== fila.paidAt) cambios.paidAt = fila.paidAt;

  // Sin método en la cuota no hay nada que imponerle al cobro: el lote le puso
  // el de por defecto y ese sigue valiendo.
  if (fila.method && pago.method !== fila.method) cambios.method = fila.method;

  if (fila.notes && pago.notes !== fila.notes && esNotaAutomatica(pago.notes)) cambios.notes = fila.notes;

  // El paciente y el pagador también siguen a la cuota (revisión del
  // 06/09/2026): al ponerle el hijo a una cuota «de la familia» —para eso está
  // el filtro «Sin paciente asignado»— el cobro pendiente se quedaba sin
  // paciente, y el lote por paciente lo metía en «(sin paciente asignado)».
  const pacienteAhora = pago.patientId ? String(pago.patientId) : null;
  const pacienteNuevo = fila.patientId ? String(fila.patientId) : null;
  if (pacienteAhora !== pacienteNuevo) cambios.patientId = pacienteNuevo;
  const pagadorAhora = pago.clientId ? String(pago.clientId) : null;
  const pagadorNuevo = fila.clientId ? String(fila.clientId) : null;
  if (pagadorNuevo && pagadorAhora !== pagadorNuevo) cambios.clientId = pagadorNuevo;

  return Object.keys(cambios).length ? cambios : null;
}
