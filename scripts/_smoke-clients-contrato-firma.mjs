// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-clients-contrato-firma.mjs — qué hace falta para firmar el contrato
 * del centro, quién es menor y cómo viaja la plantilla al portal (19/08/2026).
 *
 *   node scripts/_smoke-clients-contrato-firma.mjs
 *   node --test-name-pattern="edadEn" scripts/_smoke-clients-contrato-firma.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * `lib/clients/contratoFirma.js` es lo que comparten el endpoint de firma del
 * portal, el de «Completa tus datos» y el generador del PDF: qué campos pide
 * una plantilla, cuáles son válidos, qué documentos le tocan a una ficha y si
 * hace falta el consentimiento del tutor. De aquí salieron tres fallos reales
 * en agosto de 2026: el DNI bloqueaba a las menores de 14 (no tienen el deber
 * de tenerlo), el consentimiento parental aparecía a MITAD de la firma porque
 * la fecha de nacimiento se sabía tarde, y aceptar el contrato arrastraba a
 * los anexos cuando «se firman de forma independiente».
 *
 * Lo que había eran tres smokes con `check()` —una de ellas pesada, que crea
 * fichas en la base— y ninguna cubría los bordes de la edad: el día del
 * cumpleaños, el 29 de febrero, una fecha ilegible, una referencia con desfase
 * horario. Esta prueba fija lo que DEVUELVE cada función:
 *
 *   · `letraDocumentoCorrecta`: DNI y NIE con su letra; lo que no lo parece
 *     (pasaporte) no se juzga —rechazarlo dejaría sin firmar a una extranjera—;
 *   · `edadEn` / `esMenor`: años cumplidos contados en fecha UTC, y «no lo sé»
 *     cuenta como mayor a propósito —incluida una fecha FUTURA, que hasta el
 *     21/08/2026 daba años en negativo y le exigía a una adulta el
 *     consentimiento de su tutor (el defecto que sacó esta misma prueba);
 *   · `camposDe` / `bloquesDe` / `serializarPlantilla`: la plantilla JSONB se
 *     normaliza con sus valores por defecto y viaja al portal ya resuelta
 *     contra la ficha (lo que la ficha tiene no se vuelve a preguntar);
 *   · `validarDatos`: qué entra, qué se rechaza y con qué frase, que lo que la
 *     plantilla no declara se tira, que una fecha de nacimiento futura no llega
 *     ni a la ficha (y la de la firma sí puede ir por delante), y que el DNI
 *     deja de ser obligatorio por edad con la fecha que SE ESTÁ ESCRIBIENDO
 *     antes que con la guardada;
 *   · `documentosQueAplican` / `situacionDocumentos`: el consentimiento
 *     parental solo sale para menores, y el contrato no está completo hasta
 *     que TODOS los firmantes han firmado TODO lo que les aplica;
 *   · `validarAceptaciones`: cada anexo se acepta por separado y la foto de lo
 *     aceptado lleva id, título y hora.
 *
 * Las fechas que dependen de «hoy» (la edad para el DNI, si una ficha es menor)
 * se construyen a 10 y a 40 años de distancia, en enero, para que no caduquen
 * ni cambien con la zona horaria; los bordes de la edad se prueban con
 * referencias UTC explícitas. Si algo devuelve lo que NO se esperaría, el `it`
 * lo dice igual y lleva un `// SOSPECHOSO:` delante: aquí se fija lo que hay.
 *
 * Forma: `node:test` + `node:assert/strict`, como `_smoke-citas-dinero.mjs`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FIELD_TYPES,
  letraDocumentoCorrecta,
  edadEn,
  esMenor,
  camposDe,
  bloquesDe,
  serializarPlantilla,
  validarDatos,
  documentosQueAplican,
  situacionDocumentos,
  validarAceptaciones,
} from "../lib/clients/contratoFirma.js";

/* ── Fechas ───────────────────────────────────────────────────────────────── */

// Referencia fija para los bordes: el 4 de agosto de 2026 a medianoche UTC.
const REF = new Date(Date.UTC(2026, 7, 4));

// Lo que depende de «hoy» (edadDesde mira el reloj) va lejos de los 14 y los
// 18: una nacida hace 10 años y otra hace 40, el 1 de enero. Cualquier zona
// horaria y cualquier día del año dan 9–10 y 39–40: los dos lados se conservan.
const ANO = new Date().getUTCFullYear();
const NACIDA_HACE = (n) => `${ANO - n}-01-01`;
const MENOR = NACIDA_HACE(10);
const MAYOR = NACIDA_HACE(40);
// El dedo en el año al teclear («2086» por «1986»): sesenta años por delante,
// lo bastante lejos para que siga siendo futuro con cualquier zona horaria.
const FUTURA = NACIDA_HACE(-60);

/* ── Una plantilla como la de tunutrilaura, reducida ─────────────────────── */

const CAMPOS = [
  { key: "nombre", label: "Nombre y apellidos", type: "text", ficha: "cliente.name" },
  {
    key: "dni",
    label: "DNI / NIE",
    type: "dni",
    ficha: "cliente.taxId",
    requiredDesdeEdad: 14,
  },
  {
    key: "fechaNacimiento",
    label: "Fecha de nacimiento",
    type: "date",
    ficha: "cliente.birthDate",
    previo: true,
  },
  { key: "domicilio", label: "Domicilio", type: "text", ficha: "cliente.customFields.domicilio" },
  { key: "email", label: "Correo", type: "email", ficha: "cliente.email" },
  { key: "telefono", label: "Teléfono", type: "tel", ficha: "cliente.phone" },
  { key: "lugarFirma", label: "Localidad de la firma", type: "text" },
  { key: "fechaFirma", label: "Fecha de la firma", type: "date" },
];

const BLOQUES = [
  { id: "contrato", title: "Contrato", body: "Cláusulas." },
  { id: "anexo1", title: "Anexo I", body: "Protección de datos." },
  { id: "anexo2", title: "Anexo II", body: "Consentimiento informado." },
  { id: "anexo3", title: "Anexo III", body: "Comunicaciones comerciales.", required: false },
];

const PLANTILLA = {
  key: "paciente",
  title: "Contrato de acompañamiento",
  fields: CAMPOS,
  blocks: BLOQUES,
};

const DATOS_OK = {
  nombre: "Paciente De Prueba",
  dni: "12345678Z", // 12345678 % 23 = 14 → Z
  fechaNacimiento: MAYOR,
  domicilio: "Calle Falsa 123, Barcelona",
  email: "paciente@example.com",
  telefono: "600123456",
  lugarFirma: "Barcelona",
  fechaFirma: "2026-08-04",
};

const PACIENTE = { key: "paciente", title: "Contrato" };
const PARENTAL = { key: "parental", title: "Consentimiento parental", onlyMinors: true };
const TITULAR = { id: "c-1", titular: true, name: "Ana" };
const MADRE = { id: "g-1", name: "Carmen" };
const PADRE = { id: "g-2", name: "Javier" };

const firma = (guardianId, templateKey, extra = {}) => ({ guardianId, templateKey, ...extra });
const claves = (lista) => lista.map((p) => p.key);

/* ── letraDocumentoCorrecta ──────────────────────────────────────────────── */

describe("letraDocumentoCorrecta: solo se juzga la letra de lo que parece DNI o NIE", () => {
  it("un DNI con su letra, sí; con otra letra, no", () => {
    assert.equal(letraDocumentoCorrecta("12345678Z"), true);
    assert.equal(letraDocumentoCorrecta("00000000T"), true);
    assert.equal(letraDocumentoCorrecta("12345678A"), false);
  });

  it("minúsculas, espacios y guiones no cambian la cuenta", () => {
    assert.equal(letraDocumentoCorrecta("12345678z"), true);
    assert.equal(letraDocumentoCorrecta(" 12345678-Z "), true);
    assert.equal(letraDocumentoCorrecta("12345678 Z"), true);
    assert.equal(letraDocumentoCorrecta("x1234567l"), true);
  });

  it("un NIE que empieza por X, Y o Z cuenta con 0, 1 o 2 delante", () => {
    assert.equal(letraDocumentoCorrecta("X1234567L"), true);
    assert.equal(letraDocumentoCorrecta("Y1234567X"), true);
    assert.equal(letraDocumentoCorrecta("Z1234567R"), true);
    assert.equal(letraDocumentoCorrecta("X1234567A"), false);
  });

  it("un pasaporte o un documento extranjero no se juzga: null (se acepta tal cual)", () => {
    assert.equal(letraDocumentoCorrecta("AB123456"), null);
    assert.equal(letraDocumentoCorrecta("PA0123456"), null);
  });

  it("siete u nueve dígitos no tienen forma de DNI: null, no false", () => {
    assert.equal(letraDocumentoCorrecta("1234567Z"), null);
    assert.equal(letraDocumentoCorrecta("123456789Z"), null);
  });

  it("vacío, null o undefined: null", () => {
    assert.equal(letraDocumentoCorrecta(""), null);
    assert.equal(letraDocumentoCorrecta(null), null);
    assert.equal(letraDocumentoCorrecta(undefined), null);
  });
});

