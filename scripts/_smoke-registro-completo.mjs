// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-registro-completo.mjs — el audio rellena el REGISTRO ENTERO, no siete
 * campos (01/09/2026, Rodrigo).
 *
 *   node scripts/_smoke-registro-completo.mjs
 *
 * ── QUÉ SE FIJA Y POR QUÉ ──────────────────────────────────────────────────
 *
 * El encargo, con sus palabras: «no tengo ningún botón para, una vez transcrito
 * un audio, hacer todo el registro completo con esa información, desde
 * preparación a las notas internas». El botón existía y solo cubría el bloque 2
 * con los siete apartados de fábrica CLAVADOS en el prompt.
 *
 * Al desclavarlos aparecen cuatro maneras de romper esto en silencio, y son las
 * cuatro que se prueban aquí:
 *
 *  1. **Que el prompt deje de casar con el parseo.** Los dos se construyen a
 *     partir de la MISMA lista de bloques; si un día dejan de hacerlo, Claude
 *     contestaría con unas claves y se leerían otras — y la propuesta saldría
 *     vacía sin ningún error por ninguna parte.
 *  2. **Que se pierdan los siete de fábrica.** Una petición sin apartados (una
 *     pantalla vieja, un JSON corrupto) no puede dejar el registro en solo la
 *     preparación y las notas internas.
 *  3. **Que las notas internas se salgan de su sitio.** Es el único bloque que
 *     la familia no puede leer NUNCA. Ahora lo escribe una IA, así que hay que
 *     fijar las dos mitades: que el prompt se lo diga, y que al repartir el
 *     registro no acabe en `contentSections` —que sí viaja al PDF—.
 *  4. **Que cambie la forma de `aiStructured`.** Es la foto de lo que dijo la
 *     IA y ya hay sesiones guardadas con la forma histórica: si las nuevas se
 *     guardan con otra, el mismo JSONB acaba con dos estructuras.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BLOQUES_ENVOLTORIO,
  CLAVES_ENVOLTORIO,
  SEPARADOR_NOTAS,
  bloquesDelRegistro,
  esEnvoltorio,
  estructuraHistorica,
  materialParaLaIA,
  mensajeDeRegistro,
  normalizarPropuesta,
  promptDeRegistro,
  propuestaVacia,
} from "../lib/clinica/registroCompleto.js";
import {
  APARTADOS_REGISTRO_BASE,
  CLAVE_APARTADOS,
  desdeFormulario,
  repartirValoresDeSesion,
} from "../lib/clinica/plantillas.js";

/** La plantilla de un centro que se ha montado la suya (el caso de Aumenta). */
const PLANTILLA_CENTRO = [
  { key: "objectives", label: "Objetivos trabajados", tipo: "lista" },
  { key: "activities", label: "Actividades realizadas", tipo: "texto" },
  { key: "entorno_familiar", label: "Entorno familiar", tipo: "texto" },
  { key: "regulacion", label: "Regulación emocional", tipo: "lista" },
];

const SECRETO = "El padre no acude a las tutorías; la madre lo lleva sola.";

describe("Los bloques: qué es «el registro entero»", () => {
  it("son la preparación, los apartados y, al final, devolución y notas internas", () => {
    const b = bloquesDelRegistro(PLANTILLA_CENTRO);
    assert.equal(b[0].key, "prepText");
    assert.equal(b.at(-2).key, "parentFeedback");
    assert.equal(b.at(-1).key, "internalNotes");
    // Los del centro, en su orden y entre medias.
    assert.deepEqual(
      b.slice(1, -2).map((x) => x.key),
      ["objectives", "activities", "entorno_familiar", "regulacion"]
    );
  });

  it("sin apartados NO se queda en los tres del envoltorio: caen los siete de fábrica", () => {
    for (const vacio of [undefined, null, [], "roto", [{ sinTitulo: true }]]) {
      const b = bloquesDelRegistro(vacio);
      const delInforme = b.filter((x) => !esEnvoltorio(x.key)).map((x) => x.key);
      assert.deepEqual(
        delInforme,
        APARTADOS_REGISTRO_BASE.map((a) => a.key),
        `con ${JSON.stringify(vacio)} se han perdido los apartados de fábrica`
      );
      assert.equal(b.length, APARTADOS_REGISTRO_BASE.length + CLAVES_ENVOLTORIO.length);
    }
  });

  it("un apartado que roba la clave de un envoltorio no lo duplica", () => {
    // `internalNotes` pasa el filtro de claves de plantillas.js (no está entre
    // las reservadas), así que un centro podría pedirla sin querer. Si saliera
    // dos veces, la pantalla enseñaría la misma decisión duplicada y la segunda
    // pisaría a la primera al aplicar.
    const b = bloquesDelRegistro([
      { key: "internalNotes", label: "Notas internas del centro", tipo: "texto" },
      { key: "activities", label: "Actividades", tipo: "texto" },
    ]);
    assert.equal(b.filter((x) => x.key === "internalNotes").length, 1);
    // Y gana el envoltorio: su rótulo y su marca de interno, que es lo que
    // hace que la pantalla lo pinte en ámbar y el prompt lo avise.
    const notas = b.find((x) => x.key === "internalNotes");
    assert.equal(notas.label, BLOQUES_ENVOLTORIO.internalNotes.label);
    assert.equal(notas.interno, true);
  });
});

