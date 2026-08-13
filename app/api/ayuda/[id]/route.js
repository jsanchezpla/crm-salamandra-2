import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, notFound, serverError } from "../../../../lib/utils/apiResponse.js";
import { serializarAviso } from "../../../../lib/buzon/buzon.js";
import { leerDeUsuario, marcarVistoPorCliente } from "../../../../lib/buzon/buzonStore.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /api/ayuda/[id] — uno de SUS avisos, con el hilo.
 *
 * El candado es `usuarioId`, no el tenant. Es la diferencia con el resto del
 * CRM: allí el aislamiento lo pone el schema de PostgreSQL, y aquí no hay
 * schema que valga porque la tabla vive en master. Sin esta condición,
 * cualquiera con un id de aviso leería lo que escribió otro — y un aviso puede
 * ser perfectamente una queja sobre su propio centro.
 *
 * Abrirlo cuenta como «lo he visto», que es lo que apaga el punto del menú.
 */
export const GET = withTenant(async (request, { params }) => {
  try {
    const { id } = await params;
    if (!UUID_RE.test(String(id ?? ""))) return error("id inválido", 422);

    const usuarioId = request.headers.get("x-user-id");
    const aviso = await leerDeUsuario(id, { usuarioId });
    if (!aviso) return notFound("Ese aviso no existe");

    await marcarVistoPorCliente(aviso);

    return ok(serializarAviso(aviso, { para: "cliente" }));
  } catch (err) {
    return serverError(err);
  }
});