/* ── edadEn ──────────────────────────────────────────────────────────────── */

describe("edadEn: años cumplidos en la fecha de referencia, contados en UTC", () => {
  it("una nacida el 14/05/1990 tiene 36 el 04/08/2026", () => {
    assert.equal(edadEn("1990-05-14", REF), 36);
  });

  it("el día del cumpleaños ya se ha cumplido: nacida el 04/08/2008 tiene 18 el 04/08/2026", () => {
    assert.equal(edadEn("2008-08-04", REF), 18);
  });

  it("un día antes del cumpleaños todavía no: nacida el 05/08/2008 tiene 17 el 04/08/2026", () => {
    assert.equal(edadEn("2008-08-05", REF), 17);
  });

  it("un día después, sí: nacida el 03/08/2008 tiene 18", () => {
    assert.equal(edadEn("2008-08-03", REF), 18);
  });

  it("a las 23:59:59 UTC del cumpleaños sigue siendo el cumpleaños", () => {
    assert.equal(edadEn("2008-08-04", new Date("2026-08-04T23:59:59Z")), 18);
  });

  it("nacida un 29 de febrero: el 28/02 de un año normal aún no ha cumplido, el 01/03 sí", () => {
    assert.equal(edadEn("2008-02-29", new Date(Date.UTC(2026, 1, 28))), 17);
    assert.equal(edadEn("2008-02-29", new Date(Date.UTC(2026, 2, 1))), 18);
  });

  it("nacida un 29 de febrero, en año bisiesto cumple justo ese día", () => {
    assert.equal(edadEn("2008-02-29", new Date(Date.UTC(2028, 1, 28))), 19);
    assert.equal(edadEn("2008-02-29", new Date(Date.UTC(2028, 1, 29))), 20);
  });

  it("el mismo día de nacimiento que la referencia: 0 años", () => {
    assert.equal(edadEn("2026-08-04", REF), 0);
  });

  it("la referencia puede ser un texto ISO; sin hora se toma a medianoche UTC", () => {
    assert.equal(edadEn("2008-08-04", "2026-08-04"), 18);
    assert.equal(edadEn("2008-08-05", "2026-08-04"), 17);
  });

  it("la referencia cuenta por su fecha UTC, no por la local de quien firma (el contenedor corre en UTC)", () => {
    // 01:00 del 4 de agosto en UTC+3 es todavía el 3 de agosto a las 22:00 UTC.
    assert.equal(edadEn("2008-08-04", "2026-08-04T01:00:00+03:00"), 17);
    // 23:30 del 3 de agosto en UTC-2 es ya el 4 de agosto a la 01:30 UTC.
    assert.equal(edadEn("2008-08-04", "2026-08-03T23:30:00-02:00"), 18);
  });

  it("solo entiende YYYY-MM-DD: lo demás es null (no utilizable)", () => {
    assert.equal(edadEn("14/05/1990", REF), null);
    assert.equal(edadEn("1990-5-14", REF), null);
    assert.equal(edadEn("1990-05-14T00:00:00.000Z", REF), null);
    assert.equal(edadEn(new Date("1990-05-14"), REF), null);
  });

  it("con espacios alrededor se entiende igual", () => {
    assert.equal(edadEn(" 1990-05-14 ", REF), 36);
  });

  it("una fecha que no existe (mes 13, día 45) es null", () => {
    assert.equal(edadEn("2026-13-45", REF), null);
  });

  it("pero un día que no existe en un mes real (30 de febrero) SÍ da una edad", () => {
    // SOSPECHOSO: misma raíz que el 31 de febrero de validarDatos: V8 corre
    // «2008-02-30» al 1 de marzo de 2008 en vez de dar NaN, así que una fecha
    // que no es real cuenta años igual. Se esperaría null (no utilizable).
    assert.equal(edadEn("2008-02-30", REF), 18);
  });

  it("vacío, null o undefined: null", () => {
    assert.equal(edadEn("", REF), null);
    assert.equal(edadEn(null, REF), null);
    assert.equal(edadEn(undefined, REF), null);
  });

  it("una referencia ilegible: null", () => {
    assert.equal(edadEn("1990-05-14", "no-fecha"), null);
    assert.equal(edadEn("1990-05-14", new Date(Number.NaN)), null);
  });

  it("una fecha de nacimiento FUTURA no da una edad negativa: es «no lo sé» (null)", () => {
    // Hasta el 21/08/2026 devolvía -4, y `esMenor` lo leía como menor de 18:
    // una adulta que se equivocaba de siglo al teclear («2086» por «1986») se
    // quedaba pidiendo el consentimiento de su tutor, que es justo lo que el
    // comentario de `esMenor` dice que quiere evitar. Ahora, como `edadDesde`
    // de formularioAlta, fuera de 0..120 no hay edad.
    assert.equal(edadEn("2030-01-01", REF), null);
    assert.equal(edadEn("2086-05-14", REF), null);
    assert.equal(edadEn("2026-08-05", REF), null); // el día siguiente ya cuenta
  });

  it("por arriba también hay tope: más de 120 años no es una edad", () => {
    assert.equal(edadEn("1906-01-01", REF), 120);
    assert.equal(edadEn("1900-01-01", REF), null);
  });

  it("referencia null NO cuenta como «hoy»: cuenta desde 1970", () => {
    // SOSPECHOSO (sigue): el valor por defecto solo entra con undefined; con
    // null, `new Date(null)` es el 1 de enero de 1970. Para una nacida en 1990
    // el tope de 0..120 lo tapa —sale null, «no lo sé»—, pero una nacida en
    // 1960 sale con 10 años y pasaría por menor. Nadie pasa null hoy (los
    // llamadores omiten el argumento), pero es una trampa a un `??` de
    // distancia.
    assert.equal(edadEn("1990-05-14", null), null);
    assert.equal(edadEn("1960-01-01", null), 10);
  });
});

/* ── esMenor ─────────────────────────────────────────────────────────────── */

describe("esMenor: menor de 18 el día que firma; «no lo sé» cuenta como mayor", () => {
  it("con 17 es menor; el día que cumple 18, ya no", () => {
    assert.equal(esMenor("2008-08-05", REF), true);
    assert.equal(esMenor("2008-08-04", REF), false);
  });

  it("una nacida hace 10 años es menor hoy; una nacida hace 40, no", () => {
    assert.equal(esMenor(MENOR), true);
    assert.equal(esMenor(MAYOR), false);
  });

  it("sin fecha legible no se le pide un tutor a una adulta: vacío, null y basura son «mayor»", () => {
    assert.equal(esMenor("", REF), false);
    assert.equal(esMenor(null, REF), false);
    assert.equal(esMenor(undefined, REF), false);
    assert.equal(esMenor("ayer", REF), false);
    assert.equal(esMenor("2026-13-45", REF), false);
  });

  it("una fecha de nacimiento futura NO sale como menor: se trata como «no lo sé»", () => {
    // Hasta el 21/08/2026 salía `true` —consecuencia de la edad negativa de
    // edadEn— y el portal le exigía a una adulta el consentimiento de su tutor.
    // Ahora vale lo mismo que una fecha ilegible: mayor.
    assert.equal(esMenor("2030-01-01", REF), false);
    assert.equal(esMenor("2086-05-14", REF), false);
  });
});

/* ── camposDe ────────────────────────────────────────────────────────────── */

