// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-training-registration-labels.mjs — los rótulos del Registro previo de
 * Formación: todo slug de WP sale legible, y el desconocido sale crudo, nunca
 * revienta (20/08/2026).
 *
 *   node scripts/_smoke-training-registration-labels.mjs
 *   node --test-name-pattern="labelOr" scripts/_smoke-training-registration-labels.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * El formulario de Registro previo del curso «Liderazgo Educativo» (Retorika)
 * llega desde WordPress con slugs (`docente_primaria`, `5_10`, `liderazgo`…).
 * Tres pantallas los vuelven legibles con los diccionarios de
 * `lib/training/registrationLabels.js`: el drawer de detalle de la matrícula
 * (`CourseRegistrationDetail`), el panel de stats del curso
 * (`CourseRegistrationStats`, que además pinta las escalas categóricas SIEMPRE
 * en el orden de los arrays `*_ORDER`) y el export CSV
 * (`app/api/training/course-registrations/export`).
 *
 * La regla de oro está en el comentario del propio fichero de lib: si el form
 * de WP añade un slug nuevo antes de que actualicemos el diccionario, se cae
 * al slug crudo y NADA revienta — ni el CSV ni el drawer. Si esa caída se
 * pierde, una matrícula con un slug nuevo tumbaría el export de las 526
 * inscripciones reales de Retorika. Esta prueba fija ese contrato y los
 * invariantes de datos que las pantallas dan por hechos: que cada `*_ORDER`
 * cubre exactamente las categorías de su diccionario (una categoría fuera del
 * orden desaparecería del panel de stats en silencio) y que las preguntas del
 * diagnóstico y sus títulos completos comparten las mismas claves (el panel
 * titula los bloques con `DIAGNOSIS_FULL_QUESTIONS[clave]`).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CENTER_TYPE,
  POSITIONS,
  COURSES_TEACHING,
  SUBJECTS,
  TOPICS_OF_INTEREST,
  DIAGNOSIS_QUESTION_LABELS,
  DIAGNOSIS_FULL_QUESTIONS,
  CENTER_FIELD_LABELS,
  TEACHER_FIELD_LABELS,
  WORKLOAD_FREQUENCY,
  WORKLOAD_FREQUENCY_ORDER,
  WEEKLY_EXTRA_HOURS,
  WEEKLY_EXTRA_HOURS_ORDER,
  labelOr,
  joinSlugs,
  getNested,
} from "../lib/training/registrationLabels.js";

/** El JSONB del centro tal como lo lee el drawer (Registro previo de Retorika). */
const CENTRO = {
  type: "concertado",
  name: "San Fermín",
  otherName: "El de la esquina",
  nif: "R3100000J",
  address: {
    street: "Calle Mayor 1",
    apartment: "2ºB",
    city: "Pamplona",
    state: "Navarra",
    postalCode: "31001",
    country: "España",
  },
};

