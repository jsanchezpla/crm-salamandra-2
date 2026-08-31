import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { mesesSeguidosSinPagar } from "../../../../lib/billing/mesesSinPagar.js";

/**
 * GET /api/billing/morosidad?mes=AAAA-MM — quién no ha pagado el mes
 * (sprint Aumenta 2026-07, punto 8).
 *
 * QUIÉN DEBERÍA PAGAR: las familias con al menos un paciente ACTIVO. En un
 * centro con cuota mensual esa es la lista, y es la misma población que gobierna
 * el bloqueo del portal por impago. Un cliente sin pacientes activos (una
 * empresa, una familia de alta) no se persigue: no debe nada.
 *
 * QUIÉN HA PAGADO: quien tenga un cobro COMPLETADO con `periodMonth` de ese
 * mes. Es el mismo criterio que abre sus documentos en el área privada
 * (`lib/citas/portalMeses.js`), a propósito: que Cobros y el portal digan lo
 * mismo evita la conversación de «pues a mí me sale pagado».
 *
 * Devuelve además cuántos meses seguidos lleva sin pagar (mirando 6 atrás),
 * que es lo que distingue un despiste de un problema.
 */

const MESES_ATRAS = 6;

function mesDe(fecha) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Los N meses hasta `mes` incluido, del más reciente al más antiguo. */
function ventana(mes, n) {
  const [a, m] = mes.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(a, m - 1 - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Client, Patient, Payment } = ctx.tenantModels;
    if (!Patient) {
      // Tenant sin módulo de pacientes: aquí no hay cuota mensual que perseguir.
      return ok({ mes: null, morosos: [], alDia: 0, aplicable: false });
    }

    const sp = new URL(request.url).searchParams;
    const mes = sp.get("mes") || mesDe(new Date());
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return error("El mes debe ser 'AAAA-MM'", 422);

    const pacientes = await Patient.findAll({
      where: { status: "active", clientId: { [Op.ne]: null } },
      attributes: ["id", "clientId"],
    });
    const porCliente = new Map();
    for (const p of pacientes) {
      porCliente.set(String(p.clientId), (porCliente.get(String(p.clientId)) ?? 0) + 1);
    }
    const ids = [...porCliente.keys()];
    if (ids.length === 0) return ok({ mes, morosos: [], alDia: 0, aplicable: true });

    // ¿Desde cuándo cobra este centro por el CRM? Con CERO cobros registrados
    // la pantalla no acusa a nadie: dice que la caja está de estreno
    // (31/08/2026 — el día que Aumenta la estrenó, esta lista pintaba a las
    // 1.083 familias como morosas de 6 meses). Y con cobros, los «meses
    // seguidos» no cuentan más atrás del primer mes cobrado.
    const primerPeriodo = await Payment.min("periodMonth", {
      where: { status: "completed", periodMonth: { [Op.ne]: null } },
    });
    if (!primerPeriodo) {
      return ok({ mes, morosos: [], alDia: 0, aplicable: true, familias: ids.length, sinCobros: true });
    }
    const primerMes = String(primerPeriodo).slice(0, 7);

    const meses = ventana(mes, MESES_ATRAS);
    const desde = `${meses[meses.length - 1]}-01`;
    const cobros = await Payment.findAll({
      where: {
        clientId: { [Op.in]: ids },
        status: "completed",
        periodMonth: { [Op.gte]: desde },
      },
      attributes: ["clientId", "periodMonth", "amount", "paidAt"],
    });

    // Meses pagados por cliente + fecha del último cobro (para el listado).
    const pagados = new Map();
    const ultimo = new Map();
    for (const c of cobros) {
      const cid = String(c.clientId);
      const m = c.periodMonth ? String(c.periodMonth).slice(0, 7) : null;
      if (m) {
        if (!pagados.has(cid)) pagados.set(cid, new Set());
        pagados.get(cid).add(m);
      }
      const anterior = ultimo.get(cid);
      if (!anterior || new Date(c.paidAt) > new Date(anterior)) ultimo.set(cid, c.paidAt);
    }

    const clientes = await Client.findAll({ where: { id: { [Op.in]: ids } }, attributes: ["id", "name", "email", "phone"] });
    const nombres = new Map(clientes.map((c) => [String(c.id), c]));

    const morosos = [];
    let alDia = 0;
    for (const cid of ids) {
      const suyos = pagados.get(cid) ?? new Set();
      if (suyos.has(mes)) {
        alDia++;
        continue;
      }
      // Meses seguidos sin pagar, hacia atrás desde el mes pedido y sin
      // acusar de meses anteriores al primer cobro del centro (regla con
      // nombre y prueba: lib/billing/mesesSinPagar.js).
      const seguidos = mesesSeguidosSinPagar({ meses, pagados: suyos, primerMes });
      const cli = nombres.get(cid);
      morosos.push({
        clientId: cid,
        name: cli?.name ?? "(cliente borrado)",
        email: cli?.email ?? null,
        phone: cli?.phone ?? null,
        pacientesActivos: porCliente.get(cid) ?? 0,
        mesesSeguidos: seguidos,
        ultimoCobro: ultimo.get(cid) ?? null,
      });
    }
    // Primero quien más meses acumula: es a quien hay que llamar hoy.
    morosos.sort((a, b) => b.mesesSeguidos - a.mesesSeguidos || a.name.localeCompare(b.name));

    return ok({ mes, morosos, alDia, aplicable: true, familias: ids.length, primerMes });
  } catch (err) {
    return serverError(err);
  }
});
