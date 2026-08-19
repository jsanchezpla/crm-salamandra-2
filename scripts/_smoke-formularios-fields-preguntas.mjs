// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-formularios-fields-preguntas.mjs — el contrato de las preguntas del
 * formulario público (`lib/formularios/fields.js`) y las preguntas propias de
 * un tipo de cita (`lib/citas/preguntasCita.js`) (19/08/2026).
 *
 *   node scripts/_smoke-formularios-fields-preguntas.mjs
 *   node --test-name-pattern="dni" scripts/_smoke-formularios-fields-preguntas.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * Los dos ficheros son la ÚNICA puerta por la que entra lo que escribe alguien
 * de fuera: el formulario de familias que Aumenta tiene en su WordPress pega
 * contra `/api/public/.../formularios/...` y quien reserva una cita contesta
 * desde el widget. Ninguna de las dos pantallas es nuestra, así que lo que
 * decide qué es obligatorio, qué se limpia (HTML, espacios, prefijo +34, la
 * letra del DNI) y qué sube a la ficha de cliente es lo que DEVUELVEN estas
 * funciones. Hasta hoy solo las cubrían dos smokes con `check()` para las
 * preguntas de la cita y una que pide base de datos para el formulario: las
 * reglas finas —qué cuenta como consentimiento aceptado, que un pasaporte pase
 * sin letra, que la edad del peque suba como «6» y no como 6, que la respuesta
 * sobre el peque NO desaparezca de «lo que nos contó» en un cliente sin
 * `pacientes`— no tenían red.
 *
 * Lo que se fija aquí es lo que cada función devuelve hoy, caso a caso y por
 * los dos lados de cada `if`. Los `it` marcados `SOSPECHOSO` pintan un
 * comportamiento que parece un fallo: se deja escrito tal cual sale hoy, para
 * que si alguien lo arregla la prueba se lo diga en vez de pasar en silencio.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TIPOS,
  DESTINOS_FICHA,
  DESTINOS_FAMILIA,
  DESTINOS,
  RELACION_ES_EL_PACIENTE,
  RELACION_A_TUTOR,
  camposDe,
  normalizarTelefono,
  validarRespuestas,
  infoAdicional,
  formPublico,
} from "../lib/formularios/fields.js";

import {
  TIPOS as TIPOS_CITA,
  ETIQUETA_TIPO,
  ESCALA_POR_DEFECTO,
  MAX_PREGUNTAS,
  normalizarPreguntas,
  validarRespuestas as validarRespuestasCita,
  paquetePreguntas,
} from "../lib/citas/preguntasCita.js";

/* ── Ayudas ──────────────────────────────────────────────────────────────── */

/** Un formulario con UN solo campo: lo justo para probar una regla. */
const unCampo = (campo) => ({ fields: [{ key: "x", label: "La pregunta", ...campo }] });

/** Valida un solo campo y devuelve el resultado entero. */
const valida = (campo, valor) => validarRespuestas(unCampo(campo), { x: valor });

/** El primer error de una validación, o null si pasó. */
const error1 = (campo, valor) => {
  const r = valida(campo, valor);
  return r.ok ? null : r.errores[0].mensaje;
};

/** El valor normalizado que se guarda para un solo campo (o undefined si falló). */
const guardado = (campo, valor) => {
  const r = valida(campo, valor);
  return r.ok ? r.answers[0].value : undefined;
};

/**
 * El formulario de familias de Aumenta tal como lo siembra
 * `scripts/seed-formulario-aumenta.js` (solo lo que la validación lee).
 */
const FORM_FAMILIAS = {
  slug: "familias",
  title: "Cuéntanos qué necesitáis",
  introText: "No hace falta que lo tengas todo claro.",
  settings: { notifyEmails: ["interno@example.com"], privacyUrl: "https://example.com/privacidad" },
  fields: [
    {
      key: "nombre",
      label: "¿Cómo te llamas?",
      type: "text",
      required: true,
      order: 1,
      maxLength: 120,
      mapTo: "name",
    },
    {
      key: "parentesco",
      label: "¿Quién eres?",
      type: "select",
      required: true,
      order: 2,
      options: ["Madre", "Padre", "Tutor o tutora legal", RELACION_ES_EL_PACIENTE, "Otro"],
      mapTo: "relationship",
    },
    {
      key: "nombrePeque",
      label: "¿Cómo se llama el paciente?",
      type: "text",
      required: false,
      order: 3,
      maxLength: 120,
      mapTo: "patientName",
    },
    {
      key: "edadPeque",
      label: "¿Cuántos años tiene?",
      type: "number",
      required: false,
      order: 4,
      min: 0,
      max: 99,
      mapTo: "patientAge",
    },
    {
      key: "motivo",
      label: "¿Qué os preocupa?",
      type: "textarea",
      required: true,
      order: 5,
      maxLength: 2000,
      mapTo: "reason",
    },
    {
      key: "telefono",
      label: "Teléfono",
      type: "tel",
      required: true,
      order: 6,
      maxLength: 30,
      mapTo: "phone",
    },
    {
      key: "email",
      label: "Correo electrónico",
      type: "email",
      required: true,
      order: 7,
      maxLength: 160,
      mapTo: "email",
    },
    {
      key: "consentimiento",
      label: "He leído y acepto la política de privacidad.",
      type: "consent",
      required: true,
      order: 8,
      linkUrl: "https://example.com/privacidad",
      linkLabel: "política de privacidad",
      mapTo: null,
    },
  ],
};

/** Lo que mandaría una madre desde el WordPress, con las manías de teclear. */
const RESPUESTA_MADRE = {
  nombre: "  Marta Ruiz Gómez ",
  parentesco: "Madre",
  nombrePeque: "Lucía Ruiz Pérez",
  edadPeque: "6",
  motivo: "Le cuesta concentrarse en clase.",
  telefono: "+34 600 111 222",
  email: "Marta@Example.COM",
  consentimiento: true,
};

/* ══════════════════════════════════════════════════════════════════════════
 * lib/formularios/fields.js
 * ══════════════════════════════════════════════════════════════════════════ */

describe("las constantes del contrato: lo que el seed y el aceptar dan por hecho", () => {
  it("hay diez tipos de pregunta y el consentimiento es uno de ellos", () => {
    assert.deepEqual(
      [...TIPOS],
      ["text", "textarea", "tel", "dni", "email", "number", "select", "checkbox", "date", "consent"]
    );
  });

  it("los destinos son los seis de la ficha más los tres de la familia, y no se pueden tocar", () => {
    assert.deepEqual([...DESTINOS_FICHA], ["name", "email", "phone", "age", "reason", "taxId"]);
    assert.deepEqual([...DESTINOS_FAMILIA], ["patientName", "patientAge", "relationship"]);
    assert.deepEqual([...DESTINOS], [...DESTINOS_FICHA, ...DESTINOS_FAMILIA]);
    assert.ok(Object.isFrozen(DESTINOS));
    assert.ok(Object.isFrozen(TIPOS));
  });

  it("«Soy yo quien necesita ayuda» es el texto EXACTO: de él depende que no se cree un paciente con el nombre del adulto", () => {
    assert.equal(RELACION_ES_EL_PACIENTE, "Soy yo quien necesita ayuda");
  });

  it("la tabla de parentescos traduce las cuatro opciones a lo que guarda Client.guardians, y «soy yo» no es tutor de nadie", () => {
    assert.deepEqual(RELACION_A_TUTOR, {
      Madre: "madre",
      Padre: "padre",
      "Tutor o tutora legal": "tutor",
      Otro: "otro",
    });
    assert.equal(RELACION_A_TUTOR[RELACION_ES_EL_PACIENTE], undefined);
  });
});

