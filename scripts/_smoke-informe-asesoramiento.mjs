// @prueba ligera — funciones puras de lib/clinica: sin base de datos, sin
// servidor, sin .env.
/**
 * _smoke-informe-asesoramiento.mjs — el informe de ASESORAMIENTO es un tipo
 * más, no una beca (04/09/2026, lo pidió Aumenta por Rodrigo).
 *
 *   node scripts/_smoke-informe-asesoramiento.mjs
 *
 * Lo que se fija:
 *
 *   1. El tipo EXISTE y se puede crear: está en `REPORT_TYPES` (lo que los
 *      endpoints aceptan) y en `REPORT_TYPES_NUEVOS` (lo que la UI ofrece).
 *      Si se cayera de la segunda lista, el tipo seguiría siendo válido pero
 *      no habría por dónde elegirlo, que es un fallo invisible.
 *   2. Se NOMBRA en los dos registros: «Asesoramiento» en el chip de la lista
 *      y «Informe de asesoramiento» donde el rótulo va solo (la portada del
 *      PDF y las dos cabeceras de pantalla). La segunda lista existe porque
 *      «Informe asesoramiento» no está en español.
 *   3. Sus apartados los pone el CENTRO con sus plantillas, como el evolutivo:
 *      con una plantilla guardada imprime la suya, y sin nada guardado, los
 *      siete de fábrica. Es lo que lo separa de la beca, y por eso se prueban
 *      los dos con el MISMO informe: la beca ignora la plantilla del centro
 *      porque sus apartados los manda la convocatoria.
 *
 * Que la portada del PDF diga «Informe de asesoramiento» de verdad —generando
 * el documento y leyéndolo por dentro— lo fija `_smoke-pdf-factura-informe.mjs`,
 * que ya tiene el lector de PDF montado.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  REPORT_TYPES,
  REPORT_TYPES_NUEVOS,
  REPORT_TYPE_LABEL,
  nombreDelInforme,
  serializeReport,
} from "../lib/clinica/serialize.js";
import { apartadosDelInforme, llevaIndice } from "../lib/clinica/apartadosInforme.js";
import { esInformeBeca } from "../lib/clinica/beca.js";
import { APARTADOS_INFORME_BASE } from "../lib/clinica/plantillas.js";

/* ═══ Los datos de la prueba ═══════════════════════════════════════════════ */

// Un centro que se ha escrito SU plantilla de asesoramiento (que es como se
// espera que lo use Aumenta: los títulos los decide dirección).
const CENTRO = {
  settings: {
    clinica: {
      plantillas: {
        informe: [
          {
            key: "asesoramiento",
            name: "Asesoramiento",
            apartados: [
              { key: "motivo", label: "Motivo de la consulta", tipo: "texto" },
              { key: "pautas", label: "Pautas dadas", tipo: "lista" },
              { key: "seguimiento", label: "Seguimiento acordado", tipo: "texto" },
            ],
          },
        ],
      },
    },
  },
};

const ESCRITO = {
  motivo: "La familia consulta por los deberes.",
  pautas: ["Rutina de estudio de 30 minutos", "Avisar al tutor del colegio"],
  seguimiento: "Se vuelven a ver en un mes.",
};

const informe = (extra = {}) => ({
  id: "r-1",
  reportType: "asesoramiento",
  status: "draft",
  reportDate: "2026-09-04",
  contentSections: {},
  ...extra,
});

/* ═══ 1. El tipo existe y se puede crear ═══════════════════════════════════ */

describe("el tipo de informe de asesoramiento", () => {
  it("es un tipo válido para los endpoints", () => {
    assert.ok(REPORT_TYPES.includes("asesoramiento"), REPORT_TYPES.join(", "));
  });

  it("se puede ELEGIR al crear un informe (los desplegables salen de aquí)", () => {
    assert.ok(REPORT_TYPES_NUEVOS.includes("asesoramiento"), REPORT_TYPES_NUEVOS.join(", "));
  });

  it("no es una beca: no hereda ninguna de sus reglas", () => {
    assert.equal(esInformeBeca("asesoramiento"), false);
  });
});

