// @prueba ligera
// El Plan trae el motivo de consulta de los informes PDF (15/09/2026, AV-0103).
// Los textos imitan la forma de los informes de Aumenta; los datos son inventados.
import { test } from "node:test";
import assert from "node:assert/strict";

import { esInforme, leerInforme, objetivosDelInforme, rellenoDesdeInformes, terapiaDelInforme } from "../lib/clinica/planDesdeInformes.js";
import { MAX_TEXTO_OBJETIVO } from "../lib/clinica/objetivosDelPlan.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const EVOLUCION = [
  "INFORME DE EVOLUCIÓN",
  "Teléfono: 91 000 00 00 Email: info@centro.test 1",
  "Los datos de este informe son confidenciales y no pueden ser utilizados para fines distintos.",
  "MOTIVO DE CONSULTA",
  "Pepa Prueba acude al área de LOGOPEDIA en Aumenta 1 vez a la semana de forma",
  "Individual en sesiones de 45 minutos de duración.",
  "Presenta Retraso del lenguaje manifestando las siguientes necesidades terapéuticas:",
  "Teléfono: 91 000 00 00 Email: info@centro.test 2",
  "Necesita estimular su lenguaje oral y ampliar",
  "vocabulario.",
  "OBJETIVOS DEL CURSO 2025 - 2026",
  "Comprensión y expresión.",
].join("\n");

test("copia el apartado literal hasta el siguiente encabezado y salta el pie de página", () => {
  const r = leerInforme(EVOLUCION);
  assert.equal(
    r.motivo,
    "Pepa Prueba acude al área de LOGOPEDIA en Aumenta 1 vez a la semana de forma Individual en sesiones de 45 minutos de duración.\n" +
      "Presenta Retraso del lenguaje manifestando las siguientes necesidades terapéuticas:\n" +
      "Necesita estimular su lenguaje oral y ampliar vocabulario.",
  );
  assert.equal(r.diagnostico, null, "«presenta diagnóstico de…» dentro del motivo no es un apartado de diagnóstico");
});

test("salta el índice y lee el apartado numerado de verdad, con su diagnóstico si lo tiene", () => {
  const texto = [
    "ÍNDICE",
    "1. Motivo de la consulta",
    "2. Situación familiar y educativa",
    "Pág. 2",
    "1. Motivo de la consulta",
    "La familia solicita evaluación ante dificultades académicas persistentes.",
    "2. Situación familiar y educativa",
    "Vive con sus padres.",
    "6. Juicio Clínico – Diagnóstico",
    "Sintomatología compatible con dificultades de aprendizaje.",
    "7. Orientaciones",
  ].join("\n");
  const r = leerInforme(texto);
  assert.equal(r.motivo, "La familia solicita evaluación ante dificultades académicas persistentes.");
  assert.equal(r.diagnostico, "Sintomatología compatible con dificultades de aprendizaje.");
});

test("sin apartado, sin motivo; y demasiado largo no se corta a medias", () => {
  assert.equal(leerInforme("INFORME DE FISIOTERAPIA\nRecomiendo una ortesis.").motivo, null);
  const largo = leerInforme(`MOTIVO DE CONSULTA\n${"Texto largo del motivo. ".repeat(300)}\nOBJETIVOS`);
  assert.equal(largo.motivo, null);
  assert.equal(largo.motivoDemasiadoLargo, true);
});

test("la terapia sale del nombre del fichero y, si no, del arranque del motivo", () => {
  assert.equal(terapiaDelInforme("2026-06-02 Pepa INFORME DE EVOLUCIÓN Servicio de LOGOPEDIA - Junio 2026.pdf", "acude a PSICOLOGÍA"), "logopedia");
  assert.equal(terapiaDelInforme("INFORME EVOLUCIÓN PEDAGOGÍA 2022 Pepa.pdf", ""), "pedagogia");
  assert.equal(terapiaDelInforme("INFORME T.O PEPA.pdf", ""), "terapia_ocupacional");
  assert.equal(terapiaDelInforme("Informe Pepa 2025.pdf", "Pepa acude al área de TERAPIA OCUPACIONAL en Aumenta"), "terapia_ocupacional");
  assert.equal(terapiaDelInforme("Informe Pepa.pdf", "Recibe apoyo psicopedagógico en el colegio."), null);
  assert.equal(terapiaDelInforme("Informe Pepa.pdf", "Acude a neuropsicología educativa."), "neuropsicologia");
  const tarde = `La familia describe dificultades sociales. ${"Más detalle. ".repeat(30)}Anteriormente acudía a logopedia.`;
  assert.equal(terapiaDelInforme("Informe Pepa.pdf", tarde), null, "lo que se nombra muy abajo no decide la terapia");
});

