/**
 * lib/tablero/documentos.js — leer y publicar el texto del Registro en
 * `master.tablero_documentos`.
 *
 * (Motivo del fichero en /lib, regla #2: lo usan DOS sitios que no pueden
 * compartir nada más — el endpoint `/api/admin/tablero`, que lee la versión
 * actual, y `scripts/tablero-doc.js`, que publica desde dentro del contenedor.
 * Las reglas de qué se acepta y qué no (`prepararPublicacion`) son lógica pura y
 * las fija `scripts/_smoke-tablero-parser.mjs`; lo que toca la tabla recibe los
 * modelos por parámetro.)
 *
 * La tabla es append-only: publicar es insertar `version + 1`, nunca tocar una
 * fila. Ver el porqué en `models/master/TableroDocumento.model.js`.
 */

import { Op } from "sequelize";
import { comprobar, contarTareas, diferenciaDeTitulos, DOCUMENTOS, trocear } from "./parser.js";
import { claveDeTarea } from "./estado.js";
import { sincronizarConRegistro } from "../buzon/sincronizarConRegistro.js";

/** Cuántas versiones se conservan por documento; las más viejas se podan al publicar. */
export const VERSIONES_QUE_SE_GUARDAN = 50;

/** Tope del texto. El Registro entero son ~210 KB; esto es diez veces eso. */
export const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Si entran menos del 70 % de las tareas que había, alguien ha pegado medio
 * fichero. Se puede publicar igual con `forzar`, pero hay que decirlo.
 */
const PROPORCION_MINIMA = 0.7;

/**
 * Cuántas tareas tienen que salir de golpe para que el freno de arriba llegue a
 * mirarse.
 *
 * ── POR QUÉ HAY UN SUELO (19/09/2026) ─────────────────────────────────────
 * El 70 % se escribió con 133 tareas en el backlog: perder 40 de golpe solo
 * puede ser un accidente. Pero el backlog se ha ido vaciando, y con DOS tareas
 * dentro cerrar una deja una —el 50 %— y el freno saltaba. O sea: el tablero
 * dejaba de poder cerrar tareas justo cuando quedaban pocas, que es cuando más
 * se cierran.
 *
 * Y no fallaba en el vacío: cerrar publica primero Resuelto y después el
 * backlog, así que el rebote dejaba la tarea escrita en los DOS documentos
 * (pasó con «Guía en PDF» el 19/09/2026, y a partir de ahí ya no se podía ni
 * reintentar: la ficha repetida tumbaba también Resuelto).
 *
 * El freno no es «qué porcentaje sale» sino «esto no es una tarea, es medio
 * fichero», así que se le pone el suelo en el gesto normal: cerrar, borrar o
 * mover unas pocas. Tres es de sobra —nadie cierra cuatro de un clic— y deja el
 * porcentaje intacto para lo que vino a parar.
 */
const SALIDAS_QUE_NO_FRENAN = 3;

/** Los campos que se devuelven al leer (todos menos el texto, salvo que se pida). */
const SIN_TEXTO = ["id", "nombre", "version", "nota", "publicadoPor", "tareas", "createdAt"];

/** La versión actual de un documento, con su texto. `null` si nunca se publicó. */
export async function ultimaVersion(models, nombre) {
  return models.TableroDocumento.findOne({
    where: { nombre },
    order: [["version", "DESC"]],
  });
}

/** Una versión concreta, con su texto. */
export async function versionConcreta(models, nombre, version) {
  return models.TableroDocumento.findOne({ where: { nombre, version } });
}

/** Las últimas versiones de un documento, de la más nueva a la más vieja, sin el texto. */
export async function historial(models, nombre, { ultimas = 20 } = {}) {
  return models.TableroDocumento.findAll({
    where: { nombre },
    attributes: SIN_TEXTO,
    order: [["version", "DESC"]],
    limit: ultimas,
  });
}