describe("camposDe: qué preguntas se pintan y en qué orden", () => {
  it("sin formulario, sin fields o con fields que no es una lista, devuelve [] sin reventar", () => {
    assert.deepEqual(camposDe(null), []);
    assert.deepEqual(camposDe(undefined), []);
    assert.deepEqual(camposDe({}), []);
    assert.deepEqual(camposDe({ fields: "texto" }), []);
    assert.deepEqual(camposDe({ fields: { key: "a", type: "text" } }), []);
  });

  it("descarta la basura de un JSONB roto: null, sin key, key que no es texto, tipo inventado", () => {
    const form = {
      fields: [
        null,
        { label: "sin key", type: "text" },
        { key: "", type: "text" },
        { key: 5, type: "text" },
        { key: "raro", type: "video" },
        { key: "Raro", type: "Text" },
        { key: "bien", type: "text" },
      ],
    };
    assert.deepEqual(
      camposDe(form).map((c) => c.key),
      ["bien"]
    );
  });

  it("ordena por `order` como número; sin order o con order ilegible cuenta 0 y va delante", () => {
    const form = {
      fields: [
        { key: "b", type: "text", order: 2 },
        { key: "a", type: "text", order: "1" },
        { key: "c", type: "text" },
        { key: "d", type: "text", order: "tres" },
      ],
    };
    assert.deepEqual(
      camposDe(form).map((c) => c.key),
      ["c", "d", "a", "b"]
    );
  });

  it("no reordena el array original del formulario", () => {
    const fields = [
      { key: "b", type: "text", order: 2 },
      { key: "a", type: "text", order: 1 },
    ];
    camposDe({ fields });
    assert.deepEqual(
      fields.map((c) => c.key),
      ["b", "a"]
    );
  });
});

describe("normalizarTelefono: un móvil español son 9 dígitos, se escriba como se escriba", () => {
  it("quita espacios, puntos, guiones y paréntesis", () => {
    assert.equal(normalizarTelefono("600 11 22 33"), "600112233");
    assert.equal(normalizarTelefono("600-11-22-33"), "600112233");
    assert.equal(normalizarTelefono("600.11.22.33"), "600112233");
    assert.equal(normalizarTelefono("(600) 11 22 33"), "600112233");
  });

  it("quita el prefijo +34 o 34 delante", () => {
    assert.equal(normalizarTelefono("+34 600 112 233"), "600112233");
    assert.equal(normalizarTelefono("+34600112233"), "600112233");
    assert.equal(normalizarTelefono("34600112233"), "600112233");
  });

  it("un fijo vale igual que un móvil (9 dígitos son 9 dígitos)", () => {
    assert.equal(normalizarTelefono("91 234 56 78"), "912345678");
  });

  it("con 8 o 10 dígitos, o con letras, no lo parece: null", () => {
    assert.equal(normalizarTelefono("60011223"), null);
    assert.equal(normalizarTelefono("6001122334"), null);
    assert.equal(normalizarTelefono("60011223a"), null);
  });

  it("un número de otro país no se cuela como español", () => {
    assert.equal(normalizarTelefono("+33 6 12 34 56 78"), null);
  });

  it("sin valor (null, undefined, vacío, espacios) da null", () => {
    assert.equal(normalizarTelefono(null), null);
    assert.equal(normalizarTelefono(undefined), null);
    assert.equal(normalizarTelefono(""), null);
    assert.equal(normalizarTelefono("   "), null);
  });

  it("si llega como número en vez de texto, también lo entiende", () => {
    assert.equal(normalizarTelefono(600112233), "600112233");
  });

  it("SOSPECHOSO: el prefijo internacional escrito «0034» no se quita y el teléfono se rechaza", () => {
    // Hoy solo se reconoce «+34» o «34» delante; «0034 600 112 233» son 13
    // dígitos y sale null. Es la misma persona que con «+34» entraría.
    assert.equal(normalizarTelefono("0034 600 112 233"), null);
  });
});

describe("validarRespuestas (formulario): el consentimiento", () => {
  const consent = { type: "consent", label: "He leído y acepto la política de privacidad." };

  it("sin `required` declarado, el consentimiento es OBLIGATORIO (a diferencia de los demás campos)", () => {
    const r = valida(consent, undefined);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errores, [
      { key: "x", mensaje: "Hay que aceptar para poder enviar la solicitud." },
    ]);
  });

  it('cuenta como aceptado con true, "true", "on" y 1: lo que mandan un JSON, un checkbox HTML y un 1', () => {
    for (const v of [true, "true", "on", 1]) {
      const r = valida(consent, v);
      assert.equal(r.ok, true, `con ${JSON.stringify(v)} debería aceptar`);
      assert.deepEqual(r.consentimiento, { texto: consent.label });
      assert.deepEqual(r.answers, [
        { key: "x", label: consent.label, type: "consent", value: "Sí" },
      ]);
    }
  });

  it('no cuenta como aceptado con false, "yes", "1" (texto), "sí" ni con un objeto', () => {
    for (const v of [false, "yes", "1", "sí", {}]) {
      assert.equal(valida(consent, v).ok, false, `con ${JSON.stringify(v)} no debería aceptar`);
    }
  });

  it("un consentimiento opcional sin marcar pasa, se guarda «No» y no hay texto probatorio", () => {
    const r = valida({ ...consent, required: false }, undefined);
    assert.equal(r.ok, true);
    assert.equal(r.consentimiento, null);
    assert.deepEqual(r.answers, [{ key: "x", label: consent.label, type: "consent", value: "No" }]);
  });

  it("el texto probatorio es el ENUNCIADO de la casilla, recortado a 2000 caracteres", () => {
    const largo = "a".repeat(2500);
    const r = valida({ type: "consent", label: largo }, true);
    assert.equal(r.consentimiento.texto.length, 2000);
    assert.equal(r.consentimiento.texto, "a".repeat(2000));
  });

  it("sin enunciado, el texto probatorio queda vacío pero no revienta", () => {
    const r = validarRespuestas({ fields: [{ key: "c", type: "consent" }] }, { c: true });
    assert.equal(r.ok, true);
    assert.deepEqual(r.consentimiento, { texto: "" });
    assert.equal(r.answers[0].label, "");
  });

  it("el consentimiento y las casillas NUNCA suben a la ficha, aunque alguien les ponga mapTo", () => {
    const form = {
      fields: [
        { key: "c", label: "Acepto", type: "consent", mapTo: "name" },
        { key: "k", label: "Marca", type: "checkbox", mapTo: "reason" },
      ],
    };
    const r = validarRespuestas(form, { c: true, k: true });
    assert.equal(r.ok, true);
    assert.deepEqual(r.destinos, {});
  });
});

describe("validarRespuestas (formulario): las casillas (checkbox)", () => {
  const casilla = { type: "checkbox", label: "¿Ha estado antes en terapia?" };

  it("sin `required`, una casilla es OPCIONAL: sin marcar se guarda «No»", () => {
    const r = valida(casilla, undefined);
    assert.equal(r.ok, true);
    assert.deepEqual(r.answers, [
      { key: "x", label: casilla.label, type: "checkbox", value: "No" },
    ]);
  });

  it('obligatoria y sin marcar: «Marca "…".»', () => {
    assert.equal(
      error1({ ...casilla, required: true }, undefined),
      'Marca "¿Ha estado antes en terapia?".'
    );
    assert.equal(
      error1({ ...casilla, required: true }, false),
      'Marca "¿Ha estado antes en terapia?".'
    );
  });

  it('marcada con true, "true", "on" o 1 se guarda «Sí»', () => {
    for (const v of [true, "true", "on", 1]) {
      assert.equal(guardado({ ...casilla, required: true }, v), "Sí", `con ${JSON.stringify(v)}`);
    }
  });
});

