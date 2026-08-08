import { NextResponse } from "next/server";
import { llevaCuentaEnLaWeb } from "../../../../../lib/clients/consultaExterna.js";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import { MODULE_KEYS } from "../../../../../lib/tenant/moduleKeys.js";
import {
  aceptarSolicitud,
  buscarClienteExistente,
  frasesDelParte,
} from "../../../../../lib/formularios/accept.js";
import { crearUsuarioPortal } from "../../../../../lib/formularios/portalUser.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";
import { applyAutoAssignments } from "../../../../../lib/clients/moduleAssignments.js";
import { sendEmail, envioRealizado } from "../../../../../lib/email/resendClient.js";
import { solicitudAceptadaTemplate } from "../../../../../lib/email/templates/citas/solicitudAceptada.js";
import { getTenantResendConfig } from "../../../../../lib/outreach/resendConfig.js";
import { reservaOnlineCerrada } from "../../../../../lib/citas/puertaReserva.js";

/**
 * A dónde se le manda a reservar. Se prefiere el ÁREA PRIVADA del cliente
 * (Configuración → Citas), porque es donde su web tiene puesta la agenda y
 * donde su sesión de WordPress vale; el `loginUrl` es el respaldo. Sin ninguna
 * de las dos se devuelve null y el correo no promete un botón que no lleva a
 * ningún sitio.
 */
