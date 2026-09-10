/**
 * lib/billing/resumenCaja.js — el resumen de caja POR DÍA, armado una sola vez
 * (04/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2. Nace de un encargo de Rodrigo —«en la caja
 * debería poder exportar a Excel del resumen por día elegido»— y de la lección
 * que ya dejó escrita `lib/billing/filtrosGasto.js`: cuando la pantalla y su
 * Excel arman la consulta cada uno por su lado, acaban enseñando cifras
 * distintas para las mismas fechas y nadie sabe cuál creerse. Aquí la consulta,
 * el agrupado por día y el reparto en cestas se hacen UNA vez; el endpoint de
 * la pantalla la devuelve como JSON y el del Excel la escribe en celdas.)
 *
 * Lo que NO vive aquí es lo puro —qué cesta le toca a cada método, cómo se
 * suma un día, qué se guarda de un apunte—: eso sigue en `caja.js`, que se
 * prueba sin base de datos. Esto es la mitad que necesita Sequelize.
 */

import { Op } from "sequelize";

import { resumenDelDia, saldoDeMovimientos, cestaDe, cobrosDelDia, saldoDiarioEfectivo, fondoSugerido } from "./caja.js";
import { billingHasPatients } from "./patientLink.js";
import { madridToday, madridDayRange } from "../utils/madridDate.js";

export const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** El instante de mediodía UTC de un día: sirve para preguntar «¿qué día es en Madrid?». */
const mediodia = (f) => new Date(`${f}T12:00:00Z`);

/** El día siguiente de 'AAAA-MM-DD' (en fechas civiles, sin husos de por medio). */
function siguiente(f) {
  const [a, m, d] = f.split("-").map(Number);
  const x = new Date(Date.UTC(a, m - 1, d + 1));
  return x.toISOString().slice(0, 10);
}

/**
 * Las fechas del resumen, saneadas. Sin nada, el mes en curso (en Madrid).
 * @returns {{desde: string, hasta: string} | {error: string}}
 */
export function rangoDelResumen(searchParams) {
  const hoy = madridToday();
  const desde = searchParams.get("desde") || `${hoy.slice(0, 7)}-01`;
  const hasta = searchParams.get("hasta") || hoy;
  if (!FECHA_RE.test(desde) || !FECHA_RE.test(hasta)) return { error: "Las fechas deben ser 'AAAA-MM-DD'" };
  if (desde > hasta) return { error: "El 'desde' no puede ser posterior al 'hasta'" };
  return { desde, hasta };
}

/**
 * Un cobro, plano, tal y como lo pinta la lista del día: el pagador por los dos
 * caminos posibles y el paciente delante cuando lo hay (03/09/2026, Aumenta:
 * «que aparezca siempre primero el paciente»).
 */
function unCobro(c) {
  const cliente = c.client ?? c.invoice?.client ?? null;
  return {
    id: c.id,
    paidAt: c.paidAt,
    amount: Number(c.amount) || 0,
    method: c.method,
    clientName: cliente?.name ?? null,
    patientName: c.patient
      ? [c.patient.firstName, c.patient.lastName].filter(Boolean).join(" ") || null
      : null,
    invoiceId: c.invoice?.id ?? null,
    invoiceNumber: c.invoice?.number ?? null,
    periodMonth: c.periodMonth ? String(c.periodMonth).slice(0, 7) : null,
    // Para la vista lateral del cobro: la nota explica un cobro raro y es lo
    // primero que se mira al repasar la caja (04/09/2026).
    notes: c.notes ?? null,
    // La fila de una devolución (07/09/2026): en negativo y a la hora en que
    // se devolvió. El id es el del cobro, así que la vista lateral abre el mismo.
    devolucion: Boolean(c.devolucion),
    refundedAt: c.refundedAt ?? null,
  };
}

/**
 * CON CUÁNTO SE ABRE EL PRIMER DÍA DEL PERIODO (09/09/2026).
 *
 * La pestaña de efectivo arrastra el saldo del cajón, y para arrastrarlo hay
 * que saber de qué se parte: lo que se contó en el último cierre ANTERIOR a
 * `desde`. La regla de qué conteo vale es la del fondo del cierre siguiente
 * (`fondoSugerido`), y por el mismo motivo: los 828 cierres que Aumenta
 * importó de Organízate están a cero y sin autor, y partir de ese cero sería
 * inventarse un dato con cara de dato. Sin cierre válido devuelve null y la
 * pantalla dice que el periodo empieza de cero.
 *
 * ⚠️ La limitación de siempre: `Payment` no guarda en qué caja se cobró, así
 * que con dos cajas los cobros salen iguales para todas. Los cierres sí van
 * por caja cuando se pide una.
 */
