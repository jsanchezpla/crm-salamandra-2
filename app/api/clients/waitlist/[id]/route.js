import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import { MODULE_KEYS } from "../../../../../lib/tenant/moduleKeys.js";

/**
 * /api/clients/waitlist/[id] — una entrada de la lista de espera de admisión.
 *
 *   PATCH → editar datos, sacarla de la lista (`status: "removed"`) o
 *           CONVERTIRLA en cliente (`convertir: true`), que crea su ficha y deja
 *           la entrada enlazada a ella.
 *
 * Convertir no borra la entrada: queda como `converted` con el `clientId`, para
 * poder responder «¿cuánto esperó esta familia?» cuando alguien lo pregunte.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["active", "converted", "removed"];

// Mismo gate que el listado: `clients_avanzado` (01/08/2026). Si este se
// quedara en `clients`, quien no ve la lista podría seguir convirtiendo
// entradas en clientes llamando a la API a mano.
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

export const PATCH = withTenant(async (request, rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { WaitlistEntry, Client } = ctx.tenantModels;
    if (!WaitlistEntry) return error("La lista de espera no está disponible", 503);
    const fila = await WaitlistEntry.findByPk(id);
    if (!fila) return notFound("Entrada no encontrada");

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }

    // ── Convertir en cliente ──────────────────────────────────────────────
    if (body?.convertir === true) {
      if (fila.clientId) return error("Esta entrada ya se convirtió en cliente", 409);
      if (!Client) return error("El módulo de clientes no está disponible", 503);

      const cliente = await Client.create({
        type: "individual",
        name: fila.name,
        email: fila.email || null,
        phone: fila.phone || null,
        status: "active",
        customFields: { origin: "lista_espera" },
      });
      await fila.update({ status: "converted", clientId: cliente.id });

      await auditar({
        tenantId: ctx.tenant.id,
        ...datosPeticion(request),
        action: "client.waitlist.converted",
        entity: "WaitlistEntry",
        entityId: id,
        after: { clientId: cliente.id },
      });
      return ok({ id, status: "converted", clientId: cliente.id });
    }

    // ── Editar / sacar de la lista ────────────────────────────────────────
    const updates = {};
    if ("name" in body) {
      const n = limpio(body.name);
      if (!n) return error("El nombre no puede quedar vacío", 422);
      updates.name = n;
    }
    if ("phone" in body) updates.phone = limpio(body.phone, 50);
    if ("email" in body) updates.email = limpio(body.email, 255);
    if ("specialty" in body) updates.specialty = limpio(body.specialty, 40);
    if ("notes" in body) updates.notes = limpio(body.notes, 2000);
    if ("status" in body) {
      if (!STATUSES.includes(body.status)) return error("status inválido", 422);
      updates.status = body.status;
    }
    if (Object.keys(updates).length === 0) return ok({ id });

    await fila.update(updates);
    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: updates.status === "removed" ? "client.waitlist.removed" : "client.waitlist.updated",
      entity: "WaitlistEntry",
      entityId: id,
      after: { estado: fila.status },
    });
    return ok({ id, status: fila.status });
  } catch (err) {
    return serverError(err);
  }
});
