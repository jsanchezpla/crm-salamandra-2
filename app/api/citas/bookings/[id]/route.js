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
import { sendEmail } from "../../../../../lib/email/resendClient.js";
import { bookingMeetLinkTemplate } from "../../../../../lib/email/templates/citas/bookingMeetLink.js";
import { bookingCancelledTemplate } from "../../../../../lib/email/templates/citas/bookingCancelled.js";
import { getTenantResendConfig } from "../../../../../lib/outreach/resendConfig.js";
import { reembolsarCitaSiProcede } from "../../../../../lib/citas/reembolsoCita.js";

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
    await sendEmail({
      to: booking.clientEmail,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      // undefined → sendEmail cae a RESEND_FROM_EMAIL / RESEND_API_KEY globales
      from: resend.fromEmail || undefined,
      replyTo: resend.replyTo || undefined,
      apiKey: resend.apiKey || undefined,
    });
  } catch (mailErr) {
    process.stderr.write(`[citas:cancelled] email fail: ${mailErr.message}\n`);
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
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const { id } = await params;
    const { Booking } = tenantModels;
    const row = await Booking.findByPk(id, {
      include: bookingIncludes(tenantModels, hasModule),
    });
    if (!row) return notFound("Cita no encontrada");
    // Acceso por rol: un profesional no-admin solo puede ver SUS citas (misma
    // regla que el calendario). Se devuelve 404 (no 403) para no revelar que la
    // cita existe.
    if (hasModule("team")) {
      const userRole = request.headers.get("x-user-role") ?? "user";
      if (!ADMIN_ROLES.has(userRole)) {
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
      if (v !== row.status) statusChanged = true;
      updates.status = v;
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

    // Transición meetUrl null→valor en cita CONFIRMADA + ONLINE: AuditLog +
    // email al cliente. Se exige 'confirmed' + 'online' para casar con el gate
    // del portal (clientBookingSerializer sólo revela el enlace en ese caso) y
    // no avisar de un enlace en una cita pendiente/cancelada. Para citas que
    // aún esperan confirmación, el enlace se entrega al confirmar (el email de
    // /confirm ya incluye meetUrl).
    const meetLinkFilled =
      (before.meetUrl == null || before.meetUrl === "") &&
      row.meetUrl != null && row.meetUrl !== "" &&
      row.modality === "online" &&
      row.status === "confirmed";
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
      // Best-effort: un fallo de email NO rompe el guardado.
      try {
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
        await sendEmail({ to: row.clientEmail, subject: tpl.subject, html: tpl.html, text: tpl.text });
      } catch (mailErr) {
        process.stderr.write(`[citas:meet-link] email fail: ${mailErr.message}\n`);
      }
    }

    // Respuesta con eventType (para que el modal no pierda 'Servicio'/dirección)
    // y el profesional asignado (si el tenant tiene módulo team).
    await row.reload({ include: bookingIncludes(tenantModels, hasModule) });
    return ok(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// DELETE /api/citas/bookings/[id] — equivale a cancelar
// ───────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
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

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.booking_cancelled",
      entity: "Booking",
      entityId: row.id,
      before,
      after: { status: "cancelled", cancellationReason: reason ?? null },
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
