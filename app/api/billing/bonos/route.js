import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { logBillingAudit, datosPeticion } from "../../../../lib/billing/audit.js";
import { limpiarBono, bonoVivoIgual, SESIONES_MAX } from "../../../../lib/billing/bonos.js";
import { bonosConSesiones } from "../../../../lib/billing/bonosConSesiones.js";
import { crearBonoConSuCobro } from "../../../../lib/billing/altaDeBono.js";
import { esPack } from "../../../../lib/citas/packs.js";
import { puedeDarBonos, MOTIVO_SIN_PERMISO } from "../../../../lib/citas/quienDaBonos.js";

/**
 * GET/POST /api/billing/bonos — los bonos de sesiones, desde Facturación
 * (10/09/2026, petición de Rodrigo: «un submódulo en facturación llamado
 * Bonos… es lo mismo que Cuotas pero cambiando la idea a Bonos»).
 *
 * ── QUÉ AÑADE ESTO A `/api/citas/packs`, QUE YA EXISTÍA ────────────────────
 * Aquel endpoint sirve a la FICHA: da un bono a una persona y lista los que le
 * quedan vivos. Nunca supo responder a la pregunta del centro cuando repasa el
 * curso —«¿qué bonos hay vendidos, quién los tiene y cuánto queda por cobrar?»—
 * porque no hay forma de preguntarle por todos: no acepta lista, no trae el
 * cobro y cuenta las sesiones bono a bono (232 consultas en Aumenta).
 *
 * Los dos escriben en la MISMA tabla (`session_packs`) y crean el cobro con la
 * MISMA pieza (`lib/billing/cobroDelBono.js`). No hay una segunda verdad de los
 * bonos: hay dos puertas a la de siempre, una por ficha y otra por el conjunto.
 *
 * GET  — todos los bonos con sus sesiones contadas y su cobro. Filtrable por
 *        tipo, ficha, paciente y estado. Vivos y cerrados en la misma respuesta:
 *        la pantalla los separa, porque un bono agotado no se esconde (es el
 *        que hay que renovar).
 * POST — el alta, individual **o EN GRUPO**, igual que la de cuotas: se manda
 *        una vez lo que comparten (tipo, sesiones, importe, fecha) y la lista de
 *        destinatarios. Quien ya tiene uno vivo del mismo tipo se SALTA con su
 *        motivo, salvo que se pida a propósito — que es el caso normal del
 *        «volver a coger el bono», solo que dicho.
 */

