/**
 * lib/billing/caja.js — el dinero del cajón: entradas, salidas y el resumen de
 * un día por forma de pago (01/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: es la mitad decidible SIN base de datos de
 * la caja —qué acepta un apunte, cuánto suma, y cómo se reparte lo cobrado en
 * un día entre efectivo, tarjeta y banco—, compartida por los endpoints de
 * `/api/arqueo/*` y fijada por `scripts/_smoke-caja.mjs` sin levantar nada.)
 *
 * ── POR QUÉ EL ARQUEO NECESITA ESTO ────────────────────────────────────────
 * Lo esperado en el cajón era «fondo inicial + cobros en efectivo». Por el
 * cajón pasa más: se paga la mensajería, se saca el sobre para el banco, se
 * mete cambio. Sin apuntarlo, el arqueo descuadra todos los días y el descuadre
 * acaba explicado en un texto libre que dentro de seis meses no dice nada. Con
 * los apuntes, lo esperado es fondo + cobros en efectivo + entradas − salidas.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Las tres cestas que pidió el centro. `direct_debit` (la domiciliación) va con
 * el banco a propósito: para quien mira el resumen del día, una transferencia y
 * un recibo domiciliado son «lo que ha entrado por banco»; la diferencia entre
 * los dos sigue estando en el cobro, en Cobros y en la conciliación.
 */
export const CESTAS = {
  efectivo: ["cash"],
  tarjeta: ["card"],
  banco: ["transfer", "direct_debit"],
};

/**
 * Los métodos de cobro que entiende el CRM (el enum de `Payment.method`),
 * derivados de las cestas para que no puedan divergir. Los comparten las
 * cuotas, el lote de «Facturar el mes» y el resumen de caja: es UNA lista.
 */
export const METODOS_COBRO = Object.values(CESTAS).flat();

/** ¿Es un método de cobro de los que entiende el CRM? */
export function metodoValido(v) {
  return METODOS_COBRO.includes(String(v ?? ""));
}

/** Los métodos de una lista, saneados y sin repetir (los que no valen se caen). */
export function metodosValidos(lista) {
  return [...new Set((Array.isArray(lista) ? lista : []).map(String).filter(metodoValido))];
}

/** A qué cesta va un método de cobro (o null si no es de ninguna). */
export function cestaDe(metodo) {
  for (const [cesta, metodos] of Object.entries(CESTAS)) {
    if (metodos.includes(metodo)) return cesta;
  }
  return null;
}

/**
 * limpiarMovimiento(body) — qué acepta un apunte de caja (mismo patrón que
 * `camposGasto`/`conceptosCatalogo`: lo comparten la API y el formulario).
 *
 * Los cuatro datos que pidió el centro son obligatorios menos las
 * observaciones: fecha, importe, concepto y —el que decide todo— si entra o
 * sale. El importe se guarda SIEMPRE positivo: si llega en negativo se toma su
 * valor absoluto, porque teclear «-20» para una salida es lo que hará todo el
 * mundo y guardar −20 en una salida la contaría dos veces.
 */
export function limpiarMovimiento(body, { parcial = false } = {}) {
  const valores = {};
  const b = body || {};

  if (!parcial || "cashPointId" in b) {
    const id = String(b.cashPointId ?? "").trim();
    if (!id) return { valores: null, problema: "Falta la caja" };
    valores.cashPointId = id;
  }
  if (!parcial || "date" in b) {
    const f = typeof b.date === "string" ? b.date.slice(0, 10) : "";
    if (!FECHA_RE.test(f)) return { valores: null, problema: "La fecha tiene que ser 'AAAA-MM-DD'" };
    valores.date = f;
  }
  if (!parcial || "direction" in b) {
    const d = String(b.direction ?? "");
    if (d !== "in" && d !== "out") return { valores: null, problema: "Di si el dinero entra o sale" };
    valores.direction = d;
  }
  if (!parcial || "amount" in b) {
    const n = Number(b.amount);
    if (!Number.isFinite(n) || n === 0) return { valores: null, problema: "El importe tiene que ser un número distinto de 0" };
    valores.amount = round2(Math.abs(n)); // el signo lo pone `direction`
  }
  if (!parcial || "concept" in b) {
    const t = typeof b.concept === "string" ? b.concept.trim() : "";
    if (!t) return { valores: null, problema: "Escribe el concepto: un apunte sin concepto no cuadra nada" };
    valores.concept = t.slice(0, 200);
  }
  if (!parcial || "notes" in b) {
    const t = typeof b.notes === "string" ? b.notes.trim() : "";
    valores.notes = t ? t.slice(0, 2000) : null;
  }
  return { valores, problema: null };
}