describe("camposDe: la definición de campos de la plantilla, normalizada", () => {
  it("sin plantilla, sin fields o con fields que no es lista: []", () => {
    assert.deepEqual(camposDe(null), []);
    assert.deepEqual(camposDe(undefined), []);
    assert.deepEqual(camposDe({}), []);
    assert.deepEqual(camposDe({ fields: "dni" }), []);
    assert.deepEqual(camposDe({ fields: { key: "dni" } }), []);
  });

  it("un campo con solo `key` sale con todos los valores por defecto", () => {
    assert.deepEqual(camposDe({ fields: [{ key: "dni" }] }), [
      {
        key: "dni",
        label: "dni",
        type: "text",
        required: true,
        requiredDesdeEdad: null,
        previo: false,
        group: null,
        placeholder: null,
        help: null,
        options: null,
        ficha: null,
      },
    ]);
  });

  it("un campo completo conserva todo, recortado por los extremos", () => {
    assert.deepEqual(
      camposDe({
        fields: [
          {
            key: " relacion ",
            label: " Relación con la menor ",
            type: "select",
            required: false,
            requiredDesdeEdad: 14,
            previo: true,
            group: " Tutor ",
            placeholder: " Madre, padre… ",
            help: " Quién firma ",
            options: [" Madre ", "Padre", "", null, "Tutor/a legal"],
            ficha: " tutor.relationship ",
          },
        ],
      }),
      [
        {
          key: "relacion",
          label: "Relación con la menor",
          type: "select",
          required: false,
          requiredDesdeEdad: 14,
          previo: true,
          group: "Tutor",
          placeholder: "Madre, padre…",
          help: "Quién firma",
          options: ["Madre", "Padre", "Tutor/a legal"],
          ficha: "tutor.relationship",
        },
      ]
    );
  });

  it("se descartan las entradas que no son objeto o no tienen clave", () => {
    const campos = camposDe({
      fields: [null, "dni", 7, {}, { key: "   " }, { label: "Sin clave" }, { key: "ok" }],
    });
    assert.deepEqual(claves(campos), ["ok"]);
  });

  it("un tipo que la plantilla no entiende cae a «text»; los siete tipos conocidos se respetan", () => {
    assert.equal(camposDe({ fields: [{ key: "x", type: "number" }] })[0].type, "text");
    assert.equal(camposDe({ fields: [{ key: "x", type: "DNI" }] })[0].type, "text");
    for (const type of FIELD_TYPES) {
      assert.equal(camposDe({ fields: [{ key: "x", type }] })[0].type, type);
    }
  });

  it("`required` solo se apaga con `false` de verdad; ausente o cualquier otra cosa es obligatorio", () => {
    assert.equal(camposDe({ fields: [{ key: "x", required: false }] })[0].required, false);
    assert.equal(camposDe({ fields: [{ key: "x" }] })[0].required, true);
    assert.equal(camposDe({ fields: [{ key: "x", required: "no" }] })[0].required, true);
    assert.equal(camposDe({ fields: [{ key: "x", required: 0 }] })[0].required, true);
  });

  it("`requiredDesdeEdad` solo si es un entero; «14» como texto o 14.5 es null (siempre)", () => {
    assert.equal(
      camposDe({ fields: [{ key: "x", requiredDesdeEdad: 14 }] })[0].requiredDesdeEdad,
      14
    );
    assert.equal(
      camposDe({ fields: [{ key: "x", requiredDesdeEdad: 0 }] })[0].requiredDesdeEdad,
      0
    );
    assert.equal(
      camposDe({ fields: [{ key: "x", requiredDesdeEdad: "14" }] })[0].requiredDesdeEdad,
      null
    );
    assert.equal(
      camposDe({ fields: [{ key: "x", requiredDesdeEdad: 14.5 }] })[0].requiredDesdeEdad,
      null
    );
  });

  it("`previo` solo con `true` de verdad: «true» o 1 no valen", () => {
    assert.equal(camposDe({ fields: [{ key: "x", previo: true }] })[0].previo, true);
    assert.equal(camposDe({ fields: [{ key: "x", previo: "true" }] })[0].previo, false);
    assert.equal(camposDe({ fields: [{ key: "x", previo: 1 }] })[0].previo, false);
  });

  it("`options` que no es lista es null; una lista vacía se queda vacía (no null)", () => {
    assert.equal(camposDe({ fields: [{ key: "x", options: "a,b" }] })[0].options, null);
    assert.deepEqual(camposDe({ fields: [{ key: "x", options: [] }] })[0].options, []);
  });

  it("el orden de la plantilla se conserva", () => {
    assert.deepEqual(claves(camposDe(PLANTILLA)), [
      "nombre",
      "dni",
      "fechaNacimiento",
      "domicilio",
      "email",
      "telefono",
      "lugarFirma",
      "fechaFirma",
    ]);
  });
});

/* ── bloquesDe ───────────────────────────────────────────────────────────── */

describe("bloquesDe: los documentos a leer y aceptar, normalizados", () => {
  it("sin plantilla o sin blocks: []", () => {
    assert.deepEqual(bloquesDe(null), []);
    assert.deepEqual(bloquesDe({}), []);
    assert.deepEqual(bloquesDe({ blocks: "contrato" }), []);
  });

  it("un bloque con solo `id`: título = id, cuerpo vacío, etiqueta genérica, obligatorio", () => {
    assert.deepEqual(bloquesDe({ blocks: [{ id: "b1" }] }), [
      {
        id: "b1",
        title: "b1",
        body: "",
        acceptLabel: "He leído y acepto este documento.",
        required: true,
      },
    ]);
  });

  it("con título, la etiqueta de aceptación lo nombra; si la plantilla trae la suya, manda la suya", () => {
    assert.equal(
      bloquesDe({ blocks: [{ id: "a1", title: "Anexo I" }] })[0].acceptLabel,
      "He leído y acepto Anexo I."
    );
    assert.equal(
      bloquesDe({
        blocks: [{ id: "a1", title: "Anexo I", acceptLabel: " Acepto el tratamiento. " }],
      })[0].acceptLabel,
      "Acepto el tratamiento."
    );
  });

  it("`required: false` se respeta; lo demás es obligatorio", () => {
    assert.equal(bloquesDe({ blocks: [{ id: "a", required: false }] })[0].required, false);
    assert.equal(bloquesDe({ blocks: [{ id: "a", required: "no" }] })[0].required, true);
  });

  it("se descartan las entradas sin id y se conserva el orden", () => {
    const b = bloquesDe({
      blocks: [null, { title: "Sin id" }, { id: " " }, { id: "z" }, { id: "a" }],
    });
    assert.deepEqual(
      b.map((x) => x.id),
      ["z", "a"]
    );
  });
});

/* ── serializarPlantilla ─────────────────────────────────────────────────── */

