// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-anchos-y-ayuda.mjs — tres reglas de pantalla que se borran solas
 * (24/08/2026).
 *
 * ── POR QUÉ ES UNA PRUEBA DE TEXTO Y NO DE COMPORTAMIENTO ──────────────────
 * Lo que vigila esto son clases de CSS y una entrada de menú dentro de
 * componentes de React que no se pueden importar aquí (llevan JSX y `use
 * client`). El propio CLAUDE.md admite la regex sobre el fuente para justo esto:
 * «¿sigue el `if` donde estaba?». No prueba que la pantalla se vea bien —eso se
 * mide en el navegador—; prueba que nadie ha deshecho la decisión sin enterarse.
 *
 * Las tres reglas, y lo que costó cada una:
 *
 *   1. LA FICHA DE CLIENTE MIDE LO MISMO EN TODAS SUS PESTAÑAS. Su ancho lo
 *      decide el contenedor de la pestaña, no cada tarjeta. Antes lo decidían
 *      VEINTIUNA tarjetas con su `max-w-` a mano y la ficha saltaba entre 768,
 *      1.024 y 1.636 según lo que pulsaras.
 *
 *   2. LA PORTADA VA CENTRADA. Sus cuatro contenedores llevan `mx-auto`. Sin
 *      él, el contenido se pega a la izquierda y amontona 596 px de blanco a la
 *      derecha en un monitor de 1.920. Son CUATRO y en DOS ficheros: si alguien
 *      toca uno solo, la portada se desalinea consigo misma.
 *
 *   3. «AYUDA» ESTÁ EN EL MENÚ, PERO NO EN LAS DEMOS. Las cuatro demos son
 *      públicas y dan sesión de admin a cualquiera: una fila «Ayuda» ahí es una
 *      puerta a Salamandra delante de un visitante anónimo.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const lee = (rel) => readFileSync(join(RAIZ, rel), "utf8");

/* ═══ 1 · La ficha de cliente ═══════════════════════════════════════════════ */

