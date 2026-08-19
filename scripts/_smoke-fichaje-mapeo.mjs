// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-fichaje-mapeo.mjs — el nombre del Excel del reloj se casa con la
 * persona del CRM que es, o con ninguna (19/08/2026).
 *
 *   node scripts/_smoke-fichaje-mapeo.mjs
 *   node --test-name-pattern="sugerirPersona" scripts/_smoke-fichaje-mapeo.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * El Excel del reloj de fichar de Aumenta no trae el UUID de nadie: trae
 * «ARACELI», «ISA», «DANIA», «LAURA ARROYO». El CRM tiene «Isabel Alberca
 * Bolaños» y «Daniela de la Cruz Esteban». `lib/fichaje/mapeo.js` (13/08/2026)
 * es la única pieza que decide de quién es cada fila, y su cabecera lleva la
 * regla dura escrita: solo se asigna SOLA una fila cuyo nombre case EXACTO
 * —sin mayúsculas, acentos ni espacios de más— con un alias guardado en
 * `team_members.custom_fields.fichajeNombres` o con el nombre completo del CRM;
 * todo lo demás es una SUGERENCIA que confirma una persona con un clic, y con
 * dos candidatas no se sugiere a nadie. Un nombre mal casado son las horas de
 * una persona apuntadas en la nómina de otra: «un fichaje mal importado es una
 * nómina mal pagada» (`docs/modules/fichaje.md`).
 *
 * El Mapa de ese doc decía «`mapeo.js` sigue sin prueba». Esta fija lo que
 * DEVUELVE cada función con entradas como las que le pasan `previsualizar` y
 * `aplicar` (`lib/fichaje/importar.js`): la lista `nombres` que sacan los
 * lectores —los textos tal cual están en la celda— y el equipo como filas
 * planas de `team_members` con `id`, `displayName` y `customFields`. Y lo que
 * `aplicar` hace con un mapeo confirmado: `customFieldsConAlias` para que el
 * mes que viene ese nombre case solo.
 *
 * Forma: `node:test` + `node:assert/strict`, como `_smoke-citas-dinero.mjs`.
 * Aserciones sobre lo que devuelven las funciones, nunca sobre el texto del
 * código.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizar,
  aliasDe,
  indiceDeNombres,
  sugerirPersona,
  resolverNombres,
  customFieldsConAlias,
} from "../lib/fichaje/mapeo.js";

// ── El equipo de mentira: parecido al real de Aumenta, sin ser nadie ────────

/** Una fila de `team_members` como la lee el importador (solo lo que mira mapeo.js). */
const persona = (id, displayName, fichajeNombres = undefined, otros = {}) => ({
  id,
  displayName,
  customFields: fichajeNombres === undefined ? null : { ...otros, fichajeNombres },
});

/** Dos Isabeles, dos Lauras (una con alias), una Daniela y una Araceli. */
function equipo() {
  return [
    persona("isa-a", "Isabel Alberca Bolaños"),
    persona("isa-r", "Isabel Ruiz Montes"),
    persona("lau-g", "Laura Garrido Rascón", ["LAURA G"]),
    persona("lau-p", "Laura Pérez Soto"),
    persona("dan", "Daniela de la Cruz Esteban"),
    persona("ara", "Araceli Gómez"),
  ];
}

const copia = (x) => JSON.parse(JSON.stringify(x));

describe("normalizar: cómo se compara un nombre", () => {
  it("minúsculas, sin acentos y sin espacios de más: «  GARCÍA   LÓPEZ, MARÍA » es «garcia lopez, maria»", () => {
    assert.equal(normalizar("  GARCÍA   LÓPEZ, MARÍA "), "garcia lopez, maria");
  });
  it("«Laura Arroyo», «LAURA  ARROYO» y « laura arroyo » son el mismo nombre", () => {
    assert.equal(normalizar("Laura Arroyo"), "laura arroyo");
    assert.equal(normalizar("LAURA  ARROYO"), "laura arroyo");
    assert.equal(normalizar(" laura arroyo "), "laura arroyo");
  });
  it("tabuladores y saltos de línea dentro del nombre cuentan como un espacio", () => {
    assert.equal(normalizar("Laura\tArroyo\n"), "laura arroyo");
  });
  it("«APELLIDO, NOMBRE» no se convierte en «Nombre Apellido»: no se reordena nada", () => {
    assert.notEqual(normalizar("GARCIA LOPEZ, MARIA"), normalizar("María García López"));
  });
  it("null, undefined y un número no revientan: «», «» y «42»", () => {
    assert.equal(normalizar(null), "");
    assert.equal(normalizar(undefined), "");
    assert.equal(normalizar(42), "42");
  });
});

