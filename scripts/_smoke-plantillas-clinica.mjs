// @prueba ligera — genera los PDF en memoria y los lee por dentro; sin base de
// datos, sin servidor, sin .env.
/**
 * _smoke-plantillas-clinica.mjs — los apartados de un documento clínico son los
 * que diga su plantilla, y el PDF los imprime (29/08/2026, lo pidió Aumenta por
 * Rodrigo: «q un informe sean un montón de título-cuerpo seguidos y eso se
 * transfiera al pdf»).
 *
 *   node scripts/_smoke-plantillas-clinica.mjs
 *
 * Lo que se fija, que es la letra del encargo y las promesas que lo hacen
 * seguro de desplegar sobre 22.045 sesiones y 1.174 pacientes reales:
 *
 *   1. COMPATIBILIDAD. Un centro que no ha tocado nada, y un documento escrito
 *      antes de que esto existiera, se comportan EXACTAMENTE como siempre: los
 *      siete apartados del informe, los siete del registro, en su orden.
 *   2. La plantilla del centro manda cuando el documento no trae la suya, y la
 *      FOTO del documento manda sobre todo lo demás — un informe de hace un año
 *      se imprime con SUS títulos aunque después se cambie la plantilla entera.
 *   3. Un apartado suelto (el que se añade para un caso concreto, sin guardarlo
 *      en ninguna plantilla) sale en el PDF como cualquier otro.
 *   4. Renombrar un apartado cambia el rótulo, NO dónde está escrito: la clave
 *      se conserva y el texto ya redactado sigue apareciendo.
 *   5. El registro de sesión sale en PDF, con sus apartados y la devolución de
 *      la familia — y sin la preparación, las notas internas ni la
 *      transcripción, que son material interno del equipo.
 *   6. El reparto de un registro no toca las columnas de siempre: lo de fábrica
 *      sigue en `objectives`/`activities`/`performance`/`observations` y solo lo
 *      nuevo va al JSONB. Es lo que deja intactas las sesiones que ya existen.
 *
 * El lector de PDF (objetos → flujos → CMap → operadores de texto) es el mismo
 * de _smoke-pdf-factura-informe.mjs, copiado: cada prueba es autocontenida a
 * propósito (los ficheros de prueba no se importan entre sí).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import {
  APARTADOS_INFORME_BASE,
  APARTADOS_REGISTRO_BASE,
  CLAVE_APARTADOS,
  CLAVE_PLANTILLA,
  aFormulario,
  apartadosPara,
  desdeFormulario,
  limpiarContentSections,
  normalizarApartados,
  normalizarPlantillas,
  plantillasDe,
  repartirValoresDeSesion,
  slugApartado,
  valoresDeSesion,
} from "../lib/clinica/plantillas.js";
import { buildReportPdfBuffer } from "../lib/clinica/reportPdf.js";
import { buildSessionPdfBuffer, sessionPdfFilename } from "../lib/clinica/sessionPdf.js";

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

/** Un centro con SUS plantillas guardadas, como quedan en settings.clinica. */
const centroConPlantillas = {
  settings: {
    clinica: {
      plantillas: {
        informe: [
          {
            key: "alta",
            name: "Informe de alta",
            apartados: [
              { key: "motiveOfIntervention", label: "Por qué vino", tipo: "texto" },
              { key: "situacion_al_alta", label: "Situación al alta", tipo: "texto" },
              { key: "recommendations", label: "Pautas para casa", tipo: "lista" },
            ],
          },
        ],
        registro: [
          {
            key: "corta",
            name: "Sesión corta",
            apartados: [
              { key: "activities", label: "Qué hicimos", tipo: "texto" },
              { key: "clima_de_la_sesion", label: "Clima de la sesión", tipo: "texto" },
            ],
          },
        ],
      },
    },
  },
};

const generarInforme = (report, tenant = null, sourceSessions = []) =>
  buildReportPdfBuffer({
    report,
    patientName: "Leo Prueba",
    therapistName: "Carmen Terapeuta",
    tenantName: "Centro Prueba",
    brand: { primaryColor: "#1B3A2D" },
    tenant,
    sourceSessions,
  });

const generarRegistro = (session, tenant = null) =>
  buildSessionPdfBuffer({
    session,
    patientName: "Leo Prueba",
    therapistName: "Carmen Terapeuta",
    tenantName: "Centro Prueba",
    brand: { primaryColor: "#1B3A2D" },
    tenant,
  });

