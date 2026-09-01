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
  categoriaPorEtiqueta,
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

test("las de fábrica están, con clave y color distinguibles", () => {
  const cats = normalizarCategorias(CATEGORIAS_CLINICA_BASE);
  assert.equal(cats.length, 9);
  assert.deepEqual(
    cats.map((c) => c.key),
    [
      "reunion_equipo",
      "trabajo_interno",
      "gestion_documental",
      "valoraciones",
      "libre_pacientes",
      "descanso",
      "taller_grupo",
      "sesion_paciente",
      "reservado_paciente",
    ]
  );
  assert.equal(new Set(cats.map((c) => c.color)).size, 9, "nueve colores distintos");
});

test("las tres nuevas NO cuentan como trabajo interno en Productividad", () => {
  // Son horas con pacientes. Si contaran, el sumatorio del centro se movería
  // 1.500 bloqueos de golpe sin que nadie lo haya pedido.
  assert.equal(clasificarBloqueo("TALLER H.H.S.S", "taller_grupo"), null);
  assert.equal(clasificarBloqueo("BONOS Sahara", "sesion_paciente"), null);
  assert.equal(clasificarBloqueo("Reservado Iván, comienza el 22/09", "reservado_paciente"), null);
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

// ── 6. Etiqueta escrita a mano → categoría (backfill del 01/09/2026) ────────
//
// Los casos son literales de la agenda de Aumenta, con su recuento del día en
// que se escribió esto. Si mañana una regla cambia y estos dejan de caer donde
// caen, son 10.468 bloqueos los que se mueven de sitio en la agenda de quince
// personas: por eso están aquí con nombre y apellidos.

test("las clases que exportó Organízate caen en su categoría", () => {
  const c = (l) => categoriaPorEtiqueta(l);
  assert.equal(c("LIBRE PACIENTES"), "libre_pacientes"); //          2.983
  assert.equal(c("DESCANSO"), "descanso"); //                        2.564
  assert.equal(c("REUNIÓN EQUIPO"), "reunion_equipo"); //               528
  assert.equal(c("GESTION DOCUMENTAL"), "gestion_documental"); //       434
  assert.equal(c("VALORACIONES COMPLETAS"), "valoraciones"); //         173
});

test("«Reservado T.I.» en sus tres grafías es trabajo interno", () => {
  // 1.677 + 299 + 218 bloqueos escritos de tres maneras por quince personas.
  assert.equal(categoriaPorEtiqueta("Reservado T.I."), "trabajo_interno");
  assert.equal(categoriaPorEtiqueta("Reservado T.I"), "trabajo_interno");
  assert.equal(categoriaPorEtiqueta("Reservado t.i."), "trabajo_interno");
});

test("manda el principio de la etiqueta, no lo que se cuente después", () => {
  // «GESTION DOCUMENTAL T.I.» lleva las dos escritas: gana la de delante, que
  // es el tipo que eligieron de la lista.
  assert.equal(categoriaPorEtiqueta("GESTION DOCUMENTAL T.I."), "gestion_documental");
  // Una hora apartada como libre de pacientes en la que además hubo una
  // coordinación sigue siendo la hora que el centro apartó.
  assert.equal(
    categoriaPorEtiqueta("LIBRE PACIENTES Reunión Coordinación con Laura B de 13:15 a 13:45"),
    "libre_pacientes"
  );
  assert.equal(
    categoriaPorEtiqueta("Reservado T.I. Reservado 30 minutos reunión coordinación con ISa de 13:15 a 13:45"),
    "trabajo_interno"
  );
});

test("«Reservado» a secas no es una clase: se lee lo que viene detrás", () => {
  // Una reunión de coordinación con una compañera es reunión de equipo…
  assert.equal(categoriaPorEtiqueta("Reservado Reunión con Arancha Coordinación"), "reunion_equipo");
  assert.equal(categoriaPorEtiqueta("Reservado Reunión coordinación con Laura F"), "reunion_equipo");
  // …y una hora guardada para un niño que empieza más tarde, no.
  assert.equal(categoriaPorEtiqueta("Reservado Ivan Jiménez Comienza el día 22/09"), "reservado_paciente");
  assert.equal(categoriaPorEtiqueta("Reservado"), "reservado_paciente");
});

test("las horas con pacientes van a las tres categorías nuevas", () => {
  assert.equal(categoriaPorEtiqueta("TALLER H.H.S.S PEQUES CON LAURA G"), "taller_grupo");
  assert.equal(categoriaPorEtiqueta("OTROS MENTE ACTIVA"), "taller_grupo");
  assert.equal(categoriaPorEtiqueta("BONOS CARLA BORRALLO"), "sesion_paciente");
  assert.equal(categoriaPorEtiqueta("APOYO ESO Alejandro Lillo"), "sesion_paciente");
  assert.equal(categoriaPorEtiqueta("RECUPERACIÓN David Espinosa 15 minutos"), "sesion_paciente");
});

test("ante la duda, sin categoría", () => {
  assert.equal(categoriaPorEtiqueta("Vacaciones"), null);
  assert.equal(categoriaPorEtiqueta("Congreso en Sevilla"), null);
  assert.equal(categoriaPorEtiqueta(""), null);
  assert.equal(categoriaPorEtiqueta(null), null);
});

test("solo se devuelve una clave que el centro tenga dada de alta", () => {
  // Un centro con solo dos categorías no puede acabar con bloqueos apuntando a
  // una tercera que no existe: se quedarían huérfanos al pintar.
  const dos = normalizarCategorias([
    { key: "descanso", label: "Descanso", color: "#DB2777" },
    { key: "trabajo_interno", label: "Trabajo interno", color: "#7C3AED" },
  ]);
  assert.equal(categoriaPorEtiqueta("DESCANSO", dos), "descanso");
  assert.equal(categoriaPorEtiqueta("LIBRE PACIENTES", dos), null);
  assert.equal(categoriaPorEtiqueta("DESCANSO", []), null);
});
