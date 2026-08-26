import { readFile } from "node:fs/promises";
import path from "node:path";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { RESPONSABLES, repartirPorEstado } from "../../../../lib/tablero/estado.js";
import { trocear } from "../../../../lib/tablero/parser.js";
import { ultimaVersion } from "../../../../lib/tablero/documentos.js";
import { candadoTablero as candado } from "../../../../lib/tablero/candado.js";
// La lista blanca de lo que se puede enseñar en pantalla vive en el Buzón y se
// IMPORTA en vez de copiarse: es una lista blanca de seguridad (el SVG está
// fuera a propósito, lleva scripts dentro), y dos copias de una lista blanca
// acaban siendo dos listas distintas, con la vieja aceptando lo que la nueva ya
// rechaza. Es una función pura sobre una extensión; no arrastra nada del Buzón.
import { tipoParaVerEnPantalla } from "../../../../lib/buzon/buzon.js";

/**
 * El Registro: lo que falta y lo que ya está.
 *
 * EL TEXTO Y EL ESTADO, LOS DOS EN MASTER (19/08/2026)
 * Este endpoint nació (09/08) de solo lectura, pintando `docs/backlog.md` y
 * `docs/resuelto.md`, que viajaban dentro de la imagen de Docker. El 12/08
 * Rodrigo pidió repartir («esto es tuyo») y marcar («esto ya está») en caliente
 * desde el móvil, y eso fue a `master.tablero_estado`, pintado ENCIMA del texto.
 * El 19/08 Jorge pidió que apuntar una tarea no costara un commit y un
 * despliegue —«los commits son para código»—, y el TEXTO pasó también a master:
 * `master.tablero_documentos`, una fila por versión, publicado con
 * `scripts/tablero-doc.js` (dentro del contenedor) o `scripts/registro.mjs`
 * (desde local, por ssh). El porqué largo, en `models/master/TableroDocumento.model.js`.
 *
 * Aquí se lee la versión actual de cada documento y se trocea con
 * `lib/tablero/parser.js` — el MISMO troceador con el que el script valida antes
 * de escribir, que es lo que hace que la validación valga. Si la tabla no tiene
 * todavía una fila (local recién clonado, o producción antes de la primera
 * publicación), se cae al fichero: `docs/registro/<nombre>.md` (la copia de
 * trabajo local, gitignored) o `docs/<nombre>.md` (la de la imagen, mientras
 * exista). El origen se devuelve y la pantalla lo dice.
 *
 * Que una tarea esté marcada aquí NO la cierra de verdad: cerrarla sigue siendo
 * moverla a Resuelto y publicar el Registro, con cómo se comprobó. El tick es
 * para ponerse de acuerdo entre los dos; la publicación es lo que deja
 * constancia.
 *
 * Mismos tres candados que el resto del back-office. Desde el 24/08/2026 viven
 * en `lib/tablero/candado.js`, porque los necesitan también los endpoints que
 * escriben tareas y los que sirven capturas: tres copias de un control de acceso
 * es como se llega a que a una de ellas le falte el tercer `if`.
 */

/**
 * La versión actual de un documento del Registro, con de dónde salió.
 *
 * Primero la tabla; si no hay fila (o la tabla todavía no existe: el despliegue
 * va por delante de la migración) se cae al fichero, y nunca lanza: un fallo
 * aquí se pinta como «no se ha podido leer», no como un 500 en blanco.
 */
async function leer(nombre) {
  try {
    const fila = await ultimaVersion(getMasterModels(), nombre);
    if (fila) {
      return {
        texto: fila.contenido,
        meta: {
          origen: "base",
          version: fila.version,
          publicadoEn: fila.createdAt,
          publicadoPor: fila.publicadoPor ?? null,
          nota: fila.nota ?? null,
        },
      };
    }
  } catch (err) {
    process.stderr.write(`[tablero] sin ${nombre} en master.tablero_documentos: ${err.message}\n`);
  }
  // Los dos `readFile` llevan el `path.join(process.cwd(), "docs", …)` DENTRO y
  // no en una variable: el rastreador de Turbopack lo lee así para acotar qué
  // ficheros pueden entrar; con la ruta en un array o un bucle pierde el
  // alcance y avisa de que «se ha trazado el proyecto entero» (build, 19/08).
  const fichero = `${nombre}.md`;
  try {
    const texto = await readFile(path.join(process.cwd(), "docs", "registro", fichero), "utf8");
    return { texto, meta: { origen: "fichero", ruta: `docs/registro/${fichero}` } };
  } catch {
    /* no hay copia de trabajo local */
  }
  try {
    const texto = await readFile(path.join(process.cwd(), "docs", fichero), "utf8");
    return { texto, meta: { origen: "fichero", ruta: `docs/${fichero}` } };
  } catch {
    /* tampoco viaja en la imagen */
  }
  return null;
}

