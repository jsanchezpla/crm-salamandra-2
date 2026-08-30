// @prueba ligera — /lib y pdfkit en memoria; sin base, sin servidor, sin .env.
/**
 * _smoke-informe-pdf.mjs — el informe clínico rediseñado (28/08/2026).
 *
 *   node scripts/_smoke-informe-pdf.mjs
 *   node --test-name-pattern="índice" scripts/_smoke-informe-pdf.mjs
 *
 * ── QUÉ SE ESTÁ PROTEGIENDO ────────────────────────────────────────────────
 *
 * El PDF del informe pasó de ser una hoja sencilla a un documento formal con
 * portada, índice, apartados numerados y firma: el que la familia lleva al
 * colegio o adjunta a la beca del Ministerio. Con eso entran tres clases de
 * fallo que antes no existían, y las tres son silenciosas:
 *
 *   1. **El índice y el cuerpo se desincronizan.** Los apartados vacíos no se
 *      imprimen, así que numerarlos por separado deja un índice que dice «6.
 *      Recomendaciones — pág. 4» y un cuerpo donde ese apartado es el 4. Se
 *      evita porque los dos salen de `apartadosDelInforme`, y eso es lo que se
 *      prueba aquí.
 *   2. **Un dato que falta se imprime igual.** En producción, hoy, NO HAY logo,
 *      ni CIF, ni sedes, ni nº de colegiada (comprobado el 28/08/2026: son
 *      campos recién creados y nadie los ha rellenado). Cada uno de esos huecos
 *      es un «undefined» o un separador huérfano —«Marta Ruiz · ·»— en un
 *      documento firmado.
 *   3. **El informe no se genera.** Que es lo único imperdonable: una familia
 *      esperando su informe y un 500 porque el logo era un SVG.
 *
 * Por eso la mitad de los casos de abajo son NEGATIVOS: sin marca, sin centro,
 * sin colegiada, sin contenido, con el logo roto. El caso bonito ya se ve
 * mirando el PDF; estos no se ven hasta que le pasan a alguien.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { apartadosDelInforme, llevaIndice, parrafosDe, SECCIONES } from "../lib/clinica/apartadosInforme.js";
import { lineaDeFirma, bloqueDeFirma, pideAcreditacionProfesional } from "../lib/clinica/firmaProfesional.js";
import { datosDelCentro, lineaDeSede, telefonoDelCentro } from "../lib/tenant/datosCentro.js";
import { buildReportPdfBuffer, reportPdfFilename, edadEnLaFecha, fechasDeSesiones } from "../lib/clinica/reportPdf.js";

// ── Utillería para mirar dentro de un PDF sin abrirlo ────────────────────────

const comoTexto = (buf) => buf.toString("latin1");
/** Nº de páginas: `/Type /Page` sin la «s» de `/Pages`. */
const paginasDe = (buf) => (comoTexto(buf).match(/\/Type\s*\/Page[^s]/g) || []).length;
const tieneImagen = (buf) => /\/Subtype\s*\/Image/.test(comoTexto(buf));
const esPdf = (buf) => Buffer.isBuffer(buf) && comoTexto(buf).startsWith("%PDF-") && comoTexto(buf).includes("%%EOF");

const CONTENIDO_COMPLETO = {
  motiveOfIntervention: "Acude al área de Logopedia una vez por semana.",
  objectives: ["Completar el repertorio fonético", "Ampliar el enunciado"],
  evolution: ["Ha automatizado /r/ en posición inicial"],
  achievements: ["Se hace entender por adultos no habituales"],
  persistentDifficulties: ["Grupos consonánticos con /l/"],
  recommendations: ["Continuar el trabajo en casa"],
  continuityProposal: "Se propone continuar el curso que viene.",
};

const CENTRO = {
  razonSocial: "Centro de ejemplo S.L.",
  cif: "B00000000",
  telefonos: ["91 000 00 00"],
  proteccionDatos: "Texto legal de ejemplo.",
  sedes: [{ nombre: "Sede central", direccion: "C/ Ejemplo 1", cp: "28000", ciudad: "Madrid", registroSanitario: "CS00000", telefono: "" }],
};

