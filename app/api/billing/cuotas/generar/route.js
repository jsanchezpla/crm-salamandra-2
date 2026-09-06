import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { logBillingAudit, datosPeticion } from "../../../../../lib/billing/audit.js";
import { billingHasPatients } from "../../../../../lib/billing/patientLink.js";
import {
  planDeCuotasDelMes,
  mesValido,
  mesLegible,
  ultimoDiaDe,
  metodosValidos,
  metodoValido,
} from "../../../../../lib/billing/cuotas.js";
import { madridToday } from "../../../../../lib/utils/madridDate.js";
import { esCobroRepetido } from "../../../../../lib/billing/cobroDeCuota.js";

/**
 * La generación mensual de cuotas (01/09/2026, petición de Aumenta:
 * «programarlas mensualmente»).
 *
 *   GET  ?mes=AAAA-MM[&metodo=…]      → vista previa: qué se generaría
 *   POST { mes, metodos?, excluir?, metodoPorDefecto? } → crea los cobros
 *
 * ── El cobro nace PENDIENTE ────────────────────────────────────────────────
 * Generar no es cobrar: el dinero todavía no ha entrado. Morosidad, el bloqueo
 * del portal y «Facturar el mes» miran `status = 'completed'`, así que un mes
 * generado y sin cobrar sigue contando como impagado — que es la verdad. Quien
 * recibe el dinero lo pasa a cobrado desde Cobros.
 *
 * Relanzar el mes NO duplica: cada cobro guarda su `cuota_id` y la cuota que ya
 * tiene cobro de ese mes sale en «repetidas», nunca en el lote.
 */

const METODO_POR_DEFECTO = "transfer";

/** 42P01 = la tabla no existe en este schema (migración sin aplicar). */
function esTablaAusente(err) {
  const code = err?.parent?.code || err?.original?.code;
  return code === "42P01" || /relation .* does not exist/i.test(err?.message || "");
}

function includePaciente(tenantModels, hasModule) {
  if (!billingHasPatients(hasModule) || !tenantModels.Patient) return [];
  return [{ model: tenantModels.Patient, as: "patient", attributes: ["id", "firstName", "lastName"] }];
}

/**
 * Las cuotas que PUEDEN tocar ese mes, con su pagador y su paciente.
 *
 * El filtro grueso va en SQL (empieza antes de que acabe el mes, y no terminó
 * antes de que empezara); quién entra de verdad y por cuántos días lo decide
 * `planDeCuotasDelMes`, que es lo que se puede probar sin base de datos.
 */
async function recogerCuotas({ tenantModels, hasModule, mes }) {
  const { Cuota, Client, BillingConcept, Payment } = tenantModels;
  const primero = `${mes}-01`;
  const ultimo = ultimoDiaDe(mes);

  const cuotas = await Cuota.findAll({
    where: {
      startDate: { [Op.lte]: ultimo },
      [Op.or]: [{ endDate: null }, { endDate: { [Op.gte]: primero } }],
    },
    include: [
      { model: Client, as: "client", attributes: ["id", "name", "fiscalName"] },
      ...includePaciente(tenantModels, hasModule),
    ],
    order: [["startDate", "ASC"]],
  });

  /*
   * El catálogo puede NO EXISTIR en este schema: `billing_concepts` llegó el
   * 31/08/2026 y un tenant con billing de antes que no haya corrido la
   * migración da 42P01. Degrada a catálogo vacío, como hacen el Panel y
   * `accionesRequeridas` con `quotes`: una cuota con importe pactado se puede
   * generar igual, y las que dependen de conceptos salen en «sin importe» con
   * su motivo, en vez de tumbar la pantalla entera.
   */
  let conceptos = [];
  if (BillingConcept) {
    try {
      conceptos = await BillingConcept.findAll({ attributes: ["id", "name", "unitPrice", "vatRate"] });
    } catch (err) {
      if (!esTablaAusente(err)) throw err;
    }
  }

  // Qué cuotas YA tienen cobro de ese mes (por `payments.cuota_id`).
  const yaGenerados = cuotas.length
    ? await Payment.findAll({
        where: { cuotaId: { [Op.in]: cuotas.map((c) => c.id) }, periodMonth: primero },
        attributes: ["cuotaId"],
      })
    : [];

  return {
    cuotas: cuotas.map((c) => ({
      ...c.toJSON(),
      nombre: c.client?.fiscalName || c.client?.name || "(ficha no encontrada)",
      paciente: c.patient ? `${c.patient.firstName} ${c.patient.lastName}`.trim() : null,
    })),
    conceptos: conceptos.map((c) => ({ id: c.id, name: c.name, unitPrice: c.unitPrice })),
    yaGenerados: yaGenerados.map((p) => String(p.cuotaId)),
  };
}