/* ═══ 2. Cómo se nombra ════════════════════════════════════════════════════ */

describe("cómo se nombra el informe de asesoramiento", () => {
  it("en el chip de la lista, «Asesoramiento»", () => {
    assert.equal(REPORT_TYPE_LABEL.asesoramiento, "Asesoramiento");
    assert.equal(serializeReport(informe()).typeLabel, "Asesoramiento");
    assert.equal(serializeReport(informe()).type, "asesoramiento");
  });

  it("donde el rótulo va solo, «Informe de asesoramiento» y no «Informe asesoramiento»", () => {
    assert.equal(nombreDelInforme("asesoramiento"), "Informe de asesoramiento");
  });

  it("cada tipo tiene su nombre de documento, y lo desconocido cae en «Informe»", () => {
    // La misma lista la leen la portada del PDF y las dos cabeceras: si un tipo
    // se queda fuera, no revienta nada — se queda sin nombre, que es peor.
    for (const t of REPORT_TYPES) {
      assert.notEqual(nombreDelInforme(t), "Informe", `«${t}» se ha quedado sin nombre de documento`);
    }
    assert.equal(nombreDelInforme("loquesea"), "Informe");
    assert.equal(nombreDelInforme(null), "Informe");
    assert.equal(nombreDelInforme(undefined), "Informe");
  });
});

/* ═══ 3. Los apartados los pone el centro ══════════════════════════════════ */

describe("los apartados del informe de asesoramiento", () => {
  it("son los de la plantilla del CENTRO cuando la hay", () => {
    const aps = apartadosDelInforme(informe({ contentSections: ESCRITO }), CENTRO);
    assert.deepEqual(
      aps.map((a) => a.label),
      ["Motivo de la consulta", "Pautas dadas", "Seguimiento acordado"]
    );
    // La lista va como viñetas y el texto libre como párrafos, como en el resto.
    assert.equal(aps[1].lista, true);
    assert.deepEqual(aps[1].parrafos, ["Rutina de estudio de 30 minutos", "Avisar al tutor del colegio"]);
    // Numerados por el documento, del 1 en adelante.
    assert.deepEqual(aps.map((a) => a.n), [1, 2, 3]);
    assert.equal(llevaIndice(informe(), aps), true);
  });

  it("son los siete de fábrica cuando el centro no ha tocado nada", () => {
    const cs = Object.fromEntries(
      APARTADOS_INFORME_BASE.map((a) => [a.key, a.tipo === "lista" ? ["algo"] : "algo"])
    );
    const aps = apartadosDelInforme(informe({ contentSections: cs }), null);
    assert.deepEqual(
      aps.map((a) => a.label),
      APARTADOS_INFORME_BASE.map((a) => a.label)
    );
  });

  it("y NO son los tres de la beca: ese mismo informe, como beca, no imprime nada", () => {
    // La diferencia con la beca, en una línea: el asesoramiento lee la
    // plantilla del centro; la beca la ignora y solo conoce sus tres claves,
    // así que lo escrito en la del centro no le sirve.
    const conPlantilla = apartadosDelInforme(informe({ contentSections: ESCRITO }), CENTRO);
    const comoBeca = apartadosDelInforme(
      informe({ reportType: "beca", contentSections: ESCRITO }),
      CENTRO
    );
    assert.equal(conPlantilla.length, 3);
    assert.equal(comoBeca.length, 0);
  });

  it("el borrador de la IA sin repartir se imprime igual que en los demás tipos", () => {
    // El respaldo del que la beca está excluida a propósito: antes que un PDF
    // en blanco, sale el texto redactado como apartado 1.
    const aps = apartadosDelInforme(informe({ aiGenerated: "El informe entero." }), CENTRO);
    assert.deepEqual(aps.map((a) => a.key), ["aiGenerated"]);
  });
});