const BRAND = { primaryColor: "#563EA6", secondaryColor: "#15063F", accentColor: "#FF0188" };

const informe = (extra = {}) => ({
  reportType: "evolution",
  reportDate: "2026-06-30",
  contentSections: CONTENIDO_COMPLETO,
  aiGenerated: null,
  ...extra,
});

const argumentos = (extra = {}) => ({
  report: informe(),
  patientName: "Paciente de Prueba",
  patientBirthDate: "2021-03-14",
  therapistName: "Profesional de Prueba",
  therapistPosition: "Logopeda",
  therapistQualification: "Graduada en Logopedia",
  therapistCollegiate: "28/0000",
  tenantName: "Centro de ejemplo",
  brand: BRAND,
  tenant: { name: "Centro de ejemplo", settings: { centro: CENTRO, brand: BRAND } },
  patientSpecialties: ["logopedia"],
  sourceSessions: [{ sessionDate: "2026-01-12" }, { sessionDate: "2026-06-15" }],
  ...extra,
});

// ── Los apartados, que son la fuente del índice Y del cuerpo ────────────────

describe("apartadosDelInforme · qué se imprime y con qué número", () => {
  it("los siete, en el orden de lectura del documento", () => {
    const aps = apartadosDelInforme(informe());
    assert.equal(aps.length, 7);
    assert.deepEqual(aps.map((a) => a.key), SECCIONES.map((s) => s.key));
    assert.deepEqual(aps.map((a) => a.n), [1, 2, 3, 4, 5, 6, 7]);
  });

  it("un apartado vacío no se imprime y NO GASTA NÚMERO", () => {
    // Es el fallo que dejaría el índice con huecos («1, 3, 6») y sin casar con
    // el cuerpo. Aquí faltan «Objetivos» y «Logros».
    const aps = apartadosDelInforme(
      informe({ contentSections: { ...CONTENIDO_COMPLETO, objectives: [], achievements: "   " } })
    );
    assert.deepEqual(aps.map((a) => a.label), [
      "Motivo de intervención",
      "Evolución",
      "Dificultades que persisten",
      "Recomendaciones",
      "Propuesta de continuidad",
    ]);
    assert.deepEqual(aps.map((a) => a.n), [1, 2, 3, 4, 5], "correlativos, sin saltos");
  });

  it("la beca imprime SUS TRES y ninguno más, aunque el resto esté escrito", () => {
    const aps = apartadosDelInforme(
      informe({ reportType: "beca", contentSections: { ...CONTENIDO_COMPLETO, methodology: "Sesión individual." } })
    );
    assert.deepEqual(aps.map((a) => a.key), ["motiveOfIntervention", "objectives", "methodology"]);
  });

  it("sin apartados, el texto de la IA se imprime antes que dar un PDF en blanco", () => {
    const aps = apartadosDelInforme(informe({ contentSections: {}, aiGenerated: "Redacción sin repartir." }));
    assert.equal(aps.length, 1);
    assert.equal(aps[0].label, "Informe");
    assert.deepEqual(aps[0].parrafos, ["Redacción sin repartir."]);
  });

  it("en la beca NO hay caída al texto de la IA: solo pueden viajar sus apartados", () => {
    const aps = apartadosDelInforme(informe({ reportType: "beca", contentSections: {}, aiGenerated: "El informe entero." }));
    assert.deepEqual(aps, []);
  });

  it("sin nada de nada, la lista sale vacía y no revienta", () => {
    for (const r of [{}, null, undefined, { contentSections: null }, { contentSections: "basura" }]) {
      assert.doesNotThrow(() => apartadosDelInforme(r));
      assert.deepEqual(apartadosDelInforme(r), []);
    }
  });

  it("el texto libre se parte en párrafos por los saltos dobles", () => {
    assert.deepEqual(parrafosDe("uno\n\ndos\n\n\ntres", false), ["uno", "dos", "tres"]);
    assert.deepEqual(parrafosDe("  ", false), []);
    assert.deepEqual(parrafosDe(["a", "", "  ", "b"], true), ["a", "b"]);
  });
});

