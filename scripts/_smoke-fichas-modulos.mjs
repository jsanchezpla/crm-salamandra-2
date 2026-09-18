// @prueba ligera — datos de /lib y ficheros del repo; sin base, sin servidor, sin .env.
/**
 * _smoke-fichas-modulos.mjs — la ficha de cada módulo dice la verdad (18/09/2026).
 *
 *   node scripts/_smoke-fichas-modulos.mjs
 *   node --test-name-pattern="pantallas" scripts/_smoke-fichas-modulos.mjs
 *
 * Prueba `lib/provisioning/queHaceCadaModulo.js`, que es lo que se lee en
 * `/admin/modulos` para saber qué hace un módulo sin abrir `docs/modules/`.
 *
 * ── POR QUÉ NO BASTA CON LA COBERTURA ──────────────────────────────────────
 *
 * Comprobar solo que cada módulo tiene ficha caza que FALTE una, no que una
 * MIENTA, que es lo que pasa de verdad: una pantalla se renombra, la ficha
 * sigue diciendo la ruta vieja y nadie se entera hasta que alguien la busca
 * delante de un cliente. Por eso `trae` no son frases sueltas sino
 * `{ que, donde }` con la ruta real: aquí se comprueba que esa carpeta existe
 * con su `page.jsx` bajo `app/(dashboard)/`. El día que la pantalla se mueva,
 * esto se pone rojo.
 *
 * Y por eso se mide el largo de `hace`: lo que Jorge pidió es «verlo todo de un
 * vistazo y que no se haga tedioso», y eso no lo protege ninguna regla de
 * código — solo un tope. 120 caracteres es una línea en la pantalla.
 *
 * La biyección con `CLAVES_VALIDAS` (de `catalogo.js`, que sigue siendo quien
 * decide qué módulos existen) hace que un módulo nuevo no pueda llegar sin
 * ficha. Y la lectura del Sidebar caza el caso de antes: el módulo que llega
 * con entrada de menú y sin pasar por el catálogo.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CLAVES_VALIDAS } from "../lib/provisioning/catalogo.js";
import { FICHAS, FUERA_DEL_CATALOGO, fichaDe } from "../lib/provisioning/queHaceCadaModulo.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DASHBOARD = path.join(RAIZ, "app", "(dashboard)");

/** Todas las parejas `{ clave, ...ficha }`, para recorrerlas sin anidar bucles. */
const fichas = Object.entries(FICHAS).map(([clave, f]) => ({ clave, ...f }));

/** Todas las pantallas declaradas, con su módulo delante para el mensaje de error. */
const pantallas = fichas.flatMap((f) => (f.trae ?? []).map((t) => ({ modulo: f.clave, ...t })));

/**
 * La carpeta de una ruta del dashboard. Se corta por el primer segmento
 * dinámico (`/clientes/[id]` → `/clientes`): la carpeta del padre es la que
 * tiene que existir, y en la ficha no se escriben rutas con parámetros.
 */