async function saldoAntesDe({ tenantModels, desde, cajaId }) {
  const { CashClose } = tenantModels;
  if (!CashClose) return null;
  const where = { closeDate: { [Op.lt]: desde } };
  if (cajaId) where.cashPointId = cajaId;
  const ultimo = await CashClose.findOne({
    where,
    order: [["closeDate", "DESC"], ["createdAt", "DESC"]],
    attributes: ["closeDate", "countedAmount", "closedById"],
  });
  if (!ultimo) return null;
  return fondoSugerido({
    closeDate: ultimo.closeDate,
    countedAmount: ultimo.countedAmount,
    hechoPorUnaPersona: Boolean(ultimo.closedById),
  });
}

/**
 * LOS ARQUEOS DEL PERIODO, POR DÍA (10/09/2026).
 *
 * El saldo arrastrado dice lo que debería haber; el día que alguien cuenta el
 * cajón se sabe lo que hay, y el arrastre sigue desde ahí (ver
 * `saldoDiarioEfectivo`). Vale el mismo conteo que propone el fondo del cierre
 * siguiente: un cascarón importado de Organízate —a cero y sin autor— no manda
 * nada, porque nadie contó ese cero.
 *
 * Si un día tiene cierres de DOS cajas y no se ha pedido ninguna en concreto,
 * ese día no manda: los cobros no van por caja (la limitación de siempre) y
 * quedarse con el conteo de una sola sería peor que seguir arrastrando.
 */
async function arqueosDelPeriodo({ tenantModels, desde, hasta, cajaId }) {
  const { CashClose } = tenantModels;
  if (!CashClose) return null;
  const filas = await CashClose.findAll({
    where: { closeDate: { [Op.between]: [desde, hasta] }, ...(cajaId ? { cashPointId: cajaId } : {}) },
    attributes: ["closeDate", "countedAmount", "closedById"],
  });

  const porDia = new Map();
  const repetidos = new Set();
  for (const c of filas) {
    const fecha = String(c.closeDate).slice(0, 10);
    if (porDia.has(fecha)) repetidos.add(fecha);
    const conteo = fondoSugerido({
      closeDate: fecha,
      countedAmount: c.countedAmount,
      hechoPorUnaPersona: Boolean(c.closedById),
    });
    if (conteo) porDia.set(fecha, { contado: conteo.importe });
  }
  for (const fecha of repetidos) porDia.delete(fecha);
  return porDia;
}

/**
 * El resumen entero: una fila por día (con los días vacíos), su lista de
 * cobros, los totales del periodo y el saldo de los apuntes de caja.
 *
 * ── EL DÍA ES EL DE MADRID, NO EL DEL SERVIDOR ─────────────────────────────
 * El contenedor de producción va en UTC. Agrupar por el día del servidor mete
 * un cobro de las 00:30 de Madrid en el día anterior, y entonces el resumen no
 * cuadra con lo que la persona contó en el cajón. El corte se calcula con
 * `madridDayRange`, que además acierta en los cambios de hora.
 */
