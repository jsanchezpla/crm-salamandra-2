import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, serverError } from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import { candadoTablero } from "../../../../../lib/tablero/candado.js";
import { tipoParaVerEnPantalla } from "../../../../../lib/buzon/buzon.js";
import { DOCUMENTOS } from "../../../../../lib/tablero/parser.js";
import {
  prepararPublicacion,
  publicarVersion,
  ultimaVersion,
} from "../../../../../lib/tablero/documentos.js";
import { ErrorDeEdicion, editarTarea, localizar } from "../../../../../lib/tablero/editor.js";
import {
  MAX_FICHEROS,
  guardarCapturasDelFormulario,
} from "../../../../../lib/tablero/tableroStorage.js";

/**
 * POST /api/admin/tablero/adjuntos — colgar una captura de una tarea.
 *
 * Multipart: `capturas` (1..3 ficheros) + `id` (la ficha de la tarea) o `clave`
 * (su título normalizado, para las de antes del 24/08/2026).
 *
 * ── LO QUE HACE ESPECIAL A ESTE ENDPOINT ──────────────────────────────────
 * Que a veces PUBLICA UNA VERSIÓN DEL REGISTRO antes de guardar nada.
 *
 * Una captura cuelga de la FICHA de la tarea, no de su título, y ese es todo el
 * motivo por el que la ficha existe: el título se reescribe y entonces el
 * fichero se queda en disco sin que nadie lo alcance ni lo borre — con datos de
 * un paciente dentro, si los tenía. Pero las 15 tareas que había escritas cuando
 * esto se hizo NO llevan ficha, y reescribirlas todas de golpe habría sido
 * publicar una versión que toca las quince a la vez para no arreglar nada
 * visible.
 *
 * Así que la ficha se da en el momento en que hace falta: la primera captura de
 * una tarea vieja publica una versión que le añade su `<!--id:…-->` y sigue. A
 * partir de ahí, esa tarea ya está curada para siempre.
 */
export const POST = withTenant(async (request, _ctx, ctx) => {
  try {
    const veto = candadoTablero(ctx);
    if (veto) return veto;

    const form = await request.formData().catch(() => null);
    if (!form) return error("Esperaba un formulario con ficheros.");

    const documento = String(form.get("documento") ?? "backlog");
    if (!DOCUMENTOS.includes(documento)) return error("No sé de qué documento es esa tarea.");

    const ficha = await fichaDeLaTarea({
      documento,
      id: String(form.get("id") ?? "").trim() || null,
      clave: String(form.get("clave") ?? "").trim() || null,
      por: await quienSube(ctx),
    });

    const { TableroAdjunto } = getMasterModels();
    const yaTiene = await TableroAdjunto.count({ where: { ficha } });
    if (yaTiene >= MAX_FICHEROS) {
      return error(`Esta tarea ya tiene ${yaTiene} capturas, que es el tope.`);
    }

    const { filas, error: fallo } = await guardarCapturasDelFormulario({
      form,
      ficha,
      documento,
      subidoPor: await quienSube(ctx),
      yaTiene,
    });
    if (fallo) return error(fallo);

    // Las filas se insertan DESPUÉS de que los ficheros estén en disco. Al revés
    // —fila primero— un fallo de escritura dejaría una fila apuntando a un
    // fichero que no existe, y eso se descubre al abrirla, semanas después.
    const guardadas = await TableroAdjunto.bulkCreate(filas);

    return ok({ ficha, capturas: guardadas.map(comoFicha) });
  } catch (err) {
    if (err?.deUsuario) return error(err.message);
    return serverError(err);
  }
});

/**
 * La ficha de la tarea, dándosela si todavía no tiene.
 *
 * Publicar aquí es aditivo y quirúrgico: `editarTarea` sin cambiar título, ni
 * cliente, ni cuerpo, solo añade la línea de la ficha. El freno del 70 % y las
 * comprobaciones de formato se aplican igual, porque se pasa por la misma puerta
 * que todo lo demás.
 */
async function fichaDeLaTarea({ documento, id, clave, por }) {
  if (id) return id;
  if (!clave) throw new ErrorDeEdicion("Falta la tarea.");

  const models = getMasterModels();
  const actual = await ultimaVersion(models, documento);
  if (!actual) {
    throw new ErrorDeEdicion(
      `«${documento}» todavía no se ha publicado en esta base, así que no se le puede colgar nada.`
    );
  }

  const donde = localizar(actual.contenido, { clave });
  if (!donde) throw new ErrorDeEdicion("Esa tarea ya no está en el Registro. Recarga.");
  if (donde.tarea.id) return donde.tarea.id;

  const { texto, id: nueva } = editarTarea(actual.contenido, { clave });
  const plan = prepararPublicacion({
    nombre: documento,
    contenido: texto,
    actual,
    base: actual.version,
  });
  if (plan.errores.length) throw new ErrorDeEdicion(plan.errores.join(" · "));
  if (!plan.sinCambios) {
    await publicarVersion(models, {
      nombre: documento,
      contenido: plan.contenido,
      nota: `darle ficha a «${donde.tarea.titulo.slice(0, 70)}» para poder colgarle una captura`,
      por,
      version: plan.versionNueva,
      tareas: plan.tareasDespues,
    });
  }
  return nueva;
}

/** Quién la sube. Somos dos: sirve para saber a quién preguntar por ella. */
async function quienSube(ctx) {
  if (!ctx.user?.id) return null;
  try {
    const { User } = getMasterModels();
    const fila = await User.findByPk(ctx.user.id, { attributes: ["email"] });
    return fila?.email ?? String(ctx.user.id);
  } catch {
    return String(ctx.user.id);
  }
}

/**
 * Lo que se manda a la pantalla de cada captura.
 *
 * La RUTA en disco no sale nunca de aquí: se pide por su id y el servidor la
 * busca. Una ruta en el JSON es una invitación a construir la siguiente a mano.
 */
export function comoFicha(a) {
  return {
    id: a.id,
    nombre: a.nombre,
    bytes: a.bytes,
    subidoPor: a.subidoPor,
    creadaEn: a.createdAt,
    // Con qué tipo se puede enseñar en pantalla, o `null` si solo se descarga.
    // Lo decide la MISMA lista blanca con la que luego se sirve, para que no
    // pueda haber una pantalla pintando un `<img>` de algo que va a llegar como
    // descarga. Mismo campo y mismo motivo que en el GET del tablero.
    verComo: tipoParaVerEnPantalla(a.ruta),
  };
}