describe("serializarPlantilla: la vista que viaja al portal", () => {
  it("sin plantilla: null", () => {
    assert.equal(serializarPlantilla(null), null);
    assert.equal(serializarPlantilla(undefined), null);
  });

  it("sin ficha, cada campo viaja sin valor y sin marca de ficha; intro, versión y segunda firma con sus defectos", () => {
    const v = serializarPlantilla({
      key: "p",
      title: "T",
      fields: [{ key: "dni" }],
      blocks: [{ id: "b" }],
    });
    assert.deepEqual(v, {
      key: "p",
      title: "T",
      intro: null,
      version: 1,
      fields: [{ ...camposDe({ fields: [{ key: "dni" }] })[0], valor: null, desdeFicha: false }],
      blocks: bloquesDe({ blocks: [{ id: "b" }] }),
      secondSignatureLabel: null,
      onlyMinors: false,
    });
  });

  it("no lleva `active` ni fechas, que el portal no necesita", () => {
    const v = serializarPlantilla({
      key: "p",
      title: "T",
      active: true,
      createdAt: "2026-08-04",
      updatedAt: "x",
    });
    assert.equal("active" in v, false);
    assert.equal("createdAt" in v, false);
    assert.equal("updatedAt" in v, false);
  });

  it("intro, versión, etiqueta de la segunda firma y onlyMinors viajan tal cual (onlyMinors como booleano)", () => {
    const v = serializarPlantilla({
      key: "parental",
      title: "Consentimiento",
      intro: "Lee esto.",
      version: 3,
      secondSignatureLabel: "Firma de la menor (opcional)",
      onlyMinors: 1,
    });
    assert.equal(v.intro, "Lee esto.");
    assert.equal(v.version, 3);
    assert.equal(v.secondSignatureLabel, "Firma de la menor (opcional)");
    assert.equal(v.onlyMinors, true);
  });

  it("si la fila trae toJSON (un modelo), se serializa lo que devuelve", () => {
    const fila = {
      toJSON: () => ({ key: "p", title: "Desde toJSON", fields: [{ key: "a" }] }),
      key: "otra",
      title: "No esta",
    };
    const v = serializarPlantilla(fila);
    assert.equal(v.title, "Desde toJSON");
    assert.equal(v.fields.length, 1);
  });

  it("con ficha delante, lo que la ficha tiene viaja resuelto: valor y desdeFicha=true", () => {
    const cliente = {
      name: "Ana Ruiz",
      taxId: "12345678Z",
      birthDate: "1990-05-14",
      email: "ana@example.com",
      phone: "",
      customFields: { domicilio: "C/ Mallorca 210" },
    };
    const porClave = Object.fromEntries(
      serializarPlantilla(PLANTILLA, cliente).fields.map((f) => [f.key, f])
    );
    assert.deepEqual([porClave.nombre.valor, porClave.nombre.desdeFicha], ["Ana Ruiz", true]);
    assert.deepEqual([porClave.dni.valor, porClave.dni.desdeFicha], ["12345678Z", true]);
    assert.deepEqual(
      [porClave.fechaNacimiento.valor, porClave.fechaNacimiento.desdeFicha],
      ["1990-05-14", true]
    );
    assert.deepEqual(
      [porClave.domicilio.valor, porClave.domicilio.desdeFicha],
      ["C/ Mallorca 210", true]
    );
    assert.deepEqual([porClave.email.valor, porClave.email.desdeFicha], ["ana@example.com", true]);
  });

  it("lo que la ficha NO tiene (teléfono vacío) viaja como casilla vacía: null y desdeFicha=false", () => {
    const v = serializarPlantilla(PLANTILLA, { phone: "", email: null });
    const porClave = Object.fromEntries(v.fields.map((f) => [f.key, f]));
    assert.deepEqual([porClave.telefono.valor, porClave.telefono.desdeFicha], [null, false]);
    assert.deepEqual([porClave.email.valor, porClave.email.desdeFicha], [null, false]);
  });

  it("los campos del acto de firmar (localidad, fecha) nunca salen de la ficha, aunque haya ficha", () => {
    const v = serializarPlantilla(PLANTILLA, {
      name: "Ana",
      customFields: { lugarFirma: "Madrid" },
    });
    const porClave = Object.fromEntries(v.fields.map((f) => [f.key, f]));
    assert.deepEqual([porClave.lugarFirma.valor, porClave.lugarFirma.desdeFicha], [null, false]);
    assert.deepEqual([porClave.fechaFirma.valor, porClave.fechaFirma.desdeFicha], [null, false]);
  });

  it("los datos del tutor (`tutor.*`) tampoco se leen de la ficha: son de otra persona y se preguntan", () => {
    const v = serializarPlantilla(
      { key: "parental", fields: [{ key: "nombre", ficha: "tutor.name" }] },
      { name: "Ana (la menor)", guardians: [{ name: "Carmen" }] }
    );
    assert.deepEqual([v.fields[0].valor, v.fields[0].desdeFicha], [null, false]);
  });

  it("una fecha guardada como Date (no como texto ISO) no llega como YYYY-MM-DD", () => {
    // SOSPECHOSO: `leerDeFicha` (datosFicha.js) hace String(bruto).slice(0, 10)
    // «por si alguien lo guardó como Date», pero String(Date) es «Mon May 14
    // 1990 …», así que sale «Mon May 14» y el input date lo rechaza. Del ORM la
    // columna DATEONLY llega como texto, por eso hoy no muerde; el recorte
    // correcto sería por toISOString().
    const v = serializarPlantilla(
      { key: "p", fields: [{ key: "fn", type: "date", ficha: "cliente.birthDate" }] },
      { birthDate: new Date(Date.UTC(1990, 4, 14, 12)) }
    );
    assert.equal(v.fields[0].desdeFicha, true);
    assert.notEqual(v.fields[0].valor, "1990-05-14");
    assert.equal(/^\d{4}-\d{2}-\d{2}$/.test(v.fields[0].valor), false);
  });
});

/* ── validarDatos ────────────────────────────────────────────────────────── */

