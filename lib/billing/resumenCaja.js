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

import { resumenDelDia, saldoDeMovimientos, cestaDe, cobrosDelDia } from "./caja.js";
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
  };
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

  const cobros = await Payment.findAll({
    where: { paidAt: { [Op.gte]: start, [Op.lt]: end } },
    attributes: ["id", "amount", "method", "status", "paidAt", "clientId", "invoiceId", "periodMonth", "notes"],
    include,
  });

  const movimientos = await CashMovement.findAll({
    where: { date: { [Op.between]: [desde, hasta] }, ...(cajaId ? { cashPointId: cajaId } : {}) },
    attributes: ["id", "date", "direction", "amount", "concept"],
  });

  // Un cubo por día, con TODOS los días del rango presentes: un día sin cobros
  // es un dato (no hubo caja), no una fila que falta.
  const dias = new Map();
  for (let f = desde; f <= hasta; f = siguiente(f)) dias.set(f, { cobros: [], movimientos: [] });

  for (const c of cobros) {
    const dia = madridToday(new Date(c.paidAt));
    if (dias.has(dia)) dias.get(dia).cobros.push(c.toJSON());
  }
  for (const m of movimientos) {
    const dia = String(m.date).slice(0, 10);
    if (dias.has(dia)) dias.get(dia).movimientos.push(m.toJSON());
  }

  const filas = [...dias.entries()].map(([fecha, { cobros: c, movimientos: m }]) => {
    const detalle = cobrosDelDia(c);
    return {
      fecha,
      ...resumenDelDia({ cobros: c, movimientos: m }),
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
    movimientos: movimientos.map((m) => m.toJSON()),
  });

  return {
    desde,
    hasta,
    // De más reciente a más antiguo, que es como se mira un resumen de caja.
    dias: filas.reverse(),
    total,
    saldoMovimientos: saldoDeMovimientos(movimientos.map((m) => m.toJSON())),
    // Los métodos que NO caen en ninguna cesta no existen hoy; si mañana se
    // añade uno al enum de Payment, esto lo canta en vez de perderlo.
    metodosSinCesta: [...new Set(cobros.map((c) => c.method).filter((m) => !cestaDe(m)))],
  };
}
