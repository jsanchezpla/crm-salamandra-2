import { readFile } from "node:fs/promises";
import path from "node:path";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * GET /api/admin/tablero — lo que falta y lo que ya está, leído de los ficheros.
 *
 * POR QUÉ LEE MARKDOWN Y NO UNA TABLA DE LA BASE DE DATOS
 * Porque quien mantiene esto es quien programa, y lo hace en el mismo commit que
 * el arreglo. Un backlog en base de datos se actualiza «luego» —y luego es
 * nunca—; uno en el repo se revisa en el diff, viaja con el código que lo
 * resuelve y tiene historial de quién lo escribió y cuándo.
 *
 * Esta pantalla es para LEER. Es el tablero que Jorge y Rodrigo miran sin entrar
 * al repositorio; el detalle sigue estando en `docs/backlog.md` y
 * `docs/resuelto.md`, que son la única fuente.
 *
 * ⚠️ Los dos ficheros viajan a la imagen: hay una línea en el Dockerfile que los
 * copia. Si algún día dejan de aparecer aquí, es eso.
 *
 * Mismos tres candados que el resto del back-office.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

/** Clientes conocidos, para poder colgarle cada tarea a quien es. */
const SLUGS = [
  "aumenta", "nutri_laura", "spain_enzymes", "quality_energy",
  "retorika", "abarcaia", "healim", "demo", "sandbox",
  "salamandra_solutions",
  // `somos` se añadió el 12/08/2026: llevaba tiempo en producción y no estaba
  // aquí, así que cualquier tarea suya se pintaba con la cola metida dentro del
  // título y sin caer en ningún grupo. Es el mismo despiste que ya se documentó
  // con healim en CLAUDE.md — un cliente nuevo hay que apuntarlo también aquí.
  "somos",
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

export const GET = withTenant(async (_request, _ctx, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const [backlog, resuelto] = await Promise.all([leer("backlog.md"), leer("resuelto.md")]);

    return ok({
      pendiente: backlog ? trocear(backlog) : null,
      resuelto: resuelto ? trocear(resuelto) : null,
      // Si faltan, es que no llegaron a la imagen. Se dice en vez de enseñar un
      // tablero vacío, que se leería como «no hay nada que hacer».
      faltan: [!backlog && "backlog.md", !resuelto && "resuelto.md"].filter(Boolean),
    });
  } catch (err) {
    return serverError(err);
  }
});
