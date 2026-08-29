// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-datos-centro.mjs — lo que se guarda en `settings.centro` (28/08/2026).
 *
 *   node scripts/_smoke-datos-centro.mjs
 *   node --test-name-pattern="sedes" scripts/_smoke-datos-centro.mjs
 *
 * ── QUÉ SE ESTÁ PROTEGIENDO ────────────────────────────────────────────────
 * `settings.centro` es de dónde saca el informe clínico la razón social, el
 * CIF, los teléfonos, las sedes con su nº de Registro Sanitario y el párrafo de
 * protección de datos. Ese informe lo presenta la familia en el colegio o para
 * la beca del Ministerio, así que lo que se guarde aquí acaba impreso en un
 * documento formal.
 *
 * De ahí las tres propiedades que se fijan, y las tres fallan en silencio:
 *
 *   1. **Lo que no es texto no entra.** Un número, un objeto o un `true`
 *      colados en el JSON saldrían impresos en la portada como
 *      «[object Object]». No se convierten con `String()`: se descartan.
 *   2. **Una sede sin datos se tira.** La pantalla deja añadir filas en blanco
 *      —es como se teclea— y una fila vacía guardada sería un renglón hueco en
 *      el informe.
 *   3. **La forma no cambia nunca.** Devuelve siempre las cinco claves, venga
 *      lo que venga (`null`, un string, una lista), porque el generador del PDF
 *      la lee tal cual. Y es idempotente: volver a pasar lo ya guardado no lo
 *      cambia, que es lo que hacen el GET y la respuesta del PATCH.
 *
 * Se prueba lo que DEVUELVE, no cómo está escrito.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LIMITES,
  centroVacio,
  normalizarCentro,
  normalizarSede,
} from "../lib/tenant/normalizarCentro.js";

/** La forma acordada con el generador del PDF. Si cambia, el PDF se entera. */
const CLAVES = ["razonSocial", "cif", "telefonos", "proteccionDatos", "proteccionDatosAdultos", "sedes"];
const CAMPOS_SEDE = ["nombre", "direccion", "cp", "ciudad", "registroSanitario", "telefono"];

const CENTRO_LLENO = {
  razonSocial: "Centro de Psicología Ejemplo S.L.",
  cif: "B12345678",
  telefonos: ["900 000 000", "600 000 000"],
  proteccionDatos: "Sus datos se tratan conforme al RGPD.",
  // El segundo aviso, el de mayores de edad: opcional, pero si está tiene que
  // sobrevivir al guardado igual que el otro.
  proteccionDatosAdultos: "Sus datos se tratan conforme al RGPD. Este informe queda en su poder.",
  sedes: [
    {
      nombre: "Sede centro",
      direccion: "Calle Mayor 1",
      cp: "28001",
      ciudad: "Madrid",
      registroSanitario: "CS-12345",
      telefono: "910 000 000",
    },
  ],
};

describe("la forma que lee el generador del PDF", () => {
  it("devuelve SIEMPRE las cinco claves, venga lo que venga", () => {
    for (const basura of [undefined, null, "", "texto", 7, true, [], [1, 2], () => {}]) {
      const c = normalizarCentro(basura);
      assert.deepEqual(Object.keys(c).sort(), [...CLAVES].sort(), `falló con ${String(basura)}`);
      assert.equal(typeof c.razonSocial, "string");
      assert.ok(Array.isArray(c.telefonos));
      assert.ok(Array.isArray(c.sedes));
    }
  });

  it("no inventa nada: lo que falta se queda vacío, sin «—» ni valores por defecto", () => {
    const c = normalizarCentro({});
    assert.deepEqual(c, {
      razonSocial: "",
      cif: "",
      telefonos: [],
      proteccionDatos: "",
      proteccionDatosAdultos: "",
      sedes: [],
    });
  });

  it("es idempotente: lo ya guardado vuelve a salir igual", () => {
    // Lo usan el GET y la respuesta del PATCH, que normalizan lo que ya está en
    // la base. Si esto no se cumpliera, abrir la pantalla cambiaría los datos.
    const una = normalizarCentro(CENTRO_LLENO);
    assert.deepEqual(normalizarCentro(una), una);
  });

  it("deja pasar entero lo que ya viene bien", () => {
    assert.deepEqual(normalizarCentro(CENTRO_LLENO), CENTRO_LLENO);
  });

  it("no se queda con claves de más que el PDF no espera", () => {
    const c = normalizarCentro({ ...CENTRO_LLENO, colorFavorito: "azul", sedes: [] });
    assert.equal("colorFavorito" in c, false);
  });
});

