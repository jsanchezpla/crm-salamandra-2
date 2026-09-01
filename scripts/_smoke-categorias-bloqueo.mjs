// @prueba ligera
/**
 * _smoke-categorias-bloqueo.mjs — las CATEGORÍAS de bloqueo de agenda
 * (01/09/2026, Aumenta por Rodrigo).
 *
 * Lo que se fija aquí son las dos promesas del encargo y, sobre todo, la
 * compatibilidad: un centro que no use categorías tiene que comportarse
 * EXACTAMENTE igual que antes de que existieran.
 *
 *   1. Sin categorías guardadas, la lista es vacía y un bloqueo se pinta como
 *      siempre (persona → centro → negro).
 *   2. Con categoría, su color MANDA sobre el de la persona: es lo que
 *      significa «que a todo el equipo le salga igual».
 *   3. Renombrar una categoría CONSERVA su clave, o los bloqueos ya guardados
 *      se quedarían huérfanos (la misma regla que los apartados de informe).
 *   4. Una clave que el centro no tiene dada de alta no se guarda: la lista la
 *      decide dirección, no el navegador.
 *   5. Productividad deja de adivinar por texto cuando hay categoría, pero el
 *      texto sigue siendo el respaldo de los 12.030 bloqueos que ya existen.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  CATEGORIAS_CLINICA_BASE,
  MAX_CATEGORIAS,
  categoriaDe,
  categoriasDe,
  claveDesdeTitulo,
  claveValida,
  limpiaColorCategoria,
  normalizarCategorias,
} from "../lib/citas/categoriasBloqueo.js";
import { COLOR_BLOQUEO_POR_DEFECTO, colorDeBloqueo } from "../lib/citas/coloresBloqueo.js";
import { clasificarBloqueo } from "../lib/clinica/trabajoInterno.js";

// ── 1. Compatibilidad: quien no las use no nota nada ────────────────────────

test("un centro sin categorías tiene la lista vacía, no las de fábrica", () => {
  assert.deepEqual(categoriasDe({}), []);
  assert.deepEqual(categoriasDe({ settings: {} }), []);
  assert.deepEqual(categoriasDe({ settings: { citas: {} } }), []);
  assert.deepEqual(categoriasDe(null), []);
});

test("una configuración corrupta se comporta como si no hubiera nada", () => {
  assert.deepEqual(categoriasDe({ settings: { citas: { categoriasBloqueo: "reunión" } } }), []);
  assert.deepEqual(categoriasDe({ settings: { citas: { categoriasBloqueo: [null, 7, {}] } } }), []);
});

test("sin categoría, el color es el de siempre: persona → centro → negro", () => {
  assert.equal(colorDeBloqueo({ persona: "#AABBCC", centro: "#112233" }), "#AABBCC");
  assert.equal(colorDeBloqueo({ persona: null, centro: "#112233" }), "#112233");
  assert.equal(colorDeBloqueo({}), COLOR_BLOQUEO_POR_DEFECTO);
  assert.equal(colorDeBloqueo(), COLOR_BLOQUEO_POR_DEFECTO);
});

// ── 2. La categoría manda: «que a todo el equipo le salga igual» ────────────

test("el color de la categoría gana al de la persona y al del centro", () => {
  assert.equal(
    colorDeBloqueo({ categoria: "#2563EB", persona: "#AABBCC", centro: "#112233" }),
    "#2563EB"
  );
});

// ── 3. Renombrar no puede dejar huérfanos los bloqueos guardados ────────────

test("cambiar el título CONSERVA la clave", () => {
  const previas = [{ key: "descanso", label: "Descanso", color: "#DB2777" }];
  const [nueva] = normalizarCategorias(
    [{ key: "descanso", label: "Pausa", color: "#DB2777" }],
    { previas }
  );
  assert.equal(nueva.key, "descanso", "la clave se conserva aunque cambie el rótulo");
  assert.equal(nueva.label, "Pausa");
});

test("una categoría nueva saca su clave del título, sin tildes ni signos", () => {
  assert.equal(claveDesdeTitulo("Gestión documental"), "gestion_documental");
  assert.equal(claveDesdeTitulo("Reunión de equipo"), "reunion_de_equipo");
  assert.equal(claveDesdeTitulo("  Libre  de   pacientes "), "libre_de_pacientes");
  // Una clave tiene que empezar por letra o no pasa el patrón de guardado.
  assert.match(claveDesdeTitulo("1 a 1"), /^[a-z]/);
});

test("dos categorías no pueden acabar con la misma clave", () => {
  const salida = normalizarCategorias([
    { label: "Descanso", color: "#111111" },
    { label: "Descanso", color: "#222222" },
  ]);
  assert.equal(salida.length, 2);
  assert.notEqual(salida[0].key, salida[1].key);
});

// ── 4. Lo que no vale, no se guarda ─────────────────────────────────────────

test("una categoría sin título se cae; un color roto queda en el negro de siempre", () => {
  const salida = normalizarCategorias([
    { label: "   ", color: "#2563EB" },
    { label: "Valoraciones", color: "azul" },
    { label: "Descanso", color: "#db2777" },
  ]);
  assert.equal(salida.length, 2);
  assert.equal(salida[0].label, "Valoraciones");
  assert.equal(salida[0].color, COLOR_BLOQUEO_POR_DEFECTO);
  // Se guardan en mayúsculas, como el resto de colores del CRM.
  assert.equal(salida[1].color, "#DB2777");
});

test("limpiaColorCategoria acepta solo un hex de seis", () => {
  assert.equal(limpiaColorCategoria(" #2563eb "), "#2563EB");
  assert.equal(limpiaColorCategoria("#25E"), null);
  assert.equal(limpiaColorCategoria("rojo"), null);
  assert.equal(limpiaColorCategoria(null), null);
});

test("la lista tiene tope y lo que llega roto no la tumba", () => {
  const muchas = Array.from({ length: MAX_CATEGORIAS + 10 }, (_, i) => ({ label: `Cat ${i}` }));
  assert.equal(normalizarCategorias(muchas).length, MAX_CATEGORIAS);
  assert.deepEqual(normalizarCategorias(null), []);
  assert.deepEqual(normalizarCategorias("reunión"), []);
});

test("solo se guarda en un bloqueo una clave que el centro tenga dada de alta", () => {
  const cats = normalizarCategorias(CATEGORIAS_CLINICA_BASE);
  assert.equal(claveValida("trabajo_interno", cats), "trabajo_interno");
  assert.equal(claveValida("  TRABAJO_INTERNO ", cats), "trabajo_interno");
  // Inventada desde el navegador: fuera.
  assert.equal(claveValida("lo_que_sea", cats), null);
  assert.equal(claveValida("", cats), null);
  assert.equal(claveValida(null, cats), null);
  assert.equal(claveValida("trabajo_interno", []), null);
});

test("una categoría borrada no rompe el bloqueo que la usaba", () => {
  const cats = normalizarCategorias([{ label: "Descanso", color: "#DB2777" }]);
  // El bloqueo guardó `valoraciones` y el centro la quitó después.
  assert.equal(categoriaDe("valoraciones", cats), null);
  assert.equal(colorDeBloqueo({ categoria: null, persona: "#AABBCC" }), "#AABBCC");
});

test("las seis de fábrica están, con clave y color distinguibles", () => {
  const cats = normalizarCategorias(CATEGORIAS_CLINICA_BASE);
  assert.equal(cats.length, 6);
  assert.deepEqual(
    cats.map((c) => c.key),
    ["reunion_equipo", "trabajo_interno", "gestion_documental", "valoraciones", "libre_pacientes", "descanso"]
  );
  assert.equal(new Set(cats.map((c) => c.color)).size, 6, "seis colores distintos");
});

// ── 5. Productividad deja de adivinar, pero sin mover lo que ya contaba ─────

test("con categoría, Productividad NO mira el texto", () => {
  // El texto diría «vacaciones», la categoría dice trabajo interno.
  assert.equal(clasificarBloqueo("Vacaciones", "trabajo_interno"), "ti");
  assert.equal(clasificarBloqueo("Lo que sea", "reunion_equipo"), "equipo");
});

test("una categoría que no es interna no cae de vuelta al texto", () => {
  // Marcado como descanso, aunque el motivo diga «reunión equipo».
  assert.equal(clasificarBloqueo("REUNIÓN EQUIPO", "descanso"), null);
  // Y las otras cuatro de fábrica no cuentan como internas HOY, a propósito:
  // moverlo cambiaría cifras que Aumenta lleva meses mirando.
  assert.equal(clasificarBloqueo("Papeleo", "gestion_documental"), null);
  assert.equal(clasificarBloqueo("Valoración", "valoraciones"), null);
});

test("sin categoría, el texto sigue clasificando igual que antes", () => {
  assert.equal(clasificarBloqueo("Reservado T.I."), "ti");
  assert.equal(clasificarBloqueo("Reservado t.i.", null), "ti");
  assert.equal(clasificarBloqueo("REUNIÓN EQUIPO", ""), "equipo");
  assert.equal(clasificarBloqueo("Vacaciones", null), null);
});
