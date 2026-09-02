// @prueba ligera — /lib y pdfkit en memoria; sin base, sin servidor, sin .env.
/**
 * _smoke-registro-pdf.mjs — el PDF del registro de sesión CON PORTADA
 * (03/09/2026, Rodrigo: «quiero que los registros de sesión de todo tipo —el
 * de talleres, el de la entrevista inicial y los normales— tengan la portada
 * tipo los informes grandes, pero solo de una sesión, y el diseño de dentro
 * también»).
 *
 *   node scripts/_smoke-registro-pdf.mjs
 *   node --test-name-pattern="entrevista" scripts/_smoke-registro-pdf.mjs
 *
 * ── QUÉ SE ESTÁ PROTEGIENDO ────────────────────────────────────────────────
 *
 * El registro pasa de una hoja de trabajo a un documento con portada, apartados
 * numerados, firma y cierre, compuesto con las MISMAS piezas que el informe
 * (`lib/clinica/documentoPdf.js`). Con eso entran fallos que antes no existían:
 *
 *   1. **Se nombra mal.** La portada dice en 30 puntos qué documento es. Una
 *      entrevista inicial que salga rotulada «Registro de sesión», o un
 *      registro de taller sin el nombre del taller, es un documento que la
 *      familia no reconoce.
 *   2. **El número del margen y el del título no casan.** La plantilla de la
 *      entrevista trae sus títulos numerados («3. Antecedentes personales»); el
 *      documento numera solo lo que imprime. Si el 1 está vacío, saldría «1 ·
 *      2. Motivo de consulta». Se quita el número del título al imprimir.
 *   3. **Lo interno se cuela por el diseño nuevo.** La preparación, las notas
 *      internas y la transcripción NO salen, y con portada y firma tampoco.
 *   4. **El registro no se genera.** Sin marca, sin centro, sin fecha de
 *      nacimiento, sin profesional: cada hueco tiene que caerse solo.
 *
 * El informe (`reportPdf.js`) usa las mismas piezas: que siga igual lo fija
 * `_smoke-informe-pdf.mjs`, que corre en el mismo `npm test`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import {
  buildSessionPdfBuffer,
  sessionPdfFilename,
  tituloDeRegistro,
  apartadosDelRegistro,
} from "../lib/clinica/sessionPdf.js";
import { sinNumeroDelante, apartadosDelInforme } from "../lib/clinica/apartadosInforme.js";
import { APARTADOS_ENTREVISTA_BASE, PLANTILLA_ENTREVISTA } from "../lib/clinica/plantillas.js";
import { CLAVE_NOTA_INDIVIDUAL } from "../lib/clinica/tallerSesion.js";

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

  return { texto: salida.map((p) => p.texto).join("\n"), paginas: salida.map((p) => p.texto) };
}



/* ═══ Piezas de ejemplo ════════════════════════════════════════════════════ */

const comoTexto = (buf) => buf.toString("latin1");
/** Nº de páginas: `/Type /Page` sin la «s» de `/Pages`. */
const paginasDe = (buf) => (comoTexto(buf).match(/\/Type\s*\/Page[^s]/g) || []).length;
const esPdf = (buf) => Buffer.isBuffer(buf) && comoTexto(buf).startsWith("%PDF-") && comoTexto(buf).includes("%%EOF");

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

/** Una entrevista inicial con TODOS sus apartados escritos. */
const ENTREVISTA = {
  ...SESION,
  objectives: [],
  activities: "",
  performance: "",
  observations: {},
  contentSections: {
    plantilla: PLANTILLA_ENTREVISTA.key,
    apartados: APARTADOS_ENTREVISTA_BASE.map((a) => ({ ...a })),
    ...Object.fromEntries(
      APARTADOS_ENTREVISTA_BASE.map((a) => [a.key, a.tipo === "lista" ? [`Punto de ${a.key}`] : `Texto de ${a.key}.`])
    ),
  },
};

const TALLER = {
  ...SESION,
  tallerSesionId: "11111111-1111-4111-8111-111111111111",
  contentSections: {
    apartados: [
      { key: "activities", label: "Qué hicimos", tipo: "texto" },
      { key: CLAVE_NOTA_INDIVIDUAL, label: "Nota individual", tipo: "texto" },
    ],
    [CLAVE_NOTA_INDIVIDUAL]: "Hoy participó y esperó su turno.",
  },
};