const vista = (f) => ({
  cuotaId: f.cuotaId,
  clientId: f.clientId,
  patientId: f.patientId,
  nombre: f.nombre,
  paciente: f.paciente,
  importe: f.importe,
  importeMensual: f.importeMensual,
  method: f.method,
  paidAt: f.paidAt,
  conceptos: f.conceptos,
  rotulo: f.rotulo,
  motivo: f.motivo ?? null,
});

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const params = new URL(request.url).searchParams;
    const mes = params.get("mes");
    if (!mesValido(mes)) return error("El mes debe ser 'AAAA-MM'", 422);
    const metodos = metodosValidos(params.getAll("metodo"));

    const { cuotas, conceptos, yaGenerados } = await recogerCuotas({ tenantModels, hasModule, mes });
    const { aGenerar, repetidas, sinImporte } = planDeCuotasDelMes({
      mes,
      cuotas,
      conceptos,
      yaGenerados,
      metodos: metodos.length ? metodos : null,
    });

    return ok({
      mes,
      mesLegible: mesLegible(mes),
      metodos,
      aGenerar: aGenerar.map(vista),
      repetidas: repetidas.map(vista),
      sinImporte: sinImporte.map(vista),
      totales: {
        cuotas: aGenerar.length,
        importe: redondear(aGenerar.reduce((s, f) => s + f.importe, 0)),
        // Cuántas heredarían el método por defecto por no tener el suyo: sale
        // en pantalla para que nadie descubra 40 cobros «de banco» a posteriori.
        sinMetodo: aGenerar.filter((f) => !f.method).length,
        prorrateadas: aGenerar.filter((f) => f.rotulo).length,
      },
      metodoPorDefecto: METODO_POR_DEFECTO,
      hoy: madridToday(),
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Payment } = tenantModels;
    const body = await request.json();

    const mes = body?.mes;
    if (!mesValido(mes)) return error("El mes debe ser 'AAAA-MM'", 422);
    const metodos = metodosValidos(body?.metodos);
    const excluir = new Set((Array.isArray(body?.excluir) ? body.excluir : []).map(String));
    const porDefecto = metodoValido(body?.metodoPorDefecto) ? body.metodoPorDefecto : METODO_POR_DEFECTO;

    const { cuotas, conceptos, yaGenerados } = await recogerCuotas({ tenantModels, hasModule, mes });
    const { aGenerar, repetidas, sinImporte } = planDeCuotasDelMes({
      mes,
      cuotas,
      conceptos,
      yaGenerados,
      metodos: metodos.length ? metodos : null,
    });

    const creados = [];
    const saltados = [
      ...repetidas.map((f) => ({ ...vista(f), resultado: "repetida", motivo: "ya tenía cobro de este mes" })),
      ...sinImporte.map((f) => ({ ...vista(f), resultado: "saltada" })),
    ];

    for (const fila of aGenerar) {
      if (excluir.has(fila.cuotaId)) {
        saltados.push({ ...vista(fila), resultado: "excluida", motivo: "excluida a mano" });
        continue;
      }
      try {
        /*
         * El candado contra el doble clic: una sola consulta que crea el cobro
         * SI no hay ya uno de esa cuota y ese mes. Se comprueba dentro de la
         * transacción y no antes, porque entre la vista previa y este bucle
         * cabe otra pestaña haciendo lo mismo.
         */
        const cobro = await Payment.sequelize.transaction(async (t) => {
          const existe = await Payment.findOne({
            where: { cuotaId: fila.cuotaId, periodMonth: fila.periodMonth },
            attributes: ["id"],
            transaction: t,
            lock: t.LOCK.UPDATE,
          });
          if (existe) return null;
          return Payment.create(
            {
              clientId: fila.clientId,
              patientId: fila.patientId,
              conceptId: fila.conceptId,
              cuotaId: fila.cuotaId,
              periodMonth: fila.periodMonth,
              amount: fila.importe,
              paidAt: fila.paidAt,
              method: fila.method || porDefecto,
              // PENDIENTE: generar no es cobrar (ver cabecera).
              status: "pending",
              notes: fila.notes,
            },
            { transaction: t }
          );
        });
        if (!cobro) {
          saltados.push({ ...vista(fila), resultado: "repetida", motivo: "ya tenía cobro de este mes" });
          continue;
        }
        creados.push({ ...vista(fila), resultado: "creado", paymentId: cobro.id });
      } catch (err) {
        /*
         * Una cuota que falla NO tumba el lote: se salta y se cuenta, como en
         * «Facturar el mes». El motivo va con el mensaje real fuera de
         * producción (depurar a ciegas «error inesperado» cuesta una tarde) y
         * en producción, con la frase de siempre.
         */
        // La carrera que el findOne no ve la para el índice único de
        // (cuota_id, period_month): otra petición ya creó ese cobro (06/09/2026).
        if (esCobroRepetido(err)) {
          saltados.push({ ...vista(fila), resultado: "repetida", motivo: "ya tenía cobro de este mes" });
          continue;
        }
        const detalle = process.env.NODE_ENV === "production" ? null : err?.parent?.message || err?.message;
        saltados.push({
          ...vista(fila),
          resultado: "saltada",
          motivo: detalle ? `error al generar: ${detalle}` : "error inesperado al generar",
        });
      }
    }

    // Auditoría DESPUÉS de mutar y FUERA de la transacción, como el resto del
    // dinero. Una línea por LOTE con el recuento y el importe.
    if (creados.length) {
      await logBillingAudit({
        tenantId: tenant.id,
        ...datosPeticion(request),
        action: "cuota.generated",
        entity: "Payment",
        entityId: null,
        before: null,
        after: {
          mes,
          cobros: creados.length,
          importe: String(redondear(creados.reduce((s, f) => s + f.importe, 0))),
          metodos: metodos.length ? metodos.join(",") : "todos",
          estado: "pending",
        },
      });
    }

    return ok({
      mes,
      creados: creados.length,
      saltados: saltados.length,
      importe: redondear(creados.reduce((s, f) => s + f.importe, 0)),
      resultados: [...creados, ...saltados],
    });
  } catch (err) {
    return serverError(err);
  }
});

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
