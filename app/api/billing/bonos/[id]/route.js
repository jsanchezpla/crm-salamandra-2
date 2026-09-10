import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { logBillingAudit, datosPeticion } from "../../../../../lib/billing/audit.js";
import { limpiarBono, esNotaAutomaticaDeBono, SESIONES_MAX } from "../../../../../lib/billing/bonos.js";
import { bonosConSesiones } from "../../../../../lib/billing/bonosConSesiones.js";
import { cobroPendienteDeBono, textoDelCobroDeBono, eurosDelBono } from "../../../../../lib/billing/cobroDelBono.js";
import { cobroSePuedeRehacer } from "../../../../../lib/billing/cuotas.js";
import { puedeDarBonos, MOTIVO_SIN_PERMISO } from "../../../../../lib/citas/quienDaBonos.js";

/**
 * GET/PATCH /api/billing/bonos/[id] — un bono y lo que se le puede cambiar
 * (10/09/2026, submódulo Bonos).
 *
 * ── LO QUE ESTO AÑADE A `/api/citas/packs/[id]` ────────────────────────────
 * Aquel solo sabe anular y escribir la nota, que es lo que necesita la ficha.
 * Desde Facturación hay que poder corregir lo que se teclea mal el primer día
 * —el importe, las sesiones, de qué hijo es, la fecha de compra— y, sobre todo,
 * que **su cobro se entere**. Ese era el agujero: cambiar un bono de 150 a 180 €
 * dejaba en Cobros un pendiente de 150 € que ya no se correspondía con nada, y
 * la única salida era borrar el bono y volver a darlo.
 *
 * ── LAS TRES REGLAS DEL DINERO ─────────────────────────────────────────────
 *   · **Un cobro que ya es un hecho no se reescribe.** Cobrado, facturado, con
 *     Stripe o casado con el banco: se deja en paz y se dice en la respuesta
 *     (`cobroSePuedeRehacer`, la misma regla que las cuotas).
 *   · **Anular el bono retira su deuda.** Si el bono se cancela, el pendiente
 *     que nadie va a pagar se va con él; lo que ya se cobró se queda, porque
 *     eso pasó de verdad (para devolverlo está «Devuelto» en Caja).
 *   · **Reactivarlo la vuelve a poner**, si el bono vale dinero y no le quedó
 *     ningún cobro. Un bono activo sin deuda ni cobro es un bono regalado sin
 *     que nadie lo haya dicho.
 *
 * El bono no se BORRA nunca, ni desde aquí: se anula. Borrarlo dejaría citas
 * numeradas («sesión 7 de 10») apuntando a un bono que ya no existe, y es la
 * regla de `models/tenant/SessionPack.model.js` desde el primer día.
 */

export const GET = withTenant(async (_request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { id } = (await ctx?.params) ?? {};
    const [bono] = await bonosConSesiones({ tenantModels, hasModule, where: { id } });
    if (!bono) return notFound("Ese bono no existe");
    return ok({ bono });
  } catch (err) {
    return serverError(err);
  }
});

