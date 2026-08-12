import { readFile } from "node:fs/promises";
import path from "node:path";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { RESPONSABLES, repartirPorEstado } from "../../../../lib/tablero/estado.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * El Registro: lo que falta y lo que ya está.
 *
 * EL TEXTO EN EL REPO, EL ESTADO EN UNA TABLA (12/08/2026)
 * Este endpoint nació de solo lectura y con un motivo escrito: «un backlog en
 * base de datos se actualiza luego —y luego es nunca—; uno en el repo se revisa
 * en el diff, viaja con el código que lo resuelve y tiene historial de quién lo
 * escribió». Ese motivo sigue en pie para el TEXTO de cada tarea, y por eso
 * `docs/backlog.md` y `docs/resuelto.md` no se tocan desde aquí.
 *
 * Lo que Rodrigo pidió el 12/08 es otra cosa y no cabía en un fichero: repartir
 * («esto es tuyo») y marcar («esto ya está») en caliente, desde el móvil, sin
 * abrir el repositorio. Eso vive en `master.tablero_estado` y se pinta ENCIMA de
 * lo que dicen los ficheros: una tarea marcada sale en Resuelto aunque siga
 * escrita en `backlog.md`, y al quitarle el tick vuelve a Pendiente.
 *
 * ⚠️ NO SE PUEDE ESCRIBIR EN LOS `.md` DESDE AQUÍ, y no es una decisión de
 * criterio sino física: los dos ficheros viajan DENTRO de la imagen de Docker
 * (`Dockerfile:33`), así que lo que escribiéramos en el disco del contenedor se
 * lo llevaría el siguiente despliegue sin dar ningún error. Si algún día dejan
 * de aparecer, es esa línea del Dockerfile.
 *
 * Que una tarea esté marcada aquí NO la cierra de verdad: cerrarla sigue siendo
 * moverla a `resuelto.md` en el mismo commit que su arreglo. El tick es para
 * ponerse de acuerdo entre los dos; el commit es lo que deja constancia.
 *
 * Mismos tres candados que el resto del back-office.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

/**
 * Clientes conocidos, para poder colgarle cada tarea a quien es.
 *
 * `quality_energy`, `abarcaia` y `healim` se fueron el 12/08/2026 (baja y purga
 * del schema), pero SIGUEN AQUÍ a propósito: el tablero lee tareas históricas
 * del backlog y del registro de resueltas, y ahí sus nombres están escritos.
 * Quitarlos de esta lista no borra esas tareas — las deja sin cliente, con la
 * cola metida dentro del título, que es justo el despiste que costó apuntar a
 * `somos` ese mismo día.
 */
const SLUGS = [
  "aumenta", "nutri_laura", "spain_enzymes", "quality_energy",
  "retorika", "abarcaia", "healim", "demo", "sandbox",
  "salamandra_solutions", "somos",
];

/**
 * Destinatarios que no son un cliente, pero sí una respuesta legítima a «¿de
 * quién es esto?». Van al lado de los slugs y forman grupo propio.
 */
const GENERICOS = ["todos", "producto", "interno", "documentación", "varios"];

/**
 * Que el nombre esté SUELTO, no dentro de otra palabra: si no, «producto
 * (demostración)» le colgaría la tarea a `demo`. El guión bajo cuenta como
 * letra para que `nutri_laura` no case dentro de `nutri_laura_2`.
 */
const sueltoEn = (texto, nombre) =>
  new RegExp(`(^|[^a-z0-9_])${nombre}([^a-z0-9_]|$)`, "i").test(texto);

/**
 * Los destinatarios de una tarea, sacados de la cola del título.
 *
 * NO SE PARTE POR COMAS, y ese detalle es justo lo que hace que los recuentos
 * cuadren. Las colas están escritas a mano y no son listas limpias: hay «demo,
 * aumenta, salamandra_solutions», pero también «nutri_laura (y todos con
 * citas)». Partiendo por comas, esa segunda inventa un cliente llamado
 * «nutri_laura (y todos con citas)» que no cae en ningún grupo — que es
 * exactamente lo que hacía que Aumenta enseñara 7 tareas teniendo 10.
 *
 * Se buscan los nombres CONOCIDOS dentro de la cadena y se devuelven los que
 * estén, sin repetir. Una tarea de tres clientes sale en los tres grupos.
 */
function destinatarios(cola) {
  return [...SLUGS, ...GENERICOS].filter((n) => sueltoEn(cola, n));
}

/**
 * Trocea un fichero en secciones (`##`) y tareas (`###`).
 *
 * Se hace a mano y no con una librería de markdown porque lo que hace falta no
 * es HTML: es saber de qué cliente es cada cosa y en qué bloque cae. El cuerpo
 * se deja tal cual y lo pinta el navegador como texto.
 */
