// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-informe-ida-y-vuelta.mjs — abrir un informe y guardarlo no puede
 * borrarle nada (28/08/2026).
 *
 *   node scripts/_smoke-informe-ida-y-vuelta.mjs
 *   node --test-name-pattern="metodología" scripts/_smoke-informe-ida-y-vuelta.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * El cajón del informe (`components/clinica/InformeDrawer.jsx`) no pide los
 * datos al servidor: se rellena desde el informe YA SERIALIZADO que le llega
 * como prop. Y al guardar manda `contentSections` ENTERO, que
 * `PATCH /api/clinica/reports/[id]` escribe encima del JSONB **sin fusionar**.
 *
 * Eso convierte a `serializeReport` en el cuello de botella de todo el
 * contenido del informe: una clave que no vuelva de ahí, el cajón la lee
 * `undefined`, la pinta vacía y la reenvía vacía. No es que no se vea: es que
 * se BORRA.
 *
 * El 28/08/2026 faltaban tres —`methodology`, `anexarRegistros` y
 * `sourceSessionIds`—, así que abrir un informe de beca ya escrito y pulsar
 * «Guardar informe» le borraba la metodología, que es uno de los tres apartados
 * que pide la convocatoria de la beca. No se lo comió a nadie porque en
 * producción todavía no hay ni un informe real (0 en `aumenta`), pero el
 * rediseño del PDF es justo lo que va a hacer que empiecen a usarlos.
 *
 * Esta prueba no comprueba «están las once claves»: comprueba **la ida y la
 * vuelta**. Lo que entra por `contentSections` tiene que poder salir. Escrita
 * así, una clave nueva que alguien añada al cajón mañana y olvide aquí también
 * la caza.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { serializeReport } from "../lib/clinica/serialize.js";

/**
 * Un informe con TODO escrito, como lo devolvería la base. Es a propósito el
 * caso más completo: si algo de aquí no vuelve, se pierde al guardar.
 */
const GUARDADO = {
  id: "r-1",
  patientId: "p-1",
  therapistId: "t-1",
  reportType: "beca",
  reportDate: "2026-06-30",
  dueDate: null,
  status: "draft",
  contentSections: {
    motiveOfIntervention: "Dificultades en la inteligibilidad del habla.",
    objectives: ["Completar el repertorio fonético", "Ampliar la longitud del enunciado"],
    evolution: ["Ha automatizado /r/ en posición inicial"],
    achievements: ["Se hace entender por adultos no habituales"],
    persistentDifficulties: ["Grupos consonánticos con /l/"],
    recommendations: ["Continuar el trabajo en casa 10 minutos al día"],
    continuityProposal: "Se propone continuar el curso que viene.",
    referralSpecialty: "logopedia",
    methodology: "Sesión individual semanal de 45 minutos, con apoyo visual.",
    anexarRegistros: true,
    sourceSessionIds: ["s-1", "s-2", "s-3"],
  },
};

const ida = () => serializeReport(GUARDADO).contentSections;

describe("serializeReport · la ida y la vuelta del contenido", () => {
  it("devuelve TODAS las claves que había guardadas", () => {
    const vuelta = ida();
    const perdidas = Object.keys(GUARDADO.contentSections).filter((k) => !(k in vuelta));
    assert.deepEqual(perdidas, [], `el cajón las reenviaría vacías y se borrarían: ${perdidas.join(", ")}`);
  });

  it("la metodología vuelve: es uno de los tres apartados de la beca", () => {
    assert.equal(ida().methodology, GUARDADO.contentSections.methodology);
  });

  it("la casilla del anexo vuelve encendida, y no se apaga sola", () => {
    assert.equal(ida().anexarRegistros, true);
  });

  it("las sesiones base vuelven: sin ellas el PDF pierde «Periodo» y «Basado en»", () => {
    assert.deepEqual(ida().sourceSessionIds, ["s-1", "s-2", "s-3"]);
  });

  it("y siguen saliendo también a la raíz, que es de donde las leen otras pantallas", () => {
    assert.deepEqual(serializeReport(GUARDADO).sourceSessionIds, ["s-1", "s-2", "s-3"]);
  });

  it("los siete apartados de siempre siguen volviendo con su forma", () => {
    const v = ida();
    assert.equal(typeof v.motiveOfIntervention, "string");
    assert.equal(typeof v.continuityProposal, "string");
    for (const k of ["objectives", "evolution", "achievements", "persistentDifficulties", "recommendations"]) {
      assert.ok(Array.isArray(v[k]), `${k} tiene que ser una lista`);
    }
  });
});

describe("serializeReport · un informe recién creado, sin nada escrito", () => {
  const VACIO = { id: "r-2", reportType: "evolution", status: "draft", contentSections: {} };

  it("da cada clave con su forma vacía, nunca undefined", () => {
    const v = serializeReport(VACIO).contentSections;
    assert.equal(v.motiveOfIntervention, "");
    assert.equal(v.methodology, "");
    assert.equal(v.anexarRegistros, false);
    assert.deepEqual(v.objectives, []);
    assert.deepEqual(v.sourceSessionIds, []);
    for (const [k, valor] of Object.entries(v)) {
      assert.notEqual(valor, undefined, `${k} no puede volver undefined: el cajón lo reenviaría vacío`);
    }
  });

  it("aguanta un contentSections a null o con basura, que es como está en las demos", () => {
    for (const cs of [null, undefined, "una cadena", 42, []]) {
      assert.doesNotThrow(() => serializeReport({ id: "x", reportType: "evolution", status: "draft", contentSections: cs }));
    }
  });

  it("el anexo solo está encendido si vale exactamente true", () => {
    for (const v of ["true", 1, "sí", {}]) {
      const cs = serializeReport({ id: "x", reportType: "evolution", status: "draft", contentSections: { anexarRegistros: v } });
      assert.equal(cs.contentSections.anexarRegistros, false, `${JSON.stringify(v)} no debería encender el anexo`);
    }
  });
});
