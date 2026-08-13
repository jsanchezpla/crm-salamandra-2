import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { created, ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { logCitasAudit } from "../../../../lib/citas/audit.js";
import { esPack, bonosDeCliente } from "../../../../lib/citas/packs.js";

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

/**
 * GET /api/citas/packs?clientId=…&email=… — los bonos VIVOS de una persona
 * (13/08/2026, Rodrigo).
 *
 * Nace del alta manual de citas: quien tiene un bono viene siempre a lo mismo,
 * y había que ir a su ficha a mirar de qué era para elegir el tipo de cita a
 * mano. Con esto, al elegir a la paciente el tipo se pone solo.
 *
 * Solo devuelve los que se pueden gastar HOY (activos y con sesiones libres):
 * un bono agotado o anulado no debe poner ningún tipo de cita. Si no hay
 * ninguno —el caso normal— devuelve la lista vacía, que no es un error.
 *
 * Se busca por ficha Y por correo, como `bonosDeCliente`: el bono va atado al
 * correo, pero puede haberse dado desde la ficha con otro (el del portal).
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");

    const { SessionPack, Client } = tenantModels;
    // Un tenant sin la migración de bonos no tiene el modelo: no es un fallo,
    // simplemente no tiene bonos que enseñar.
    if (!SessionPack) return ok({ bonos: [] });

    const url = new URL(request.url);
    const clientId = url.searchParams.get("clientId") || null;
    const email = normalizeEmail(url.searchParams.get("email"));
    if (!clientId && !email) return error("Hace falta la ficha o el correo", 422);

    // `bonosDeCliente` espera una ficha, pero le vale cualquier objeto con
    // id/email/portalEmail: así se puede preguntar por un correo suelto (alguien
    // que llama por teléfono y todavía no tiene ficha).
    let quien = { id: clientId, email, portalEmail: null };
    if (clientId && Client) {
      const ficha = await Client.findByPk(clientId);
      if (!ficha) return error("Esa ficha no existe", 422);
      quien = { id: ficha.id, email: email || ficha.email, portalEmail: ficha.portalEmail };
    }

    const bonos = await bonosDeCliente(tenantModels, quien);
    return ok({ bonos: bonos.filter((b) => b.estado === "active" && b.restantes > 0) });
  } catch (err) {
    return serverError(err);
  }
});

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

/**
 * ¿Le consta este correo al CRM? (05/08/2026)
 *
 * El bono va atado al CORREO, que es como la identifica el portal. Si ese
 * correo no es el que ella usa en la web, el bono queda creado, se ve en su
 * ficha, y ella no ve absolutamente nada — un fallo mudo que solo aparece
 * cuando escribe diciendo que no le sale.
 *
 * El CRM no puede preguntarle a WordPress si ese correo tiene cuenta, así que
 * esto es lo más cerca que se puede estar: ¿hemos visto este correo alguna vez,
 * en una cita o en una solicitud? Si no, o es alguien nuevo —y entonces hay que
 * crearle la cuenta— o hay una letra cambiada.
 *
 * Es un AVISO, nunca un corte: dar de alta a alguien que llegó por Instagram y
 * no ha reservado nunca es un caso legítimo y frecuente.
 */
async function constaElCorreo(tenantModels, email) {
  const { Booking, FormSubmission } = tenantModels ?? {};
  const donde = { [Op.iLike]: String(email).trim() };

  try {
    if (Booking && (await Booking.count({ where: { clientEmail: donde } })) > 0) return true;
  } catch {
    // Sin tabla de citas: no se puede saber, y no se avisa por las dudas.
    return true;
  }
  try {
    if (FormSubmission && (await FormSubmission.count({ where: { email: donde } })) > 0) return true;
  } catch {
    // El tenant puede no tener el módulo de formularios: no es un error.
  }
  return false;
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
    if (!(await constaElCorreo(tenantModels, clientEmail))) {
      avisos.push(
        `A ${clientEmail} no le consta ninguna cita ni solicitud previa. Comprueba que es el correo con el que entra en la web: el bono va atado a ese correo, y si no coincide ella no verá nada. Si es nueva, créale la cuenta desde su ficha.`
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
