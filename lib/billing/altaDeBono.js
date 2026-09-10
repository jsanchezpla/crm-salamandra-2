/**
 * lib/billing/altaDeBono.js — el bono y su deuda nacen juntos, en un solo sitio
 * (10/09/2026, submódulo Bonos).
 *
 * (Fichero nuevo en /lib, regla #2: lo piden el alta en grupo
 * —`POST /api/billing/bonos`— y el «volver a coger el bono»
 * —`POST /api/billing/bonos/[id]/renovar`—. Escrito dos veces, en un mes uno de
 * los dos habría dejado de crear el cobro pendiente: es exactamente el fallo
 * que AV-0070 vino a arreglar, cuando dar un bono no apuntaba ninguna deuda.)
 *
 * La regla que protege: **el bono y su cobro se escriben en la MISMA
 * transacción**. Si el cobro se creara aparte podrían quedar bonos sin deuda
 * —sesiones regaladas sin que nadie lo dijera— o deudas sin bono, y ninguna de
 * las dos cosas se puede arreglar después desde ninguna pantalla.
 *
 * Lo que decide dónde y cuánto sigue viviendo en `lib/billing/cobroDelBono.js`:
 * aquí solo se escriben las dos filas de una vez.
 */

import { cobroPendienteDeBono } from "./cobroDelBono.js";

/**
 * Crea el bono y, si vale dinero, su cobro PENDIENTE.
 *
 * `amount` en CÉNTIMOS (lo que guarda `session_packs`); el cobro sale en euros,
 * y la conversión la hace `cobroPendienteDeBono`, que es la frontera.
 *
 * @returns {{ bono, cobro: boolean }} `cobro` dice si nació deuda: sin importe
 *          (o con 0, un bono regalado) no nace ninguna, y quien llama tiene que
 *          poder decirlo en pantalla.
 */
export async function crearBonoConSuCobro({
  tenantModels,
  clientId,
  clientEmail = null,
  patientId = null,
  eventTypeId,
  nombreDelTipo = null,
  totalSessions,
  amount = null,
  purchasedAt = null,
  notes = null,
  creador = null,
}) {
  const { SessionPack, Payment } = tenantModels;
  let huboCobro = false;

  const bono = await SessionPack.sequelize.transaction(async (t) => {
    const nuevo = await SessionPack.create({
      clientEmail: clientEmail || null,
      clientId,
      patientId: patientId || null,
      eventTypeId,
      totalSessions,
      // Se cobra fuera de la pasarela: no hay plazos que gestionar aquí. El
      // fraccionado de verdad lo abre Stripe, con su plan de cuotas detrás.
      pricingMode: "upfront",
      amount,
      instalmentAmount: null,
      instalmentMonths: null,
      paymentSessionId: null,
      origin: "manual",
      createdBy: creador,
      purchasedAt: purchasedAt ?? new Date(),
      status: "active",
      notes,
    }, { transaction: t });

    const cobro = cobroPendienteDeBono({
      amount,
      clientId: nuevo.clientId,
      patientId: nuevo.patientId,
      packId: nuevo.id,
      nombre: nombreDelTipo,
      sesiones: totalSessions,
      compradoEl: nuevo.purchasedAt,
    });
    if (cobro && Payment) {
      await Payment.create(cobro, { transaction: t });
      huboCobro = true;
    }
    return nuevo;
  });

  return { bono, cobro: huboCobro };
}
