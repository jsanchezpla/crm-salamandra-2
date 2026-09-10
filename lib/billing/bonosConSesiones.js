/**
 * lib/billing/bonosConSesiones.js — traer los bonos con sus sesiones contadas y
 * su cobro, en cinco consultas y no en quinientas (10/09/2026, submódulo Bonos).
 *
 * (Fichero nuevo en /lib, regla #2: es la mitad que NECESITA Sequelize de lo que
 * `lib/billing/bonos.js` decide en puro, y la piden cuatro endpoints —la lista,
 * los grupos, la ficha de un grupo y el PATCH—. Copiada cuatro veces habría
 * acabado contando sesiones distintas en cada pantalla, que es el fallo que ya
 * arregló `lib/billing/resumenCaja.js` con el Excel del arqueo.)
 *
 * ── POR QUÉ NO SE REUSA `bonosDeCliente` ───────────────────────────────────
 * `lib/citas/packs.js` tiene `bonosDeCliente`, que hace exactamente esto para
 * UNA ficha: bono a bono, y por cada uno una consulta de citas. Es lo correcto
 * en una ficha con tres bonos y es inservible en una pantalla con los 232 de
 * Aumenta — serían 232 consultas para pintar una tabla. Aquí las citas de TODOS
 * los bonos se traen de una vez y se reparten en memoria.
 *
 * Las cuentas siguen siendo las suyas: `estadoPack` es el que sabe qué cita
 * gasta sesión y qué cita solo la reserva, y se llama por bono con las citas ya
 * agrupadas. Contar aquí otra vez sería tener dos verdades sobre «le quedan 3».
 */

import { Op } from "sequelize";

import { estadoPack } from "../citas/packs.js";
import { billingHasPatients } from "./patientLink.js";

/** 42P01 = la tabla no existe en este schema (migración sin aplicar). */
function esTablaAusente(err) {
  const code = err?.parent?.code || err?.original?.code;
  return code === "42P01";
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Los pacientes que salen en la lista, en UNA consulta. Mapa id -> nombre.
 *
 * Vacío si el centro no tiene módulo asistencial: entonces el bono es de la
 * ficha y no hay ningún niño que nombrar.
 */
async function nombresDePacientes({ tenantModels, hasModule, ids }) {
  const mapa = new Map();
  if (!billingHasPatients(hasModule) || !tenantModels.Patient || !ids.length) return mapa;
  try {
    const filas = await tenantModels.Patient.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ["id", "firstName", "lastName", "clientId"],
      raw: true,
    });
    for (const p of filas) {
      mapa.set(String(p.id), {
        id: p.id,
        nombre: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "(sin nombre)",
        clientId: p.clientId ?? null,
      });
    }
  } catch (err) {
    if (!esTablaAusente(err)) throw err;
  }
  return mapa;
}

/**
 * EL COBRO DE CADA BONO, resumido.
 *
 * Casi siempre es uno —el pendiente que nace con el bono
 * (`lib/billing/cobroDelBono.js`)— pero puede haber varios: un cobro partido en
 * Cobros deja dos filas del mismo bono. Por eso se suma en vez de coger el
 * primero, y por eso el estado del dinero es 'cobrado' / 'pendiente' / 'a
 * medias' y no el `status` de una fila.
 *
 * Los importes salen en EUROS, que es como los guarda `payments.amount`. El
 * bono habla en céntimos: la costura está aquí y en `cobroDelBono.js`, en
 * ningún otro sitio.
 */
async function cobrosDeLosBonos({ tenantModels, ids }) {
  const mapa = new Map();
  const { Payment, Invoice } = tenantModels;
  if (!Payment || !ids.length) return mapa;
  let filas = [];
  try {
    filas = await Payment.findAll({
      where: { packId: { [Op.in]: ids } },
      attributes: [
        "id", "packId", "clientId", "patientId", "amount", "status", "method", "paidAt",
        "refundedAt", "invoiceId", "notes", "invoiceText",
        "stripePaymentIntentId", "bankTransactionId", "paymentSessionId",
      ],
      include: Invoice ? [{ model: Invoice, as: "invoice", attributes: ["id", "number", "status"], required: false }] : [],
      order: [["paidAt", "ASC"]],
    });
  } catch (err) {
    // Un tenant sin la columna `pack_id` migrada no tiene por qué quedarse sin
    // pantalla: se enseñan los bonos y el dinero sale como «sin cobro».
    if (!esTablaAusente(err)) throw err;
    return mapa;
  }

  for (const p of filas) {
    const fila = p.toJSON ? p.toJSON() : p;
    const clave = String(fila.packId);
    if (!mapa.has(clave)) mapa.set(clave, { cobros: [], cobrado: 0, pendiente: 0, devuelto: 0 });
    const cubo = mapa.get(clave);
    const importe = round2(fila.amount);
    cubo.cobros.push({
      id: fila.id,
      amount: importe,
      status: fila.status,
      method: fila.method ?? null,
      paidAt: fila.paidAt ?? null,
      refundedAt: fila.refundedAt ?? null,
      invoiceId: fila.invoiceId ?? null,
      invoiceNumber: fila.invoice?.number ?? null,
      notes: fila.notes ?? null,
      invoiceText: fila.invoiceText ?? null,
      // Lo que decide si ese cobro se puede reescribir cuando cambia el bono.
      stripePaymentIntentId: fila.stripePaymentIntentId ?? null,
      bankTransactionId: fila.bankTransactionId ?? null,
      paymentSessionId: fila.paymentSessionId ?? null,
    });
    // Devuelto es dinero que entró y salió: no cuenta como cobrado ni deja
    // deuda (`payments.refunded_at`, 07/09/2026).
    if (fila.refundedAt) cubo.devuelto = round2(cubo.devuelto + importe);
    else if (fila.status === "paid") cubo.cobrado = round2(cubo.cobrado + importe);
    else if (fila.status === "pending") cubo.pendiente = round2(cubo.pendiente + importe);
  }

  for (const cubo of mapa.values()) {
    cubo.estado = cubo.pendiente > 0 && cubo.cobrado > 0
      ? "a medias"
      : cubo.pendiente > 0
        ? "pendiente"
        : cubo.cobrado > 0
          ? "cobrado"
          : "devuelto";
  }
  return mapa;
}