describe("aliasDe: los alias guardados de una persona", () => {
  it("devuelve lo que hay en custom_fields.fichajeNombres", () => {
    assert.deepEqual(aliasDe(persona("x", "Isabel Alberca", ["ISA", "ISABEL A"])), [
      "ISA",
      "ISABEL A",
    ]);
  });
  it("sin customFields, sin la clave o con la clave corrupta (texto, número, objeto): lista vacía, sin reventar", () => {
    assert.deepEqual(aliasDe(persona("x", "Alguien")), []);
    assert.deepEqual(aliasDe({ id: "x", displayName: "Alguien", customFields: {} }), []);
    assert.deepEqual(aliasDe(persona("x", "Alguien", "ISA")), []);
    assert.deepEqual(aliasDe(persona("x", "Alguien", 42)), []);
    assert.deepEqual(aliasDe(persona("x", "Alguien", { ISA: true })), []);
    assert.deepEqual(aliasDe(null), []);
    assert.deepEqual(aliasDe(undefined), []);
  });
  it("quita de la lista lo que no es un nombre: vacíos, solo espacios, números, null", () => {
    assert.deepEqual(aliasDe(persona("x", "Alguien", ["ARACELI", "", "   ", 42, null, "ARA"])), [
      "ARACELI",
      "ARA",
    ]);
  });
  it("no toca la lista guardada", () => {
    const p = persona("x", "Alguien", ["ARACELI", ""]);
    const antes = copia(p);
    aliasDe(p);
    assert.deepEqual(p, antes);
  });
});