test("solo PDF con «informe» en el nombre", () => {
  assert.equal(esInforme("INFORME Pepa.pdf"), true);
  assert.equal(esInforme("Perfil_SENA.pdf"), false);
  assert.equal(esInforme("informe.docx"), false);
});

test("va a la terapeuta de su especialidad, gana el más nuevo y no pisa lo escrito", () => {
  const informes = [
    { fileName: "Pepa INFORME Servicio de LOGOPEDIA - Junio 2026.pdf", fecha: "2026-06-02", texto: EVOLUCION.replace("45 minutos", "60 minutos") },
    { fileName: "Pepa INFORME Servicio de LOGOPEDIA - Junio 2025.pdf", fecha: "2025-06-02", texto: EVOLUCION },
    { fileName: "Pepa INFORME Servicio de PSICOLOGÍA - Junio 2025.pdf", fecha: "2025-06-01", texto: EVOLUCION },
    { fileName: "Escaneado INFORME.pdf", texto: null, problema: "sin texto" },
    { fileName: "Informe_protected.pdf", texto: null, problema: "cifrado" },
  ];
  const terapeutas = [
    { id: A, especialidades: ["logopedia"] },
    { id: B, especialidades: ["psicologia"] },
  ];

  const r = rellenoDesdeInformes({}, terapeutas, informes);
  assert.equal(r.motivos.length, 2);
  assert.match(r.motivos.find((m) => m.terapeutaId === A).texto, /60 minutos/, "el de 2026, no el de 2025");
  assert.equal(r.motivos.find((m) => m.terapeutaId === B).terapia, "psicologia");
  assert.equal(r.general, null, "con terapeuta de esa terapia, el general no se toca");
  assert.deepEqual(r.cuenta, { leidos: 3, cifrados: 1, sinTexto: 1, sinMotivo: 0, objetivosQueNoCaben: 0 });

  const conEscrito = rellenoDesdeInformes(
    { consultationReasonsByTherapist: [{ terapeutaId: A, texto: "Lo que escribió ella" }] },
    terapeutas,
    informes,
  );
  assert.deepEqual(conEscrito.motivos.map((m) => m.terapeutaId), [B]);
});

test("sin terapeuta de esa terapia, al motivo general, y solo si está vacío", () => {
  const informes = [{ fileName: "Informe Pepa.pdf", texto: EVOLUCION }];
  const r = rellenoDesdeInformes({}, [{ id: B, especialidades: ["psicologia"] }], informes);
  assert.equal(r.motivos.length, 0);
  assert.match(r.general.texto, /^Pepa Prueba acude/);
  assert.equal(rellenoDesdeInformes({ consultationReasons: "Ya puesto" }, [], informes).general, null);
});

test("el diagnóstico solo si el plan no lo tiene", () => {
  const texto = "DIAGNÓSTICO\nTrastorno del lenguaje según el informe de neurología.\nOBJETIVOS";
  const informes = [{ fileName: "Informe Pepa.pdf", texto }];
  assert.match(rellenoDesdeInformes({}, [], informes).diagnostico.texto, /^Trastorno del lenguaje/);
  assert.equal(rellenoDesdeInformes({ diagnosis: "El suyo" }, [], informes).diagnostico, null);
});

/*
 * ── LOS OBJETIVOS (16/09/2026, AV-0163 de Raquel) ───────────────────────────
 * «Sacar los objetivos del informe subido del año pasado, al igual que se ha
 * hecho con el motivo de consulta». Lo que sale es una LISTA, no un texto.
 */