/* ═══ 1 · Nada cambia para quien no toca nada ══════════════════════════════ */

describe("compatibilidad: sin plantillas guardadas, los apartados son los de siempre", () => {
  it("el informe cae a los siete de fábrica, en su orden", () => {
    assert.deepEqual(
      apartadosPara({}, null, "informe").map((a) => a.key),
      APARTADOS_INFORME_BASE.map((a) => a.key)
    );
  });

  it("el registro cae a los siete de fábrica, en su orden", () => {
    assert.deepEqual(
      apartadosPara({}, null, "registro").map((a) => a.key),
      APARTADOS_REGISTRO_BASE.map((a) => a.key)
    );
  });

  it("una config corrupta se comporta como si no hubiera nada", () => {
    const roto = { settings: { clinica: { plantillas: { informe: "esto no es una lista" } } } };
    assert.deepEqual(
      plantillasDe(roto, "informe")[0].apartados.map((a) => a.key),
      APARTADOS_INFORME_BASE.map((a) => a.key)
    );
    const vacio = { settings: { clinica: { plantillas: { informe: [{ name: "Sin apartados", apartados: [] }] } } } };
    assert.deepEqual(
      plantillasDe(vacio, "informe")[0].apartados.map((a) => a.key),
      APARTADOS_INFORME_BASE.map((a) => a.key)
    );
  });

  it("un informe SIN foto de apartados sigue imprimiendo los siete rótulos de siempre", async () => {
    const { texto } = abrirPdf(
      await generarInforme({
        reportType: "evolution",
        reportDate: "2026-06-30",
        contentSections: {
          motiveOfIntervention: "Motivo escrito.",
          objectives: ["Objetivo uno"],
          evolution: ["Evolución observada"],
          achievements: ["Logro uno"],
          persistentDifficulties: ["Dificultad uno"],
          recommendations: ["Recomendación uno"],
          continuityProposal: "Continuidad propuesta.",
        },
      })
    );
    for (const a of APARTADOS_INFORME_BASE) assert.match(texto, new RegExp(a.label));
  });
});

/* ═══ 2 · La plantilla del centro, y la foto por encima ════════════════════ */

describe("de dónde salen los apartados: la foto manda sobre la plantilla", () => {
  it("sin foto, se usa la plantilla del centro", () => {
    assert.deepEqual(
      apartadosPara({}, centroConPlantillas, "informe").map((a) => a.label),
      ["Por qué vino", "Situación al alta", "Pautas para casa"]
    );
  });

  it("con foto, se usa la foto — aunque el centro haya cambiado su plantilla después", () => {
    const cs = {
      [CLAVE_APARTADOS]: [
        { key: "motiveOfIntervention", label: "Motivo (como se escribió en 2025)", tipo: "texto" },
        { key: "objectives", label: "Objetivos de entonces", tipo: "lista" },
      ],
    };
    assert.deepEqual(
      apartadosPara(cs, centroConPlantillas, "informe").map((a) => a.label),
      ["Motivo (como se escribió en 2025)", "Objetivos de entonces"]
    );
  });

  it("el PDF imprime los títulos del CENTRO y no los siete de fábrica", async () => {
    const { texto } = abrirPdf(
      await generarInforme(
        {
          reportType: "discharge",
          reportDate: "2026-06-30",
          contentSections: {
            motiveOfIntervention: "Llegó por dificultades de lectura.",
            situacion_al_alta: "Lee a velocidad esperada para su curso.",
            recommendations: ["Leer quince minutos al día"],
            // Escritos a propósito: no están en la plantilla del centro y por
            // tanto NO deben imprimirse.
            evolution: ["EVOLUCION QUE NO ESTA EN LA PLANTILLA"],
          },
        },
        centroConPlantillas
      )
    );
    assert.match(texto, /Por qué vino/);
    assert.match(texto, /Situación al alta/);
    assert.match(texto, /Pautas para casa/);
    assert.match(texto, /Lee a velocidad esperada/);
    assert.doesNotMatch(texto, /Motivo de intervención/);
    assert.doesNotMatch(texto, /EVOLUCION QUE NO ESTA EN LA PLANTILLA/);
  });
});

/* ═══ 3 · Apartados sueltos, para un caso concreto ═════════════════════════ */

