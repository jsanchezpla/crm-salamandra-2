// @prueba ligera — genera el PDF en memoria y lo lee por dentro; sin base de
// datos, sin servidor, sin .env.
/**
 * _smoke-informe-beca.mjs — el informe para la beca dice lo que la convocatoria
 * pide, y nada más (26/08/2026, lo pidió Aumenta).
 *
 *   node scripts/_smoke-informe-beca.mjs
 *
 * Lo que se fija, que es la letra del encargo:
 *
 *   1. La CABECERA lleva el nombre OFICIAL del servicio, no el del centro:
 *      logopedia → «Reeducación del lenguaje»; psicología, terapia ocupacional
 *      o pedagogía → «Reeducación pedagógica y habilidades sociales». Una
 *      especialidad fuera de la convocatoria no sale (no se le inventa nombre).
 *   2. Solo TRES apartados: motivo de consulta, objetivos y metodología. La
 *      evolución, los logros y el texto bruto de la IA NO se cuelan aunque
 *      estén escritos: la beca pide lo que pide.
 *   3. La FIRMA del terapeuta va al pie (raya + «Fdo.:»), también cuando el
 *      informe está vacío.
 *   4. Los demás tipos de informe no cambian ni un pelo: mismo rótulo de
 *      siempre y sin firma.
 *
 * El lector de PDF (objetos → flujos → CMap → operadores de texto) es el mismo
 * de _smoke-pdf-factura-informe.mjs, copiado: cada prueba es autocontenida a
 * propósito (los ficheros de prueba no se importan entre sí).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import { denominacionesBeca, SECCIONES_BECA, esInformeBeca } from "../lib/clinica/beca.js";
import { buildReportPdfBuffer, reportPdfFilename } from "../lib/clinica/reportPdf.js";

/* ═══ Lector de PDF (copiado de _smoke-pdf-factura-informe.mjs) ═══════════ */

// prettier-ignore
const WIN1252 = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
  0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘",
  0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜",
  0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

function objetosDe(bruto) {
  const re = /(?:^|\n)(\d+) 0 obj/g;
  const marcas = [];
  let m;
  while ((m = re.exec(bruto))) {
    marcas.push({ num: Number(m[1]), desde: m.index + (m[0][0] === "\n" ? 1 : 0) });
  }
  const objetos = new Map();
  for (let i = 0; i < marcas.length; i++) {
    const hasta = i + 1 < marcas.length ? marcas[i + 1].desde : bruto.length;
    objetos.set(marcas[i].num, bruto.slice(marcas[i].desde, hasta));
  }
  return objetos;
}

function flujoDe(objeto) {
  const i = objeto.indexOf("stream");
  if (i < 0) return "";
  const desde = objeto.indexOf("\n", i) + 1;
  const hasta = objeto.lastIndexOf("endstream");
  if (hasta < 0) return "";
  const datos = Buffer.from(objeto.slice(desde, hasta), "latin1");
  if (!/\/FlateDecode/.test(objeto.slice(0, i))) return datos.toString("latin1");
  try {
    return zlib.inflateSync(datos).toString("latin1");
  } catch {
    return "";
  }
}

const bytesDeHex = (hex) => Buffer.from(hex.replace(/\s+/g, ""), "hex");

function letrasUtf16(hex) {
  const b = bytesDeHex(hex);
  let salida = "";
  for (let i = 0; i + 1 < b.length; i += 2) salida += String.fromCharCode((b[i] << 8) | b[i + 1]);
  return salida;
}

function cmapDe(texto) {
  const mapa = new Map();
  for (const bloque of texto.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const par of bloque.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      mapa.set(parseInt(par[1], 16), letrasUtf16(par[2]));
    }
  }
  for (const bloque of texto.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:\[([\s\S]*?)\]|<([0-9A-Fa-f]+)>)/g;
    let m;
    while ((m = re.exec(bloque))) {
      const primero = parseInt(m[1], 16);
      const ultimo = parseInt(m[2], 16);
      if (m[3] != null) {
        const destinos = m[3].match(/<[0-9A-Fa-f]*>/g) || [];
        destinos.forEach((d, i) => mapa.set(primero + i, letrasUtf16(d.slice(1, -1))));
      } else {
        const base = parseInt(m[4], 16);
        for (let c = primero; c <= ultimo; c++)
          mapa.set(c, String.fromCharCode(base + (c - primero)));
      }
    }
  }
  return mapa;
}