/* ── El estado que se pone encima: reparto y tick ───────────────────────────
 *
 * La decisión de en qué pestaña cae cada tarea vive en `lib/tablero/estado.js`,
 * que es lógica pura y se prueba sin levantar Next ni tener sesión de
 * back-office. Aquí solo queda ir a buscar las filas.
 */

/**
 * Lo guardado, por clave. Nunca lanza: si la tabla todavía no existe —el
 * despliegue va por delante de la migración— el Registro se pinta como siempre,
 * sin tick y sin reparto, en vez de responder un 500 y quedarse en blanco.
 *
 * ⚠️ Y lo mismo vale para una COLUMNA que falte, que es lo que pasaría si se
 * desplegara esto antes de correr `migrate-tablero-estado.js`: Sequelize las
 * pide por nombre, así que sin `apuntada_en` el SELECT entero da 42703 y aquí
 * se traga — el tablero se vería sin tick, sin reparto y sin fechas, sin decir
 * por qué. Por eso la migración va ANTES del despliegue.
 */
async function estadosGuardados() {
  try {
    const { TableroEstado } = getMasterModels();
    const filas = await TableroEstado.findAll({
      attributes: [
        "clave",
        "asignadoA",
        "resuelta",
        "tocadaPor",
        "solucion",
        "apuntadaEn",
        "updatedAt",
      ],
    });
    return new Map(filas.map((f) => [f.clave, f]));
  } catch (err) {
    process.stderr.write(`[tablero] sin estado guardado: ${err.message}\n`);
    return new Map();
  }
}

/**
 * Las capturas de cada tarea, por ficha.
 *
 * Se piden TODAS de golpe y se reparten aquí en vez de una consulta por tarea:
 * son 137 tareas y hoy cero capturas, así que una consulta por tarea serían 137
 * viajes para no traer nada.
 *
 * Nunca lanza, por lo mismo que el estado: si la tabla todavía no existe —el
 * despliegue va por delante de la migración— el Registro se pinta como siempre,
 * sin capturas, en vez de responder un 500 y quedarse en blanco.
 *
 * La RUTA en disco no sale de aquí. La pantalla pide cada captura por su id.
 */
async function capturasGuardadas() {
  try {
    const { TableroAdjunto } = getMasterModels();
    const filas = await TableroAdjunto.findAll({
      // `ruta` se pide para poder decidir `verComo` a partir de la extensión que
      // guardamos nosotros, y NO sale en la respuesta: una ruta de disco en el
      // JSON es una invitación a construir la siguiente a mano.
      attributes: ["id", "ficha", "nombre", "ruta", "bytes", "subidoPor", "createdAt"],
      order: [["createdAt", "ASC"]],
    });
    const mapa = new Map();
    for (const f of filas) {
      if (!mapa.has(f.ficha)) mapa.set(f.ficha, []);
      mapa.get(f.ficha).push({
        id: f.id,
        nombre: f.nombre,
        bytes: f.bytes,
        subidoPor: f.subidoPor,
        creadaEn: f.createdAt,
        /*
         * Si se puede ver en pantalla, y CON QUÉ TIPO. Lo dice el servidor y no
         * lo adivina la pantalla, y esa es toda la gracia: es la misma lista
         * blanca con la que se sirve el fichero (`tipoParaVerEnPantalla`), así
         * que no puede haber una pantalla que pinte un `<img>` de algo que el
         * servidor va a mandar como descarga. Ese fallo ya estaba escrito y
         * duraba lo que tardara alguien en subir un `.avif`: la lista de la
         * pantalla lo aceptaba y la del servidor no.
         *
         * Y NO se manda el `mime` que declaró el navegador de quien la subió:
         * es texto que escribe quien sube, y aquí decide cómo se pinta.
         */
        verComo: tipoParaVerEnPantalla(f.ruta),
      });
    }
    return mapa;
  } catch (err) {
    process.stderr.write(`[tablero] sin capturas guardadas: ${err.message}\n`);
    return new Map();
  }
}

/** Le pega a cada tarea las suyas, dejando el resto del reparto como estaba. */
function conCapturas(secciones, capturas) {
  if (secciones === null) return null;
  return secciones.map((s) => ({
    ...s,
    tareas: s.tareas.map((t) => ({ ...t, capturas: (t.id && capturas.get(t.id)) || [] })),
  }));
}

export const GET = withTenant(async (_request, _ctx, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const [backlog, resuelto, estados, capturas] = await Promise.all([
      leer("backlog"),
      leer("resuelto"),
      estadosGuardados(),
      capturasGuardadas(),
    ]);

    const repartidas = repartirPorEstado(
      backlog ? trocear(backlog.texto) : null,
      resuelto ? trocear(resuelto.texto) : null,
      estados
    );

    return ok({
      pendiente: conCapturas(repartidas.pendiente, capturas),
      resuelto: conCapturas(repartidas.resuelto, capturas),
      responsables: RESPONSABLES,
      // De dónde salió cada documento (versión, fecha, quién, o el fichero de
      // respaldo). La pantalla lo pinta: un Registro leído del fichero en
      // producción es uno que nadie ha publicado todavía.
      documentos: {
        backlog: backlog?.meta ?? null,
        resuelto: resuelto?.meta ?? null,
      },
      // Si faltan, no hay fila en la tabla ni fichero de respaldo. Se dice en
      // vez de enseñar un tablero vacío, que se leería como «no hay nada que
      // hacer».
      faltan: [!backlog && "backlog", !resuelto && "resuelto"].filter(Boolean),
    });
  } catch (err) {
    return serverError(err);
  }
});