describe("llevaIndice · cuándo merece la pena", () => {
  it("con tres apartados o más, sí", () => {
    assert.equal(llevaIndice(informe(), apartadosDelInforme(informe())), true);
  });

  it("con dos o menos, no: un índice de dos líneas gasta una página para nada", () => {
    const corto = informe({ contentSections: { motiveOfIntervention: "Solo esto." } });
    assert.equal(llevaIndice(corto, apartadosDelInforme(corto)), false);
  });

  it("la beca nunca lo lleva: son dos folios para una convocatoria", () => {
    const beca = informe({ reportType: "beca", contentSections: { ...CONTENIDO_COMPLETO, methodology: "M." } });
    assert.equal(llevaIndice(beca, apartadosDelInforme(beca)), false);
  });
});

// ── La firma, donde salen los separadores huérfanos ─────────────────────────

describe("lineaDeFirma · sin separadores colgando", () => {
  it("con todo", () => {
    assert.equal(
      lineaDeFirma({ nombre: "Marta Ruiz", titulacion: "Graduada en Logopedia", colegiado: "28/1234" }),
      "Marta Ruiz · Graduada en Logopedia · Nº Col. 28/1234"
    );
  });

  it("sin nº de colegiada, que es como está HOY todo el equipo en producción", () => {
    assert.equal(lineaDeFirma({ nombre: "Marta Ruiz", titulacion: "Graduada en Logopedia" }), "Marta Ruiz · Graduada en Logopedia");
  });

  it("sin titulación, cae al puesto del centro", () => {
    assert.equal(lineaDeFirma({ nombre: "Marta Ruiz", puesto: "Logopeda", colegiado: "28/1234" }), "Marta Ruiz · Logopeda · Nº Col. 28/1234");
  });

  it("la titulación manda sobre el puesto: acredita, no describe", () => {
    assert.equal(
      lineaDeFirma({ nombre: "M", titulacion: "Graduada en Logopedia", puesto: "Coordinadora" }),
      "M · Graduada en Logopedia"
    );
  });

  it("pelado, solo el nombre — y NUNCA «Marta Ruiz · ·»", () => {
    const l = lineaDeFirma({ nombre: "Marta Ruiz" });
    assert.equal(l, "Marta Ruiz");
    assert.ok(!l.includes("··") && !l.trim().endsWith("·"), "no puede quedar un separador huérfano");
  });

  it("sin nombre no hay línea: el generador entonces no pinta el bloque", () => {
    assert.equal(lineaDeFirma({ titulacion: "Graduada", colegiado: "28/1" }), "");
    assert.equal(lineaDeFirma({}), "");
    assert.equal(lineaDeFirma(), "");
  });

  it("el bloque parte lo mismo en dos alturas", () => {
    assert.deepEqual(bloqueDeFirma({ nombre: "M", titulacion: "T", colegiado: "1" }), {
      nombre: "M",
      acreditacion: "T · Nº Col. 1",
      titulos: [],
    });
    assert.deepEqual(bloqueDeFirma({ nombre: "M" }), { nombre: "M", acreditacion: "", titulos: [] });
    assert.deepEqual(bloqueDeFirma(), { nombre: "", acreditacion: "", titulos: [] });
  });
});

/*
 * ── VARIOS TÍTULOS POR PERSONA (29/08/2026) ────────────────────────────────
 * Aumenta mandó las titulaciones de sus 16 profesionales y ninguna es una sola
 * línea: la profesión y, debajo, el máster, el postgrado y el experto — hasta
 * seis en una persona. Se guarda un título por línea; la PRIMERA acompaña al nº
 * de colegiada y las demás van debajo.
 */