describe("validarRespuestas (formulario): obligatorio y vacío", () => {
  it('un campo obligatorio en blanco: «"…" es obligatorio.»', () => {
    assert.equal(error1({ type: "text", required: true }, ""), '"La pregunta" es obligatorio.');
    assert.equal(
      error1({ type: "text", required: true }, undefined),
      '"La pregunta" es obligatorio.'
    );
    assert.equal(error1({ type: "text", required: true }, null), '"La pregunta" es obligatorio.');
  });

  it("solo espacios, o solo etiquetas HTML, es estar en blanco", () => {
    assert.equal(error1({ type: "text", required: true }, "    "), '"La pregunta" es obligatorio.');
    assert.equal(
      error1({ type: "text", required: true }, "<b></b>"),
      '"La pregunta" es obligatorio.'
    );
  });

  it('un campo opcional en blanco pasa, se guarda con value "" y NO sube a la ficha', () => {
    const r = valida({ type: "text", required: false, mapTo: "name" }, "");
    assert.equal(r.ok, true);
    assert.deepEqual(r.answers, [{ key: "x", label: "La pregunta", type: "text", value: "" }]);
    assert.deepEqual(r.destinos, {});
  });

  it("un cuerpo null o undefined se trata como todo en blanco", () => {
    const form = unCampo({ type: "text", required: true });
    assert.equal(validarRespuestas(form, null).ok, false);
    assert.equal(validarRespuestas(form, undefined).ok, false);
    const opcional = unCampo({ type: "text", required: false });
    assert.equal(validarRespuestas(opcional, null).ok, true);
  });

  it("sin formulario (null) no hay nada que validar: ok, sin respuestas ni destinos", () => {
    assert.deepEqual(validarRespuestas(null, { lo: "que sea" }), {
      ok: true,
      answers: [],
      destinos: {},
      consentimiento: null,
    });
  });

  it("SOSPECHOSO: un campo de texto sin `required` es opcional para el servidor, pero formPublico lo anuncia como obligatorio", () => {
    // `validarRespuestas` mira `campo.required` (truthy) y `formPublico` mira
    // `required !== false`: con `required` sin declarar, la pantalla pública
    // pinta el asterisco y el servidor deja pasar el campo en blanco. El seed
    // de Aumenta lo declara siempre, así que hoy no muerde.
    const form = unCampo({ type: "text" });
    assert.equal(validarRespuestas(form, {}).ok, true);
    assert.equal(formPublico(form).fields[0].required, true);
  });
});

describe("validarRespuestas (formulario): limpieza del texto y tope de longitud", () => {
  it("quita las etiquetas HTML y recorta los espacios de los extremos: se guarda texto, no marcado", () => {
    assert.equal(
      guardado({ type: "text" }, "  <script>alert(1)</script>Hola <b>mundo</b>  "),
      "alert(1)Hola mundo"
    );
  });

  it("un text no pasa de 200 caracteres por defecto; 200 justos pasan", () => {
    assert.equal(guardado({ type: "text" }, "x".repeat(200)), "x".repeat(200));
    assert.equal(
      error1({ type: "text" }, "x".repeat(201)),
      '"La pregunta" no puede pasar de 200 caracteres.'
    );
  });

  it("un textarea llega a 1000 por defecto", () => {
    assert.equal(guardado({ type: "textarea" }, "x".repeat(1000)).length, 1000);
    assert.match(error1({ type: "textarea" }, "x".repeat(1001)), /no puede pasar de 1000/);
  });

  it("el maxLength declarado en el campo manda sobre el del tipo, hacia abajo y hacia arriba", () => {
    assert.match(error1({ type: "text", maxLength: 10 }, "x".repeat(11)), /no puede pasar de 10/);
    assert.equal(guardado({ type: "text", maxLength: 10 }, "x".repeat(10)).length, 10);
    assert.equal(guardado({ type: "textarea", maxLength: 2000 }, "x".repeat(1500)).length, 1500);
  });

  it("un maxLength 0, negativo o ilegible no cuenta: vuelve el tope del tipo", () => {
    for (const maxLength of [0, -5, "abc", null]) {
      assert.match(
        error1({ type: "text", maxLength }, "x".repeat(201)),
        /no puede pasar de 200/,
        `con maxLength ${JSON.stringify(maxLength)}`
      );
    }
  });

  it("el tope se mide DESPUÉS de quitar el HTML y los espacios", () => {
    assert.equal(guardado({ type: "text" }, "<p>" + "x".repeat(200) + "</p>   ").length, 200);
  });

  it("un valor que llega como número se guarda como su texto", () => {
    assert.equal(guardado({ type: "text" }, 42), "42");
  });

  it("SOSPECHOSO: un objeto o una lista donde se esperaba texto no se rechaza: se guarda «[object Object]» o «a,b»", () => {
    // El cuerpo es `request.json()` de un endpoint público: un cliente roto (o
    // un bot) puede mandar `{ x: { a: 1 } }` y en la bandeja aparece
    // «[object Object]» como respuesta válida. Hoy se limpia con String().
    assert.equal(guardado({ type: "text" }, { a: 1 }), "[object Object]");
    assert.equal(guardado({ type: "text" }, ["a", "b"]), "a,b");
  });
});

describe("validarRespuestas (formulario): email", () => {
  const email = { type: "email", mapTo: "email" };

  it("se guarda en minúsculas y sube a destinos.email", () => {
    const r = valida(email, "  Marta@Example.COM ");
    assert.equal(r.ok, true);
    assert.equal(r.answers[0].value, "marta@example.com");
    assert.deepEqual(r.destinos, { email: "marta@example.com" });
  });

  it("admite subdominios y puntos en el usuario", () => {
    assert.equal(guardado(email, "ana.lopez@sub.example.es"), "ana.lopez@sub.example.es");
  });

  it("sin arroba, sin punto tras la arroba, con dominio de una letra o con espacios: «El email no parece válido.»", () => {
    for (const v of [
      "ana.example.com",
      "ana@example",
      "ana@example.c",
      "ana lopez@example.com",
      "@example.com",
    ]) {
      assert.equal(error1(email, v), "El email no parece válido.", `con ${v}`);
    }
  });

  it("el tope por defecto de un email es 160", () => {
    assert.match(error1(email, "a".repeat(150) + "@example.com"), /no puede pasar de 160/);
  });
});

describe("validarRespuestas (formulario): teléfono", () => {
  const tel = { type: "tel", mapTo: "phone" };

  it("se guarda normalizado a 9 dígitos y sube a destinos.phone", () => {
    const r = valida(tel, "+34 600 11 22 33");
    assert.equal(r.ok, true);
    assert.equal(r.answers[0].value, "600112233");
    assert.deepEqual(r.destinos, { phone: "600112233" });
  });

  it("lo que no son 9 dígitos: «El teléfono debe tener 9 dígitos.»", () => {
    assert.equal(error1(tel, "12345"), "El teléfono debe tener 9 dígitos.");
    assert.equal(error1(tel, "llámame"), "El teléfono debe tener 9 dígitos.");
  });
});

