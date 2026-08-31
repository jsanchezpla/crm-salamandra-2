import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { logBillingAudit, resumenFactura, datosPeticion } from "../../../../../lib/billing/audit.js";
import { assignInvoiceNumber } from "../../../../../lib/billing/generateInvoiceNumber.js";
import { calculateInvoice } from "../../../../../lib/billing/calculateInvoice.js";
import { fotoFiscalDe, ATRIBUTOS_PARA_CONGELAR } from "../../../../../lib/billing/datosFiscales.js";
import { agruparLoteCuotas, lineasDeCuota, mesValido, finExclusivoDe } from "../../../../../lib/billing/lotesCuotas.js";
import { madridToday } from "../../../../../lib/utils/madridDate.js";

/**
 * La «Facturación del mes» (31/08/2026, petición de Aumenta — la Facturación
 * múltiple de Organízate): emitir de una vez las facturas de cuota de un mes a
 * partir de los cobros YA registrados, una por pagador, enganchando los cobros
 * (`payments.invoice_id`) para que cada factura nazca COBRADA.
 *
 *   GET  ?mes=AAAA-MM             → vista previa: qué se emitiría y qué no
 *   POST { mes, issueDate?, exclude?: [clientId] } → emite en serie
 *
 * Qué entra en el lote: cobros `completed` con ese `period_month` y sin
 * factura. Enganchar NO toca ni `period_month` ni el estado del cobro, así que
 * la morosidad y el bloqueo del portal siguen diciendo exactamente lo mismo.
 * Relanzar el mes no duplica: los cobros ya enganchados desaparecen del lote.
 *
 * A quien no tiene NIF se le salta y se le lista (las ~100 familias sin DNI de
 * Aumenta no pueden tumbar a las demás); la lista es el trabajo de recepción.
 */

async function recogerLote({ tenantModels, mes }) {
  const { Payment, Client, Invoice } = tenantModels;

  const cobros = await Payment.findAll({
    where: { status: "completed", periodMonth: `${mes}-01`, invoiceId: null },
    attributes: ["id", "clientId", "amount", "method", "paidAt", "notes"],
    order: [["paidAt", "ASC"]],
  });

  const ids = [...new Set(cobros.map((c) => String(c.clientId)).filter(Boolean))];
  const clientes = ids.length
    ? await Client.findAll({ where: { id: { [Op.in]: ids } }, attributes: ATRIBUTOS_PARA_CONGELAR })
    : [];

  // Facturas activas ya emitidas ese mes → AVISO de posible duplicado (no
  // exclusión: la factura manual de ese mes puede ser de otra cosa).
  const facturasMes = ids.length
    ? await Invoice.findAll({
        where: {
          clientId: { [Op.in]: ids },
          issueDate: { [Op.gte]: `${mes}-01`, [Op.lt]: finExclusivoDe(mes) },
          status: { [Op.notIn]: ["draft", "cancelled", "rectified"] },
        },
        attributes: ["clientId"],
      })
    : [];

  const lote = agruparLoteCuotas({
    cobros: cobros.map((c) => c.toJSON()),
    clientes: clientes.map((c) => c.toJSON()),
    clientesConFacturaDelMes: facturasMes.map((f) => String(f.clientId)),
  });
  return { ...lote, fichas: new Map(clientes.map((c) => [String(c.id), c])) };
}

/** Qué le falta al emisor para poder facturar (el PDF sale a su nombre). */
function faltaEmisor(settings) {
  const faltan = [];
  if (!String(settings?.fiscalName ?? "").trim()) faltan.push("razón social");
  if (!String(settings?.taxId ?? "").trim()) faltan.push("NIF/CIF");
  return faltan;
}

/** La fecha de la última factura de la serie F de ese año (o null si no hay). */
async function ultimaFechaSerie({ tenantModels, year }) {
  const { InvoiceSeries, Invoice } = tenantModels;
  const serie = await InvoiceSeries.findOne({ where: { code: "F" } });
  const prefix = serie?.prefix ?? "F";
  const ultima = await Invoice.findOne({
    where: { number: { [Op.like]: `${prefix}-${year}-%` } },
    order: [["issueDate", "DESC"]],
    attributes: ["issueDate"],
  });
  return ultima ? String(ultima.issueDate).slice(0, 10) : null;
}

