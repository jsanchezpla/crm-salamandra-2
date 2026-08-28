// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-tipos-cita-demo.mjs — los tipos de cita de las demos se pueden guardar
 * (28/08/2026).
 *
 *   node scripts/_smoke-tipos-cita-demo.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Los 8 tipos de cita de las cuatro demos NO SE PODÍAN GUARDAR. Nacían
 * aceptando modalidad presencial con `location` vacío, y la regla que exige esa
 * dirección corre al GUARDAR, no al sembrar: nacían en un estado que la propia
 * pantalla rechaza. Abrir uno en Citas → Tipos de cita y darle a guardar —aunque
 * solo se le cambiara el color— devolvía 400. En 4 de los 8 pasaba lo mismo con
 * el teléfono: aceptaban `phone` sin `phoneNumber`.
 *
 * Las demos dan sesión de admin a cualquier visitante, así que era de las pocas
 * pantallas donde un cliente potencial se topa con algo roto.
 *
 * ── QUÉ VIGILA ESTA PRUEBA, Y POR QUÉ ASÍ ──────────────────────────────────
 *
 * El fallo no fue el dato: fue que el seed escribía DIRECTO al modelo,
 * saltándose la regla que la pantalla sí aplica. Así que lo que se prueba no es
 * «el dato de hoy es correcto» sino «el catálogo pasa la MISMA función que usa
 * el endpoint» — `validateModalityFields` de `lib/citas/validation.js`, la de
 * verdad, no una copia. Si mañana se renombra la modalidad `phone` o se endurece
 * la regla, esta prueba se entera; una copia de la regla aquí no se enteraría.
 *
 * Se prueba también el caso NEGATIVO (un tipo presencial sin dirección tiene que
 * ser rechazado), porque una prueba que solo mira el caso bueno pasaría igual si
 * `validateModalityFields` devolviera `null` siempre.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TIPOS_CITA_DEMO, SITIO_DEMO, TELEFONO_DEMO } from "../lib/demo/tiposCitaDemo.js";
import { validateModalityFields, VALID_MODALITIES, isValidSlug } from "../lib/citas/validation.js";

describe("los tipos de cita que se siembran en las demos", () => {
  test("hay catálogo y no está vacío", () => {
    assert.ok(Array.isArray(TIPOS_CITA_DEMO));
    assert.ok(TIPOS_CITA_DEMO.length > 0, "sin tipos no hay agenda que enseñar");
  });

  for (const tipo of TIPOS_CITA_DEMO) {
    describe(`"${tipo.name}"`, () => {
      test("se puede guardar desde la pantalla", () => {
        assert.equal(
          validateModalityFields(tipo),
          null,
          "lo rechazaría el mismo endpoint que usa la pantalla de Tipos de cita",
        );
      });

      test("si acepta presencial, tiene dirección", () => {
        if (tipo.modalities.includes("presencial")) {
          assert.ok(tipo.location, "presencial sin dirección: el paciente no sabe adónde ir");
        }
      });

      test("si acepta telefónica, tiene número", () => {
        if (tipo.modalities.includes("phone")) {
          assert.ok(tipo.phoneNumber, "telefónica sin número: nadie puede llamar");
        }
      });

      test("sus modalidades existen", () => {
        assert.ok(tipo.modalities.length > 0, "un tipo sin modalidad no se puede reservar");
        for (const m of tipo.modalities) {
          assert.ok(VALID_MODALITIES.includes(m), `modalidad desconocida: ${m}`);
        }
      });

      test("tiene slug válido y duración positiva", () => {
        assert.ok(isValidSlug(tipo.slug), `slug inválido: ${tipo.slug}`);
        assert.ok(Number.isInteger(tipo.duration) && tipo.duration > 0);
      });
    });
  }

  test("los slugs no se repiten", () => {
    const slugs = TIPOS_CITA_DEMO.map((t) => t.slug);
    assert.equal(new Set(slugs).size, slugs.length, "el findOrCreate del seed casa por slug");
  });

  test("la dirección y el teléfono son de mentira a propósito", () => {
    // Un escaparate público no puede enseñar la dirección de una clínica real,
    // ni un teléfono que suene en casa de alguien.
    assert.match(SITIO_DEMO, /Ejemplo/i);
    assert.match(TELEFONO_DEMO, /900 0*$|900 000 000/);
  });
});

describe("la prueba de verdad comprueba algo", () => {
  test("un tipo presencial SIN dirección sí es rechazado", () => {
    const error = validateModalityFields({ modalities: ["presencial", "online"], location: null });
    assert.ok(error, "si esto pasa, la prueba de arriba no vale nada");
    assert.match(error, /location/);
  });

  test("un tipo telefónico SIN número sí es rechazado", () => {
    const error = validateModalityFields({ modalities: ["phone"], phoneNumber: "" });
    assert.ok(error);
    assert.match(error, /phoneNumber/);
  });

  test("solo online no exige nada", () => {
    // El modo por defecto es el manual: el enlace se pega en la cita concreta.
    assert.equal(validateModalityFields({ modalities: ["online"] }), null);
  });
});
