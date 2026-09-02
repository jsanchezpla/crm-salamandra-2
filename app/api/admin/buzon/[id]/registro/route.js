/**
 * POST /api/admin/buzon/[id]/registro — «Enviar al registro» (02/09/2026).
 *
 * Apunta el aviso como tarea en «Sin comprobar» del `backlog` y deja el aviso
 * en `enviado`, enlazado con la tarea por su ficha. Va por la MISMA puerta que
 * el tablero (`crearTarea` → `prepararPublicacion` → `publicarVersion`): misma
 * versión, mismo historial, mismos frenos (si alguien publica a la vez, la
 * versión pisada rebota y se vuelve a intentar).
 *
 * Se niega a apuntar dos veces: si el aviso ya tiene ficha, o si el `backlog`
 * ya cita su `AV-####` (las tareas que /mailbox escribió a mano), contesta 409.
 *
 * Orden a propósito: PRIMERO se publica la versión y DESPUÉS se marca el
 * aviso. Si la publicación falla, el aviso se queda como estaba y el botón se
 * puede volver a pulsar; al revés quedaría un «enviado» sin tarea.
 */
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { serializarAviso, referencia } from "../../../../../../lib/buzon/buzon.js";
import {
  leerParaSalamandra,
  marcarEnviadoAlRegistro,
  esSinTabla,
  COMANDO_MIGRACION,
} from "../../../../../../lib/buzon/buzonStore.js";
import { candadoBuzon } from "../../../../../../lib/buzon/candadoBackoffice.js";
import { tareaDesdeAviso, yaEstaEnElRegistro } from "../../../../../../lib/buzon/alRegistro.js";
import {
  prepararPublicacion,
  publicarVersion,
  ultimaVersion,
} from "../../../../../../lib/tablero/documentos.js";
import { crearTarea } from "../../../../../../lib/tablero/editor.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quién firma la versión: el correo, como en `app/api/admin/tablero/tareas`. */
async function quienPublica(ctx) {
  if (!ctx.user?.id) return null;
  try {
    const { User } = getMasterModels();
    const fila = await User.findByPk(ctx.user.id, { attributes: ["email"] });
    return fila?.email ?? String(ctx.user.id);
  } catch {
    return String(ctx.user.id);
  }
}

export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = candadoBuzon(request, ctx);
    if (veto) return veto;

    const { id } = await params;
    if (!UUID_RE.test(String(id ?? ""))) return error("id inválido", 422);

    const aviso = await leerParaSalamandra(id, { marcarLeido: false });
    if (!aviso) return notFound("Ese aviso no existe");
    const ref = referencia(aviso.numero);
    if (aviso.registroFicha) {
      return error(`${ref} ya está en el Registro (ficha ${aviso.registroFicha}).`, 409);
    }

    const models = getMasterModels();
    const actual = await ultimaVersion(models, "backlog");
    if (!actual) {
      return error(
        "El Registro («backlog») todavía no se ha publicado en esta base: no hay dónde apuntarlo.",
        503
      );
    }
    if (yaEstaEnElRegistro(actual.contenido, aviso.numero)) {
      return error(
        `En el Registro ya hay una tarea que cita ${ref}: no se apunta dos veces. Si es otra cosa, apúntala desde /admin/tablero.`,
        409
      );
    }

    const tarea = tareaDesdeAviso(aviso);
    const { texto, id: ficha } = crearTarea(actual.contenido, tarea);
    const plan = prepararPublicacion({ nombre: "backlog", contenido: texto, actual, base: actual.version });
    if (plan.errores.length) return error(plan.errores.join(" · "), 422);

    const { fila } = await publicarVersion(models, {
      nombre: "backlog",
      contenido: plan.contenido,
      nota: `${ref} enviado desde el Buzón`,
      por: await quienPublica(ctx),
      version: plan.versionNueva,
      tareas: plan.tareasDespues,
    });

    const antes = { estado: aviso.estado };
    await marcarEnviadoAlRegistro(aviso, { ficha });

    const { userId, ip } = datosPeticion(request);
    await auditar({
      tenantId: ctx.tenant.id,
      userId,
      action: "buzon.enviado_al_registro",
      entity: "BuzonAviso",
      entityId: aviso.id,
      before: antes,
      after: { estado: "enviado", ref, tenantSlug: aviso.tenantSlug, ficha, version: fila.version },
      ip,
    });

    return ok({
      ficha,
      version: fila.version,
      seccion: tarea.seccion,
      titulo: tarea.titulo,
      avisos: plan.avisos ?? [],
      aviso: serializarAviso(aviso, { para: "salamandra" }),
    });
  } catch (err) {
    if (err?.deUsuario || err?.code === "VERSION_PISADA") return error(err.message, 409);
    if (esSinTabla(err)) return error(`Falta correr en el VPS: ${COMANDO_MIGRACION}`, 503);
    return serverError(err);
  }
});