describe("labelOr: rótulo humano si lo hay, slug crudo si no — el form de WP va por delante", () => {
  it("un slug conocido devuelve su rótulo, en cualquiera de los diccionarios", () => {
    assert.equal(labelOr(CENTER_TYPE, "concertado"), "Colegio concertado");
    assert.equal(labelOr(POSITIONS, "pt"), "PT (Pedagogía Terapéutica)");
    assert.equal(labelOr(COURSES_TEACHING, "eso_1_2"), "ESO 1º-2º (12-13 años)");
    assert.equal(labelOr(SUBJECTS, "lengua"), "Lengua y Literatura");
    assert.equal(labelOr(TOPICS_OF_INTEREST, "neuroeducacion"), "Neuroeducación");
    assert.equal(labelOr(WEEKLY_EXTRA_HOURS, "5_10"), "Entre 5 y 10 horas");
  });

  it("un slug que el diccionario no conoce sale crudo, no aborta (WP puede añadirlo antes que nosotros)", () => {
    assert.equal(labelOr(CENTER_TYPE, "coworking"), "coworking");
    assert.equal(labelOr(POSITIONS, "docente_de_apoyo"), "docente_de_apoyo");
  });

  it("sin slug (null o undefined) devuelve cadena vacía, que en CSV es una celda en blanco", () => {
    assert.equal(labelOr(CENTER_TYPE, null), "");
    assert.equal(labelOr(CENTER_TYPE, undefined), "");
  });

  it("un slug que no es texto se devuelve como texto", () => {
    assert.equal(labelOr(CENTER_TYPE, 0), "0");
    assert.equal(labelOr(CENTER_TYPE, 42), "42");
  });

  it("la cadena vacía no casa con nada y vuelve vacía", () => {
    assert.equal(labelOr(CENTER_TYPE, ""), "");
  });

  // SOSPECHOSO: los diccionarios son objetos literales y `dict[slug]` también
  // encuentra lo heredado de Object.prototype: con el slug "constructor" (o
  // "toString") devuelve una FUNCIÓN, no el slug crudo que promete el
  // comentario del fichero. Un POST manual con ese slug pintaría el código de
  // la función en el CSV o rompería el render del drawer. Se esperaría
  // "constructor" tal cual (Object.hasOwn en vez de `in` implícito del ??).
  it("HOY un slug heredado de Object.prototype («constructor») devuelve la función, no el slug crudo", () => {
    assert.equal(typeof labelOr(CENTER_TYPE, "constructor"), "function");
    assert.equal(typeof labelOr(POSITIONS, "toString"), "function");
    // Y «__proto__» devuelve el propio Object.prototype (un objeto).
    assert.equal(typeof labelOr(CENTER_TYPE, "__proto__"), "object");
  });
});

describe("joinSlugs: la lista de slugs sale legible para el CSV y el drawer", () => {
  it("resuelve cada slug y los une con coma y espacio", () => {
    assert.equal(
      joinSlugs(POSITIONS, ["director", "pt"]),
      "Director/a, PT (Pedagogía Terapéutica)"
    );
  });

  it("los desconocidos van crudos entre los conocidos, sin romper la fila", () => {
    assert.equal(joinSlugs(SUBJECTS, ["ingles", "cocina", "musica"]), "Inglés, cocina, Música");
  });

  it("acepta separador propio", () => {
    assert.equal(
      joinSlugs(TOPICS_OF_INTEREST, ["liderazgo", "gestion_aula"], " · "),
      "Liderazgo educativo · Gestión del aula"
    );
  });

  it("una lista vacía es cadena vacía", () => {
    assert.equal(joinSlugs(POSITIONS, []), "");
  });

  it("lo que no es lista (null, undefined, un slug suelto) es cadena vacía", () => {
    assert.equal(joinSlugs(POSITIONS, null), "");
    assert.equal(joinSlugs(POSITIONS, undefined), "");
    assert.equal(joinSlugs(POSITIONS, "director"), "");
  });

  // SOSPECHOSO: un null dentro de la lista no se filtra: labelOr(null) da ""
  // y el join deja un hueco «, , » en medio de la celda del CSV. Se esperaría
  // que los elementos nulos se saltaran ("Director/a, PT (…)").
  it("HOY un null dentro de la lista deja un hueco vacío en la celda", () => {
    assert.equal(
      joinSlugs(POSITIONS, ["director", null, "pt"]),
      "Director/a, , PT (Pedagogía Terapéutica)"
    );
  });
});