describe("validarDatos: lo que manda el portal contra la plantilla", () => {
  it("con los ocho datos bien, devuelve los ocho y ninguno más", () => {
    assert.deepEqual(validarDatos(PLANTILLA, DATOS_OK), { datos: DATOS_OK });
  });

  it("sin plantilla o sin campos, no hay nada que validar: { datos: {} }", () => {
    assert.deepEqual(validarDatos(null, DATOS_OK), { datos: {} });
    assert.deepEqual(validarDatos({ fields: [] }, DATOS_OK), { datos: {} });
  });

  it("lo que la plantilla no declara se tira: nadie mete campos inventados en un documento firmado", () => {
    const r = validarDatos(PLANTILLA, { ...DATOS_OK, campoInventado: "lo que sea", admin: true });
    assert.equal("campoInventado" in r.datos, false);
    assert.equal("admin" in r.datos, false);
  });

  it("sin entrada (null, texto, lista) falta el primer obligatorio y lo dice por su etiqueta", () => {
    assert.deepEqual(validarDatos(PLANTILLA, null), { error: "Falta «Nombre y apellidos»" });
    assert.deepEqual(validarDatos(PLANTILLA, "texto"), { error: "Falta «Nombre y apellidos»" });
    assert.deepEqual(validarDatos(PLANTILLA, []), { error: "Falta «Nombre y apellidos»" });
  });

  it("un obligatorio en blanco (vacío, espacios o null) corta con «Falta «etiqueta»»", () => {
    assert.deepEqual(validarDatos(PLANTILLA, { ...DATOS_OK, domicilio: "" }), {
      error: "Falta «Domicilio»",
    });
    assert.deepEqual(validarDatos(PLANTILLA, { ...DATOS_OK, domicilio: "   " }), {
      error: "Falta «Domicilio»",
    });
    assert.deepEqual(validarDatos(PLANTILLA, { ...DATOS_OK, domicilio: null }), {
      error: "Falta «Domicilio»",
    });
  });

  it("se para en el PRIMER error, en el orden de la plantilla", () => {
    const r = validarDatos(PLANTILLA, { ...DATOS_OK, domicilio: "", email: "mal" });
    assert.deepEqual(r, { error: "Falta «Domicilio»" });
  });

  it("un opcional en blanco no sale en los datos (ni como null)", () => {
    const p = {
      fields: [{ key: "obs", label: "Observaciones", type: "textarea", required: false }],
    };
    assert.deepEqual(validarDatos(p, { obs: "" }), { datos: {} });
    assert.deepEqual(validarDatos(p, {}), { datos: {} });
  });

  it("un opcional RELLENO mal sigue siendo un error: opcional no es «vale cualquier cosa»", () => {
    const p = { fields: [{ key: "email", label: "Correo", type: "email", required: false }] };
    assert.deepEqual(validarDatos(p, { email: "esto-no-es-un-correo" }), {
      error: "«Correo» no parece un correo válido",
    });
  });

  it("los textos se recortan por los extremos y se truncan a 200 (texto), 2000 (textarea)", () => {
    const p = {
      fields: [
        { key: "t", type: "text" },
        { key: "ta", type: "textarea" },
      ],
    };
    const r = validarDatos(p, { t: "  hola  ", ta: "x".repeat(2500) });
    assert.equal(r.datos.t, "hola");
    assert.equal(r.datos.ta.length, 2000);
    assert.equal(validarDatos(p, { t: "a".repeat(250), ta: "b" }).datos.t.length, 200);
  });

  it("un número llega como texto (el teléfono tecleado sin comillas)", () => {
    const p = { fields: [{ key: "tel", label: "Teléfono", type: "tel" }] };
    assert.deepEqual(validarDatos(p, { tel: 600123456 }), { datos: { tel: "600123456" } });
  });

  describe("correo", () => {
    const p = { fields: [{ key: "email", label: "Correo", type: "email" }] };
    it("se guarda en minúsculas y sin espacios", () => {
      assert.deepEqual(validarDatos(p, { email: "  Ana.Ruiz@Example.COM " }), {
        datos: { email: "ana.ruiz@example.com" },
      });
    });
    it("sin @, sin dominio o con dominio de una letra, no", () => {
      assert.deepEqual(validarDatos(p, { email: "ana.example.com" }), {
        error: "«Correo» no parece un correo válido",
      });
      assert.deepEqual(validarDatos(p, { email: "ana@x" }), {
        error: "«Correo» no parece un correo válido",
      });
      assert.deepEqual(validarDatos(p, { email: "ana@x.e" }), {
        error: "«Correo» no parece un correo válido",
      });
      assert.deepEqual(validarDatos(p, { email: "ana ruiz@example.com" }), {
        error: "«Correo» no parece un correo válido",
      });
    });
  });

  describe("teléfono", () => {
    const p = { fields: [{ key: "tel", label: "Teléfono", type: "tel" }] };
    it("dígitos con espacios, +, paréntesis, puntos o guiones, de 6 a 30 caracteres", () => {
      assert.deepEqual(validarDatos(p, { tel: "600123456" }), { datos: { tel: "600123456" } });
      assert.deepEqual(validarDatos(p, { tel: "+34 612 345 678" }), {
        datos: { tel: "+34 612 345 678" },
      });
      assert.deepEqual(validarDatos(p, { tel: "(+34) 612.345-678" }), {
        datos: { tel: "(+34) 612.345-678" },
      });
      assert.deepEqual(validarDatos(p, { tel: "123456" }), { datos: { tel: "123456" } });
    });
    it("cinco caracteres o letras, no", () => {
      assert.deepEqual(validarDatos(p, { tel: "12345" }), {
        error: "«Teléfono» no parece un teléfono válido",
      });
      assert.deepEqual(validarDatos(p, { tel: "600 ABC 123" }), {
        error: "«Teléfono» no parece un teléfono válido",
      });
    });
    it("más de 30 caracteres se trunca ANTES de validar, así que pasa con 30", () => {
      assert.deepEqual(validarDatos(p, { tel: "1".repeat(31) }), {
        datos: { tel: "1".repeat(30) },
      });
    });
  });

  describe("fecha", () => {
    const p = { fields: [{ key: "f", label: "Fecha", type: "date" }] };
    it("YYYY-MM-DD se guarda tal cual", () => {
      assert.deepEqual(validarDatos(p, { f: "2026-08-04" }), { datos: { f: "2026-08-04" } });
    });
    it("otro formato (04/08/2026, ISO con hora) no es una fecha", () => {
      assert.deepEqual(validarDatos(p, { f: "04/08/2026" }), {
        error: "«Fecha» tiene que ser una fecha",
      });
      assert.deepEqual(validarDatos(p, { f: "2026-08-04T00:00:00Z" }), {
        error: "«Fecha» tiene que ser una fecha",
      });
    });
    it("mes 13 o día 45 no es una fecha real", () => {
      assert.deepEqual(validarDatos(p, { f: "2026-13-45" }), {
        error: "«Fecha» no es una fecha real",
      });
    });
    it("un día que no existe en un mes real (31 de febrero, 31 de abril) tampoco es una fecha real", () => {
      // `new Date("2026-02-31T00:00:00Z")` no da NaN: V8 lo corre al 3 de marzo.
      // Hasta el 19/08/2026 se aceptaba y llegaba hasta la ficha
      // (actualizacionDeFicha → birthDate), donde Postgres lo tumbaba con un
      // 500. Ahora se vuelve a formatear y se compara, como `fechaONull`.
      assert.deepEqual(validarDatos(p, { f: "2026-02-31" }), {
        error: "«Fecha» no es una fecha real",
      });
      assert.deepEqual(validarDatos(p, { f: "2026-04-31" }), {
        error: "«Fecha» no es una fecha real",
      });
      // El 29 de febrero sí existe en bisiesto, y no en año normal.
      assert.deepEqual(validarDatos(p, { f: "2028-02-29" }), { datos: { f: "2028-02-29" } });
      assert.deepEqual(validarDatos(p, { f: "2026-02-29" }), {
        error: "«Fecha» no es una fecha real",
      });
    });

    describe("una fecha de NACIMIENTO no puede estar en el futuro", () => {
      const NACIMIENTO = {
        key: "fechaNacimiento",
        label: "Fecha de nacimiento",
        type: "date",
        ficha: "cliente.birthDate",
      };
      const p = { fields: [NACIMIENTO] };

      it("un año tecleado de más se rechaza en la puerta, con su frase", () => {
        // Hasta el 21/08/2026 entraba: el día existe, así que se guardaba en
        // `signerData` y en la ficha, y `esMenor` la contaba como menor de 18
        // (edad negativa). La adulta se quedaba pidiendo el consentimiento de
        // un tutor y sin poder terminar de firmar.
        assert.deepEqual(validarDatos(p, { fechaNacimiento: "2086-05-14" }, null, REF), {
          error: "«Fecha de nacimiento» no puede ser una fecha futura",
        });
      });

      it("el corte es el día siguiente: hoy vale (una recién nacida), mañana no", () => {
        assert.deepEqual(validarDatos(p, { fechaNacimiento: "2026-08-04" }, null, REF), {
          datos: { fechaNacimiento: "2026-08-04" },
        });
        assert.deepEqual(validarDatos(p, { fechaNacimiento: "2026-08-05" }, null, REF), {
          error: "«Fecha de nacimiento» no puede ser una fecha futura",
        });
      });

      it("sin `momento`, el «hoy» es el reloj: los llamadores de verdad no lo pasan", () => {
        assert.deepEqual(validarDatos(p, { fechaNacimiento: FUTURA }), {
          error: "«Fecha de nacimiento» no puede ser una fecha futura",
        });
        assert.deepEqual(validarDatos(p, { fechaNacimiento: MAYOR }), {
          datos: { fechaNacimiento: MAYOR },
        });
      });

      it("se reconoce por su destino en la ficha (cliente o tutor) o por su clave", () => {
        const comoSeLlame = [
          { key: "x", ficha: "cliente.birthDate" },
          { key: "x", ficha: "tutor.birthDate" },
          { key: "fechaNacimiento" },
          { key: "birthDate" },
          { key: "fnac" }, // las tres claves que ya mira `nacimientoDeclarado`
        ];
        for (const campo of comoSeLlame) {
          assert.deepEqual(
            validarDatos(
              { fields: [{ label: "F", type: "date", ...campo }] },
              { [campo.key]: "2086-05-14" },
              null,
              REF
            ),
            { error: "«F» no puede ser una fecha futura" },
            JSON.stringify(campo)
          );
        }
      });

      it("la fecha de la FIRMA sí puede ir por delante: un reloj adelantado no puede impedir firmar", () => {
        const firma = { fields: [{ key: "fechaFirma", label: "Fecha de la firma", type: "date" }] };
        assert.deepEqual(validarDatos(firma, { fechaFirma: "2026-08-05" }, null, REF), {
          datos: { fechaFirma: "2026-08-05" },
        });
      });

      it("una fecha futura que YA está en la ficha no bloquea la firma: no la puso quien firma ni puede quitarla", () => {
        // El endpoint de firma valida `{ ...body.datos, ...datosDeFicha(...) }`
        // (sign/route.js): lo de la ficha PISA lo que mande el navegador, para
        // que el DNI del contrato sea el del CRM. Con la comprobación de fecha
        // futura recién puesta, una ficha que arrastraba la fecha mala de este
        // mismo fallo devolvía 422 en el PRIMER documento y dejaba a la
        // paciente sin poder firmar nada —y nombrando un campo que el portal ni
        // le enseña (`camposQueFaltan` la ve llena) ni la dejaría sobrescribir
        // (`actualizacionDeFicha` solo tapa huecos)—. Eso lo arregla el centro
        // en la ficha, no quien firma.
        assert.deepEqual(validarDatos(p, { fechaNacimiento: FUTURA }, { birthDate: FUTURA }, REF), {
          datos: { fechaNacimiento: FUTURA },
        });
      });

      it("pero lo que se TECLEA sí se juzga, aunque la ficha arrastre otra fecha futura", () => {
        // Lo declarado es lo único que llegaría a escribirse, así que es lo
        // único que se puede —y se debe— parar en la puerta.
        assert.deepEqual(
          validarDatos(p, { fechaNacimiento: "2099-01-01" }, { birthDate: FUTURA }, REF),
          {
            error: "«Fecha de nacimiento» no puede ser una fecha futura",
          }
        );
        // Y con el hueco vacío en la ficha, que es el caso de «Completa tus
        // datos», se rechaza igual que siempre.
        assert.deepEqual(validarDatos(p, { fechaNacimiento: FUTURA }, { birthDate: null }, REF), {
          error: "«Fecha de nacimiento» no puede ser una fecha futura",
        });
      });
    });
  });

  describe("DNI / NIE", () => {
    const p = { fields: [{ key: "dni", label: "DNI / NIE", type: "dni" }] };
    it("se guarda en mayúsculas y sin espacios ni guiones", () => {
      assert.deepEqual(validarDatos(p, { dni: " 12345678-z " }), { datos: { dni: "12345678Z" } });
      assert.deepEqual(validarDatos(p, { dni: "x1234567l" }), { datos: { dni: "X1234567L" } });
    });
    it("con la letra cambiada se rechaza y se pide revisarlo", () => {
      assert.deepEqual(validarDatos(p, { dni: "12345678A" }), {
        error: "La letra de «DNI / NIE» no corresponde. Revísalo, por favor.",
      });
    });
    it("un pasaporte extranjero pasa tal cual (en mayúsculas): no se deja sin firmar a nadie de fuera", () => {
      assert.deepEqual(validarDatos(p, { dni: "ab123456" }), { datos: { dni: "AB123456" } });
    });
    it("se trunca a 30 ANTES de mirar la letra: 35 unos quedan en 30 y pasan (no tienen forma de DNI)", () => {
      assert.deepEqual(validarDatos(p, { dni: "1".repeat(35) }), {
        datos: { dni: "1".repeat(30) },
      });
    });
  });

  describe("desplegable", () => {
    it("con opciones, solo una de ellas (comparadas ya recortadas)", () => {
      const p = {
        fields: [{ key: "rel", label: "Relación", type: "select", options: [" Madre ", "Padre"] }],
      };
      assert.deepEqual(validarDatos(p, { rel: "Madre" }), { datos: { rel: "Madre" } });
      assert.deepEqual(validarDatos(p, { rel: "Abuela" }), {
        error: "«Relación» no es una opción válida",
      });
    });
    it("sin opciones (ausentes o lista vacía), vale cualquier texto", () => {
      assert.deepEqual(
        validarDatos({ fields: [{ key: "rel", type: "select" }] }, { rel: "Lo que sea" }),
        { datos: { rel: "Lo que sea" } }
      );
      assert.deepEqual(
        validarDatos(
          { fields: [{ key: "rel", type: "select", options: [] }] },
          { rel: "Lo que sea" }
        ),
        { datos: { rel: "Lo que sea" } }
      );
    });
  });

  describe("el DNI es obligatorio según la EDAD, y la edad sale de la fecha que se está escribiendo", () => {
    const DNI = {
      key: "dni",
      label: "DNI / NIE",
      type: "dni",
      ficha: "cliente.taxId",
      requiredDesdeEdad: 14,
    };
    const FECHA = {
      key: "fechaNacimiento",
      label: "Fecha de nacimiento",
      type: "date",
      ficha: "cliente.birthDate",
    };
    const DOMICILIO = {
      key: "domicilio",
      label: "Domicilio",
      type: "text",
      ficha: "cliente.customFields.domicilio",
    };
    const plantilla = { fields: [FECHA, DNI, DOMICILIO] };

    it("una menor de 14 sin DNI y sin ficha previa pasa, y no se le inventa un DNI", () => {
      assert.deepEqual(
        validarDatos(plantilla, { fechaNacimiento: MENOR, domicilio: "Calle Falsa 123" }, null),
        {
          datos: { fechaNacimiento: MENOR, domicilio: "Calle Falsa 123" },
        }
      );
    });

    it("una adulta sin DNI: se le pide", () => {
      assert.deepEqual(
        validarDatos(plantilla, { fechaNacimiento: MAYOR, domicilio: "Calle Falsa 123" }, null),
        {
          error: "Falta «DNI / NIE»",
        }
      );
    });

    it("sin fecha en ningún sitio, el DNI se exige (el lado que no rompe nada)", () => {
      assert.deepEqual(
        validarDatos({ fields: [DNI, DOMICILIO] }, { domicilio: "Calle Falsa 123" }, null),
        {
          error: "Falta «DNI / NIE»",
        }
      );
      assert.deepEqual(
        validarDatos({ fields: [DNI, DOMICILIO] }, { domicilio: "Calle Falsa 123" }, {}),
        {
          error: "Falta «DNI / NIE»",
        }
      );
    });

    it("si la fecha ya estaba en la ficha y el formulario no la vuelve a pedir, también vale", () => {
      assert.deepEqual(
        validarDatos(
          { fields: [DNI, DOMICILIO] },
          { domicilio: "Calle Falsa 123" },
          { birthDate: MENOR }
        ),
        { datos: { domicilio: "Calle Falsa 123" } }
      );
    });

    it("la fecha de la ficha puede traer hora detrás (ISO): se recorta y sigue contando", () => {
      assert.deepEqual(
        validarDatos(
          { fields: [DNI, DOMICILIO] },
          { domicilio: "Calle Falsa 123" },
          { birthDate: `${MENOR}T00:00:00.000Z` }
        ),
        { datos: { domicilio: "Calle Falsa 123" } }
      );
    });

    it("`required: false` manda sobre `requiredDesdeEdad`: a una adulta tampoco se le exige", () => {
      const opcional = { ...DNI, required: false };
      assert.deepEqual(
        validarDatos({ fields: [FECHA, opcional] }, { fechaNacimiento: MAYOR }, null),
        { datos: { fechaNacimiento: MAYOR } }
      );
    });

    it("la fecha que ACABA de escribir manda sobre la de la ficha, en los dos sentidos", () => {
      // La ficha dice adulta, ella escribe que es menor → sin DNI pasa.
      assert.deepEqual(
        validarDatos(
          plantilla,
          { fechaNacimiento: MENOR, domicilio: "C/ X" },
          { birthDate: MAYOR }
        ),
        { datos: { fechaNacimiento: MENOR, domicilio: "C/ X" } }
      );
      // La ficha dice menor, ella escribe que es adulta → se le pide.
      assert.deepEqual(
        validarDatos(
          plantilla,
          { fechaNacimiento: MAYOR, domicilio: "C/ X" },
          { birthDate: MENOR }
        ),
        { error: "Falta «DNI / NIE»" }
      );
    });

    it("la fecha se localiza por su destino «cliente.birthDate», no por cómo se llame el campo", () => {
      const conOtraClave = { fields: [{ ...FECHA, key: "fnac" }, DNI] };
      assert.deepEqual(validarDatos(conOtraClave, { fnac: MENOR }, null), {
        datos: { fnac: MENOR },
      });
    });

    it("el domicilio no depende de la edad: lo da todo el mundo", () => {
      assert.deepEqual(validarDatos(plantilla, { fechaNacimiento: MENOR }, null), {
        error: "Falta «Domicilio»",
      });
      assert.deepEqual(
        validarDatos(plantilla, { fechaNacimiento: MAYOR, dni: "12345678Z" }, null),
        {
          error: "Falta «Domicilio»",
        }
      );
    });

    it("un DNI que SÍ se escribe se valida aunque no fuera obligatorio (menor con la letra mal)", () => {
      assert.deepEqual(
        validarDatos(
          plantilla,
          { fechaNacimiento: MENOR, dni: "12345678A", domicilio: "C/ X" },
          null
        ),
        { error: "La letra de «DNI / NIE» no corresponde. Revísalo, por favor." }
      );
    });
  });
});