describe("indiceDeNombres: el índice exacto nombre → persona", () => {
  it("indexa el nombre completo del CRM, normalizado", () => {
    const { exactos } = indiceDeNombres(equipo());
    assert.equal(exactos.get("isabel alberca bolanos"), "isa-a");
    assert.equal(exactos.get("daniela de la cruz esteban"), "dan");
    assert.equal(exactos.has("Isabel Alberca Bolaños"), false);
  });
  it("indexa cada alias, normalizado", () => {
    const { exactos } = indiceDeNombres(equipo());
    assert.equal(exactos.get("laura g"), "lau-g");
    const { exactos: dos } = indiceDeNombres([persona("x", "Isabel Alberca", ["ISA", " Isa B. "])]);
    assert.equal(dos.get("isa"), "x");
    assert.equal(dos.get("isa b."), "x");
  });
  it("un alias explícito manda sobre el nombre del CRM de otra persona, venga en el orden que venga", () => {
    const conAlias = persona("arroyo", "Laura Arroyo Pérez", ["LAURA"]);
    const sinAlias = persona("laura", "Laura");
    assert.equal(indiceDeNombres([conAlias, sinAlias]).exactos.get("laura"), "arroyo");
    assert.equal(indiceDeNombres([sinAlias, conAlias]).exactos.get("laura"), "arroyo");
  });
  it("una persona sin nombre ni alias no entra, y el nombre vacío no casa con nadie", () => {
    const { exactos } = indiceDeNombres([persona("x", ""), persona("y", null)]);
    assert.equal(exactos.size, 0);
    assert.equal(exactos.has(""), false);
  });
  it("devuelve { exactos, personas } con el mismo equipo que le dieron, sin tocarlo", () => {
    const eq = equipo();
    const antes = copia(eq);
    const indice = indiceDeNombres(eq);
    assert.equal(indice.personas, eq);
    assert.deepEqual(eq, antes);
  });
  it("dos personas con el MISMO nombre en el CRM: ese nombre es ambiguo y no casa con ninguna (19/08/2026: antes casaba con la primera, en silencio)", () => {
    const { exactos, ambiguos } = indiceDeNombres([
      persona("a", "Laura García"),
      persona("b", "Laura García"),
      persona("c", "Pedro Ruiz"),
    ]);
    assert.equal(exactos.has("laura garcia"), false);
    assert.ok(ambiguos.has("laura garcia"));
    assert.equal(exactos.get("pedro ruiz"), "c");
  });
  it("el mismo alias guardado en dos personas: ambiguo, no casa con ninguna (antes casaba con la última, en silencio)", () => {
    const { exactos, ambiguos } = indiceDeNombres([
      persona("a", "Isabel Ruiz", ["ISA"]),
      persona("b", "Isabel Mora", ["ISA"]),
    ]);
    assert.equal(exactos.has("isa"), false);
    assert.ok(ambiguos.has("isa"));
    // Los nombres completos siguen casando cada uno con la suya.
    assert.equal(exactos.get("isabel ruiz"), "a");
    assert.equal(exactos.get("isabel mora"), "b");
  });
  it("un alias único sigue mandando sobre el displayName repetido de otras dos: solo son ambiguos alias contra alias y nombre contra nombre", () => {
    const { exactos, ambiguos } = indiceDeNombres([
      persona("a", "Laura García"),
      persona("b", "Laura García"),
      persona("e", "Pedro Ruiz", ["Laura García"]),
    ]);
    assert.equal(exactos.get("laura garcia"), "e");
    assert.equal(ambiguos.has("laura garcia"), false);
  });
  it("sin repetidos, ambiguos está vacío", () => {
    assert.equal(indiceDeNombres(equipo()).ambiguos.size, 0);
  });
});