function descodifica(hex, cmap) {
  const b = bytesDeHex(hex);
  if (!cmap) {
    let salida = "";
    for (const byte of b) salida += WIN1252[byte] ?? String.fromCharCode(byte);
    return salida;
  }
  let salida = "";
  for (let i = 0; i + 1 < b.length; i += 2) salida += cmap.get((b[i] << 8) | b[i + 1]) ?? "";
  return salida;
}

const OPERADORES =
  /\/(F\d+)\s+[\d.]+\s+Tf|1 0 0 1 ([\d.]+) ([\d.]+) Tm|\[([\s\S]*?)\]\s*TJ|<([0-9A-Fa-f\s]*)>\s*Tj/g;

function abrirPdf(buffer) {
  const bruto = buffer.toString("latin1");
  const objetos = objetosDe(bruto);

  const paginas = [];
  for (const [, objeto] of objetos) {
    if (!/\/Type\s*\/Page[^s]/.test(objeto)) continue;
    const contenido = objeto.match(/\/Contents\s+(\d+) 0 R/);
    const recursos = objeto.match(/\/Resources\s+(\d+) 0 R/);
    if (contenido) {
      paginas.push({ contenido: Number(contenido[1]), recursos: recursos ? Number(recursos[1]) : null });
    }
  }

  const salida = paginas.map((pagina) => {
    const fuentes = new Map();
    const bloque = /\/Font\s*<<([\s\S]*?)>>/.exec(objetos.get(pagina.recursos) || "");
    for (const f of bloque ? bloque[1].matchAll(/\/(F\d+)\s+(\d+) 0 R/g) : []) {
      const aUnicode = /\/ToUnicode\s+(\d+) 0 R/.exec(objetos.get(Number(f[2])) || "");
      fuentes.set(f[1], aUnicode ? cmapDe(flujoDe(objetos.get(Number(aUnicode[1])) || "")) : null);
    }

    const contenido = flujoDe(objetos.get(pagina.contenido) || "");
    const lineas = [];
    let cmap = null;
    let m;
    OPERADORES.lastIndex = 0;
    while ((m = OPERADORES.exec(contenido))) {
      if (m[1] != null) {
        cmap = fuentes.get(m[1]) ?? null;
        continue;
      }
      if (m[2] != null) continue;
      let linea = "";
      if (m[4] != null) {
        for (const trozo of m[4].match(/<[0-9A-Fa-f\s]*>/g) || []) {
          linea += descodifica(trozo.slice(1, -1), cmap);
        }
      } else {
        linea = descodifica(m[5], cmap);
      }
      if (linea) lineas.push(linea);
    }
    return { texto: lineas.join("\n") };
  });

  return { texto: salida.map((p) => p.texto).join("\n") };
}

/* ═══ Piezas de ejemplo ════════════════════════════════════════════════════ */

const informeBeca = (extra = {}) => ({
  reportType: "beca",
  reportDate: "2026-09-15",
  aiGenerated: "TEXTO BRUTO DE LA IA QUE NO DEBE SALIR",
  contentSections: {
    motiveOfIntervention: "Dificultades en la adquisición del lenguaje oral.",
    objectives: ["Ampliar el repertorio fonético", "Mejorar la comprensión de consignas"],
    methodology: "Sesiones individuales semanales con enfoque conductual y apoyo visual.",
    // Escritos A PROPÓSITO: la beca no los imprime aunque existan.
    evolution: ["EVOLUCION QUE NO DEBE SALIR"],
    achievements: ["LOGRO QUE NO DEBE SALIR"],
    ...extra,
  },
});

const generar = (report, patientSpecialties, sourceSessions = []) =>
  buildReportPdfBuffer({
    report,
    patientName: "Leo Prueba",
    therapistName: "Carmen Terapeuta",
    tenantName: "Centro Prueba",
    brand: { primaryColor: "#1B3A2D" },
    patientSpecialties,
    sourceSessions,
  });

/** Dos sesiones de ejemplo para el periodo y el anexo. */
const SESIONES = [
  {
    sessionDate: "2025-01-16",
    objectives: ["OBJETIVO LITERAL UNO"],
    activities: "ACTIVIDAD LITERAL QUE SOLO SALE EN EL ANEXO",
    performance: "Desempeño literal.",
    observations: { familyComments: "Comentario familiar literal.", nextSessionNotes: "", homeworkTasks: "", incidents: "" },
    parentFeedback: "DEVOLUCION LITERAL DE LA FAMILIA",
    prepText: "PREPARACION INTERNA QUE NUNCA DEBE SALIR",
    // Notas internas (29/08/2026): van en la sesión a propósito aunque hoy
    // `sesionesDelInforme.js` ni las cargue. Si mañana alguien añade la columna
    // a ese SELECT «para tenerlo todo», esta prueba lo caza aquí y no en el PDF
    // que ya tiene la familia.
    internalNotes: "NOTA INTERNA SOBRE LA FAMILIA QUE NUNCA DEBE SALIR",
  },
  {
    sessionDate: "2025-01-23",
    objectives: [],
    activities: "Segunda actividad literal.",
    performance: "",
    observations: {},
    parentFeedback: "",
  },
];