export async function construirResumenCaja({ tenantModels, hasModule, desde, hasta, cajaId = null }) {
  const { Payment, CashMovement, Client, Invoice, Patient } = tenantModels;

  const { start } = madridDayRange(mediodia(desde));
  const { end } = madridDayRange(mediodia(hasta));

  /*
   * El cobro viaja con QUIÉN pagó y por qué, porque la fila del día se
   * despliega y enseña la lista (04/09/2026, Rodrigo). El cliente llega por los
   * dos caminos de siempre —el enlace directo del cobro y el de su factura—,
   * como en la pantalla de Cobros; el paciente solo donde hay tabla de
   * pacientes. `required: false` en todos: un cobro sin factura, sin ficha o
   * sin paciente tiene que seguir saliendo en el arqueo.
   */
  const conPaciente = Boolean(Patient) && billingHasPatients(hasModule);
  const include = [];
  if (Invoice) {
    include.push({
      model: Invoice, as: "invoice", attributes: ["id", "number"], required: false,
      ...(Client ? { include: [{ model: Client, as: "client", attributes: ["id", "name"], required: false }] } : {}),
    });
  }
  if (Client) include.push({ model: Client, as: "client", attributes: ["id", "name"], required: false });
  if (conPaciente) {
    include.push({ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false });
  }

  const atributos = ["id", "amount", "method", "status", "paidAt", "refundedAt", "clientId", "invoiceId", "periodMonth", "notes"];
  const cobros = await Payment.findAll({
    where: { paidAt: { [Op.gte]: start, [Op.lt]: end } },
    attributes: atributos,
    include,
  });

  /*
   * Las DEVOLUCIONES del periodo (07/09/2026): un cobro «Devuelto» entró el día
   * del cobro (está en `cobros`, por `paidAt`) y salió el día de la devolución
   * (`refundedAt`), que puede ser otro día u otro mes. Se piden aparte, por su
   * fecha de salida, y cada una resta en su día. Sin esto, marcar un cobro como
   * devuelto no apuntaba la salida en ningún sitio y el arqueo del día de la
   * devolución cuadraba de menos.
   */
  const devoluciones = await Payment.findAll({
    where: { status: "refunded", refundedAt: { [Op.gte]: start, [Op.lt]: end } },
    attributes: atributos,
    include,
  });

  const movimientos = await CashMovement.findAll({
    where: { date: { [Op.between]: [desde, hasta] }, ...(cajaId ? { cashPointId: cajaId } : {}) },
    attributes: ["id", "date", "direction", "amount", "concept"],
  });

  // Un cubo por día, con TODOS los días del rango presentes: un día sin cobros
  // es un dato (no hubo caja), no una fila que falta.
  const dias = new Map();
  for (let f = desde; f <= hasta; f = siguiente(f)) dias.set(f, { cobros: [], devoluciones: [], movimientos: [] });

  for (const c of cobros) {
    const dia = madridToday(new Date(c.paidAt));
    if (dias.has(dia)) dias.get(dia).cobros.push(c.toJSON());
  }
  for (const c of devoluciones) {
    const dia = madridToday(new Date(c.refundedAt));
    if (dias.has(dia)) dias.get(dia).devoluciones.push(c.toJSON());
  }
  for (const m of movimientos) {
    const dia = String(m.date).slice(0, 10);
    if (dias.has(dia)) dias.get(dia).movimientos.push(m.toJSON());
  }

  const filas = [...dias.entries()].map(([fecha, { cobros: c, devoluciones: dv, movimientos: m }]) => {
    const detalle = cobrosDelDia(c, dv);
    return {
      fecha,
      ...resumenDelDia({ cobros: c, devoluciones: dv, movimientos: m }),
      // La lista que se despliega bajo la fila: lo que suma, en orden de hora.
      lista: detalle.lista.map(unCobro),
      // Los pendientes NO se listan (son cientos al generar las cuotas del
      // mes), pero se dice cuántos son para que nadie los eche en falta.
      pendientes: detalle.pendientes,
    };
  });

  // El total del periodo se calcula sobre TODO junto (no sumando las filas):
  // así el redondeo se hace una sola vez, como en el resto del dinero.
  const total = resumenDelDia({
    cobros: cobros.map((c) => c.toJSON()),
    devoluciones: devoluciones.map((c) => c.toJSON()),
    movimientos: movimientos.map((m) => m.toJSON()),
  });

  /*
   * El saldo del cajón se arrastra hacia DELANTE, así que se calcula con las
   * filas en orden ascendente —antes de darles la vuelta para la pantalla— y
   * partiendo de lo que se contó en el último cierre anterior al periodo.
   */
  const saldoInicial = await saldoAntesDe({ tenantModels, desde, cajaId });
  // Los días arqueados fijan el saldo en lo CONTADO, que es de donde parte el
  // cierre siguiente: así la columna «Queda en caja» y el número que propone
  // «Cerrar caja» son el mismo (10/09/2026).
  const arqueos = await arqueosDelPeriodo({ tenantModels, desde, hasta, cajaId });
  const conSaldo = saldoDiarioEfectivo(filas, saldoInicial?.importe ?? 0, arqueos);
  // Lo que queda en el cajón al final del periodo: la cifra que se mira «a
  // golpe de vista». Se lee del último día ANTES de dar la vuelta a la lista.
  const enCajaAlFinal = conSaldo.length
    ? conSaldo[conSaldo.length - 1].efectivoDelDia.queda
    : Number(saldoInicial?.importe ?? 0);

  return {
    desde,
    hasta,
    // De más reciente a más antiguo, que es como se mira un resumen de caja.
    dias: conSaldo.reverse(),
    // De qué se parte y de cuándo (null = no hay cierre anterior con conteo:
    // el periodo empieza en cero y la pantalla lo dice).
    saldoInicial,
    enCajaAlFinal,
    total,
    saldoMovimientos: saldoDeMovimientos(movimientos.map((m) => m.toJSON())),
    // Los métodos que NO caen en ninguna cesta no existen hoy; si mañana se
    // añade uno al enum de Payment, esto lo canta en vez de perderlo.
    // Un PENDIENTE puede no tener método (10/09/2026): eso no es un método que
    // el resumen no sepa clasificar, es un hueco a la espera de que alguien
    // cobre. Solo cantan los que dicen algo que no cae en ninguna cesta.
    metodosSinCesta: [...new Set(cobros.map((c) => c.method).filter((m) => m && !cestaDe(m)))],
  };
}