describe("sugerirPersona: parecidos que se ENSEÑAN, nunca se asignan", () => {
  it("el nombre del Excel es el principio del nombre del CRM: «LAURA ARROYO» → «Laura Arroyo Pérez»", () => {
    assert.deepEqual(sugerirPersona("LAURA ARROYO", [persona("a", "Laura Arroyo Pérez")]), {
      id: "a",
      nombre: "Laura Arroyo Pérez",
      motivo: "el nombre empieza igual",
    });
  });
  it("o al revés: el nombre del CRM es el principio del que trae el Excel", () => {
    assert.equal(sugerirPersona("Araceli Gómez Díaz", equipo())?.id, "ara");
  });
  it("un nombre de pila suelto sobre un nombre completo: «ARACELI» → «Araceli Gómez»", () => {
    assert.deepEqual(sugerirPersona("ARACELI", equipo()), {
      id: "ara",
      nombre: "Araceli Gómez",
      motivo: "el nombre empieza igual",
    });
  });
  it("comparten el nombre de pila y uno es más corto: «ISA GARCIA» → «Isabel García», y el motivo lo dice", () => {
    assert.deepEqual(sugerirPersona("ISA GARCIA", [persona("i", "Isabel García")]), {
      id: "i",
      nombre: "Isabel García",
      motivo: "«isa» se parece a «isabel»",
    });
  });
  it("ignora mayúsculas y acentos también al parecerse: «jose» → «José Luis Pérez»", () => {
    assert.equal(sugerirPersona("jose", [persona("j", "José Luis Pérez")])?.id, "j");
  });
  it("con menos de 3 letras no sugiere nada: «IS», «», «  », null", () => {
    assert.equal(sugerirPersona("IS", equipo()), null);
    assert.equal(sugerirPersona("", equipo()), null);
    assert.equal(sugerirPersona("   ", equipo()), null);
    assert.equal(sugerirPersona(null, equipo()), null);
  });
  it("un nombre de pila de dos letras no vale para parecerse: «MA LOPEZ» vs «María López» → nada", () => {
    assert.equal(sugerirPersona("MA LOPEZ", [persona("m", "María López")]), null);
  });
  it("dos Isabeles en plantilla y llega «ISA»: nadie (dos candidatas es justo donde una sugerencia hace daño)", () => {
    assert.equal(sugerirPersona("ISA", equipo()), null);
  });
  it("dos Lauras en plantilla y llega «LAURA ARROYO» sin que haya Laura Arroyo: nadie", () => {
    assert.equal(sugerirPersona("LAURA ARROYO", equipo()), null);
  });
  it("dos Raqueles y llega «RAQUEL»: nadie", () => {
    assert.equal(
      sugerirPersona("RAQUEL", [persona("r1", "Raquel Ortega"), persona("r2", "Raquel Vidal")]),
      null
    );
  });
  it("una coincidencia fuerte gana aunque haya otra débil: «LAURA GARRIDO» es Laura Garrido Rascón aunque haya otra Laura", () => {
    assert.equal(sugerirPersona("LAURA GARRIDO", equipo())?.id, "lau-g");
  });
  it("«DANIA» con una Daniela en plantilla: nadie (no empieza igual y el nombre de pila tampoco)", () => {
    assert.equal(sugerirPersona("DANIA", equipo()), null);
  });
  it("«GARCIA LOPEZ, MARIA» no se parece a «María García López»: el orden apellido-nombre no se adivina", () => {
    assert.equal(sugerirPersona("GARCIA LOPEZ, MARIA", [persona("m", "María García López")]), null);
  });
  it("devuelve el nombre del CRM tal cual (con sus acentos y mayúsculas), no el normalizado", () => {
    assert.equal(sugerirPersona("daniela", equipo())?.nombre, "Daniela de la Cruz Esteban");
  });
  it("una persona sin nombre en el CRM no cuenta ni se sugiere", () => {
    assert.equal(sugerirPersona("ARACELI", [persona("x", ""), persona("y", null)]), null);
  });
  it("con un equipo vacío, nada", () => {
    assert.equal(sugerirPersona("ARACELI", []), null);
  });
  it("no toca el equipo que le dan", () => {
    const eq = equipo();
    const antes = copia(eq);
    sugerirPersona("LAURA GARRIDO", eq);
    assert.deepEqual(eq, antes);
  });
});

