import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { tenantTieneWhatsapp } from "../../../../../lib/whatsapp/whatsappConfig.js";

/**
 * GET /api/clients/[id]/whatsapp — la conversación de WhatsApp de esta ficha.
 *
 * Lee `whatsapp_messages`, que es donde el webhook deja lo que llega y
 * `enviarWhatsappPlantilla` lo que sale. La Cloud API no guarda conversaciones
 * —empuja cada mensaje y se olvida—, así que esto no consulta a Meta: lo que no
 * esté en nuestra tabla no está en ningún sitio.
 *
 * Mismo permiso que la ficha (`clients`) y nada más: quien puede abrir a un
 * paciente puede leer lo que le ha escrito el centro. Poner aquí una puerta más
 * estrecha que la de la propia ficha sería teatro — los mismos datos personales
 * están dos pestañas más allá.
 *
 * Paginación hacia ATRÁS (`?antes=<ISO>`): el hilo se lee por el final, y con
 * la coexistencia pueden entrar 180 días de historial de golpe. Se devuelven los
 * más recientes y se van pidiendo los viejos según se sube.
 */

const POR_PAGINA = 50;

function serializar(m) {
  return {
    id: m.id,
    direction: m.direction,
    origin: m.origin,
    type: m.type,
    body: m.body,
    status: m.status,
    errorMessage: m.errorMessage,
    sentAt: m.sentAt,
    phone: m.phone,
  };
}

export const GET = withTenant(async (request, { params }, ctx) => {
  const { tenantModels, hasModule } = ctx;
  if (!hasModule("clients")) return forbidden();

  const { WhatsappMessage } = tenantModels;
  // Un schema que aún no tenga la tabla (migración sin pasar) no debe tumbar la
  // ficha entera: se responde vacío y la pestaña ni aparece.
  if (!WhatsappMessage) return ok({ configurado: false, mensajes: [], hayMas: false });

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const antes = searchParams.get("antes");

  const where = { clientId: id };
  if (antes) {
    const fecha = new Date(antes);
    if (!Number.isNaN(fecha.getTime())) where.sentAt = { [Op.lt]: fecha };
  }

  // Se piden N+1 para saber si queda algo más atrás sin contar la tabla entera.
  const filas = await WhatsappMessage.findAll({
    where,
    order: [["sentAt", "DESC"], ["createdAt", "DESC"]],
    limit: POR_PAGINA + 1,
  });

  const hayMas = filas.length > POR_PAGINA;
  const pagina = hayMas ? filas.slice(0, POR_PAGINA) : filas;

  return ok({
    // Para poder distinguir en pantalla "este centro no tiene WhatsApp" de
    // "no se han escrito nunca", que no es lo mismo.
    configurado: tenantTieneWhatsapp(ctx),
    // De vuelta en orden de lectura: el más antiguo arriba.
    mensajes: pagina.reverse().map(serializar),
    hayMas,
  });
});