describe("validarRespuestas (formulario): DNI / NIE del tutor", () => {
  const dni = { type: "dni", mapTo: "taxId" };

  it("un DNI con la letra bien pasa, en mayúsculas y sin espacios ni guiones, y sube a destinos.taxId", () => {
    const r = valida(dni, " 12345678-z ");
    assert.equal(r.ok, true);
    assert.equal(r.answers[0].value, "12345678Z");
    assert.deepEqual(r.destinos, { taxId: "12345678Z" });
    assert.equal(guardado(dni, "00000000T"), "00000000T");
  });

  it("un DNI con la letra mal: «Revisa el DNI: la letra no corresponde con los números.»", () => {
    assert.equal(
      error1(dni, "12345678A"),
      "Revisa el DNI: la letra no corresponde con los números."
    );
  });

  it("un NIE (X/Y/Z + 7 dígitos + letra) se comprueba igual", () => {
    assert.equal(guardado(dni, "x1234567l"), "X1234567L");
    assert.equal(guardado(dni, "Y1234567X"), "Y1234567X");
    assert.match(error1(dni, "X1234567A"), /Revisa el DNI/);
  });

  it("un pasaporte o documento extranjero pasa tal cual: no se deja fuera a una paciente extranjera", () => {
    assert.equal(guardado(dni, "ab123456"), "AB123456");
    assert.equal(guardado(dni, "P-1234567"), "P1234567");
  });

  it("ocho dígitos SIN letra no tienen forma de DNI: pasan tal cual, como un pasaporte (es lo que decide contratoFirma)", () => {
    // Solo se juzga la letra de lo que TIENE forma de DNI o NIE; olvidarse la
    // letra deja el número fuera de esa forma y entra sin aviso.
    assert.equal(guardado(dni, "12345678"), "12345678");
  });
});

describe("validarRespuestas (formulario): número", () => {
  const edad = { type: "number", mapTo: "patientAge", min: 0, max: 99 };

  it("se guarda como TEXTO del número ya normalizado («06» → «6»), y sube a destinos.patientAge", () => {
    const r = valida(edad, " 06 ");
    assert.equal(r.ok, true);
    assert.equal(r.answers[0].value, "6");
    assert.deepEqual(r.destinos, { patientAge: "6" });
    assert.equal(guardado(edad, "6.5"), "6.5");
  });

  it('lo que no es un número: «"…" tiene que ser un número.»', () => {
    assert.equal(error1(edad, "seis"), '"La pregunta" tiene que ser un número.');
    assert.equal(error1(edad, "Infinity"), '"La pregunta" tiene que ser un número.');
  });

  it("SOSPECHOSO: la coma decimal española («6,5») se rechaza como «no es un número» (las preguntas de la cita sí la admiten)", () => {
    assert.equal(error1(edad, "6,5"), '"La pregunta" tiene que ser un número.');
  });

  it("por debajo del min o por encima del max no pasa; los extremos sí", () => {
    assert.equal(error1(edad, "-1"), '"La pregunta" no puede ser menor que 0.');
    assert.equal(error1(edad, "100"), '"La pregunta" no puede ser mayor que 99.');
    assert.equal(guardado(edad, "0"), "0");
    assert.equal(guardado(edad, "99"), "99");
  });

  it("min y max escritos como texto valen igual; sin ellos, vale cualquier número", () => {
    assert.match(error1({ type: "number", min: "0" }, "-1"), /menor que 0/);
    assert.match(error1({ type: "number", max: "99" }, "100"), /mayor que 99/);
    assert.equal(guardado({ type: "number" }, "-5"), "-5");
    assert.equal(guardado({ type: "number" }, "1000"), "1000");
  });

  it("un min o max ilegible («abc») o null explícito no limita nada", () => {
    assert.equal(guardado({ type: "number", min: "abc" }, "-5"), "-5");
    assert.equal(guardado({ type: "number", max: "abc" }, "1000"), "1000");
    assert.equal(guardado({ type: "number", min: null, max: null }, "5"), "5");
  });

  it("es Number() quien decide: «1e2» vale como 100, «0x10» como 16 y «-0» se guarda como «0» (y pasa un min de 0)", () => {
    assert.equal(guardado({ type: "number" }, "1e2"), "100");
    assert.equal(guardado({ type: "number" }, "0x10"), "16");
    assert.equal(guardado(edad, "-0"), "0");
  });

  it("un number no pasa de 12 caracteres escritos, antes siquiera de mirar si es número", () => {
    assert.match(error1({ type: "number" }, "1234567890123"), /no puede pasar de 12/);
  });
});

describe("validarRespuestas (formulario): desplegable (select)", () => {
  const quien = {
    type: "select",
    options: ["Madre", "Padre", "Tutor o tutora legal", RELACION_ES_EL_PACIENTE, "Otro"],
    mapTo: "relationship",
  };

  it("una opción de la lista pasa y sube a destinos.relationship", () => {
    const r = valida(quien, "Madre");
    assert.equal(r.ok, true);
    assert.deepEqual(r.destinos, { relationship: "Madre" });
    assert.equal(guardado(quien, RELACION_ES_EL_PACIENTE), RELACION_ES_EL_PACIENTE);
  });

  it('algo fuera de la lista, o con otras mayúsculas, no: «Elige una opción válida en "…".»', () => {
    assert.equal(error1(quien, "Abuela"), 'Elige una opción válida en "La pregunta".');
    assert.equal(error1(quien, "madre"), 'Elige una opción válida en "La pregunta".');
  });

  it("unas opciones numéricas se comparan como texto", () => {
    assert.equal(guardado({ type: "select", options: [1, 2, 3] }, "2"), "2");
    assert.match(error1({ type: "select", options: [1, 2, 3] }, "4"), /Elige una opción válida/);
  });

  it("un select sin opciones (o con options que no es lista) acepta cualquier texto", () => {
    assert.equal(guardado({ type: "select" }, "lo que sea"), "lo que sea");
    assert.equal(guardado({ type: "select", options: [] }, "lo que sea"), "lo que sea");
    assert.equal(guardado({ type: "select", options: "Madre" }, "lo que sea"), "lo que sea");
  });
});

describe("validarRespuestas (formulario): fecha", () => {
  it("SOSPECHOSO: un campo `date` no comprueba que sea una fecha: «ayer» pasa tal cual", () => {
    // Es el único tipo sin validación de forma. Hoy ningún seed lo usa; si se
    // usa, lo que se guarda es el texto que llegue.
    assert.equal(guardado({ type: "date" }, "ayer"), "ayer");
    assert.equal(guardado({ type: "date" }, "2020-05-01"), "2020-05-01");
  });

  it("su tope por defecto es 20 caracteres", () => {
    assert.match(error1({ type: "date" }, "x".repeat(21)), /no puede pasar de 20/);
  });
});