describe("la titulación son varias líneas, y el documento las reparte", () => {
  const ISABEL = ["Logopeda", "Experto en Práctica Clínica en Logoterapia", "Postgrado en Autismo"].join("\n");

  it("la primera línea acompaña al número; el resto van debajo", () => {
    assert.deepEqual(bloqueDeFirma({ nombre: "Isabel Alberca", titulacion: ISABEL, colegiado: "28/0256" }), {
      nombre: "Isabel Alberca",
      acreditacion: "Logopeda · Nº Col. 28/0256",
      titulos: ["Experto en Práctica Clínica en Logoterapia", "Postgrado en Autismo"],
    });
  });

  it("la PORTADA sigue siendo una sola línea: ahí no caben seis", () => {
    assert.equal(
      lineaDeFirma({ nombre: "Isabel Alberca", titulacion: ISABEL, colegiado: "28/0256" }),
      "Isabel Alberca · Logopeda · Nº Col. 28/0256"
    );
  });

  it("sin nº de colegiada —hay dos que no lo tienen— salen solo los títulos", () => {
    const b = bloqueDeFirma({ nombre: "Blanca Márquez", titulacion: ["Maestra en Educación Infantil", "Máster en NEE"].join("\n") });
    assert.equal(b.acreditacion, "Maestra en Educación Infantil");
    assert.deepEqual(b.titulos, ["Máster en NEE"]);
    assert.ok(!b.acreditacion.includes("Nº Col."), "sin número no se inventa la coletilla");
  });

  it("una sola línea se comporta EXACTAMENTE como antes del cambio", () => {
    const b = bloqueDeFirma({ nombre: "M", titulacion: "Graduada en Logopedia", colegiado: "28/1" });
    assert.equal(b.acreditacion, "Graduada en Logopedia · Nº Col. 28/1");
    assert.deepEqual(b.titulos, []);
  });

  it("las líneas en blanco y los espacios sobrantes no cuentan como título", () => {
    const b = bloqueDeFirma({ nombre: "M", titulacion: ["  Logopeda  ", "", "   ", "Máster"].join("\n") });
    assert.equal(b.acreditacion, "Logopeda");
    assert.deepEqual(b.titulos, ["Máster"]);
  });
});

describe("pideAcreditacionProfesional · dónde se enseñan colegiación y titulación", () => {
  /*
   * Es uno de los «tres peros» de CLAUDE.md: cada «si tiene X no enseñes Y» es
   * un `if` con NOMBRE en lib/ y con prueba, no una condición suelta en el JSX.
   *
   * Estos dos campos existen por una sola razón —salen impresos bajo la firma
   * de un informe clínico—, así que en Retorika (academia online), en una
   * agencia de management o en spain_enzymes no significan nada, y la ayuda que
   * llevan debajo («salen impresos en los informes clínicos que firma esta
   * persona») sería sencillamente falsa para más de la mitad de los clientes.
   */
  it("sí donde hay informes que firmar", () => {
    assert.equal(pideAcreditacionProfesional(["team", "clinica"]), true);
    assert.equal(pideAcreditacionProfesional(["pacientes"]), true);
    assert.equal(pideAcreditacionProfesional((k) => k === "clinica"), true);
  });

  it("no donde no los hay: una academia o una agencia no colegian a nadie", () => {
    assert.equal(pideAcreditacionProfesional(["team", "training"]), false);
    assert.equal(pideAcreditacionProfesional(["team", "booking", "clients"]), false);
    assert.equal(pideAcreditacionProfesional([]), false);
  });

  it("mientras no se sepan los módulos, no se enseñan (nada de parpadeos al revés)", () => {
    for (const x of [null, undefined, {}, "clinica", 42]) {
      assert.equal(pideAcreditacionProfesional(x), false, `con ${JSON.stringify(x)}`);
    }
  });
});

// ── Los datos del centro ────────────────────────────────────────────────────