/* ═══ 1 · La regla de los nombres oficiales (función pura) ═════════════════ */

describe("denominacionesBeca traduce a los nombres de la convocatoria", () => {
  it("logopedia es Reeducación del lenguaje", () => {
    assert.deepEqual(denominacionesBeca(["logopedia"]), ["Reeducación del lenguaje"]);
  });
  it("psicología, terapia ocupacional y pedagogía son UNA sola denominación, sin repetir", () => {
    assert.deepEqual(denominacionesBeca(["psicologia", "terapia_ocupacional", "pedagogia"]), [
      "Reeducación pedagógica y habilidades sociales",
    ]);
  });
  it("con las dos familias salen las dos, cada una una vez", () => {
    assert.deepEqual(denominacionesBeca(["logopedia", "psicologia", "pedagogia"]), [
      "Reeducación del lenguaje",
      "Reeducación pedagógica y habilidades sociales",
    ]);
  });
  it("una especialidad fuera de la convocatoria no sale (no se le inventa nombre)", () => {
    assert.deepEqual(denominacionesBeca(["nutricion", "fisioterapia"]), []);
    assert.deepEqual(denominacionesBeca(null), []);
  });
  it("los apartados de la beca son tres y en su orden", () => {
    assert.deepEqual(
      SECCIONES_BECA.map((s) => s.label),
      ["Motivo de consulta", "Objetivos", "Metodología"]
    );
    assert.equal(esInformeBeca("beca"), true);
    assert.equal(esInformeBeca("evolution"), false);
  });
});

/* ═══ 2 · El PDF de la beca ════════════════════════════════════════════════ */

describe("el PDF del informe de beca", () => {
  it("cabecera oficial, tres apartados, y ni rastro de lo demás", async () => {
    const buffer = await generar(informeBeca(), ["logopedia", "psicologia"]);
    const { texto } = abrirPdf(buffer);

    // La cabecera: el título del tipo y los nombres OFICIALES del servicio.
    assert.match(texto, /Informe para beca/);
    assert.match(texto, /Reeducación del lenguaje/);
    assert.match(texto, /Reeducación pedagógica y habilidades sociales/);

    // Los tres apartados, con el rótulo de la convocatoria.
    assert.match(texto, /Motivo de consulta/);
    assert.match(texto, /Objetivos/);
    assert.match(texto, /Metodología/);
    assert.match(texto, /repertorio fonético/);
    assert.match(texto, /enfoque conductual/);

    // Lo que NO pide la beca no se cuela, aunque esté escrito.
    assert.doesNotMatch(texto, /Motivo de intervención/);
    assert.doesNotMatch(texto, /EVOLUCION QUE NO DEBE SALIR/);
    assert.doesNotMatch(texto, /LOGRO QUE NO DEBE SALIR/);
    assert.doesNotMatch(texto, /TEXTO BRUTO DE LA IA/);

    // La firma del terapeuta, al pie.
    assert.match(texto, /Fdo\.: Carmen Terapeuta/);
    assert.match(texto, /Terapeuta/);
  });

  it("vacío, avisa de que no hay contenido pero la firma sigue estando", async () => {
    const buffer = await generar(
      { reportType: "beca", reportDate: "2026-09-15", contentSections: {} },
      ["logopedia"]
    );
    const { texto } = abrirPdf(buffer);
    assert.match(texto, /todavía no tiene contenido/);
    assert.match(texto, /Fdo\.:/);
  });

  it("el nombre del fichero lleva el tipo Beca", () => {
    const nombre = reportPdfFilename(informeBeca(), "Leo Prueba");
    assert.equal(nombre, "Beca - Leo Prueba - 2026-09-15.pdf");
  });
});

/* ═══ 3 · El periodo, las fechas y el anexo (26/08/2026, Rodrigo) ══════════ */
/* «El informe es el resumen que redacta la terapeuta. El único contenido de
   las sesiones que debería salir es la fecha; los registros literales, como
   anexo opcional.» */