/** La versión actual de cada documento, sin el texto. Para `estado`. */
export async function estadoDeTodos(models) {
  const salida = {};
  for (const nombre of DOCUMENTOS) {
    const fila = await ultimaVersion(models, nombre);
    salida[nombre] = fila
      ? {
          version: fila.version,
          tareas: fila.tareas,
          nota: fila.nota,
          publicadoPor: fila.publicadoPor,
          publicadoEn: fila.createdAt,
          bytes: Buffer.byteLength(fila.contenido ?? "", "utf8"),
        }
      : null;
  }
  return salida;
}

/** Finales de línea a LF: así el texto guardado es uno, venga de donde venga. */
export function normalizar(texto) {
  return (texto ?? "").replace(/\r\n?/g, "\n");
}

/**
 * Todo lo que se decide ANTES de escribir, sin tocar la base.
 *
 * Recibe el texto nuevo, la fila actual (o null) y dos cosas que vienen de
 * quien publica: `base`, la versión que tenía delante cuando editó (si la
 * actual ya no es esa, alguien publicó en medio y hay que volver a bajar), y
 * `forzar`, que levanta los dos frenos que no son de formato (la base vieja y
 * el encogimiento). Los errores de formato no se fuerzan: se arreglan.
 *
 * Devuelve `{ contenido, errores, avisos, sinCambios, tareasAntes, tareasDespues,
 * entran, salen, versionNueva }`. Con `errores` no vacío o `sinCambios`, no se
 * escribe.
 */
export function prepararPublicacion({
  nombre,
  contenido,
  actual = null,
  base = null,
  forzar = false,
}) {
  const texto = normalizar(contenido);
  const errores = [];
  const avisos = [];

  const bytes = Buffer.byteLength(texto, "utf8");
  if (bytes > MAX_BYTES) {
    errores.push(
      `El texto pesa ${Math.round(bytes / 1024)} KB y el tope son ${MAX_BYTES / 1024} KB.`
    );
  }

  const comprobacion = comprobar(texto, nombre);
  errores.push(...comprobacion.errores);
  avisos.push(...comprobacion.avisos);

  const textoActual = actual ? normalizar(actual.contenido) : null;
  const sinCambios = textoActual !== null && textoActual === texto;
  const tareasAntes = textoActual !== null ? contarTareas(textoActual) : 0;
  const tareasDespues = comprobacion.tareas;
  const { entran, salen } = diferenciaDeTitulos(textoActual ?? "", texto);

  if (actual && base !== null && base !== undefined && Number(base) !== actual.version) {
    const mensaje =
      `La versión publicada ya no es la que bajaste: bajaste la v${base} y ahora está la v${actual.version}` +
      (actual.publicadoPor ? ` (${actual.publicadoPor}` : "") +
      (actual.nota ? `${actual.publicadoPor ? ", " : " ("}«${actual.nota}»` : "") +
      (actual.publicadoPor || actual.nota ? ")" : "") +
      ". Vuelve a bajar y aplica tu cambio encima.";
    if (forzar)
      avisos.push(
        `${mensaje} — publicado igual con --forzar: lo que hubiera en la v${actual.version} se pierde.`
      );
    else errores.push(mensaje);
  }

  const salenTareas = tareasAntes - tareasDespues;
  if (
    actual &&
    tareasAntes > 0 &&
    salenTareas > SALIDAS_QUE_NO_FRENAN &&
    tareasDespues < tareasAntes * PROPORCION_MINIMA
  ) {
    const mensaje = `Salen ${tareasAntes - tareasDespues} de ${tareasAntes} tareas (quedan ${tareasDespues}). Eso no es apuntar ni cerrar una: parece medio fichero.`;
    if (forzar) avisos.push(`${mensaje} — publicado igual con --forzar.`);
    else errores.push(`${mensaje} Si es de verdad, repite con --forzar.`);
  }

  return {
    contenido: texto,
    errores,
    avisos,
    sinCambios,
    tareasAntes,
    tareasDespues,
    entran,
    salen,
    versionNueva: (actual?.version ?? 0) + 1,
    bytes,
  };
}