describe("datosDelCentro · lo que no está, no se imprime", () => {
  it("lee el tenant entero, su settings o el centro suelto", () => {
    const esperado = datosDelCentro({ settings: { centro: CENTRO } });
    assert.equal(datosDelCentro({ centro: CENTRO }).cif, esperado.cif);
    assert.equal(datosDelCentro(CENTRO).sedes.length, 0, "el objeto centro suelto no lleva la clave `centro` dentro");
  });

  it("sin datos del centro, todo vacío y `hayPie` en falso", () => {
    for (const t of [null, undefined, {}, { settings: {} }, { settings: { centro: null } }]) {
      const c = datosDelCentro(t);
      assert.equal(c.cif, "");
      assert.deepEqual(c.sedes, []);
      assert.deepEqual(c.telefonos, []);
      assert.equal(c.hayPie, false, "sin nada que poner, el pie no se pinta");
    }
  });

  it("el nombre cae al del tenant, y luego al de respaldo: la portada necesita algo", () => {
    assert.equal(datosDelCentro({ name: "Aumenta", settings: {} }).nombre, "Aumenta");
    assert.equal(datosDelCentro({}, { nombrePorDefecto: "Centro" }).nombre, "Centro");
    assert.equal(datosDelCentro({ name: "Aumenta", settings: { centro: { razonSocial: "Aumenta C.B." } } }).nombre, "Aumenta C.B.");
  });

  it("solo se tira la sede COMPLETAMENTE vacía, como hace el que las guarda", () => {
    // La regla tiene que ser la misma que la de lib/tenant/normalizarCentro.js.
    // Si el lector fuese más estricto, una sede con solo el nº de registro se
    // guardaría y no se imprimiría, sin decir nada a quien la escribió.
    const c = datosDelCentro({
      settings: { centro: { sedes: [{ registroSanitario: "CS1" }, {}, { nombre: "  " }, CENTRO.sedes[0]] } },
    });
    assert.equal(c.sedes.length, 2, "la del registro suelto y la completa; las dos vacías no");
  });

  it("aguanta que `sedes` o `telefonos` no sean listas", () => {
    for (const malo of ["no soy lista", 42, {}, null]) {
      assert.doesNotThrow(() => datosDelCentro({ settings: { centro: { sedes: malo, telefonos: malo } } }));
      const c = datosDelCentro({ settings: { centro: { sedes: malo, telefonos: malo } } });
      assert.deepEqual(c.sedes, []);
      assert.deepEqual(c.telefonos, []);
    }
  });

  it("la línea de la sede junta solo lo que hay", () => {
    assert.equal(
      lineaDeSede({ nombre: "Sede central", direccion: "C/ Ejemplo 1", cp: "28000", ciudad: "Madrid", registroSanitario: "CS1" }),
      "Sede central, C/ Ejemplo 1 · 28000 Madrid · Nº Reg. Sanitario CS1"
    );
    assert.equal(lineaDeSede({ direccion: "C/ Ejemplo 1" }), "C/ Ejemplo 1");
    assert.equal(lineaDeSede({ ciudad: "Madrid", registroSanitario: "CS1" }), "Madrid · Nº Reg. Sanitario CS1");
    assert.equal(lineaDeSede(null), "");
    assert.equal(lineaDeSede({}), "");
  });

  it("el teléfono del centro mira los tres sitios donde ha ido cayendo", () => {
    assert.equal(telefonoDelCentro({ settings: { centro: { telefonos: ["911"] }, phone: "922" } }), "911");
    assert.equal(telefonoDelCentro({ settings: { phone: "922" } }), "922");
    assert.equal(telefonoDelCentro({ settings: { citas: { telefono: "933" } } }), "933");
    assert.equal(telefonoDelCentro(null), "");
  });
});

// ── La edad, que se congela en la fecha del informe ─────────────────────────