function urlParaReservar(tenant) {
  const candidatos = [
    tenant?.settings?.citas?.portalUrl,
    tenant?.settings?.widget?.auth?.loginUrl,
  ];
  for (const url of candidatos) {
    if (typeof url === "string" && /^https?:\/\/\S+$/i.test(url.trim())) return url.trim();
  }
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/formularios/[id]/accept — aceptar una solicitud.
 *
 * Body opcional:
 *   { clientId }        → enlazar con una ficha que YA existe en vez de crear otra
 *   { crearAcceso }     → false para NO dar de alta el usuario en WordPress
 *   { avisar }          → false para NO mandarle el correo «ya puedes pedir cita»
 *
 * Qué pasa, en orden y con criterio:
 *   1. Se crea (o se reutiliza) la ficha de cliente y se marca la solicitud.
 *      Esto va en UNA transacción: es lo indivisible. Desde el 08/08/2026 ahí
 *      dentro entran también los métodos de contacto y, donde hay módulo
 *      `pacientes`, la ficha del peque.
 *   2. Fuera de la transacción, y sin poder tumbarla: alta en el WordPress del
 *      tenant para que la paciente pueda entrar al portal y reservar citas.
 *      Si falla, la ficha YA está creada y se informa del fallo; no se deshace
 *      nada, porque deshacerlo sería peor.
 *   3. El correo de aviso, que también es best-effort.
 *
 * ⚠️ `crearAcceso: false` NO silencia el correo, solo el alta en WordPress. Son
 * dos bloques independientes y hasta hoy no había forma de aceptar sin escribir
 * a la persona: poner al día una bandeja con solicitudes viejas significaba
 * mandarle un «ya puedes pedir cita» a gente que escribió hace meses. Para eso
 * está `avisar: false`.
 */
export const POST = withTenant(async (request, ctx, { tenant, tenantModels, tenantSequelize, hasModule, tenantHasModule, user }) => {
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
    const handledByTeamId = await resolveCurrentTeamMemberId(request, tenantModels);

    const { client, creado, yaEstaba, parte } = await aceptarSolicitud({
      sequelize: tenantSequelize,
      Client,
      FormSubmission,
      form: form.toJSON(),
      submission: submission.toJSON(),
      clientIdExistente: body.clientId && UUID_RE.test(body.clientId) ? body.clientId : null,
      handledBy,
      handledByTeamId,
      // Con quién va la paciente. Llega del desplegable de la bandeja; se
      // valida el formato aquí porque el id viene del navegador.
      asignarA: body.asignarA && UUID_RE.test(body.asignarA) ? body.asignarA : null,
      // Los métodos de contacto son transversales: la tabla está en el bloque
      // CORE de migraciones, así que existe en todo cliente con fichas.
      ClientContactMethod: tenantModels.ClientContactMethod ?? null,
      /*
       * ⚠️ La puerta del paciente se comprueba AQUÍ, antes de abrir la
       * transacción, y no dentro. El modelo `Patient` está registrado en todos
       * los clientes pero la TABLA solo existe donde está el módulo
       * `pacientes`: intentar el INSERT en un cliente sin ella lanza 42P01,
       * hace rollback y se pierde la aceptación entera, dejando la solicitud
       * pendiente y a la familia sin ficha. Con la puerta aquí, un cliente sin
       * el módulo simplemente no crea paciente y se le dice.
       */
      Patient: hasModule(MODULE_KEYS.PACIENTES) ? (tenantModels.Patient ?? null) : null,
    });

    if (!client) return error("No se ha podido crear la ficha", 500);

    // Marcado automático de módulos (p. ej. "Paciente Nutrición"): fuera de la
    // transacción y best-effort, como el resto de extras de esta ruta. También
    // al reutilizar una ficha existente: si Laura la acepta, es paciente.
    await applyAutoAssignments({ tenantModels, clientId: client.id, tenantHasModule, userId: user?.id ?? null });

    // ── Alta en el WordPress del tenant (best-effort) ────────────────────────
    let acceso = { intentado: false };
    // Una consulta externa no lleva cuenta en la web: ver `consultaExterna.js`.
    // Aquí no puede llegar marcada —se marca después, desde la ficha— pero se
    // comprueba igual: el día que se pueda marcar al aceptar, esto ya está.
    if (body.crearAcceso !== false && creado && client.email && llevaCuentaEnLaWeb(client)) {
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

    // «Ya puedes pedir cita» (05/08/2026). La puerta de admisión exige el
    // formulario ACEPTADO, no solo enviado, así que entre rellenar y reservar
    // hay una persona decidiendo. Hasta hoy esa espera era a ciegas: se le
    // creaba la ficha y el acceso, y no se le decía nada — se quedaba sin saber
    // que ya podía pedir cita.
    //
    // Best-effort y FUERA de todo lo anterior: que no salga el correo no puede
    // deshacer una aceptación que ya creó ficha y acceso.
    let avisoAlPaciente = "no_procede";
    // `avisar: false` (08/08/2026) para poder poner al día una bandeja con
    // solicitudes viejas sin escribirle a nadie. Aceptar 20 solicitudes de hace
    // meses no puede significar 20 correos de «ya puedes pedir cita» saliendo
    // del dominio verificado del centro a familias que ya no lo esperan.
    if (body.avisar === false) {
      avisoAlPaciente = "silenciado";
    } else if (client.email) {
      try {
        const cfg = getTenantResendConfig({ tenant });
        const tpl = solicitudAceptadaTemplate({
          tenantName: tenant.name,
          brand: tenant.settings?.brand,
          clientName: client.name,
          urlReserva: urlParaReservar(tenant),
          // En un centro que no da cita por internet, el correo cambia de
          // texto: le dice que le llamarán en vez de mandarla a una agenda
          // que no existe (08/08/2026).
          reservaCerrada: reservaOnlineCerrada(tenant),
        });
        const envio = await sendEmail({
          to: client.email,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
          from: cfg.fromEmail || undefined,
          replyTo: cfg.replyTo || undefined,
          apiKey: cfg.apiKey || undefined,
        });
        avisoAlPaciente = envioRealizado(envio, `formularios:aceptada ${client.id}`).motivo;
      } catch (err) {
        process.stderr.write(`[formularios:aceptada] email fail: ${err.message}\n`);
        avisoAlPaciente = "error";
      }
    }

    return NextResponse.json({
      ok: true,
      yaEstaba,
      creado,
      acceso,
      // Para que la bandeja pueda decir si al paciente le ha llegado el aviso,
      // en vez de dar por hecho que sí.
      avisoAlPaciente,
      // Qué ha hecho el aceptar además de crear la ficha, en frases. Aceptar
      // pasó de una cosa a cuatro, y algunas no ocurren por motivos legítimos:
      // se dicen en el momento en vez de dejar que se descubran el día que
      // alguien va a citar a un peque que nunca se creó.
      parte: frasesDelParte(parte),
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