/* ── documentosQueAplican ────────────────────────────────────────────────── */

describe("documentosQueAplican: el consentimiento parental solo sale para menores", () => {
  it("sin plantillas: []", () => {
    assert.deepEqual(documentosQueAplican(null, [], null), []);
    assert.deepEqual(documentosQueAplican(undefined, null, null), []);
  });

  it("a una adulta le toca el contrato y no el consentimiento", () => {
    assert.deepEqual(claves(documentosQueAplican([PACIENTE, PARENTAL], [], { birthDate: MAYOR })), [
      "paciente",
    ]);
  });

  it("a una menor le tocan los dos, en el orden de las plantillas", () => {
    assert.deepEqual(claves(documentosQueAplican([PACIENTE, PARENTAL], [], { birthDate: MENOR })), [
      "paciente",
      "parental",
    ]);
  });

  it("sin fecha en la ficha ni en las firmas, el consentimiento no sale (no se sabe → mayor)", () => {
    assert.deepEqual(claves(documentosQueAplican([PACIENTE, PARENTAL], [], null)), ["paciente"]);
    assert.deepEqual(claves(documentosQueAplican([PACIENTE, PARENTAL], [], { birthDate: "" })), [
      "paciente",
    ]);
    assert.deepEqual(claves(documentosQueAplican([PACIENTE, PARENTAL], [], { birthDate: null })), [
      "paciente",
    ]);
  });

  it("la fecha de la ficha puede venir con hora detrás: se recorta a YYYY-MM-DD", () => {
    assert.deepEqual(
      claves(
        documentosQueAplican([PACIENTE, PARENTAL], [], { birthDate: `${MENOR}T00:00:00.000Z` })
      ),
      ["paciente", "parental"]
    );
  });

  it("sin fecha en la ficha, vale la que declaró al firmar (fechaNacimiento, birthDate o fnac)", () => {
    for (const clave of ["fechaNacimiento", "birthDate", "fnac"]) {
      assert.deepEqual(
        claves(
          documentosQueAplican([PACIENTE, PARENTAL], [{ signerData: { [clave]: MENOR } }], null)
        ),
        ["paciente", "parental"],
        `con la clave ${clave}`
      );
    }
  });

  it("las firmas sin datos se saltan y manda la PRIMERA que traiga fecha", () => {
    const firmas = [{ signerData: null }, { signerData: "texto" }, { signerData: { fnac: MENOR } }];
    assert.deepEqual(claves(documentosQueAplican([PACIENTE, PARENTAL], firmas, null)), [
      "paciente",
      "parental",
    ]);
    const primeroAdulta = [
      { signerData: { birthDate: MAYOR } },
      { signerData: { fechaNacimiento: MENOR } },
    ];
    assert.deepEqual(claves(documentosQueAplican([PACIENTE, PARENTAL], primeroAdulta, null)), [
      "paciente",
    ]);
  });

  it("la ficha manda sobre lo declarado: ficha adulta + firma que dice menor = sin consentimiento", () => {
    assert.deepEqual(
      claves(
        documentosQueAplican([PACIENTE, PARENTAL], [{ signerData: { fechaNacimiento: MENOR } }], {
          birthDate: MAYOR,
        })
      ),
      ["paciente"]
    );
  });

  it("una fecha de nacimiento FUTURA no convierte a una adulta en menor: sin consentimiento", () => {
    // El caso que se colaba: la fecha entraba por el formulario, se guardaba en
    // la ficha y en `signerData`, y a partir de ahí el portal le exigía el
    // consentimiento del tutor. `validarDatos` ya no la deja pasar, pero las
    // que se guardaron antes siguen ahí: aquí se fija que tampoco muerden.
    assert.deepEqual(
      claves(documentosQueAplican([PACIENTE, PARENTAL], [], { birthDate: FUTURA })),
      ["paciente"]
    );
    assert.deepEqual(
      claves(documentosQueAplican([PACIENTE, PARENTAL], [{ signerData: { fnac: FUTURA } }], null)),
      ["paciente"]
    );
  });

  it("una plantilla sin `onlyMinors` sale siempre, sea quien sea", () => {
    assert.deepEqual(claves(documentosQueAplican([PACIENTE], [], { birthDate: MENOR })), [
      "paciente",
    ]);
    assert.deepEqual(claves(documentosQueAplican([{ key: "x", onlyMinors: false }], [], null)), [
      "x",
    ]);
  });

  it("una fecha guardada como objeto Date (no texto) no se entiende y la menor pasa por mayor", () => {
    // SOSPECHOSO: `texto(client.birthDate).slice(0, 10)` sobre un Date da «Mon
    // Jan 01», que edadEn no entiende → null → mayor. Del ORM llega texto, así
    // que hoy no muerde; pero el recorte «por si es Date» no hace lo que dice.
    const [y, m, d] = MENOR.split("-").map(Number);
    assert.deepEqual(
      claves(
        documentosQueAplican([PACIENTE, PARENTAL], [], {
          birthDate: new Date(Date.UTC(y, m - 1, d, 12)),
        })
      ),
      ["paciente"]
    );
  });
});

