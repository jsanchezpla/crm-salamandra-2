/**
 * POST /api/admin/buzon/[id]/resuelto — «Enviar a Resuelto» (15/09/2026).
 *
 * Rodrigo: «aparte de enviar al registro, se tiene que poder enviar un mensaje
 * del buzón a Resuelto directamente». Dos caminos, según dónde esté el aviso:
 *
 *   · SIN tarea en el backlog: se escribe una entrada nueva en Resuelto, bajo
 *     la fecha de hoy (`apuntarEnResuelto`), y las capturas viajan con ella.
 *   · CON tarea en el backlog (ya se envió al Registro): se CIERRA esa tarea,
 *     igual que desde el tablero (`cerrarTarea`): primero Resuelto, después el
 *     backlog, por el motivo escrito en `app/api/admin/tablero/tareas`. Si la
 *     tarea ya no está en el backlog (alguien la cerró antes), no se escribe
 *     nada y solo se marca el aviso.
 *
 * Cuerpo opcional: `{ nota }`, qué se hizo. Sin nota se pone la de por defecto
 * (`notaDeCierre` en `lib/buzon/alRegistro.js`).
 *
 * Mismo orden que «Enviar al registro»: se publica y DESPUÉS se marca el aviso.
 */
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { serializarAviso, referencia, estadoActual } from "../../../../../../lib/buzon/buzon.js";
import {
  leerParaSalamandra,
  marcarEnResuelto,
  esSinTabla,
  COMANDO_MIGRACION,
} from "../../../../../../lib/buzon/buzonStore.js";
import { candadoBuzon } from "../../../../../../lib/buzon/candadoBackoffice.js";
import { entradaDeResuelto, notaDeCierre } from "../../../../../../lib/buzon/alRegistro.js";
import { copiarCapturasAlRegistro } from "../../../../../../lib/buzon/capturasAlRegistro.js";
import {
  prepararPublicacion,
  publicarVersion,
  ultimaVersion,
} from "../../../../../../lib/tablero/documentos.js";
import { apuntarEnResuelto, cerrarTarea, localizar } from "../../../../../../lib/tablero/editor.js";

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

async function publicar(models, { nombre, contenido, actual, nota, por }) {
  const plan = prepararPublicacion({ nombre, contenido, actual, base: actual.version });
  if (plan.errores.length) {
    const e = new Error(plan.errores.join(" · "));
    e.deUsuario = true;
    throw e;
  }
  const { fila } = await publicarVersion(models, {
    nombre,
    contenido: plan.contenido,
    nota,
    por,
    version: plan.versionNueva,
    tareas: plan.tareasDespues,
  });
  return { version: fila.version, avisos: plan.avisos ?? [] };
}

export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = candadoBuzon(request, ctx);
    if (veto) return veto;

    const { id } = await params;
    if (!UUID_RE.test(String(id ?? ""))) return error("id inválido", 422);
    const cuerpo = await request.json().catch(() => ({}));

    const aviso = await leerParaSalamandra(id, { marcarLeido: false });
    if (!aviso) return notFound("Ese aviso no existe");
    const ref = referencia(aviso.numero);
    if (estadoActual(aviso.estado) === "cerrado") {
      return error(`${ref} ya está en Resuelto.`, 409);
    }

    const models = getMasterModels();
    const resuelto = await ultimaVersion(models, "resuelto");
    if (!resuelto) {
      return error("«Resuelto» todavía no se ha publicado en esta base: no hay dónde apuntarlo.", 503);
    }
    const por = await quienPublica(ctx);
    const nota = `${ref} a Resuelto desde el Buzón`;
    const avisos = [];
    let ficha = null;
    let camino;
    let version = null;
    let capturas = { copiadas: [], quedan: 0, error: null };

    const backlog = aviso.registroFicha ? await ultimaVersion(models, "backlog") : null;
    const enBacklog = backlog && localizar(backlog.contenido, { id: aviso.registroFicha });

    if (enBacklog) {
      // Ya tenía tarea: se cierra esa, con sus capturas ya colgadas de su ficha.
      camino = "cerrada";
      ficha = aviso.registroFicha;
      const r = cerrarTarea(backlog.contenido, resuelto.contenido, {
        id: ficha,
        comoSeArreglo: notaDeCierre(aviso, cuerpo?.nota),
        fecha: new Date(),
      });
      const a = await publicar(models, { nombre: "resuelto", contenido: r.resuelto, actual: resuelto, nota, por });
      // El backlog se publica sin su tarea. Sus avisos hablan de OTRAS tareas —la
      // de este aviso acaba de salir de ahí— y el panel del Buzón los enseñaba
      // como un fallo del cierre (18/09/2026): se quedan para /admin/tablero.
      await publicar(models, { nombre: "backlog", contenido: r.backlog, actual: backlog, nota, por });
      version = a.version;
      avisos.push(...a.avisos);
    } else if (aviso.registroFicha) {
      // Tenía tarea y ya no está en el backlog: alguien la cerró o la borró.
      camino = "ya-cerrada";
      ficha = aviso.registroFicha;
    } else {
      camino = "nueva";
      const entrada = entradaDeResuelto(aviso, { nota: cuerpo?.nota });
      const r = apuntarEnResuelto(resuelto.contenido, entrada);
      ficha = r.id;
      const a = await publicar(models, { nombre: "resuelto", contenido: r.texto, actual: resuelto, nota, por });
      version = a.version;
      avisos.push(...a.avisos);
      capturas = await copiarCapturasAlRegistro({ aviso, ficha, documento: "resuelto", subidoPor: por });
      if (capturas.error) avisos.push(capturas.error);
    }

    const antes = { estado: aviso.estado };
    await marcarEnResuelto(aviso, { ficha });

    const { userId, ip } = datosPeticion(request);
    await auditar({
      tenantId: ctx.tenant.id,
      userId,
      action: "buzon.enviado_a_resuelto",
      entity: "BuzonAviso",
      entityId: aviso.id,
      before: antes,
      after: {
        estado: "cerrado",
        ref,
        tenantSlug: aviso.tenantSlug,
        ficha,
        camino,
        version,
        capturasCopiadas: capturas.copiadas.length,
      },
      ip,
    });

    return ok({
      ficha,
      camino,
      version,
      avisos,
      aviso: serializarAviso(aviso, { para: "salamandra" }),
    });
  } catch (err) {
    if (err?.deUsuario || err?.code === "VERSION_PISADA") return error(err.message, 409);
    if (esSinTabla(err)) return error(`Falta correr en el VPS: ${COMANDO_MIGRACION}`, 503);
    return serverError(err);
  }
});
