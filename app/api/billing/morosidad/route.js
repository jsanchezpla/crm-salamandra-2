import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { mesesSeguidosSinPagar, loQueFaltaDelMes } from "../../../../lib/billing/mesesSinPagar.js";
import { mesVigente, debeElMes } from "../../../../lib/billing/cuotas.js";

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
    //
    // ── Y QUIEN DEBE ES QUIEN PAGA (07/09/2026) ───────────────────────────
    // Desde que la cuota puede tener un pagador distinto de la familia (la
    // fundación que paga la de este niño), el cobro del mes nace a nombre del
    // PAGADOR. Perseguir a la familia por ese mes sería perseguir a quien no
    // debe nada y no tiene cobro a su nombre: sale morosa para siempre. Así
    // que las cuotas se agrupan por quien las paga, y la familia solo entra en
    // la lista por las que paga ella.
    const { Cuota } = ctx.tenantModels;
    const cuotasPorCliente = new Map();
    const familiasConCuota = new Set();
    if (Cuota) {
      // Con importe y conceptos (07/09/2026): hacen falta para saber cuánto
      // ESPERA el mes y decir «debe 60 €» cuando se pagó a medias.
      const filas = await Cuota.findAll({ attributes: ["id", "clientId", "payerClientId", "patientId", "startDate", "endDate", "active", "amount", "conceptIds", "method", "dayOfMonth"], raw: true });
      for (const f of filas) {
        if (!f.clientId) continue;
        familiasConCuota.add(String(f.clientId));
        const cid = String(f.payerClientId || f.clientId);
        if (!cuotasPorCliente.has(cid)) cuotasPorCliente.set(cid, []);
        cuotasPorCliente.get(cid).push(f);
      }
    }
    const poblacion = new Set(porCliente.keys());
    // Toda familia con cuota sale primero y vuelve a entrar abajo solo si paga
    // alguna: sin esto, la que tiene pagador se quedaría dentro por la regla
    // del paciente activo, que es de las familias SIN cuota escrita.
    for (const cid of familiasConCuota) poblacion.delete(cid);
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
     * ── UN MES PAGADO A MEDIAS NO ES UN MES PAGADO ─────────────────────────
     * Desde el 04/09 un mes se puede cobrar en dos veces: con 100 € de los
     * 160 € apuntados, la familia salía «al día».
     *
     * LO QUE FALTA SON SUS COBROS PENDIENTES DE ESE MES, no una cuenta nueva
     * (07/09/2026, noche). La primera versión recalculaba el mes desde las
     * cuotas y eso resultó ser peor que el problema: al generar septiembre se
     * aplicó el «Descuento reserva ya abonada» de −30 € (261 de los 281 cobros
     * de cuota lo llevan escrito en la nota) y ese concepto YA NO está en
     * ninguna de las 281 cuotas vivas, así que el recálculo lo volvía a pedir
     * y la pantalla acusaba a unas 95 familias de deber 30 € que no debían.
     * Medido sobre septiembre: leer los pendientes pilla las 7 familias que de
     * verdad tienen un mes a medias y no acusa a nadie en falso; recalcular
     * pillaba esas mismas y se inventaba 95.
     *
     * Es además lo honesto: un cobro pendiente ES lo que el centro le pidió a
     * esa familia y no ha cobrado. Sin pendientes no hay nada que reclamar de
     * ese mes.
     *
     * ⚠️ Lo que esto NO ve, y hay que arreglar aparte: cuando se cobra a
     * medias un mes con UN solo pendiente, el POST de cobros machaca el
     * importe de esa fila (160 pendientes → 100 cobrados) y los 60 que faltan
     * no quedan en ninguna parte. Hasta que el cobro parcial parta la fila,
     * ese caso se pierde. Está apuntado en el Registro.
     */
    const pendientesDelMes = await Payment.findAll({
      where: { clientId: { [Op.in]: ids }, status: "pending", periodMonth: `${mes}-01` },
      attributes: ["clientId", "amount"],
    });
    const pendienteDelMes = new Map();
    for (const p of pendientesDelMes) {
      const cid = String(p.clientId);
      pendienteDelMes.set(cid, (pendienteDelMes.get(cid) ?? 0) + Number(p.amount || 0));
    }
    /*
     * Lo esperado del mes = lo que ya entró + lo que sigue pendiente. Así
     * `loQueFaltaDelMes` (con su prueba) sigue haciendo la resta de siempre y
     * lo que devuelve como «debe» es exactamente el pendiente.
     */
    const esperadoDelMes = (cid) => {
      const pendiente = pendienteDelMes.get(cid) ?? 0;
      if (pendiente <= 0) return null;
      return Math.round(((cobradoDelMes.get(cid) ?? 0) + pendiente) * 100) / 100;
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