function carpetaDe(ruta) {
  const limpia = ruta.split("/[")[0].replace(/^\//, "");
  return path.join(DASHBOARD, limpia);
}

function tienePagina(ruta) {
  const carpeta = carpetaDe(ruta);
  return existsSync(path.join(carpeta, "page.jsx")) || existsSync(path.join(carpeta, "page.js"));
}

describe("cobertura — ninguna clave se queda sin ficha ni sobra", () => {
  it("hay una ficha por cada clave del catálogo", () => {
    const sinFicha = [...CLAVES_VALIDAS].filter((k) => !FICHAS[k]);
    assert.deepEqual(sinFicha, [], `Módulos del catálogo sin ficha en queHaceCadaModulo.js: ${sinFicha.join(", ")}`);
  });

  it("ninguna ficha describe un módulo que no existe", () => {
    const inventadas = Object.keys(FICHAS).filter((k) => !CLAVES_VALIDAS.has(k));
    assert.deepEqual(inventadas, [], `Fichas de claves que no están en el catálogo: ${inventadas.join(", ")}`);
  });

  it("fichaDe() devuelve null para lo que no conoce", () => {
    assert.equal(fichaDe("no_existe_este_modulo"), null);
    assert.notEqual(fichaDe("clients"), null);
  });
});

/*
 * Un `it` por regla y NO uno por módulo (29) ni uno por pantalla (60): cada
 * aserción lleva dentro la lista de los que fallan, así que se pierde cero
 * información y el fichero acaba en una décima parte del tiempo. No es cosmética
 * — `scripts/pruebas.mjs` lanza los ficheros EN PARALELO, y el suite tiene una
 * prueba que mide milisegundos (`_smoke-tope-gasto-ia.mjs`: 20 ms de espera con
 * 200 ms de margen). Un fichero nuevo que se entretiene la tumba sin tener nada
 * que ver con ella.
 */
describe("forma — se tiene que poder leer de un vistazo", () => {
  it("el «hace» es una frase de una línea, de como mucho 120 caracteres", () => {
    const largos = fichas
      .filter((f) => typeof f.hace !== "string" || !f.hace.trim() || f.hace.length > 120)
      .map((f) => `${f.clave} (${f.hace?.length ?? 0})`);
    assert.deepEqual(
      largos,
      [],
      `El «hace» se lee con el desplegable CERRADO: tope 120 caracteres. Se pasan: ${largos.join(", ")}`,
    );
  });

  it("cada módulo dice qué trae, con rutas bien escritas", () => {
    const mal = fichas
      .filter((f) => !Array.isArray(f.trae) || f.trae.length === 0)
      .map((f) => `${f.clave}: sin pantallas`)
      .concat(
        pantallas
          .filter((p) => !p.que?.trim() || !p.donde?.startsWith("/"))
          .map((p) => `${p.modulo}: «${p.que}» → ${p.donde}`),
      );
    assert.deepEqual(mal, [], `Pantallas mal declaradas: ${mal.join(" · ")}`);
  });

  it("los avisos son frases, no huecos", () => {
    const vacios = fichas
      .filter((f) => f.ojo !== undefined)
      .flatMap((f) =>
        !Array.isArray(f.ojo)
          ? [`${f.clave}: «ojo» no es una lista`]
          : f.ojo.filter((a) => typeof a !== "string" || !a.trim()).map(() => `${f.clave}: aviso vacío`),
      );
    assert.deepEqual(vacios, [], vacios.join(" · "));
  });
});

describe("pantallas — las rutas existen de verdad", () => {
  it("cada ruta declarada tiene su page.jsx en app/(dashboard)", () => {
    const rotas = pantallas.filter((p) => !tienePagina(p.donde)).map((p) => `${p.modulo} → ${p.donde}`);
    assert.deepEqual(
      rotas,
      [],
      `Fichas que prometen una pantalla que no está: ${rotas.join(" · ")}. ` +
        "O la pantalla se movió y la ficha se quedó vieja, o la ruta está mal escrita.",
    );
  });
});

describe("docs — cada módulo con su doc", () => {
  it("el doc que declara una ficha existe", () => {
    const rotos = fichas
      .filter((f) => f.doc)
      .filter((f) => !existsSync(path.join(RAIZ, f.doc)))
      .map((f) => `${f.clave} → ${f.doc}`);
    assert.deepEqual(rotos, [], `Fichas que apuntan a un doc que no existe: ${rotos.join(", ")}`);
  });

  it("el único módulo sin doc es calendar", () => {
    const sinDoc = fichas.filter((f) => !f.doc).map((f) => f.clave).sort();
    assert.deepEqual(
      sinDoc,
      ["calendar"],
      "Si aquí sale un módulo nuevo, es que se construyó sin doc en docs/modules/. " +
        "Si desaparece calendar, quita esta excepción.",
    );
  });
});

describe("el sidebar no puede traer un módulo que el catálogo no conozca", () => {
  it("todas las moduleKey del menú están en el catálogo", () => {
    // Se lee como TEXTO a propósito: Sidebar.jsx es un client component con JSX
    // y no se puede importar desde node:test.
    const fuente = readFileSync(path.join(RAIZ, "components", "layout", "Sidebar.jsx"), "utf8");
    const claves = new Set();
    for (const m of fuente.matchAll(/moduleKey:\s*"([^"]+)"/g)) claves.add(m[1]);
    for (const m of fuente.matchAll(/requiresAll:\s*\[([^\]]+)\]/g)) {
      for (const k of m[1].matchAll(/"([^"]+)"/g)) claves.add(k[1]);
    }

    const huerfanas = [...claves].filter((k) => !CLAVES_VALIDAS.has(k)).sort();
    assert.deepEqual(
      huerfanas,
      [],
      `El menú gatea por claves que no están en el catálogo (y por tanto no tienen ficha): ${huerfanas.join(", ")}`,
    );
  });
});

describe("fuera del catálogo — lo que sale en la base y no se vende", () => {
  it("ninguna es un módulo del catálogo", () => {
    const coladas = Object.keys(FUERA_DEL_CATALOGO).filter((k) => CLAVES_VALIDAS.has(k));
    assert.deepEqual(
      coladas,
      [],
      `Estas claves ya SÍ se venden: sácalas de FUERA_DEL_CATALOGO y escríbeles su ficha: ${coladas.join(", ")}`,
    );
  });

  it("ninguna tiene ficha", () => {
    const dobles = Object.keys(FUERA_DEL_CATALOGO).filter((k) => FICHAS[k]);
    assert.deepEqual(dobles, [], `Claves en los dos sitios a la vez: ${dobles.join(", ")}`);
  });

  it("cada una explica por qué está ahí", () => {
    for (const [clave, porQue] of Object.entries(FUERA_DEL_CATALOGO)) {
      assert.ok(typeof porQue === "string" && porQue.trim(), `${clave} no explica por qué no se vende`);
    }
  });
});