describe("edadEnLaFecha", () => {
  it("es la edad AL FIRMAR, no la de hoy: el documento se abre dos años después", () => {
    assert.equal(edadEnLaFecha("2021-03-14", "2026-06-30"), "5 años y 3 meses");
    assert.equal(edadEnLaFecha("2021-03-14", "2026-03-14"), "5 años");
    assert.equal(edadEnLaFecha("2026-01-01", "2026-06-30"), "5 meses");
    assert.equal(edadEnLaFecha("2026-06-01", "2026-06-30"), "0 meses");
  });

  it("sin fecha de nacimiento no se inventa nada (191 pacientes de Aumenta no la tienen)", () => {
    assert.equal(edadEnLaFecha(null, "2026-06-30"), "");
    assert.equal(edadEnLaFecha("", "2026-06-30"), "");
    assert.equal(edadEnLaFecha("no es una fecha", "2026-06-30"), "");
  });

  it("un nacimiento posterior al informe no da una edad negativa", () => {
    assert.equal(edadEnLaFecha("2027-01-01", "2026-06-30"), "");
  });
});

describe("fechasDeSesiones", () => {
  it("una sola sesión no dice «del X al X»", () => {
    assert.equal(fechasDeSesiones([{ sessionDate: "2026-01-12" }]).periodo, "12 de enero de 2026");
  });

  it("varias, ordenadas aunque lleguen del revés", () => {
    const f = fechasDeSesiones([{ sessionDate: "2026-06-15" }, { sessionDate: "2026-01-12" }]);
    assert.equal(f.periodo, "del 12 de enero de 2026 al 15 de junio de 2026");
    assert.ok(f.basadoEn.startsWith("2 sesiones"));
  });

  it("sin sesiones, null: el generador entonces no pinta ni pastilla ni «basado en»", () => {
    for (const s of [[], null, undefined, "basura", [{}], [{ sessionDate: "mal" }]]) {
      assert.equal(fechasDeSesiones(s), null);
    }
  });
});

