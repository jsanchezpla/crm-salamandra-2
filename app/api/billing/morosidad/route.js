import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { mesesSeguidosSinPagar, loQueFaltaDelMes } from "../../../../lib/billing/mesesSinPagar.js";
import { mesVigente, debeElMes, planDeCuotasDelMes } from "../../../../lib/billing/cuotas.js";

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
    const mes = sp.get("mes") || mesVigente();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return error("El mes debe ser 'AAAA-MM'", 422);

    // La morosidad de un mes NO EXISTE hasta su día 1 (01/09/2026, Rodrigo,
    // universal): nadie debe septiembre en agosto. Salta sola el día 1 porque
    // este es el freno y la pantalla abre en el mes vigente.
    if (mes > mesVigente()) {
      return ok({ mes, morosos: [], alDia: 0, aplicable: true, futuro: true });
    }

    const pacientes = await Patient.findAll({
      where: { status: "active", clientId: { [Op.ne]: null } },
      attributes: ["id", "clientId"],
    });
    const porCliente = new Map();
    for (const p of pacientes) {
      porCliente.set(String(p.clientId), (porCliente.get(String(p.clientId)) ?? 0) + 1);
    }
    // ── LA VIGENCIA DE LAS CUOTAS MANDA (01/09/2026, Rodrigo) ──────────────
    // Una familia con cuotas asignadas debe el mes M solo si alguna lo cubre:
    // la de «enero a marzo» sale en enero, febrero y marzo, y en abril
    // desaparece sola aunque el paciente siga de alta. Una familia SIN cuotas
    // asignadas sigue con la regla de siempre (paciente activo): a esas no se
    // les puede aplicar una vigencia que nadie escribió.
    const { Cuota } = ctx.tenantModels;
    const cuotasPorCliente = new Map();
    if (Cuota) {
      // Con importe y conceptos (07/09/2026): hacen falta para saber cuánto
      // ESPERA el mes y decir «debe 60 €» cuando se pagó a medias.
      const filas = await Cuota.findAll({ attributes: ["id", "clientId", "patientId", "startDate", "endDate", "active", "amount", "conceptIds", "method", "dayOfMonth"], raw: true });
      for (const f of filas) {
        if (!f.clientId) continue;
        const cid = String(f.clientId);
        if (!cuotasPorCliente.has(cid)) cuotasPorCliente.set(cid, []);
        cuotasPorCliente.get(cid).push(f);
      }
    }
    const poblacion = new Set(porCliente.keys());
    for (const [cid, filas] of cuotasPorCliente) {
      if (debeElMes(filas, mes)) poblacion.add(cid);
      else poblacion.delete(cid);
    }

    const ids = [...poblacion];
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

    // Meses pagados por cliente + fecha del último cobro (para el listado),
    // y cuánto se ha cobrado del mes pedido (para el pagado a medias).
    const pagados = new Map();
    const ultimo = new Map();
    const cobradoDelMes = new Map();
    for (const c of cobros) {
      const cid = String(c.clientId);
      const m = c.periodMonth ? String(c.periodMonth).slice(0, 7) : null;
      if (m) {
        if (!pagados.has(cid)) pagados.set(cid, new Set());
        pagados.get(cid).add(m);
        if (m === mes) cobradoDelMes.set(cid, (cobradoDelMes.get(cid) ?? 0) + Number(c.amount || 0));
      }
      const anterior = ultimo.get(cid);
      if (!anterior || new Date(c.paidAt) > new Date(anterior)) ultimo.set(cid, c.paidAt);
    }

    /*
     * ── UN MES PAGADO A MEDIAS NO ES UN MES PAGADO (07/09/2026) ─────────────
     * Desde el 04/09 un mes se puede cobrar en dos veces. Con los 100 € de
     * los 160 € apuntados, la familia salía «al día». Lo que ESPERA el mes lo
     * dicen sus cuotas (`planDeCuotasDelMes`, el mismo cálculo que genera los
     * cobros, con el prorrateo del mes de alta); sin cuotas asignadas no hay
     * con qué comparar y manda la regla de siempre (algún cobro = pagado).
     */
    const { BillingConcept } = ctx.tenantModels;
    let conceptos = [];
    if (BillingConcept) {
      try {
        conceptos = (await BillingConcept.findAll({ attributes: ["id", "name", "unitPrice"], raw: true })).map((c) => ({ id: c.id, name: c.name, unitPrice: c.unitPrice }));
      } catch { conceptos = []; }
    }
    const esperadoDelMes = (cid) => {
      const filasCuota = cuotasPorCliente.get(cid);
      if (!filasCuota?.length) return null;
      const { aGenerar } = planDeCuotasDelMes({ mes, cuotas: filasCuota, conceptos });
      return aGenerar.reduce((s, f) => s + Number(f.importe || 0), 0);
    };

    const clientes = await Client.findAll({ where: { id: { [Op.in]: ids } }, attributes: ["id", "name", "email", "phone"] });
    const nombres = new Map(clientes.map((c) => [String(c.id), c]));

    const morosos = [];
    let alDia = 0;
    for (const cid of ids) {
      const suyos = pagados.get(cid) ?? new Set();
      const falta = suyos.has(mes)
        ? loQueFaltaDelMes({ pagado: cobradoDelMes.get(cid) ?? 0, esperado: esperadoDelMes(cid) })
        : null;
      if (suyos.has(mes) && !falta) {
        alDia++;
        continue;
      }
      // Pagado a medias: sale en la lista con lo que falta y sin acumular
      // meses (este mes no está sin pagar, está a medias).
      if (falta) {
        const cli = nombres.get(cid);
        morosos.push({
          clientId: cid,
          name: cli?.name ?? "(cliente borrado)",
          email: cli?.email ?? null,
          phone: cli?.phone ?? null,
          pacientesActivos: porCliente.get(cid) ?? 0,
          mesesSeguidos: 0,
          debe: falta.debe,
          pagado: falta.pagado,
          esperado: falta.esperado,
          ultimoCobro: ultimo.get(cid) ?? null,
        });
        continue;
      }
      // Meses seguidos sin pagar, hacia atrás desde el mes pedido y sin
      // acusar de meses anteriores al primer cobro del centro (regla con
      // nombre y prueba: lib/billing/mesesSinPagar.js). Con cuota asignada,
      // tampoco de antes de que SU cuota empezara: la de enero no debe
      // diciembre.
      let primerMesCliente = primerMes;
      const filasCuota = cuotasPorCliente.get(cid);
      if (filasCuota?.length) {
        const inicios = filasCuota
          .map((f) => String(f.startDate ?? "").slice(0, 7))
          .filter((m) => /^\d{4}-\d{2}$/.test(m))
          .sort();
        if (inicios.length && inicios[0] > primerMesCliente) primerMesCliente = inicios[0];
      }
      const seguidos = mesesSeguidosSinPagar({ meses, pagados: suyos, primerMes: primerMesCliente });
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