/** Entradas, salidas y neto de una lista de apuntes. */
export function saldoDeMovimientos(movimientos = []) {
  let entradas = 0;
  let salidas = 0;
  for (const m of movimientos) {
    // Un importe guardado en negativo (datos viejos, una importación) no puede
    // restar dos veces: manda `direction` y del importe solo el valor.
    const importe = Math.abs(Number(m?.amount) || 0);
    if (m?.direction === "out") salidas += importe;
    else entradas += importe;
  }
  return { entradas: round2(entradas), salidas: round2(salidas), neto: round2(entradas - salidas) };
}

/**
 * ── EL FONDO DE HOY ES LO QUE SE CONTÓ AYER (07/09/2026, AV-0067 de Aumenta) ──
 *
 * Rosa: «no puedo cuadrar saldo porque no sé de qué saldo habéis partido».
 * Y era literal: la casilla «Fondo inicial» del cierre se abría VACÍA cada vez
 * y nadie llevaba el saldo de un día al siguiente, así que el cajón no tenía
 * continuidad y el arqueo partía de cero todos los días. En Aumenta, además,
 * los 828 cierres que vinieron de Organízate entraron con fondo 0 y sin nada
 * contado: no había ni un número del que tirar.
 *
 * Un cajón real no empieza de cero: empieza con lo que quedó al cerrar. Esto
 * devuelve ese número para PROPONERLO, y la persona lo cambia si el sobre fue
 * al banco o si metió cambio. Nunca decide sola: si no hay cierre anterior
 * —el primero de todos— devuelve null y la pantalla lo dice en vez de sugerir
 * un cero que parecería un dato.
 *
 * Y UN CIERRE QUE NO CONTÓ NADIE NO PROPONE NADA. Los 828 cierres de Aumenta
 * vinieron de Organízate («Importado de Organízate: solo constan las fechas»)
 * con fondo, contado y esperado a 0 y SIN autor: proponer ese 0 diciendo «es
 * lo que se contó el 31/07» sería inventarse un dato con cara de dato, que es
 * peor que la casilla vacía que había antes.
 *
 * La regla es de DOS caras, y la segunda salió de probarlo: no basta con pedir
 * autor. `closedById` sale de `resolveCurrentTeamMemberId`, así que un cierre
 * hecho por un administrador que no está en la plantilla se guarda sin autor
 * —pasa en las cuentas de prueba y puede pasar en un centro pequeño— y con la
 * regla estricta se quedaba sin propuesta teniendo un conteo perfectamente
 * bueno. Así que propone si lo cerró alguien O si de verdad se contó dinero.
 * Lo único que cae por los dos lados a la vez es el cascarón importado.
 *
 * Ojo a lo que NO hace: no mira los apuntes de entrada y salida. Esos ya
 * cuentan en el ESPERADO del día (`fondo + efectivo + entradas − salidas`), y
 * sumarlos también aquí los contaría dos veces.
 */
export function fondoSugerido(ultimoCierre) {
  if (!ultimoCierre) return null;
  const contado = Number(ultimoCierre.countedAmount ?? ultimoCierre.counted_amount);
  if (!Number.isFinite(contado) || contado < 0) return null;
  const loCerroAlguien = ultimoCierre.hechoPorUnaPersona !== false;
  if (!loCerroAlguien && !(contado > 0)) return null;
  return {
    importe: round2(contado),
    fecha: ultimoCierre.closeDate ?? ultimoCierre.close_date ?? null,
  };
}

/**
 * ¿Ese cobro ha ENTRADO en la caja? Cobrado, sí. Devuelto, TAMBIÉN: el dinero
 * entró el día del cobro y salió el día de la devolución (`refundedAt`), y son
 * dos apuntes distintos en dos días distintos (07/09/2026). Hasta hoy un cobro
 * devuelto desaparecía del día en que se cobró —como si nunca hubiera entrado—
 * y no aparecía en ninguno como salida: el arqueo del día del cobro dejaba de
 * cuadrar con lo que se contó entonces, y el de la devolución cuadraba de
 * menos. Pendiente y fallido no han entrado.
 */
export function haEntrado(cobro) {
  const s = cobro?.status;
  if (!s || s === "completed") return true;
  // Un devuelto SIN fecha de devolución no se puede contar como entrado: la
  // salida se apunta el día de `refundedAt`, así que sin ella sumaría en su día
  // y no restaría en ninguno — un descuadre inventado. Sin fecha se comporta
  // como antes del 07/09/2026: fuera de la caja.
  return s === "refunded" && Boolean(cobro?.refundedAt);
}