const CENTRO = {
  settings: {
    centro: {
      razonSocial: "Centro de ejemplo S.L.",
      cif: "B00000000",
      telefonos: ["91 000 00 00"],
      proteccionDatos: "TEXTO LEGAL DE PROTECCION DE DATOS.",
      sedes: [{ nombre: "Sede central", direccion: "C/ Ejemplo 1", cp: "28000", ciudad: "Fuenlabrada", registroSanitario: "CS00000", telefono: "" }],
    },
  },
};

const generar = (session, extra = {}) =>
  buildSessionPdfBuffer({
    session,
    patientName: "Leo Prueba",
    therapistName: "Carmen Terapeuta",
    tenantName: "Centro Prueba",
    brand: { primaryColor: "#1B3A2D" },
    ...extra,
  });

/* ═══ 1 · Portada ══════════════════════════════════════════════════════════ */

describe("el registro lleva portada, como el informe", () => {
  it("la primera página es la portada y el cuerpo empieza en la segunda", async () => {
    const buf = await generar(SESION);
    assert.ok(esPdf(buf));
    assert.ok(paginasDe(buf) >= 2, `páginas: ${paginasDe(buf)}`);
    const { paginas } = abrirPdf(buf);
    assert.match(paginas[0], /Registro de sesión/);
    assert.match(paginas[0], /PACIENTE/);
    assert.match(paginas[0], /Leo Prueba/);
    assert.match(paginas[0], /PROFESIONAL RESPONSABLE/);
    assert.match(paginas[0], /Carmen Terapeuta/);
    // El cuerpo (los apartados) NO está en la portada.
    assert.doesNotMatch(paginas[0], /Discriminación auditiva/);
    assert.match(paginas[1], /Discriminación auditiva/);
  });

  it("la pastilla dice el DÍA de la sesión, y la edad es la de ese día", async () => {
    const { paginas } = abrirPdf(await generar(SESION, { patientBirthDate: "2020-09-01" }));
    assert.match(paginas[0], /14 de mayo de 2026/);
    // El 14/05/2026 tenía 5 años y 8 meses. Hoy tendría 6: si sale «6 años» se
    // está calculando con la fecha de hoy.
    assert.match(paginas[0], /5 años y 8 meses/);
    assert.doesNotMatch(paginas[0], /6 años/);
  });

  it("con especialidad, el servicio bajo el título; sin ella, nada", async () => {
    const con = abrirPdf(await generar(SESION, { patientSpecialties: ["logopedia"] }));
    assert.match(con.paginas[0], /Servicio de Logopedia/);
    const sin = abrirPdf(await generar(SESION));
    assert.doesNotMatch(sin.texto, /Servicio de/);
  });

  it("sin profesional no hay bloque de responsable ni firma, y el PDF sale igual", async () => {
    const { texto } = abrirPdf(await generar(SESION, { therapistName: null }));
    assert.doesNotMatch(texto, /PROFESIONAL RESPONSABLE/);
    assert.doesNotMatch(texto, /Fdo\.:/);
    assert.match(texto, /Discriminación auditiva/);
  });

  it("sin marca, sin centro, sin fecha de nacimiento y sin tenant se genera igual", async () => {
    const buf = await buildSessionPdfBuffer({ session: SESION, patientName: "", therapistName: null, tenantName: null, brand: null });
    assert.ok(esPdf(buf));
    assert.ok(paginasDe(buf) >= 2);
  });
});

/* ═══ 2 · Cómo se nombra ═══════════════════════════════════════════════════ */

