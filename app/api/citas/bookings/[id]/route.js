import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import { avisarCitaPorWhatsapp } from "../../../../../lib/citas/avisosWhatsapp.js";
import { citaPuedeAvisar } from "../../../../../lib/clients/comunicaciones.js";
import { notifyUsers } from "../../../../../lib/notifications/notifyUsers.js";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, noContent, serverError } from "../../../../../lib/utils/apiResponse.js";
import {
  normalizeString,
  normalizeEmail,
  isValidEmail,
  VALID_MODALITIES,
} from "../../../../../lib/citas/validation.js";
import { logCitasAudit } from "../../../../../lib/citas/audit.js";
import { findBookingOverlap } from "../../../../../lib/citas/booking.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";
import { veTodaLaAgenda } from "../../../../../lib/citas/visibilidad.js";
import { sendEmail, envioRealizado } from "../../../../../lib/email/resendClient.js";
import { bookingMeetLinkTemplate } from "../../../../../lib/email/templates/citas/bookingMeetLink.js";
import { bookingCancelledTemplate } from "../../../../../lib/email/templates/citas/bookingCancelled.js";
import { bookingRescheduledTemplate } from "../../../../../lib/email/templates/citas/bookingRescheduled.js";
import { getTenantResendConfig } from "../../../../../lib/outreach/resendConfig.js";
import { reembolsarCitaSiProcede } from "../../../../../lib/citas/reembolsoCita.js";
import { tieneRetencionPendiente } from "../../../../../lib/citas/cobroCita.js";

/**
 * Email de cancelación al paciente (2026-07-22). Hasta hoy el motivo se
 * guardaba en BD pero NO se avisaba al paciente — el módulo de citas es
 * anterior a la llegada de Resend y este correo nunca se escribió.
 *
 * Clave de envío como en Captación (BYOK): la Resend key del tenant
 * (Configuración → Correo, cifrada en reposo) si la tiene; si no, la global
 * del CRM (RESEND_API_KEY del entorno) — así los tenants sin clave propia no
 * se quedan mudos. Best-effort: un fallo de email JAMÁS rompe la cancelación.
 *
 * Solo se avisa de citas FUTURAS: cancelar un registro antiguo (limpieza de
 * historial) no debe mandarle a nadie un "tu cita ha sido cancelada".
 */
async function sendCancellationEmail({ tenant, tenantModels, booking, reason }) {
  try {
    if (!booking.clientEmail) return;
    if (new Date(booking.scheduledAt).getTime() <= Date.now()) return;

    const { EventType } = tenantModels;
    const et = await EventType.findByPk(booking.eventTypeId, { attributes: ["name"] });
    const tpl = bookingCancelledTemplate({
      tenantName: tenant.name,
      brand: tenant.settings?.brand,
      clientName: booking.clientName,
      eventTypeName: et?.name ?? "tu cita",
      scheduledAt: booking.scheduledAt,
      reason: reason ?? null,
    });
    const resend = getTenantResendConfig({ tenant });
    const envio = await sendEmail({
      to: booking.clientEmail,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      // undefined → sendEmail cae a RESEND_FROM_EMAIL / RESEND_API_KEY globales
      from: resend.fromEmail || undefined,
      replyTo: resend.replyTo || undefined,
      apiKey: resend.apiKey || undefined,
    });
    // Nadie ve esta respuesta, pero un aviso de cancelación que no sale tiene
    // que dejar rastro en el log en vez de perderse.
    envioRealizado(envio, `citas:cancelled ${booking.id}`);
  } catch (mailErr) {
    process.stderr.write(`[citas:cancelled] email fail: ${mailErr.message}\n`);
  }
}

/**
 * Aviso de que la cita se ha movido de día u hora.
 *
 * Mismas reglas que la cancelación: best-effort, solo con email, y solo hacia
 * el FUTURO. Aquí «futuro» se mira sobre la fecha NUEVA: mover una cita vieja a
 * la semana que viene sí hay que contarlo, y mover una futura al pasado
 * (corregir un dato del histórico) no.
 *
 * Respeta además lo que la familia haya dicho sobre recibir correos, igual que
 * el aviso del enlace de videollamada.
 */