const vistaGrupo = (g) => ({
  clientId: g.clientId,
  nombre: g.nombre,
  nif: g.nif,
  importe: g.importe,
  facturaPrevia: g.facturaPrevia,
  motivo: g.motivo ?? null,
  cobros: g.cobros.map((c) => ({ id: c.id, amount: c.amount, paidAt: c.paidAt, method: c.method })),
});

export const GET = withTenant(async (request, _rc, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { TenantBillingSettings } = tenantModels;

    const mes = new URL(request.url).searchParams.get("mes");
    if (!mesValido(mes)) return error("El mes debe ser 'AAAA-MM'", 422);

    const settings = await TenantBillingSettings.findOne();
    const { facturables, sinNif } = await recogerLote({ tenantModels, mes });
    const hoy = madridToday();

    return ok({
      mes,
      emisor: { ok: faltaEmisor(settings).length === 0, faltan: faltaEmisor(settings) },
      facturables: facturables.map(vistaGrupo),
      sinNif: sinNif.map(vistaGrupo),
      totales: {
        familias: facturables.length,
        cobros: facturables.reduce((s, g) => s + g.cobros.length, 0),
        importe: facturables.reduce((s, g) => s + g.importe, 0),
      },
      fechaPropuesta: hoy,
      // El datepicker no debe ofrecer fechas que la serie va a rechazar.
      fechaMinimaSerie: await ultimaFechaSerie({ tenantModels, year: Number(hoy.slice(0, 4)) }),
      ivaAplicado: settings?.vatExempt ? 0 : Number(settings?.defaultVatRate ?? 21),
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Payment, Invoice, TenantBillingSettings } = tenantModels;

    const body = await request.json();
    const mes = body?.mes;
    if (!mesValido(mes)) return error("El mes debe ser 'AAAA-MM'", 422);
    const fecha = body?.issueDate ? String(body.issueDate) : madridToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return error("issueDate debe ser 'AAAA-MM-DD'", 422);
    const excluidos = new Set((Array.isArray(body?.exclude) ? body.exclude : []).map(String));

    const settings = await TenantBillingSettings.findOne();
    const faltan = faltaEmisor(settings);
    if (faltan.length > 0) {
      return error(
        `El emisor no tiene datos fiscales completos: falta ${faltan.join(" y ")}. Rellénalos en Configuración → Facturación antes de emitir el lote.`,
        422
      );
    }

    // La fecha se valida ANTES de empezar, no a mitad de lote: todas las
    // facturas llevan la misma y `assignInvoiceNumber` la rechazaría igual.
    const tope = await ultimaFechaSerie({ tenantModels, year: Number(fecha.slice(0, 4)) });
    if (tope && tope > fecha) {
      return error(
        `No se puede emitir con fecha ${fecha}: la última factura de la serie es del ${tope} y la numeración debe ir en orden de fecha.`,
        422
      );
    }

    // La exención general congela su nota legal en cada factura, igual que en
    // POST /invoices; sin exención se repercute el IVA por defecto del tenant
    // calculando la base hacia atrás desde lo cobrado (ver lotesCuotas.js).
    const vatExempt = !!settings?.vatExempt;
    const vatRate = vatExempt ? 0 : Number(settings?.defaultVatRate ?? 21);
    const vatExemptNote = vatExempt
      ? settings?.vatExemptNote || "Operación exenta de IVA conforme al artículo 20 de la Ley 37/1992 del IVA."
      : null;

    const { facturables, sinNif, fichas } = await recogerLote({ tenantModels, mes });
    const sequelize = Invoice.sequelize;
    const resultados = [];
    const auditoria = [];

    for (const grupo of sinNif) {
      resultados.push({ clientId: grupo.clientId, nombre: grupo.nombre, importe: grupo.importe, resultado: "saltada", motivo: grupo.motivo });
    }

    // EN SERIE a propósito: el número correlativo bloquea la fila de la serie
    // (FOR UPDATE) y en paralelo solo se conseguirían interbloqueos. Una
    // transacción POR familia: si la 37 falla, las 36 emitidas son válidas y
    // relanzar el mes retoma solo lo pendiente.
    for (const grupo of facturables) {
      if (excluidos.has(grupo.clientId)) {
        resultados.push({ clientId: grupo.clientId, nombre: grupo.nombre, importe: grupo.importe, resultado: "excluida", motivo: "excluida a mano" });
        continue;
      }
      try {
        const invoice = await sequelize.transaction(async (t) => {
          const lines = lineasDeCuota({ cobros: grupo.cobros, mes, vatRate });
          const calc = calculateInvoice({ lines, irpfRate: 0 });
          if (calc.total !== grupo.importe) {
            // No debería pasar (lotesCuotas lo garantiza); antes que emitir una
            // factura que no cuadra con su dinero, se salta y se cuenta.
            throw Object.assign(new Error(`El total (${calc.total}) no cuadra con lo cobrado (${grupo.importe})`), { code: "LOTE_DESCUADRE" });
          }
          const number = await assignInvoiceNumber({ sequelize, models: tenantModels, seriesCode: "F", date: fecha, t });
          const ultimo = grupo.cobros[grupo.cobros.length - 1];
          const factura = await Invoice.create(
            {
              clientId: grupo.clientId,
              issueDate: fecha,
              dueDate: fecha,
              lines: calc.lines,
              taxBase: calc.taxBase,
              vatAmount: calc.vatAmount,
              irpfRate: 0,
              irpfAmount: 0,
              total: calc.total,
              paidAmount: calc.total,
              series: "F",
              number,
              status: "paid",
              paidAt: ultimo?.paidAt ?? new Date(),
              fiscalSnapshot: fotoFiscalDe(fichas.get(grupo.clientId)),
              customFields: { loteCuotas: mes, ...(vatExemptNote ? { vatExemptNote } : {}) },
              // legacy neutros, como POST /invoices
              subtotal: calc.taxBase,
              vatRate: 0,
            },
            { transaction: t }
          );
          const idsCobros = grupo.cobros.map((c) => c.id);
          const [enganchados] = await Payment.update(
            { invoiceId: factura.id },
            { where: { id: { [Op.in]: idsCobros }, invoiceId: null, status: "completed" }, transaction: t }
          );
          if (enganchados !== idsCobros.length) {
            // Alguien tocó los cobros entre la vista previa y este momento:
            // mejor deshacer esta factura que emitirla con el dinero cambiado.
            throw Object.assign(new Error("Los cobros cambiaron mientras se emitía; relanza el lote"), { code: "LOTE_CONFLICTO" });
          }
          return factura;
        });
        resultados.push({ clientId: grupo.clientId, nombre: grupo.nombre, importe: grupo.importe, resultado: "emitida", numero: invoice.number, invoiceId: invoice.id });
        auditoria.push(invoice);
      } catch (err) {
        resultados.push({
          clientId: grupo.clientId,
          nombre: grupo.nombre,
          importe: grupo.importe,
          resultado: "saltada",
          motivo: ["LOTE_DESCUADRE", "LOTE_CONFLICTO", "OUT_OF_ORDER_DATE"].includes(err?.code) ? err.message : "error inesperado al emitir",
        });
        // La fecha fuera de orden no se arregla insistiendo: pararía TODAS las
        // que quedan con el mismo error (solo puede pasar si alguien emite a
        // mano, con fecha posterior, en mitad del lote).
        if (err?.code === "OUT_OF_ORDER_DATE") break;
      }
    }

    // Auditoría DESPUÉS de mutar y FUERA de la transacción, como el resto del
    // dinero. Misma acción que el emit individual, con la marca del lote.
    for (const invoice of auditoria) {
      await logBillingAudit({
        tenantId: tenant.id,
        ...datosPeticion(request),
        action: "invoice.issued",
        entity: "Invoice",
        entityId: invoice.id,
        before: null,
        after: { ...resumenFactura(invoice), lote: mes },
      });
    }

    return ok({
      mes,
      issueDate: fecha,
      emitidas: resultados.filter((r) => r.resultado === "emitida").length,
      saltadas: resultados.filter((r) => r.resultado === "saltada").length,
      excluidas: resultados.filter((r) => r.resultado === "excluida").length,
      resultados,
    });
  } catch (err) {
    return serverError(err);
  }
});