describe("se nombra por lo que es", () => {
  it("un registro normal es «Registro de sesión»", () => {
    assert.deepEqual(tituloDeRegistro(SESION), { tipo: "Registro de sesión", subtitulo: "" });
    assert.equal(sessionPdfFilename(SESION, "Leo Prueba"), "Registro de sesión - Leo Prueba - 2026-05-14.pdf");
  });

  it("escrito con la plantilla de la entrevista es «Entrevista inicial», en la portada y en el fichero", async () => {
    assert.equal(tituloDeRegistro(ENTREVISTA).tipo, "Entrevista inicial");
    assert.equal(sessionPdfFilename(ENTREVISTA, "Leo Prueba"), "Entrevista inicial - Leo Prueba - 2026-05-14.pdf");
    const { paginas, texto } = abrirPdf(await generar(ENTREVISTA));
    assert.match(paginas[0], /Entrevista inicial/);
    assert.doesNotMatch(paginas[0], /Registro de sesión/);
    // Los 15 apartados, con su texto.
    for (const a of APARTADOS_ENTREVISTA_BASE) {
      assert.match(texto, new RegExp(sinNumeroDelante(a.label)), a.label);
    }
    assert.match(texto, /Texto de motivoConsulta/);
    assert.match(texto, /Punto de documentacionAportada/);
  });

  it("de un taller es «Sesión de taller», con el nombre del taller si se le da", async () => {
    assert.deepEqual(tituloDeRegistro(TALLER, { tallerNombre: "Habilidades sociales" }), {
      tipo: "Sesión de taller",
      subtitulo: "Taller · Habilidades sociales",
    });
    assert.equal(sessionPdfFilename(TALLER, "Leo Prueba"), "Sesión de taller - Leo Prueba - 2026-05-14.pdf");
    const con = abrirPdf(await generar(TALLER, { tallerNombre: "Habilidades sociales" }));
    assert.match(con.paginas[0], /Sesión de taller/);
    assert.match(con.paginas[0], /Taller · Habilidades sociales/);
    assert.match(con.texto, /Hoy participó y esperó su turno/);
    // Sin el nombre (el centro sin talleres cargados): sigue siendo de taller,
    // y no sale un «Taller · » colgando.
    const sin = abrirPdf(await generar(TALLER));
    assert.match(sin.paginas[0], /Sesión de taller/);
    assert.doesNotMatch(sin.texto, /Taller ·/);
  });

  it("una plantilla del centro que NO sea la entrevista sigue siendo «Registro de sesión»", () => {
    const s = { ...SESION, contentSections: { plantilla: "corta", apartados: [{ key: "activities", label: "Qué hicimos", tipo: "texto" }] } };
    assert.equal(tituloDeRegistro(s).tipo, "Registro de sesión");
  });
});

/* ═══ 3 · Los apartados numerados ══════════════════════════════════════════ */

describe("los apartados van numerados por el documento", () => {
  it("un apartado vacío no gasta número, y la devolución de la familia es el último", () => {
    const lista = apartadosDelRegistro(SESION);
    assert.deepEqual(lista.map((a) => a.n), lista.map((_, i) => i + 1));
    // «Incidencias» está vacío: no está.
    assert.ok(!lista.some((a) => a.key === "incidents"));
    const ultimo = lista[lista.length - 1];
    assert.equal(ultimo.key, "parentFeedback");
    assert.equal(ultimo.label, "Devolución de la familia");
    assert.deepEqual(ultimo.parrafos, ["DEVOLUCION LITERAL DE LA FAMILIA"]);
    // Sin devolución, no hay apartado de devolución.
    assert.ok(!apartadosDelRegistro({ ...SESION, parentFeedback: "" }).some((a) => a.key === "parentFeedback"));
  });

  it("el título sale SIN el número que traiga la plantilla: lo pone el documento", () => {
    assert.equal(sinNumeroDelante("3. Antecedentes personales"), "Antecedentes personales");
    assert.equal(sinNumeroDelante("12) Impresión clínica"), "Impresión clínica");
    assert.equal(sinNumeroDelante("Objetivos trabajados"), "Objetivos trabajados");
    // Un título que SEA un número no se queda en nada.
    assert.equal(sinNumeroDelante("2026"), "2026");
    assert.equal(sinNumeroDelante("1."), "1.");
    // Y con la entrevista a medias (el 1 vacío), el 2 de la plantilla es el 1
    // del documento — y no «1 · 2. Motivo de consulta».
    const aMedias = { ...ENTREVISTA, contentSections: { ...ENTREVISTA.contentSections, identificacion: "" } };
    const lista = apartadosDelRegistro(aMedias);
    assert.equal(lista[0].n, 1);
    assert.equal(lista[0].label, "Motivo de consulta");
    assert.equal(lista.length, 15); // 14 de la entrevista + la devolución
  });

  it("el informe hace lo mismo con sus títulos (misma regla, mismo sitio)", () => {
    const informe = {
      reportType: "evolution",
      contentSections: {
        apartados: [{ key: "a", label: "1. Motivo", tipo: "texto" }, { key: "b", label: "2. Evolución", tipo: "texto" }],
        b: "Solo el segundo tiene texto.",
      },
    };
    const lista = apartadosDelInforme(informe);
    assert.deepEqual(lista.map((a) => [a.n, a.label]), [[1, "Evolución"]]);
  });

  it("la entrevista con sus 15 apartados NO lleva índice: es un registro, no una memoria", async () => {
    const { texto } = abrirPdf(await generar(ENTREVISTA));
    assert.doesNotMatch(texto, /Índice/);
  });
});