describe("reportPdfFilename", () => {
  it("es lo que verá la familia en su portal", () => {
    assert.equal(
      reportPdfFilename({ reportType: "evolution", reportDate: "2026-06-30" }, "Ana López"),
      "Evolutivo - Ana López - 2026-06-30.pdf"
    );
  });

  it("quita los caracteres que Windows no admite en un nombre de fichero", () => {
    const n = reportPdfFilename({ reportType: "evolution", reportDate: "2026-06-30" }, 'Ana/Lo:pe*z?"<>|');
    assert.ok(!/[\\/:*?"<>|]/.test(n.replace(".pdf", "")), n);
  });
});

// ── El PDF de verdad ────────────────────────────────────────────────────────

describe("buildReportPdfBuffer · el documento que sale", () => {
  it("el informe completo sale con portada, índice, cuerpo, firma y hoja legal", async () => {
    const buf = await buildReportPdfBuffer(argumentos());
    assert.ok(esPdf(buf), "tiene que ser un PDF válido de punta a punta");
    assert.ok(paginasDe(buf) >= 4, `esperaba 4 páginas o más, salieron ${paginasDe(buf)}`);
  });

  it("SIN NADA —ni marca, ni centro, ni colegiada, ni fecha de nacimiento— se genera igual", async () => {
    // Es exactamente el estado de producción hoy, y el caso que no puede fallar.
    const buf = await buildReportPdfBuffer(
      argumentos({
        brand: null,
        tenant: { name: "Centro", settings: {} },
        patientBirthDate: null,
        therapistPosition: null,
        therapistQualification: null,
        therapistCollegiate: null,
        patientSpecialties: [],
        sourceSessions: [],
      })
    );
    assert.ok(esPdf(buf));
    assert.equal(tieneImagen(buf), false, "sin marca no hay logo que pintar");
  });

  it("con logo, el PDF lleva la imagen dentro; sin logo, no", async () => {
    const con = await buildReportPdfBuffer(
      argumentos({ brand: { ...BRAND, logoUrl: "/aumenta-logo.png", isotipoUrl: "/aumenta-isotipo.png" } })
    );
    const sin = await buildReportPdfBuffer(argumentos({ brand: BRAND }));
    assert.equal(tieneImagen(con), true, "el logo de public/ tiene que llegar al PDF");
    assert.equal(tieneImagen(sin), false);
  });

  it("un logo que es una URL REMOTA se ignora y el informe sale igual", async () => {
    // Nunca se sale a la red desde el generador: ver lib/pdf/imagenLocal.js.
    const buf = await buildReportPdfBuffer(
      argumentos({ brand: { ...BRAND, logoUrl: "https://ejemplo.com/logo.png", isotipoUrl: "/no-existe.png" } })
    );
    assert.ok(esPdf(buf));
    assert.equal(tieneImagen(buf), false);
  });

  it("un informe SIN contenido se genera y lo dice, en vez de romperse", async () => {
    const buf = await buildReportPdfBuffer(
      argumentos({ report: informe({ contentSections: {}, aiGenerated: null }) })
    );
    assert.ok(esPdf(buf));
    assert.ok(comoTexto(buf).length > 1000, "un PDF de verdad, no un fichero vacío");
  });

  it("el de beca sale más corto: sin índice y con tres apartados", async () => {
    const beca = await buildReportPdfBuffer(
      argumentos({
        report: informe({
          reportType: "beca",
          contentSections: { ...CONTENIDO_COMPLETO, methodology: "Sesión individual semanal." },
        }),
      })
    );
    const completo = await buildReportPdfBuffer(argumentos());
    assert.ok(esPdf(beca));
    assert.ok(paginasDe(beca) < paginasDe(completo), `beca=${paginasDe(beca)} completo=${paginasDe(completo)}`);
  });

  it("el anexo de registros añade páginas, y solo si se pide", async () => {
    const sin = await buildReportPdfBuffer(argumentos());
    const con = await buildReportPdfBuffer(
      argumentos({ report: informe({ contentSections: { ...CONTENIDO_COMPLETO, anexarRegistros: true } }) })
    );
    assert.ok(paginasDe(con) > paginasDe(sin), `con=${paginasDe(con)} sin=${paginasDe(sin)}`);
  });

  it("el isotipo NO abre página por su cuenta: cierra la que ya hay", async () => {
    /*
     * Se vio en el primer informe generado con la marca real de Aumenta. Como
     * todavía no tienen escrito el aviso de protección de datos, el documento
     * acababa en una hoja vacía con el isotipo pequeño abajo: parece un fallo
     * de impresión, no un sello. La página nueva la abre el TEXTO legal; sin
     * él, el isotipo cierra la última página que hubiera.
     */
    const marcaConIso = { ...BRAND, logoUrl: "/aumenta-logo.png", isotipoUrl: "/aumenta-isotipo.png" };
    const sinTextoLegal = { ...CENTRO, proteccionDatos: "" };

    const conTexto = await buildReportPdfBuffer(
      argumentos({ brand: marcaConIso, tenant: { name: "C", settings: { centro: CENTRO, brand: marcaConIso } } })
    );
    const sinTexto = await buildReportPdfBuffer(
      argumentos({ brand: marcaConIso, tenant: { name: "C", settings: { centro: sinTextoLegal, brand: marcaConIso } } })
    );

    assert.equal(
      paginasDe(sinTexto),
      paginasDe(conTexto) - 1,
      `sin aviso legal tiene que haber UNA página menos: con=${paginasDe(conTexto)} sin=${paginasDe(sinTexto)}`
    );
    assert.equal(tieneImagen(sinTexto), true, "y el isotipo sigue estando, al pie de la última");
  });

  it("no se cae con el informe más roto que se pueda imaginar", async () => {
    const buf = await buildReportPdfBuffer({
      report: { reportType: "no-existe", reportDate: null, contentSections: "basura", aiGenerated: 42 },
      patientName: null,
      therapistName: null,
      tenantName: null,
      brand: "no soy un objeto",
      tenant: 42,
      patientSpecialties: "tampoco",
      sourceSessions: "ni yo",
    });
    assert.ok(esPdf(buf), "hasta con todo mal, sale un PDF");
  });
});
