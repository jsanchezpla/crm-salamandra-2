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
];

/**
 * Trocea un fichero en secciones (`##`) y tareas (`###`).
 *
 * Se hace a mano y no con una librería de markdown porque lo que hace falta no
 * es HTML: es saber de qué cliente es cada cosa y en qué bloque cae. El cuerpo
 * se deja tal cual y lo pinta el navegador como texto.
 */
function trocear(texto) {
  const lineas = texto.split("\n");
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
      if (corte > 0) {
        const cola = bruto.slice(corte + 1).replace(/`/g, "").trim();
        // Solo se separa si de verdad es un cliente conocido (o «todos» /
        // «producto» / «interno»): así un título con un punto medio por otro
        // motivo no se parte por la mitad.
        if (SLUGS.some((s) => cola.includes(s)) || /^(todos|producto|interno|documentación)/i.test(cola)) {
          titulo = bruto.slice(0, corte).trim();
          quien = cola;
        }
      }
      tarea = { titulo, quien, cuerpo: [] };
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