describe("de las sesiones, la portada solo dice las fechas", () => {
  const informeEvolutivo = (extraCs = {}) => ({
    reportType: "evolution",
    reportDate: "2025-01-30",
    contentSections: {
      motiveOfIntervention: "Redacción de la profesional.",
      evolution: ["Resumen redactado, no literal."],
      ...extraCs,
    },
  });

  it("con sesiones detrás, imprime periodo y en cuáles se basa — sin su contenido", async () => {
    const buffer = await generar(informeEvolutivo(), [], SESIONES);
    const { texto } = abrirPdf(buffer);
    // 28/08/2026: el rótulo «Periodo» ya no existe. Con el rediseño, el periodo
    // es la pastilla de la portada y las fechas van en el «Basado en» del
    // cuerpo. Lo que importa —que se digan las fechas y no el contenido de las
    // sesiones— se sigue comprobando igual, y en las dos líneas de abajo.
    assert.match(texto, /del 16 de enero de 2025 al 23 de enero de 2025/);
    assert.match(texto, /Basado en/i);
    assert.match(texto, /2 sesiones/);
    // Las fechas sí; lo literal, NO (el anexo está apagado).
    assert.doesNotMatch(texto, /ACTIVIDAD LITERAL/);
    assert.doesNotMatch(texto, /Anexo/);
  });

  it("sin sesiones, esas filas no se imprimen (ni su rótulo)", async () => {
    const buffer = await generar(informeEvolutivo(), [], []);
    const { texto } = abrirPdf(buffer);
    assert.doesNotMatch(texto, /Basado en/i);
    assert.doesNotMatch(texto, /sesiones/i);
  });

  it("con la casilla del anexo, los registros literales van al final — menos la preparación", async () => {
    const buffer = await generar(informeEvolutivo({ anexarRegistros: true }), [], SESIONES);
    const { texto } = abrirPdf(buffer);
    assert.match(texto, /Anexo · Registros de sesión/);
    assert.match(texto, /Sesión del 16 de enero de 2025/);
    assert.match(texto, /Sesión del 23 de enero de 2025/);
    assert.match(texto, /ACTIVIDAD LITERAL QUE SOLO SALE EN EL ANEXO/);
    assert.match(texto, /DEVOLUCION LITERAL DE LA FAMILIA/);
    // La preparación es material interno del equipo: JAMÁS en el PDF de la familia.
    assert.doesNotMatch(texto, /PREPARACION INTERNA/);
    // Y las notas internas, lo mismo y con más motivo: ahí se escribe lo que el
    // equipo piensa de la familia (Aumenta, 29/08/2026).
    assert.doesNotMatch(texto, /NOTA INTERNA SOBRE LA FAMILIA/);
  });

  it("la beca no lleva ni periodo ni anexo, aunque haya sesiones y casilla", async () => {
    const buffer = await generar(
      { ...informeBeca({ anexarRegistros: true }) },
      ["logopedia"],
      SESIONES
    );
    const { texto } = abrirPdf(buffer);
    assert.doesNotMatch(texto, /Periodo/i);
    assert.doesNotMatch(texto, /Anexo/);
    assert.doesNotMatch(texto, /ACTIVIDAD LITERAL/);
  });
});

/* ═══ 4 · Los demás tipos no cambian ═══════════════════════════════════════ */

describe("un informe evolutivo sigue exactamente igual", () => {
  it("rótulo de siempre, sus secciones, y sin firma", async () => {
    const buffer = await generar(
      {
        reportType: "evolution",
        reportDate: "2026-09-15",
        contentSections: {
          motiveOfIntervention: "Motivo de siempre.",
          evolution: ["Una línea de evolución."],
        },
      },
      ["logopedia"]
    );
    const { texto } = abrirPdf(buffer);
    // 28/08/2026: en la portada el documento se NOMBRA («Informe de evolución»),
    // no se etiqueta. «Evolutivo» es el rótulo de la lista de informes, escrito
    // para caber en un chip; en cuerpo 30 y solo, no es el nombre de nada.
    assert.match(texto, /Informe de evolución/);
    assert.match(texto, /Motivo de intervención/);
    assert.match(texto, /Una línea de evolución/);
    // Los nombres oficiales de la convocatoria siguen siendo SOLO de la beca.
    assert.doesNotMatch(texto, /Reeducación/);
    /*
     * La FIRMA sí sale ahora, y es el cambio de fondo del rediseño: antes solo
     * la llevaba la beca, porque la convocatoria la exige. Un informe clínico
     * que una familia presenta en el colegio lo firma quien lo redacta, sea del
     * tipo que sea — por eso el bloque de firma dejó de ser una excepción.
     */
    assert.match(texto, /Fdo\.:/);
  });
});
