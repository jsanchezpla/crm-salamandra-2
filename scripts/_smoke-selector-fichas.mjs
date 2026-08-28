// @prueba ligera
/**
 * _smoke-selector-fichas.mjs — que elegir una ficha llegue a TODAS las fichas.
 *
 * ─── QUÉ PASABA (28/08/2026) ────────────────────────────────────────────────
 *
 * Once pantallas se bajaban `/api/clients?limit=200` al abrirse y filtraban
 * encima. Con las 1.083 fichas de Aumenta, 883 familias (el 82%) no salían de
 * ninguna manera, y el desplegable contestaba lo mismo que si no existieran.
 * Subir el número tampoco valía: `/api/clients` corta en 200 por su cuenta, así
 * que el `limit=300` de Cobros y el `limit=500` del Calendario ya recibían 200.
 *
 * La primera mitad de esta prueba es de verdad —llama a la función y mira lo que
 * DEVUELVE—. La segunda mira el fuente de las pantallas, porque lo que hay que
 * impedir es que alguien vuelva a escribir el `fetch` a mano: eso no es una
 * función que se pueda llamar, es un texto que tiene que no estar.
 */

import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { urlDePacientes } from "../lib/citas/buscarPacientes.js";

import {
  CUANTAS_AL_ABRIR,
  CUANTAS_AL_BUSCAR,
  ESPERA_MS,
  hayMasDeLasQueCaben,
  urlDeFichas,
} from "../lib/clients/buscarFichas.js";

const parámetros = (url) => new URLSearchParams(url.split("?")[1] || "");

describe("la dirección a la que se pregunta", () => {
  it("sin texto pide unas pocas y NO manda `search`", () => {
    const p = parámetros(urlDeFichas(""));
    assert.equal(p.get("limit"), String(CUANTAS_AL_ABRIR));
    assert.equal(p.get("search"), null, "sin texto no se busca nada: se enseñan las últimas");
  });

  it("con texto manda lo escrito y pide más", () => {
    const p = parámetros(urlDeFichas("hugo castro"));
    assert.equal(p.get("search"), "hugo castro");
    assert.equal(p.get("limit"), String(CUANTAS_AL_BUSCAR));
  });

  it("los espacios de los lados no cuentan como texto", () => {
    assert.equal(parámetros(urlDeFichas("   ")).get("search"), null);
    assert.equal(parámetros(urlDeFichas("  hugo  ")).get("search"), "hugo");
  });

  it("un nombre con acentos, eñes o & viaja entero", () => {
    // Sin escapar, un `&` partiría la consulta en dos y el servidor buscaría
    // otra cosa. Se comprueba leyendo el parámetro ya descodificado.
    for (const nombre of ["Muñoz & Díaz", "Nogués", "a+b", "100% Salud", "a=b"]) {
      assert.equal(parámetros(urlDeFichas(nombre)).get("search"), nombre);
    }
  });

  it("los filtros extra se suman, y los vacíos no se mandan", () => {
    const p = parámetros(urlDeFichas("laura", { assignedTo: "nutricion", country: "", categoria: null }));
    assert.equal(p.get("assignedTo"), "nutricion");
    assert.equal(p.get("country"), null, "un filtro vacío filtraría por cadena vacía");
    assert.equal(p.get("categoria"), null);
    assert.equal(p.get("search"), "laura");
  });

  it("nunca pide más de lo que el servidor da (200)", () => {
    // El tope del endpoint. Pedir de más no rompe, pero mentiría al lector:
    // creería que se traen 500 cuando llegan 200. Eso es lo que pasaba.
    assert.ok(CUANTAS_AL_BUSCAR <= 200);
    assert.ok(CUANTAS_AL_ABRIR <= CUANTAS_AL_BUSCAR);
  });

  it("se espera antes de preguntar, pero no tanto que se note", () => {
    assert.ok(ESPERA_MS >= 150 && ESPERA_MS <= 600, `espera rara: ${ESPERA_MS} ms`);
  });
});

describe("el aviso de que hay más", () => {
  it("avisa cuando el servidor dice que casan más de las que caben", () => {
    assert.equal(hayMasDeLasQueCaben(1083, 8), true);
    assert.equal(hayMasDeLasQueCaben(188, 20), true);
  });
  it("no avisa cuando están todas", () => {
    assert.equal(hayMasDeLasQueCaben(5, 5), false);
    assert.equal(hayMasDeLasQueCaben(0, 0), false);
  });
});

/*
 * Las once pantallas. La lista está escrita a mano a propósito: si mañana
 * alguien añade una pantalla con un desplegable de fichas, esta prueba NO se
 * va a enterar — pero al menos las que se arreglaron no pueden volver atrás.
 */
const PANTALLAS = [
  "app/(dashboard)/facturacion/presupuestos/page.jsx",
  "app/(dashboard)/facturacion/facturas/page.jsx",
  "app/(dashboard)/facturacion/cobros/page.jsx",
  "app/(dashboard)/facturacion/recurrentes/page.jsx",
  "app/(dashboard)/facturacion/costes/page.jsx",
  "app/(dashboard)/pedidos/page.jsx",
  "app/(dashboard)/proyectos/page.jsx",
  "app/(dashboard)/proyectos/[id]/page.jsx",
  "app/(dashboard)/calendario/page.jsx",
  "components/projects/AiProjectModal.jsx",
  "components/billing/PatientReparto.jsx",
  "modules/nutricion/planEditor/paneles.jsx",
];