async function sendRescheduledEmail({ tenant, tenantModels, booking, scheduledAtAnterior, reason }) {
  try {
    if (!booking.clientEmail) return;
    if (new Date(booking.scheduledAt).getTime() <= Date.now()) return;
    if (!(await citaPuedeAvisar(tenantModels, booking, "citasEmail"))) {
      process.stdout.write(`[citas:reprogramada] ${booking.id}: la familia no quiere avisos por email\n`);
      return;
    }

    const { EventType } = tenantModels;
    const et = await EventType.findByPk(booking.eventTypeId, { attributes: ["name"] });
    const tpl = bookingRescheduledTemplate({
      tenantName: tenant.name,
      brand: tenant.settings?.brand,
      clientName: booking.clientName,
      eventTypeName: et?.name ?? "tu cita",
      scheduledAtAnterior,
      scheduledAt: booking.scheduledAt,
      reason: reason ?? null,
    });
    const resend = getTenantResendConfig({ tenant });
    const envio = await sendEmail({
      to: booking.clientEmail,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      from: resend.fromEmail || undefined,
      replyTo: resend.replyTo || undefined,
      apiKey: resend.apiKey || undefined,
    });
    envioRealizado(envio, `citas:reprogramada ${booking.id}`);
  } catch (mailErr) {
    process.stderr.write(`[citas:reprogramada] email fail: ${mailErr.message}\n`);
  }
}

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const VALID_STATUS = new Set(["pending", "confirmed", "completed", "cancelled", "no_show"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const normId = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const isHttpUrl = (u) => /^https?:\/\/.+/i.test(String(u).trim());

// Includes del booking. `teamMember` SOLO si el tenant tiene el módulo team:
// en tenants de schema parcial (p.ej. nutri_laura) la tabla team_members no
// existe, e incluirla haría un JOIN a una relación inexistente → 500. Ídem
// `patient`: sólo con módulo Clínica/Pacientes (nutri_laura no tiene patients).
function bookingIncludes({ EventType, TeamMember, Patient }, hasModule) {
  const inc = [{ model: EventType, as: "eventType" }];
  if (hasModule("team")) inc.push({ model: TeamMember, as: "teamMember", attributes: ["id", "displayName"] });
  if ((hasModule("clinica") || hasModule("pacientes")) && Patient) {
    inc.push({ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"] });
  }
  return inc;
}

// ───────────────────────────────────────────────────────────────────────────
// GET /api/citas/bookings/[id]
// ───────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const { id } = await params;
    const { Booking } = tenantModels;
    const row = await Booking.findByPk(id, {
      include: bookingIncludes(tenantModels, hasModule),
    });
    if (!row) return notFound("Cita no encontrada");
    // Acceso: un profesional no-admin solo ve SUS citas, salvo que el tenant
    // comparta agenda. Tiene que ser la MISMA regla que el listado y el
    // calendario (lib/citas/visibilidad.js): ver la cita en el calendario y
    // que al abrirla dijera "no encontrada" parecía un fallo del CRM.
    // Se devuelve 404 (no 403) para no revelar que la cita existe.
    if (hasModule("team")) {
      const userRole = request.headers.get("x-user-role") ?? "user";
      if (!veTodaLaAgenda({ tenant, role: userRole })) {
        const myId = await resolveCurrentTeamMemberId(request, tenantModels);
        if (!myId || row.teamMemberId !== myId) return notFound("Cita no encontrada");
      }
    }
    return ok(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// PATCH /api/citas/bookings/[id]
// ───────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    const { tenant, tenantModels, hasModule } = ctx;
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede editar citas");

    const { id } = await params;
    const { Booking, EventType, TeamMember } = tenantModels;
    const row = await Booking.findByPk(id);
    if (!row) return notFound("Cita no encontrada");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const before = row.toJSON();
    const updates = {};

    if ("clientName" in body) {
      const v = normalizeString(body.clientName);
      if (!v) return error("clientName no puede ser vacío");
      updates.clientName = v;
    }
    if ("clientEmail" in body) {
      const v = normalizeEmail(body.clientEmail);
      if (!v || !isValidEmail(v)) return error("clientEmail inválido");
      updates.clientEmail = v;
    }
    if ("clientPhone" in body) {
      const v = normalizeString(body.clientPhone);
      if (!v) return error("clientPhone no puede ser vacío");
      updates.clientPhone = v;
    }
    if ("additionalData" in body) {
      updates.additionalData = body.additionalData != null ? String(body.additionalData) : null;
    }
    if ("notes" in body) {
      updates.notes = body.notes != null ? String(body.notes) : null;
    }

    // Profesional (team member) asignado — SOLO si el tenant tiene módulo team
    // (sin él no existe team_members y no se puede asignar). Valida existencia
    // para devolver 400 en vez de un 500 por violación de FK / uuid inválido.
    if (hasModule("team") && "teamMemberId" in body) {
      const tmId = normId(body.teamMemberId);
      if (tmId) {
        if (!UUID_RE.test(tmId)) return error("teamMemberId inválido");
        const tm = await TeamMember.findByPk(tmId, { attributes: ["id"] });
        if (!tm) return error("teamMemberId no existe");
      }
      updates.teamMemberId = tmId;
    }

    // Paciente asignado — SOLO con módulo Clínica/Pacientes. null desasigna.
    if ((hasModule("clinica") || hasModule("pacientes")) && "patientId" in body) {
      const pid = normId(body.patientId);
      if (pid) {
        if (!UUID_RE.test(pid)) return error("patientId inválido");
        const { Patient } = tenantModels;
        if (Patient) {
          const p = await Patient.findByPk(pid, { attributes: ["id"] });
          if (!p) return error("patientId no existe");
        }
      }
      updates.patientId = pid;
    }

    // meetUrl EDITABLE a mano. "" o null → null; si viene valor, valida http(s).
    // Un valor manual SIEMPRE gana sobre el auto-snapshot del EventType.
    const meetUrlInBody = "meetUrl" in body;
    if (meetUrlInBody) {
      const raw = body.meetUrl;
      if (raw == null || String(raw).trim() === "") {
        updates.meetUrl = null;
      } else if (!isHttpUrl(raw)) {
        return error("meetUrl debe ser una URL http(s) válida");
      } else {
        updates.meetUrl = String(raw).trim();
      }
    }

    let modalityFinal = row.modality;
    if ("modality" in body) {
      const v = String(body.modality || "").toLowerCase();
      if (!VALID_MODALITIES.includes(v)) return error("modality inválida");
      const eventType = await EventType.findByPk(row.eventTypeId);
      if (eventType && !eventType.modalities.includes(v)) {
        return error(`modality '${v}' no está permitida para este tipo de cita`);
      }
      updates.modality = v;
      modalityFinal = v;
      // Derivar meetUrl SOLO si el usuario no lo envió manualmente en esta
      // petición (no pisar un enlace puesto a mano):
      //   - no-online → se limpia (un enlace Meet no aplica).
      //   - online sin enlace previo → snapshot del EventType.
      //   - online con enlace ya existente → se conserva.
      if (!meetUrlInBody) {
        if (v !== "online") updates.meetUrl = null;
        else if (!row.meetUrl && eventType) updates.meetUrl = eventType.meetUrl;
      }
    }

    if ("scheduledAt" in body) {
      const v = new Date(body.scheduledAt);
      if (Number.isNaN(v.getTime())) return error("scheduledAt inválido");
      updates.scheduledAt = v;
    }

    // Cambio de status
    let statusChanged = false;
    let oldStatus = row.status;
    if ("status" in body) {
      const v = body.status;
      if (!VALID_STATUS.has(v)) return error("status inválido");
      // Bloqueo de regresión a 'pending': una cita confirmada/cancelada/
      // completada/no_show NUNCA puede volver a la lista de espera —
      // confundiría al paciente y dispararía emails contradictorios. La
      // creación con status='pending' va por el endpoint público /book
      // según el feature flag; el admin no debería forzar regresiones
      // desde aquí.
      if (v === "pending" && row.status !== "pending") {
        return forbidden(
          "Una cita no puede volver al estado pendiente una vez confirmada o procesada."
        );
      }
      // ── El dinero solo se mueve por UN sitio ────────────────────────────
      // Dar por buena una cita con dinero retenido desde aquí la atendía sin
      // cobrarlo: quedaba 'completed' con el importe todavía bloqueado en la
      // tarjeta del paciente, que caducaba solo días después. La profesional
      // cerraba el día creyendo que había cobrado. Este endpoint no captura —
      // captura `/confirm`— así que se remite allí en vez de avanzar el estado
      // por detrás. Cancelar y no_show sí siguen aquí: esos ya liquidan.
      if ((v === "confirmed" || v === "completed") && tieneRetencionPendiente(row)) {
        return error(
          "Esta cita tiene dinero reservado en la tarjeta del paciente. Confírmala desde la lista de espera para cobrarlo.",
          409,
          { code: "COBRO_PENDIENTE" }
        );
      }

      if (v !== row.status) statusChanged = true;
      updates.status = v;
      // Falta JUSTIFICADA o no (sprint Aumenta 2026-07, punto 6.1). No es lo
      // mismo un niño con fiebre que una familia que no aparece sin avisar: lo
      // segundo es lo que el centro necesita ver acumulado.
      if (v === "no_show") {
        updates.noShowJustified = body.noShowJustified === true;
        updates.noShowReason =
          typeof body.noShowReason === "string" && body.noShowReason.trim()
            ? body.noShowReason.trim().slice(0, 500)
            : null;
      } else if (row.status === "no_show") {
        // Deja de ser falta: se limpia, o quedaría un motivo suelto mintiendo.
        updates.noShowJustified = false;
        updates.noShowReason = null;
      }
      if (v === "cancelled") {
        updates.cancelledAt = updates.cancelledAt ?? new Date();
        if ("cancellationReason" in body) {
          updates.cancellationReason = body.cancellationReason != null ? String(body.cancellationReason) : null;
        }
      } else {
        // si vuelve a confirmar/completar limpia cancellation
        if (row.cancelledAt) updates.cancelledAt = null;
        if (row.cancellationReason) updates.cancellationReason = null;
      }
    } else if ("cancellationReason" in body) {
      updates.cancellationReason = body.cancellationReason != null ? String(body.cancellationReason) : null;
    }

    // Validar solapamiento. Antes solo se comprobaba al cambiar la hora; eso
    // dejaba pasar dos casos que también pueden crear un solape real del MISMO
    // profesional: (a) reasignar la cita a otro profesional que ya tiene esa
    // hora ocupada, y (b) confirmar/reactivar por PATCH una cita que solapa.
    const scheduledFinal = updates.scheduledAt ?? row.scheduledAt;
    const statusFinal = updates.status ?? row.status;
    const teamMemberFinal = "teamMemberId" in updates ? updates.teamMemberId : row.teamMemberId;
    const cambiaHora = "scheduledAt" in updates;
    const cambiaProfesional = "teamMemberId" in updates && updates.teamMemberId !== row.teamMemberId;
    const seReactiva =
      "status" in updates &&
      (row.status === "cancelled" || row.status === "no_show" || row.status === "pending");
    if (statusFinal !== "cancelled" && statusFinal !== "no_show" && (cambiaHora || cambiaProfesional || seReactiva)) {
      const overlap = await findBookingOverlap(Booking, {
        scheduledAt: scheduledFinal,
        duration: row.duration,
        excludeId: row.id,
        teamMemberId: teamMemberFinal,
      });
      if (overlap) {
        return error(`Solapa con otra cita activa el ${overlap.scheduledAt.toISOString?.() ?? overlap.scheduledAt}`, 409);
      }
    }

    await row.update(updates);
    await row.reload();

    // Cancelar desde el panel es cancelar el profesional: si la cita estaba
    // cobrada, el dinero vuelve íntegro. Un 'no_show' NO devuelve nada (el
    // paciente no se presentó), y por eso se distinguen los dos casos.
    let reembolso = null;
    if (statusChanged && (updates.status === "cancelled" || updates.status === "no_show")) {
      reembolso = await reembolsarCitaSiProcede(ctx, row, {
        quienCancela: updates.status === "no_show" ? "no_show" : "profesional",
      });
      if (reembolso.reembolsado) await row.reload();
    }

    // Aviso a administración de una falta NO justificada (punto 6.1). La lista
    // de destinatarios es configurable por cliente (`settings.citas.avisoFaltas`,
    // ids de usuario): nunca una persona a fuego, que se va de vacaciones o se
    // va del centro y los avisos se pierden.
    if (statusChanged && updates.status === "no_show" && !row.noShowJustified) {
      let destinatarios = Array.isArray(tenant.settings?.citas?.avisoFaltas)
        ? tenant.settings.citas.avisoFaltas.filter(Boolean)
        : [];
      if (destinatarios.length === 0) {
        // Sin lista configurada, avisa a la ADMINISTRACIÓN del cliente (rol
        // admin). Por rol y no por persona: quien se va de vacaciones o se va
        // del centro no puede llevarse los avisos con él.
        try {
          const { User } = getMasterModels();
          const admins = await User.findAll({
            where: { tenantId: tenant.id, role: "admin" },
            attributes: ["id"],
          });
          destinatarios = admins.map((u) => u.id);
        } catch {
          destinatarios = [];
        }
      }
      if (destinatarios.length) {
        const cuando = new Date(row.scheduledAt).toLocaleString("es-ES", {
          timeZone: "Europe/Madrid", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
        });
        await notifyUsers({
          tenantModels,
          userIds: destinatarios,
          type: "cita_falta",
          title: "Falta sin justificar",
          body: `${row.clientName || "Un paciente"} no acudió a su cita del ${cuando}.`,
          entityType: "Booking",
          entityId: row.id,
          dedupe: true,
        });
      }
    }

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.booking_updated",
      entity: "Booking",
      entityId: row.id,
      before,
      after: { ...row.toJSON(), ...(reembolso ? { reembolso } : {}) },
      ip,
    });

    if (statusChanged) {
      await logCitasAudit({
        tenantId: tenant.id,
        userId,
        action: "citas.booking_status_changed",
        entity: "Booking",
        entityId: row.id,
        before: { status: oldStatus },
        after: { status: row.status, cancellationReason: row.cancellationReason ?? null },
        ip,
      });

      // Cancelación → avisar al paciente con el motivo (best-effort).
      if (row.status === "cancelled") {
        await sendCancellationEmail({
          tenant,
          tenantModels,
          booking: row,
          reason: row.cancellationReason,
        });
      }
    }

    // Cambio de fecha/hora → avisar al paciente (03/08/2026).
    //
    // Antes no salía NADA: la cita cambiaba de día en el portal en silencio y el
    // paciente solo se enteraba si entraba a mirar. La gente se presenta el día
    // que le dijeron, no el que pone en una pantalla que no ha abierto.
    //
    // Solo si sigue en pie y no se ha cancelado en la misma llamada: una cita
    // cancelada ya manda su propio correo, y dos avisos contradictorios son
    // peor que ninguno.
    if (cambiaHora && row.status !== "cancelled" && row.status !== "no_show") {
      await sendRescheduledEmail({
        tenant,
        tenantModels,
        booking: row,
        scheduledAtAnterior: before.scheduledAt,
        reason: typeof body.motivoCambio === "string" ? body.motivoCambio.trim() || null : null,
      });
    }

    // Transición meetUrl null→valor en cita CONFIRMADA + ONLINE: AuditLog +
    // email al cliente. Se exige 'confirmed' + 'online' para casar con el gate
    // del portal (clientBookingSerializer sólo revela el enlace en ese caso) y
    // no avisar de un enlace en una cita pendiente/cancelada. Para citas que
    // aún esperan confirmación, el enlace se entrega al confirmar (el email de
    // /confirm ya incluye meetUrl).
    // El botón "Guardar y enviar" del panel manda `enviarEmail: true`: con eso
    // se reenvía SIEMPRE (aunque el enlace ya estuviera puesto o se corrija),
    // que es justo lo que antes era imposible — el envío solo ocurría en la
    // transición null→valor y no había forma de reenviar desde la UI.
    const envioForzado = body.enviarEmail === true;
    const hayEnlace = row.meetUrl != null && row.meetUrl !== "";
    const meetLinkFilled =
      hayEnlace &&
      row.modality === "online" &&
      (envioForzado
        ? row.status !== "cancelled" // reenviar sí, pero no de una cita anulada
        : (before.meetUrl == null || before.meetUrl === "") && row.status === "confirmed");
    let emailEnviado = false;
    // Por qué no salió, para que la pantalla no invente la causa:
    // "sin_configurar" | "sin_consentimiento" | "error" | null
    let emailMotivo = null;
    let whatsappEnviado = false;
    let whatsappMotivo = null;
    if (meetLinkFilled) {
      await logCitasAudit({
        tenantId: tenant.id,
        userId,
        action: "appointment.meet_link_set",
        entity: "Booking",
        entityId: row.id,
        before: { meetUrl: before.meetUrl ?? null },
        after: { meetUrl: row.meetUrl },
        ip,
      });
      // Best-effort: un fallo de email NO rompe el guardado. Y solo si la
      // familia quiere avisos por correo.
      try {
        if (!(await citaPuedeAvisar(tenantModels, row, "citasEmail"))) throw new Error("SIN_CONSENTIMIENTO_EMAIL");
        const et = await EventType.findByPk(row.eventTypeId, { attributes: ["name"] });
        const tpl = bookingMeetLinkTemplate({
          tenantName: tenant.name,
          brand: tenant.settings?.brand,
          clientName: row.clientName,
          eventTypeName: et?.name ?? "tu cita",
          scheduledAt: row.scheduledAt,
          duration: row.duration,
          meetUrl: row.meetUrl,
        });
        // Con las credenciales del tenant, como el resto de emails de citas
        // (antes este envío concreto usaba siempre las globales del CRM).
        const resendCfg = getTenantResendConfig({ tenant });
        const envio = await sendEmail({
          to: row.clientEmail,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
          from: resendCfg.fromEmail || undefined,
          replyTo: resendCfg.replyTo || undefined,
          apiKey: resendCfg.apiKey || undefined,
        });
        // Sin esto el panel decía "enviado" también cuando no había clave de
        // correo y el envío se quedaba en simulacro: Laura pegaba el enlace,
        // leía "✓ enviado" y el paciente no recibía nada.
        const { salio, motivo } = envioRealizado(envio, `citas:meet-link ${row.id}`);
        emailEnviado = salio;
        if (!salio) emailMotivo = motivo;
      } catch (mailErr) {
        if (mailErr.message === "SIN_CONSENTIMIENTO_EMAIL") {
          emailMotivo = "sin_consentimiento";
          process.stdout.write(`[citas:meet-link] ${row.id}: sin correo, la familia no quiere avisos por email\n`);
        } else {
          emailMotivo = "error";
          process.stderr.write(`[citas:meet-link] email fail: ${mailErr.message}\n`);
        }
      }

      // El mismo aviso por WhatsApp, si el cliente lo tiene encendido y la
      // familia no lo ha denegado. El correo sigue siendo el canal principal:
      // esto se suma, no lo sustituye.
      const etWa = await EventType.findByPk(row.eventTypeId, { attributes: ["name"] }).catch(() => null);
      const wa = await avisarCitaPorWhatsapp(ctx, { booking: row, tipo: "enlace", eventTypeName: etWa?.name });
      whatsappEnviado = wa.ok;
      whatsappMotivo = wa.ok ? null : wa.motivo;
    }

    // Respuesta con eventType (para que el modal no pierda 'Servicio'/dirección)
    // y el profesional asignado (si el tenant tiene módulo team).
    await row.reload({ include: bookingIncludes(tenantModels, hasModule) });
    // `emailEnviado` permite que el panel confirme "enviado" en vez de callar,
    // y `emailMotivo` que diga POR QUÉ no salió cuando no salió.
    return ok({ ...row.toJSON(), emailEnviado, emailMotivo, whatsappEnviado, whatsappMotivo });
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// DELETE /api/citas/bookings/[id] — equivale a cancelar
// ───────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, { params }, ctx) => {
  try {
    const { tenant, tenantModels, hasModule } = ctx;
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede cancelar citas");

    const { id } = await params;
    const { Booking } = tenantModels;
    const row = await Booking.findByPk(id);
    if (!row) return notFound("Cita no encontrada");

    // Permitir pasar ?reason=... en query string para registrar el motivo
    const { searchParams } = new URL(request.url);
    const reason = normalizeString(searchParams.get("reason"));

    if (row.status === "cancelled") return noContent();

    const before = row.toJSON();
    await row.update({
      status: "cancelled",
      cancelledAt: new Date(),
      cancellationReason: reason ?? row.cancellationReason ?? null,
    });

    // ── El dinero ────────────────────────────────────────────────────────────
    // Esta vía era la ÚNICA de las cinco que no liquidaba nada: cancelaba la
    // cita, la auditaba y avisaba al paciente, pero su dinero se quedaba donde
    // estuviera. Con cobro ya hecho eso era quedarse con el importe de una cita
    // que no se va a dar; con tarjeta retenida, dejarle el dinero bloqueado sin
    // que nadie lo suelte.
    //
    // Cancelar desde el panel es cancelar la profesional, así que devuelve
    // íntegro (o suelta la retención, según lo que hubiera).
    const dinero = await reembolsarCitaSiProcede(ctx, row, { quienCancela: "profesional" });
    await row.reload();

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.booking_cancelled",
      entity: "Booking",
      entityId: row.id,
      before,
      after: { status: "cancelled", cancellationReason: reason ?? null, dinero },
      ip,
    });

    // Avisar al paciente con el motivo (best-effort, solo citas futuras).
    await sendCancellationEmail({
      tenant,
      tenantModels,
      booking: row,
      reason: reason ?? row.cancellationReason ?? null,
    });

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
