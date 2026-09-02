import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { calculateInvoice } from "../../../../../lib/billing/calculateInvoice.js";
import { withEffectiveStatus } from "../../../../../lib/billing/invoiceStatus.js";
import { resolveInvoicePatientId, invoicePatientInclude } from "../../../../../lib/billing/patientLink.js";
import { logBillingAudit, resumenFactura, datosPeticion } from "../../../../../lib/billing/audit.js";
import { tutorDe, aNombreDe, faltaParaEmitirATutor } from "../../../../../lib/billing/datosFiscales.js";


// GET /api/billing/invoices/[id]
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Invoice, Payment, Client, TeamMember } = tenantModels;
    const { id } = await params;

    const invoice = await Invoice.findByPk(id, {
      include: [
        { model: Payment, as: "payments" },
        { model: Client, as: "client" },
        { model: TeamMember, as: "employee", attributes: ["id", "displayName"] },
        { model: Invoice, as: "rectifies", attributes: ["id", "number", "issueDate", "total"] },
        { model: Invoice, as: "rectifiedBy", attributes: ["id", "number", "issueDate", "total"] },
        ...invoicePatientInclude(tenantModels, hasModule),
      ],
    });

    if (!invoice) return notFound("Factura no encontrada");
    // «A nombre de» y lo que falta para emitir al tutor se resuelven AQUÍ y
    // los tutores de la familia (DNI, teléfono) no viajan (revisión 02/09/2026).
    const j = withEffectiveStatus(invoice);
    const plano = typeof j?.toJSON === "function" ? j.toJSON() : { ...j };
    const salida = {
      ...plano,
      aNombreDe: aNombreDe(plano, plano.client),
      faltaTutor: plano.guardianId ? faltaParaEmitirATutor(plano, plano.client) : null,
    };
    if (salida.client && typeof salida.client === "object") {
      const { guardians: _tutores, ...resto } = salida.client;
      salida.client = resto;
    }
    return ok(salida);
  } catch (err) {
    return serverError(err);
  }
});

// PATCH /api/billing/invoices/[id] — solo en draft
export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { Invoice } = tenantModels;
    const { id } = await params;
    const body = await request.json();

    const invoice = await Invoice.findByPk(id);
    if (!invoice) return notFound("Factura no encontrada");

    if (invoice.status !== "draft") {
      return error("Solo se pueden editar facturas en borrador. Para cambios usa rectificativa.", 409);
    }

    const allowed = ["clientId", "employeeId", "partnerId", "issueDate", "dueDate", "lines", "notes", "customFields", "series"];
    const updates = {};
    for (const k of allowed) {
      if (k in body) updates[k] = body[k];
    }

    // patientId (enlace factura↔paciente): validado aparte; null desenlaza.
    if ("patientId" in body) {
      const patRes = await resolveInvoicePatientId(body.patientId, tenantModels, hasModule);
      if (patRes.err) return error(patRes.err);
      updates.patientId = patRes.patientId;
    }

    // eventTypeId (enlace factura↔tipo de cita, 29/08/2026): null desenlaza.
    if ("eventTypeId" in body) {
      if (body.eventTypeId) {
        const { EventType } = tenantModels;
        const et = EventType ? await EventType.findByPk(body.eventTypeId, { attributes: ["id"] }).catch(() => null) : null;
        if (!et) return error("eventTypeId no corresponde a ningún tipo de cita de este centro");
        updates.eventTypeId = et.id;
      } else {
        updates.eventTypeId = null;
      }
    }

    /*
     * A NOMBRE DE UN TUTOR (revisión 02/09/2026). Se puede poner, cambiar o
     * quitar (`null`), y tiene que ser un tutor de la familia que PAGA. Si se
     * cambia de familia sin decir tutor, el tutor se quita: el de la familia
     * anterior no es de esta, y dejarlo colgado bloqueaba la emisión para
     * siempre («ya no está en la ficha de la familia») sin forma de quitarlo.
     */
    const cambiaFamilia = "clientId" in body && body.clientId && body.clientId !== invoice.clientId;
    if ("guardianId" in body || cambiaFamilia) {
      const pedido = "guardianId" in body ? body.guardianId : null;
      if (pedido) {
        const { Client } = tenantModels;
        const clienteFinal = updates.clientId ?? invoice.clientId;
        const ficha = Client ? await Client.findByPk(clienteFinal, { attributes: ["id", "guardians"] }) : null;
        const tutor = tutorDe(ficha, pedido);
        if (!tutor) return error("Ese tutor no está en la ficha de la familia que paga", 422);
        updates.guardianId = tutor.id;
      } else {
        updates.guardianId = null;
      }
    }

    // Recalcular totales si cambian las líneas o el tipo de IRPF. El IRPF se
    // aplica sobre la base, así que un cambio de tipo recalcula el total.
    const irpfChanged = "irpfRate" in body;
    if (updates.lines || irpfChanged) {
      const effectiveLines = updates.lines ?? invoice.lines ?? [];
      const effectiveIrpf = irpfChanged ? Number(body.irpfRate) : Number(invoice.irpfRate);
      const calc = calculateInvoice({ lines: effectiveLines, irpfRate: effectiveIrpf });
      updates.lines = calc.lines;
      updates.taxBase = calc.taxBase;
      updates.vatAmount = calc.vatAmount;
      updates.irpfRate = calc.irpfRate;
      updates.irpfAmount = calc.irpfAmount;
      updates.total = calc.total;
      updates.subtotal = calc.taxBase; // legacy campo, se mantiene cuadrado
    }

    const antes = resumenFactura(invoice);
    await invoice.update(updates);
    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "invoice.updated",
      entity: "Invoice",
      entityId: invoice.id,
      before: antes,
      after: resumenFactura(invoice),
    });
    return ok(invoice);
  } catch (err) {
    return serverError(err);
  }
});

// DELETE /api/billing/invoices/[id] — solo en draft
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { Invoice } = tenantModels;
    const { id } = await params;

    const invoice = await Invoice.findByPk(id);
    if (!invoice) return notFound("Factura no encontrada");
    if (invoice.status !== "draft") {
      return error("Solo se pueden eliminar facturas en borrador", 409);
    }
    // Borrar una factura (aunque sea borrador) no dejaba NINGÚN rastro.
    const antes = resumenFactura(invoice);
    const idBorrado = invoice.id;
    await invoice.destroy();
    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "invoice.deleted",
      entity: "Invoice",
      entityId: idBorrado,
      before: antes,
      after: null,
    });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
