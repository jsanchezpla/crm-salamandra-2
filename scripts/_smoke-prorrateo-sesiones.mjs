// @prueba ligera — node:test sobre lib/billing/ y regex sobre pantalla y endpoint.
/**
 * _smoke-prorrateo-sesiones.mjs — la misma cuota da el MISMO importe la
 * calcule quien la calcule (07/09/2026, AV-0068 de Aumenta).
 *
 *   node scripts/_smoke-prorrateo-sesiones.mjs
 *
 * Rosa: «lo quiero dejar hecho puesto que el sistema está calculando las
 * cuotas por días no por sesiones». Tenía razón a medias, y por eso dudaba:
 * desde el 07/09 la generación mensual prorratea por SESIONES (AV-0062), pero
 * el cajón de «Nuevo cobro» —el que usa ella para dejar hecha la cuota de un
 * paciente que empieza tarde— seguía con la regla de tres por días. La misma
 * cuota daba dos importes según quién la calculara.
 *
 * Lo que se fija, y el primer caso es EL invariante:
 *
 *   · que teclear y generar den el mismo número con las mismas citas: si un
 *     día vuelven a separarse, salta aquí y no en la factura de una familia;
 *   · que sin citas se siga prorrateando por días, que es lo que hay en un
 *     centro sin agenda y lo que había antes;
 *   · que el rótulo que queda escrito sea el mismo en los dos caminos;
 *   · y que el cajón pida las citas al servidor en vez de calcularlas, con el
 *     paciente cuando lo hay, porque de quién es la cuota decide QUÉ citas
 *     cuentan.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { partesConProrrateo, prorrateoDeCuota } from "../lib/billing/prorrateo.js";
import { tramoDelMes, rotuloDeTramo, planDeCuotasDelMes } from "../lib/billing/cuotas.js";

const lee = (r) => readFileSync(new URL(r, import.meta.url), "utf8");

// Septiembre de 2026: los viernes son 4, 11, 18 y 25. Un «60x1» los viernes
// que empieza el día 11 son 3 sesiones de 4, no 20 días de 30.
const VIERNES = ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"]
  .map((d) => ({ scheduledAt: `${d}T10:00:00.000Z` }));

describe("teclear una cuota y generarla dan el mismo importe", () => {
  it("EL INVARIANTE: con las mismas citas, el cajón y la generación coinciden", () => {
    const inicio = "2026-09-11";
    const importe = 190;

    // Lo que hace la generación.
    const tramo = tramoDelMes("2026-09", { startDate: inicio }, { citas: VIERNES });
    const generado = Math.round(importe * tramo.factor * 100) / 100;

    // Lo que hace el cajón.
    const { total } = partesConProrrateo([{ importe, inicio }], { mes: "2026-09", citas: VIERNES });

    assert.equal(total, generado);
    assert.equal(total, 142.5, "3 de 4 sesiones de 190 €");
  });

  it("y NO es lo que salía por días, que es de lo que se quejaba", () => {
    const porDias = prorrateoDeCuota(190, "2026-09-11").importe;
    assert.equal(porDias, 126.67, "20 de 30 días");
    const { total } = partesConProrrateo([{ importe: 190, inicio: "2026-09-11" }], { mes: "2026-09", citas: VIERNES });
    assert.notEqual(total, porDias);
  });

  it("el rótulo que queda escrito también es el mismo", () => {
    const tramo = tramoDelMes("2026-09", { startDate: "2026-09-11" }, { citas: VIERNES });
    const { partes } = partesConProrrateo([{ importe: 190, inicio: "2026-09-11" }], { mes: "2026-09", citas: VIERNES });
    assert.equal(partes[0].rotulo, rotuloDeTramo(tramo));
    assert.match(partes[0].rotulo, /3 de 4 sesiones/);
  });

  it("varios servicios, cada uno con su fecha, cada uno con sus sesiones", () => {
    const { partes, total } = partesConProrrateo(
      [{ importe: 190, inicio: "2026-09-11" }, { importe: 100, inicio: "" }],
      { mes: "2026-09", citas: VIERNES },
    );
    assert.equal(partes[1].importe, 100, "sin fecha de inicio, mes entero");
    assert.equal(partes[1].rotulo, null);
    assert.equal(total, 242.5);
  });
});

describe("sin citas se sigue prorrateando por días", () => {
  it("un centro sin agenda no cambia de comportamiento", () => {
    const sinCitas = partesConProrrateo([{ importe: 190, inicio: "2026-09-11" }], { mes: "2026-09", citas: [] });
    assert.equal(sinCitas.total, 126.67);
    assert.match(sinCitas.partes[0].rotulo, /20\/30 días/);
  });

  it("y quien llame sin decir el mes tampoco (compatible con lo de antes)", () => {
    assert.equal(partesConProrrateo([{ importe: 190, inicio: "2026-09-11" }]).total, 126.67);
  });

  it("un mes entero no se prorratea de ninguna de las dos formas", () => {
    const r = partesConProrrateo([{ importe: 190, inicio: "2026-09-01" }], { mes: "2026-09", citas: VIERNES });
    assert.equal(r.total, 190);
    assert.equal(r.partes[0].rotulo, null);
    assert.equal(r.partes[0].prorrateo, null);
  });

  it("una fecha de otro mes no rompe la cuenta", () => {
    const r = partesConProrrateo([{ importe: 190, inicio: "2026-10-05" }], { mes: "2026-09", citas: VIERNES });
    assert.equal(typeof r.total, "number");
  });
});

describe("de dónde saca el cajón esas citas", () => {
  const pagina = lee("../app/(dashboard)/facturacion/cobros/page.jsx");
  const endpoint = lee("../app/api/billing/payments/mes/route.js");

  it("las pide al servidor, no las calcula", () => {
    assert.match(pagina, /const \[citasDelMes, setCitasDelMes\] = useState\(\[\]\);/);
    assert.match(pagina, /setCitasDelMes\(Array\.isArray\(jMes\?\.data\?\.citas\) \? jMes\.data\.citas : \[\]\);/);
  });

  it("y las pasa a las DOS cuentas del cajón, no solo a una", () => {
    const usos = pagina.match(/partesConProrrateo\(/g) ?? [];
    const conCitas = pagina.match(/\{ mes: form\.periodMonth, citas: citasDelMes \}/g) ?? [];
    assert.equal(usos.length, 2, "hay dos sitios que suman la cuota");
    assert.equal(conCitas.length, 2, "los dos tienen que ir por sesiones o volverán a divergir");
  });

  it("con el paciente elegido, porque decide qué citas cuentan", () => {
    assert.match(pagina, /payments\/mes\?clientId=[\s\S]{0,200}patientId=\$\{encodeURIComponent\(form\.patientId\)\}/);
    assert.match(endpoint, /const patientId = UUID_RE\.test\(patientIdPedido\) \? patientIdPedido : null;/);
  });

  it("el servidor usa la MISMA pieza que la generación", () => {
    assert.match(endpoint, /import \{ citasDelMesParaCuotas, claveDeCitas \}/);
    assert.match(endpoint, /cuotas: \[\{ patientId, clientId \}\]/);
  });

  it("y solo baja la fecha y el concepto: ni paciente, ni terapeuta, ni motivo", () => {
    const bloque = endpoint.slice(endpoint.indexOf("const citasPorClave"), endpoint.indexOf("return ok({"));
    assert.match(bloque, /\.map\(\(c\) => \(\{ scheduledAt: c\.scheduledAt, conceptId: c\.conceptId \?\? null \}\)\)/);
    assert.ok(!/patientName|clientName|notes/.test(bloque));
  });

  it("y el cajón dice de qué concepto es cada línea, o volvería a mezclarlas", () => {
    const conConcepto = pagina.match(/conceptId: c\.id/g) ?? [];
    assert.equal(conConcepto.length, 2, "las dos cuentas del cajón, no solo una");
  });

  it("se limpian al cambiar de familia, o se cobraría con las del anterior", () => {
    assert.match(pagina, /setCitasDelMes\(\[\]\);/);
  });
});

/*
 * ── CADA TERAPIA POR SUS SESIONES (08/09/2026, vuelta de Rosa) ─────────────
 *
 * «Las cuotas la parte proporcional la sigue calculando mal: 190 € / 5
 * sesiones = 38 €, por 3 sesiones que son las que da = 114 €, y en el centro
 * aparece 101,33 €.» El caso es real: ADRIANA empieza el 15/09/2026 con dos
 * terapias, y en septiembre de 2026 los martes son 1, 8, 15, 22 y 29. Su
 * agenda tiene tres martes de pedagogía (15, 22 y 29) y uno de psicología.
 *
 * Fallaba por dos sitios a la vez, y por eso hacen falta las dos pruebas:
 * la cuota era «de toda la familia» y las citas del niño no contaban (se caía
 * a los 16/30 días), y aunque hubieran contado, las cuatro citas valían para
 * las dos terapias.
 */