describe("validarRespuestas (formulario): lo que sube a la ficha (destinos)", () => {
  it("un mapTo de la ficha o de la familia sube; uno inventado o nulo, no", () => {
    const form = {
      fields: [
        { key: "a", label: "A", type: "text", mapTo: "name" },
        { key: "b", label: "B", type: "text", mapTo: "patientName" },
        { key: "c", label: "C", type: "text", mapTo: "apodo" },
        { key: "d", label: "D", type: "text", mapTo: null },
        { key: "e", label: "E", type: "text" },
      ],
    };
    const r = validarRespuestas(form, { a: "Marta", b: "Lucía", c: "Lu", d: "x", e: "y" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.destinos, { name: "Marta", patientName: "Lucía" });
    assert.equal(r.answers.length, 5);
  });

  it("sube el valor NORMALIZADO, no lo tecleado", () => {
    const form = {
      fields: [
        { key: "t", label: "T", type: "tel", mapTo: "phone" },
        { key: "e", label: "E", type: "email", mapTo: "email" },
        { key: "d", label: "D", type: "dni", mapTo: "taxId" },
      ],
    };
    const r = validarRespuestas(form, { t: "600 11 22 33", e: "ANA@X.ES", d: "12345678-z" });
    assert.deepEqual(r.destinos, { phone: "600112233", email: "ana@x.es", taxId: "12345678Z" });
  });

  it("si dos campos apuntan al mismo destino, gana el último en orden", () => {
    const form = {
      fields: [
        { key: "a", label: "A", type: "text", mapTo: "name", order: 2 },
        { key: "b", label: "B", type: "text", mapTo: "name", order: 1 },
      ],
    };
    assert.deepEqual(validarRespuestas(form, { a: "segundo", b: "primero" }).destinos, {
      name: "segundo",
    });
  });
});

describe("validarRespuestas (formulario): la forma del resultado", () => {
  it("recoge TODOS los errores, en el orden de las preguntas, y no devuelve respuestas a medias", () => {
    const form = {
      fields: [
        { key: "n", label: "Nombre", type: "text", required: true, order: 1 },
        { key: "e", label: "Email", type: "email", required: true, order: 2 },
        { key: "t", label: "Teléfono", type: "tel", required: true, order: 3 },
      ],
    };
    const r = validarRespuestas(form, { e: "mal", t: "123" });
    assert.deepEqual(r, {
      ok: false,
      errores: [
        { key: "n", mensaje: '"Nombre" es obligatorio.' },
        { key: "e", mensaje: "El email no parece válido." },
        { key: "t", mensaje: "El teléfono debe tener 9 dígitos." },
      ],
    });
  });

  it("cada respuesta lleva el ENUNCIADO dentro, y van en el orden de `order`, no del cuerpo", () => {
    const form = {
      fields: [
        { key: "b", label: "Segunda", type: "text", order: 2 },
        { key: "a", label: "Primera", type: "text", order: 1 },
      ],
    };
    const r = validarRespuestas(form, { b: "dos", a: "uno" });
    assert.deepEqual(r.answers, [
      { key: "a", label: "Primera", type: "text", value: "uno" },
      { key: "b", label: "Segunda", type: "text", value: "dos" },
    ]);
  });

  it("lo que llega de más en el cuerpo se tira: el endpoint es público", () => {
    const r = validarRespuestas(unCampo({ type: "text" }), { x: "hola", colado: "x", name: "y" });
    assert.equal(r.answers.length, 1);
    assert.deepEqual(r.destinos, {});
  });

  it('un campo sin label se guarda con label ""', () => {
    const r = validarRespuestas({ fields: [{ key: "k", type: "text" }] }, { k: "v" });
    assert.deepEqual(r.answers, [{ key: "k", label: "", type: "text", value: "v" }]);
  });

  it("un cuerpo que no es un objeto (una lista, un número) se trata como vacío", () => {
    const form = unCampo({ type: "text", required: true });
    assert.equal(validarRespuestas(form, ["hola"]).ok, false);
    assert.equal(validarRespuestas(form, 5).ok, false);
    assert.equal(validarRespuestas(form, "hola").ok, false);
  });

  it("SOSPECHOSO: un campo cuya key es un método de Object («toString») lee el prototipo del cuerpo en vez de «nada»", () => {
    // `cuerpo?.[campo.key]` no mira si la clave es propia: con el cuerpo vacío,
    // un campo opcional llamado `toString` se guarda con el texto de la función
    // en vez de "". Hoy no hay constructor de formularios y el seed no usa esos
    // nombres, así que es latente.
    const r = validarRespuestas({ fields: [{ key: "toString", label: "T", type: "text" }] }, {});
    assert.equal(r.ok, true);
    assert.match(r.answers[0].value, /^function toString/);
  });
});

describe("el formulario de familias de Aumenta, de punta a punta", () => {
  it("una madre que rellena todo: ok, ocho respuestas, siete destinos y el consentimiento con su texto", () => {
    const r = validarRespuestas(FORM_FAMILIAS, RESPUESTA_MADRE);
    assert.equal(r.ok, true);
    assert.equal(r.answers.length, 8);
    assert.deepEqual(r.destinos, {
      name: "Marta Ruiz Gómez",
      relationship: "Madre",
      patientName: "Lucía Ruiz Pérez",
      patientAge: "6",
      reason: "Le cuesta concentrarse en clase.",
      phone: "600111222",
      email: "marta@example.com",
    });
    assert.deepEqual(r.consentimiento, { texto: "He leído y acepto la política de privacidad." });
  });

  it('«soy yo quien necesita ayuda» sin peque ni edad: pasa, y las dos opcionales van con value "" sin destino', () => {
    const r = validarRespuestas(FORM_FAMILIAS, {
      ...RESPUESTA_MADRE,
      parentesco: RELACION_ES_EL_PACIENTE,
      nombrePeque: "",
      edadPeque: "",
    });
    assert.equal(r.ok, true);
    assert.equal(r.destinos.relationship, RELACION_ES_EL_PACIENTE);
    assert.equal("patientName" in r.destinos, false);
    assert.equal("patientAge" in r.destinos, false);
    assert.equal(r.answers.find((a) => a.key === "nombrePeque").value, "");
    assert.equal(r.answers.find((a) => a.key === "edadPeque").value, "");
  });

  it("sin aceptar la privacidad no entra, y lo dice junto a lo demás que falte", () => {
    const r = validarRespuestas(FORM_FAMILIAS, {
      ...RESPUESTA_MADRE,
      consentimiento: false,
      motivo: "",
    });
    assert.equal(r.ok, false);
    assert.deepEqual(
      r.errores.map((e) => e.key),
      ["motivo", "consentimiento"]
    );
  });

  it("una edad de 999 no pasa (max 99) en vez de llegar a la ficha", () => {
    const r = validarRespuestas(FORM_FAMILIAS, { ...RESPUESTA_MADRE, edadPeque: "999" });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errores, [
      { key: "edadPeque", mensaje: '"¿Cuántos años tiene?" no puede ser mayor que 99.' },
    ]);
  });
});

describe("infoAdicional: «lo que nos contó», palabra por palabra", () => {
  const answers = (form, cuerpo) => validarRespuestas(form, cuerpo).answers;

  it('sin respuestas (null, []) devuelve ""', () => {
    assert.equal(infoAdicional(FORM_FAMILIAS, null), "");
    assert.equal(infoAdicional(FORM_FAMILIAS, []), "");
    assert.equal(infoAdicional(FORM_FAMILIAS, undefined), "");
  });

  it("excluye lo que ya sube a la FICHA (nombre, email, teléfono, motivo…) y el consentimiento", () => {
    const texto = infoAdicional(FORM_FAMILIAS, answers(FORM_FAMILIAS, RESPUESTA_MADRE));
    assert.doesNotMatch(texto, /Marta/);
    assert.doesNotMatch(texto, /marta@example\.com/);
    assert.doesNotMatch(texto, /600111222/);
    assert.doesNotMatch(texto, /concentrarse/);
    assert.doesNotMatch(texto, /política de privacidad/);
  });

  it("pero INCLUYE lo del peque y el parentesco (destinos de familia): donde no hay módulo `pacientes` es el único sitio donde quedan", () => {
    const texto = infoAdicional(FORM_FAMILIAS, answers(FORM_FAMILIAS, RESPUESTA_MADRE));
    assert.equal(
      texto,
      "¿Quién eres?:\nMadre\n\n¿Cómo se llama el paciente?:\nLucía Ruiz Pérez\n\n¿Cuántos años tiene?:\n6"
    );
  });

  it("el formato es «Pregunta:\\nRespuesta», separadas por una línea en blanco; las vacías no salen", () => {
    const form = {
      fields: [
        { key: "a", label: "Primera", type: "text" },
        { key: "b", label: "Segunda", type: "text" },
        { key: "c", label: "Tercera", type: "text" },
      ],
    };
    assert.equal(
      infoAdicional(form, answers(form, { a: "uno", b: "", c: "tres" })),
      "Primera:\nuno\n\nTercera:\ntres"
    );
  });

  it("una respuesta en blanco o solo espacios no sale, aunque se la den directamente", () => {
    const form = { fields: [{ key: "a", label: "A", type: "text" }] };
    assert.equal(infoAdicional(form, [{ key: "a", label: "A", type: "text", value: "   " }]), "");
    assert.equal(infoAdicional(form, [{ key: "a", label: "A", type: "text", value: null }]), "");
  });

  it("una casilla marcada o sin marcar («Sí»/«No») SÍ sale: es información", () => {
    const form = { fields: [{ key: "t", label: "¿Terapia antes?", type: "checkbox" }] };
    assert.equal(infoAdicional(form, answers(form, { t: true })), "¿Terapia antes?:\nSí");
    assert.equal(infoAdicional(form, answers(form, {})), "¿Terapia antes?:\nNo");
  });

  it("una respuesta de una pregunta que ya no está en el formulario (se borró) sigue saliendo: el histórico no miente", () => {
    const form = { fields: [{ key: "a", label: "A", type: "text" }] };
    const viejas = [{ key: "borrada", label: "¿Qué tal?", type: "text", value: "bien" }];
    assert.equal(infoAdicional(form, viejas), "¿Qué tal?:\nbien");
  });

  it("un mapTo que no está en DESTINOS no cuenta como destino: la respuesta no se cae de los dos sitios", () => {
    const form = { fields: [{ key: "a", label: "Apodo", type: "text", mapTo: "apodo" }] };
    const r = validarRespuestas(form, { a: "Lu" });
    assert.deepEqual(r.destinos, {});
    assert.equal(infoAdicional(form, r.answers), "Apodo:\nLu");
  });

  it("sin formulario (null), todo lo que haya en answers sale", () => {
    assert.equal(
      infoAdicional(null, [{ key: "n", label: "Nombre", type: "text", value: "Marta" }]),
      "Nombre:\nMarta"
    );
  });
});