function trocear(texto) {
  /*
   * Se parte por /\r?\n/ y no por "\n" a secas (12/08/2026).
   *
   * Con finales de línea de Windows, cada línea conservaba su `\r` final. Y en
   * JavaScript el `.` no casa con `\r`, así que `/^##\s+(.+)$/` NO casaba con
   * «## P0 — hoy\r»: ninguna cabecera entraba, el troceador devolvía cero
   * secciones y la pantalla decía «Nada por aquí» — lo contrario de la verdad.
   *
   * Solo lo veía quien desarrolla en Windows, porque `core.autocrlf=true` deja
   * LF en el repositorio y en el contenedor no hay ni un `\r`. Y despistaba el
   * doble, porque `resuelto.md` sí estaba en LF y la pestaña de al lado se veía
   * bien, con lo que el fallo parecía de los datos.
   *
   * El arreglo va aquí, en el corte, y no aflojando los regex: así se limpian a
   * la vez las cabeceras y los cuerpos, que también arrastraban un `\r` por
   * línea porque `join("\n").trim()` solo toca los extremos.
   */
  const lineas = texto.split(/\r?\n/);
  const secciones = [];
  let seccion = null;
  let tarea = null;

  const cerrarTarea = () => {
    if (!tarea || !seccion) return;
    tarea.cuerpo = tarea.cuerpo.join("\n").trim();
    seccion.tareas.push(tarea);
    tarea = null;
  };

  for (const linea of lineas) {
    const h2 = linea.match(/^##\s+(.+)$/);
    const h3 = linea.match(/^###\s+(.+)$/);

    if (h2) {
      cerrarTarea();
      seccion = { titulo: h2[1].trim(), tareas: [] };
      secciones.push(seccion);
      continue;
    }

    if (h3 && seccion) {
      cerrarTarea();
      // El título lleva el cliente detrás de «·»: «Ocho familias … · nutri_laura»
      const bruto = h3[1].trim();
      const corte = bruto.lastIndexOf("·");
      let titulo = bruto;
      let quien = null;
      let quienes = [];
      if (corte > 0) {
        const cola = bruto.slice(corte + 1).replace(/`/g, "").trim();
        // Solo se separa si de verdad hay alguien conocido detrás: así un
        // título con un punto medio por otro motivo no se parte por la mitad.
        const encontrados = destinatarios(cola);
        if (encontrados.length > 0) {
          titulo = bruto.slice(0, corte).trim();
          quien = cola;
          quienes = encontrados;
        }
      }
      // `quien` es lo que escribió la persona y es lo que se enseña; `quienes`
      // es la lista para agrupar y contar. Son dos cosas distintas a propósito:
      // dentro del grupo de Aumenta sigue interesando ver que una tarea es
      // compartida con la demo.
      tarea = { titulo, quien, quienes, cuerpo: [] };
      continue;
    }

    if (tarea) tarea.cuerpo.push(linea);
  }
  cerrarTarea();

  // Fuera el manual de uso. Sus apartados también son `###` —«Cómo se añade una
  // tarea», «Prioridades»— así que se colaban como si fueran trabajo pendiente e
  // inflaban la cuenta. Se descarta por el título de la sección, que es lo único
  // que los distingue: las instrucciones se leen en el fichero, el tablero
  // enseña qué hacer.
  const ES_MANUAL = /^cómo se usa|^como se usa/i;
  return secciones.filter((s) => s.tareas.length > 0 && !ES_MANUAL.test(s.titulo));
}

async function leer(nombre) {
  try {
    return await readFile(path.join(process.cwd(), "docs", nombre), "utf8");
  } catch {
    return null;
  }
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
 */
async function estadosGuardados() {
  try {
    const { TableroEstado } = getMasterModels();
    const filas = await TableroEstado.findAll({
      attributes: ["clave", "asignadoA", "resuelta", "tocadaPor", "updatedAt"],
    });
    return new Map(filas.map((f) => [f.clave, f]));
  } catch (err) {
    process.stderr.write(`[tablero] sin estado guardado: ${err.message}\n`);
    return new Map();
  }
}

export const GET = withTenant(async (_request, _ctx, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const [backlog, resuelto, estados] = await Promise.all([
      leer("backlog.md"),
      leer("resuelto.md"),
      estadosGuardados(),
    ]);

    const repartidas = repartirPorEstado(
      backlog ? trocear(backlog) : null,
      resuelto ? trocear(resuelto) : null,
      estados
    );

    return ok({
      ...repartidas,
      responsables: RESPONSABLES,
      // Si faltan, es que no llegaron a la imagen. Se dice en vez de enseñar un
      // tablero vacío, que se leería como «no hay nada que hacer».
      faltan: [!backlog && "backlog.md", !resuelto && "resuelto.md"].filter(Boolean),
    });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * PATCH /api/admin/tablero — repartir una tarea o marcarla.
 *
 * Cuerpo: `{ clave, titulo?, asignadoA?, marcada? }`. Se manda solo lo que
 * cambia: `asignadoA: null` la deja sin dueño y `marcada: null` devuelve la
 * tarea a donde diga el fichero, que no es lo mismo que `false` (eso es
 * «reabierta a mano»).
 *
 * NO valida que la clave exista en los ficheros, y es deliberado: los `.md`
 * cambian con cada despliegue y una tarea puede reescribirse mientras alguien
 * tiene la pantalla abierta. Una fila que no case con nada no se pinta y no
 * molesta; rechazarla obligaría a leer y trocear los dos ficheros para poder
 * guardar un tick.
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
    });
  } catch (err) {
    return serverError(err);
  }
});