describe("ninguna pantalla vuelve a bajarse la lista entera", () => {
  for (const ruta of PANTALLAS) {
    it(ruta, () => {
      const fuente = readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
      const bajadas = fuente.match(/\/api\/clients\?[^`"']*limit=\d+/g) || [];
      assert.deepEqual(
        bajadas,
        [],
        `vuelve a bajarse una lista cortada (${bajadas.join(", ")}). ` +
          "Con 1.083 fichas eso deja fuera al 82% de las familias: usa SelectorCliente."
      );
      assert.ok(
        fuente.includes("SelectorCliente"),
        "esta pantalla elige una ficha: tiene que hacerlo con SelectorCliente"
      );
    });
  }
});

const remoto = readFileSync(new URL("../components/ui/SelectorRemoto.jsx", import.meta.url), "utf8");

test("el desplegable no filtra en el navegador lo que ya filtró el servidor", () => {
  assert.ok(
    remoto.includes("filtrarEnCliente={false}"),
    "volver a filtrar aquí solo puede QUITAR resultados que el servidor sí encontró"
  );
  assert.ok(
    remoto.includes("consulta.current"),
    "sin numerar las consultas, una lenta pisa a una nueva y se elige a quien no era"
  );
});

test("la ya elegida se trae por su id, no se busca en la lista", () => {
  // Es el borde que más fácil se escapa: al buscar por el nombre del hijo, la
  // caja de la familia deja el paciente ya elegido. Si el desplegable solo
  // pinta lo que ha traído, sale «Sin paciente asignado» con la cita a punto de
  // nacer con él.
  assert.ok(remoto.includes("traerRef.current(value)"), "no se resuelve la elegida por id");
  assert.ok(
    remoto.includes("lista.unshift("),
    "la elegida tiene que ir en la lista aunque no esté en lo que se ve, o el botón enseña el placeholder"
  );

  const cli = readFileSync(new URL("../components/clients/SelectorCliente.jsx", import.meta.url), "utf8");
  assert.ok(cli.includes("/api/clients/${idFicha}"), "la ficha se pide por su id");
  const pac = readFileSync(new URL("../components/citas/SelectorPaciente.jsx", import.meta.url), "utf8");
  assert.ok(pac.includes("/api/pacientes/${idPaciente}"), "el paciente se pide por su id");
});

test("el aviso del techo se pinta con los números de verdad", () => {
  assert.ok(remoto.includes("hayMasDeLasQueCaben("));
  assert.ok(remoto.includes("coinciden"), "un techo callado se lee como una ausencia");
});

describe("el selector de pacientes", () => {
  const pac = readFileSync(new URL("../components/citas/SelectorPaciente.jsx", import.meta.url), "utf8");

  it("pregunta con `q`, que es como se llama en pacientes", () => {
    // En fichas de cliente el parámetro es `search`; aquí es `q`. Equivocarse
    // no da error: el servidor ignora el parámetro y devuelve los primeros,
    // así que parecería que busca y estaría enseñando cualquier cosa.
    const lib = readFileSync(new URL("../lib/citas/buscarPacientes.js", import.meta.url), "utf8");
    assert.ok(lib.includes('p.set("q", q)'), "el parámetro de búsqueda de pacientes es `q`");
    assert.ok(!lib.includes('p.set("search"'), "`search` no lo lee este endpoint");
    assert.ok(pac.includes("urlDePacientes("), "el componente usa la regla compartida");
  });

  it("con familia elegida trae a los SUYOS y sin cortarlos", () => {
    const p = new URLSearchParams(urlDePacientes("", "fam-1").split("?")[1]);
    assert.equal(p.get("clientId"), "fam-1");
    assert.ok(Number(p.get("limit")) >= 100, "los hijos de una familia son pocos: no se cortan");
  });

  it("sin familia pide pocas al abrir y más al buscar", () => {
    const alAbrir = new URLSearchParams(urlDePacientes("", null).split("?")[1]);
    const alBuscar = new URLSearchParams(urlDePacientes("hugo", null).split("?")[1]);
    assert.equal(alAbrir.get("q"), null);
    assert.equal(alBuscar.get("q"), "hugo");
    assert.ok(Number(alBuscar.get("limit")) > Number(alAbrir.get("limit")));
    assert.ok(Number(alBuscar.get("limit")) <= 300, "el listado de pacientes corta en 300");
  });
});

test("el alta de cita ya no elige sobre una lista descargada", () => {
  const drawer = readFileSync(
    new URL("../modules/default/citas/NuevaCitaDrawer.jsx", import.meta.url),
    "utf8"
  );
  assert.ok(drawer.includes("<SelectorPaciente"), "el desplegable de paciente tiene que preguntar al servidor");
  assert.ok(
    !drawer.includes("pacientesConocidos"),
    "la tapa parcial (unir los 300 con los de la familia) sobra y no debe convivir con el selector"
  );
  assert.ok(
    drawer.includes('opcionesFijas={[{ value: "", label: "Sin paciente asignado" }]}'),
    "hay que poder volver a «sin paciente»: la cita de la familia sin atribuir es un caso real"
  );
  const padre = readFileSync(new URL("../modules/default/CitasModule.jsx", import.meta.url), "utf8");
  assert.ok(!padre.includes("patientOptions"), "el padre ya no monta las opciones");
});
