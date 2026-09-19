// @prueba ligera — cuenta líneas leyendo el disco; sin base, sin servidor, sin .env.
/**
 * _smoke-tamano-ficheros.mjs — lo que se parte no vuelve a engordar (18/09/2026).
 *
 *   node scripts/_smoke-tamano-ficheros.mjs
 *   node scripts/pruebas.mjs --solo=tamano
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * El 27/08/2026 se partieron las cuatro pantallas más grandes
 * (`docs/decisions/2026-08-27-partir-las-cuatro-pantallas-mas-grandes.md`).
 * `modules/default/CitasModule.jsx` pasó de 2.672 líneas a 869. Tres semanas
 * después está en 1.917. Peor: `NuevaCitaDrawer.jsx`, que fue UNA de las piezas
 * extraídas aquel día, está hoy en 2.034 — la zona de Citas suma más líneas
 * repartidas en tres ficheros que las que tenía en uno solo.
 *
 * Nadie lo hizo mal a propósito: se ve creciendo de veinte en veinte y ninguna
 * de esas veinte es el problema. Un documento no lo evitó, porque lo que se ve
 * y no frena, se ignora. Esto sí frena.
 *
 * ── QUÉ COMPRUEBA ──────────────────────────────────────────────────────────
 *
 * Que ningún fichero de `app/`, `components/`, `lib/` o `modules/` pasa de
 * TOPE líneas... salvo los que YA lo pasaban el 18/09/2026, que están
 * congelados abajo con su tamaño de ese día. A esos no se les pide encoger:
 * solo se les prohíbe crecer.
 *
 * Fuera quedan `scripts/` (las pruebas son largas por naturaleza) y `models/`
 * (son declaraciones, no se leen para arreglar una incidencia).
 *
 * ── SI ESTA PRUEBA SE PONE ROJA ────────────────────────────────────────────
 *
 * Son dos salidas, y la primera es la buena:
 *
 *   1. **Sacar una pieza.** Si has añadido 40 líneas a una pantalla de 1.800,
 *      casi siempre esas 40 son un trozo con nombre propio que puede vivir en
 *      su fichero. Eso es lo que esta prueba está pidiendo.
 *   2. **Subir su número aquí, con el motivo en la misma línea.** Una línea,
 *      no un refactor a media tarea. Lo único que no vale es borrar la entrada
 *      o subir el TOPE general: entonces esto deja de servir para nada.
 *
 * El motivo de que el número viva en el código y no en un fichero aparte es que
 * subirlo SE VEA en el diff, al lado del cambio que lo sube.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const CARPETAS = ["app", "components", "lib", "modules"];
const TOPE = 1200;

// La deuda del 18/09/2026, con su tamaño de ese día. No pueden crecer.
const CONGELADOS = {
  "app/(dashboard)/facturacion/cobros/page.jsx": 2517,
  "modules/default/citas/NuevaCitaDrawer.jsx": 2034,
  "app/(dashboard)/facturacion/facturas/page.jsx": 2006,
  "lib/provisioning/integraciones.js": 1953,
  "modules/default/CitasModule.jsx": 1917,
  "app/(dashboard)/facturacion/cuotas/page.jsx": 1837,
  "app/admin/clientes/page.jsx": 1743,
  "components/clinica/RegistroSesionEditor.jsx": 1722,
  "app/(dashboard)/pacientes/[id]/page.jsx": 1693,
  "app/(dashboard)/calendario/page.jsx": 1679,
  "modules/default/citas/CitaDetalleModal.jsx": 1537,
  "app/(dashboard)/formacion/empresas/[id]/page.jsx": 1518,
  "lib/db/tenantDb.js": 1410,
  "modules/default/ClientDetailModule.jsx": 1384,
  "app/admin/tablero/page.jsx": 1363, // 19/09: +4 del arreglo de asuntos repetidos (88e35db4)
  "lib/home/summary.js": 1284,
  "app/(dashboard)/clientes/ClientesClient.jsx": 1280,
  "components/clinica/InformeEditor.jsx": 1280,
  "modules/config/ConfigModule.jsx": 1213,
  "app/api/public/c/[tenantSlug]/book/route.js": 1204,
};

function recorrer(dir, salida = []) {
  for (const entrada of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entrada.name}`;
    if (entrada.isDirectory()) recorrer(rel, salida);
    else if (/\.(js|jsx|mjs)$/.test(entrada.name)) salida.push(rel);
  }
  return salida;
}

function lineasDe(rel) {
  const texto = readFileSync(join(RAIZ, rel), "utf8");
  return texto.split("\n").length - (texto.endsWith("\n") ? 1 : 0);
}

describe("el tamaño de los ficheros no sube", () => {
  it("ninguno pasa del tope, y los congelados no crecen", () => {
    const pasados = [];

    for (const carpeta of CARPETAS) {
      for (const rel of recorrer(carpeta)) {
        const lineas = lineasDe(rel);
        const limite = Math.max(TOPE, CONGELADOS[rel] ?? 0);
        if (lineas > limite) {
          const congelado = CONGELADOS[rel];
          pasados.push(
            congelado
              ? `  ${rel}: ${lineas} líneas, ${lineas - congelado} más que las ${congelado} congeladas`
              : `  ${rel}: ${lineas} líneas, ${lineas - TOPE} por encima del tope de ${TOPE}`,
          );
        }
      }
    }

    assert.equal(
      pasados.length,
      0,
      `\n${pasados.join("\n")}\n\nSaca una pieza a su propio fichero, o sube su número en ` +
        "CONGELADOS de scripts/_smoke-tamano-ficheros.mjs diciendo por qué.\n",
    );
  });

  it("la lista de congelados no tiene fantasmas", () => {
    // Una excepción que apunta a un fichero borrado o renombrado es una lista a
    // mano mintiendo, que es justo lo que no queremos (regla del 10/08/2026).
    const fantasmas = Object.keys(CONGELADOS).filter((rel) => !existsSync(join(RAIZ, rel)));
    assert.deepEqual(fantasmas, [], `sobran en CONGELADOS: ${fantasmas.join(", ")}`);
  });
});
