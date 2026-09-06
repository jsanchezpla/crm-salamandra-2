/**
 * lib/billing/cobroDeCuota.js — el cobro del mes en curso sigue a su cuota.
 *
 * QUÉ RESUELVE (Aumenta, 04/09/2026, y Rodrigo el 05/09: «no pueden crear un
 * paciente, asignarle cuota, cobrarle y generar factura; es un proceso clave
 * que no funciona bien»). El cobro nacía SOLO al pulsar «Generar el mes», y ahí
 * se quedaba congelado:
 *
 *   · AV-0048 — asignas la cuota el día 4, el mes se generó el día 1, y en
 *     Cobros no aparece nada. No hay error: es que nadie ha vuelto a generar.
 *   · AV-0046 — le quitas una terapia a la cuota y el cobro pendiente sigue
 *     enseñando las dos, con el importe viejo. Relanzar «Generar el mes»
 *     tampoco lo arregla: esa cuota ya tiene cobro del mes y sale en
 *     «repetidas».
 *
 * Desde hoy, crear o editar una cuota deja al día su cobro del MES EN CURSO:
 * lo crea si falta y lo rehace si cambió. «Generar el mes» sigue existiendo
 * para el lote de todos los meses y para los meses que no son este.
 *
 * ── LOS DOS FRENOS ─────────────────────────────────────────────────────────
 *   1. Solo se toca el cobro que aún no es dinero ni papel (`cobroSePuedeRehacer`
 *      en `cuotas.js`): pendiente, sin factura, sin Stripe, sin banco. Un cobro
 *      cobrado o facturado NO se reescribe porque alguien cambie la cuota
 *      después — se dice, y quien mande decide.
 *   2. Solo el MES EN CURSO. Los meses ya cerrados son historia: si el mes
 *      pasado se cobró 190 €, eso es lo que pasó, y una edición de hoy no puede
 *      reescribirlo.
 *
 * Nunca lanza: quien lo llama está creando o editando una cuota, y que el cobro
 * no se pueda tocar no puede tumbar el alta. Devuelve qué ha hecho para que la
 * pantalla lo cuente.
 */

import {
  planDeCuotasDelMes,
  mesVigente,
  mesValido,
  cobroSePuedeRehacer,
  cambiosDelCobro,
} from "./cuotas.js";

/** 42P01 = la tabla no existe en este schema (migración sin aplicar). */
function esTablaAusente(err) {
  const code = err?.parent?.code || err?.original?.code;
  return code === "42P01" || /relation .* does not exist/i.test(err?.message || "");
}

const METODO_POR_DEFECTO = "transfer";

/**
 * Deja al día el cobro del mes en curso de UNA cuota.
 *
 * @param {object} p
 * @param {object} p.tenantModels modelos del tenant (`Cuota`, `Payment`, `BillingConcept`)
 * @param {string} p.cuotaId
 * @param {string} [p.mes] 'AAAA-MM'; por defecto el mes de Madrid
 * @returns {Promise<{estado: string, motivo: string|null, importe: number|null, cobroId: string|null}>}
 *   estado: `creado` · `actualizado` · `al-dia` · `intocable` · `sin-importe` ·
 *   `fuera-del-mes` · `no-aplica`
 */
