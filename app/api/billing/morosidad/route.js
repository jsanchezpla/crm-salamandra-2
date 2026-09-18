import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { mesesSinPagarSeguidos, loQueFaltaDelMes } from "../../../../lib/billing/mesesSinPagar.js";
import { mesVigente, debeElMes } from "../../../../lib/billing/cuotas.js";
import { cuotasDelPaciente, cobroDelPaciente, pagadoresDelPaciente, entraEnMorosidad } from "../../../../lib/billing/morosidad.js";

/**
 * GET /api/billing/morosidad?mes=AAAA-MM — quién no ha pagado el mes
 * (sprint Aumenta 2026-07, punto 8).
 *
 * ── UNA FILA POR PACIENTE (15/09/2026, Rodrigo) ────────────────────────────
 * Hasta hoy la lista era de FAMILIAS: con dos hermanos en terapia la familia
 * salía una sola vez y quedaba al día en cuanto pagaba uno. Ahora cada fila es
 * un paciente ACTIVO con su familia al lado, y qué cuotas y qué cobros son
 * suyos lo deciden `cuotasDelPaciente` y `cobroDelPaciente`
 * (`lib/billing/morosidad.js`, con su prueba). Lo que no lleva paciente —una
 * cuota o un cobro de la familia entera— cuenta para todos sus hermanos, y la
 * fila lo avisa con `compartido`.
 *
 * El bloqueo del portal por impago (`lib/citas/portalMeses.js`) sigue siendo
 * por familia: quien entra al área privada es el tutor, no el niño.
 *
 * QUIÉN HA PAGADO: un cobro COMPLETADO con `periodMonth` de ese mes. Devuelve
 * además cuántos meses seguidos lleva sin pagar (mirando 6 atrás).
 *
 * ── CON CUOTA Y SIN CUOTA (09/09/2026) ─────────────────────────────────────
 * Rosa: «lo suyo es ver el importe concreto que debe y a qué pertenece». De
 * quien tiene cuota escrita se sabe cuánto y de qué; de quien no la tiene no se
 * sabe nada y solo se pueden contar meses. Cada fila viaja con `tieneCuota` y
 * `conceptos`, y la pantalla las separa.
 *
 * ⚠️ A la población sin cuota NO se le inventa un importe recalculando el mes:
 * eso se probó el 07/09 y acusó a ~95 familias de deber 30 € que no debían.
 *
 * ── IMPORTE Y MES (18/09/2026, Rosa) ───────────────────────────────────────
 * «Sale el número de meses que debe pero quieren que salga también el importe
 * que debe y al mes que corresponde.» Cada fila viaja ahora con `mesesDebe`
 * —los MISMOS meses que cuenta `mesesSeguidos`, con el importe de cada uno— y
 * `debe` es su suma. El importe de un mes es lo PENDIENTE de ese mes y nada
 * más: se piden los pendientes de toda la ventana, no solo los del mes pedido.
 * Un mes sin pendiente sale con su nombre y sin importe.
 */