/**
 * Le pone fecha de alta a las tareas del texto que todavía no la tengan.
 *
 * ── POR QUÉ SE HACE AQUÍ Y NO AL ESCRIBIR CADA TAREA (26/08/2026, Jorge) ───
 * Al Registro se escribe por DOS puertas —el tablero (`/api/admin/tablero/tareas`)
 * y `scripts/registro.mjs`, que edita el markdown a mano— y las dos pasan por
 * `publicarVersion`. Poner el sello en cada puerta serían dos sitios que
 * mantener, y el segundo se olvidaría: una tarea escrita a mano en el markdown
 * no pasa por ningún código que sepa que es nueva. Aquí, en cambio, basta con
 * mirar el texto que se acaba de publicar y rellenar lo que falte.
 *
 * NO se sobrescribe una fecha que ya esté puesta, y eso no es prudencia: es lo
 * que hace que cerrar una tarea no la rejuvenezca. Cerrar es publicar DOS
 * documentos —sale del backlog, entra en resuelto— y desde el punto de vista de
 * `resuelto` esa tarea es nueva. Con sobrescritura, toda tarea cerrada pasaría a
 * estar «apuntada» el día que se cerró, que es justo lo contrario de lo que se
 * quiere saber.
 *
 * Reescribir el título sí la pierde, como pierde el tick y el reparto: la clave
 * es el título normalizado. Desde el tablero no pasa —`mudarEstado` le muda la
 * clave a la fila—; a mano en el markdown, sí, y entonces la tarea se vuelve a
 * sellar con la fecha de hoy. Es el mismo precio que ya se paga por lo demás y
 * está escrito en `docs/como-apuntar-en-el-tablero.md`.
 *
 * Nunca lanza: la fecha es un adorno útil, y tumbar una publicación que YA está
 * escrita por no poder sellarla sería cambiar un problema pequeño por uno
 * grande. Si la columna todavía no existe —el despliegue por delante de la
 * migración— se dice por stderr y se sigue.
 */
export async function sellarAltas(models, { contenido, cuando = new Date() }) {
  const titulos = new Map();
  for (const s of trocear(contenido ?? "")) {
    for (const t of s.tareas) titulos.set(claveDeTarea(t.titulo), t.titulo);
  }
  if (!titulos.size) return 0;

  const { TableroEstado } = models;
  const filas = await TableroEstado.findAll({
    where: { clave: { [Op.in]: [...titulos.keys()] } },
    attributes: ["id", "clave", "apuntadaEn"],
  });
  const conFila = new Map(filas.map((f) => [f.clave, f]));

  let selladas = 0;
  for (const [clave, titulo] of titulos) {
    const fila = conFila.get(clave);
    if (fila?.apuntadaEn) continue;
    if (fila) await fila.update({ apuntadaEn: cuando });
    else await TableroEstado.create({ clave, titulo, apuntadaEn: cuando });
    selladas += 1;
  }
  return selladas;
}

/**
 * Escribe la versión siguiente y poda las que sobran. Da por hecho que
 * `prepararPublicacion` ya dio el visto bueno: aquí no se vuelve a validar.
 *
 * La UNIQUE (nombre, version) es el cerrojo: si dos personas publican a la vez
 * sobre la misma actual, la segunda inserción falla y se dice («alguien publicó
 * a la vez; vuelve a bajar») en vez de pisar nada.
 */