describe("formPublico: lo que viaja a la pantalla pública", () => {
  it("no lleva `settings` (ahí están los correos internos de aviso); solo sube privacyUrl", () => {
    const pub = formPublico(FORM_FAMILIAS);
    assert.equal("settings" in pub, false);
    assert.equal(pub.privacyUrl, "https://example.com/privacidad");
    assert.equal(JSON.stringify(pub).includes("interno@example.com"), false);
  });

  it("los campos no llevan mapTo ni order: el público no tiene por qué saber a dónde va cada cosa", () => {
    const pub = formPublico(FORM_FAMILIAS);
    for (const f of pub.fields) {
      assert.equal("mapTo" in f, false);
      assert.equal("order" in f, false);
    }
  });

  it("rellena los textos por defecto cuando el formulario no los trae", () => {
    const pub = formPublico({ slug: "s", title: "T", fields: [] });
    assert.deepEqual(pub, {
      slug: "s",
      title: "T",
      introText: null,
      submitLabel: "Enviar",
      thankYouMessage: "¡Gracias! Hemos recibido tu solicitud.",
      privacyUrl: null,
      fields: [],
    });
  });

  it("y respeta los que trae", () => {
    const pub = formPublico({
      slug: "s",
      title: "T",
      introText: "Hola",
      submitLabel: "Mandar",
      thankYouMessage: "Recibido",
      settings: { privacyUrl: "https://x.es/p" },
      fields: [],
    });
    assert.equal(pub.introText, "Hola");
    assert.equal(pub.submitLabel, "Mandar");
    assert.equal(pub.thankYouMessage, "Recibido");
    assert.equal(pub.privacyUrl, "https://x.es/p");
  });

  it("un campo sale con la forma exacta: sin placeholder/help/link → null, sin options → [], min/max → null", () => {
    const pub = formPublico({
      fields: [{ key: "n", label: "Nombre", type: "text", required: true }],
    });
    assert.deepEqual(pub.fields, [
      {
        key: "n",
        label: "Nombre",
        type: "text",
        required: true,
        placeholder: null,
        help: null,
        options: [],
        maxLength: 200,
        min: null,
        max: null,
        linkUrl: null,
        linkLabel: null,
      },
    ]);
  });

  it("unas options que no son lista (texto, null) viajan como []; una lista viaja tal cual, sin tocar", () => {
    const pub = formPublico({
      fields: [
        { key: "a", type: "select", options: "Madre,Padre" },
        { key: "b", type: "select", options: null },
        { key: "c", type: "select", options: [1, "dos"] },
      ],
    });
    assert.deepEqual(
      pub.fields.map((f) => f.options),
      [[], [], [1, "dos"]]
    );
  });

  it("un min de 0 NO se pierde (sería lo que pasaría con un `||`)", () => {
    const pub = formPublico({
      fields: [{ key: "e", label: "Edad", type: "number", min: 0, max: 99 }],
    });
    assert.equal(pub.fields[0].min, 0);
    assert.equal(pub.fields[0].max, 99);
  });

  it("required: sin declarar o true → true; false → false", () => {
    const pub = formPublico({
      fields: [
        { key: "a", type: "text" },
        { key: "b", type: "text", required: true },
        { key: "c", type: "text", required: false },
      ],
    });
    assert.deepEqual(
      pub.fields.map((f) => f.required),
      [true, true, false]
    );
  });

  it("maxLength: el declarado manda; si no, el del tipo; checkbox y consent caen a 500", () => {
    const pub = formPublico({
      fields: [
        { key: "a", type: "text", maxLength: 120 },
        { key: "b", type: "text" },
        { key: "c", type: "textarea" },
        { key: "d", type: "tel" },
        { key: "e", type: "dni" },
        { key: "f", type: "email" },
        { key: "g", type: "select" },
        { key: "h", type: "date" },
        { key: "i", type: "number" },
        { key: "j", type: "checkbox" },
        { key: "k", type: "consent" },
        { key: "l", type: "text", maxLength: 0 },
      ],
    });
    assert.deepEqual(
      pub.fields.map((f) => f.maxLength),
      [120, 200, 1000, 30, 30, 160, 120, 20, 12, 500, 500, 200]
    );
  });

  it("los campos pasan por camposDe: ordenados y sin basura", () => {
    const pub = formPublico({
      fields: [
        { key: "b", type: "text", order: 2 },
        { key: "a", type: "text", order: 1 },
        { key: "z", type: "video" },
        null,
      ],
    });
    assert.deepEqual(
      pub.fields.map((f) => f.key),
      ["a", "b"]
    );
  });

  it("el consentimiento viaja con su enlace y su rótulo", () => {
    const pub = formPublico(FORM_FAMILIAS);
    const c = pub.fields.find((f) => f.type === "consent");
    assert.equal(c.linkUrl, "https://example.com/privacidad");
    assert.equal(c.linkLabel, "política de privacidad");
    assert.equal(c.required, true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * lib/citas/preguntasCita.js
 * ══════════════════════════════════════════════════════════════════════════ */

describe("las preguntas de la cita: cuatro clases y no más", () => {
  it("son numero, escala, corto y largo, cada una con su rótulo para el panel", () => {
    assert.deepEqual(TIPOS_CITA, ["numero", "escala", "corto", "largo"]);
    for (const t of TIPOS_CITA) assert.ok(ETIQUETA_TIPO[t], `falta el rótulo de ${t}`);
    assert.equal(ESCALA_POR_DEFECTO, 5);
    assert.equal(MAX_PREGUNTAS, 12);
  });
});

describe("normalizarPreguntas: lo que llega del panel o de JSONB, sin guardar nada roto", () => {
  it("con algo que no es una lista (null, undefined, texto, objeto) devuelve []", () => {
    assert.deepEqual(normalizarPreguntas(null), []);
    assert.deepEqual(normalizarPreguntas(undefined), []);
    assert.deepEqual(normalizarPreguntas("peso"), []);
    assert.deepEqual(normalizarPreguntas({ label: "X" }), []);
  });

  it("los elementos que no son objetos se saltan", () => {
    assert.deepEqual(
      normalizarPreguntas([null, "texto", 3, { label: "Bien" }]).map((p) => p.label),
      ["Bien"]
    );
  });

  it("una pregunta sin enunciado (ausente, vacío, espacios) no es una pregunta", () => {
    assert.deepEqual(normalizarPreguntas([{ type: "corto" }, { label: "" }, { label: "   " }]), []);
  });

  it("una pregunta mínima sale con la forma exacta: id posicional, tipo corto, no obligatoria, sin help", () => {
    assert.deepEqual(normalizarPreguntas([{ label: "  ¿Cómo te encuentras?  " }]), [
      { id: "p1", label: "¿Cómo te encuentras?", type: "corto", required: false },
    ]);
  });

  it("un tipo inventado o ausente cae a «corto»; los cuatro válidos se conservan", () => {
    const out = normalizarPreguntas([
      { label: "a", type: "video" },
      { label: "b" },
      { label: "c", type: "numero" },
      { label: "d", type: "escala" },
      { label: "e", type: "corto" },
      { label: "f", type: "largo" },
    ]);
    assert.deepEqual(
      out.map((p) => p.type),
      ["corto", "corto", "numero", "escala", "corto", "largo"]
    );
  });

  it('required solo cuenta si es exactamente true (ni "true" ni 1)', () => {
    const out = normalizarPreguntas([
      { label: "a", required: true },
      { label: "b", required: "true" },
      { label: "c", required: 1 },
      { label: "d" },
    ]);
    assert.deepEqual(
      out.map((p) => p.required),
      [true, false, false, false]
    );
  });

  it("el id se conserva si viene; si no, se genera por posición en la SALIDA (la descartada no cuenta)", () => {
    const out = normalizarPreguntas([
      { label: "" },
      { label: "X" },
      { id: "peso", label: "Y" },
      { label: "Z" },
    ]);
    assert.deepEqual(
      out.map((p) => p.id),
      ["p1", "peso", "p3"]
    );
  });

  it("un id repetido no pisa al primero: al segundo se le da uno posicional", () => {
    assert.deepEqual(
      normalizarPreguntas([
        { id: "a", label: "1" },
        { id: "a", label: "2" },
      ]).map((p) => p.id),
      ["a", "p2"]
    );
  });

  it("si el posicional también está cogido, se le cuelga un guion bajo hasta que sea único", () => {
    assert.deepEqual(
      normalizarPreguntas([
        { id: "p2", label: "1" },
        { id: "p2", label: "2" },
      ]).map((p) => p.id),
      ["p2", "p2_"]
    );
  });

  it("enunciado y ayuda se recortan a 300; el id a 40; los espacios de los extremos fuera", () => {
    const [p] = normalizarPreguntas([
      {
        id: " " + "i".repeat(50) + " ",
        label: "L".repeat(400),
        help: "  " + "h".repeat(400) + "  ",
      },
    ]);
    assert.equal(p.id, "i".repeat(40));
    assert.equal(p.label, "L".repeat(300));
    assert.equal(p.help, "h".repeat(300));
  });

  it("la ayuda solo existe si tiene texto", () => {
    assert.equal("help" in normalizarPreguntas([{ label: "X", help: "   " }])[0], false);
    assert.equal(normalizarPreguntas([{ label: "X", help: " pista " }])[0].help, "pista");
  });

  it("la escala coge 5 si no dice max; admite de 2 a 10 y fuera de ahí vuelve a 5", () => {
    const max = (m) => normalizarPreguntas([{ label: "X", type: "escala", max: m }])[0].max;
    assert.equal(max(undefined), 5);
    assert.equal(max(2), 2);
    assert.equal(max(10), 10);
    assert.equal(max(1), 5);
    assert.equal(max(11), 5);
    assert.equal(max(99), 5);
    assert.equal(max(7.5), 5);
    assert.equal(max("abc"), 5);
  });

  it("un max escrito como texto «7» vale como 7", () => {
    assert.equal(normalizarPreguntas([{ label: "X", type: "escala", max: "7" }])[0].max, 7);
  });

  it("las que no son escala no llevan max aunque se lo den", () => {
    const [p] = normalizarPreguntas([{ label: "X", type: "numero", max: 7 }]);
    assert.equal("max" in p, false);
  });

  it(`no se guardan más de ${MAX_PREGUNTAS}, contando solo las que valen`, () => {
    const treinta = Array.from({ length: 30 }, (_, i) => ({ label: `P${i}` }));
    assert.equal(normalizarPreguntas(treinta).length, MAX_PREGUNTAS);
    const conBasuraDelante = [{ label: "" }, null, ...treinta];
    const out = normalizarPreguntas(conBasuraDelante);
    assert.equal(out.length, MAX_PREGUNTAS);
    assert.equal(out[0].label, "P0");
    assert.equal(out[MAX_PREGUNTAS - 1].label, `P${MAX_PREGUNTAS - 1}`);
  });
});

const PREGUNTAS = [
  { id: "peso", label: "¿Cuánto pesas?", type: "numero", required: true },
  { id: "animo", label: "¿Cómo te encuentras?", type: "escala", max: 5, required: true },
  { id: "nota", label: "Algo que quieras contarme", type: "largo", required: false },
];

describe("validarRespuestas (cita): lo que contesta quien reserva", () => {
  it("sin preguntas (null, [], o solo preguntas sin enunciado) pasa con respuestas []", () => {
    assert.deepEqual(validarRespuestasCita(null, { a: 1 }), { ok: true, respuestas: [] });
    assert.deepEqual(validarRespuestasCita([], {}), { ok: true, respuestas: [] });
    assert.deepEqual(validarRespuestasCita([{ label: "" }], {}), { ok: true, respuestas: [] });
  });

  it("una entrada que no es un objeto (null, texto) se trata como vacía", () => {
    assert.deepEqual(validarRespuestasCita(PREGUNTAS, null), {
      ok: false,
      error: "Falta contestar «¿Cuánto pesas?»",
    });
    assert.deepEqual(validarRespuestasCita(PREGUNTAS, "x"), {
      ok: false,
      error: "Falta contestar «¿Cuánto pesas?»",
    });
    assert.deepEqual(validarRespuestasCita([{ label: "Opcional" }], null), {
      ok: true,
      respuestas: [],
    });
  });

  it("una obligatoria sin contestar (ausente, null, vacío, espacios) frena: «Falta contestar «…»»", () => {
    for (const v of [undefined, null, "", "   "]) {
      assert.deepEqual(
        validarRespuestasCita(PREGUNTAS, { peso: v, animo: 3 }),
        { ok: false, error: "Falta contestar «¿Cuánto pesas?»" },
        `con ${JSON.stringify(v)}`
      );
    }
  });

  it("se para en el PRIMER error, en el orden de las preguntas", () => {
    assert.equal(validarRespuestasCita(PREGUNTAS, {}).error, "Falta contestar «¿Cuánto pesas?»");
    assert.equal(
      validarRespuestasCita(PREGUNTAS, { peso: 60 }).error,
      "Falta contestar «¿Cómo te encuentras?»"
    );
  });

  it("una opcional sin contestar no se guarda (no hay respuesta vacía)", () => {
    const r = validarRespuestasCita(PREGUNTAS, { peso: 60, animo: 3 });
    assert.equal(r.ok, true);
    assert.deepEqual(
      r.respuestas.map((x) => x.id),
      ["peso", "animo"]
    );
  });

  it("numero: admite coma y punto decimal, espacios y el número como tal; se guarda como NÚMERO", () => {
    const peso = (v) => validarRespuestasCita(PREGUNTAS, { peso: v, animo: 3 }).respuestas[0].valor;
    assert.equal(peso("60,5"), 60.5);
    assert.equal(peso("60.5"), 60.5);
    assert.equal(peso(" 60 "), 60);
    assert.equal(peso(60), 60);
  });

  it("numero: el 0 es una respuesta, no un vacío", () => {
    const r = validarRespuestasCita(PREGUNTAS, { peso: 0, animo: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.respuestas[0].valor, 0);
    assert.equal(validarRespuestasCita(PREGUNTAS, { peso: "0", animo: 3 }).respuestas[0].valor, 0);
  });

  it("numero: lo que no es número frena: «…» tiene que ser un número", () => {
    assert.equal(
      validarRespuestasCita(PREGUNTAS, { peso: "bastante", animo: 3 }).error,
      "«¿Cuánto pesas?» tiene que ser un número"
    );
    assert.equal(
      validarRespuestasCita(PREGUNTAS, { peso: "Infinity", animo: 3 }).error,
      "«¿Cuánto pesas?» tiene que ser un número"
    );
  });

  it("escala: del 1 al max, enteros; como número o como texto «3»", () => {
    const animo = (v) => validarRespuestasCita(PREGUNTAS, { peso: 60, animo: v });
    assert.equal(animo(1).respuestas[1].valor, 1);
    assert.equal(animo(5).respuestas[1].valor, 5);
    assert.equal(animo("3").respuestas[1].valor, 3);
    for (const v of [0, 6, 7, 2.5, "tres", -1]) {
      assert.deepEqual(
        animo(v),
        { ok: false, error: "«¿Cómo te encuentras?» tiene que ser del 1 al 5" },
        `con ${JSON.stringify(v)}`
      );
    }
  });

  it("escala: el tope es el de ESA pregunta (una de 10 admite el 10 y rechaza el 11)", () => {
    const diez = [{ id: "d", label: "Dolor", type: "escala", max: 10, required: true }];
    assert.equal(validarRespuestasCita(diez, { d: 10 }).respuestas[0].valor, 10);
    assert.equal(validarRespuestasCita(diez, { d: 11 }).error, "«Dolor» tiene que ser del 1 al 10");
  });

  it("escala: si la pregunta no trae max (ya normalizada a 5), el tope es 5", () => {
    const sinMax = [{ id: "a", label: "Ánimo", type: "escala" }];
    assert.equal(validarRespuestasCita(sinMax, { a: 5 }).ok, true);
    assert.equal(validarRespuestasCita(sinMax, { a: 6 }).error, "«Ánimo» tiene que ser del 1 al 5");
  });

  it("corto se recorta a 200 y largo a 2000, sin espacios en los extremos", () => {
    const dos = [
      { id: "c", label: "Corto", type: "corto" },
      { id: "l", label: "Largo", type: "largo" },
    ];
    const r = validarRespuestasCita(dos, { c: "  " + "x".repeat(300) + "  ", l: "y".repeat(3000) });
    assert.equal(r.respuestas[0].valor.length, 200);
    assert.equal(r.respuestas[1].valor.length, 2000);
    assert.equal(validarRespuestasCita(dos, { c: "  gracias  " }).respuestas[0].valor, "gracias");
  });

  it("un texto que llega como número se guarda como texto", () => {
    const r = validarRespuestasCita([{ id: "c", label: "Corto", type: "corto" }], { c: 42 });
    assert.deepEqual(r.respuestas, [{ id: "c", label: "Corto", type: "corto", valor: "42" }]);
  });

  it("SOSPECHOSO: un objeto o una lista en un texto no se rechaza: se guarda «[object Object]» o «x,y» (igual que en el formulario)", () => {
    const corto = [{ id: "c", label: "Corto", type: "corto" }];
    assert.equal(
      validarRespuestasCita(corto, { c: { x: 1 } }).respuestas[0].valor,
      "[object Object]"
    );
    assert.equal(validarRespuestasCita(corto, { c: ["x", "y"] }).respuestas[0].valor, "x,y");
  });

  it("numero: «1.000,5» (con punto de miles) no es un número, y un booleano tampoco", () => {
    const peso = (v) => validarRespuestasCita(PREGUNTAS, { peso: v, animo: 3 });
    assert.equal(peso("1.000,5").error, "«¿Cuánto pesas?» tiene que ser un número");
    assert.equal(peso(true).error, "«¿Cuánto pesas?» tiene que ser un número");
  });

  it("escala: «3.0» y « 3 » valen como 3 (Number los entiende); «3,5» no", () => {
    const animo = (v) => validarRespuestasCita(PREGUNTAS, { peso: 60, animo: v });
    assert.equal(animo("3.0").respuestas[1].valor, 3);
    assert.equal(animo(" 3 ").respuestas[1].valor, 3);
    assert.equal(animo("3,5").error, "«¿Cómo te encuentras?» tiene que ser del 1 al 5");
  });

  it("cada respuesta lleva el enunciado y el tipo: dentro de un año se lee como se preguntó", () => {
    const r = validarRespuestasCita(PREGUNTAS, { peso: "60,5", animo: 4, nota: " gracias " });
    assert.deepEqual(r, {
      ok: true,
      respuestas: [
        { id: "peso", label: "¿Cuánto pesas?", type: "numero", valor: 60.5 },
        { id: "animo", label: "¿Cómo te encuentras?", type: "escala", valor: 4 },
        { id: "nota", label: "Algo que quieras contarme", type: "largo", valor: "gracias" },
      ],
    });
  });

  it("lo que llega de más se tira: el endpoint es público", () => {
    const r = validarRespuestasCita(PREGUNTAS, { peso: 60, animo: 4, colado: "x", id: "y" });
    assert.deepEqual(
      r.respuestas.map((x) => x.id),
      ["peso", "animo"]
    );
  });

  it("las preguntas se normalizan antes de validar: a una sin id se le busca la respuesta por su id posicional", () => {
    const r = validarRespuestasCita([{ label: "¿Duermes bien?", type: "corto", required: true }], {
      p1: "regular",
    });
    assert.deepEqual(r, {
      ok: true,
      respuestas: [{ id: "p1", label: "¿Duermes bien?", type: "corto", valor: "regular" }],
    });
  });
});

describe("paquetePreguntas: lo que se guarda en bookings.form_answers", () => {
  it("sin preguntas, paquete null", () => {
    assert.deepEqual(paquetePreguntas([], {}), { ok: true, paquete: null });
    assert.deepEqual(paquetePreguntas(null, null), { ok: true, paquete: null });
  });

  it("todas opcionales y ninguna contestada: también null (no se guarda un paquete vacío)", () => {
    assert.deepEqual(paquetePreguntas([{ id: "n", label: "Nota", type: "largo" }], {}), {
      ok: true,
      paquete: null,
    });
  });

  it("un error de validación sale tal cual, sin paquete", () => {
    assert.deepEqual(paquetePreguntas(PREGUNTAS, { animo: 3 }), {
      ok: false,
      error: "Falta contestar «¿Cuánto pesas?»",
    });
  });

  it("con respuestas, el paquete lleva las respuestas y un submittedAt en ISO UTC de ahora mismo", () => {
    const antes = Date.now();
    const r = paquetePreguntas(PREGUNTAS, { peso: 60, animo: 4, nota: "  gracias  " });
    const despues = Date.now();
    assert.equal(r.ok, true);
    assert.deepEqual(r.paquete.respuestas, [
      { id: "peso", label: "¿Cuánto pesas?", type: "numero", valor: 60 },
      { id: "animo", label: "¿Cómo te encuentras?", type: "escala", valor: 4 },
      { id: "nota", label: "Algo que quieras contarme", type: "largo", valor: "gracias" },
    ]);
    assert.match(r.paquete.submittedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const t = Date.parse(r.paquete.submittedAt);
    assert.ok(
      t >= antes - 1000 && t <= despues + 1000,
      `submittedAt ${r.paquete.submittedAt} no es de ahora`
    );
    assert.deepEqual(Object.keys(r.paquete), ["respuestas", "submittedAt"]);
  });
});
