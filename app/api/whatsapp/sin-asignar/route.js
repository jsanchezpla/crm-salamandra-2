import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, error, notFound } from "../../../../lib/utils/apiResponse.js";
import { soloDigitos } from "../../../../lib/whatsapp/inbox.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";

/**
 * /api/whatsapp/sin-asignar — los WhatsApp que no son de nadie (todavía).
 *
 * ── POR QUÉ HACE FALTA ───────────────────────────────────────────────────────
 * `whatsapp_messages` guarda los mensajes ENCUENTRE O NO a quién pertenecen: un
 * familiar, un número nuevo, alguien que aún no es paciente. Eso está bien —
 * tirarlos sería el fallo que el módulo viene a evitar— pero el único sitio
 * donde se ven es la ficha de un cliente, así que **un mensaje sin ficha no lo
 * veía nadie**. Se guardaban para nadie.
 *
 * Esta bandeja los saca a la luz agrupados por número, que es como se leen: una
 * conversación por teléfono, no una lista de mensajes sueltos.
 *
 * ── ASIGNAR TIENE QUE SER DEFINITIVO ─────────────────────────────────────────
 * Al asignar no solo se enganchan los mensajes que ya hay: el número se guarda
 * como teléfono secundario de la ficha (`ClientContactMethod`), que es donde
 * `buscarClientePorTelefono` mira ahora. Sin eso, el siguiente mensaje del mismo
 * número volvería a caer aquí y la bandeja sería una noria.
 */

const LIMITE = 100;

export const GET = withTenant(async (request, _routeContext, ctx) => {
  const { tenantModels, hasModule, tenantSequelize } = ctx;
  if (!hasModule("clients")) return forbidden();

  const { WhatsappMessage } = tenantModels;
  if (!WhatsappMessage) return ok({ total: 0, conversaciones: [] });

  const t = WhatsappMessage.getTableName();
  const tabla = typeof t === "string" ? `"${t}"` : `"${t.schema}"."${t.tableName}"`;

  const { searchParams } = new URL(request.url);

  // El sidebar solo necesita saber si hay trabajo y cuánto. Contar en la base
  // en vez de traerse las filas: esto se pide en CADA carga de página.
  if (searchParams.get("soloTotales") === "1") {
    try {
      const [filas] = await tenantSequelize.query(
        `SELECT count(*)::int AS mensajes, count(DISTINCT phone)::int AS conversaciones
           FROM ${tabla} WHERE client_id IS NULL`
      );
      return ok({ total: filas[0]?.conversaciones ?? 0, mensajes: filas[0]?.mensajes ?? 0 });
    } catch {
      // Schema sin la tabla (migración sin pasar): no hay trabajo pendiente.
      return ok({ total: 0, mensajes: 0 });
    }
  }

  // Una fila por número: el último mensaje, cuántos hay y desde cuándo. Todo en
  // una consulta con funciones de ventana, que es lo que evita el clásico
  // "una consulta por conversación".
  try {
    const [filas] = await tenantSequelize.query(
      `SELECT phone, total, primero_at, body, sent_at, direction, type FROM (
         SELECT phone, body, sent_at, direction, type,
                count(*)     OVER (PARTITION BY phone) AS total,
                min(sent_at) OVER (PARTITION BY phone) AS primero_at,
                row_number() OVER (PARTITION BY phone ORDER BY sent_at DESC, created_at DESC) AS rn
           FROM ${tabla}
          WHERE client_id IS NULL
       ) t
       WHERE rn = 1
       ORDER BY sent_at DESC
       LIMIT ${LIMITE}`
    );

    return ok({
      total: filas.length,
      hayMas: filas.length === LIMITE,
      conversaciones: filas.map((f) => ({
        phone: f.phone,
        total: Number(f.total),
        desde: f.primero_at,
        ultimo: { body: f.body, sentAt: f.sent_at, direction: f.direction, type: f.type },
      })),
    });
  } catch {
    return ok({ total: 0, hayMas: false, conversaciones: [] });
  }
});

/**
 * POST — «esta conversación es de esta persona».
 *
 * Engancha TODOS los mensajes sueltos de ese número a la ficha y deja el número
 * registrado en ella para que los siguientes entren solos.
 */
export const POST = withTenant(async (request, _routeContext, ctx) => {
  const { tenantModels, hasModule } = ctx;
  if (!hasModule("clients")) return forbidden();

  const { WhatsappMessage, Client, ClientContactMethod } = tenantModels;
  if (!WhatsappMessage) return error("Este cliente no tiene WhatsApp", 400);

  const body = await request.json().catch(() => ({}));
  const phone = soloDigitos(body?.phone);
  const clientId = String(body?.clientId ?? "").trim();

  if (!phone) return error("Teléfono no válido", 422);
  if (!clientId) return error("Falta la ficha a la que asignar", 422);

  const ficha = await Client.findByPk(clientId, { attributes: ["id", "name", "phone"] });
  if (!ficha) return notFound("Cliente no encontrado");

  // Solo los que están sueltos: si alguno ya tiene ficha (otra), no se le toca.
  // Reasignar por lotes lo que alguien decidió antes sería pisarle el trabajo.
  const [asignados] = await WhatsappMessage.update(
    { clientId: ficha.id },
    { where: { phone, clientId: null } }
  );

  // Que el número quede en la ficha, o esto se repite cada semana. Best-effort:
  // si falla, los mensajes YA están asignados y decir que no se hizo nada sería
  // mentir; queda el aviso en el log.
  let recordado = false;
  const yaEsElPrincipal = soloDigitos(ficha.phone).slice(-9) === phone.slice(-9);
  if (!yaEsElPrincipal && ClientContactMethod) {
    try {
      const existentes = await ClientContactMethod.findAll({
        where: { clientId: ficha.id, kind: "phone" },
        attributes: ["id", "value"],
      });
      const yaEsta = existentes.some((m) => soloDigitos(m.value).slice(-9) === phone.slice(-9));
      if (!yaEsta) {
        await ClientContactMethod.create({
          clientId: ficha.id,
          kind: "phone",
          value: `+${phone}`,
          label: "WhatsApp",
          // NUNCA principal: el principal es el que usa facturación, los avisos
          // de cita y el acceso al portal. Un número que apareció en un mensaje
          // no puede desplazar al que la persona dio en su alta.
          isPrimary: false,
        });
        recordado = true;
      }
    } catch (err) {
      process.stderr.write(`[whatsapp:sin-asignar] no se pudo guardar el teléfono en la ficha: ${err.message}\n`);
    }
  }

  // Queda rastro: esto decide quién puede leer una conversación.
  const { userId, ip } = datosPeticion(request);
  await auditar({
    tenantId: ctx.tenant.id,
    userId,
    action: "whatsapp.conversacion_asignada",
    entity: "Client",
    entityId: ficha.id,
    before: { cliente: null },
    after: { cliente: ficha.name, telefono: `+${phone}`, mensajes: asignados },
    ip,
  });

  return ok({ asignados, recordado, cliente: { id: ficha.id, name: ficha.name } });
});
