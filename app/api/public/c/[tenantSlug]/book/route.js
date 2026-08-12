import { Op } from "sequelize";
import { puntuarSpam } from "../../../../../../lib/formularios/antispam.js";
import { withPublicTenant } from "../../../../../../lib/tenant/publicTenantContext.js";
import { reservaOnlineCerrada } from "../../../../../../lib/citas/puertaReserva.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import {
  created,
  error,
  errorConDatos,
  notFound,
  serverError,
} from "../../../../../../lib/utils/apiResponse.js";
import { sendEmail, envioRealizado } from "../../../../../../lib/email/resendClient.js";
import { bookingReceivedTemplate } from "../../../../../../lib/email/templates/citas/bookingReceived.js";
import { bookingConfirmedTemplate } from "../../../../../../lib/email/templates/citas/bookingConfirmed.js";
import { enlaceCancelacion } from "../../../../../../lib/citas/cancelacion.js";
import {
  normalizeString,
  normalizeEmail,
  isValidEmail,
} from "../../../../../../lib/citas/validation.js";
import {
  findBookingOverlap,
  lockBookingSlot,
  noEsCarritoAbandonado,
} from "../../../../../../lib/citas/booking.js";
import { logCitasAudit } from "../../../../../../lib/citas/audit.js";
import { notifyAdmins } from "../../../../../../lib/notifications/notifyUsers.js";
import { verifyPortalSession, readBearer } from "../../../../../../lib/citas/portalSession.js";
import {
  autorizarPago,
  tenantPuedeAutorizar,
  VENTANA_TARJETA_MS,
} from "../../../../../../lib/payments/autorizacion.js";
import { getStripe, getTenantStripeConfig } from "../../../../../../lib/payments/stripeConfig.js";
import { pruebaDeConsentimiento } from "../../../../../../lib/citas/consentimientoRetencion.js";
// `getClientIp` ya resolvía esto desde el arreglo del 2026-07-23: no coge el
// PRIMER valor de X-Forwarded-For (que antepone lo que mande el cliente) sino
// X-Real-IP o el último de la cadena, que es el que pone nginx. Escribí un
// helper nuevo para el consentimiento antes de encontrarlo; duplicar el parseo
// de IPs es exactamente cómo acaban divergiendo dos copias de una comprobación
// de seguridad, así que se usa el que ya existe.
import { getClientIp } from "../../../../../../lib/utils/rateLimit.js";
import { meetUrlInicial } from "../../../../../../lib/citas/videollamada.js";
import {
  exigeFormularioAceptado,
  urlDelFormulario,
  estadoDeAdmision,
  mensajeDePuerta,
  emailDeContacto,
  urlDeLaWeb,
} from "../../../../../../lib/citas/puertaFormulario.js";
import { avisarAdmisionRota } from "../../../../../../lib/citas/avisoAdmisionRota.js";
import { puedePedirValoracion } from "../../../../../../lib/citas/puertaValoracion.js";
import { citaPuedeAvisar } from "../../../../../../lib/clients/comunicaciones.js";
import {
  exigeContratoFirmado,
  esCitaDeValoracion,
  estadoDeContratos,
  dejaReservar,
  mensajeDeContrato,
} from "../../../../../../lib/citas/puertaContrato.js";
import { getTenantResendConfig } from "../../../../../../lib/outreach/resendConfig.js";
import {
  getMadridDayOfWeek,
  getMadridParts,
  getMadridTodayMidnight,
  pickAvailabilitiesForEventType,
  timeStrToMinutes,
  desfaseDeInicio,
  duracionDeContacto,
} from "../../../../../../lib/citas/slots.js";
import { cargarFestivos, esFestivo } from "../../../../../../lib/citas/festivos.js";
import { cargarAusencias, minutosOcupados } from "../../../../../../lib/citas/ausencias.js";
import { profesionalDeQuienPregunta } from "../../../../../../lib/citas/quienPregunta.js";
import {
  asignarSesion,
  esPack,
  precioDeCompra,
  PAGO_UNICO,
  PAGO_FRACCIONADO,
} from "../../../../../../lib/citas/packs.js";
import { createCheckoutSession, HOLD_WINDOW_MS } from "../../../../../../lib/payments/checkout.js";
import { exigePasarela, puedeReservar } from "../../../../../../lib/citas/tiposVisibles.js";
import { resolvePortalClient } from "../../../../../../lib/citas/portalClient.js";
import { esProfesionalDeLaSalud } from "../../../../../../lib/clients/moduleAssignments.js";
import {
  puedeReservarValoracionInicial,
  esValoracionInicial,
  mensajeValoracionUsada,
} from "../../../../../../lib/citas/valoracionInicial.js";
import { exigeIdentidad, mensajeSinIdentidad } from "../../../../../../lib/citas/puertaIdentidad.js";
import { paquetePreguntas } from "../../../../../../lib/citas/preguntasCita.js";

/**
 * Recupera el formulario de tarjeta de quien ya tenía una reserva a medias.
 *
 * El caso típico es el doble clic o el "volver atrás": su primera petición ya
 * creó la reserva y la retención, así que la segunda choca contra ella misma.
 * Devolverle el MISMO `clientSecret` le lleva al formulario que ya tenía abierto,
 * en vez de crear una segunda retención — que es como una persona acaba con el
 * doble de dinero bloqueado en su tarjeta por una sola cita.
 *
 * Devuelve null ante cualquier problema: esto es una comodidad, y no puede
 * tumbar una reserva.
 */
async function tarjetaPendienteDe(ctx, { id: bookingId, paymentSessionId }, importeEsperado) {
  try {
    const { PaymentSession } = ctx.tenantModels;
    const atributos = ["id", "status", "stripePaymentIntentId", "amount"];
    // Por id de sesión si la cita ya lo tiene; si no, buscándola por la propia
    // cita. `bookings.payment_session_id` se escribe DESPUÉS de la transacción
    // que crea la reserva (hay que llamar a Stripe antes), así que una segunda
    // petición que llegue en ese hueco lo vería vacío.
    const ps = paymentSessionId
      ? await PaymentSession.findByPk(paymentSessionId, { attributes: atributos })
      : await PaymentSession.findOne({
          where: { entityType: "booking", entityId: bookingId, status: "authorizing" },
          attributes: atributos,
          order: [["createdAt", "DESC"]],
        });
    if (!ps || ps.status !== "authorizing" || !ps.stripePaymentIntentId) return null;
    // La reserva contra la que se ha chocado puede ser de OTRO tipo de cita, con
    // otro precio. Devolverle ese formulario mientras la pantalla le enseña el
    // importe nuevo es cobrarle una cosa distinta de la que está leyendo.
    if (Number.isInteger(importeEsperado) && ps.amount !== importeEsperado) {
      process.stderr.write(
        `[citas:book] no se reutiliza el pago ${ps.id}: es de ${ps.amount} y aquí se esperan ${importeEsperado}\n`
      );
      return null;
    }
    const stripe = await getStripe(ctx);
    if (!stripe) return null;
    const pi = await stripe.paymentIntents.retrieve(ps.stripePaymentIntentId);
    // Solo sirve si todavía espera tarjeta. Si ya está retenido, no hay nada que
    // rellenar; y si murió, hay que empezar de cero.
    if (pi?.status !== "requires_payment_method") return null;
    return pi.client_secret ?? null;
  } catch (err) {
    process.stderr.write(`[citas:book] no se pudo recuperar el formulario de pago: ${err.message}\n`);
    return null;
  }
}