const PEDAGOGIA = "2f849350-3f5e-4670-a1ad-4ec46aa63236";
const PSICOLOGIA = "ff5ebadc-96a3-4839-8bdb-cf50f7983516";
// En UTC, que es como se guardan: las 19:15 y las 16:45 de Madrid en verano.
const CITAS_ADRIANA = [
  { scheduledAt: "2026-09-15T14:45:00.000Z", conceptId: PSICOLOGIA },
  { scheduledAt: "2026-09-15T17:15:00.000Z", conceptId: PEDAGOGIA },
  { scheduledAt: "2026-09-22T17:15:00.000Z", conceptId: PEDAGOGIA },
  { scheduledAt: "2026-09-29T17:15:00.000Z", conceptId: PEDAGOGIA },
];
const CONCEPTOS = [
  { id: PEDAGOGIA, name: "Cuota Pedagogía 60x1", unitPrice: 190 },
  { id: PSICOLOGIA, name: "Cuota Psicología 60x1", unitPrice: 190 },
];

describe("cada terapia paga por SUS sesiones", () => {
  it("LA CUENTA DE ROSA: 190 / 5 martes = 38 €, por 3 sesiones = 114 €", () => {
    const { partes, total } = partesConProrrateo(
      [
        { importe: 190, inicio: "2026-09-15", conceptId: PEDAGOGIA },
        { importe: 190, inicio: "2026-09-15", conceptId: PSICOLOGIA },
      ],
      { mes: "2026-09", citas: CITAS_ADRIANA }
    );
    assert.equal(partes[0].importe, 114, "3 de 5 sesiones de pedagogía");
    assert.equal(partes[0].rotulo, "desde el 15/09/2026 (3 de 5 sesiones)");
    /*
     * La psicología tiene UNA cita en todo el mes, y con una no hay patrón que
     * deducir (AV-0082, esa misma tarde): esa línea vuelve a los días en vez
     * de cobrar «1 de 5 sesiones» = 38 €, que es el número que aparece cuando
     * lo que pasa de verdad es que faltan citas por poner.
     */
    assert.equal(partes[1].importe, 101.33, "16/30 días");
    assert.equal(partes[1].rotulo, "desde el 15/09/2026 (16/30 días)");
    assert.equal(total, 215.33);
  });

  it("y no es lo que salía en pantalla, que eran los 16/30 días", () => {
    assert.equal(prorrateoDeCuota(190, "2026-09-15").importe, 101.33);
  });

  it("sin decir de qué terapia es, la psicología cobra los martes de la pedagogía", () => {
    // Lo que pasaba hasta hoy con las dos líneas: los días con cita del niño,
    // fueran de la terapia que fueran. La de una sola sesión salía por 114 €.
    const { partes } = partesConProrrateo(
      [{ importe: 190, inicio: "2026-09-15" }],
      { mes: "2026-09", citas: CITAS_ADRIANA }
    );
    assert.equal(partes[0].rotulo, "desde el 15/09/2026 (3 de 5 sesiones)");
    assert.equal(partes[0].importe, 114);
  });

  it("dos hermanos en la misma terapia son 3 martes, no 6 sesiones", () => {
    const dePedagogia = CITAS_ADRIANA.filter((c) => c.conceptId === PEDAGOGIA);
    const hermanos = [...dePedagogia, ...dePedagogia.map((c) => ({ ...c, scheduledAt: c.scheduledAt.replace("T17:15", "T16:15") }))];
    const { partes } = partesConProrrateo(
      [{ importe: 190, inicio: "2026-09-15", conceptId: PEDAGOGIA }],
      { mes: "2026-09", citas: hermanos }
    );
    assert.equal(partes[0].importe, 114, "contar las 6 citas daba el mes entero");
  });

  it("generar la cuota da lo mismo que teclearla, también con dos terapias dentro", () => {
    const { aGenerar } = planDeCuotasDelMes({
      mes: "2026-09",
      cuotas: [{ id: "c1", clientId: "f1", patientId: "p1", conceptIds: [PEDAGOGIA, PSICOLOGIA], startDate: "2026-09-15", active: true }],
      conceptos: CONCEPTOS,
      citasPorClave: { "p:p1": CITAS_ADRIANA },
    });
    assert.equal(aGenerar.length, 1);
    assert.equal(aGenerar[0].importe, 215.33, "114 de pedagogía + 101,33 de psicología");
    // Una fue por sesiones y la otra por días: ninguna fracción describe el
    // total, así que el rótulo se queda con la fecha y no finge una cuenta.
    assert.equal(aGenerar[0].rotulo, "desde el 15/09/2026");
  });

  it("AV-0082: una entrevista inicial no le marca el ritmo a la mensualidad", () => {
    /*
     * El caso de Rosa de esa misma tarde: cuota de 182,11 € que salió cobrada
     * a 36,42 €. La familia tenía UNA cita en septiembre —una entrevista
     * inicial, que no es ninguno de los dos servicios de su cuota— y de ahí
     * salió un «1 de 5 sesiones». Por días son 139,62 €, que es lo que se
     * parece a la verdad mientras la agenda del mes no esté puesta.
     */
    const TERAPIA = "4f06876e-09e9-49d8-82f4-a7ce57cd3c04";
    const GRUPAL = "be4393b3-6c89-4cbf-a2f1-31fd397550f7";
    const ENTREVISTA = "1856d8a1-7cfb-4691-94db-5adbff83ffd6";
    const { aGenerar } = planDeCuotasDelMes({
      mes: "2026-09",
      cuotas: [{ id: "c2", clientId: "f2", patientId: "p2", conceptIds: [TERAPIA, GRUPAL], amount: 182.11, startDate: "2026-09-08", active: true }],
      conceptos: [
        { id: TERAPIA, name: "Terapia 1 h semanal", unitPrice: 190 },
        { id: GRUPAL, name: "Grupal: 2 sesiones semanales de 1 h", unitPrice: 85 },
        { id: ENTREVISTA, name: "Entrevista Inicial", unitPrice: 50 },
      ],
      citasPorClave: { "p:p2": [{ scheduledAt: "2026-09-08T09:30:00.000Z", conceptId: ENTREVISTA }] },
    });
    assert.equal(aGenerar.length, 1);
    assert.equal(aGenerar[0].importe, 139.62, "182,11 × 23/30, y no los 36,42 € de «1 de 5»");
    assert.equal(aGenerar[0].rotulo, "desde el 08/09/2026 (23/30 días)");
  });

  it("una sola sesión en un tramo largo va por días: la agenda está a medias", () => {
    const sola = [{ scheduledAt: "2026-09-15T17:15:00.000Z", conceptId: PEDAGOGIA }];
    const { partes } = partesConProrrateo(
      [{ importe: 190, inicio: "2026-09-15", conceptId: PEDAGOGIA }],
      { mes: "2026-09", citas: sola }
    );
    assert.equal(partes[0].rotulo, "desde el 15/09/2026 (16/30 días)");
  });

  it("pero en la última semana del mes una sola sesión SÍ es el patrón", () => {
    const sola = [{ scheduledAt: "2026-09-29T17:15:00.000Z", conceptId: PEDAGOGIA }];
    const { partes } = partesConProrrateo(
      [{ importe: 190, inicio: "2026-09-29", conceptId: PEDAGOGIA }],
      { mes: "2026-09", citas: sola }
    );
    assert.equal(partes[0].rotulo, "desde el 29/09/2026 (1 de 5 sesiones)");
    assert.equal(partes[0].importe, 38);
  });

  it("una terapia sin ninguna cita ese mes va por días, no le roba el ritmo a la otra", () => {
    const { partes } = partesConProrrateo(
      [{ importe: 190, inicio: "2026-09-15", conceptId: "7622e67e-75a0-4cfe-b7fa-ef255c37a990" }],
      { mes: "2026-09", citas: CITAS_ADRIANA }
    );
    assert.equal(partes[0].importe, 101.33, "16/30 días");
  });

  it("citas viejas, sin concepto atado: se cuentan todas, como antes", () => {
    const viejas = CITAS_ADRIANA.map(({ scheduledAt }) => ({ scheduledAt }));
    const { partes } = partesConProrrateo(
      [{ importe: 190, inicio: "2026-09-15", conceptId: PEDAGOGIA }],
      { mes: "2026-09", citas: viejas }
    );
    assert.equal(partes[0].rotulo, "desde el 15/09/2026 (3 de 5 sesiones)");
  });

  it("y las citas de «toda la familia» son las de sus hijos, no las de la ficha", () => {
    const fuente = lee("../lib/billing/citasParaProrrateo.js");
    assert.match(fuente, /quien\.push\(\{ clientId: \{ \[Op\.in\]: familias \} \}\);/);
    assert.ok(!/familias \}, patientId: null/.test(fuente), "pedir patientId null dejaba la cuota de familia sin sesiones");
    assert.match(fuente, /attributes: \["patientId", "clientId", "scheduledAt", "cobroConceptId"\]/);
  });
});