describe("un apartado suelto se aplica en su documento y en ningún otro sitio", () => {
  it("sale en el PDF junto a los de la plantilla", async () => {
    const { texto } = abrirPdf(
      await generarInforme(
        {
          reportType: "evolution",
          reportDate: "2026-06-30",
          contentSections: {
            [CLAVE_APARTADOS]: [
              ...APARTADOS_INFORME_BASE.map((a) => ({ ...a })),
              { key: "entorno_familiar", label: "Entorno familiar", tipo: "texto" },
            ],
            motiveOfIntervention: "Motivo escrito.",
            entorno_familiar: "Vive con su madre y su abuela.",
          },
        },
        centroConPlantillas
      )
    );
    assert.match(texto, /Entorno familiar/);
    assert.match(texto, /Vive con su madre y su abuela/);
    // Y no se ha guardado en ninguna plantilla: la del centro sigue igual.
    assert.deepEqual(
      plantillasDe(centroConPlantillas, "informe")[0].apartados.map((a) => a.key),
      ["motiveOfIntervention", "situacion_al_alta", "recommendations"]
    );
  });

  it("un apartado sin título no es un apartado, y dos con el mismo no se pisan", () => {
    const limpios = normalizarApartados([
      { label: "   " },
      { label: "Entorno familiar" },
      { label: "Entorno familiar" },
      "esto no es un objeto",
      { label: "Con tipo raro", tipo: "cancion" },
    ]);
    assert.deepEqual(
      limpios.map((a) => `${a.key}:${a.tipo}`),
      ["entorno_familiar:texto", "entorno_familiar_2:texto", "con_tipo_raro:texto"]
    );
  });

  it("no se puede secuestrar una clave con significado propio", () => {
    const limpios = normalizarApartados([
      { key: "sourceSessionIds", label: "Sesiones" },
      { key: CLAVE_APARTADOS, label: "Apartados" },
      { key: "referralSpecialty", label: "Especialidad" },
    ]);
    // Ninguna conserva la clave pedida: se les da la del slug de su título, y
    // si ese slug también está reservado se le pone prefijo — el apartado
    // sobrevive con otra clave, nunca desaparece en silencio.
    assert.deepEqual(limpios.map((a) => a.key), ["sesiones", "ap_apartados", "especialidad"]);
  });
});

/* ═══ 4 · Renombrar cambia el rótulo, no dónde está escrito ════════════════ */

describe("renombrar un apartado no deja huérfano lo ya redactado", () => {
  it("editar el título desde Configuración conserva la clave (la manda la pantalla)", () => {
    const previas = plantillasDe(null, "informe");
    // Es lo que hace la tarjeta: cambia `label` sobre el apartado y deja `key`.
    const editadas = normalizarPlantillas(
      [
        {
          key: "base",
          name: "Informe clínico",
          apartados: previas[0].apartados.map((a) =>
            a.key === "evolution" ? { ...a, label: "Evolución del curso" } : a
          ),
        },
      ],
      { previas }
    );
    const evolucion = editadas[0].apartados.find((a) => a.label === "Evolución del curso");
    assert.equal(evolucion.key, "evolution");
  });

  it("y si la lista llega SIN claves, se recuperan por el título que no cambió", () => {
    const previas = plantillasDe(null, "informe");
    const editadas = normalizarPlantillas(
      [
        {
          key: "base",
          name: "Informe clínico",
          // Ni una sola `key`: es lo que llegaría de una integración o de un
          // pegado a mano. Los títulos intactos recuperan su clave; el que se
          // reescribió estrena la suya, que es lo correcto — nadie puede saber
          // a cuál de los siete quería referirse.
          apartados: previas[0].apartados.map((a) =>
            a.key === "evolution" ? { label: "Evolución del curso", tipo: a.tipo } : { label: a.label, tipo: a.tipo }
          ),
        },
      ],
      { previas }
    );
    const claves = editadas[0].apartados.map((a) => a.key);
    assert.ok(claves.includes("motiveOfIntervention"));
    assert.ok(claves.includes("recommendations"));
    assert.ok(claves.includes("evolucion_del_curso"));
    assert.ok(!claves.includes("evolution"));
  });

  it("y el texto que ya había sigue apareciendo bajo el título nuevo", async () => {
    const centro = {
      settings: {
        clinica: {
          plantillas: {
            informe: [
              {
                key: "base",
                name: "Informe clínico",
                apartados: [{ key: "evolution", label: "Evolución del curso", tipo: "lista" }],
              },
            ],
          },
        },
      },
    };
    const { texto } = abrirPdf(
      await generarInforme(
        { reportType: "evolution", reportDate: "2026-06-30", contentSections: { evolution: ["Mejora sostenida"] } },
        centro
      )
    );
    assert.match(texto, /Evolución del curso/);
    assert.match(texto, /Mejora sostenida/);
  });
});