/** Tope de la solución escrita a mano. Ver el porqué donde se valida. */
const MAX_SOLUCION = 10_000;

/**
 * PATCH /api/admin/tablero — repartir una tarea, marcarla o escribir su solución.
 *
 * Cuerpo: `{ clave, titulo?, asignadoA?, marcada?, solucion? }`. Se manda solo lo
 * que cambia: `asignadoA: null` la deja sin dueño, `marcada: null` devuelve la
 * tarea a donde diga el texto publicado —que no es lo mismo que `false`, eso es
 * «reabierta a mano»— y `solucion: ""` o `null` borra lo escrito.
 *
 * NO valida que la clave exista en el texto publicado, y es deliberado: el
 * Registro se publica a cualquier hora y una tarea puede reescribirse mientras
 * alguien tiene la pantalla abierta. Una fila que no case con nada no se pinta
 * y no molesta; rechazarla obligaría a leer y trocear los dos documentos para
 * poder guardar un tick.
 */
export const PATCH = withTenant(async (request, _ctx, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const cuerpo = await request.json().catch(() => null);
    const clave = typeof cuerpo?.clave === "string" ? cuerpo.clave.trim() : "";
    if (!clave) return error("Falta la tarea");

    const cambios = {};

    if ("asignadoA" in (cuerpo ?? {})) {
      const quien = cuerpo.asignadoA;
      if (quien !== null && !RESPONSABLES.includes(quien)) {
        return error(`«${quien}» no está en la lista: ${RESPONSABLES.join(", ")}`);
      }
      cambios.asignadoA = quien;
    }

    if ("marcada" in (cuerpo ?? {})) {
      const marcada = cuerpo.marcada;
      if (marcada !== null && typeof marcada !== "boolean") {
        return error("«marcada» tiene que ser true, false o null");
      }
      cambios.resuelta = marcada;
    }

    /*
     * La solución, en texto libre.
     *
     * Vaciarla la BORRA (queda a null) en vez de guardar una cadena vacía: así
     * «no hay solución escrita» es UN solo estado y no dos que se pintan igual.
     * El tope es generoso a propósito —esto es una nota entre nosotros, no un
     * campo de un formulario público— pero existe: sin él, un pegado accidental
     * de medio fichero entra en la base y se arrastra en cada carga del tablero.
     */
    if ("solucion" in (cuerpo ?? {})) {
      const texto = cuerpo.solucion;
      if (texto !== null && typeof texto !== "string") {
        return error("«solucion» tiene que ser texto, o null para borrarla");
      }
      const limpia = (texto ?? "").trim();
      if (limpia.length > MAX_SOLUCION) {
        return error(
          `La solución se pasa de larga: ${limpia.length} de ${MAX_SOLUCION} caracteres.`
        );
      }
      cambios.solucion = limpia || null;
    }

    if (!Object.keys(cambios).length) return error("No se ha pedido ningún cambio");

    const { TableroEstado, User } = getMasterModels();

    // Quién la tocó. Se guarda en la propia fila y no en `audit_logs`: esa tabla
    // es de lo que pasa DENTRO de un cliente, y esto es una nota entre nosotros
    // dos sobre una tarea nuestra.
    //
    // El correo hay que ir a buscarlo: el contexto solo trae `id`, `role` y
    // `moduleAccess`. Best-effort — un fallo aquí no puede tumbar el guardado,
    // y sin correo se queda el id, que también identifica.
    cambios.tocadaPor = ctx.user?.id ?? null;
    if (ctx.user?.id) {
      try {
        const quien = await User.findByPk(ctx.user.id, { attributes: ["email"] });
        if (quien?.email) cambios.tocadaPor = quien.email;
      } catch {
        /* se queda el id */
      }
    }

    if (typeof cuerpo?.titulo === "string" && cuerpo.titulo.trim()) {
      cambios.titulo = cuerpo.titulo.trim();
    }

    const [fila] = await TableroEstado.findOrCreate({
      where: { clave },
      defaults: { clave, ...cambios },
    });
    await fila.update(cambios);

    return ok({
      clave: fila.clave,
      asignadoA: fila.asignadoA ?? null,
      marcada: fila.resuelta ?? null,
      tocadaPor: fila.tocadaPor ?? null,
      solucion: fila.solucion ?? null,
    });
  } catch (err) {
    return serverError(err);
  }
});
