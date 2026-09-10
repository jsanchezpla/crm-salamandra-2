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
 *   3. Y lo que se mueve es EL RESTO, no la cuota entera (10/09/2026): con un
 *      pago parcial detrás, subir la cuota de 80 a 100 deja 70 pendientes —los
 *      30 cobrados son suyos—, y con el mes ya pagado entero no nace ningún
 *      cobro nuevo. La regla, con su prueba, en `pendienteDeLaCuota.js`.
 *
 * Nunca lanza: quien lo llama está creando o editando una cuota, y que el cobro
 * no se pueda tocar no puede tumbar el alta. Devuelve qué ha hecho para que la
 * pantalla lo cuente.
 */

import { Op } from "sequelize";

import {
  planDeCuotasDelMes,
  mesVigente,
  mesValido,
  cobroSePuedeRehacer,
  cambiosDelCobro,
} from "./cuotas.js";
import { citasDelMesParaCuotas } from "./citasParaProrrateo.js";
import { ajusteDelPendiente } from "./pendienteDeLaCuota.js";

/**
 * 23505 sobre el índice único de (cuota_id, period_month)
 * (`migrate-payments-cuota-unica`, 06/09/2026): otra petición ganó la carrera
 * y el cobro de ese mes ya existe. Es el candado de verdad; el `findOne … FOR
 * UPDATE` de dentro de la transacción no bloquea una fila que aún no existe.
 */
export function esCobroRepetido(err) {
  const code = err?.parent?.code || err?.original?.code;
  return code === "23505" || err?.name === "SequelizeUniqueConstraintError";
}

/** 42P01 = la tabla no existe en este schema (migración sin aplicar). */
function esTablaAusente(err) {
  const code = err?.parent?.code || err?.original?.code;
  return code === "42P01" || /relation .* does not exist/i.test(err?.message || "");
}

/**
 * DÓNDE ESTÁ EL COBRO DEL MES DE UNA FAMILIA (07/09/2026).
 *
 * Desde que la cuota puede tener PAGADOR, el cobro del mes NO nace a nombre de
 * la familia sino de quien paga (`planDeCuotasDelMes`). Buscar por `client_id`
 * de la familia deja de encontrarlo, y lo que sigue es caro: la cita del niño
 * enseña «Cobrar mes» como si nadie hubiera pagado y, al pulsarlo, el POST no
 * ve el pendiente y crea OTRO cobro — el mes acaba con el pendiente de la
 * fundación y un cobro cobrado de la familia, y la caja suma los dos.
 *
 * Así que el cobro de esta familia es el suyo O el de una de SUS cuotas. Sin
 * tabla de cuotas (schema sin migrar) devuelve la condición de siempre.
 *
 * @returns {Promise<object>} el trozo de `where` que reconoce los dos casos
 */
export async function dondeEstaElCobroDe({ tenantModels, clientId }) {
  const { Cuota } = tenantModels || {};
  if (!Cuota || !clientId) return { clientId };
  let ids = [];
  try {
    const cuotas = await Cuota.findAll({ where: { clientId }, attributes: ["id"] });
    ids = cuotas.map((c) => c.id);
  } catch {
    return { clientId };
  }
  if (!ids.length) return { clientId };
  return { [Op.or]: [{ clientId }, { cuotaId: { [Op.in]: ids } }] };
}