describe("El material: de dónde sale el registro", () => {
  it("vale un audio, valen unas notas, y valen los dos", () => {
    assert.equal(materialParaLaIA({ transcripcion: "hoy hemos trabajado atención" }), "hoy hemos trabajado atención");
    assert.equal(materialParaLaIA({ notas: "memory 24 piezas, ok" }), "memory 24 piezas, ok");

    const dos = materialParaLaIA({ transcripcion: "lo dictado", notas: "lo apuntado" });
    assert.ok(dos.includes("lo dictado"));
    assert.ok(dos.includes("lo apuntado"));
    // Con las dos fuentes hace falta el rótulo: quien lea el material guardado
    // dentro de un año tiene que poder distinguir la voz de la nota escrita.
    assert.ok(dos.includes(SEPARADOR_NOTAS));
    assert.ok(dos.indexOf("lo dictado") < dos.indexOf("lo apuntado"));
  });

  it("sin nada devuelve cadena vacía, y el rótulo NO aparece con una sola fuente", () => {
    for (const args of [undefined, {}, { transcripcion: "  " }, { notas: "\n\n" }, { transcripcion: null, notas: null }]) {
      assert.equal(materialParaLaIA(args), "", `${JSON.stringify(args)} debería dar cadena vacía`);
    }
    // Es lo que mira el servidor para contestar 409 en vez de llamar a Claude.
    assert.ok(!materialParaLaIA({ transcripcion: "solo voz" }).includes(SEPARADOR_NOTAS));
    assert.ok(!materialParaLaIA({ notas: "solo texto" }).includes(SEPARADOR_NOTAS));
  });

  it("el material entra en el mensaje tal cual, con las dos fuentes dentro", () => {
    const bloques = bloquesDelRegistro(PLANTILLA_CENTRO);
    const material = materialParaLaIA({ transcripcion: "le he visto concentrado", notas: "el padre no viene" });
    const msg = mensajeDeRegistro({ transcription: material, bloques });
    assert.ok(msg.includes("le he visto concentrado"));
    assert.ok(msg.includes("el padre no viene"));
  });
});

describe("El prompt: lo que se le pide a Claude", () => {
  const bloques = bloquesDelRegistro(PLANTILLA_CENTRO);
  const prompt = promptDeRegistro(bloques);

  it("nombra TODAS las claves que luego se van a leer", () => {
    // Esta es la prueba 1: prompt y parseo salen de la misma lista.
    for (const b of bloques) {
      assert.ok(prompt.includes(`"${b.key}"`), `el prompt no pide "${b.key}"`);
      assert.ok(prompt.includes(b.label), `el prompt no rotula "${b.label}"`);
    }
  });

  it("incluye los apartados propios del centro, que antes no existían", () => {
    assert.ok(prompt.includes("entorno_familiar"));
    assert.ok(prompt.includes("Entorno familiar"));
  });

  it("dice que las notas internas no las lee la familia, y solo de ellas", () => {
    const lineas = prompt.split("\n").filter((l) => l.includes("INTERNO"));
    assert.equal(lineas.length, 1);
    assert.ok(lineas[0].includes("internalNotes"));
  });

  it("manda no inventar y respetar el tipo de cada apartado", () => {
    assert.ok(/NO INVENTES/.test(prompt));
    assert.ok(prompt.includes("VACÍO"));
    assert.ok(prompt.includes("lista"));
    assert.ok(prompt.includes("párrafo"));
  });

  it("el mensaje lleva la transcripción y, si lo hay, lo ya escrito como contexto", () => {
    const sin = mensajeDeRegistro({ transcription: "hoy hemos trabajado atención", bloques });
    assert.ok(sin.includes("hoy hemos trabajado atención"));
    assert.ok(!/YA HABÍA ESCRITO/.test(sin));

    const con = mensajeDeRegistro({
      transcription: "hoy hemos trabajado atención",
      escrito: { activities: "Memory de 24 piezas", regulacion: "" },
      bloques,
    });
    assert.ok(/YA HABÍA ESCRITO/.test(con));
    assert.ok(con.includes("Memory de 24 piezas"));
    // Un bloque vacío no ensucia el contexto con una línea en blanco.
    assert.ok(!con.includes("Regulación emocional:"));
  });
});

