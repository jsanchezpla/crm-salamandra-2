import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, error } from "../../../../lib/utils/apiResponse.js";
import { resumenDelDia, saldoDeMovimientos, cestaDe } from "../../../../lib/billing/caja.js";
import { madridToday, madridDayRange } from "../../../../lib/utils/madridDate.js";

/**
 * GET /api/arqueo/resumen?desde=&hasta=[&cajaId=] — el resumen DIARIO de lo
 * cobrado por forma de pago (01/09/2026, petición de Aumenta: «poder ver un
 * resumen por día de los cobros efectuados en efectivo, tarjeta y banco»).
 *
 * Devuelve una fila por día con efectivo / tarjeta / banco, más las entradas y
 * salidas de caja de ese día y lo que debería quedar en el cajón. Sin fechas,
 * el mes en curso.
 *
 * ── EL DÍA ES EL DE MADRID, NO EL DEL SERVIDOR ─────────────────────────────
 * El contenedor de producción va en UTC. Agrupar por el día del servidor mete
 * un cobro de las 00:30 de Madrid en el día anterior, y entonces el resumen no
 * cuadra con lo que la persona contó en el cajón. El corte se calcula con
 * `madridDayRange`, que además acierta en los cambios de hora.
 */

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** El instante de mediodía UTC de un día: sirve para preguntar «¿qué día es en Madrid?». */
const mediodia = (f) => new Date(`${f}T12:00:00Z`);

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("billing")) return forbidden();

  const { Payment, CashMovement } = tenantModels;
  const { searchParams } = new URL(request.url);

  const hoy = madridToday();
  const desde = searchParams.get("desde") || `${hoy.slice(0, 7)}-01`;
  const hasta = searchParams.get("hasta") || hoy;
  if (!FECHA_RE.test(desde) || !FECHA_RE.test(hasta)) return error("Las fechas deben ser 'AAAA-MM-DD'", 422);
  if (desde > hasta) return error("El 'desde' no puede ser posterior al 'hasta'", 422);

  const cajaId = searchParams.get("cajaId") || null;
  const { start } = madridDayRange(mediodia(desde));
  const { end } = madridDayRange(mediodia(hasta));

  const cobros = await Payment.findAll({
    where: { paidAt: { [Op.gte]: start, [Op.lt]: end } },
    attributes: ["id", "amount", "method", "status", "paidAt"],
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

  const filas = [...dias.entries()].map(([fecha, { cobros: c, movimientos: m }]) => ({
    fecha,
    ...resumenDelDia({ cobros: c, movimientos: m }),
  }));

  // El total del periodo se calcula sobre TODO junto (no sumando las filas):
  // así el redondeo se hace una sola vez, como en el resto del dinero.
  const total = resumenDelDia({
    cobros: cobros.map((c) => c.toJSON()),
    movimientos: movimientos.map((m) => m.toJSON()),
  });

  return ok({
    desde,
    hasta,
    // De más reciente a más antiguo, que es como se mira un resumen de caja.
    dias: filas.reverse(),
    total,
    saldoMovimientos: saldoDeMovimientos(movimientos.map((m) => m.toJSON())),
    // Los métodos que NO caen en ninguna cesta no existen hoy; si mañana se
    // añade uno al enum de Payment, esto lo canta en vez de perderlo.
    metodosSinCesta: [...new Set(cobros.map((c) => c.method).filter((m) => !cestaDe(m)))],
  });
});

/** El día siguiente de 'AAAA-MM-DD' (en fechas civiles, sin husos de por medio). */
function siguiente(f) {
  const [a, m, d] = f.split("-").map(Number);
  const x = new Date(Date.UTC(a, m - 1, d + 1));
  return x.toISOString().slice(0, 10);
}