export async function sincronizarCobroDelMes({ tenantModels, cuotaId, mes = null }) {
  const salida = (estado, extra = {}) => ({ estado, motivo: null, importe: null, cobroId: null, ...extra });
  try {
    const { Cuota, Payment, BillingConcept } = tenantModels || {};
    if (!Cuota || !Payment) return salida("no-aplica", { motivo: "sin módulo de facturación" });

    const elMes = mesValido(mes) ? mes : mesVigente();
    const cuota = await Cuota.findByPk(cuotaId);
    if (!cuota) return salida("no-aplica", { motivo: "la cuota ya no existe" });

    // El catálogo puede no existir en este schema (`billing_concepts` llegó el
    // 31/08/2026): se degrada a vacío igual que en `cuotas/generar`.
    let conceptos = [];
    if (BillingConcept) {
      try {
        const filas = await BillingConcept.findAll({ attributes: ["id", "name", "unitPrice"] });
        conceptos = filas.map((c) => ({ id: c.id, name: c.name, unitPrice: c.unitPrice }));
      } catch (err) {
        if (!esTablaAusente(err)) throw err;
      }
    }

    const { aGenerar, sinImporte } = planDeCuotasDelMes({
      mes: elMes,
      cuotas: [cuota.toJSON()],
      conceptos,
      yaGenerados: [], // lo de «ya generado» se resuelve aquí abajo, con la fila delante
    });
    const fila = aGenerar[0] ?? null;
    const fallida = sinImporte[0] ?? null;

    const periodMonth = `${elMes}-01`;
    const cobro = await Payment.findOne({ where: { cuotaId: cuota.id, periodMonth } });

    // La cuota ya no toca este mes (alta futura, baja anterior o en pausa), o
    // toca pero no vale nada (conceptos borrados del catálogo o importe 0: el
    // agujero silencioso de AV-0048, que se dice, no se calla). En los dos
    // casos, si el cobro pendiente de este mes sigue ahí y aún no es dinero ni
    // papel, se RETIRA: antes se quedaba en Cobros y en la morosidad con el
    // importe viejo, como si la cuota no hubiera cambiado (revisión del
    // 06/09/2026). Es lo mismo que ya hacía borrar la cuota.
    if (!fila) {
      if (cobro && cobroSePuedeRehacer(cobro).ok) {
        await cobro.destroy();
        return salida("retirado", { cobroId: cobro.id, motivo: fallida ? fallida.motivo : "la cuota ya no toca este mes" });
      }
      if (!fallida) return salida("fuera-del-mes", { cobroId: cobro?.id ?? null });
      return salida("sin-importe", { motivo: fallida.motivo, cobroId: cobro?.id ?? null });
    }

    if (!cobro) {
      /*
       * Mismo candado contra el doble clic que el lote: la comprobación va
       * DENTRO de la transacción, porque entre el `findOne` de arriba y este
       * `create` cabe otra pestaña haciendo lo mismo.
       */
      const creado = await Payment.sequelize.transaction(async (t) => {
        const existe = await Payment.findOne({
          where: { cuotaId: cuota.id, periodMonth },
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
            method: fila.method || METODO_POR_DEFECTO,
            // PENDIENTE: esto no es cobrar, es dejar apuntado lo que toca pagar.
            status: "pending",
            notes: fila.notes,
          },
          { transaction: t }
        );
      });
      if (!creado) return salida("al-dia", { motivo: "ya tenía cobro de este mes" });
      return salida("creado", { importe: fila.importe, cobroId: creado.id });
    }

    const sePuede = cobroSePuedeRehacer(cobro);
    if (!sePuede.ok) return salida("intocable", { motivo: sePuede.motivo, cobroId: cobro.id });

    const cambios = cambiosDelCobro(cobro, fila);
    if (!cambios) return salida("al-dia", { cobroId: cobro.id, importe: fila.importe });

    await cobro.update(cambios);
    return salida("actualizado", { importe: fila.importe, cobroId: cobro.id });
  } catch (err) {
    // Que el cobro no se pueda poner al día no puede tumbar el alta ni la
    // edición de la cuota, que es lo que la persona vino a hacer.
    const detalle = process.env.NODE_ENV === "production" ? null : err?.parent?.message || err?.message;
    return salida("no-aplica", { motivo: detalle ? `no se pudo poner al día el cobro: ${detalle}` : "no se pudo poner al día el cobro" });
  }
}

/**
 * Lo mismo para VARIAS cuotas (el alta en lote de la pantalla de Cuotas), con
 * el recuento hecho para poder decirlo en una frase.
 */
export async function sincronizarCobrosDelMes({ tenantModels, cuotaIds = [], mes = null }) {
  const resultados = [];
  for (const id of cuotaIds) {
    resultados.push({ cuotaId: String(id), ...(await sincronizarCobroDelMes({ tenantModels, cuotaId: id, mes })) });
  }
  return {
    resultados,
    creados: resultados.filter((r) => r.estado === "creado").length,
    actualizados: resultados.filter((r) => r.estado === "actualizado").length,
    retirados: resultados.filter((r) => r.estado === "retirado").length,
    sinImporte: resultados.filter((r) => r.estado === "sin-importe").length,
    intocables: resultados.filter((r) => r.estado === "intocable").length,
  };
}
