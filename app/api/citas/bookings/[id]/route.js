import { Op } from "sequelize";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import { avisarCitaPorWhatsapp } from "../../../../../lib/citas/avisosWhatsapp.js";
import { citaPuedeAvisar } from "../../../../../lib/clients/comunicaciones.js";
import { notifyUsers } from "../../../../../lib/notifications/notifyUsers.js";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, noContent, serverError } from "../../../../../lib/utils/apiResponse.js";
import { citaSegunRol } from "../../../../../lib/citas/dinero.js";
import {
  normalizeString,
  normalizeEmail,
  isValidEmail,
  VALID_MODALITIES,
} from "../../../../../lib/citas/validation.js";
import { logCitasAudit } from "../../../../../lib/citas/audit.js";
import { findBookingOverlap } from "../../../../../lib/citas/booking.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";
import { veTodaLaAgenda, esSuya } from "../../../../../lib/citas/visibilidad.js";
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
    const { salio, motivo } = envioRealizado(envio, `citas:reprogramada ${booking.id}`);
    return { enviado: salio, motivo: salio ? null : motivo };
  } catch (mailErr) {
    process.stderr.write(`[citas:reprogramada] email fail: ${mailErr.message}\n`);
  }
}

const VALID_STATUS = new Set(["pending", "confirmed", "completed", "cancelled", "no_show"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const normId = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const isHttpUrl = (u) => /^https?:\/\/.+/i.test(String(u).trim());

// Includes del booking. `teamMember` SOLO si el tenant tiene el módulo team:
// en tenants de schema parcial (p.ej. nutri_laura) la tabla team_members no
// existe, e incluirla haría un JOIN a una relación inexistente → 500. Ídem
// `patient`: sólo con módulo Clínica/Pacientes (nutri_laura no tiene patients).
function bookingIncludes({ EventType, TeamMember, Patient }, tieneModuloElTenant) {
  const inc = [{ model: EventType, as: "eventType" }];
  if (tieneModuloElTenant("team")) inc.push({ model: TeamMember, as: "teamMember", attributes: ["id", "displayName"] });
  if ((tieneModuloElTenant("clinica") || tieneModuloElTenant("pacientes")) && Patient) {
    inc.push({ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"] });
  }
  // ⚠️ El BONO no se incluye a propósito. El total de sesiones ya viaja en
  // `eventType.sessionsCount`, y un JOIN a `session_packs` reventaría con un
  // 500 al abrir CUALQUIER cita en un cliente que aún no haya corrido la
  // migración del 04/08 — el mismo motivo por el que `patient` y `teamMember`
  // van condicionados aquí arriba.
  return inc;
}

// ───────────────────────────────────────────────────────────────────────────
// GET /api/citas/bookings/[id]
// ───────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, { params }, { tenant, tenantModels, hasModule, tenantHasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const { id } = await params;
    const { Booking } = tenantModels;
    const row = await Booking.findByPk(id, {
      include: bookingIncludes(tenantModels, tenantHasModule),
    });
    if (!row) return notFound("Cita no encontrada");
    // Acceso: un profesional no-admin solo ve SUS citas, salvo que el tenant
    // comparta agenda. Tiene que ser la MISMA regla que el listado y el
    // calendario (lib/citas/visibilidad.js): ver la cita en el calendario y
    // que al abrirla dijera "no encontrada" parecía un fallo del CRM.
    // Se devuelve 404 (no 403) para no revelar que la cita existe.
    // ⚠️ `tenantHasModule` y NO `hasModule`: la pregunta es si el CENTRO tiene
    // equipo, no si quien mira puede entrar en la pantalla de Equipo. El porqué,
    // en lib/citas/visibilidad.js — con `hasModule` esto NO se ejecutaba.
    if (tenantHasModule("team")) {
      const userRole = request.headers.get("x-user-role") ?? "user";
      if (!veTodaLaAgenda({ tenant, role: userRole })) {
        const myId = await resolveCurrentTeamMemberId(request, tenantModels);
        if (!esSuya(row, myId)) return notFound("Cita no encontrada");
      }
    }
    // Fuga doble si no se filtra: el importe de la cita Y la tarifa completa del
    // tipo, que viaja anidada en `eventType` (el include no restringe atributos).
    const rolQuienMira = request.headers.get("x-user-role");
    return ok(citaSegunRol(row.toJSON(), rolQuienMira));
  } catch (err) {
    return serverError(err);
  }
});


/**
 * ¿Puede esta persona TOCAR esta cita? (07/08/2026, Rodrigo)
 *
 * «En la card de cada cita solo el admin puede poner como completada, no
 * asistió, etc. Y no le deja mover citas. Cualquier persona puede mover o
 * administrar las citas según convenga.»
 *
 * Editar y cancelar exigían admin, y eso dejaba a la profesional sin poder
 * cerrar sus propias sesiones: marcar «vino» o «no vino» y mover una hora es
 * literalmente su trabajo del día, no una decisión de dirección.
 *
 * No se abre a lo bruto: se aplica la MISMA regla que ya usaba el GET de aquí
 * al lado (`lib/citas/visibilidad.js`). Quien ve toda la agenda —admin, o
 * cualquiera si el centro la comparte— toca cualquier cita; quien no, solo las
 * suyas. Así un centro que deliberadamente NO comparte agenda no se encuentra
 * con que su equipo puede moverse las citas entre sí, y donde sí se comparte
 * —nutri_laura y aumenta hoy— todo el mundo puede con todas, que es lo pedido.
 *
 * Devuelve un 404 (no un 403) por lo mismo que el GET: no revelar que existe.
 */
async function noPuedeTocarla(request, ctx, row) {
  const { tenant, tenantModels, tenantHasModule } = ctx;
  // ⚠️ `tenantHasModule` y NO `hasModule`: la pregunta es si el CENTRO tiene
  // equipo, no si quien mira puede entrar en la pantalla de Equipo. El porqué,
  // en lib/citas/visibilidad.js — con `hasModule` esto NO se ejecutaba.
  if (!tenantHasModule("team")) return null;
  const role = request.headers.get("x-user-role") ?? "user";
  if (veTodaLaAgenda({ tenant, role })) return null;
  const myId = await resolveCurrentTeamMemberId(request, tenantModels);
  if (!esSuya(row, myId)) return notFound("Cita no encontrada");
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// PATCH /api/citas/bookings/[id]
// ───────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    const { tenant, tenantModels, hasModule, tenantHasModule } = ctx;
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    const { id } = await params;
    const { Booking, EventType, TeamMember } = tenantModels;
    const row = await Booking.findByPk(id);
    if (!row) return notFound("Cita no encontrada");
    // Editar y mover: ver `noPuedeTocarla` justo arriba.
    const veto = await noPuedeTocarla(request, ctx, row);
    if (veto) return veto;

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
    if (tenantHasModule("team") && "teamMemberId" in body) {
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
    /*
     * Qué pasó con el aviso, para DECÍRSELO a quien movió la cita (07/08/2026,
     * Rodrigo). Antes se mandaba y nadie sabía si había salido: el mismo agujero
     * que ya nos comimos con el enlace de videollamada, donde la pantalla ponía
     * «enviado» sin clave de correo y el paciente no recibía nada.
     *
     * `null` = no se ha tocado la hora, así que no hay nada que contar.
     */
    let avisoCambioHora = null;
    if (cambiaHora && row.status !== "cancelled" && row.status !== "no_show") {
      avisoCambioHora = await sendRescheduledEmail({
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
    await row.reload({ include: bookingIncludes(tenantModels, tenantHasModule) });
    // `emailEnviado` permite que el panel confirme "enviado" en vez de callar,
    // y `emailMotivo` que diga POR QUÉ no salió cuando no salió.
    return ok({ ...row.toJSON(), emailEnviado, emailMotivo, whatsappEnviado, whatsappMotivo, avisoCambioHora });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * Estados de cobro en los que hay DINERO de verdad de por medio.
 *
 * `authorized` es una retención viva en la tarjeta de alguien, `paid` un
 * ingreso y `refunded` una devolución ya hecha: los tres son registros
 * contables. Los demás (`pending`, `authorizing`, `failed`, `expired`, `void`)
 * son intentos que no movieron nada y se pueden tirar con la cita.
 */
const COBROS_CON_DINERO = {
  paid: "está cobrada",
  authorized: "tiene una retención en la tarjeta",
  refunded: "tiene una devolución registrada",
};

/**
 * 42P01 = esa tabla no existe en este schema. Pasa de verdad en tenants con
 * schema parcial (ver `bookingIncludes` aquí arriba), y no puede impedir borrar
 * una cita.
 */
const esTablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

async function borrarSiExiste(modelo, where) {
  if (!modelo) return 0;
  try {
    return await modelo.destroy({ where });
  } catch (err) {
    if (esTablaAusente(err)) return 0;
    throw err;
  }
}

/**
 * Borrar una cita PARA SIEMPRE (13/08/2026, Rodrigo: «poder eliminar del todo
 * las citas del calendario, se quedan canceladas pero no desaparecen»).
 *
 * «Eliminar» cancelaba, que es lo que ya hace el botón de al lado, así que la
 * cita seguía ahí en gris. Lo que hace falta al apuntar una cita en el día
 * equivocado, duplicarla o probar el widget es que desaparezca.
 *
 * ── QUÉ SE VA CON ELLA ─────────────────────────────────────────────────────
 * Lo que cuelga de la cita y quedaría apuntando al vacío: su sesión de cobro
 * (`payment_sessions`), las peticiones de cambio de hora (`booking_change_
 * requests`, cuyo `booking_id` es NOT NULL) y los avisos que nacieron de ella
 * (`client_notices`). Mismo barrido que `scripts/borrar-citas-por-nombre.js`.
 *
 * Sin transacción a propósito: una sentencia que falla dentro de una
 * transacción de PostgreSQL la deja abortada, y aquí hay que tolerar que a un
 * tenant le falte alguna de esas tablas. Se borra de fuera hacia dentro y la
 * cita la última; si algo se tuerce, lo que queda son filas sueltas que ya no
 * significan nada, no una cita a medio borrar.
 *
 * ── LO QUE NO SE BORRA ─────────────────────────────────────────────────────
 * · Una cita con dinero (cobrada, retenida o devuelta) NO se borra: el rastro
 *   del dinero tiene que quedar. Se dice y se ofrece cancelarla.
 * · El bono. Si la cita era una sesión de un bono, esa sesión vuelve a quedar
 *   libre — las sesiones se cuentan desde las citas (`lib/citas/packs.js`), así
 *   que borrar la cita es exactamente eso: no se dio.
 * · La auditoría. Es el ÚNICO rastro que queda de la cita, y por eso guarda algo
 *   más que las otras: sin ella, borrar sería invisible.
 */
async function borrarDeVerdad({ ctx, row, userId, ip }) {
  const { tenant, tenantModels } = ctx;
  const { PaymentSession, BookingChangeRequest, ClientNotice } = tenantModels;

  let conDinero = null;
  try {
    conDinero = await PaymentSession?.findOne({
      where: {
        entityType: "booking",
        entityId: row.id,
        status: { [Op.in]: Object.keys(COBROS_CON_DINERO) },
      },
      attributes: ["id", "status"],
    });
  } catch (err) {
    if (!esTablaAusente(err)) throw err;
  }
  if (conDinero) {
    return error(
      `Esta cita ${COBROS_CON_DINERO[conDinero.status]}: no se puede borrar, porque el registro del dinero tiene que quedar. Puedes cancelarla.`,
      409
    );
  }

  const antes = {
    cliente: row.clientName,
    scheduledAt: row.scheduledAt,
    estado: row.status,
    eventTypeId: row.eventTypeId,
    teamMemberId: row.teamMemberId,
    sessionNumber: row.sessionNumber ?? null,
  };

  const cobros = await borrarSiExiste(PaymentSession, { entityType: "booking", entityId: row.id });
  const cambios = await borrarSiExiste(BookingChangeRequest, { bookingId: row.id });
  const avisos = await borrarSiExiste(ClientNotice, { bookingId: row.id });
  await row.destroy();

  await logCitasAudit({
    tenantId: tenant.id,
    userId,
    action: "citas.booking_deleted",
    entity: "Booking",
    entityId: row.id,
    before: antes,
    after: { borrada: true, cobros, cambios, avisos },
    ip,
  });

  return noContent();
}

// ───────────────────────────────────────────────────────────────────────────
// DELETE /api/citas/bookings/[id] — cancela; con ?hard=true la borra del todo
// ───────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, { params }, ctx) => {
  try {
    const { tenant, tenantModels, hasModule } = ctx;
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    const { id } = await params;
    const { Booking } = tenantModels;
    const row = await Booking.findByPk(id);
    if (!row) return notFound("Cita no encontrada");
    // Cancelar, igual que editar: ver `noPuedeTocarla`.
    const vetoDelete = await noPuedeTocarla(request, ctx, row);
    if (vetoDelete) return vetoDelete;

    // Permitir pasar ?reason=... en query string para registrar el motivo
    const { searchParams } = new URL(request.url);
    const reason = normalizeString(searchParams.get("reason"));

    /*
     * Borrado físico. Misma puerta que cancelar (`noPuedeTocarla`) y no solo
     * admin: quien apunta las citas del día es quien se equivoca al apuntarlas,
     * y dejarle cancelar pero no borrar le obliga a pedirlo por WhatsApp. Se
     * abre porque queda auditado quién lo hizo y qué se llevó por delante.
     */
    if (searchParams.get("hard") === "true") {
      return await borrarDeVerdad({ ctx, row, userId, ip });
    }

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
