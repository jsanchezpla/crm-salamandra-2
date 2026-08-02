import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { MODULE_KEYS } from "../../../../lib/tenant/moduleKeys.js";
import { terapeutaValido } from "../../../../lib/clients/listaEspera.js";

/**
 * /api/clients/waitlist — LISTA DE ESPERA DE ADMISIÓN (sprint Aumenta 2026-07,
 * punto 9).
 *
 * ⚠️ NO es la «lista de espera» de Citas. Aquella son solicitudes de reserva
 * concretas (bookings en `pending`, con fecha y hora pedidas). Esta es gente
 * esperando PLAZA en el centro: sin cita, sin fecha, por orden de llegada. Se
 * llama «de admisión» justamente para que nadie las confunda al hablar.
 *
 *   GET  → cola por orden de llegada (`?status=` para ver convertidos/salidos)
 *   POST → mete a alguien al final de la cola
 */

const STATUSES = ["active", "converted", "removed"];

// Gatea por `clients_avanzado`, no por `clients` (01/08/2026): la admisión por
// cola es de un centro que reparte plazas, no de todo el que tiene fichas de
// cliente. Ver lib/tenant/moduleKeys.js.
function gate(ctx) {
  return ctx.hasModule(MODULE_KEYS.CLIENTS_AVANZADO)
    ? null
    : forbidden("Módulo clients_avanzado no activo");
}

const limpio = (v, max = 200) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Comprueba que el profesional existe EN ESTE tenant.
 *
 * Devuelve el id si vale, `null` si no se ha indicado ninguno (entrar en la
 * cola sin terapeuta es el caso normal) y `false` si el id no corresponde a
 * nadie del equipo. Se distingue `null` de `false` a propósito: "no asignar"
 * y "asignar a alguien que no existe" son cosas distintas, y la segunda tiene
 * que dar error en vez de guardarse como si nada.
 */

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { WaitlistEntry } = ctx.tenantModels;
    if (!WaitlistEntry) return ok({ entries: [], total: 0 });

    const sp = new URL(request.url).searchParams;
    const status = STATUSES.includes(sp.get("status")) ? sp.get("status") : "active";
    const rows = await WaitlistEntry.findAll({
      where: { status },
      order: [["position", "ASC"]],
      limit: 500,
    });

    // El nombre del profesional asignado, resuelto de una vez para toda la
    // página. Se hace aquí y no con un include porque no hay asociación
    // declarada entre WaitlistEntry y TeamMember (el enlace es lógico, como el
    // resto del CRM) y montarla solo para esto sería tocar el modelo.
    const { TeamMember } = ctx.tenantModels;
    const idsTerapeutas = [...new Set(rows.map((r) => r.assignedTherapistId).filter(Boolean))];
    const nombres = new Map();
    if (TeamMember && idsTerapeutas.length) {
      // Un tenant puede tener la cola de admisión y NO el módulo de equipo, en
      // cuyo caso `team_members` no existe en su schema. Que falte el nombre del
      // profesional no puede tumbar la lista de espera entera.
      try {
        const miembros = await TeamMember.findAll({
          where: { id: idsTerapeutas },
          attributes: ["id", "displayName"],
        });
        for (const m of miembros) nombres.set(m.id, m.displayName);
      } catch {
        /* sin equipo: las filas salen sin nombre, que es justo lo que hay */
      }
    }

    return ok({
      entries: rows.map((r) => {
        const j = r.toJSON();
        return {
          id: j.id,
          name: j.name,
          phone: j.phone,
          email: j.email,
          specialty: j.specialty,
          notes: j.notes,
          status: j.status,
          position: j.position,
          clientId: j.clientId,
          assignedTherapistId: j.assignedTherapistId ?? null,
          // `null` cuando el profesional ya no está: la fila sigue en la cola y
          // se ve que está pendiente de reasignar, que es la información útil.
          assignedTherapistName: j.assignedTherapistId ? (nombres.get(j.assignedTherapistId) ?? null) : null,
          createdAt: j.createdAt,
        };
      }),
      total: rows.length,
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { WaitlistEntry } = ctx.tenantModels;
    if (!WaitlistEntry) return error("La lista de espera no está disponible en este cliente", 503);

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }
    const name = limpio(body?.name);
    if (!name) return error("El nombre es obligatorio", 422);

    // Al final de la cola: la lista es por ORDEN DE LLEGADA, y colar a alguien
    // tiene que ser un acto explícito (mover), no un efecto de cómo se creó.
    const ultima = await WaitlistEntry.findOne({ order: [["position", "DESC"]], attributes: ["position"] });
    const position = (ultima?.position ?? 0) + 1;

    // El terapeuta se valida contra la plantilla del propio tenant antes de
    // guardarlo: un UUID cualquiera dejaría la fila apuntando a nadie y la
    // lista enseñaría "sin asignar" sin que nadie entienda por qué.
    const terapeuta = await terapeutaValido(ctx, body?.assignedTherapistId);
    if (terapeuta === false) return error("El profesional indicado no existe en el equipo", 422);

    const fila = await WaitlistEntry.create({
      name,
      phone: limpio(body?.phone, 50),
      email: limpio(body?.email, 255),
      specialty: limpio(body?.specialty, 40),
      notes: limpio(body?.notes, 2000),
      status: "active",
      position,
      assignedTherapistId: terapeuta,
    });

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "client.waitlist.added",
      entity: "WaitlistEntry",
      entityId: fila.id,
      // Sin nombre ni teléfono: la auditoría vive en master y esto es una
      // persona que ni siquiera es cliente todavía.
      after: { posicion: position },
    });

    return created({ id: fila.id, position });
  } catch (err) {
    return serverError(err);
  }
});

export const PATCH = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { WaitlistEntry } = ctx.tenantModels;
    if (!WaitlistEntry) return error("La lista de espera no está disponible", 503);

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }
    // Reordenar: { orden: [id, id, …] } tal cual queda la cola en pantalla.
    if (!Array.isArray(body?.orden)) return error("Se espera orden: [ids]", 422);

    const ids = body.orden.filter((x) => typeof x === "string");
    const filas = await WaitlistEntry.findAll({ where: { id: { [Op.in]: ids } } });
    const porId = new Map(filas.map((f) => [String(f.id), f]));
    let pos = 1;
    for (const id of ids) {
      const fila = porId.get(String(id));
      if (!fila) continue;
      await fila.update({ position: pos++ });
    }

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "client.waitlist.reordered",
      entity: "WaitlistEntry",
      entityId: null,
      after: { entradas: ids.length },
    });

    return ok({ orden: ids });
  } catch (err) {
    return serverError(err);
  }
});