/*
 * ── «ACABÓ EL…» Y LA CUENTA QUE SE LEE (10/09/2026, Rodrigo) ────────────────
 *
 * Dos cosas del mismo encargo:
 *
 *   · «Aparte de Empezó el… también tiene que haber Acabó el…, para los
 *     pacientes que fallan a final de mes pero han empezado bien.»
 *   · «Cuando le doy a empezó el… no me divide por la cantidad de citas que
 *     tiene el niño ese mes sino por la cantidad de días.»
 *
 * Lo segundo no era el cálculo —desde el 07/09 el importe sale por sesiones—:
 * era la línea de debajo del campo, que decía «20/30 días» pasara lo que
 * pasara. La cuenta que se leía no era la que se había hecho.
 */
describe("el mes que se corta por abajo", () => {
  it("acabar el 20 con citas los viernes son 3 de 4 sesiones, no 20 de 30 días", () => {
    const { partes } = partesConProrrateo(
      [{ importe: 190, inicio: "", fin: "2026-09-20" }],
      { mes: "2026-09", citas: VIERNES }
    );
    assert.equal(partes[0].importe, 142.5);
    assert.equal(partes[0].rotulo, "hasta el 20/09/2026 (3 de 4 sesiones)");
    assert.notEqual(partes[0].importe, 126.67, "126,67 € es la cuenta por días");
  });

  it("empezar y acabar dentro del mes cuenta solo las sesiones de en medio", () => {
    const { partes } = partesConProrrateo(
      [{ importe: 190, inicio: "2026-09-08", fin: "2026-09-20" }],
      { mes: "2026-09", citas: VIERNES }
    );
    assert.equal(partes[0].rotulo, "del 08/09/2026 al 20/09/2026 (2 de 4 sesiones)");
    assert.equal(partes[0].importe, 95);
  });
});