const normalizeEmail = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { searchParams } = new URL(request.url);

    const where = {};
    if (searchParams.get("tipo")) where.eventTypeId = searchParams.get("tipo");
    if (searchParams.get("clientId")) where.clientId = searchParams.get("clientId");
    if (searchParams.get("patientId")) where.patientId = searchParams.get("patientId");
    /*
     * `estado` filtra por la COLUMNA (activo / anulado) y no por «agotado»:
     * agotado no está escrito en ninguna parte, sale de contar las citas
     * (`lib/billing/bonos.js`). Filtrarlo en SQL exigiría un contador guardado,
     * que es justo lo que la tabla evita a propósito desde el primer día.
     */
    const estado = searchParams.get("estado");
    if (estado === "activo") where.status = "active";
    if (estado === "anulado") where.status = "anulado";

    const bonos = await bonosConSesiones({ tenantModels, hasModule, where });
    return ok({ bonos, total: bonos.length });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _ctx, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    // Dar un bono es apuntar un dinero cobrado por fuera: la misma
    // responsabilidad que registrar un cobro (`lib/citas/quienDaBonos.js`).
    const userRole = request.headers.get("x-user-role") ?? "user";
    if (!puedeDarBonos({ role: userRole, hasModule })) return forbidden(MOTIVO_SIN_PERMISO);

    const { SessionPack, EventType, Client, Patient } = tenantModels;
    if (!SessionPack || !EventType) {
      return error("Este centro no tiene bonos de sesiones: hacen falta los tipos de cita del módulo de Citas", 422);
    }

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    // Un destinatario suelto o una lista. La pantalla manda siempre la lista.
    const destinatarios = Array.isArray(body?.destinatarios) && body.destinatarios.length
      ? body.destinatarios
      : [{ clientId: body?.clientId ?? null, patientId: body?.patientId ?? null }];
    if (destinatarios.length > 500) return error("Demasiados destinatarios de una vez (máximo 500)", 422);

    // Lo que comparten todos se valida UNA vez: si el importe o las sesiones
    // están mal, no se crea ninguno.
    const muestra = limpiarBono({ ...body, ...destinatarios[0] });
    if (muestra.problema) return error(muestra.problema, 422);

    const tipo = await EventType.findByPk(muestra.valores.eventTypeId);
    if (!tipo) return error("Ese tipo de bono no existe", 422);

    // Cuántas sesiones: las que se pidan o, en blanco, las que trae el tipo.
    const sesiones = muestra.valores.totalSessions ?? (Number(tipo.sessionsCount) || 1);
    if (!Number.isInteger(sesiones) || sesiones < 1 || sesiones > SESIONES_MAX) {
      return error(`Las sesiones tienen que ser un número entre 1 y ${SESIONES_MAX}`, 422);
    }
    const importe = muestra.valores.amount;
    const compradoEl = muestra.valores.purchasedAt ?? new Date();
    const notes = muestra.valores.notes;
    const permitirDuplicados = body?.permitirDuplicados === true;
    const creador = await quienLoCrea(request, tenantModels);

    /*
     * ── LOS QUE YA TIENEN UNO VIVO ──────────────────────────────────────────
     * Se traen los bonos de este tipo de TODAS las fichas del lote en una
     * consulta —con sus sesiones contadas, que es lo que dice si sigue vivo— y
     * se compara en memoria (`bonoVivoIgual`). Preguntar por destinatario serían
     * cuarenta consultas para un lote de cuarenta.
     */
    const fichasDelLote = [...new Set(destinatarios.map((d) => d?.clientId).filter(Boolean))];
    const yaTienen = permitirDuplicados || !fichasDelLote.length
      ? []
      : await bonosConSesiones({
          tenantModels,
          hasModule,
          where: { clientId: { [Op.in]: fichasDelLote }, eventTypeId: tipo.id, status: "active" },
        });

    const creados = [];
    const omitidos = [];
    let conCobro = 0;

    for (const destino of destinatarios) {
      const { valores, problema } = limpiarBono({ ...body, ...destino });
      if (problema) { omitidos.push({ ...destino, motivo: problema }); continue; }

      let clientId = valores.clientId;
      let patientId = valores.patientId;
      let nombre = null;

      // El paciente arrastra su familia pagadora: es lo que manda el selector
      // de destinatarios, y lo que hace que el bono se pueda cobrar.
      if (patientId) {
        if (!Patient) { omitidos.push({ ...destino, motivo: "este centro no tiene pacientes" }); continue; }
        const paciente = await Patient.findByPk(patientId, { attributes: ["id", "clientId", "firstName", "lastName"] });
        if (!paciente) { omitidos.push({ ...destino, motivo: "ese paciente no existe" }); continue; }
        if (clientId && paciente.clientId && String(paciente.clientId) !== String(clientId)) {
          omitidos.push({ ...destino, motivo: "ese paciente no es de esa ficha" });
          continue;
        }
        if (!clientId) clientId = paciente.clientId;
        nombre = `${paciente.firstName ?? ""} ${paciente.lastName ?? ""}`.trim() || null;
        patientId = paciente.id;
      }

      if (!clientId) { omitidos.push({ ...destino, motivo: "sin ficha no hay a quién cobrarle el bono" }); continue; }

      const ficha = Client ? await Client.findByPk(clientId, { attributes: ["id", "name", "email", "portalEmail"] }) : null;
      if (!ficha) { omitidos.push({ ...destino, motivo: "la ficha no existe" }); continue; }
      if (!nombre) nombre = ficha.name;

      /*
       * El correo es lo que ata las CITAS al bono (el portal identifica por
       * correo verificado, `lib/citas/packs.js`). Se hereda de la ficha; sin
       * correo el bono se ata a la ficha y las citas se le enganchan desde el
       * CRM, que es lo que ya permitía AV-0055.
       */
      const correo = normalizeEmail(body?.clientEmail) || normalizeEmail(ficha.portalEmail || ficha.email);
      if (correo && !isValidEmail(correo)) {
        omitidos.push({ ...destino, nombre, motivo: "el correo de la ficha no tiene un formato válido" });
        continue;
      }

      if (!permitirDuplicados) {
        const vivo = bonoVivoIgual(yaTienen, { eventTypeId: tipo.id, clientId, patientId });
        if (vivo) {
          omitidos.push({
            ...destino,
            nombre,
            bonoId: vivo.id,
            motivo: `ya tiene un bono de «${tipo.name}» con ${vivo.restantes} ${vivo.restantes === 1 ? "sesión" : "sesiones"} sin usar`,
          });
          continue;
        }
      }

      // El bono y su deuda nacen juntos, en la misma transacción y en un solo
      // sitio (`lib/billing/altaDeBono.js`, la regla de AV-0070). Sin importe
      // no nace cobro: un pendiente de cantidad desconocida no es una deuda,
      // es una fila que nadie puede saldar.
      const { bono, cobro } = await crearBonoConSuCobro({
        tenantModels,
        clientId,
        clientEmail: correo || null,
        patientId: patientId || null,
        eventTypeId: tipo.id,
        nombreDelTipo: tipo.name,
        totalSessions: sesiones,
        amount: importe,
        purchasedAt: compradoEl,
        notes,
        creador,
      });
      if (cobro) conCobro += 1;

      creados.push({ id: bono.id, clientId, patientId: patientId || null, nombre, sinCorreo: !correo });
    }

    // ── Avisos, nunca cortes ────────────────────────────────────────────────
    const avisos = [];
    if (!esPack(tipo) && sesiones > 1) {
      avisos.push(`«${tipo.name}» está configurado como cita suelta y le estás dando ${sesiones} sesiones.`);
    }
    if (importe === null && creados.length) {
      avisos.push("Sin importe no nace ningún cobro pendiente: estos bonos no van a salir en Cobros ni en Morosidad.");
    }
    const sinCorreo = creados.filter((c) => c.sinCorreo).length;
    if (sinCorreo) {
      avisos.push(
        `${sinCorreo} ${sinCorreo === 1 ? "ficha no tiene correo: su bono queda atado a la ficha" : "fichas no tienen correo: sus bonos quedan atados a la ficha"}. Las citas se le enganchan desde el CRM, pero no podrá pedirlas desde el área privada.`
      );
    }

    // Auditoría DESPUÉS de mutar, como el resto del dinero. Un lote deja UNA
    // línea con el recuento: cuarenta líneas idénticas no se leen.
    if (creados.length) {
      await logBillingAudit({
        tenantId: tenant.id,
        ...datosPeticion(request),
        action: "bono.created",
        entity: "SessionPack",
        entityId: creados.length === 1 ? creados[0].id : null,
        before: null,
        after: {
          altas: creados.length,
          tipo: tipo.name,
          sesiones,
          // En céntimos, como se guarda.
          importe,
          cobros: conCobro,
          compradoEl: compradoEl instanceof Date ? compradoEl.toISOString() : compradoEl,
        },
      });
    }

    return created({ creados: creados.length, bonos: creados, omitidos, cobros: conCobro, avisos });
  } catch (err) {
    return serverError(err);
  }
});

/** Nombre legible de quien está dando el bono, para dejarlo escrito. */
async function quienLoCrea(request, tenantModels) {
  const userId = request.headers.get("x-user-id");
  try {
    const { TeamMember } = tenantModels;
    if (TeamMember && userId) {
      const tm = await TeamMember.findOne({ where: { userId }, attributes: ["displayName", "email"] });
      if (tm) return tm.displayName || tm.email || userId;
    }
  } catch {
    // Sin ficha de equipo (dirección que no da servicio) o sin tabla: se queda
    // el id, que al menos se puede rastrear con el log de auditoría.
  }
  return userId ?? null;
}
