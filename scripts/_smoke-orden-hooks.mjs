// @prueba ligera
/**
 * Ninguna pantalla lee un `useState` antes de declararlo.
 *
 * Tres veces en nueve días la misma caída, y siempre en producción:
 *
 *   · 31/08 y 04/09/2026 — Facturas: un `useEffect` nuevo por encima del
 *     `useState` de `form`, con `form.clientId` en sus dependencias.
 *   · 08/09/2026 — Cobros: el bloque que explica de dónde sale cada cifra
 *     (AV-0085/AV-0086) leía `pendientesDelMes` cien líneas antes de su
 *     `useState`. La pantalla entera devolvía 500 con «Cannot access 'aE'
 *     before initialization», y `npm run build` no lo ve: es de ejecución.
 *
 * `_smoke-facturas-orden-hooks.mjs` vigila cinco estados de UNA pantalla. Esto
 * barre TODAS, porque el fallo no se queda quieto en el fichero donde salió.
 *
 * ── QUÉ CUENTA COMO «ANTES» ────────────────────────────────────────────────
 *
 * Solo el nivel de render: una línea con dos espacios de sangría dentro del
 * componente, o la línea de dependencias de un hook (`}, [ ... ]`). Dentro de
 * un `onClick` o del cuerpo de un `useEffect` no hay TDZ — eso corre después
 * del render, cuando la constante ya existe—, y marcarlo sería ruido que
 * acabaría con la prueba desactivada.
 *
 * Por eso mismo no cuentan ni las cadenas de texto, ni una variable local que
 * se llame igual, ni los parámetros de una función: los tres dan falso
 * positivo y los tres se descartan aquí abajo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

function paginas(dir, out = []) {
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) paginas(p, out);
    else if (entrada === "page.jsx" || entrada === "page.js") out.push(p);
  }
  return out;
}

/** Comentarios y cadenas fuera: dentro de ellos un nombre no es un uso. */
function soloCodigo(fuente) {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/.*$/gm, "")
    .replace(/`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/"(?:[^"\\]|\\.)*"/g, (m) => m.replace(/[^"]/g, " "))
    .replace(/'(?:[^'\\]|\\.)*'/g, (m) => m.replace(/[^']/g, " "));
}

/** El nombre a secas: ni `.nombre`, ni `nombre:` de un objeto. */
const usaSuelto = (linea, nombre) => new RegExp("(^|[^.\\w$])" + nombre + "\\b(?!\\s*:)").test(linea);

/** Una variable local o un parámetro con el mismo nombre no son el estado. */
function esOtroConEseNombre(linea, nombre) {
  if (new RegExp("(?:const|let|var)\\s+" + nombre + "\\b").test(linea)) return true;
  if (/^\s*(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(/.test(linea)) return true;
  const flecha = linea.indexOf("=>");
  if (flecha >= 0 && usaSuelto(linea.slice(0, flecha), nombre)) return true;
  return false;
}

/**
 * El cuerpo del componente y nada más, contando llaves. Lo que va DESPUÉS
 * —funciones sueltas del módulo— tiene su código a dos espacios igual que el
 * nivel de render, y sus parámetros darían falsos positivos.
 */
function cuerpoDelComponente(codigo, desde) {
  let profundidad = 0;
  for (let i = desde; i < codigo.length; i++) {
    if (codigo[i] === "{") profundidad++;
    else if (codigo[i] === "}") {
      profundidad--;
      if (profundidad === 0) return codigo.slice(desde, i + 1);
    }
  }
  return codigo.slice(desde);
}

function usoAntesDeDeclarar(fuente) {
  const arranque = fuente.match(/export default function (\w+)\(/);
  if (!arranque) return [];
  const codigo = soloCodigo(fuente);
  const cuerpo = cuerpoDelComponente(codigo, codigo.indexOf(arranque[0]));
  const lineas = cuerpo.split("\n");
  const estados = new Set([...cuerpo.matchAll(/const \[(\w+), *set\w+\] = useState/g)].map((m) => m[1]));
  const fallos = [];
  for (const nombre of estados) {
    const declara = new RegExp("const \\[" + nombre + ", *set\\w+\\] = useState");
    const decl = lineas.findIndex((l) => declara.test(l));
    if (decl < 0) continue;
    for (let i = 0; i < decl; i++) {
      const linea = lineas[i];
      const nivelRender = /^ {2}\S/.test(linea) || /^ {2}\}, \[/.test(linea);
      if (!nivelRender) continue;
      if (!usaSuelto(linea, nombre) || esOtroConEseNombre(linea, nombre)) continue;
      fallos.push({ nombre, usa: i + 1, declara: decl + 1, linea: linea.trim().slice(0, 100) });
      break;
    }
  }
  return fallos;
}

test("ninguna pantalla usa un useState antes de declararlo", () => {
  const problemas = [];
  for (const fichero of paginas(join(RAIZ, "app"))) {
    const fuente = readFileSync(fichero, "utf8").replace(/\r\n/g, "\n");
    for (const f of usoAntesDeDeclarar(fuente)) {
      problemas.push(
        `${relative(RAIZ, fichero).replace(/\\/g, "/")} · «${f.nombre}» se usa en la línea ${f.usa} del ` +
          `componente y se declara en la ${f.declara}: ${f.linea}`
      );
    }
  }
  assert.deepEqual(
    problemas,
    [],
    `la pantalla cae entera con «Cannot access ... before initialization»:\n  ${problemas.join("\n  ")}`
  );
});

test("el barrido pilla la caída de Cobros del 08/09/2026", () => {
  // El fallo real, reducido: el bloque derivado por encima del useState.
  const roto = [
    "export default function CobrosPage() {",
    "  const [form, setForm] = useState({});",
    "  const pendientesExplicados = pendientesDelMes.map(explicado);",
    "  const [pendientesDelMes, setPendientesDelMes] = useState([]);",
    "  return null;",
    "}",
  ].join("\n");
  const fallos = usoAntesDeDeclarar(roto);
  assert.equal(fallos.length, 1);
  assert.equal(fallos[0].nombre, "pendientesDelMes");

  // Y el mismo fichero con el bloque en su sitio pasa.
  const sano = [
    "export default function CobrosPage() {",
    "  const [pendientesDelMes, setPendientesDelMes] = useState([]);",
    "  const pendientesExplicados = pendientesDelMes.map(explicado);",
    "  return null;",
    "}",
  ].join("\n");
  assert.deepEqual(usoAntesDeDeclarar(sano), []);
});