/**
 * POST /api/public/c/[tenantSlug]/book
 *
 * Body: { eventTypeId, scheduledAt, clientName, clientEmail, clientPhone, additionalData? }
 *
 * Crea un Booking desde la landing pública. Solo modalidad 'online'.
 *
 * ── SI EL TIPO DE CITA TIENE PRECIO ──────────────────────────────────────────
 * NO se cobra aquí. La reserva nace 'pending' + `paymentStatus: 'authorizing'`,
 * bloquea el hueco durante una ventana corta y se devuelve un `clientSecret`
 * para que el widget pinte el formulario de tarjeta.
 *
 * Cuando el paciente confirma la tarjeta, Stripe RETIENE el importe (no lo
 * cobra) y su webhook pasa la cita a `authorized`: ahí es cuando la solicitud
 * entra de verdad en la lista de espera y se le manda el correo. El dinero se
 * captura después, cuando la profesional confirma la cita desde el CRM.
 *
 * Es decir: esta ruta ya no decide nada sobre el dinero, solo lo prepara. Quien
 * cobra es `/api/citas/bookings/[id]/confirm`.
 */
export const POST = withPublicTenant(async (request, _ctx, tenantContext) => {
  try {
    const { slug, tenant, tenantModels, hasModule } = tenantContext;
    if (!hasModule("citas")) return notFound("Módulo no disponible");
    // El centro puede no dar cita por internet (08/08/2026). Va JUSTO debajo
    // del módulo y devuelve lo mismo que él —un 404— para no distinguir «no
    // contratado» de «cerrado» desde fuera. Ver lib/citas/puertaReserva.js.
    if (reservaOnlineCerrada(tenant)) return notFound("Módulo no disponible");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    const { EventType, Availability, Booking } = tenantModels;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    // Antispam (arreglo 2026-07-23): la reserva pública no tenía honeypot ni
    // trampa de tiempo ni dedup (el formulario sí). A un bot se le responde
    // "ok" y no se guarda nada; un error le diría qué corregir.
    const { puntos } = puntuarSpam(body);
    if (puntos >= 2) {
      return created({ ok: true, mensaje: "Solicitud recibida" });
    }

    const eventTypeId = normalizeString(body.eventTypeId);
    if (!eventTypeId) return error("eventTypeId es obligatorio");

    const eventType = await EventType.findOne({ where: { id: eventTypeId, active: true } });
    if (!eventType) return notFound("EventType no encontrado o inactivo");
    if (!Array.isArray(eventType.modalities) || !eventType.modalities.includes("online")) {
      return notFound("EventType no disponible online");
    }

    const clientName = normalizeString(body.clientName);
    if (!clientName) return error("clientName es obligatorio", 422);

    // Email del cliente. Si llega un sessionToken válido del portal SSO
    // (Authorization: Bearer), se FUERZA el email al de la sesión verificada,
    // ignorando el del body — así un cliente logueado no puede reservar con
    // otro email y la cita aparece luego en su "Mis citas". Sin bearer válido →
    // flujo público normal (email del body).
    let clientEmail = normalizeEmail(body.clientEmail);
    // `identificado` = el email viene de una sesión verificada del portal, no
    // de lo que alguien haya tecleado. La puerta de admisión lo necesita para
    // decidir cuánto puede contar sin convertirse en un buscador de pacientes.
    let identificado = false;
    try {
      const bearer = readBearer(request);
      if (bearer) {
        const session = await verifyPortalSession(bearer, slug);
        if (session?.email) {
          clientEmail = normalizeEmail(session.email);
          identificado = true;
        }
      }
    } catch {
      // bearer inválido/caducado → seguimos con el email del body (no rompemos
      // la reserva pública); se valida justo debajo.
    }
    if (!clientEmail || !isValidEmail(clientEmail)) return error("clientEmail inválido", 422);

    // ── Puerta de IDENTIDAD: sin cuenta no se reserva (05/08/2026) ──────────
    // La primera de las tres puertas, porque es la más básica: antes de
    // preguntar si esta persona está admitida o si ha firmado, hay que saber
    // QUIÉN es. `identificado` solo es true con una sesión de portal
    // verificada —el token que firma WordPress con el correo de quien ha
    // iniciado sesión—, nunca con lo que venga escrito en el cuerpo.
    //
    // El `?wpa=1` que el widget usaba para esto NO vale y nunca valió: lo pone
    // quien abre la URL y el servidor no lo miraba. Ver lib/citas/puertaIdentidad.js.
    //
    // La VALORACIÓN INICIAL tampoco se la salta: se salta la de contratos, que
    // es otra cosa. Sin cuenta, esa cita nace huérfana y hay que adivinar de
    // quién es.
    if (exigeIdentidad(tenant) && !identificado) {
      return error(mensajeSinIdentidad(tenant), 401);
    }

    // Puerta de admisión: sin formulario aceptado no hay cita. Va ANTES de
    // mirar huecos, festivos o tarjetas — lo primero, porque es lo que decide
    // si esta persona pinta algo en la agenda. Se comprueba también el módulo:
    // encender la puerta sin bandeja de formularios dejaría fuera a todos.
    if (exigeFormularioAceptado(tenant) && hasModule("formularios")) {
      const estado = await estadoDeAdmision(tenantModels, clientEmail);
      if (estado !== "aceptada") {
        // Si a quien rebotamos ya estaba admitido, que no se quede solo entre
        // ella y la pantalla: `sin_ficha` es una contradicción y alguien del
        // centro tiene que verla.
        avisarAdmisionRota({ tenantId: tenant.id, tenantModels, estado, email: clientEmail });
        const aviso = mensajeDePuerta(estado, {
          identificado,
          nombre: tenant.name,
          emailContacto: emailDeContacto(tenant),
        });
        return errorConDatos(aviso.texto, 403, {
          codigo: aviso.codigo,
          titulo: aviso.titulo,
          urlFormulario: aviso.mostrarEnlace ? urlDelFormulario(tenant) : null,
          urlVolver: aviso.mostrarVolver ? urlDeLaWeb(tenant) : null,
        });
      }
    }

    // La valoración inicial, una sola vez en la vida (05/08/2026). Se corta
    // AQUÍ y no solo escondiendo el botón: el cliente ya encontró dos caminos
    // alternativos para llegar a ella, y esconder no es impedir.
    //
    // Va antes de la puerta de contratos porque la valoración se la salta, y
    // quien ya la tuvo no debe colarse por esa excepción.
    if (esValoracionInicial(eventType)) {
      const { puede, motivo } = await puedeReservarValoracionInicial(tenantModels, clientEmail);
      if (!puede) {
        const aviso = mensajeValoracionUsada(tenant.name, motivo);
        return errorConDatos(aviso.texto, 409, {
          codigo: aviso.codigo,
          titulo: aviso.titulo,
        });
      }

      // A la primera visita solo se llega por el formulario (05/08/2026).
      //
      // Va aquí y no en la puerta de admisión de arriba porque aquella es para
      // TODAS las citas: encenderla le cerraría la agenda al paciente de
      // siempre que solo quiere una revisión. Esta pide el formulario donde
      // hace falta —delante de quien el centro todavía no conoce— y deja el
      // seguimiento en paz.
      //
      // Es el ÚNICO sitio que protege de verdad. La valoración está eximida a
      // propósito de contratos y del cobro, así que sin este corte las cuatro
      // pantallas que la esconden no impiden nada: el tipo de cita viaja en el
      // cuerpo de la petición y se escribe a mano.
      const admision = await puedePedirValoracion(tenant, {
        tieneFormularios: hasModule("formularios"),
        tenantModels,
        email: clientEmail,
      });
      if (!admision.puede) {
        // Mismo motivo que en la puerta general: una admitida sin ficha es una
        // contradicción, y aquí también se la rebota en silencio.
        avisarAdmisionRota({
          tenantId: tenant.id,
          tenantModels,
          estado: admision.estado,
          email: clientEmail,
        });
        const aviso = mensajeDePuerta(admision.estado, {
          identificado,
          nombre: tenant.name,
          emailContacto: emailDeContacto(tenant),
        });
        // `errorConDatos` y no `error`: el tercer argumento de `error` se borra
        // en producción, y con él se iría el enlace al formulario — que es lo
        // único accionable que lleva la respuesta.
        return errorConDatos(aviso.texto, 403, {
          codigo: aviso.codigo,
          titulo: aviso.titulo,
          urlFormulario: aviso.mostrarEnlace ? urlDelFormulario(tenant) : null,
          urlVolver: aviso.mostrarVolver ? urlDeLaWeb(tenant) : null,
        });
      }
    }

    // Puerta de contratos (04/08/2026): el orden de la consulta es firmar →
    // pedir cita → pagar, y hasta hoy nadie lo comprobaba fuera del portal.
    // LA VALORACIÓN INICIAL SE LA SALTA: es la primera visita y sin esa
    // excepción esto sería un muro, porque para firmar hay que ser ya paciente.
    if (exigeContratoFirmado(tenant) && !esCitaDeValoracion(eventType)) {
      const estado = await estadoDeContratos(tenantModels, clientEmail);
      if (!dejaReservar(estado)) {
        // El nombre de la valoración se busca aquí y no antes para no gastar
        // una consulta en las reservas que pasan de largo, que son casi todas.
        const valoracion = await EventType.findOne({
          where: { isInitialAssessment: true, active: true },
          attributes: ["name"],
        }).catch(() => null);
        const aviso = mensajeDeContrato(estado, {
          identificado,
          nombre: tenant.name,
          valoracion: valoracion?.name ?? null,
        });
        return errorConDatos(aviso.texto, 403, {
          codigo: aviso.codigo,
          titulo: aviso.titulo,
          irAlPortal: aviso.irAlPortal,
        });
      }
    }

    const clientPhone = normalizeString(body.clientPhone);
    if (!clientPhone) return error("clientPhone es obligatorio", 422);

    // Recorte de longitud (arreglo 2026-07-23): additionalData es TEXT sin tope
    // y el endpoint es público; sin recorte se puede escribir MB por reserva.
    const additionalData = body.additionalData != null ? String(body.additionalData).trim().slice(0, 2000) : null;
    if (eventType.additionalDataRequired && (!additionalData || additionalData === "")) {
      return error("additionalData es obligatorio para este tipo de cita", 422);
    }

    if (!body.scheduledAt) return error("scheduledAt es obligatorio", 422);
    const scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) return error("scheduledAt inválido", 422);

    const now = new Date();

    // Día cerrado del centro. Se comprueba también AQUÍ y no solo al generar
    // los huecos: quien manda el POST a mano (o con una pestaña abierta desde
    // antes de marcar el festivo) se saltaría el filtro visual.
    const festivos = await cargarFestivos(tenantModels);
    if (esFestivo(festivos, getMadridParts(scheduledAt))) {
      return error("Ese día el centro está cerrado. Elige otra fecha.", 422);
    }

    // Validar antelación mínima
    const minNoticeMs = (eventType.minNoticeHours ?? 0) * 60 * 60 * 1000;
    if (scheduledAt.getTime() < now.getTime() + minNoticeMs) {
      return error("La cita no respeta la antelación mínima", 422);
    }

    const todayStart = getMadridTodayMidnight(now);
    const maxBoundary = new Date(todayStart.getTime() + eventType.maxAdvanceDays * 24 * 60 * 60 * 1000);
    if (scheduledAt > maxBoundary) {
      return error("La cita excede el máximo de días de antelación", 422);
    }

    // Validar que cae dentro de una Availability del día
    const dayOfWeek = getMadridDayOfWeek(scheduledAt);
    const allDayAvailabilities = await Availability.findAll({ where: { dayOfWeek } });
    const applicable = pickAvailabilitiesForEventType(
      allDayAvailabilities.map((a) => a.toJSON()),
      eventType.id,
      dayOfWeek
    );
    if (applicable.length === 0) {
      return error("No hay disponibilidad ese día", 422);
    }

    const { hour: hMadrid, minute: mMadrid } = getMadridParts(scheduledAt);
    const scheduledMin = hMadrid * 60 + mMadrid;
    /*
     * Los descansos se restan por dentro (07/08/2026, Rodrigo): con «60 min y
     * 10 de previo», el hueco de las 5:10 pertenece al bloque 5:00-6:00 y la
     * cita dura 50. Hay que medir las dos cosas:
     *   · `endMin` — cuándo acaba LA CITA, para solapes y bloqueos;
     *   · `bloqueIni`/`bloqueFin` — el bloque entero, que es lo que tiene que
     *     caber dentro de la disponibilidad del centro.
     * Sin lo segundo, una cita de 5:10 a 6:00 con el centro abriendo a las 5:00
     * se aceptaría aunque su bloque empiece antes de abrir.
     */
    const contacto = duracionDeContacto(eventType);
    const desfase = desfaseDeInicio(eventType);
    const endMin = scheduledMin + contacto;
    const bloqueIni = scheduledMin - desfase;
    const bloqueFin = bloqueIni + eventType.duration;

    /*
     * «Vacaciones» (06/08/2026). Se comprueba aquí igual que el festivo y por
     * el mismo motivo: los huecos que enseña la pantalla son un filtro visual,
     * y quien manda el POST a mano —o desde una pestaña abierta desde antes de
     * meter las vacaciones— se lo salta.
     */
    const partes = getMadridParts(scheduledAt);
    const bloqueos = await cargarAusencias(tenantModels, {
      desde: new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000),
      hasta: new Date(scheduledAt.getTime() + 24 * 60 * 60 * 1000),
      profesionalId: await profesionalDeQuienPregunta(tenantModels, request, slug),
    });
    for (const b of bloqueos) {
      const t = minutosOcupados(b, partes);
      // Se pisan si la cita empieza antes de que acabe el bloqueo y acaba
      // después de que empiece.
      if (t && scheduledMin < t.fin && endMin > t.inicio) {
        return error("Ese hueco ya no está disponible. Elige otra fecha.", 422);
      }
    }

    let withinSlot = false;
    for (const av of applicable) {
      const s = timeStrToMinutes(av.startTime);
      const e = timeStrToMinutes(av.endTime);
      if (s == null || e == null) continue;
      if (bloqueIni >= s && bloqueFin <= e) {
        withinSlot = true;
        break;
      }
    }
    if (!withinSlot) {
      return error("La hora seleccionada no está dentro de la disponibilidad", 422);
    }

    // El solapamiento y el dedup se comprueban más abajo, DENTRO de la
    // transacción que reserva el hueco (ver "Reserva del hueco"): comprobarlos
    // aquí sueltos era una carrera — entre la lectura y el INSERT cabía otra
    // petición que leía lo mismo y concluía lo mismo.

    // Determina si el booking nace 'confirmed' (default histórico) o
    // 'pending' (lista de espera). El flag vive en master.tenant_modules
    // del módulo citas del tenant. Default: true (auto-confirm) — solo
    // tenants que opten explícitamente por confirmación manual cambian
    // a false. `hasFeatureFlag` devuelve false si el flag está ausente,
    // pero aquí necesitamos distinguir "ausente (=true por defecto)" de
    // "puesto a false", así que leemos la fila directamente.
    let autoConfirm = true;
    try {
      const { TenantModule } = getMasterModels();
      const mod = await TenantModule.findOne({
        where: { tenantId: tenant.id, moduleKey: "citas" },
        attributes: ["featureFlags"],
      });
      if (mod?.featureFlags?.autoConfirmPublicBookings === false) {
        autoConfirm = false;
      }
    } catch {
      // Si la lectura falla, conservamos el comportamiento histórico
      // (auto-confirm). No queremos romper el flujo de reserva por un
      // problema de lectura del flag.
    }

    // Enlace con la ficha de cliente (2026-07-22). Quien reserva desde el
    // portal viene identificado por el email de su cuenta de WordPress, así
    // que si ya es paciente podemos atar la cita a su ficha en el momento y no
    // depender de comparar cadenas de email al mostrarla.
    //
    // Best-effort: si no hay ficha (todavía no es cliente) o el tenant no
    // tiene módulo de clientes, la cita se crea igual sin enlazar. Reservar
    // NUNCA puede fallar por esto.
    let clientId = null;
    // ¿La exime SU FICHA, o es el modo del centro? Hace falta distinguirlo: las
    // sesiones de bono esperan en la lista salvo que la exención sea suya.
    let eximidaPorFicha = false;
    try {
      const { Client } = tenantModels;
      if (Client && clientEmail) {
        const ficha = await Client.findOne({
          where: { email: { [Op.iLike]: clientEmail } },
          attributes: ["id", "autoConfirmBookings"],
          order: [["createdAt", "ASC"]],
        });
        if (ficha) {
          clientId = ficha.id;
          /*
           * ESTA PACIENTE TIENE LAS CITAS AUTOCONFIRMADAS (06/08/2026, Rodrigo).
           *
           * El interruptor de su ficha la exime de la bandeja de confirmación
           * del centro. Nace de la paciente de siempre, la que viene los martes
           * a la misma hora: darle el visto bueno a cada cita suya es trabajo
           * que no decide nada.
           *
           * Solo EXIME, nunca al revés: si el centro ya confirma solo, esto no
           * cambia nada. Y no se salta ninguna otra puerta —formulario,
           * contrato, identidad— ni el cobro: con precio, la cita sigue naciendo
           * pendiente hasta que la tarjeta responde (ver el `status` de más
           * abajo, donde el precio manda sobre esto).
           */
          if (ficha.autoConfirmBookings === true) {
            autoConfirm = true;
            eximidaPorFicha = true;
          }
        }
      }
    } catch (err) {
      const code = err?.parent?.code || err?.original?.code;
      if (code !== "42P01" && code !== "42703") {
        console.error(`[book] no se pudo enlazar la cita con su ficha: ${err.message}`);
      }
    }

    // ── ¿Esta cita se cobra? ────────────────────────────────────────────────
    // Solo si su tipo tiene precio. Sin precio (null o 0) el flujo es el de
    // siempre, así que los tenants que no cobran no notan absolutamente nada.
    const precioTarifa = Number.isInteger(eventType.price) && eventType.price > 0 ? eventType.price : null;

    // Origen público desde el que se ha cargado el widget. Se deduce de la
    // propia petición (nginx pone las cabeceras `x-forwarded-*`) y no de una
    // variable de entorno: cada centro entra por su dominio, y una URL fija
    // devolvería a la paciente al sitio equivocado tras pagar.
    const origenPublico = (req) => {
      const proto = req.headers.get("x-forwarded-proto") || "https";
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
      return host ? `${proto}://${host}` : "";
    };

    // ── ¿Le queda bono? ─────────────────────────────────────────────────────
    // Si esta persona ya tiene un bono con sesiones libres para este tipo de
    // cita, la reserva se engancha a él, se numera («3 de 10») y NO SE COBRA:
    // ya lo pagó al comprarlo. Si no lo tiene, la cita sigue el camino de
    // siempre y se cobra; el bono nace cuando el pago se confirma, no aquí
    // (quien abandona el formulario de la tarjeta no puede quedarse con diez
    // sesiones sin pagar). Ver lib/citas/packs.js.
    const enBono = await asignarSesion(tenantModels, { email: clientEmail, eventTypeId: eventType.id });

    // Es un bono y no tiene uno activo → esta reserva COMPRA el bono. El modo
    // de pago lo elige quien reserva; el importe NO viene del cliente, sale de
    // lo que la profesional configuró (ver la nota de seguridad de
    // lib/payments/autorizacion.js).
    const compraDeBono =
      !enBono && esPack(eventType)
        ? precioDeCompra(eventType, body.pricingMode === PAGO_FRACCIONADO ? PAGO_FRACCIONADO : PAGO_UNICO)
        : null;

    if (!enBono && esPack(eventType) && !compraDeBono) {
      // Pidió fraccionado y no está configurado, o el bono no tiene precio.
      // Mejor decirlo que cobrar un importe que nadie ha puesto.
      return error("Esta forma de pago no está disponible para este programa", 422);
    }

    const precio = enBono ? null : (compraDeBono ? compraDeBono.amount : precioTarifa);

    /*
     * ¿ESTA CITA ESPERA EN LA LISTA? (07/08/2026, Rodrigo)
     *
     * Dos motivos para esperar, y ninguno tiene que ver con el modo del centro:
     *
     *   · TIENE PRECIO — se queda pendiente hasta que la profesional decida; el
     *     dinero está solo retenido, no cobrado.
     *   · GASTA SESIÓN DE UN BONO — «se ha confirmado automáticamente una cita
     *     tras haber pagado; debería quedarse en lista de espera aunque pague».
     *     Una sesión de bono no lleva precio (ya está pagada), así que caía en
     *     la rama de auto-confirmar y se colaba en la agenda sin que nadie la
     *     mirase. Justo al revés de lo que hace falta: quien tiene bono es
     *     quien MÁS sesiones va a pedir.
     *
     *     Dejarla esperando no le cuesta nada: si se rechaza, la sesión vuelve
     *     al bono y se le da otra fecha. No es dinero retenido, es un hueco.
     *
     * ⚠️ SALVO QUE SU FICHA LA EXIMA. El interruptor «citas autoconfirmadas» de
     * la ficha (06/08/2026) es una decisión explícita sobre ESA paciente —la de
     * siempre, la que viene los martes a la misma hora— y gana sobre la regla
     * general; si no, el interruptor no serviría justo para quien tiene
     * programa, que es casi todo el mundo. Lo que NO exime nunca es el precio:
     * con tarjeta de por medio manda el cobro.
     */
    const debeEsperar = Boolean(precio) || Boolean(enBono && !eximidaPorFicha);

    // ── ¿Puede reservar ESTO esta persona? (05/08/2026) ─────────────────────
    // Dos cosas a la vez, las dos en `lib/citas/tiposVisibles.js`:
    //
    //   · Tipo OCULTO → solo pasa quien tenga bono activo suyo. El listado ya
    //     no se lo enseña a nadie más, pero el filtro del listado NO es la
    //     seguridad: el `eventTypeId` viaja en este cuerpo y cualquiera puede
    //     mandarlo. Esta es la comprobación que cierra la puerta de verdad.
    //
    //   · `soloConPago` encendido → desde la agenda pública no se reserva nada
    //     que no pase por caja: o lo cobra la pasarela ahora, o lo pagó un bono
    //     antes. Las citas gratuitas de verdad las crea el centro a mano.
    //     Apagado por defecto: hay centros cuyos tipos de cita NO tienen precio
    //     porque cobran cuotas por fuera, y encenderlo para todos les dejaría
    //     la agenda muerta.
    const permiso = puedeReservar(eventType, {
      tieneBono: !!enBono,
      seCobra: Number.isInteger(precio) && precio > 0,
      exigePago: exigePasarela(tenant),
      // La marca de la ficha, resuelta desde el correo de quien reserva. El
      // filtro del listado ya lo esconde, pero el `eventTypeId` viaja en este
      // cuerpo: esta es la comprobación que cierra la puerta de verdad.
      esProfesional: await esProfesionalDeLaSalud(
        tenantModels,
        (await resolvePortalClient(tenantModels, clientEmail))?.id ?? null
      ),
      tenant,
    });
    if (!permiso.ok) return error(permiso.motivo, 422);

    // ── Preguntas propias del tipo de cita (04/08/2026) ─────────────────────
    // Si las tiene, hay que haberlas contestado: se preguntan después de elegir
    // fecha y hora, en el mismo formulario de datos. Viven en el propio tipo de
    // cita (`lib/citas/preguntasCita.js`); durante unas horas fueron un
    // formulario del módulo Formularios y Rodrigo lo revisó el mismo día.
    //
    // ⚠️ NO confundir con la PUERTA DE ADMISIÓN (`puertaFormulario.js`): aquella
    // exige un formulario ACEPTADO antes de dejar reservar y es de todo el
    // centro. Esto son las preguntas de UNA cita concreta.
    const paquete = paquetePreguntas(eventType.formQuestions, body.formAnswers ?? {});
    if (!paquete.ok) return error(paquete.error, 422);
    const respuestasFormulario = paquete.paquete;

    // ── Consentimiento de la retención ──────────────────────────────────────
    // Se exige ANTES de crear nada. El paciente tiene que haber leído que su
    // banco le va a enseñar un cargo pendiente que no es un cobro; si no, la
    // primera reacción al verlo es una reclamación. La prueba se archiva con la
    // sesión de pago (ver lib/citas/consentimientoRetencion.js).
    /*
     * ⚠️ UN BONO NO TIENE RETENCIÓN: SE PAGA ENTERO (06/08/2026, Rodrigo).
     *
     * Esta comprobación miraba solo el precio, y la pantalla —con razón— no
     * pinta la casilla de condiciones cuando lo que se compra es un bono: ahí no
     * se retiene nada, se cobra. Así que en un bono la casilla no existía, el
     * navegador no mandaba el consentimiento y el servidor respondía «hay que
     * aceptar las condiciones de la reserva»: un error imposible de resolver,
     * porque no había ninguna casilla que marcar en toda la página.
     *
     * La condición pasa a ser la MISMA que la de la pantalla. Y sigue siendo el
     * servidor quien manda: en una cita normal con precio, sin consentimiento no
     * se reserva.
     */
    if (precio && !esPack(eventType) && body.aceptaRetencion !== true) {
      return error("Hay que aceptar las condiciones de la reserva para continuar", 422);
    }

    if (precio && !tenantPuedeAutorizar(tenantContext)) {
      // Hay precio pero el profesional no ha terminado de configurar el cobro.
      // Mejor decirlo que crear una cita "gratis" que él cree cobrada.
      // `tenantPuedeAutorizar` exige también la clave PUBLICABLE: sin ella el
      // formulario de tarjeta no puede ni pintarse, así que dejar pasar la
      // reserva solo serviría para dejarla colgada esperando un pago imposible.
      return error(
        "Este servicio requiere pago online, pero el profesional aún no lo tiene activado. Contacta con él.",
        503
      );
    }

    // ── Reserva del hueco (serializada) ─────────────────────────────────────
    // Un solo reloj aquí, y es CORTO: lo único que protege es la hora mientras
    // el paciente teclea la tarjeta. El reloj largo —cuándo caduca el dinero
    // retenido— lo pone Stripe y se guarda cuando la retención existe de verdad
    // (ver `authorizationExpiresAt`). Confundirlos fue el error del flujo
    // anterior, donde un único hold servía para las dos cosas.
    //
    /*
     * ⚠️ PERO COMPRAR UN BONO NO VA POR AHÍ (arreglo 10/08/2026).
     *
     * Los 20 minutos son la medida del formulario de tarjeta embebido, donde la
     * retención se resuelve en la misma pantalla. Un bono no se retiene: se va a
     * Stripe Checkout, y esa página sigue aceptando el pago 31 minutos (30 de
     * mínimo que impone Stripe + el minuto de colchón de `checkout.js`).
     *
     * Con 20 y 31 quedaba una franja de once minutos larga en la que el hueco ya
     * estaba libre y la pantalla de pago seguía viva. Si otra persona cogía la
     * hora justo ahí, la primera pagaba y se quedaba SIN CITA y SIN BONO — y en
     * un fraccionado, además, con la suscripción en marcha. Es el peor final
     * posible de este endpoint.
     *
     * `HOLD_WINDOW_MS` (45 min) está escrita exactamente para esto y no se
     * estaba usando en ningún sitio. La regla es que el hueco aguante MÁS que la
     * pantalla de pago, pase lo que pase.
     */
    const ahora = Date.now();
    const holdCaducaEn = new Date(ahora + (compraDeBono ? HOLD_WINDOW_MS : VENTANA_TARJETA_MS));

    let row;
    try {
      row = await tenantContext.tenantSequelize.transaction(async (t) => {
        // Serializa contra otras reservas y contra los cambios de hora del panel.
        // A partir de aquí, la comprobación de hueco es de fiar.
        await lockBookingSlot(tenantContext.tenantSequelize, { transaction: t });

        const hace5min = new Date(ahora - 5 * 60 * 1000);

        const overlap = await findBookingOverlap(Booking, {
          scheduledAt,
          duration: contacto,
          transaction: t,
        });
        if (overlap) {
          // ¿Es SUYA? El caso típico es el doble clic: su primera petición ya
          // creó la reserva, así que la segunda choca contra ella misma. Antes
          // se le respondía "esa hora ya no está disponible" sobre la hora que
          // acababa de reservar él, y —si era de pago— sin manera de llegar al
          // cobro: su propio hueco le bloqueaba media hora.
          const suya = await Booking.findOne({
            where: {
              id: overlap.id,
              createdAt: { [Op.gte]: hace5min },
              [Op.or]: [{ clientEmail }, { clientPhone }],
            },
            attributes: ["id", "paymentSessionId"],
            transaction: t,
          });
          if (suya) {
            const e = new Error("DUPLICADO");
            e.code = "DUPLICADO";
            e.duplicado = suya;
            throw e;
          }
          const e = new Error("OCUPADO");
          e.code = "OCUPADO";
          throw e;
        }

        // ── Tope de huecos bloqueados sin pagar ────────────────────────────
        // El endpoint es PÚBLICO y una reserva sin pagar bloquea su hora 20
        // minutos. Sin tope, cualquiera podía dejar la agenda entera sin huecos
        // repitiendo la llamada: bloqueaba de verdad, y encima de forma
        // INVISIBLE, porque esas reservas no llegan a la lista de espera. La
        // profesional vería su agenda llena sin una sola solicitud.
        //
        // Tres a la vez es más de lo que necesita nadie reservando de buena fe
        // (una persona rellena un formulario cada vez) y poco para hacer daño.
        // No es la defensa definitiva —quien cambie de email y de IP sigue
        // pudiendo—, pero sube muchísimo el coste del ruido tonto.
        if (precio) {
          const bloqueando = await Booking.count({
            where: {
              paymentStatus: "authorizing",
              holdExpiresAt: { [Op.gt]: new Date() },
              [Op.or]: [{ clientEmail }, { clientPhone }],
            },
            transaction: t,
          });
          if (bloqueando >= 3) {
            const e = new Error("DEMASIADAS");
            e.code = "DEMASIADAS";
            throw e;
          }
        }

        // Dedup residual: misma persona, misma hora, hace menos de 5 min, pero
        // con una reserva que NO ocupa el hueco (p. ej. quedó en 'no_show').
        // El caso común —su reserva sigue en pie— lo resuelve ya la rama de
        // arriba. Las canceladas y los carritos caducados quedan fuera a
        // propósito: si canceló, tiene todo el derecho a volver a reservar sin
        // esperar cinco minutos.
        const yaReservado = await Booking.findOne({
          where: {
            scheduledAt,
            createdAt: { [Op.gte]: hace5min },
            [Op.or]: [{ clientEmail }, { clientPhone }],
            status: { [Op.ne]: "cancelled" },
            ...noEsCarritoAbandonado(),
          },
          attributes: ["id", "paymentSessionId"],
          transaction: t,
        });
        if (yaReservado) {
          const e = new Error("DUPLICADO");
          e.code = "DUPLICADO";
          e.duplicado = yaReservado;
          throw e;
        }

        return await Booking.create(
          {
            eventTypeId: eventType.id,
            clientName,
            clientEmail,
            clientPhone,
            additionalData,
            scheduledAt,
            duration: contacto,
            modality: "online",
            meetUrl: meetUrlInicial(tenant, eventType, "online"),
            /*
             * Con pago la cita nace 'pending' y AHÍ SE QUEDA hasta que la
             * profesional decida: ese es todo el sentido del flujo nuevo. Ya no
             * se confirma sola al cobrar, porque ya no se cobra al reservar.
             *
             * ⚠️ Y LA SESIÓN DE UN BONO, TAMBIÉN (07/08/2026, Rodrigo). Una
             * sesión que sale de un bono NO lleva precio —ya está pagada— así
             * que caía en la rama de auto-confirmar y se colaba en la agenda
             * sin pasar por la lista de espera. Justo al revés de lo que hace
             * falta: es quien MÁS sesiones va a pedir, y la nutricionista tiene
             * que poder decidir cada una.
             *
             * Rechazarla no le cuesta nada a la paciente: la sesión vuelve al
             * bono y se le da otra fecha (`lib/citas/reembolsoCita.js`). Por eso
             * dejarla esperando es seguro — no es dinero retenido, es un hueco.
             */
            status: debeEsperar ? "pending" : autoConfirm ? "confirmed" : "pending",
            // 'authorizing' = está a punto de meter la tarjeta. Bloquea el hueco
            // solo durante esa ventana corta; si abandona el formulario, la hora
            // se libera sola al consultarse (ocupaHuecoWhere), sin cron.
            paymentStatus: precio ? "authorizing" : "none",
            amount: precio,
            holdExpiresAt: precio ? holdCaducaEn : null,
            clientId,
            // Bono: a cuál pertenece y qué número de sesión es. null en las
            // citas sueltas, que son todas las de hoy.
            packId: enBono?.packId ?? null,
            sessionNumber: enBono?.sessionNumber ?? null,
            // Respuestas del formulario del tipo de cita, si lo tiene.
            formAnswers: respuestasFormulario,
          },
          { transaction: t }
        );
      });
    } catch (err) {
      if (err?.code === "OCUPADO") {
        return error("Esa hora ya no está disponible, por favor elige otra", 409);
      }
      if (err?.code === "DEMASIADAS") {
        return error(
          "Tienes varias reservas a medias esperando el pago. Termina una o espera unos minutos antes de pedir otra hora.",
          429
        );
      }
      if (err?.code === "DUPLICADO") {
        // Cita gratuita: comportamiento de siempre.
        if (!precio) return created({ ok: true, mensaje: "Solicitud recibida" });

        // Con precio, responder "Solicitud recibida" a secas dejaba al paciente
        // creyendo que tenía cita sin haber dado la tarjeta, y sin forma de
        // llegar al formulario: su propia reserva le bloqueaba el hueco. Se le
        // devuelve EL MISMO formulario que ya tiene abierto.
        //
        // Que esto funcione es lo que impide el fallo más caro de todos: crear
        // una SEGUNDA retención por la misma cita y dejar a una persona con el
        // doble de dinero bloqueado en su tarjeta.
        const clientSecret = err.duplicado
          ? await tarjetaPendienteDe(tenantContext, err.duplicado, precio)
          : null;
        if (clientSecret) {
          return created({
            // Los mismos campos que la rama normal. Devolver solo el id dejaba
            // al widget pintando "Duración undefined min" en la pantalla final
            // a quien hubiera hecho doble clic — que es precisamente quien ya
            // dudaba de si su reserva había salido.
            booking: {
              id: err.duplicado.id,
              scheduledAt: scheduledAt.toISOString(),
              duration: contacto,
              eventTypeName: eventType.name,
              eventTypeColor: eventType.color,
              clientEmail,
            },
            paymentRequired: true,
            amount: precio,
            clientSecret,
            publishableKey: getTenantStripeConfig(tenantContext).publishableKey,
          });
        }
        // Su reserva existe pero la retención aún se está creando (pasa con
        // clics simultáneos: la primera petición llama a Stripe fuera de la
        // transacción). Se le dice que espere, no que la hora esté ocupada —
        // está ocupada POR ÉL.
        return error(
          "Ya estamos preparando tu pago para esa hora. Espera unos segundos y vuelve a intentarlo.",
          409
        );
      }
      throw err;
    }

    await logCitasAudit({
      tenantId: tenant.id,
      userId: null,
      action: "citas.booking_created",
      entity: "Booking",
      entityId: row.id,
      before: null,
      after: { ...row.toJSON(), source: "landing" },
      ip,
    });

    // ── Cita con pago: preparar la RETENCIÓN de la tarjeta ─────────────────
    // El importe NO viene del cliente: se toma de EventType.price, ya validado
    // arriba. Ver la nota de seguridad en lib/payments/autorizacion.js.
    //
    // Al salir de aquí NO hay dinero retenido todavía: solo un PaymentIntent
    // esperando a que el navegador confirme la tarjeta. Por eso no se manda
    // ningún correo ni se da la solicitud por buena: eso lo hace el webhook
    // cuando la retención existe de verdad. Prometerle algo al paciente antes
    // sería prometerle una cita que puede no llegar a tener.
    // ── Comprar un BONO va por CHECKOUT, no por retención ───────────────────
    // La retención de tarjeta (autorizar sin cobrar) es para UNA cita: se
    // bloquea el importe y la profesional decide. Un bono es una compra: se
    // paga y da derecho a N sesiones.
    //
    // Y desde el 05/08/2026 el FRACCIONADO es una suscripción de Stripe: se
    // cobra la primera cuota aquí y Stripe repite el cargo cada mes hasta
    // completar el total, cancelándose sola. Antes esto se delegaba en Klarna,
    // que es justo el intermediario financiero que se quería quitar.
    if (precio && compraDeBono) {
      let checkout;
      try {
        checkout = await createCheckoutSession(tenantContext, {
          entityType: "booking",
          entityId: row.id,
          // OJO: en fraccionado esto es la PRIMERA CUOTA, no el total.
          amount: compraDeBono.amount,
          description: compraDeBono.recurrente
            ? `${eventType.name} (${compraDeBono.instalmentMonths} meses) — ${tenant.name}`
            : `${eventType.name} — ${tenant.name}`,
          customerEmail: row.clientEmail,
          // Fraccionado → tarjeta: es lo único que se puede domiciliar.
          paymentMethodTypes: compraDeBono.metodos,
          // Presente solo en el fraccionado: convierte el cobro en suscripción.
          recurring: compraDeBono.recurrente,
          /*
           * A DÓNDE VUELVE DESPUÉS DE PAGAR (06/08/2026).
           *
           * Ahora se sale del iframe para ir a Stripe —la pasarela no se deja
           * enmarcar—, así que Stripe devuelve la PESTAÑA ENTERA a estas
           * direcciones. Si apuntan al widget pelado, la paciente acaba fuera de
           * la web de su nutricionista, sin cabecera y sin sesión, mirando un
           * portal que le pide identificarse justo después de pagar.
           *
           * Por eso se prefieren las páginas de SU web (Configuración → Citas),
           * que es de donde salió. El widget queda como respaldo para los
           * centros que aún no las tengan puestas.
           */
          successUrl: tenant.settings?.citas?.portalUrl || `${origenPublico(request)}/widget/c/${tenant.slug}/mi-perfil`,
          cancelUrl: tenant.settings?.citas?.reservaUrl || `${origenPublico(request)}/widget/c/${tenant.slug}`,
          metadata: {
            bookingId: row.id,
            // Lo lee el webhook para crear el bono con el modo correcto.
            pricingMode: compraDeBono.mode,
            instalmentAmount: compraDeBono.instalmentAmount,
            instalmentMonths: compraDeBono.instalmentMonths,
            // El total comprometido, para no tener que multiplicar en tres
            // sitios distintos y arriesgarse a que uno lo haga mal.
            totalComprometido: compraDeBono.total,
          },
        });
        await row.update({ paymentSessionId: checkout.paymentSession.id });
      } catch (err) {
        await row.destroy().catch(() => {});
        process.stderr.write(`[citas:book] checkout del bono falló: ${err.message}\n`);
        return error("No se pudo iniciar el pago. Inténtalo de nuevo en un momento.", 502);
      }

      return created({
        booking: {
          id: row.id,
          scheduledAt: row.scheduledAt.toISOString(),
          duration: row.duration,
          eventTypeName: eventType.name,
          eventTypeColor: eventType.color,
          clientEmail: row.clientEmail,
        },
        paymentRequired: true,
        amount: compraDeBono.amount,
        // El bono se paga en la pantalla de Stripe, no con un formulario de
        // tarjeta embebido: el widget solo tiene que llevarle allí.
        checkoutUrl: checkout.checkoutUrl,
        pricingMode: compraDeBono.mode,
        sessionsCount: Number(eventType.sessionsCount) || 1,
        expiresAt: row.holdExpiresAt?.toISOString() ?? null,
      });
    }

    if (precio) {
      let datosPago;
      try {
        datosPago = await autorizarPago(tenantContext, {
          entityType: "booking",
          entityId: row.id,
          amount: precio,
          description: `${eventType.name} — ${tenant.name}`,
          customerEmail: row.clientEmail,
          metadata: {
            bookingId: row.id,
            // La prueba de qué aceptó, cuándo y por cuánto. La IP la pone el
            // servidor, no el cliente: si viniera del body no probaría nada.
            consentimiento: pruebaDeConsentimiento({
              importeCentimos: precio,
              ip: getClientIp(request),
              // La cadena tal cual llegó, por si algún día hay que enseñar el
              // contexto de una reclamación: la IP sola no dice de dónde salió.
              cadenaProxies: (request.headers.get("x-forwarded-for") || "").slice(0, 300) || null,
            }),
          },
        });
        await row.update({ paymentSessionId: datosPago.paymentSession.id });
      } catch (err) {
        // Si no se puede ni preparar el cobro, la reserva provisional no debe
        // quedarse bloqueando el hueco: se retira ya.
        await row.destroy().catch(() => {});
        process.stderr.write(`[citas:book] autorización falló: ${err.message}\n`);
        return error("No se pudo iniciar el pago. Inténtalo de nuevo en un momento.", 502);
      }

      return created({
        booking: {
          id: row.id,
          scheduledAt: row.scheduledAt.toISOString(),
          duration: row.duration,
          eventTypeName: eventType.name,
          eventTypeColor: eventType.color,
          clientEmail: row.clientEmail,
        },
        paymentRequired: true,
        amount: precio,
        // Lo que el widget necesita para pintar el formulario de tarjeta.
        clientSecret: datosPago.clientSecret,
        publishableKey: datosPago.publishableKey,
        // Hasta cuándo se le guarda la hora mientras rellena. NO es la caducidad
        // del dinero: esa nace después y la pone Stripe.
        expiresAt: row.holdExpiresAt.toISOString(),
      });
    }

    // Campana del CRM (05/08/2026). Este es el camino de las citas SIN cobro:
    // la reserva ya es firme aquí. Las que llevan tarjeta avisan más tarde, al
    // quedar retenido el dinero (`lib/payments/entityHooks.js`), porque hasta
    // entonces no son una solicitud sino un formulario a medias.
    //
    // Sin esto, una cita nueva solo se descubría entrando a mirar la agenda.
    notifyAdmins({
      tenantId: tenant.id,
      tenantModels,
      // Por el estado REAL, no por el modo del centro: una cita que espera en
      // la lista avisada como «reservada» hace que nadie vaya a confirmarla.
      type: row.status === "confirmed" ? "cita_reservada" : "cita_solicitada",
      title: row.status === "confirmed" ? "Nueva cita reservada" : "Nueva solicitud de cita",
      body: `${row.clientName} · ${eventType.name} · ${new Date(row.scheduledAt).toLocaleString("es-ES", {
        timeZone: "Europe/Madrid", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
      })}`,
      entityType: "Booking",
      entityId: row.id,
      dedupe: true,
    }).catch(() => {});

    /*
     * ¿SE LE PUEDE ESCRIBIR? (06/08/2026, Rodrigo)
     *
     * Quien dijo que NO quiere correos de citas no recibe este —el resto del
     * CRM ya lo respetaba (confirmar, cambiar, recordar, WhatsApp); reservar era
     * el único sitio que escribía igual—. Y lo que se le enseña en pantalla
     * tiene que decir lo mismo: prometerle un correo que nadie le va a mandar es
     * peor que no prometer nada.
     *
     * Por defecto SÍ: mientras no haya contestado, se le avisa. Sin ficha
     * todavía —una reserva pública de quien aún no es paciente— también, o se
     * quedaría sin su confirmación.
     */
    const avisarPorEmail = await citaPuedeAvisar(tenantModels, row, "citasEmail");

    /*
     * Email best-effort SEGÚN CÓMO HA NACIDO LA CITA, no según el flag:
     *   - confirmed → bookingConfirmed inmediato
     *   - pending   → bookingReceived (se confirma luego desde /confirm, que
     *     dispara el de confirmada)
     *
     * ⚠️ Antes miraba `autoConfirm` a secas y eso ya no basta (07/08/2026): hay
     * citas que nacen pendientes con el flag encendido —las que se pagan y,
     * desde hoy, las que gastan sesión de un bono—. Mirando el flag se le
     * mandaba «tu cita está confirmada» a alguien cuya cita está esperando en
     * la lista, y se presenta en la consulta un día que nadie le ha dado.
     */
    const nacioConfirmada = row.status === "confirmed";
    try {
      if (!avisarPorEmail) throw new Error("SIN_CONSENTIMIENTO_EMAIL");
      let tpl;
      if (nacioConfirmada) {
        // null si el centro no deja anular a la familia (08/08/2026).
        const cancelUrl = enlaceCancelacion(tenant, { slug: tenant.slug, token: row.cancellationToken });
        tpl = bookingConfirmedTemplate({
          tenantName: tenant.name,
          brand: tenant.settings?.brand,
          clientName: row.clientName,
          eventTypeName: eventType.name,
          scheduledAt: row.scheduledAt,
          duration: row.duration,
          modality: row.modality,
          meetUrl: row.meetUrl,
          cancelUrl,
          location: eventType.location ?? null,
        });
      } else {
        tpl = bookingReceivedTemplate({
          tenantName: tenant.name,
          brand: tenant.settings?.brand,
          clientName: row.clientName,
          eventTypeName: eventType.name,
          scheduledAt: row.scheduledAt,
        });
      }
      // BYOK: el correo de "cita recibida" sale de la cuenta del propio
      // negocio, no de la de Salamandra.
      const cfgResend = getTenantResendConfig({ tenant });
      const envio = await sendEmail({
        to: row.clientEmail,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        from: cfgResend.fromEmail || undefined,
        replyTo: cfgResend.replyTo || undefined,
        apiKey: cfgResend.apiKey || undefined,
      });
      envioRealizado(envio, `citas:book ${row.id}`);
    } catch (mailErr) {
      if (mailErr.message === "SIN_CONSENTIMIENTO_EMAIL") {
        process.stdout.write(`[citas:book] sin correo: no acepta avisos por email (booking=${row.id})\n`);
      } else {
        process.stderr.write(`[citas:book] email fail (autoConfirm=${autoConfirm}): ${mailErr.message}\n`);
      }
    }

    return created({
      booking: {
        id: row.id,
        scheduledAt: row.scheduledAt.toISOString(),
        duration: row.duration,
        eventTypeName: eventType.name,
        eventTypeColor: eventType.color,
        meetUrl: row.meetUrl,
        cancellationToken: row.cancellationToken,
        clientEmail: row.clientEmail,
        // Que la pantalla sepa si esto es una cita CONFIRMADA o una solicitud
        // esperando visto bueno (06/08/2026, Rodrigo). Sin esto decía «Cita
        // confirmada» siempre, también cuando la cita estaba pendiente de que
        // la profesional la aceptara: la paciente se presentaba a una cita que
        // nadie le había dado.
        status: row.status,
        // Y si NO se le ha escrito, la pantalla no puede decir que sí. La
        // decisión es del servidor —depende de lo que la familia haya
        // contestado sobre sus comunicaciones—, así que viaja resuelta.
        avisadoPorEmail: avisarPorEmail,
      },
    });
  } catch (err) {
    return serverError(err);
  }
},
// Segunda capa contra el mismo abuso, esta por origen: el tope de arriba se
// esquiva cambiando de email, este no sin cambiar también de IP. Generoso a
// propósito — una familia reservando desde la misma casa o una oficina con IP
// compartida no pueden verse cortadas por reservar tres veces seguidas.
{ rateLimit: { limit: 20, windowMs: 10 * 60_000, key: "citas-book" } });