/* ── situacionDocumentos ─────────────────────────────────────────────────── */

describe("situacionDocumentos: qué le queda por firmar a quien entra y si la ficha está completa", () => {
  it("adulta sin firmar nada: le toca el contrato, el titular está en falta y no está completo", () => {
    const s = situacionDocumentos({
      plantillas: [PACIENTE, PARENTAL],
      firmas: [],
      firmantes: [TITULAR],
      firmante: TITULAR,
      client: { birthDate: MAYOR },
    });
    assert.deepEqual(s, {
      aplican: [PACIENTE],
      misFirmas: [],
      pendientes: [PACIENTE],
      siguiente: PACIENTE,
      leFalta: [TITULAR],
      completo: false,
    });
  });

  it("adulta que ya firmó el contrato: nada pendiente, nadie en falta, completo", () => {
    const f = firma("c-1", "paciente");
    const s = situacionDocumentos({
      plantillas: [PACIENTE, PARENTAL],
      firmas: [f],
      firmantes: [TITULAR],
      firmante: TITULAR,
      client: { birthDate: MAYOR },
    });
    assert.deepEqual(s, {
      aplican: [PACIENTE],
      misFirmas: [f],
      pendientes: [],
      siguiente: null,
      leFalta: [],
      completo: true,
    });
  });

  it("menor: firmado el contrato toca el consentimiento, y hasta firmarlo no está completo", () => {
    const s = situacionDocumentos({
      plantillas: [PACIENTE, PARENTAL],
      firmas: [firma("c-1", "paciente")],
      firmantes: [TITULAR],
      firmante: TITULAR,
      client: { birthDate: MENOR },
    });
    assert.deepEqual(claves(s.aplican), ["paciente", "parental"]);
    assert.deepEqual(claves(s.pendientes), ["parental"]);
    assert.equal(s.siguiente, PARENTAL);
    assert.deepEqual(s.leFalta, [TITULAR]);
    assert.equal(s.completo, false);
  });

  it("menor con los dos firmados: completo", () => {
    const s = situacionDocumentos({
      plantillas: [PACIENTE, PARENTAL],
      firmas: [firma("c-1", "paciente"), firma("c-1", "parental")],
      firmantes: [TITULAR],
      firmante: TITULAR,
      client: { birthDate: MENOR },
    });
    assert.deepEqual(s.pendientes, []);
    assert.equal(s.siguiente, null);
    assert.deepEqual(s.leFalta, []);
    assert.equal(s.completo, true);
  });

  it("padres separados: la madre firmó todo y el padre nada → a ella no le queda nada, él está en falta, no completo", () => {
    const firmas = [firma("g-1", "paciente")];
    const ella = situacionDocumentos({
      plantillas: [PACIENTE],
      firmas,
      firmantes: [MADRE, PADRE],
      firmante: MADRE,
    });
    assert.deepEqual(ella.pendientes, []);
    assert.deepEqual(ella.misFirmas, firmas);
    assert.deepEqual(ella.leFalta, [PADRE]);
    assert.equal(ella.completo, false);

    const el = situacionDocumentos({
      plantillas: [PACIENTE],
      firmas,
      firmantes: [MADRE, PADRE],
      firmante: PADRE,
    });
    assert.deepEqual(el.pendientes, [PACIENTE]);
    assert.deepEqual(el.misFirmas, []);
    assert.deepEqual(el.leFalta, [PADRE]);
    assert.equal(el.completo, false);
  });

  it("padres separados con los dos firmados: completo para cualquiera de los dos", () => {
    const firmas = [firma("g-1", "paciente"), firma("g-2", "paciente")];
    for (const quien of [MADRE, PADRE]) {
      const s = situacionDocumentos({
        plantillas: [PACIENTE],
        firmas,
        firmantes: [MADRE, PADRE],
        firmante: quien,
      });
      assert.equal(s.completo, true, quien.name);
      assert.deepEqual(s.leFalta, []);
    }
  });

  it("una firma de OTRO firmante no cuenta como mía", () => {
    const s = situacionDocumentos({
      plantillas: [PACIENTE],
      firmas: [firma("g-1", "paciente")],
      firmantes: [MADRE, PADRE],
      firmante: PADRE,
    });
    assert.deepEqual(s.misFirmas, []);
    assert.deepEqual(s.pendientes, [PACIENTE]);
  });

  it("sin firmante (nadie ha entrado): nada es mío y todo lo que aplica está pendiente", () => {
    const s = situacionDocumentos({
      plantillas: [PACIENTE],
      firmas: [firma("c-1", "paciente")],
      firmantes: [TITULAR],
      firmante: null,
    });
    assert.deepEqual(s.misFirmas, []);
    assert.deepEqual(s.pendientes, [PACIENTE]);
    assert.equal(s.completo, true); // el titular sí firmó: la FICHA está completa
  });

  it("sin firmantes no hay contrato completo, aunque nadie esté en falta", () => {
    const s = situacionDocumentos({
      plantillas: [PACIENTE],
      firmas: null,
      firmantes: [],
      firmante: null,
    });
    assert.deepEqual(s.leFalta, []);
    assert.equal(s.completo, false);
    const t = situacionDocumentos({
      plantillas: [PACIENTE],
      firmas: undefined,
      firmantes: undefined,
      firmante: null,
    });
    assert.equal(t.completo, false);
  });

  it("los ids se comparan sin distinguir mayúsculas (UUID en distinto formato)", () => {
    const s = situacionDocumentos({
      plantillas: [PACIENTE],
      firmas: [firma("C-1", "paciente")],
      firmantes: [TITULAR],
      firmante: TITULAR,
    });
    assert.equal(s.completo, true);
    assert.deepEqual(s.pendientes, []);
  });

  it("las firmas pueden venir en snake_case (filas crudas): guardian_id y template_key", () => {
    const cruda = { guardian_id: "c-1", template_key: "paciente" };
    const s = situacionDocumentos({
      plantillas: [PACIENTE],
      firmas: [cruda],
      firmantes: [TITULAR],
      firmante: TITULAR,
    });
    assert.deepEqual(s.misFirmas, [cruda]);
    assert.deepEqual(s.pendientes, []);
    assert.equal(s.completo, true);
  });

  it("una firma de una plantilla que ya no aplica (retirada) no estorba ni cuenta", () => {
    const s = situacionDocumentos({
      plantillas: [PACIENTE],
      firmas: [firma("c-1", "vieja")],
      firmantes: [TITULAR],
      firmante: TITULAR,
    });
    assert.deepEqual(s.pendientes, [PACIENTE]);
    assert.equal(s.completo, false);
  });

  it("con plantillas vacías no hay nada que firmar: completo en cuanto hay firmantes", () => {
    const s = situacionDocumentos({
      plantillas: [],
      firmas: [],
      firmantes: [TITULAR],
      firmante: TITULAR,
    });
    assert.deepEqual(s.aplican, []);
    assert.equal(s.siguiente, null);
    assert.equal(s.completo, true);
  });
});

