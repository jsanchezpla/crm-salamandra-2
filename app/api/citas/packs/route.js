import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { logCitasAudit } from "../../../../lib/citas/audit.js";
import { esPack } from "../../../../lib/citas/packs.js";

/**
 * POST /api/citas/packs — dar un bono a mano (05/08/2026).
 *
 * El único camino que había para que naciera un bono era el webhook de Stripe:
 * alguien pagaba online y se le abrían sus N sesiones. Pero hay pacientes que
 * pagan POR FUERA de la pasarela —transferencia desde el extranjero, Bizum a un
 * móvil, PayPal—, y ese trato se cierra por WhatsApp. Sin esto, cada una de sus
 * citas había que pedirla y crearla a mano, una por una, para siempre.
 *
 * Con el bono dado a mano, esa paciente ve su tipo de cita (aunque esté oculto),
 * ve su contador —«3 de 6»— y reserva sola. Nadie más lo ve.
 *
 * ⚠️ ESTO REGALA SESIONES. Es la única puerta del CRM que abre derecho a citas
 * sin que haya un cobro detrás que mirar, así que:
 *   · solo admin;
 *   · queda marcado `origin: 'manual'` y con el nombre de quien lo creó, para
 *     poder distinguirlo de un bono con su pago en Stripe;
 *   · se audita.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

const normalizeEmail = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** Nombre legible de quien está creando el bono, para dejarlo escrito. */
async function quienLoCrea(request, tenantModels) {
  const userId = request.headers.get("x-user-id");
  try {
    const { TeamMember } = tenantModels;
    if (TeamMember && userId) {
      const tm = await TeamMember.findOne({
        where: { userId },
        attributes: ["displayName", "email"],
      });
      if (tm) return tm.displayName || tm.email || userId;
    }
  } catch {
    // Sin ficha de equipo (un admin que no da servicio) o sin tabla: se queda
    // el id, que al menos permite rastrearlo con el log de auditoría.
  }
  return userId ?? null;
}

export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");

    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede dar bonos a mano");

    const { SessionPack, EventType, Client } = tenantModels;
    if (!SessionPack) return error("Este cliente no tiene bonos de sesiones", 422);

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    // ── A quién ─────────────────────────────────────────────────────────────
    // El correo es lo que ata las citas al bono (igual que en packs.js): el
    // portal identifica por correo verificado. La ficha es un extra para poder
    // enseñarlo en su pantalla, y se rellena si se conoce.
    let clientEmail = normalizeEmail(body.clientEmail);
    let clientId = body.clientId || null;

    if (clientId && Client) {
      const ficha = await Client.findByPk(clientId);
      if (!ficha) return error("Esa ficha no existe", 422);
      // El correo del cuerpo manda si viene: hay fichas cuyo correo de portal no
      // es el de contacto, y el bono tiene que ir al que ella usa para entrar.
      if (!clientEmail) clientEmail = normalizeEmail(ficha.portalEmail || ficha.email);
    }

    if (!clientEmail || !isValidEmail(clientEmail)) {
      return error("Hace falta el correo de la paciente para darle el bono", 422);
    }

    // ── De qué ──────────────────────────────────────────────────────────────
    const eventType = body.eventTypeId && EventType ? await EventType.findByPk(body.eventTypeId) : null;
    if (!eventType) return error("Ese tipo de cita no existe", 422);

    // Cuántas sesiones. Por defecto, las que trae el tipo de cita; se puede
    // ajustar porque un acuerdo cerrado por WhatsApp no siempre es el paquete
    // estándar («te hago 4 en vez de 6»).
    const totalSessions =
      body.totalSessions == null ? Number(eventType.sessionsCount) || 1 : Number(body.totalSessions);
    if (!Number.isInteger(totalSessions) || totalSessions < 1 || totalSessions > 200) {
      return error("El número de sesiones debe ser un entero entre 1 y 200", 422);
    }

    // Lo que se cobró por fuera, en céntimos. Opcional: es para el registro, no
    // se usa para nada más. No se valida contra el precio del tipo de cita a
    // propósito — el acuerdo puede haber sido otro.
    let amount = body.amount == null || body.amount === "" ? null : Number(body.amount);
    if (amount !== null && (!Number.isInteger(amount) || amount < 0)) {
      return error("El importe debe ser un número entero de céntimos", 422);
    }

    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) || null : null;

    // ── Avisos, no cortes ───────────────────────────────────────────────────
    // Dar un bono de 1 sesión sobre un tipo que no es pack es raro pero legítimo
    // (una sesión suelta ya cobrada por transferencia), así que no se bloquea.
    const avisos = [];
    if (!esPack(eventType) && totalSessions > 1) {
      avisos.push(
        `«${eventType.name}» está configurado como cita suelta y le estás dando ${totalSessions} sesiones.`
      );
    }
    if (!eventType.isHidden) {
      avisos.push(
        `«${eventType.name}» está a la vista de todo el mundo en la agenda pública. Si este bono es de un acuerdo privado, márcalo como oculto en Citas → Tipos de cita.`
      );
    }

    const pack = await SessionPack.create({
      clientEmail,
      clientId,
      eventTypeId: eventType.id,
      totalSessions,
      // Se pagó fuera de la pasarela: no hay plazos que gestionar aquí.
      pricingMode: "upfront",
      amount,
      instalmentAmount: null,
      instalmentMonths: null,
      paymentSessionId: null,
      origin: "manual",
      createdBy: await quienLoCrea(request, tenantModels),
      purchasedAt: body.purchasedAt ? new Date(body.purchasedAt) : new Date(),
      status: "active",
      notes,
    });

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.pack_manual_created",
      entity: "SessionPack",
      entityId: pack.id,
      before: null,
      // Resumen, no la fila entera: el correo de una paciente no se duplica en
      // la tabla de master, que comparten todos los clientes.
      after: {
        eventType: eventType.name,
        totalSessions,
        amount,
        origin: "manual",
      },
      ip,
    });

    return created({ id: pack.id, totalSessions, avisos });
  } catch (err) {
    return serverError(err);
  }
});