/**
 * cobrosDelDia(cobros, devoluciones) — el DETALLE que va debajo de la fila del
 * día (`devoluciones`: los cobros devueltos ESE día, que salen en negativo)
 * (04/09/2026, Rodrigo: «en el resumen por día me tiene que salir una lista de
 * todos los cobros que se han hecho aparte del total, porque solo sale el total
 * del día»).
 *
 * Devuelve los cobros que SUMAN, del más temprano al más tarde, y aparte el
 * recuento de los pendientes.
 *
 * ── POR QUÉ LOS PENDIENTES NO SE LISTAN ────────────────────────────────────
 * Por la misma razón por la que no suman: no han entrado. Pero además hay un
 * motivo de tamaño — la generación mensual de cuotas crea CIENTOS de cobros
 * pendientes de golpe, todos con la misma fecha. Listarlos aquí enterraría los
 * cuatro cobros de verdad del día bajo trescientas filas que no son dinero. Se
 * dice cuántos son y cuánto suman, que es lo que hace falta saber, y se miran
 * en Cobros, que es su pantalla.
 *
 * ── EL ORDEN ES LA HORA, Y LOS QUE NO LA TIENEN VAN AL FINAL ───────────────
 * La lista se lee junto al cajón, de la primera cobrada a la última. Un cobro
 * importado sin hora (`paidAt` a null) no puede colarse el primero solo porque
 * su fecha vacía ordene antes: va al final, donde no confunde el repaso.
 */
export function cobrosDelDia(cobros = [], devoluciones = []) {
  const lista = [];
  let pendientes = 0;
  let importePendiente = 0;

  for (const c of cobros) {
    if (!haEntrado(c)) {
      pendientes += 1;
      importePendiente += Number(c?.amount) || 0;
      continue;
    }
    lista.push(c);
  }
  // La devolución se lista como una fila más del día, en negativo y a la hora
  // en que se devolvió: es lo que se ve al repasar el cajón.
  for (const c of devoluciones) {
    if (!c || c.status !== "refunded") continue;
    lista.push({ ...c, devolucion: true, amount: -Math.abs(Number(c.amount) || 0), paidAt: c.refundedAt ?? c.paidAt ?? null });
  }

  lista.sort((a, b) => {
    const ha = a?.paidAt ? String(a.paidAt) : "";
    const hb = b?.paidAt ? String(b.paidAt) : "";
    if (!ha && !hb) return 0;
    if (!ha) return 1;
    if (!hb) return -1;
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });

  return { lista, pendientes: { cobros: pendientes, importe: round2(importePendiente) } };
}

/**
 * El RESUMEN DE UN DÍA: cuánto entró por efectivo, tarjeta y banco, más el
 * movimiento del cajón.
 *
 * Solo cuentan los cobros `completed`: un cobro pendiente (los que genera la
 * cuota del mes) todavía no es dinero, y meterlo aquí haría cuadrar la caja
 * contra dinero que no ha llegado.
 *
 * @param {object} p
 * @param {Array}  p.cobros      filas planas de Payment ({ amount, method, status })
 * @param {Array}  p.movimientos apuntes de caja del día
 * @param {number} p.fondoInicial lo que había en el cajón al abrir
 */
export function resumenDelDia({ cobros = [], devoluciones = [], movimientos = [], fondoInicial = 0 } = {}) {
  const porCesta = {
    efectivo: { importe: 0, cobros: 0, devuelto: 0 },
    tarjeta: { importe: 0, cobros: 0, devuelto: 0 },
    banco: { importe: 0, cobros: 0, devuelto: 0 },
  };
  let pendiente = 0;
  let devuelto = 0;
  let numDevoluciones = 0;

  for (const c of cobros) {
    const importe = Number(c?.amount) || 0;
    if (!haEntrado(c)) { pendiente += importe; continue; }
    const cesta = cestaDe(c?.method);
    if (!cesta) continue;
    porCesta[cesta].importe += importe;
    porCesta[cesta].cobros += 1;
  }
  // Las devoluciones de ESE día restan de su cesta: el dinero salió por donde
  // entró (el efectivo se saca del cajón, la tarjeta se abona a la tarjeta).
  for (const c of devoluciones) {
    if (!c || c.status !== "refunded") continue;
    const importe = Math.abs(Number(c.amount) || 0);
    const cesta = cestaDe(c.method);
    if (!cesta) continue;
    porCesta[cesta].importe -= importe;
    porCesta[cesta].devuelto += importe;
    devuelto += importe;
    numDevoluciones += 1;
  }
  for (const k of Object.keys(porCesta)) {
    porCesta[k].importe = round2(porCesta[k].importe);
    porCesta[k].devuelto = round2(porCesta[k].devuelto);
  }

  const caja = saldoDeMovimientos(movimientos);
  const cobrado = round2(porCesta.efectivo.importe + porCesta.tarjeta.importe + porCesta.banco.importe);

  return {
    ...porCesta,
    cobrado,
    // Lo apuntado pero aún sin cobrar: se enseña aparte para que nadie sume mal.
    pendiente: round2(pendiente),
    // Lo devuelto ese día (ya restado de las cestas): se dice aparte para que
    // un día con 100 cobrados y 100 devueltos no parezca un día sin caja.
    devuelto: round2(devuelto),
    devoluciones: numDevoluciones,
    movimientos: caja,
    // Lo que debería haber en el cajón al cerrar: fondo + efectivo (ya sin lo
    // devuelto en efectivo) + entradas − salidas.
    enCaja: round2(Number(fondoInicial || 0) + porCesta.efectivo.importe + caja.neto),
  };
}