/* ── validarAceptaciones ─────────────────────────────────────────────────── */

describe("validarAceptaciones: cada anexo se acepta por separado", () => {
  const MOMENTO = new Date("2026-08-04T10:00:00Z");

  it("aceptar solo el contrato NO arrastra a los anexos: faltan los dos obligatorios, nombrados", () => {
    assert.deepEqual(validarAceptaciones(PLANTILLA, ["contrato"]), {
      error: "Te falta aceptar: «Anexo I», «Anexo II»",
    });
  });

  it("faltando uno solo, la frase va en singular", () => {
    assert.deepEqual(validarAceptaciones(PLANTILLA, ["contrato", "anexo1"]), {
      error: "Te falta aceptar «Anexo II»",
    });
  });

  it("con los obligatorios aceptados pasa, y el opcional no aceptado no sale en la foto", () => {
    assert.deepEqual(validarAceptaciones(PLANTILLA, ["contrato", "anexo1", "anexo2"], MOMENTO), {
      aceptaciones: [
        { id: "contrato", title: "Contrato", acceptedAt: "2026-08-04T10:00:00.000Z" },
        { id: "anexo1", title: "Anexo I", acceptedAt: "2026-08-04T10:00:00.000Z" },
        { id: "anexo2", title: "Anexo II", acceptedAt: "2026-08-04T10:00:00.000Z" },
      ],
    });
  });

  it("el opcional aceptado sí entra en la foto, con la misma hora", () => {
    const r = validarAceptaciones(PLANTILLA, ["contrato", "anexo1", "anexo2", "anexo3"], MOMENTO);
    assert.deepEqual(
      r.aceptaciones.map((a) => a.id),
      ["contrato", "anexo1", "anexo2", "anexo3"]
    );
    assert.ok(r.aceptaciones.every((a) => a.acceptedAt === "2026-08-04T10:00:00.000Z"));
  });

  it("la foto sigue el orden de la plantilla, no el de las casillas marcadas", () => {
    const r = validarAceptaciones(PLANTILLA, ["anexo2", "contrato", "anexo1"], MOMENTO);
    assert.deepEqual(
      r.aceptaciones.map((a) => a.id),
      ["contrato", "anexo1", "anexo2"]
    );
  });

  it("la entrada puede ser un objeto {id: true}: solo cuentan las claves con valor verdadero", () => {
    const r = validarAceptaciones(
      PLANTILLA,
      { contrato: true, anexo1: "sí", anexo2: 1, anexo3: false, inventado: true },
      MOMENTO
    );
    assert.deepEqual(
      r.aceptaciones.map((a) => a.id),
      ["contrato", "anexo1", "anexo2"]
    );
    assert.deepEqual(
      validarAceptaciones(PLANTILLA, { contrato: true, anexo1: true, anexo2: false }),
      {
        error: "Te falta aceptar «Anexo II»",
      }
    );
  });

  it("un id que la plantilla no tiene se ignora: no entra en la foto ni da error", () => {
    const r = validarAceptaciones(
      PLANTILLA,
      ["contrato", "anexo1", "anexo2", "inventado"],
      MOMENTO
    );
    assert.deepEqual(
      r.aceptaciones.map((a) => a.id),
      ["contrato", "anexo1", "anexo2"]
    );
  });

  it("los ids se comparan recortados: « contrato » vale", () => {
    const r = validarAceptaciones(PLANTILLA, [" contrato ", "anexo1", "anexo2"], MOMENTO);
    assert.equal(r.error, undefined);
    assert.equal(r.aceptaciones.length, 3);
  });

  it("sin entrada (null, undefined, lista vacía) faltan todos los obligatorios", () => {
    const esperado = { error: "Te falta aceptar: «Contrato», «Anexo I», «Anexo II»" };
    assert.deepEqual(validarAceptaciones(PLANTILLA, null), esperado);
    assert.deepEqual(validarAceptaciones(PLANTILLA, undefined), esperado);
    assert.deepEqual(validarAceptaciones(PLANTILLA, []), esperado);
    assert.deepEqual(validarAceptaciones(PLANTILLA, {}), esperado);
  });

  it("una entrada que no es lista ni objeto (un texto) no marca nada: faltan todos", () => {
    // Object.keys("contrato") son los índices «0», «1»…, que no casan con ningún id.
    assert.deepEqual(validarAceptaciones(PLANTILLA, "contrato"), {
      error: "Te falta aceptar: «Contrato», «Anexo I», «Anexo II»",
    });
  });

  it("una plantilla sin bloques no exige nada: { aceptaciones: [] }", () => {
    assert.deepEqual(validarAceptaciones({}, []), { aceptaciones: [] });
    assert.deepEqual(validarAceptaciones({ blocks: [] }, null), { aceptaciones: [] });
  });

  it("la hora es la del momento que le dan, en ISO UTC; si no es un Date, la de ahora", () => {
    const antes = Date.now();
    const r = validarAceptaciones({ blocks: [{ id: "a", title: "A" }] }, ["a"], "2026-08-04");
    const cuando = Date.parse(r.aceptaciones[0].acceptedAt);
    assert.ok(
      cuando >= antes && cuando <= Date.now() + 1000,
      `acceptedAt=${r.aceptaciones[0].acceptedAt}`
    );
  });

  it("un Date ilegible como momento REVIENTA en vez de caer a «ahora»", () => {
    // SOSPECHOSO: `momento instanceof Date` es cierto para `new Date(NaN)`, y
    // `.toISOString()` lanza RangeError «Invalid time value». Hoy el endpoint de
    // firma no pasa momento (cae al valor por defecto), así que no muerde; pero
    // el texto que no es Date sí cae a «ahora» y un Date roto debería hacer lo
    // mismo.
    assert.throws(
      () => validarAceptaciones({ blocks: [{ id: "a", title: "A" }] }, ["a"], new Date(Number.NaN)),
      RangeError
    );
  });
});
