import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { isDemoTenant } from "../../../../../lib/demo/isDemo.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import { SECCIONES_BACKLOG, contarTareas } from "../../../../../lib/tablero/parser.js";
import { claveDeTarea } from "../../../../../lib/tablero/estado.js";
import {
  prepararPublicacion,
  publicarVersion,
  ultimaVersion,
} from "../../../../../lib/tablero/documentos.js";
import {
  ErrorDeEdicion,
  borrarTarea,
  cerrarTarea,
  crearTarea,
  editarTarea,
  localizar,
  moverTarea,
} from "../../../../../lib/tablero/editor.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * Escribir en el Registro desde la pantalla: apuntar, mover, editar, cerrar y
 * borrar una tarea.
 *
 * ── POR QUÉ ESTÁ EN UN FICHERO APARTE DE `../route.js` ────────────────────
 * El de al lado hace dos cosas que NO son esto: leer el Registro y guardar el
 * tick y el reparto en `master.tablero_estado`. Eso último se escribe encima del
 * texto y no lo toca. Aquí se REESCRIBE EL TEXTO y se publica una versión, que
 * es una operación de otra naturaleza y con otros frenos. Mezclarlas en un
 * `PATCH` que a veces guarda un tick y a veces publica un documento de 40 KB es
 * como se llega a un endpoint que nadie se atreve a tocar.
 *
 * ── LA PUERTA ES LA MISMA QUE LA DEL SCRIPT ───────────────────────────────
 * Todo lo de aquí pasa por `prepararPublicacion` + `publicarVersion`, que es
 * exactamente lo que hace `scripts/registro.mjs`. No hay un camino corto: si
 * desde la pantalla se pudiera escribir una tarea sin sección válida o sin
 * sello, el documento dejaría de ser fiable y con él todo lo demás. Los frenos
 * que se heredan, sin escribir ni uno:
 *
 *   · los errores de formato del troceador (sección inventada, dos tareas con
 *     el mismo título, dos fichas iguales, tarea fuera de sección);
 *   · el tope de 2 MB;
 *   · el freno del 70 % («esto no es apuntar una tarea, es medio fichero»);
 *   · la UNIQUE (nombre, version), que es el cerrojo de verdad entre dos
 *     personas: si alguien publica entre que leemos y escribimos, la inserción
 *     falla y se dice, en vez de pisarlo.
 *
 * ── LO QUE SÍ SE DECIDE AQUÍ: SOBRE QUÉ TEXTO SE APLICA EL CAMBIO ─────────
 * Cada operación se aplica sobre el texto que se acaba de leer, no sobre el que
 * la pantalla tenía cargada. Es a propósito: mover una tarea a «Alta» es
 * quirúrgico y va por ficha, así que hacerlo sobre el documento de hace una hora
 * no aporta nada y sí obligaría a recargar cada vez que el otro publica.
 *
 * La excepción es EDITAR, que sí reescribe el texto de una tarea: ahí se exige
 * la versión que tenía la pantalla delante (`base`) y se rechaza si ya no es la
 * actual. Si no, dos personas reescribiendo la misma tarea se pisarían en
 * silencio, que es justo lo que el freno por versión de `registro.mjs` viene a
 * evitar.
 *
 * Mismos tres candados que el resto del back-office.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning"))
    return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

/** Quién publica. Se guarda en la fila y es lo que luego se lee en el historial. */
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

/**
 * La versión actual de un documento, exigiendo que esté en la tabla.
 *
 * Aquí NO se cae al fichero como hace el GET de al lado. Leer de un fichero para
 * pintar es inofensivo; publicar tomando como base un fichero que no es la
 * fuente lo es mucho menos: se insertaría una v1 encima de un documento que
 * quizá ya iba por la v16 en otra base. Si no hay fila, se dice y se para.
 */
async function documentoActual(nombre) {
  const fila = await ultimaVersion(getMasterModels(), nombre);
  if (!fila) {
    throw new ErrorDeEdicion(
      `«${nombre}» todavía no se ha publicado en esta base. Publícalo una vez con \`node scripts/registro.mjs subir ${nombre} --nota "…" --confirm\` y ya se podrá editar desde aquí.`
    );
  }
  return fila;
}

/**
 * Publica el texto nuevo de un documento. Devuelve `{ version, tareas }`.
 *
 * Un cambio que deja el texto igual no publica una versión vacía: se devuelve la
 * que hay. Pasa más de lo que parece —dos clics seguidos en el mismo botón— y
 * cincuenta versiones idénticas en el historial lo dejan inservible.
 */
