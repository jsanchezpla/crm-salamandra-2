/**
 * accionesRequeridas — las FILAS de la pantalla «Acciones requeridas»
 * (31/08/2026).
 *
 * El Panel operativo enseña tres contadores (facturas vencidas, presupuestos
 * que caducan, aceptados sin facturar) y hasta hoy no había dónde ver la lista
 * completa. Esta pieza devuelve las filas de las tres categorías con una forma
 * común, para que la pantalla filtre encima sin repetir consultas.
 *
 * Mismos criterios que los contadores de `app/api/billing/operations/route.js`
 * — si esto y aquello divergen, el Panel diría «3 vencidas» y la pantalla
 * enseñaría otra cosa:
 *   · vencida   → emitida/enviada/parcial, vencimiento ANTES de hoy (día de
 *                 Madrid), y cobrada de menos.
 *   · caduca    → presupuesto vivo (borrador/enviado/visto) con validez que
 *                 vence entre hoy y dentro de 7 días.
 *   · aceptado  → presupuesto en `accepted`: aceptado y aún sin convertir en
 *                 factura (convertirlo lo pasa a `converted`).
 *
 * La tabla `quotes` puede no existir (migración sin aplicar): sus dos listas
 * degradan a vacío, como hace el Panel.
 */
import { Op, col } from "sequelize";

const TOPE = 200; // tope alto y visible: si algún día se supera, la pantalla lo dice

function esTablaAusente(err) {
  const code = err?.parent?.code || err?.original?.code;
  return code === "42P01" || /relation .* does not exist/i.test(err?.message || "");
}

function nombreCliente(fila) {
  return fila?.client?.name || "";
}

export async function listaDeAcciones({ tenantModels, today, in7 }) {
  const { Invoice, Quote, Client } = tenantModels;
  const conCliente = Client
    ? [{ model: Client, as: "client", attributes: ["id", "name"] }]
    : [];

  const vencidasRows = await Invoice.findAll({
    where: {
      status: { [Op.in]: ["issued", "sent", "partially_paid"] },
      dueDate: { [Op.lt]: today },
      paidAmount: { [Op.lt]: col("total") },
    },
    include: conCliente,
    order: [["dueDate", "ASC"]],
    limit: TOPE,
  });
  const vencidas = vencidasRows.map((r) => ({
    tipo: "vencida",
    id: r.id,
    numero: r.number,
    cliente: nombreCliente(r),
    clientId: r.clientId ?? null,
    fecha: r.dueDate,
    importe: Math.round((Number(r.total || 0) - Number(r.paidAmount || 0)) * 100) / 100,
  }));

  let caducan = [];
  let aceptados = [];
  try {
    const caducanRows = await Quote.findAll({
      where: {
        status: { [Op.in]: ["draft", "sent", "viewed"] },
        validUntil: { [Op.between]: [today, in7] },
      },
      include: conCliente,
      order: [["validUntil", "ASC"]],
      limit: TOPE,
    });
    caducan = caducanRows.map((r) => ({
      tipo: "caduca",
      id: r.id,
      numero: r.number,
      cliente: nombreCliente(r),
      clientId: r.clientId ?? null,
      fecha: r.validUntil,
      importe: Number(r.total || 0),
    }));

    const aceptadosRows = await Quote.findAll({
      where: { status: "accepted" },
      include: conCliente,
      order: [["issueDate", "DESC"]],
      limit: TOPE,
    });
    aceptados = aceptadosRows.map((r) => ({
      tipo: "aceptado",
      id: r.id,
      numero: r.number,
      cliente: nombreCliente(r),
      clientId: r.clientId ?? null,
      fecha: r.issueDate,
      importe: Number(r.total || 0),
    }));
  } catch (e) {
    if (!esTablaAusente(e)) throw e;
  }

  return {
    vencidas,
    caducan,
    aceptados,
    // Si alguna lista tocó su tope, la pantalla lo dice en vez de fingir que
    // eso es todo (regla de la casa: los recortes se ven).
    topes: {
      limite: TOPE,
      vencidas: vencidas.length >= TOPE,
      caducan: caducan.length >= TOPE,
      aceptados: aceptados.length >= TOPE,
    },
  };
}