/**
 * Deja al día el cobro del mes en curso de UNA cuota.
 *
 * @param {object} p
 * @param {object} p.tenantModels modelos del tenant (`Cuota`, `Payment`, `BillingConcept`)
 * @param {string} p.cuotaId
 * @param {string} [p.mes] 'AAAA-MM'; por defecto el mes de Madrid
 * @returns {Promise<{estado: string, motivo: string|null, importe: number|null, cobroId: string|null}>}
 *   estado: `creado` · `actualizado` · `al-dia` · `retirado` · `intocable` ·
 *   `sin-importe` · `fuera-del-mes` · `no-aplica`
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
        const filas = await BillingConcept.findAll({ attributes: ["id", "name", "description", "unitPrice"] });
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
      // Por sesiones cuando hay citas en el mes (AV-0062, 07/09/2026).
      citasPorClave: await citasDelMesParaCuotas({ tenantModels, mes: elMes, cuotas: [cuota.toJSON()] }),
    });
    const fila = aGenerar[0] ?? null;
    const fallida = sinImporte[0] ?? null;

    /*
     * La reserva de plaza se descuenta UNA vez (09/09/2026): en cuanto el cobro
     * de este mes la lleva dentro, la cuota se queda con el mes apuntado y los
     * siguientes salen enteros.
     *
     * Se marca solo cuando el descuento ha llegado DE VERDAD a un cobro. Si el
     * cobro es intocable (ya cobrado, ya facturado), no se marca a propósito:
     * ese mes se pagó entero y el crédito de la familia sigue vivo para el mes
     * que viene, que es lo justo.
     */
    const marcarReserva = async () => {
      if (!fila?.reservaAplicada) return;
      if (cuota.reservaAplicadaEn === fila.reservaAplicada.mes) return;
      await cuota.update({ reservaAplicadaEn: fila.reservaAplicada.mes });
    };

    const periodMonth = `${elMes}-01`;
    /*
     * TODAS las filas de ese mes, no una cualquiera (10/09/2026, Rodrigo). Con
     * un pago parcial detrás hay dos con la misma pareja (cuota, mes) —la
     * cobrada y la que sigue pendiente— y el `findOne` de antes devolvía la que
     * quisiera Postgres. Quién es quién, y qué hacer con cada una, en
     * `lib/billing/pendienteDeLaCuota.js`.
     */
    const filasDelMes = await Payment.findAll({
      where: { cuotaId: cuota.id, periodMonth },
      order: [["createdAt", "ASC"]],
    });
    const ajuste = ajusteDelPendiente({ esperado: fila?.importe ?? 0, filas: filasDelMes });
    const cobro = ajuste.pendiente;

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

    /*
     * ── EL MES YA COBRADO NO SE REABRE (10/09/2026, Rodrigo) ───────────────
     *
     * «Si un paciente ha pagado la cuota completa y ha completado su cobro
     * ANTES de subir la cuota, no le salta de pronto un cobro pendiente de 20
     * euros.» Lo cobrado es un hecho y la subida de tarifa es posterior: si de
     * verdad hay que cobrarle la diferencia, alguien la registra a mano y sabe
     * lo que está haciendo.
     */
    if (ajuste.accion === "sin-tocar") {
      return salida("intocable", { motivo: ajuste.motivo, cobroId: ajuste.cerradas[0]?.id ?? null });
    }

    if (!cobro) {
      /*
       * Mismo candado contra el doble clic que el lote: la comprobación va
       * DENTRO de la transacción, porque entre el `findOne` de arriba y este
       * `create` cabe otra pestaña haciendo lo mismo.
       */
      let creado = null;
      try {
        creado = await Payment.sequelize.transaction(async (t) => {
        // Solo un PENDIENTE estorba: es lo que vigila el índice único
        // (`migrate-payments-cuota-unica`) y lo que este candado protege. Un
        // cobro ya cobrado de ese mes no llega hasta aquí — lo para el
        // «sin-tocar» de arriba.
        const existe = await Payment.findOne({
          where: { cuotaId: cuota.id, periodMonth, status: "pending" },
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
            // Si la cuota no dice cómo se cobra, el cobro nace SIN DECIDIR
            // (10/09/2026): esto no es dinero todavía, y quien lo registre
            // pondrá lo que toque. Ver `method` en models/tenant/Payment.model.js.
            method: fila.method || null,
            // PENDIENTE: esto no es cobrar, es dejar apuntado lo que toca pagar.
            status: "pending",
            notes: fila.notes,
            invoiceText: fila.invoiceText,
          },
          { transaction: t }
        );
        });
      } catch (err) {
        // Si otra petición creó el cobro entre el findOne y el create, el índice
        // único lo para: para esta cuota es «ya tenía cobro de este mes».
        if (!esCobroRepetido(err)) throw err;
        creado = null;
      }
      if (!creado) return salida("al-dia", { motivo: "ya tenía cobro de este mes" });
      await marcarReserva();
      return salida("creado", { importe: fila.importe, cobroId: creado.id });
    }

    /*
     * ── Y EL PENDIENTE SE QUEDA CON EL RESTO, NO CON LA CUOTA ENTERA ───────
     *
     * «Debe 80 y le cobro 30: se queda pendiente a deber 50. Si entre medias
     * subo la cuota a 100, debe automáticamente 70» (Rodrigo, 10/09/2026). Los
     * 30 que ya entraron son suyos; lo que se reescribe es lo que falta. Y si
     * la cuota BAJA por debajo de lo ya cobrado, el pendiente sobra y se
     * retira, en vez de quedarse en un importe negativo que nadie va a pagar.
     */
    if (ajuste.accion === "retirar") {
      // Sin marcar la reserva: el descuento no ha llegado a ningún cobro, así
      // que el crédito de la familia sigue vivo para el mes que viene.
      await cobro.destroy();
      return salida("retirado", { cobroId: cobro.id, motivo: ajuste.motivo });
    }

    const cambios = cambiosDelCobro(cobro, { ...fila, importe: ajuste.importe });
    if (!cambios) {
      // Ya lleva el importe de hoy, reserva incluida: queda por dejar dicho que
      // esa reserva ya está gastada.
      await marcarReserva();
      return salida("al-dia", { cobroId: cobro.id, importe: ajuste.importe });
    }

    await cobro.update(cambios);
    await marcarReserva();
    return salida("actualizado", { importe: ajuste.importe, cobroId: cobro.id, yaCobrado: ajuste.yaCerrado });
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