/* ═══ 4 · Cuerpo, firma y cierre ═══════════════════════════════════════════ */

describe("el cuerpo lleva los datos de la sesión, la firma y el cierre del centro", () => {
  it("la línea de datos: cuándo, cuánto y quién", async () => {
    const { paginas } = abrirPdf(await generar(SESION));
    assert.match(paginas[1], /Sesión del 14 de mayo de 2026/);
    assert.match(paginas[1], /45 minutos/);
    assert.match(paginas[1], /Profesional: Carmen Terapeuta/);
  });

  it("firma con la acreditación si la hay, y con la ciudad de la sede", async () => {
    const { texto } = abrirPdf(
      await generar(SESION, { tenant: CENTRO, therapistQualification: "Logopeda", therapistCollegiate: "28/1234" })
    );
    assert.match(texto, /Fdo\.: Carmen Terapeuta/);
    assert.match(texto, /Logopeda/);
    assert.match(texto, /28\/1234/);
    assert.match(texto, /En Fuenlabrada, a 14 de mayo de 2026/);
  });

  it("sin acreditación la firma es solo el nombre, sin separadores huérfanos", async () => {
    const { texto } = abrirPdf(await generar(SESION));
    assert.match(texto, /Fdo\.: Carmen Terapeuta/);
    assert.doesNotMatch(texto, /Carmen Terapeuta\s*·/);
  });

  it("con el texto legal del centro, cierra con la hoja de protección de datos", async () => {
    const con = abrirPdf(await generar(SESION, { tenant: CENTRO }));
    assert.match(con.texto, /Protección de datos y confidencialidad/);
    assert.match(con.texto, /TEXTO LEGAL DE PROTECCION DE DATOS/);
    const sin = abrirPdf(await generar(SESION));
    assert.doesNotMatch(sin.texto, /Protección de datos y confidencialidad/);
  });

  it("un registro vacío avisa, en vez de salir una portada y un folio en blanco", async () => {
    const { texto } = abrirPdf(await generar({ sessionDate: "2026-05-14T10:00:00.000Z", objectives: [], observations: {}, contentSections: {} }));
    assert.match(texto, /todavía no tiene contenido/);
  });
});

/* ═══ 5 · Lo interno sigue sin salir ═══════════════════════════════════════ */

describe("NUNCA salen la preparación, las notas internas ni la transcripción", () => {
  for (const [nombre, sesion, extra] of [
    ["en un registro normal", SESION, {}],
    ["en una entrevista inicial", ENTREVISTA, {}],
    ["en una sesión de taller", TALLER, { tallerNombre: "Habilidades sociales" }],
    ["con el centro entero puesto", SESION, { tenant: CENTRO, patientBirthDate: "2020-09-01", patientSpecialties: ["logopedia"] }],
  ]) {
    it(nombre, async () => {
      const { texto } = abrirPdf(await generar(sesion, extra));
      assert.doesNotMatch(texto, /PREPARACION INTERNA/);
      assert.doesNotMatch(texto, /NOTA INTERNA SOBRE LA FAMILIA/);
      assert.doesNotMatch(texto, /TRANSCRIPCION LITERAL/);
    });
  }
});
