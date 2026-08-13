import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { created, error, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { validarMensaje, serializarAviso } from "../../../../../../lib/buzon/buzon.js";
import {
  leerParaSalamandra,
  anadirMensaje,
  esSinTabla,
  COMANDO_MIGRACION,
} from "../../../../../../lib/buzon/buzonStore.js";
import { candadoBuzon, quienContesta } from "../../../../../../lib/buzon/candadoBackoffice.js";
import { avisarAlCliente } from "../../../../../../lib/buzon/avisarPorCorreo.js";
import { avisarEnSuCrm } from "../../../../../../lib/buzon/avisarEnSuCrm.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/buzon/[id]/mensajes — contestamos, o dejamos una nota.
 *
 * `interno: true` es una nota NUESTRA: no se le enseña al cliente, no cambia el
 * estado del aviso y no cuenta como respuesta. Es la diferencia entre «ya te
 * contesto» y «esto es el bug de las citas de julio».
 *
 * El estado no viene del body ni cuando contestamos: lo decide
 * `estadoTrasMensaje` en el store. Así no hay forma de responderle a alguien y
 * dejar su aviso, por descuido, en la pila de lo que nos toca mirar.
 */
export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = candadoBuzon(request, ctx);
    if (veto) return veto;

    const { id } = await params;
    if (!UUID_RE.test(String(id ?? ""))) return error("id inválido", 422);

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido");
    }

    const v = validarMensaje(body);
    if (!v.ok) return error(v.error, v.status);

    const aviso = await leerParaSalamandra(id, { marcarLeido: false });
    if (!aviso) return notFound("Ese aviso no existe");

    const yo = quienContesta(request, ctx);
    const mensaje = await anadirMensaje(aviso, {
      autorTipo: "salamandra",
      autorNombre: yo.nombre,
      autorEmail: yo.email,
      cuerpo: v.limpio.cuerpo,
      interno: v.limpio.interno,
    });

    // Solo si es una respuesta de verdad: una nota interna no se le manda a
    // nadie. Best-effort, como todo el correo del buzón — si no sale, la
    // respuesta está guardada y él la ve igual en su pantalla.
    if (!v.limpio.interno) {
      await avisarAlCliente({ aviso, mensaje });
      // Y en su CRM: campana + el aviso de la portada. Ninguno de los dos puede
      // tumbar la respuesta, que ya está guardada.
      await avisarEnSuCrm({ aviso });
    }

    const fresco = await leerParaSalamandra(id, { marcarLeido: false });
    return created(serializarAviso(fresco, { para: "salamandra" }));
  } catch (err) {
    if (esSinTabla(err)) return error(`Falta correr en el VPS: ${COMANDO_MIGRACION}`, 503);
    return serverError(err);
  }
});