describe("resolverNombres: lo que entra solo y lo que queda pendiente", () => {
  it("casa exacto con el nombre completo del CRM, ignorando mayúsculas, acentos y espacios", () => {
    const { resueltos, pendientes } = resolverNombres(["ISABEL  ALBERCA BOLANOS"], equipo());
    assert.equal(resueltos.get("ISABEL  ALBERCA BOLANOS"), "isa-a");
    assert.deepEqual(pendientes, []);
  });
  it("casa exacto con un alias guardado", () => {
    const { resueltos, pendientes } = resolverNombres(["laura g"], equipo());
    assert.equal(resueltos.get("laura g"), "lau-g");
    assert.deepEqual(pendientes, []);
  });
  it("la clave de resueltos es el nombre TAL CUAL viene del Excel (espacios y mayúsculas incluidos): es lo que busca previsualizar con f.nombreExcel", () => {
    const { resueltos } = resolverNombres(["  Laura G "], equipo());
    assert.deepEqual([...resueltos.keys()], ["  Laura G "]);
    assert.equal(resueltos.get("laura g"), undefined);
  });
  it("«ARACELI» con «Araceli Gómez» en plantilla NO se asigna sola: queda pendiente con la sugerencia (la regla dura)", () => {
    const { resueltos, pendientes } = resolverNombres(["ARACELI"], equipo());
    assert.equal(resueltos.size, 0);
    assert.deepEqual(pendientes, [
      {
        nombre: "ARACELI",
        sugerencia: { id: "ara", nombre: "Araceli Gómez", motivo: "el nombre empieza igual" },
      },
    ]);
  });
  it("«ISA» con dos Isabeles queda pendiente y SIN sugerencia", () => {
    const { pendientes } = resolverNombres(["ISA"], equipo());
    assert.deepEqual(pendientes, [{ nombre: "ISA", sugerencia: null }]);
  });
  it("un nombre que no está en el equipo (VICTORIA en el fichero de marzo de 2026) queda pendiente sin sugerencia", () => {
    const { resueltos, pendientes } = resolverNombres(["VICTORIA"], equipo());
    assert.equal(resueltos.size, 0);
    assert.deepEqual(pendientes, [{ nombre: "VICTORIA", sugerencia: null }]);
  });
  it("dos Lauras García en el CRM y llega «LAURA GARCIA»: PENDIENTE, sin sugerencia y con el motivo (19/08/2026: antes entraba sola a la primera)", () => {
    const dos = [
      persona("a", "Laura García"),
      persona("b", "Laura García"),
      persona("c", "Pedro Ruiz"),
    ];
    const { resueltos, pendientes } = resolverNombres(["LAURA GARCIA", "PEDRO RUIZ"], dos);
    assert.deepEqual([...resueltos.entries()], [["PEDRO RUIZ", "c"]]);
    assert.equal(pendientes.length, 1);
    assert.equal(pendientes[0].nombre, "LAURA GARCIA");
    assert.equal(
      pendientes[0].sugerencia,
      null,
      "no se premarca a nadie: son las horas de una u otra"
    );
    assert.match(pendientes[0].motivo, /dos personas/);
  });
  it("el mismo alias «ISA» confirmado en dos Isabeles: pendiente sin sugerencia (antes entraba sola a la última)", () => {
    const dos = [persona("a", "Isabel Ruiz", ["ISA"]), persona("b", "Isabel Mora", ["ISA"])];
    const { resueltos, pendientes } = resolverNombres(["ISA"], dos);
    assert.equal(resueltos.size, 0);
    assert.equal(pendientes[0].sugerencia, null);
    assert.match(pendientes[0].motivo, /alias/);
  });
  it("tras elegir a una y guardarle un alias distinto, el mes siguiente casa sola con ella y la otra sigue sin pisarla", () => {
    const dos = [persona("a", "Laura García"), persona("b", "Laura García")];
    // Se confirma «LAURA GARCIA» para b: el alias es único → exacto con b.
    const b = { ...dos[1], customFields: customFieldsConAlias(dos[1], "LAURA GARCIA") };
    const { resueltos, pendientes } = resolverNombres(["LAURA GARCIA"], [dos[0], b]);
    assert.deepEqual([...resueltos.entries()], [["LAURA GARCIA", "b"]]);
    assert.equal(pendientes.length, 0);
  });
  it("reparte una lista entera: los exactos a resueltos, el resto a pendientes en el orden del Excel", () => {
    const nombres = ["VICTORIA", "LAURA G", "ARACELI", "Isabel Ruiz Montes", "ISA"];
    const { resueltos, pendientes } = resolverNombres(nombres, equipo());
    assert.deepEqual(
      [...resueltos.entries()],
      [
        ["LAURA G", "lau-g"],
        ["Isabel Ruiz Montes", "isa-r"],
      ]
    );
    assert.deepEqual(
      pendientes.map((p) => p.nombre),
      ["VICTORIA", "ARACELI", "ISA"]
    );
  });
  it("con la lista vacía: nada resuelto, nada pendiente", () => {
    const { resueltos, pendientes } = resolverNombres([], equipo());
    assert.equal(resueltos.size, 0);
    assert.deepEqual(pendientes, []);
  });
  it("un nombre vacío o null en la lista queda pendiente sin sugerencia, no casa con nadie", () => {
    const { resueltos, pendientes } = resolverNombres(["", null], equipo());
    assert.equal(resueltos.size, 0);
    assert.deepEqual(pendientes, [
      { nombre: "", sugerencia: null },
      { nombre: null, sugerencia: null },
    ]);
  });
  it("«GARCIA LOPEZ, MARIA» queda pendiente sin sugerencia; tras confirmar el alias, el mes siguiente casa solo", () => {
    const maria = persona("m", "María García López");
    const marzo = resolverNombres(["GARCIA LOPEZ, MARIA"], [maria]);
    assert.equal(marzo.resueltos.size, 0);
    assert.deepEqual(marzo.pendientes, [{ nombre: "GARCIA LOPEZ, MARIA", sugerencia: null }]);

    // Lo que hace `aplicar` con el mapeo confirmado en el preview.
    const conAlias = { ...maria, customFields: customFieldsConAlias(maria, "GARCIA LOPEZ, MARIA") };
    const abril = resolverNombres(["GARCIA LOPEZ, MARIA"], [conAlias]);
    assert.equal(abril.resueltos.get("GARCIA LOPEZ, MARIA"), "m");
    assert.deepEqual(abril.pendientes, []);
  });
  it("no toca ni la lista de nombres ni el equipo", () => {
    const nombres = ["ARACELI", "LAURA G"];
    const eq = equipo();
    const antesNombres = copia(nombres);
    const antesEq = copia(eq);
    resolverNombres(nombres, eq);
    assert.deepEqual(nombres, antesNombres);
    assert.deepEqual(eq, antesEq);
  });
});

