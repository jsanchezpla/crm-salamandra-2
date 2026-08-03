import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { sendEmail, envioRealizado } from "../../../../lib/email/resendClient.js";
import { avisoClienteTemplate } from "../../../../lib/email/templates/citas/avisoCliente.js";
import { getTenantResendConfig } from "../../../../lib/outreach/resendConfig.js";
import { normalizeEmail, isValidEmail, normalizeString } from "../../../../lib/citas/validation.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { citaPuedeAvisar } from "../../../../lib/clients/comunicaciones.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { assertNotDemoMasterWrite } from "../../../../lib/demo/isDemo.js";

/**
 * Avisos del centro a un cliente.
 *
 * El CRM sabía avisar de lo que le pasa a UNA CITA (confirmada, cancelada,
 * movida, enlace de videollamada), pero no había forma de decir nada más. Para
 * «cierro en agosto» o «tráete los análisis» había que salirse a escribir desde
 * el correo personal, y ese mensaje dejaba de existir para el sistema.
 *
 * Un aviso hace DOS cosas: sale por correo y queda publicado en el portal del
 * cliente. Y se guarda aunque el correo no salga —lo dice `emailStatus`—,
 * porque el aviso sigue valiendo: el portal es donde se puede volver a mirar en
 * enero, cuando el correo ya está enterrado.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const MAX_TITULO = 160;
const MAX_CUERPO = 4000;

/**
 * GET /api/citas/avisos?email=…&clientId=…
 *
 * Historial, para poder ver qué se le ha dicho a alguien y si lo ha leído.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const { ClientNotice, TeamMember } = tenantModels;
    const { searchParams } = new URL(request.url);

    const email = normalizeEmail(searchParams.get("email") ?? "");
    const clientId = normalizeString(searchParams.get("clientId"));
    if (!email && !clientId) return error("Dime de quién quieres ver los avisos", 422);

    const where = email ? { clientEmail: { [Op.iLike]: email } } : { clientId };
    const filas = await ClientNotice.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200),
      include: TeamMember
        ? [{ model: TeamMember, as: "autor", attributes: ["id", "firstName", "lastName"], required: false }]
        : [],
    });

    return ok({
      avisos: filas.map((a) => {
        const j = a.toJSON();
        return {
          id: j.id,
          titulo: j.title,
          cuerpo: j.body,
          creado: j.createdAt,
          leido: j.readAt,
          correo: j.emailStatus,
          bookingId: j.bookingId,
          autor: j.autor ? `${j.autor.firstName} ${j.autor.lastName}`.trim() : null,
        };
      }),
    });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * POST /api/citas/avisos
 *
 * Body: { email, clientId?, bookingId?, titulo, cuerpo }
 */
export const POST = withTenant(async (request, _ctx, ctx) => {
  try {
    const { tenant, tenantModels, hasModule } = ctx;
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");

    const rol = request.headers.get("x-user-role") ?? "user";
    if (!ADMIN_ROLES.has(rol)) return forbidden("Solo un administrador puede mandar avisos");

    // La demo da sesión de admin a cualquiera que entre por el enlace: sin este
    // guard, un visitante anónimo usaría el CRM para mandar correos.
    assertNotDemoMasterWrite(ctx, "mandar avisos a clientes");

    const { ClientNotice, Booking } = tenantModels;
    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const email = normalizeEmail(body.email);
    if (!email || !isValidEmail(email)) return error("Falta el correo de la persona a la que avisar", 422);

    const titulo = normalizeString(body.titulo);
    if (!titulo) return error("El aviso necesita un asunto", 422);
    if (titulo.length > MAX_TITULO) return error(`El asunto no puede pasar de ${MAX_TITULO} caracteres`, 422);

    const cuerpo = typeof body.cuerpo === "string" ? body.cuerpo.trim() : "";
    if (!cuerpo) return error("El aviso está vacío", 422);
    if (cuerpo.length > MAX_CUERPO) return error(`El aviso no puede pasar de ${MAX_CUERPO} caracteres`, 422);

    // Si viene de una cita, se comprueba que sea de este tenant y de esta
    // persona: colgar el aviso de la cita de otro lo enseñaría en su portal.
    let bookingId = normalizeString(body.bookingId);
    if (bookingId) {
      const cita = await Booking.findByPk(bookingId, { attributes: ["id", "clientEmail"] });
      if (!cita) return error("Esa cita no existe", 404);
      if (normalizeEmail(cita.clientEmail ?? "") !== email) {
        return error("Esa cita no es de la persona a la que estás avisando", 422);
      }
    }

    const createdByTeamId = await resolveCurrentTeamMemberId(request, tenantModels);

    // ── El correo ─────────────────────────────────────────────────────────
    // Se manda ANTES de guardar para poder registrar qué pasó con él, pero un
    // fallo NO impide guardar: el aviso vale igual porque queda en el portal.
    let emailStatus = "error";
    try {
      const puede = await citaPuedeAvisar(tenantModels, { clientEmail: email }, "citasEmail");
      if (!puede) {
        emailStatus = "sin_consentimiento";
      } else {
        const resend = getTenantResendConfig({ tenant });
        const tpl = avisoClienteTemplate({
          tenantName: tenant.name,
          brand: tenant.settings?.brand,
          clientName: normalizeString(body.nombre),
          title: titulo,
          body: cuerpo,
          portalUrl: tenant.settings?.widget?.auth?.loginUrl ?? null,
        });
        const envio = await sendEmail({
          to: email,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
          from: resend.fromEmail || undefined,
          replyTo: resend.replyTo || undefined,
          apiKey: resend.apiKey || undefined,
        });
        // Una sola llamada: `envioRealizado` escribe en el log, y llamarlo dos
        // veces duplicaría la línea de "no enviado".
        const { salio, motivo } = envioRealizado(envio, `citas:aviso ${email}`);
        emailStatus = salio ? "enviado" : motivo;
      }
    } catch (mailErr) {
      process.stderr.write(`[citas:aviso] email fail: ${mailErr.message}\n`);
      emailStatus = "error";
    }

    const aviso = await ClientNotice.create({
      clientEmail: email,
      clientId: normalizeString(body.clientId),
      bookingId,
      title: titulo,
      body: cuerpo,
      createdByTeamId,
      emailStatus,
    });

    // Auditoría FUERA de transacción y con RESUMEN, no el texto: lo que se le
    // escribe a un paciente puede llevar datos de salud y master.audit_log lo
    // comparten todos los clientes.
    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "citas.aviso_enviado",
      entity: "ClientNotice",
      entityId: aviso.id,
      after: { titulo, correo: emailStatus, bookingId: bookingId ?? null },
    });

    return created({
      id: aviso.id,
      correo: emailStatus,
      // El panel lo usa para decir si además del portal le ha llegado al buzón.
      enviadoPorCorreo: emailStatus === "enviado",
    });
  } catch (err) {
    return serverError(err);
  }
});
