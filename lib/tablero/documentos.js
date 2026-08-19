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
import { comprobar, contarTareas, diferenciaDeTitulos, DOCUMENTOS } from "./parser.js";

/** Cuántas versiones se conservan por documento; las más viejas se podan al publicar. */
export const VERSIONES_QUE_SE_GUARDAN = 50;

/** Tope del texto. El Registro entero son ~210 KB; esto es diez veces eso. */
export const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Si entran menos del 70 % de las tareas que había, alguien ha pegado medio
 * fichero. Se puede publicar igual con `forzar`, pero hay que decirlo.
 */
const PROPORCION_MINIMA = 0.7;

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

  if (actual && tareasAntes > 0 && tareasDespues < tareasAntes * PROPORCION_MINIMA) {
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

  return { fila, podadas };
}