const CON_OBJETIVOS = [
  "INFORME DE EVOLUCIÓN",
  "USC/WPS Nº 1648",
  "OBJETIVOS",
  "• Mejorar la conciencia fonológica en tareas de segmentación",
  "silábica y de rima.",
  "USC/WPS Nº 1648",
  "USC/WPS Nº 1648",
  "• Ampliar el vocabulario expresivo en campos semánticos",
  "cotidianos.",
  "• Corto.",
  "Trabajar la comprensión de textos narrativos breves.",
  "EVOLUCIÓN",
  "Ha mejorado a lo largo del curso.",
].join("\n");

test("los objetivos salen uno a uno, sin la viñeta y saltando el pie en mayúsculas", () => {
  assert.deepEqual(objetivosDelInforme(CON_OBJETIVOS).textos, [
    "Mejorar la conciencia fonológica en tareas de segmentación silábica y de rima.",
    "Ampliar el vocabulario expresivo en campos semánticos cotidianos.",
    "Trabajar la comprensión de textos narrativos breves.",
  ]);
  assert.deepEqual(objetivosDelInforme("INFORME\nEVOLUCIÓN\nVa bien."), { textos: [], noCaben: 0 }, "sin apartado, ninguno");
  assert.equal(objetivosDelInforme(CON_OBJETIVOS, { max: 2 }).textos.length, 2);
});

test("un párrafo que no cabe en un objetivo se queda fuera, y se cuenta", () => {
  const largo = `OBJETIVOS\n• ${"palabra ".repeat(80)}\n• Mejorar la atención sostenida en tareas de mesa.\nEVOLUCIÓN`;
  const r = objetivosDelInforme(largo);
  assert.deepEqual(r.textos, ["Mejorar la atención sostenida en tareas de mesa."]);
  assert.equal(r.noCaben, 1, `no cabe en los ${MAX_TEXTO_OBJETIVO} caracteres del campo`);
});

test("los objetivos van a la terapeuta del informe y no pisan los que ya tiene", () => {
  const informes = [
    { fileName: "Pepa INFORME Servicio de LOGOPEDIA - Junio 2026.pdf", fecha: "2026-06-02", texto: CON_OBJETIVOS },
    { fileName: "Pepa INFORME Servicio de LOGOPEDIA - Junio 2025.pdf", fecha: "2025-06-02", texto: CON_OBJETIVOS },
  ];
  const terapeutas = [{ id: A, especialidades: ["logopedia"] }];

  const r = rellenoDesdeInformes({}, terapeutas, informes);
  assert.equal(r.objetivos.length, 1, "gana el más nuevo, no se traen los dos");
  assert.equal(r.objetivos[0].terapeutaId, A);
  assert.equal(r.objetivos[0].fileName, informes[0].fileName);
  assert.equal(r.objetivos[0].textos.length, 3);

  const suyos = rellenoDesdeInformes({ objectives: [{ texto: "El que escribió ella", terapeutaId: A }] }, terapeutas, informes);
  assert.deepEqual(suyos.objetivos, [], "quien ya tiene objetivos no recibe los de un informe viejo");
});

test("sin terapeuta de esa terapia, los objetivos quedan sin atribuir", () => {
  const informes = [{ fileName: "Informe Pepa.pdf", texto: CON_OBJETIVOS }];
  const r = rellenoDesdeInformes({}, [{ id: B, especialidades: ["psicologia"] }], informes);
  assert.equal(r.objetivos.length, 1);
  assert.equal(r.objetivos[0].terapeutaId, null);
  assert.deepEqual(rellenoDesdeInformes({ objectives: ["Uno suelto"] }, [], informes).objetivos, []);
});

test("un informe sin motivo pero con objetivos ya no se descarta", () => {
  const soloObjetivos = [{ fileName: "Pepa INFORME Servicio de LOGOPEDIA.pdf", texto: CON_OBJETIVOS }];
  const r = rellenoDesdeInformes({}, [{ id: A, especialidades: ["logopedia"] }], soloObjetivos);
  assert.equal(r.motivos.length, 0);
  assert.equal(r.cuenta.sinMotivo, 1);
  assert.equal(r.objetivos.length, 1);
});