describe("y el cajón enseña la cuenta que ha hecho", () => {
  const pagina = lee("../app/(dashboard)/facturacion/cobros/page.jsx");

  it("dice «sesiones» cuando ha ido por sesiones", () => {
    assert.match(pagina, /parte\.prorrateo\.sesiones\.enElTramo\} de \$\{parte\.prorrateo\.sesiones\.enElMes\} sesiones/);
  });

  it("y ya no dice «días» en todos los casos, que era el fallo", () => {
    assert.doesNotMatch(
      pagina,
      /\{parte\.prorrateo\.diasCobrados\}\/\{parte\.prorrateo\.diasDelMes\} días \(de /,
      "esa línea salía igual aunque el importe se hubiera calculado por sesiones"
    );
  });

  it("el campo «Acabó el» está, y escribe en la misma línea que «Empezó el»", () => {
    assert.match(pagina, /Acabó el/);
    assert.match(pagina, /cambiarFechaConcepto\(i, "fin", e\.target\.value\)/);
    assert.match(pagina, /cambiarFechaConcepto\(i, "inicio", e\.target\.value\)/);
  });

  it("y las dos fechas viajan a la cuenta, o «Acabó el» no cobraría nada", () => {
    const conFin = pagina.match(/inicio,\s*fin[,:]/g) ?? [];
    assert.ok(conFin.length >= 2, "las dos cuentas del cajón tienen que llevar el fin");
  });
});