export async function publicarVersion(
  models,
  { nombre, contenido, nota = null, por = null, version, tareas }
) {
  const { TableroDocumento } = models;
  let fila;
  try {
    fila = await TableroDocumento.create({
      nombre,
      version,
      contenido,
      nota: nota?.trim() || null,
      publicadoPor: por?.trim() || null,
      tareas,
    });
  } catch (err) {
    if (err?.name === "SequelizeUniqueConstraintError") {
      const e = new Error(
        `Alguien publicó la v${version} de ${nombre} a la vez. Vuelve a bajar y aplica tu cambio encima.`
      );
      e.code = "VERSION_PISADA";
      throw e;
    }
    throw err;
  }

  // La fecha de alta de las tareas nuevas. Va DESPUÉS de la inserción y fuera
  // de ella a propósito, y por lo mismo que la poda: la publicación ya está
  // escrita y nada de lo que venga detrás puede deshacerla.
  let selladas = 0;
  try {
    selladas = await sellarAltas(models, { contenido });
  } catch (err) {
    process.stderr.write(`[tablero] no se ha podido fechar lo nuevo de ${nombre}: ${err.message}
`);
  }

  // Los avisos del Buzón siguen a su tarea (15/09/2026, Rodrigo): cerrarla la
  // pasa a Resuelto también allí. Aquí y no en cada puerta porque TODAS pasan
  // por esta función. Mismo trato que el sello: un fallo no deshace nada.
  let buzon = [];
  if (nombre === "backlog" || nombre === "resuelto") {
    try {
      buzon = await sincronizarConRegistro(models, { por });
    } catch (err) {
      process.stderr.write(`[tablero] no se ha podido poner el Buzón al día con ${nombre}: ${err.message}\n`);
    }
  }

  // Poda: solo lo que queda por debajo de las últimas N. Un fallo aquí no
  // deshace la publicación, que ya está; se dice y se sigue.
  let podadas = 0;
  try {
    podadas = await TableroDocumento.destroy({
      where: { nombre, version: { [Op.lt]: version - VERSIONES_QUE_SE_GUARDAN + 1 } },
    });
  } catch (err) {
    process.stderr.write(`[tablero] no se pudo podar el historial de ${nombre}: ${err.message}\n`);
  }

  return { fila, podadas, selladas, buzon };
}

/**
 * Publica los DOS documentos de un cierre —Resuelto y backlog— después de
 * comprobar los dos. Devuelve `{ resuelto, backlog }` con la versión de cada uno.
 *
 * ── POR QUÉ SE COMPRUEBAN LOS DOS ANTES DE ESCRIBIR NINGUNO (19/09/2026) ───
 * Cerrar son dos publicaciones, y se hacían una detrás de otra: primero
 * Resuelto, después el backlog. El orden está bien elegido —si falla la
 * segunda, la tarea queda en los dos sitios y se ve— pero el fallo llegaba
 * DESPUÉS de haber escrito el primero, y en el Registro eso no es un aviso: es
 * una tarea escrita dos veces que además ya no se puede reintentar, porque su
 * ficha repetida tumba Resuelto. Pasó con «Guía en PDF» el 19/09/2026.
 *
 * Casi todo lo que puede fallar se sabe ANTES de escribir (el formato, la
 * versión pisada, el freno de las salidas), así que se mira lo de los dos y
 * solo entonces se escribe. Lo que queda —que alguien publique justo en medio—
 * sigue cayendo del lado bueno gracias al orden.
 */
export async function publicarCierre(models, { resuelto, backlog, nota = null, por = null }) {
  const planes = {};
  const errores = [];
  for (const [nombre, entrada] of Object.entries({ resuelto, backlog })) {
    const plan = prepararPublicacion({
      nombre,
      contenido: entrada.contenido,
      actual: entrada.actual,
      base: entrada.actual.version,
    });
    if (plan.errores.length) errores.push(`${nombre}: ${plan.errores.join(" · ")}`);
    planes[nombre] = plan;
  }
  if (errores.length) {
    const e = new Error(`No se ha escrito nada. ${errores.join(" | ")}`);
    e.deUsuario = true;
    throw e;
  }

  const salida = {};
  for (const nombre of ["resuelto", "backlog"]) {
    const plan = planes[nombre];
    const actual = (nombre === "resuelto" ? resuelto : backlog).actual;
    if (plan.sinCambios) {
      salida[nombre] = { version: actual.version, tareas: actual.tareas, avisos: [] };
      continue;
    }
    const { fila } = await publicarVersion(models, {
      nombre,
      contenido: plan.contenido,
      nota,
      por,
      version: plan.versionNueva,
      tareas: plan.tareasDespues,
    });
    salida[nombre] = { version: fila.version, tareas: fila.tareas, avisos: plan.avisos };
  }
  return salida;
}