describe("la ficha de cliente decide su ancho en UN sitio", () => {
  // Los ficheros que pintan las tarjetas de la ficha. Ninguno puede volver a
  // llevar su propio `max-w-Nxl`: si lo lleva, vuelve el salto entre pestañas.
  const TARJETAS = [
    "components/clients/ClientAttachmentsPanel.jsx",
    "components/clients/ClientBonosSection.jsx",
    "components/clients/ClientBookingsPanel.jsx",
    "components/clients/ClientCitasSection.jsx",
    "components/clients/ClientComunicacionesSection.jsx",
    "components/clients/ClientConsultaExternaSection.jsx",
    "components/clients/ClientContactMethodsSection.jsx",
    "components/clients/ClientContractSection.jsx",
    "components/clients/ClientCuentaWebSection.jsx",
    "components/clients/ClientFiscalSection.jsx",
    "components/clients/ClientGuardiansSection.jsx",
    "components/clients/ClientModulesSection.jsx",
    "components/clients/ClientNotesPanel.jsx",
    "components/clients/ClientPatientsSection.jsx",
    "components/clients/ClientPortalMonthsSection.jsx",
    "components/clients/ClientProfesionalSection.jsx",
    "components/clients/ClientWhatsappSection.jsx",
    "modules/nutricion/ClientPlansPanel.jsx",
  ];

  test("ninguna tarjeta se escribe su propio ancho", () => {
    const culpables = [];
    for (const rel of TARJETAS) {
      // Solo el código: un `max-w-` mencionado en un comentario es historia, no
      // una clase. Se descartan las líneas que empiezan por // o *.
      for (const [i, linea] of lee(rel).split(/\r?\n/).entries()) {
        const limpia = linea.trim();
        if (limpia.startsWith("//") || limpia.startsWith("*") || limpia.startsWith("/*")) continue;
        if (/max-w-\d?xl/.test(limpia)) culpables.push(`${rel}:${i + 1}`);
      }
    }
    assert.deepEqual(
      culpables,
      [],
      `estas tarjetas han vuelto a escribirse su ancho, y con eso vuelve el salto entre pestañas:\n  ${culpables.join("\n  ")}`
    );
  });

  test("el contenedor de la pestaña sí lo lleva, y sin centrar", () => {
    const base = lee("modules/default/ClientDetailModule.jsx");
    assert.match(
      base,
      /className=\{activo \? "max-w-5xl" : "hidden"\}/,
      "PanelPestana ha perdido el ancho: si no lo lleva él, no lo lleva nadie"
    );
    // Sin `mx-auto` a propósito: el nombre del cliente y la barra de pestañas
    // viven FUERA de este cuerpo, así que centrar solo lo de dentro las
    // desalinearía 306 px. Está explicado en el propio fichero.
    assert.doesNotMatch(
      base,
      /className=\{activo \? "max-w-5xl mx-auto"/,
      "se ha centrado el cuerpo sin centrar la cabecera: eso deja el nombre del cliente 306 px a la izquierda de sus tarjetas"
    );
  });

  test("la ficha propia de nutri_laura lleva el mismo ancho", () => {
    const laura = lee("modules/overrides/nutri-laura/ClientDetailModule.jsx");
    assert.match(
      laura,
      /<div className="max-w-5xl">/,
      "la ficha de Laura ha perdido su contenedor: volvería a saltar entre cinco anchos"
    );
  });
});

/* ═══ 2 · La portada ════════════════════════════════════════════════════════ */

describe("la portada va centrada, y sus cuatro contenedores a la vez", () => {
  test("los cuatro llevan max-w-6xl y mx-auto", () => {
    // Solo las líneas que llevan un `className=`, que es lo único que puede ser
    // una clase de verdad. La cabecera de `page.jsx` explica esta misma regla y
    // menciona la clase dentro de su prosa —y esa prosa vive en un comentario
    // `{/* … */}` de varias líneas, así que sus líneas interiores no empiezan
    // por `//` y un filtro por prefijo no las caza—. Contarlas haría que la
    // prueba dijera cuatro donde hay tres: el mismo error de leer un contador
    // que incluye su propia documentación.
    const soloCodigo = (rel) =>
      lee(rel)
        .split(/\r?\n/)
        .filter((l) => l.includes("className="))
        .join("\n");

    const portada = soloCodigo("app/(dashboard)/page.jsx");
    const resumen = soloCodigo("components/home/HomeSummary.jsx");

    const centrados = (txt) => (txt.match(/max-w-6xl mx-auto/g) || []).length;
    const sueltos = (txt) =>
      (txt.match(/max-w-6xl(?! mx-auto)/g) || []).length;

    assert.equal(centrados(portada), 3, "la portada tiene que llevar sus TRES secciones centradas");
    assert.equal(centrados(resumen), 1, "«Resumen de hoy» vive en otro fichero y se olvida: también va centrado");
    assert.equal(
      sueltos(portada) + sueltos(resumen),
      0,
      "queda un max-w-6xl sin mx-auto: esa sección se desalinea de las otras tres"
    );
  });
});

/* ═══ 3 · La puerta de Ayuda ════════════════════════════════════════════════ */

describe("«Ayuda» está en el menú y apagada en las demos", () => {
  const sidebar = lee("components/layout/Sidebar.jsx");

  test("existe como entrada del menú, con la bandera que la hace universal", () => {
    assert.match(sidebar, /key: "ayuda"/, "la entrada de Ayuda ha desaparecido del menú");
    // `always: true` es lo que hace que se vea aunque no sea un módulo
    // contratado. Sin ella, el filtro busca un módulo llamado `ayuda` que no
    // existe y la fila no sale en ningún cliente.
    const bloque = sidebar.slice(sidebar.indexOf('key: "ayuda"'), sidebar.indexOf('key: "ayuda"') + 200);
    assert.match(bloque, /always: true/, "Ayuda sin `always: true` no se ve en ningún cliente");
    assert.match(bloque, /href: "\/ayuda"/);
  });

  test("no se enseña en las cuatro demos, que son públicas", () => {
    assert.match(
      sidebar,
      /item\.key === "ayuda" && esSlugDemo\(tenant\?\.slug\)\) return false/,
      "se ha caído el corte de las demos: un visitante anónimo vería una puerta a Salamandra"
    );
    assert.match(sidebar, /import \{ esSlugDemo \} from/, "falta el import que hace ese corte");
  });
});