/*
 * ── EL PATRÓN NO PUEDE SER MÁS GRANDE QUE EL RITMO (10/09/2026, Rodrigo) ───
 *
 * Leo Machio, logopedia «45x1» que empieza el jueves 10 de septiembre y sigue
 * los miércoles 16, 23 y 30. Cuatro sesiones, una por semana. Contar todos los
 * días de la semana con cita daba un patrón de dos días y un mes de 9
 * sesiones: 4 de 9, 64,44 € de una cuota de 145 €. La cuenta del centro son
 * 4 de 5 miércoles, 116 €.
 */
const cita = (d, conceptId) => ({ scheduledAt: `${d}T13:30:00.000Z`, conceptId });
const LEO = ["2026-09-10", "2026-09-16", "2026-09-23", "2026-09-30"].map((d) => cita(d));

describe("la primera sesión en otro día no convierte una terapia semanal en dos", () => {
  it("Leo: 4 de 5 sesiones, 116 € de 145 €", () => {
    const t = tramoDelMes("2026-09", { startDate: "2026-09-10" }, { citas: LEO });
    assert.deepEqual(t.sesiones, { enElTramo: 4, enElMes: 5 });
    assert.equal(Math.round(145 * t.factor * 100) / 100, 116);
    assert.equal(rotuloDeTramo(t), "desde el 10/09/2026 (4 de 5 sesiones)");
  });

  it("y la misma cuenta la hace la generación del mes", () => {
    const plan = planDeCuotasDelMes({
      mes: "2026-09",
      cuotas: [{ id: "1", clientId: "f1", patientId: "leo", conceptIds: ["logo"], startDate: "2026-09-10" }],
      conceptos: [{ id: "logo", name: "Cuota Logopedia 45x1", unitPrice: 145 }],
      citasPorClave: { "p:leo": LEO.map((c) => ({ ...c, conceptId: "logo" })) },
    });
    assert.equal(plan.aGenerar[0].importe, 116);
    assert.equal(plan.aGenerar[0].rotulo, "desde el 10/09/2026 (4 de 5 sesiones)");
  });

  it("un «45x2» de verdad sigue contando sus DOS días de la semana", () => {
    // Martes y jueves desde el 8: 7 sesiones sobre 5 martes + 4 jueves.
    const dos = ["2026-09-08", "2026-09-10", "2026-09-15", "2026-09-17", "2026-09-22", "2026-09-24", "2026-09-29"]
      .map((d) => cita(d));
    const t = tramoDelMes("2026-09", { startDate: "2026-09-08" }, { citas: dos });
    assert.deepEqual(t.sesiones, { enElTramo: 7, enElMes: 9 });
  });

  it("y un «60x1» de los viernes se sigue midiendo sobre los 4 viernes del mes", () => {
    const t = tramoDelMes("2026-09", { startDate: "2026-09-11" }, { citas: VIERNES });
    assert.deepEqual(t.sesiones, { enElTramo: 3, enElMes: 4 });
  });

  it("empatados, manda el día de la última sesión: es el ritmo que ya se asentó", () => {
    const t = tramoDelMes("2026-09", { startDate: "2026-09-10" }, { citas: [cita("2026-09-10"), cita("2026-09-16")] });
    assert.deepEqual(t.sesiones, { enElTramo: 2, enElMes: 5 }, "los miércoles, no los jueves");
  });
});

describe("y el cajón ya no espera a que alguien teclee la fecha", () => {
  const pagina = lee("../app/(dashboard)/facturacion/cobros/page.jsx");

  it("«Empezó el» y «Acabó el» salen de la cuota", () => {
    assert.match(pagina, /tramosDeCuotas\(cuotas, form\.periodMonth\)/);
    assert.match(pagina, /\.\.\.\(tramos\?\.\[i\] \?\? \{\}\)/);
  });

  it("pero un cobro suelto de una cita no hereda el tramo de la mensualidad", () => {
    assert.match(pagina, /tramos = null;/);
  });

  it("y lo cobrado de otro servicio no salda la cuota", () => {
    assert.match(pagina, /conceptIds: conceptosDelCobro/);
    assert.match(pagina, /cobrosDeOtroServicio\(cobrosDelMes/);
  });
});