describe("lo que no es texto, fuera", () => {
  it("un número, un objeto o un booleano en un campo de texto valen vacío", () => {
    const c = normalizarCentro({ razonSocial: 42, cif: { a: 1 }, proteccionDatos: true });
    assert.equal(c.razonSocial, "");
    assert.equal(c.cif, "");
    assert.equal(c.proteccionDatos, "");
  });

  it("y no se convierten con String(): «[object Object]» no se imprime en una portada", () => {
    const c = normalizarCentro({ razonSocial: { toString: () => "Centro S.L." } });
    assert.equal(c.razonSocial, "");
  });

  it("los teléfonos que no son texto se descartan, no se convierten", () => {
    const c = normalizarCentro({ telefonos: ["900 000 000", 600123456, null, {}, "  ", "600 111 111"] });
    assert.deepEqual(c.telefonos, ["900 000 000", "600 111 111"]);
  });

  it("una lista que no es lista no revienta: se queda vacía", () => {
    assert.deepEqual(normalizarCentro({ telefonos: "900 000 000" }).telefonos, []);
    assert.deepEqual(normalizarCentro({ telefonos: { 0: "900" } }).telefonos, []);
    assert.deepEqual(normalizarCentro({ sedes: "Sede centro" }).sedes, []);
    assert.deepEqual(normalizarCentro({ sedes: { nombre: "Sede" } }).sedes, []);
  });

  it("null y undefined en cualquier hueco se comportan igual que un vacío", () => {
    const c = normalizarCentro({
      razonSocial: null,
      cif: undefined,
      telefonos: null,
      proteccionDatos: undefined,
      proteccionDatosAdultos: null,
      sedes: null,
    });
    assert.deepEqual(c, {
      razonSocial: "",
      cif: "",
      telefonos: [],
      proteccionDatos: "",
      proteccionDatosAdultos: "",
      sedes: [],
    });
  });
});

describe("los espacios y los topes", () => {
  it("se recorta por los lados", () => {
    const c = normalizarCentro({ razonSocial: "  Centro Ejemplo S.L.  ", cif: " B12345678 " });
    assert.equal(c.razonSocial, "Centro Ejemplo S.L.");
    assert.equal(c.cif, "B12345678");
  });

  it("un campo que pasa del tope se corta, no se rechaza el guardado entero", () => {
    // Rechazarlo dejaría al centro sin poder guardar NADA por pasarse en uno.
    const largo = "x".repeat(LIMITES.razonSocial + 500);
    assert.equal(normalizarCentro({ razonSocial: largo }).razonSocial.length, LIMITES.razonSocial);
  });

  it("el párrafo de protección de datos se corta en su tope", () => {
    const largo = "a".repeat(LIMITES.proteccionDatos + 1000);
    assert.equal(normalizarCentro({ proteccionDatos: largo }).proteccionDatos.length, LIMITES.proteccionDatos);
  });

  it("y no queda un espacio suelto pegado al corte", () => {
    const c = normalizarCentro({ razonSocial: `${"x".repeat(LIMITES.razonSocial - 1)} y` });
    assert.equal(c.razonSocial.endsWith(" "), false);
  });

  it("el texto largo conserva sus saltos de línea: es un párrafo, no una línea", () => {
    const c = normalizarCentro({ proteccionDatos: "Primera línea.\n\nSegunda línea." });
    assert.equal(c.proteccionDatos, "Primera línea.\n\nSegunda línea.");
  });

  it("sobran teléfonos: se quedan los primeros, que es el orden que importa", () => {
    // El primero es el principal, así que recortar por el final conserva el que
    // sale en la cabecera del informe.
    const muchos = Array.from({ length: LIMITES.telefonos + 4 }, (_, i) => `90${i}`);
    const c = normalizarCentro({ telefonos: muchos });
    assert.equal(c.telefonos.length, LIMITES.telefonos);
    assert.equal(c.telefonos[0], "900");
  });

  it("sobran sedes: se quedan las primeras", () => {
    const muchas = Array.from({ length: LIMITES.sedes + 3 }, (_, i) => ({ nombre: `Sede ${i}` }));
    const c = normalizarCentro({ sedes: muchas });
    assert.equal(c.sedes.length, LIMITES.sedes);
    assert.equal(c.sedes[0].nombre, "Sede 0");
  });

  it("el recorte cuenta lo que QUEDA, no lo que llegó con espacios", () => {
    const c = normalizarCentro({ cif: `   ${"B".repeat(LIMITES.cif)}   ` });
    assert.equal(c.cif.length, LIMITES.cif);
  });
});