/**
 * LOS BONOS QUE CASAN CON `where`, ya en JSON, con:
 *   · su tipo de bono (nombre, sesiones del catálogo, precio, si está oculto);
 *   · su familia pagadora y su paciente, con nombre;
 *   · sus sesiones contadas desde las citas (total, gastadas, reservadas, libres);
 *   · su cobro, resumido y en euros.
 *
 * Devuelve [] —y no revienta— si el centro no tiene la tabla de bonos: es lo que
 * pasa en un tenant sin módulo de citas, y una pantalla vacía se entiende sola.
 */
export async function bonosConSesiones({ tenantModels, hasModule, where = {} } = {}) {
  const { SessionPack, EventType, Client, Booking } = tenantModels;
  if (!SessionPack) return [];

  let packs = [];
  try {
    packs = await SessionPack.findAll({
      where,
      include: [
        ...(EventType
          ? [{ model: EventType, as: "eventType", attributes: ["id", "name", "sessionsCount", "price", "isHidden", "active"], required: false }]
          : []),
        ...(Client
          ? [{ model: Client, as: "client", attributes: ["id", "name", "fiscalName", "email", "portalEmail"], required: false }]
          : []),
      ],
      order: [["purchasedAt", "DESC"]],
    });
  } catch (err) {
    if (!esTablaAusente(err)) throw err;
    return [];
  }
  if (!packs.length) return [];

  const ids = packs.map((p) => p.id);

  // Las citas de TODOS los bonos de una vez. Solo lo que `estadoPack` mira:
  // traerse la cita entera son 5.000 filas gordas para contar sesiones.
  const citasPorBono = new Map();
  if (Booking) {
    try {
      const citas = await Booking.findAll({
        where: { packId: { [Op.in]: ids } },
        attributes: ["id", "packId", "status", "scheduledAt", "cancelledAt", "noShowJustified", "sessionNumber"],
        raw: true,
      });
      for (const c of citas) {
        const clave = String(c.packId);
        if (!citasPorBono.has(clave)) citasPorBono.set(clave, []);
        citasPorBono.get(clave).push(c);
      }
    } catch (err) {
      if (!esTablaAusente(err)) throw err;
    }
  }

  const pacientes = await nombresDePacientes({
    tenantModels,
    hasModule,
    ids: [...new Set(packs.map((p) => p.patientId).filter(Boolean))],
  });
  const cobros = await cobrosDeLosBonos({ tenantModels, ids });

  return packs.map((p) => {
    const fila = p.toJSON();
    const estado = estadoPack(fila, citasPorBono.get(String(fila.id)) ?? []);
    const paciente = fila.patientId ? pacientes.get(String(fila.patientId)) ?? null : null;
    const dinero = cobros.get(String(fila.id)) ?? null;
    return {
      id: fila.id,
      eventTypeId: fila.eventTypeId,
      nombre: fila.eventType?.name ?? "(tipo de bono borrado del catálogo)",
      sesionesDelTipo: fila.eventType ? Number(fila.eventType.sessionsCount) || 1 : null,
      precioDelTipo: fila.eventType && Number.isInteger(fila.eventType.price) ? fila.eventType.price : null,
      tipoOculto: fila.eventType ? fila.eventType.isHidden === true : false,
      clientId: fila.clientId ?? null,
      familia: fila.client ? fila.client.fiscalName || fila.client.name : null,
      correo: fila.clientEmail ?? null,
      patientId: fila.patientId ?? null,
      paciente: paciente?.nombre ?? null,
      // En céntimos, como lo guarda `session_packs` (ver `lib/billing/bonos.js`).
      amount: Number.isInteger(fila.amount) ? fila.amount : null,
      modoPago: fila.pricingMode,
      origen: fila.origin,
      creadoPor: fila.createdBy ?? null,
      compradoEl: fila.purchasedAt,
      status: fila.status,
      previas: Number(fila.sesionesPrevias) || 0,
      notes: fila.notes ?? null,
      total: estado.total,
      gastadas: estado.gastadas,
      reservadas: estado.reservadas,
      restantes: estado.restantes,
      resumen: estado.resumen,
      // El dinero: null = nunca hubo cobro (bono sin importe o regalado).
      cobro: dinero
        ? { estado: dinero.estado, cobrado: dinero.cobrado, pendiente: dinero.pendiente, devuelto: dinero.devuelto, cobros: dinero.cobros }
        : null,
    };
  });
}