export const PATCH = withTenant(async (request, ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    if (!puedeDarBonos({ role: userRole, hasModule })) return forbidden(MOTIVO_SIN_PERMISO);

    const { SessionPack, EventType, Patient, Payment } = tenantModels;
    if (!SessionPack) return notFound("Ese bono no existe");

    const { id } = (await ctx?.params) ?? {};
    const pack = await SessionPack.findByPk(id);
    if (!pack) return notFound("Ese bono no existe");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const { valores, problema } = limpiarBono(body, { parcial: true });
    if (problema) return error(problema, 422);
    // El tipo de bono no se cambia: sería otro bono, con otras sesiones y otro
    // precio, y las citas ya enganchadas dejarían de cuadrar. Para eso está
    // anular y volver a darlo.
    delete valores.eventTypeId;
    delete valores.clientId;
    if (!Object.keys(valores).length) return error("Nada que cambiar", 422);

    // Las sesiones y el estado se juzgan contra lo que YA se ha usado, así que
    // hace falta el bono contado, no la fila cruda.
    const [antes] = await bonosConSesiones({ tenantModels, hasModule, where: { id: pack.id } });
    if (!antes) return notFound("Ese bono no existe");

    if ("totalSessions" in valores) {
      const n = valores.totalSessions;
      if (n === null) delete valores.totalSessions; // vacío en el PATCH = no lo toques
      else if (n > SESIONES_MAX) return error(`Las sesiones no pueden pasar de ${SESIONES_MAX}`, 422);
      else if (n < antes.gastadas) {
        return error(
          `Ya ha usado ${antes.gastadas} ${antes.gastadas === 1 ? "sesión" : "sesiones"} de este bono: no se puede dejar en ${n}.`,
          422
        );
      }
    }

    if (valores.patientId) {
      if (!Patient) return error("Este centro no tiene pacientes", 422);
      const paciente = await Patient.findByPk(valores.patientId, { attributes: ["id", "clientId"] });
      if (!paciente) return error("Ese paciente no existe", 422);
      if (pack.clientId && paciente.clientId && String(paciente.clientId) !== String(pack.clientId)) {
        return error("Ese paciente no es de la ficha que pagó el bono", 422);
      }
    }

    const tipo = EventType ? await EventType.findByPk(pack.eventTypeId) : null;
    const antesFila = {
      totalSessions: pack.totalSessions,
      amount: pack.amount,
      patientId: pack.patientId,
      status: pack.status,
      purchasedAt: pack.purchasedAt,
      notes: pack.notes,
    };

    await pack.update(valores);

    /*
     * ── Y SU COBRO ──────────────────────────────────────────────────────────
     * Fuera de la transacción del bono a propósito: el bono ya está corregido y
     * lo que se cuente aquí es un ajuste del pendiente, que la respuesta dice
     * en voz alta. Si esto fallara, el bono queda bien y su cobro se puede
     * arreglar desde Cobros; al revés —un bono a medias— no se puede arreglar
     * desde ninguna parte.
     */
    const dinero = await ajustarElCobro({
      Payment,
      pack,
      antes,
      tipoNombre: tipo?.name ?? null,
      cambios: valores,
    });

    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: valores.status === "anulado" ? "bono.anulado" : "bono.updated",
      entity: "SessionPack",
      entityId: pack.id,
      before: antesFila,
      after: { ...valores, tipo: tipo?.name ?? null, cobro: dinero },
    });

    const [despues] = await bonosConSesiones({ tenantModels, hasModule, where: { id: pack.id } });
    return ok({ bono: despues, cobro: dinero });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * QUÉ LE PASA AL COBRO DEL BONO CUANDO EL BONO CAMBIA.
 *
 * Devuelve un parte de lo ocurrido —`{ accion, motivo, importe }`— porque la
 * pantalla tiene que poder decirlo: «bono corregido y su pendiente puesto en
 * 180 €» o «bono corregido, pero su cobro ya está facturado y no se ha tocado».
 * Un ajuste de dinero silencioso es el que nadie revisa.
 */