const MESES_ATRAS = 6;

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
    // universal): nadie debe septiembre en agosto.
    if (mes > mesVigente()) {
      return ok({ mes, morosos: [], alDia: 0, aplicable: true, futuro: true });
    }

    const pacientesActivos = await Patient.findAll({
      where: { status: "active", clientId: { [Op.ne]: null } },
      attributes: ["id", "clientId", "firstName", "lastName", "status"],
      raw: true,
    });
    // Fuera quien es de una familia de Baja o En pausa (15/09/2026): la regla,
    // con su porqué, en `entraEnMorosidad` (lib/billing/morosidad.js).
    const estadoDeFamilia = new Map(
      (await Client.findAll({
        where: { id: { [Op.in]: [...new Set(pacientesActivos.map((p) => String(p.clientId)))] } },
        attributes: ["id", "status"],
        raw: true,
      })).map((c) => [String(c.id), c])
    );
    const activos = pacientesActivos.filter((p) => entraEnMorosidad(p, estadoDeFamilia.get(String(p.clientId))));
    const hermanos = new Map();
    for (const p of activos) hermanos.set(String(p.clientId), (hermanos.get(String(p.clientId)) ?? 0) + 1);

    // Los conceptos de cada cuota, por su nombre INTERNO: es «a qué pertenece».
    // El texto impreso de la factura no vale (en Aumenta no nombra la terapia).
    const nombreDeConcepto = new Map();
    if (ctx.tenantModels.BillingConcept) {
      const cs = await ctx.tenantModels.BillingConcept.findAll({ attributes: ["id", "name"], raw: true });
      for (const c of cs) nombreDeConcepto.set(String(c.id), c.name);
    }
    const { Cuota } = ctx.tenantModels;
    const cuotas = Cuota
      ? await Cuota.findAll({ attributes: ["id", "clientId", "payerClientId", "patientId", "startDate", "endDate", "active", "amount", "conceptIds"], raw: true })
      : [];

    // ── QUIÉN DEBE EL MES ──────────────────────────────────────────────────
    // La vigencia de las cuotas manda (01/09/2026): un paciente con cuotas debe
    // el mes solo si alguna lo cubre, y la de «enero a marzo» desaparece sola
    // en abril. Un paciente SIN cuotas sigue con la regla de siempre (paciente
    // activo): no se le puede aplicar una vigencia que nadie escribió.
    const poblacion = [];
    for (const p of activos) {
      const suyas = cuotasDelPaciente(p, cuotas);
      if (suyas.length && !debeElMes(suyas, mes)) continue;
      poblacion.push({ p, suyas, pagadores: pagadoresDelPaciente(p, suyas) });
    }
    if (poblacion.length === 0) return ok({ mes, morosos: [], alDia: 0, aplicable: true, pacientes: 0 });

    // ¿Desde cuándo cobra este centro por el CRM? Con CERO cobros la pantalla
    // no acusa a nadie (31/08/2026: el día del estreno pintaba a todo Aumenta
    // moroso de 6 meses). Y los «meses seguidos» no cuentan más atrás.
    const primerPeriodo = await Payment.min("periodMonth", {
      where: { status: "completed", periodMonth: { [Op.ne]: null } },
    });
    if (!primerPeriodo) {
      return ok({ mes, morosos: [], alDia: 0, aplicable: true, pacientes: poblacion.length, sinCobros: true });
    }
    const primerMes = String(primerPeriodo).slice(0, 7);

    const meses = ventana(mes, MESES_ATRAS);
    const desde = `${meses[meses.length - 1]}-01`;
    const patientIds = poblacion.map((x) => String(x.p.id));
    const clientIds = [...new Set(poblacion.flatMap((x) => [...x.pagadores]))];
    // Los cobros que pueden ser de alguno: los que llevan su paciente, y los
    // que no llevan ninguno pero están a nombre de su familia o de quien paga.
    const deAlguno = {
      [Op.or]: [
        { patientId: { [Op.in]: patientIds } },
        { patientId: null, clientId: { [Op.in]: clientIds } },
      ],
    };
    const [cobros, pendientes] = await Promise.all([
      Payment.findAll({
        where: { ...deAlguno, status: "completed", periodMonth: { [Op.gte]: desde } },
        attributes: ["clientId", "patientId", "periodMonth", "amount", "paidAt"],
        raw: true,
      }),
      /*
       * LO QUE FALTA DE UN MES A MEDIAS SON SUS COBROS PENDIENTES, no una
       * cuenta nueva (07/09/2026): recalcular el mes desde las cuotas volvía a
       * pedir el «Descuento reserva ya abonada» y acusaba a ~95 familias en
       * falso. Un pendiente ES lo que el centro pidió y no ha cobrado.
       */
      /*
       * TODA la ventana y no solo el mes pedido (18/09/2026, AV «Importe y mes
       * en morosidad»): los pendientes son la única fuente honesta del importe
       * de un mes, así que también hacen falta los de los meses de atrás para
       * poder decir «debe 120 € · septiembre, agosto». Con tope arriba: los
       * pendientes de meses FUTUROS (las recurrentes ya generadas) no son
       * deuda de hoy.
       */
      Payment.findAll({
        where: { ...deAlguno, status: "pending", periodMonth: { [Op.gte]: desde, [Op.lte]: `${mes}-01` } },
        attributes: ["clientId", "patientId", "periodMonth", "amount"],
        raw: true,
      }),
    ]);

    const familias = await Client.findAll({ where: { id: { [Op.in]: [...new Set(activos.map((p) => String(p.clientId)))] } }, attributes: ["id", "name", "email", "phone"], raw: true });
    const familiaDe = new Map(familias.map((c) => [String(c.id), c]));

    const conceptosDe = (suyas) => {
      const vistos = new Set();
      for (const f of suyas) {
        for (const id of Array.isArray(f.conceptIds) ? f.conceptIds : []) {
          const n = nombreDeConcepto.get(String(id));
          if (n) vistos.add(n);
        }
      }
      return [...vistos];
    };

    const morosos = [];
    let alDia = 0;
    for (const { p, suyas, pagadores } of poblacion) {
      const pid = String(p.id);
      const cid = String(p.clientId);
      const tieneHermanos = (hermanos.get(cid) ?? 0) > 1;
      let compartido = false;
      const pagados = new Set();
      let cobrado = 0;
      let ultimoCobro = null;
      for (const c of cobros) {
        if (!cobroDelPaciente(p, c, pagadores)) continue;
        if (!c.patientId && tieneHermanos) compartido = true;
        const m = c.periodMonth ? String(c.periodMonth).slice(0, 7) : null;
        if (m) {
          pagados.add(m);
          if (m === mes) cobrado += Number(c.amount || 0);
        }
        if (!ultimoCobro || new Date(c.paidAt) > new Date(ultimoCobro)) ultimoCobro = c.paidAt;
      }
      // Lo pendiente MES A MES: es de donde sale el importe de cada mes que
      // debe, y su suma la del mes pedido (que es lo que ya se usaba).
      const pendientePorMes = new Map();
      for (const c of pendientes) {
        if (!cobroDelPaciente(p, c, pagadores)) continue;
        if (!c.patientId && tieneHermanos) compartido = true;
        const m = c.periodMonth ? String(c.periodMonth).slice(0, 7) : null;
        if (!m) continue;
        pendientePorMes.set(m, Math.round(((pendientePorMes.get(m) ?? 0) + Number(c.amount || 0)) * 100) / 100);
      }
      const pendiente = pendientePorMes.get(mes) ?? 0;
      const esperado = pendiente > 0 ? Math.round((cobrado + pendiente) * 100) / 100 : null;
      const falta = pagados.has(mes) ? loQueFaltaDelMes({ pagado: cobrado, esperado }) : null;
      if (pagados.has(mes) && !falta) {
        alDia++;
        continue;
      }

      const fam = familiaDe.get(cid);
      // Lo que casa al buscar un número: lo pendiente de cualquiera de sus
      // meses y lo que valen sus cuotas (AV-0136).
      const importes = [...pendientePorMes.values(), ...suyas.map((f) => f.amount)];
      const fila = {
        patientId: pid,
        clientId: cid,
        name: [p.firstName, p.lastName].filter(Boolean).join(" ") || "(paciente sin nombre)",
        familia: fam?.name ?? "(cliente borrado)",
        email: fam?.email ?? null,
        phone: fam?.phone ?? null,
        tieneCuota: suyas.length > 0,
        conceptos: conceptosDe(suyas),
        importes: [...new Set(importes.map(Number).filter((n) => Number.isFinite(n) && n > 0))],
        // Lo que se ha contado sin saber de qué hermano es: la misma deuda
        // puede salir en dos filas, y la pantalla lo dice.
        compartido,
        ultimoCobro,
      };

      // Pagado a medias: sale con lo que falta y sin acumular meses. El mes que
      // debe es ese y solo ese.
      if (falta) {
        morosos.push({
          ...fila,
          mesesSeguidos: 0,
          debe: falta.debe,
          pagado: falta.pagado,
          esperado: falta.esperado,
          mesesDebe: [{ mes, importe: falta.debe }],
        });
        continue;
      }
      // Meses seguidos sin pagar, sin acusar de antes del primer cobro del
      // centro ni de antes de que empezara SU cuota: la de enero no debe
      // diciembre (regla y prueba en lib/billing/mesesSinPagar.js).
      let primerMesPaciente = primerMes;
      const inicios = suyas
        .map((f) => String(f.startDate ?? "").slice(0, 7))
        .filter((m) => /^\d{4}-\d{2}$/.test(m))
        .sort();
      if (inicios.length && inicios[0] > primerMesPaciente) primerMesPaciente = inicios[0];
      const sinPagar = mesesSinPagarSeguidos({ meses, pagados, primerMes: primerMesPaciente });
      /*
       * QUÉ DEBE DE CADA MES (18/09/2026). El importe sale del cobro PENDIENTE
       * de ese mes —lo que el centro pidió y no cobró— y de ningún otro sitio:
       * el mes sin pendiente sale con su nombre y sin importe, que es lo que el
       * CRM sabe. La regla, con su porqué, en `lib/billing/morosidad.js`.
       */
      const mesesDebe = sinPagar.map((m) => ({ mes: m, importe: pendientePorMes.get(m) ?? null }));
      const sumado = mesesDebe.reduce((t, x) => (x.importe > 0 ? t + x.importe : t), 0);
      morosos.push({
        ...fila,
        mesesSeguidos: sinPagar.length,
        mesesDebe,
        debe: sumado > 0 ? Math.round(sumado * 100) / 100 : null,
      });
    }
    // Primero quien más meses acumula: es a quien hay que llamar hoy.
    morosos.sort((a, b) => b.mesesSeguidos - a.mesesSeguidos || a.name.localeCompare(b.name));

    const conCuota = morosos.filter((m) => m.tieneCuota).length;
    return ok({
      mes,
      morosos,
      alDia,
      aplicable: true,
      pacientes: poblacion.length,
      primerMes,
      conCuota,
      sinCuota: morosos.length - conCuota,
    });
  } catch (err) {
    return serverError(err);
  }
});