describe("customFieldsConAlias: guardar el alias confirmado sin pisar nada", () => {
  it("añade el alias detrás de los que había y conserva las demás claves de customFields", () => {
    const p = persona("lau-g", "Laura Garrido Rascón", ["LAURA G"], { telefonoInterno: "212" });
    assert.deepEqual(customFieldsConAlias(p, "LAURA GARRIDO"), {
      telefonoInterno: "212",
      fichajeNombres: ["LAURA G", "LAURA GARRIDO"],
    });
  });
  it("sin customFields previos, los crea con el alias", () => {
    assert.deepEqual(customFieldsConAlias(persona("x", "Araceli Gómez"), "ARACELI"), {
      fichajeNombres: ["ARACELI"],
    });
  });
  it("el alias se guarda recortado de espacios pero con sus mayúsculas, como vino del Excel", () => {
    assert.deepEqual(customFieldsConAlias(persona("x", "Araceli Gómez"), "  ARACELI "), {
      fichajeNombres: ["ARACELI"],
    });
  });
  it("si el alias ya estaba —aunque cambien mayúsculas, acentos o espacios— devuelve null: nada que guardar", () => {
    const p = persona("x", "Isabel Alberca", ["ISABEL A."]);
    assert.equal(customFieldsConAlias(p, "isabel a."), null);
    assert.equal(customFieldsConAlias(p, "  ISABEL  A. "), null);
    assert.equal(customFieldsConAlias(p, "ÍSABEL A."), null);
  });
  it("un alias vacío, de solo espacios, null o undefined: null", () => {
    const p = persona("x", "Isabel Alberca");
    assert.equal(customFieldsConAlias(p, ""), null);
    assert.equal(customFieldsConAlias(p, "   "), null);
    assert.equal(customFieldsConAlias(p, null), null);
    assert.equal(customFieldsConAlias(p, undefined), null);
  });
  it("si la lista guardada estaba corrupta (texto) o con basura, la lista nueva solo lleva alias de verdad", () => {
    assert.deepEqual(customFieldsConAlias(persona("x", "Alguien", "ISA"), "ISA"), {
      fichajeNombres: ["ISA"],
    });
    assert.deepEqual(customFieldsConAlias(persona("x", "Alguien", ["ARACELI", "", 42]), "ARA"), {
      fichajeNombres: ["ARACELI", "ARA"],
    });
  });
  it("no toca la persona: devuelve un objeto y una lista nuevos", () => {
    const p = persona("lau-g", "Laura Garrido Rascón", ["LAURA G"], { telefonoInterno: "212" });
    const antes = copia(p);
    const nuevos = customFieldsConAlias(p, "LAURA GARRIDO");
    assert.deepEqual(p, antes);
    assert.notEqual(nuevos, p.customFields);
    assert.notEqual(nuevos.fichajeNombres, p.customFields.fichajeNombres);
  });
});
