// @prueba ligera
/**
 * Facturas: ningún hook lee un estado antes de que se declare.
 *
 * Dos veces (31/08/2026 y 04/09/2026) un `useEffect` nuevo se colocó por
 * encima del `useState` de `form` con `form.clientId` en sus dependencias.
 * Las dependencias se evalúan en cada render, así que la página entera caía
 * con «Cannot access 'form' before initialization» —en producción, para
 * todos los clientes— y `npm run build` no lo ve: es un error de ejecución.
 *
 * Aquí se lee el fichero como texto: para cada estado de la lista, la primera
 * línea de código de `FacturasPage` que lo nombra tiene que ser (o ir después
 * de) su declaración. Los comentarios no cuentan.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const FICHERO = "app/(dashboard)/facturacion/facturas/page.jsx";
const ESTADOS = ["form", "openInvoice", "editing", "clienteElegido", "invoices"];

function cuerpoDe(componente, fuente) {
  const inicio = fuente.indexOf(`export default function ${componente}(`);
  assert.ok(inicio >= 0, `no encuentro ${componente} en ${FICHERO}`);
  const resto = fuente.slice(inicio);
  // Hasta la siguiente función de nivel superior (o el final).
  const fin = resto.slice(1).search(/^(?:export )?function \w+\(|^const [A-Z_]+ = /m);
  return resto.slice(0, fin > 0 ? fin + 1 : undefined);
}

function sinComentarios(codigo) {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/.*$/gm, "");
}

test("Facturas: los hooks no leen form/openInvoice/editing antes de declararlos", () => {
  const fuente = readFileSync(join(RAIZ, FICHERO), "utf8").replace(/\r\n/g, "\n");
  const lineas = sinComentarios(cuerpoDe("FacturasPage", fuente)).split("\n");
  for (const nombre of ESTADOS) {
    const declaracion = lineas.findIndex((l) => new RegExp(`(?:const|let) \\[${nombre},`).test(l));
    assert.ok(declaracion >= 0, `no encuentro el useState de ${nombre}`);
    const primera = lineas.findIndex((l) => new RegExp(`\\b${nombre}\\b`).test(l));
    assert.ok(
      primera >= declaracion,
      `«${nombre}» se lee en la línea ${primera + 1} del componente y se declara en la ${declaracion + 1}: ` +
        `un hook lo usa antes de su useState y la página cae con «Cannot access before initialization»`,
    );
  }
});