/* ═══ 5 · El PDF del registro de sesión ════════════════════════════════════ */

const SESION = {
  sessionDate: "2026-05-14T10:00:00.000Z",
  duration: 45,
  objectives: ["Discriminación auditiva", "Praxias linguales"],
  activities: "Juego de parejas y lectura compartida.",
  performance: "Participativo, se cansa en el último tramo.",
  observations: {
    familyComments: "La madre nota mejoría en casa.",
    nextSessionNotes: "Seguir con praxias.",
    homeworkTasks: "Leer diez minutos al día.",
    incidents: "",
  },
  parentFeedback: "DEVOLUCION LITERAL DE LA FAMILIA",
  // Material interno del equipo: NADA de esto puede salir en un PDF.
  prepText: "PREPARACION INTERNA QUE NUNCA DEBE SALIR",
  internalNotes: "NOTA INTERNA SOBRE LA FAMILIA QUE NUNCA DEBE SALIR",
  aiTranscription: "TRANSCRIPCION LITERAL DEL AUDIO QUE NUNCA DEBE SALIR",
  contentSections: {},
};

describe("el registro de sesión sale en PDF", () => {
  it("con sus apartados, sus datos y la devolución de la familia", async () => {
    const { texto } = abrirPdf(await generarRegistro(SESION));
    assert.match(texto, /Registro de sesión/);
    assert.match(texto, /Centro Prueba/);
    assert.match(texto, /Leo Prueba/);
    assert.match(texto, /Carmen Terapeuta/);
    assert.match(texto, /45 minutos/);
    for (const label of ["Objetivos trabajados", "Actividades realizadas", "Desempeño", "Comentarios familiares", "Próximas sesiones", "Tareas para casa"]) {
      assert.match(texto, new RegExp(label));
    }
    assert.match(texto, /Discriminación auditiva/);
    assert.match(texto, /Juego de parejas/);
    assert.match(texto, /Devolución de la familia/);
    assert.match(texto, /DEVOLUCION LITERAL DE LA FAMILIA/);
    // «Incidencias» está vacío: ni su texto ni su titular.
    assert.doesNotMatch(texto, /Incidencias/);
  });

  it("NUNCA lleva la preparación, las notas internas ni la transcripción", async () => {
    const { texto } = abrirPdf(await generarRegistro(SESION));
    assert.doesNotMatch(texto, /PREPARACION INTERNA/);
    assert.doesNotMatch(texto, /NOTA INTERNA SOBRE LA FAMILIA/);
    assert.doesNotMatch(texto, /TRANSCRIPCION LITERAL/);
  });

  it("con la plantilla del centro, imprime SUS títulos", async () => {
    const { texto } = abrirPdf(
      await generarRegistro({ ...SESION, contentSections: { clima_de_la_sesion: "Tranquilo y receptivo." } }, centroConPlantillas)
    );
    assert.match(texto, /Qué hicimos/);
    assert.match(texto, /Clima de la sesión/);
    assert.match(texto, /Tranquilo y receptivo/);
    // La plantilla del centro no tiene «Objetivos trabajados»: no se imprime.
    assert.doesNotMatch(texto, /Objetivos trabajados/);
  });

  it("un registro vacío avisa, en vez de salir un folio en blanco", async () => {
    const { texto } = abrirPdf(
      await generarRegistro({ sessionDate: "2026-05-14T10:00:00.000Z", objectives: [], observations: {}, contentSections: {} })
    );
    assert.match(texto, /todavía no tiene contenido/);
  });

  it("el nombre del fichero lleva el tipo, el paciente y el día", () => {
    assert.equal(sessionPdfFilename(SESION, "Leo Prueba"), "Registro de sesión - Leo Prueba - 2026-05-14.pdf");
    // Sin fecha válida no se cuela un guion suelto ni un «Invalid Date».
    assert.equal(sessionPdfFilename({ sessionDate: "no es una fecha" }, "Leo/Prueba"), "Registro de sesión - LeoPrueba.pdf");
  });
});

/* ═══ 6 · El reparto no toca las columnas de siempre ═══════════════════════ */