async function publicar({ nombre, contenido, actual, nota, por }) {
  const plan = prepararPublicacion({ nombre, contenido, actual, base: actual.version });
  if (plan.errores.length) throw new ErrorDeEdicion(plan.errores.join(" · "));
  if (plan.sinCambios) return { version: actual.version, tareas: contarTareas(contenido), avisos: [] };

  const { fila } = await publicarVersion(getMasterModels(), {
    nombre,
    contenido: plan.contenido,
    nota,
    por,
    version: plan.versionNueva,
    tareas: plan.tareasDespues,
  });
  return { version: fila.version, tareas: fila.tareas, avisos: plan.avisos };
}

/** Una tarea, dicha como la manda la pantalla: por ficha, o por título. */
function referencia(cuerpo) {
  const id = typeof cuerpo?.id === "string" ? cuerpo.id.trim() : "";
  const clave = typeof cuerpo?.clave === "string" ? cuerpo.clave.trim() : "";
  if (!id && !clave) throw new ErrorDeEdicion("Falta la tarea.");
  return { id: id || null, clave: id ? null : clave };
}

/** Los errores que se le pueden enseñar a una persona van con 400; el resto, 500. */
function contestarError(err) {
  if (err?.deUsuario) return error(err.message);
  if (err?.code === "VERSION_PISADA") return error(err.message);
  return serverError(err);
}

/* ── Apuntar ─────────────────────────────────────────────────────────────── */

/**
 * POST — apuntar una tarea nueva.
 *
 * Cuerpo: `{ seccion, titulo, quien, cuerpo }`.
 *
 * Lo apuntado desde el móvil cae normalmente en «Sin comprobar», que es la sala
 * de espera de lo que nadie ha ido a ver a producción. La sección la manda la
 * pantalla y no se fuerza aquí: apuntar algo que SÍ se ha comprobado, con su
 * prioridad, es igual de legítimo.
 */
export const POST = withTenant(async (request, _ctx, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const cuerpo = await request.json().catch(() => null);
    const seccion = String(cuerpo?.seccion ?? "").trim();
    if (!SECCIONES_BACKLOG.includes(seccion)) {
      return error(`Elige dónde va: ${SECCIONES_BACKLOG.join(", ")}.`);
    }

    const actual = await documentoActual("backlog");
    const { texto, id } = crearTarea(actual.contenido, {
      seccion,
      titulo: cuerpo?.titulo,
      quien: cuerpo?.quien,
      cuerpo: cuerpo?.cuerpo,
    });

    const publicado = await publicar({
      nombre: "backlog",
      contenido: texto,
      actual,
      nota: `apuntar «${String(cuerpo?.titulo).trim().slice(0, 80)}» en ${seccion}, desde el tablero`,
      por: await quienPublica(ctx),
    });

    return ok({ id, seccion, ...publicado });
  } catch (err) {
    return contestarError(err);
  }
});

/* ── Mover, editar y cerrar ──────────────────────────────────────────────── */

/**
 * PATCH — `{ accion: "mover" | "editar" | "cerrar", … }`.
 *
 * Las tres reescriben el texto y publican. El tick y el reparto siguen en el
 * endpoint de al lado: eso no toca el documento.
 */
