import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { created, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { logBillingAudit, datosPeticion } from "../../../../../../lib/billing/audit.js";
import { limpiarBono, renovacionDe, avisosDeRenovacion, SESIONES_MAX } from "../../../../../../lib/billing/bonos.js";
import { bonosConSesiones } from "../../../../../../lib/billing/bonosConSesiones.js";
import { crearBonoConSuCobro } from "../../../../../../lib/billing/altaDeBono.js";
import { puedeDarBonos, MOTIVO_SIN_PERMISO } from "../../../../../../lib/citas/quienDaBonos.js";

/**
 * POST /api/billing/bonos/[id]/renovar — VOLVER A COGER EL BONO (10/09/2026,
 * Rodrigo: «pueden volver a coger el bono si quieren»).
 *
 * ── POR QUÉ ES UN BONO NUEVO Y NO EL DE ANTES REABIERTO ────────────────────
 * Reabrir el agotado —subirle las sesiones de 10 a 20— sería más corto y estaría
 * mal: sus diez primeras sesiones se dieron en unas fechas, se cobraron con un
 * precio y salieron en una factura. Un bono con veinte no puede explicar nada de
 * eso, y la sesión 11 volvería a llamarse «la 1 de veinte». La tabla se llama
 * `session_packs` en plural por esto mismo, y su cabecera lo dice desde el
 * primer día: una persona puede terminar un bono de 10 y comprar otro.
 *
 * Así que renovar = otra fila, con su fecha, su importe y su cobro pendiente. El
 * anterior se queda como está: agotado, anulado o incluso vivo.
 *
 * ── QUÉ SE COPIA Y QUÉ NO ──────────────────────────────────────────────────
 * Lo decide `renovacionDe` en `lib/billing/bonos.js`, con su prueba: mismo tipo,
 * mismas sesiones, mismo importe y mismo paciente; y NADA de las sesiones ya
 * gastadas, del estado ni de la nota del trato anterior. En el cuerpo se puede
 * cambiar el importe o las sesiones («este año le hago 8 en vez de 6») sin salir
 * del botón.
 *
 * Nunca corta por tener uno vivo: es legítimo comprar el siguiente antes de
 * agotar el actual. Pero lo dice —`avisosDeRenovacion`—, porque las citas
 * gastarán primero el antiguo y esa es la duda que llega por teléfono.
 */
export const POST = withTenant(async (request, ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    if (!puedeDarBonos({ role: userRole, hasModule })) return forbidden(MOTIVO_SIN_PERMISO);

    const { SessionPack, EventType } = tenantModels;
    if (!SessionPack) return notFound("Ese bono no existe");

    const { id } = (await ctx?.params) ?? {};
    const [antes] = await bonosConSesiones({ tenantModels, hasModule, where: { id } });
    if (!antes) return notFound("Ese bono no existe");
    if (!antes.clientId) return error("Ese bono no está atado a ninguna ficha: no se puede renovar ni cobrar", 422);

    let body = {};
    try { body = (await request.json()) ?? {}; } catch { body = {}; }

    // Lo que se pida cambiar se valida con la misma pieza que el alta, para que
    // un importe mal escrito dé la misma frase en las dos pantallas.
    const pedido = limpiarBono(body, { parcial: true });
    if (pedido.problema) return error(pedido.problema, 422);
    const cambios = {};
    for (const campo of ["totalSessions", "amount", "notes", "patientId", "purchasedAt"]) {
      if (campo in body) cambios[campo] = pedido.valores[campo];
    }

    const valores = renovacionDe(antes, cambios);
    const tipo = EventType ? await EventType.findByPk(valores.eventTypeId) : null;
    if (!tipo) return error("El tipo de bono ya no está en el catálogo: da el bono nuevo desde el alta", 422);

    const sesiones = valores.totalSessions ?? (Number(tipo.sessionsCount) || 1);
    if (!Number.isInteger(sesiones) || sesiones < 1 || sesiones > SESIONES_MAX) {
      return error(`Las sesiones tienen que ser un número entre 1 y ${SESIONES_MAX}`, 422);
    }

    const { bono, cobro } = await crearBonoConSuCobro({
      tenantModels,
      clientId: valores.clientId,
      // El mismo correo que el anterior: es lo que ata las citas al bono, y si
      // aquel funcionaba este también.
      clientEmail: antes.correo || null,
      patientId: valores.patientId,
      eventTypeId: tipo.id,
      nombreDelTipo: tipo.name,
      totalSessions: sesiones,
      amount: valores.amount,
      purchasedAt: cambios.purchasedAt ?? null,
      notes: valores.notes,
      creador: request.headers.get("x-user-id") ?? null,
    });

    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "bono.renovado",
      entity: "SessionPack",
      entityId: bono.id,
      before: { bonoAnterior: antes.id, estado: antes.status, usadas: antes.gastadas, de: antes.total },
      after: { tipo: tipo.name, sesiones, importe: valores.amount, cobro },
    });

    const [nuevo] = await bonosConSesiones({ tenantModels, hasModule, where: { id: bono.id } });
    return created({ bono: nuevo, cobro, avisos: avisosDeRenovacion(antes) });
  } catch (err) {
    return serverError(err);
  }
});