describe("un registro guarda lo de fábrica en sus columnas y solo lo nuevo en el JSONB", () => {
  const apartados = [
    { key: "objectives", label: "Objetivos trabajados", tipo: "lista" },
    { key: "activities", label: "Actividades realizadas", tipo: "texto" },
    { key: "clima_de_la_sesion", label: "Clima de la sesión", tipo: "texto" },
  ];

  it("reparte cada apartado a su sitio", () => {
    const bolsa = desdeFormulario(
      { objectives: "Uno\nDos", activities: "Lectura compartida", clima_de_la_sesion: "Tranquilo" },
      apartados
    );
    const reparto = repartirValoresDeSesion(bolsa, apartados);
    assert.deepEqual(reparto.objectives, ["Uno", "Dos"]);
    assert.equal(reparto.activities, "Lectura compartida");
    assert.equal(reparto.contentSections.clima_de_la_sesion, "Tranquilo");
    // Lo nuevo NO se cuela en las observaciones, que viajan al anexo del informe.
    assert.deepEqual(Object.keys(reparto.observations).sort(), [
      "familyComments",
      "homeworkTasks",
      "incidents",
      "nextSessionNotes",
    ]);
    // Y queda la foto de con qué se escribió.
    assert.deepEqual(reparto.contentSections[CLAVE_APARTADOS].map((a) => a.key), apartados.map((a) => a.key));
  });

  it("ida y vuelta: lo guardado se vuelve a leer igual en el formulario", () => {
    const form = { objectives: "Uno\nDos", activities: "Lectura", clima_de_la_sesion: "Tranquilo" };
    const reparto = repartirValoresDeSesion(desdeFormulario(form, apartados), apartados);
    assert.deepEqual(aFormulario(valoresDeSesion(reparto), apartados), form);
  });

  it("un apartado de fábrica que la plantilla ya no usa deja su columna vacía, no a medias", () => {
    const reparto = repartirValoresDeSesion({ activities: "Solo esto" }, [
      { key: "activities", label: "Actividades", tipo: "texto" },
    ]);
    assert.deepEqual(reparto.objectives, []);
    assert.equal(reparto.performance, "");
    assert.equal(reparto.observations.familyComments, "");
  });

  it("`contentSections` que llega de un navegador se limpia antes de guardarse", () => {
    const sucio = limpiarContentSections({
      [CLAVE_APARTADOS]: "esto no es una lista",
      [CLAVE_PLANTILLA]: { no: "es una clave" },
      clima_de_la_sesion: "Tranquilo",
    });
    assert.deepEqual(sucio[CLAVE_APARTADOS], []);
    assert.equal(sucio[CLAVE_PLANTILLA], "[object Object]".slice(0, 64));
    assert.equal(sucio.clima_de_la_sesion, "Tranquilo");
    assert.deepEqual(limpiarContentSections(null), {});
    assert.deepEqual(limpiarContentSections(["lista"]), {});
  });

  it("el slug de un título es una clave usable, siempre", () => {
    assert.equal(slugApartado("Situación Académica (2026)"), "situacion_academica_2026");
    assert.equal(slugApartado("123"), "ap_123");
    assert.equal(slugApartado("   "), "");
  });
});

/* ═══ 7 · El anexo del informe también respeta la plantilla ════════════════ */

describe("el anexo literal imprime cada sesión con SUS apartados", () => {
  it("con la plantilla del centro, y sin lo interno", async () => {
    const { texto } = abrirPdf(
      await generarInforme(
        {
          reportType: "evolution",
          reportDate: "2026-06-30",
          contentSections: {
            motiveOfIntervention: "Motivo escrito.",
            anexarRegistros: true,
            sourceSessionIds: ["da-igual"],
          },
        },
        centroConPlantillas,
        [{ ...SESION, contentSections: { clima_de_la_sesion: "Tranquilo y receptivo." } }]
      )
    );
    assert.match(texto, /Anexo · Registros de sesión/);
    assert.match(texto, /QUÉ HICIMOS/);
    assert.match(texto, /CLIMA DE LA SESIÓN/);
    assert.match(texto, /Tranquilo y receptivo/);
    assert.match(texto, /DEVOLUCIÓN DE LA FAMILIA/);
    assert.doesNotMatch(texto, /PREPARACION INTERNA/);
    assert.doesNotMatch(texto, /NOTA INTERNA SOBRE LA FAMILIA/);
  });
});