export const PATCH = withTenant(async (request, _ctx, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const cuerpo = await request.json().catch(() => null);
    const accion = String(cuerpo?.accion ?? "").trim();
    const quien = referencia(cuerpo);
    const por = await quienPublica(ctx);

    if (accion === "mover") {
      const aSeccion = String(cuerpo?.aSeccion ?? "").trim();
      const actual = await documentoActual("backlog");
      const texto = moverTarea(actual.contenido, { ...quien, aSeccion });
      const publicado = await publicar({
        nombre: "backlog",
        contenido: texto,
        actual,
        nota: `mover una tarea a ${aSeccion}, desde el tablero`,
        por,
      });
      return ok({ aSeccion, ...publicado });
    }

    if (accion === "editar") {
      const actual = await documentoActual("backlog");
      /*
       * Aquí sí se exige la versión que tenía la pantalla delante. Editar es lo
       * único de este fichero que SUSTITUYE el texto que escribió una persona:
       * sin este freno, dos reescrituras a la vez se pisarían sin que ninguna de
       * las dos se entere. Mover o cerrar no lo necesitan — son quirúrgicos y van
       * por ficha.
       */
      const base = Number(cuerpo?.base);
      if (!Number.isInteger(base)) return error("Falta saber qué versión tenías delante.");
      if (base !== actual.version) {
        return error(
          `Mientras editabas se publicó la v${actual.version}${actual.publicadoPor ? ` (${actual.publicadoPor})` : ""}. Recarga y vuelve a aplicar tu cambio encima.`
        );
      }

      // El título de ANTES hay que leerlo del documento, no deducirlo de lo que
      // mandó la pantalla: cuando la tarea viene por ficha, la pantalla no manda
      // ninguna clave y el tick se quedaría huérfano sin que nadie se entere.
      const donde = localizar(actual.contenido, quien);
      if (!donde) return error("Esa tarea ya no está en el Registro. Recarga.");
      const tituloAntes = donde.tarea.titulo;

      const { texto, id } = editarTarea(actual.contenido, {
        ...quien,
        ...(cuerpo?.titulo === undefined ? {} : { titulo: cuerpo.titulo }),
        ...(cuerpo?.quien === undefined ? {} : { quien: cuerpo.quien }),
        ...(cuerpo?.cuerpo === undefined ? {} : { cuerpo: cuerpo.cuerpo }),
      });

      const publicado = await publicar({
        nombre: "backlog",
        contenido: texto,
        actual,
        nota: "reescribir una tarea, desde el tablero",
        por,
      });

      // Si el título ha cambiado, el tick y el reparto se quedaban huérfanos:
      // `tablero_estado` casa por título normalizado. Se le mueve la clave.
      // Los adjuntos no lo necesitan —cuelgan de la ficha, que no cambia—, pero
      // esta tabla es de antes de que las fichas existieran.
      if (cuerpo?.titulo !== undefined) {
        await mudarEstado(claveDeTarea(tituloAntes), claveDeTarea(cuerpo.titulo));
      }

      return ok({ id, ...publicado });
    }

    if (accion === "cerrar") {
      const backlog = await documentoActual("backlog");
      const resuelto = await documentoActual("resuelto");
      const r = cerrarTarea(backlog.contenido, resuelto.contenido, {
        ...quien,
        comoSeArreglo: cuerpo?.comoSeArreglo,
        fecha: new Date(),
      });

      /*
       * ⚠️ EL ORDEN NO ES INDIFERENTE: primero Resuelto, después el backlog.
       *
       * Son dos publicaciones y la segunda puede fallar (alguien publicó en
       * medio y salta la UNIQUE). Escribiendo primero Resuelto, un fallo deja la
       * tarea en los DOS sitios: se ve, molesta y se arregla en un minuto. Al
       * revés, deja la tarea en ninguno: sale del backlog y no llega a Resuelto,
       * y nadie va a echar de menos lo que ya no está escrito en ninguna parte.
       */
      const enResuelto = await publicar({
        nombre: "resuelto",
        contenido: r.resuelto,
        actual: resuelto,
        nota: `cerrar «${r.tarea.titulo.slice(0, 80)}», desde el tablero`,
        por,
      });
      const enBacklog = await publicar({
        nombre: "backlog",
        contenido: r.backlog,
        actual: backlog,
        nota: `cerrar «${r.tarea.titulo.slice(0, 80)}», desde el tablero`,
        por,
      });

      return ok({ titulo: r.tarea.titulo, resuelto: enResuelto, backlog: enBacklog });
    }

    return error("No sé qué hacer: manda «mover», «editar» o «cerrar».");
  } catch (err) {
    return contestarError(err);
  }
});

/**
 * Le cambia la clave a la fila de estado cuando se reescribe un título, para que
 * el tick y el reparto no se queden huérfanos.
 *
 * Nunca lanza: perder un tick es una molestia; tumbar una publicación que YA se
 * ha escrito, por no poder mover una fila accesoria, sería mucho peor.
 */
async function mudarEstado(antes, ahora) {
  if (!antes || !ahora || antes === ahora) return;
  try {
    const { TableroEstado } = getMasterModels();
    const fila = await TableroEstado.findOne({ where: { clave: antes } });
    if (!fila) return;
    // Si ya hay fila con la clave nueva, la vieja sobra: se borra en vez de
    // chocar contra la UNIQUE de `clave`.
    const choque = await TableroEstado.findOne({ where: { clave: ahora } });
    if (choque) await fila.destroy();
    else await fila.update({ clave: ahora });
  } catch (err) {
    process.stderr.write(`[tablero] no se pudo mudar el estado de «${antes}»: ${err.message}\n`);
  }
}

/* ── Borrar ──────────────────────────────────────────────────────────────── */

/**
 * DELETE — quitar una tarea del backlog sin cerrarla.
 *
 * Es para lo que nunca debió apuntarse: un duplicado, algo mal entendido. NO es
 * cerrar —eso deja constancia en Resuelto— y la pantalla lo pregunta con otras
 * palabras a propósito.
 *
 * No se pierde nada: la tabla es append-only y guarda 50 versiones, así que una
 * tarea borrada por error se rescata con `registro.mjs restaurar`.
 */
export const DELETE = withTenant(async (request, _ctx, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const cuerpo = await request.json().catch(() => null);
    const quien = referencia(cuerpo);

    const actual = await documentoActual("backlog");
    const { texto, tarea } = borrarTarea(actual.contenido, quien);
    const publicado = await publicar({
      nombre: "backlog",
      contenido: texto,
      actual,
      nota: `borrar «${tarea.titulo.slice(0, 80)}», desde el tablero`,
      por: await quienPublica(ctx),
    });

    return ok({ titulo: tarea.titulo, ...publicado });
  } catch (err) {
    return contestarError(err);
  }
});
