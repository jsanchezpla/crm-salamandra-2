import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, serverError } from "../../../../lib/utils/apiResponse.js";
import { serializarAviso, ESTADOS, PRIORIDADES, ASIGNABLES, TIPOS } from "../../../../lib/buzon/buzon.js";
import { listarParaSalamandra } from "../../../../lib/buzon/buzonStore.js";
import { candadoBuzon } from "../../../../lib/buzon/candadoBackoffice.js";

/**
 * GET /api/admin/buzon — lo que nos han escrito los clientes.
 *
 * Filtros por query: `estado` (o `activos` / `todos`), `tenantSlug`,
 * `asignadoA` (o `nadie`), `q`.
 *
 * El recuento de las pestañas va SIN los filtros de pantalla, a propósito: una
 * pestaña que cuenta solo lo que ya estás mirando no dice nada.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = candadoBuzon(request, ctx);
    if (veto) return veto;

    const url = new URL(request.url);
    const { avisos, recuento, soloLectura } = await listarParaSalamandra({
      estado: url.searchParams.get("estado") ?? "activos",
      tenantSlug: url.searchParams.get("tenantSlug") ?? undefined,
      asignadoA: url.searchParams.get("asignadoA") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    });

    return ok({
      avisos: avisos.map((a) => serializarAviso(a, { para: "salamandra" })),
      recuento,
      // Las tablas todavía no existen: la pantalla lo dice con el comando en vez
      // de enseñar una bandeja vacía que parece que nadie ha escrito nunca.
      soloLectura,
      estados: ESTADOS,
      prioridades: PRIORIDADES,
      tipos: TIPOS,
      asignables: ASIGNABLES,
    });
  } catch (err) {
    return serverError(err);
  }
});
