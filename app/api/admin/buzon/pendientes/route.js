import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, serverError } from "../../../../../lib/utils/apiResponse.js";
import { pendientesParaSalamandra } from "../../../../../lib/buzon/buzonStore.js";
import { candadoBuzon } from "../../../../../lib/buzon/candadoBackoffice.js";

/**
 * GET /api/admin/buzon/pendientes — lo que nos está esperando.
 *
 * Es lo que alimenta la campana de la barra superior del panel: cuántos avisos
 * nos ha escrito un cliente sin que los hayamos abierto, y los primeros ocho con
 * nombre para poder ir directo.
 *
 * ── POR QUÉ NO ES UN CAMPO MÁS DE `GET /api/admin/buzon` ────────────────────
 * Porque la campana está en TODAS las pantallas del panel y se repregunta sola
 * cada minuto. Aquel endpoint devuelve hasta cien avisos con su hilo entero y
 * sus adjuntos: pedirlo para pintar un número sería gastar mil veces lo que hace
 * falta, en cada pestaña abierta y todo el día.
 *
 * ── EL CANDADO ES EL MISMO, Y NO ES OPCIONAL ────────────────────────────────
 * `candadoBuzon` comprueba el host a mano además del módulo, por lo del matcher
 * del middleware (está explicado en `lib/buzon/candadoBackoffice.js`). Esta ruta
 * devuelve asuntos escritos por clientes: es de las que menos se pueden dejar
 * abiertas.
 *
 * ⚠️ `pendientes` es un segmento FIJO y convive con `[id]` a su lado. Next
 * resuelve antes el fijo, así que no hay ambigüedad; y aunque la hubiera,
 * `/api/admin/buzon/[id]` rechaza lo que no sea un UUID.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = candadoBuzon(request, ctx);
    if (veto) return veto;

    const { total, avisos, soloLectura } = await pendientesParaSalamandra();
    // `soloLectura` = las tablas todavía no existen (el deploy no corre
    // migraciones). La campana se queda a cero y callada, que es lo correcto:
    // no hay nada que mirar porque no se puede leer, no porque no haya nada.
    return ok({ total, avisos, soloLectura });
  } catch (err) {
    return serverError(err);
  }
});