describe("getNested: las rutas con punto sobre el JSONB del centro", () => {
  it("resuelve una ruta con punto («address.city»)", () => {
    assert.equal(getNested(CENTRO, "address.city"), "Pamplona");
    assert.equal(getNested(CENTRO, "address.postalCode"), "31001");
  });

  it("una clave sin punto también", () => {
    assert.equal(getNested(CENTRO, "nif"), "R3100000J");
  });

  it("una rama que no existe, o cortada por un null, devuelve cadena vacía sin reventar", () => {
    assert.equal(getNested(CENTRO, "address.floor"), "");
    assert.equal(getNested(CENTRO, "billing.iban"), "");
    assert.equal(getNested({ address: null }, "address.city"), "");
  });

  it("sin objeto o sin ruta, cadena vacía", () => {
    assert.equal(getNested(null, "address.city"), "");
    assert.equal(getNested(undefined, "address.city"), "");
    assert.equal(getNested(CENTRO, ""), "");
    assert.equal(getNested(CENTRO, null), "");
  });

  it("un valor falsy REAL (0, false) se devuelve tal cual: no es lo mismo que «no hay»", () => {
    assert.equal(getNested({ horas: 0 }, "horas"), 0);
    assert.equal(getNested({ centro: { publico: false } }, "centro.publico"), false);
  });

  it("todas las rutas con punto de CENTER_FIELD_LABELS resuelven sobre un centro real", () => {
    // Si alguien renombra una clave del JSONB y no toca el diccionario de
    // labels, el CSV sacaría la cabecera con la celda siempre vacía.
    for (const ruta of Object.keys(CENTER_FIELD_LABELS)) {
      if (!ruta.includes(".")) continue;
      assert.notEqual(getNested(CENTRO, ruta), "", `la ruta «${ruta}» ya no resuelve`);
    }
  });
});

describe("los invariantes que el panel de stats y el CSV dan por hechos", () => {
  it("el orden de la sobrecarga va de menor a mayor y cubre EXACTAMENTE sus categorías", () => {
    assert.deepEqual(WORKLOAD_FREQUENCY_ORDER, [
      "nunca",
      "casi_nunca",
      "poca",
      "algunas_veces",
      "mucha",
      "muchisima",
    ]);
    // Una categoría en el diccionario pero fuera del orden desaparecería del
    // panel en silencio; una en el orden sin rótulo se pintaría cruda.
    assert.deepEqual([...WORKLOAD_FREQUENCY_ORDER].sort(), Object.keys(WORKLOAD_FREQUENCY).sort());
  });

  it("el orden de las horas extra semanales también, de menos a más", () => {
    assert.deepEqual(WEEKLY_EXTRA_HOURS_ORDER, ["menos_5", "5_10", "11_15", "mas_15"]);
    assert.deepEqual([...WEEKLY_EXTRA_HOURS_ORDER].sort(), Object.keys(WEEKLY_EXTRA_HOURS).sort());
  });

  it("las preguntas del diagnóstico y sus títulos completos comparten las MISMAS claves y orden", () => {
    // El panel de stats y la Hoja 2 del CSV titulan con
    // DIAGNOSIS_FULL_QUESTIONS[clave]; el drawer rotula cada fila con
    // DIAGNOSIS_QUESTION_LABELS[clave]: si divergen, un bloque se queda sin
    // título o una fila sin rótulo.
    assert.deepEqual(Object.keys(DIAGNOSIS_FULL_QUESTIONS), Object.keys(DIAGNOSIS_QUESTION_LABELS));
  });

  it("los diccionarios de campos conservan las claves que el drawer referencia a pelo", () => {
    // CourseRegistrationDetail pinta CENTER_FIELD_LABELS.type,
    // CENTER_FIELD_LABELS["address.city"], TEACHER_FIELD_LABELS.positions…
    // como literales: si una clave se renombra aquí, esa fila del drawer se
    // queda con el rótulo undefined en silencio.
    assert.deepEqual(Object.keys(CENTER_FIELD_LABELS), [
      "type",
      "name",
      "otherName",
      "nif",
      "address.street",
      "address.apartment",
      "address.city",
      "address.state",
      "address.postalCode",
      "address.country",
    ]);
    assert.deepEqual(Object.keys(TEACHER_FIELD_LABELS), [
      "yearsOfExperience",
      "positions",
      "coursesTeaching",
      "subjects",
      "topicsOfInterest",
    ]);
  });

  // El form de WP siempre ofrece un escape «Otro/Otra»: si un diccionario lo
  // pierde, esa respuesta real pasaría a pintarse como slug crudo.
  const OPCIONES = { CENTER_TYPE, POSITIONS, COURSES_TEACHING, SUBJECTS, TOPICS_OF_INTEREST };
  for (const [nombre, dict] of Object.entries(OPCIONES)) {
    it(`${nombre} conserva su opción de escape «Otro/Otra»`, () => {
      assert.ok("otro" in dict || "otra" in dict, `${nombre} se quedó sin escape`);
    });
  }
});