describe("La respuesta: parseo defensivo", () => {
  const bloques = bloquesDelRegistro(PLANTILLA_CENTRO);

  it("acepta el JSON venga como venga y devuelve SIEMPRE una cadena por bloque", () => {
    const crudo = JSON.stringify({
      prepText: "Memory y escenarios escolares.",
      objectives: ["Atención sostenida", "  ", "Flexibilidad"],
      activities: "Memory de 24 piezas.",
      entorno_familiar: "",
      regulacion: "Tolera mejor la espera",
      parentFeedback: "La madre refiere mejoría.",
      internalNotes: SECRETO,
    });
    for (const envuelto of [crudo, "```json\n" + crudo + "\n```", "```\n" + crudo + "```"]) {
      const p = normalizarPropuesta(envuelto, bloques);
      assert.deepEqual(Object.keys(p).sort(), bloques.map((b) => b.key).sort());
      for (const v of Object.values(p)) assert.equal(typeof v, "string");
      // Una lista entra como una línea por viñeta, que es lo que teclea el
      // formulario (`aFormulario`); las vacías se caen por el camino.
      assert.equal(p.objectives, "Atención sostenida\nFlexibilidad");
      assert.equal(p.regulacion, "Tolera mejor la espera");
      assert.equal(p.entorno_familiar, "");
    }
  });

  it("no se rompe con basura: la propuesta sale vacía, que es un resultado legítimo", () => {
    for (const basura of ["", "lo siento, no puedo", "{roto", null, undefined, 42, []]) {
      const p = normalizarPropuesta(basura, bloques);
      assert.deepEqual(Object.keys(p).sort(), bloques.map((b) => b.key).sort());
      assert.ok(propuestaVacia(p), `${JSON.stringify(basura)} debería dar propuesta vacía`);
    }
  });

  it("tira las claves que nadie ha pedido (el modelo se inventa apartados)", () => {
    const p = normalizarPropuesta({ activities: "Memory.", diagnostico: "TDAH", riesgo: "alto" }, bloques);
    assert.ok(!("diagnostico" in p));
    assert.ok(!("riesgo" in p));
    assert.equal(p.activities, "Memory.");
  });
});

describe("aiStructured conserva su forma histórica", () => {
  it("los siete de siempre en su sitio y lo nuevo aparte, en `extra`", () => {
    const p = normalizarPropuesta(
      {
        prepText: "Preparado el memory.",
        objectives: ["Atención", "Flexibilidad"],
        activities: "Memory.",
        entorno_familiar: "Hermana pequeña recién nacida.",
        parentFeedback: "Mejor con los deberes.",
        internalNotes: SECRETO,
      },
      bloquesDelRegistro(PLANTILLA_CENTRO)
    );
    const s = estructuraHistorica(p);

    assert.deepEqual(s.objectives, ["Atención", "Flexibilidad"]); // array, no cadena
    assert.equal(s.activities, "Memory.");
    assert.deepEqual(Object.keys(s.observations).sort(), [
      "familyComments",
      "homeworkTasks",
      "incidents",
      "nextSessionNotes",
    ]);
    // Lo que no cabe en la forma de siempre no se pierde ni la deforma.
    assert.equal(s.extra.entorno_familiar, "Hermana pequeña recién nacida.");
    assert.equal(s.extra.prepText, "Preparado el memory.");
    assert.ok(!("entorno_familiar" in s));
  });
});

describe("La frontera de las notas internas al aplicar la propuesta", () => {
  it("los tres del envoltorio NO acaban en contentSections, que sí viaja al PDF", () => {
    // Esto es lo que hace la pantalla al aplicar: mezcla la propuesta con lo
    // escrito y reparte. Si un día alguien mete los tres del envoltorio en la
    // lista de apartados, el secreto del equipo saldría impreso en el registro
    // que recibe la familia.
    const apartados = PLANTILLA_CENTRO;
    const propuesta = normalizarPropuesta(
      {
        objectives: ["Atención"],
        activities: "Memory.",
        entorno_familiar: "Hermana recién nacida.",
        prepText: "Preparado el memory.",
        parentFeedback: "Mejor con los deberes.",
        internalNotes: SECRETO,
      },
      bloquesDelRegistro(apartados)
    );

    const soloApartados = Object.fromEntries(
      Object.entries(propuesta).filter(([k]) => !esEnvoltorio(k))
    );
    const reparto = repartirValoresDeSesion(desdeFormulario(soloApartados, apartados), apartados);

    const serializado = JSON.stringify(reparto.contentSections);
    assert.ok(!serializado.includes(SECRETO), "las notas internas se han colado en contentSections");
    for (const clave of CLAVES_ENVOLTORIO) {
      assert.ok(!(clave in reparto.contentSections), `${clave} no puede ser un apartado del documento`);
    }

    // Y lo que sí es del documento está donde toca: lo de fábrica en sus
    // columnas de siempre y lo nuevo en el JSONB, con su foto de apartados.
    assert.deepEqual(reparto.objectives, ["Atención"]);
    assert.equal(reparto.activities, "Memory.");
    assert.equal(reparto.contentSections.entorno_familiar, "Hermana recién nacida.");
    assert.deepEqual(
      reparto.contentSections[CLAVE_APARTADOS].map((a) => a.key),
      apartados.map((a) => a.key)
    );
  });

  it("`esEnvoltorio` distingue los tres, y nada más", () => {
    for (const k of CLAVES_ENVOLTORIO) assert.equal(esEnvoltorio(k), true);
    for (const k of ["objectives", "activities", "entorno_familiar", "apartados", "toString"]) {
      assert.equal(esEnvoltorio(k), false, `${k} no es un bloque del envoltorio`);
    }
  });
});