describe("las sedes vacías se tiran", () => {
  it("una sede sin un solo dato no se guarda", () => {
    const c = normalizarCentro({
      sedes: [
        { nombre: "Sede centro", ciudad: "Madrid" },
        { nombre: "", direccion: "", cp: "", ciudad: "", registroSanitario: "", telefono: "" },
        {},
      ],
    });
    assert.equal(c.sedes.length, 1);
    assert.equal(c.sedes[0].nombre, "Sede centro");
  });

  it("una sede en blanco pero con espacios TAMBIÉN se tira", () => {
    // Es el caso real: la pantalla añade filas vacías para poder teclear.
    assert.deepEqual(normalizarCentro({ sedes: [{ nombre: "   ", cp: "\n" }] }).sedes, []);
  });

  it("pero una sede con UN solo dato se conserva entera", () => {
    // Aunque solo tenga el nº de Registro Sanitario: puede ser justo lo que el
    // informe necesita imprimir.
    const c = normalizarCentro({ sedes: [{ registroSanitario: "CS-99" }] });
    assert.equal(c.sedes.length, 1);
    assert.deepEqual(Object.keys(c.sedes[0]).sort(), [...CAMPOS_SEDE].sort());
    assert.equal(c.sedes[0].registroSanitario, "CS-99");
    assert.equal(c.sedes[0].nombre, "");
  });

  it("lo que no es un objeto no es una sede", () => {
    const c = normalizarCentro({ sedes: ["Sede centro", null, 7, [], undefined, { ciudad: "Vigo" }] });
    assert.equal(c.sedes.length, 1);
    assert.equal(c.sedes[0].ciudad, "Vigo");
  });

  it("una sede no arrastra campos que no son suyos", () => {
    const c = normalizarCentro({ sedes: [{ ciudad: "Vigo", aforo: 30 }] });
    assert.equal("aforo" in c.sedes[0], false);
  });

  it("normalizarSede devuelve null en lo que no es una sede", () => {
    for (const basura of [null, undefined, "Sede", 7, [], {}, { nombre: "  " }]) {
      assert.equal(normalizarSede(basura), null, `${JSON.stringify(basura)} ha pasado por sede`);
    }
  });
});

describe("centroVacio — cuándo se BORRA la clave en vez de guardarla", () => {
  it("nada puesto = vacío", () => {
    for (const nada of [undefined, null, {}, "", 7, [], { sedes: [], telefonos: [] }]) {
      assert.equal(centroVacio(nada), true, `${JSON.stringify(nada) ?? String(nada)} debería contar como vacío`);
    }
  });

  it("lo que solo trae basura o espacios también cuenta como vacío", () => {
    assert.equal(centroVacio({ razonSocial: "   ", telefonos: [" ", 5], sedes: [{}] }), true);
    assert.equal(centroVacio({ razonSocial: 42, cif: {}, proteccionDatos: true }), true);
  });

  it("con un solo dato de verdad ya NO está vacío", () => {
    assert.equal(centroVacio({ razonSocial: "Centro Ejemplo S.L." }), false);
    assert.equal(centroVacio({ cif: "B12345678" }), false);
    assert.equal(centroVacio({ telefonos: ["900 000 000"] }), false);
    assert.equal(centroVacio({ proteccionDatos: "Sus datos se tratan conforme al RGPD." }), false);
    assert.equal(centroVacio({ sedes: [{ registroSanitario: "CS-99" }] }), false);
    assert.equal(centroVacio(CENTRO_LLENO), false);
  });

  it("acepta lo crudo y lo ya normalizado, y dice lo mismo de los dos", () => {
    assert.equal(centroVacio(normalizarCentro(CENTRO_LLENO)), false);
    assert.equal(centroVacio(normalizarCentro(null)), true);
  });
});

describe("los topes son los que la pantalla frena", () => {
  it("todos los límites existen y son números positivos", () => {
    // La tarjeta pone `maxLength` con estos mismos valores: si aquí se cambia
    // uno por un `undefined`, el `maxLength` desaparece sin avisar y el
    // servidor pasaría a cortar textos que la pantalla dejó escribir enteros.
    for (const [clave, valor] of Object.entries(LIMITES)) {
      assert.equal(typeof valor, "number", `LIMITES.${clave} no es un número`);
      assert.ok(valor > 0, `LIMITES.${clave} tiene que ser positivo`);
    }
  });

  it("están los seis campos de una sede y los topes de las dos listas", () => {
    for (const campo of ["razonSocial", "cif", "proteccionDatos", "telefono", "telefonos", "sedes", ...CAMPOS_SEDE.filter((c) => c !== "telefono")]) {
      assert.ok(LIMITES[campo], `falta el tope de ${campo}`);
    }
  });
});
