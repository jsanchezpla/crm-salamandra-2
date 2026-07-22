import { NextResponse } from "next/server";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import { MODULE_KEYS } from "../../../../../lib/tenant/moduleKeys.js";
import {
  aceptarSolicitud,
  buscarClienteExistente,
} from "../../../../../lib/formularios/accept.js";
import { crearUsuarioPortal } from "../../../../../lib/formularios/portalUser.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/formularios/[id]/accept — aceptar una solicitud.
 *
 * Body opcional:
 *   { clientId }        → enlazar con una ficha que YA existe en vez de crear otra
 *   { crearAcceso }     → false para NO dar de alta el usuario en WordPress
 *
 * Qué pasa, en orden y con criterio:
 *   1. Se crea (o se reutiliza) la ficha de cliente y se marca la solicitud.
 *      Esto va en UNA transacción: es lo indivisible.
 *   2. Fuera de la transacción, y sin poder tumbarla: alta en el WordPress del
 *      tenant para que la paciente pueda entrar al portal y reservar citas.
 *      Si falla, la ficha YA está creada y se informa del fallo; no se deshace
 *      nada, porque deshacerlo sería peor.
 */
export const POST = withTenant(async (request, ctx, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  try {
    if (!hasModule(MODULE_KEYS.FORMULARIOS)) return forbidden("Módulo formularios no activo");

    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Form, FormSubmission, Client } = tenantModels;
    const submission = await FormSubmission.findByPk(id);
    if (!submission) return notFound("Solicitud no encontrada");
    if (submission.status === "rejected") {
      return error("Esta solicitud está descartada. Vuelve a ponerla en pendientes para aceptarla.", 422);
    }

    let body = {};
    try { body = await request.json(); } catch { /* body opcional */ }

    const form = await Form.findByPk(submission.formId);
    if (!form) return error("El formulario de origen ya no existe", 422);

    const handledBy = request.headers.get("x-user-email") || null;

    const { client, creado, yaEstaba } = await aceptarSolicitud({
      sequelize: tenantSequelize,
      Client,
      FormSubmission,
      form: form.toJSON(),
      submission: submission.toJSON(),
      clientIdExistente: body.clientId && UUID_RE.test(body.clientId) ? body.clientId : null,
      handledBy,
    });

    if (!client) return error("No se ha podido crear la ficha", 500);

    // ── Alta en el WordPress del tenant (best-effort) ────────────────────────
    let acceso = { intentado: false };
    if (body.crearAcceso !== false && creado && client.email) {
      const resultado = await crearUsuarioPortal({
        tenantSlug: tenant.slug,
        wordpressUrl: form.settings?.wordpressUrl || null,
        email: client.email,
        nombre: client.name,
      });
      acceso = { intentado: true, ...resultado };
    } else if (!client.email) {
      acceso = {
        intentado: false,
        ok: false,
        motivo: "sin_email",
        mensaje: "Esta solicitud no trae email: no se ha creado acceso a la web ni se le podrá agendar cita hasta conseguirlo.",
      };
    }

    // Auditoría: SOLO identificadores. El texto que escribió la persona es
    // información de salud y master.audit_log es un schema compartido entre
    // tenants — ahí no entra.
    try {
      const { AuditLog } = getMasterModels();
      await AuditLog.create({
        tenantId: tenant.id,
        userId: request.headers.get("x-user-id"),
        action: "formularios.solicitud.aceptada",
        entity: "FormSubmission",
        entityId: submission.id,
        before: null,
        after: { clientId: client.id, clienteCreado: creado, accesoWeb: acceso.ok === true },
        ip: request.headers.get("x-forwarded-for") ?? null,
      });
    } catch { /* la auditoría no puede tumbar la operación */ }

    return NextResponse.json({
      ok: true,
      yaEstaba,
      creado,
      acceso,
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
      },
    });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * GET /api/formularios/[id]/accept — vista previa: ¿hay ya una ficha de esta
 * persona? La bandeja lo consulta antes de enseñar el botón, para poder
 * ofrecer "usar la ficha que ya existe" en lugar de crear una repetida.
 */
export const GET = withTenant(async (_request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule(MODULE_KEYS.FORMULARIOS)) return forbidden("Módulo formularios no activo");
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { FormSubmission, Client } = tenantModels;
    const submission = await FormSubmission.findByPk(id, {
      attributes: ["id", "email", "phone", "clientId"],
    });
    if (!submission) return notFound("Solicitud no encontrada");

    const existente = await buscarClienteExistente(Client, {
      email: submission.email,
      phone: submission.phone,
    });

    return NextResponse.json({
      ok: true,
      yaAceptada: !!submission.clientId,
      posibleDuplicado: existente ? existente.toJSON() : null,
    });
  } catch (err) {
    return serverError(err);
  }
});