async function ajustarElCobro({ Payment, pack, antes, tipoNombre, cambios }) {
  if (!Payment) return { accion: "nada", motivo: "este centro no lleva cobros" };

  const cobros = antes?.cobro?.cobros ?? [];
  const pendientes = cobros.filter((c) => c.status === "pending" && !c.refundedAt);
  const importe = Number.isInteger(pack.amount) ? pack.amount : null;

  // ── El bono se anula: su deuda se va con él ───────────────────────────────
  if (cambios.status === "anulado") {
    const retirables = pendientes.filter((c) => cobroSePuedeRehacer(c).ok);
    if (!retirables.length) {
      return pendientes.length
        ? { accion: "nada", motivo: "su cobro pendiente no se puede retirar (facturado o con un pago en marcha)" }
        : { accion: "nada", motivo: "no tenía cobro pendiente" };
    }
    await Payment.destroy({ where: { id: retirables.map((c) => c.id) } });
    return { accion: "retirado", cobros: retirables.length };
  }

  // ── Se reactiva: si vale dinero y no le queda cobro, vuelve a deberlo ─────
  if (cambios.status === "active" && !cobros.length && importe) {
    const fila = cobroPendienteDeBono({
      amount: importe,
      clientId: pack.clientId,
      patientId: pack.patientId,
      packId: pack.id,
      nombre: tipoNombre,
      sesiones: pack.totalSessions,
      compradoEl: pack.purchasedAt,
    });
    if (!fila) return { accion: "nada", motivo: "sin importe no hay deuda que apuntar" };
    await Payment.create(fila);
    return { accion: "creado", importe: fila.amount };
  }

  // ── Cambió el importe, las sesiones o el paciente ─────────────────────────
  const tocaImporte = "amount" in cambios && Number(antes.amount ?? null) !== Number(importe ?? null);
  const tocaSesiones = "totalSessions" in cambios && Number(antes.total) !== Number(pack.totalSessions);
  const tocaPaciente = "patientId" in cambios;
  if (!tocaImporte && !tocaSesiones && !tocaPaciente) return { accion: "nada", motivo: null };

  // Sin cobro todavía y ahora vale dinero: nace su pendiente (el caso de Rosa,
  // que dio bonos sin importe y luego les puso precio).
  if (!cobros.length) {
    if (!importe) return { accion: "nada", motivo: "sin importe no hay deuda que apuntar" };
    const fila = cobroPendienteDeBono({
      amount: importe,
      clientId: pack.clientId,
      patientId: pack.patientId,
      packId: pack.id,
      nombre: tipoNombre,
      sesiones: pack.totalSessions,
      compradoEl: pack.purchasedAt,
    });
    if (!fila) return { accion: "nada", motivo: "sin importe no hay deuda que apuntar" };
    await Payment.create(fila);
    return { accion: "creado", importe: fila.amount };
  }

  // Con un solo pendiente y sin nada del mundo real detrás, se pone al día.
  // Con varios (un cobro partido en Cobros) no: repartir la diferencia entre
  // las partes es una decisión de quien las partió, no de este endpoint.
  if (pendientes.length !== 1) {
    return {
      accion: "nada",
      motivo: pendientes.length
        ? "este bono tiene el cobro partido en varias filas: ajústalas en Cobros"
        : "su cobro ya está cobrado o facturado: no se ha tocado",
    };
  }
  const pendiente = pendientes[0];
  const sePuede = cobroSePuedeRehacer(pendiente);
  if (!sePuede.ok) return { accion: "nada", motivo: `${sePuede.motivo}: no se ha tocado` };

  const updates = {};
  if (tocaImporte) {
    if (!importe) {
      // El bono se queda sin importe: su pendiente ya no representa nada.
      await Payment.destroy({ where: { id: pendiente.id } });
      return { accion: "retirado", cobros: 1, motivo: "el bono se ha quedado sin importe" };
    }
    updates.amount = eurosDelBono(importe);
  }
  if (tocaPaciente) updates.patientId = pack.patientId ?? null;
  // La nota lleva el tipo y las sesiones: se rehace solo si la escribió el
  // programa (`esNotaAutomaticaDeBono`).
  if (tocaSesiones && esNotaAutomaticaDeBono(pendiente.notes)) {
    updates.notes = textoDelCobroDeBono({ nombre: tipoNombre, sesiones: pack.totalSessions });
  }
  if (!Object.keys(updates).length) return { accion: "nada", motivo: null };

  await Payment.update(updates, { where: { id: pendiente.id } });
  return { accion: "al día", importe: updates.amount ?? pendiente.amount };
}
