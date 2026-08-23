// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-fichaje-horas.mjs — las horas del fichaje se leen y se suman bien (19/08/2026).
 *
 *   node scripts/_smoke-fichaje-horas.mjs
 *   node --test-name-pattern="parseDuracion" scripts/_smoke-fichaje-horas.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * El módulo Fichaje (13/08/2026) es el control horario de Aumenta: 15 personas
 * cuyo Excel del reloj se vuelca cada mes y acaba en una nómina. La frase que
 * manda sobre el módulo entero está en `docs/modules/fichaje.md`: «un fichaje
 * mal importado es una nómina mal pagada». Y el Mapa de ese mismo doc decía, en
 * la fila de Pruebas, «ninguna»: las funciones que leen una celda de Excel y
 * las que suman los minutos de cada persona eran puras y se podían probar sin
 * base de datos, pero nadie lo hacía. La única red era leer el código.
 *
 * Las reglas que esta prueba fija ya estaban escritas, en los comentarios de
 * `lib/fichaje/parseHora.js` y `lib/fichaje/totales.js`: la hora de una celda
 * `Date` se lee en UTC y no en la zona local (pasarla por la zona local la
 * movería una hora); un entero en una celda de hora es una fecha, no una hora;
 * una duración negativa —la fórmula del Excel de Aumenta restando contra una
 * salida vacía da 1899-12-29, que son −956 minutos— se rechaza y no acaba en
 * una nómina disfrazada de horas; si la salida es anterior a la entrada se
 * asume turno de noche y se avisa; quien no tiene ni un fichaje en todo el mes
 * tiene que SALIR en el listado, no desaparecer; las extras solo cuentan cuando
 * hay horario previsto. Cada una de esas frases es aquí un `it`. Si alguien
 * toca un redondeo o un signo, la prueba que falla lleva la regla en el nombre.
 *
 * Dos de esas frases no eran ciertas y se arreglaron el 20/08/2026, cuando esta
 * misma prueba las miró de cerca: un tramo dado de baja SÍ sumaba minutos (solo
 * lo tapaba el `deletedAt: null` de los dos endpoints), y el aviso de «sin
 * ningún fichaje este mes», que no lleva fecha, salía el PRIMERO de la lista en
 * vez de detrás de los días concretos que hay que arreglar.
 *
 * Forma: `node:test` + `node:assert/strict`, como `_smoke-citas-dinero.mjs`.
 * Aserciones sobre lo que DEVUELVEN las funciones, nunca sobre el texto del
 * código. Las entradas imitan lo que de verdad llega desde los dos lectores
 * (`parsers/aumenta.js`, `parsers/generico.js`): celdas de ExcelJS con
 * `value` pelado, con fórmula (`{result}`), con texto enriquecido, como `Date`
 * con época 1899-12-30, como fracción de día, como texto «08:30» / «8.30» /
 * «8,5», vacías o con espacios. Para los totales, filas como las que devuelve
 * la tabla `fichajes` ya convertidas a objetos planos.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  valorDeCelda,
  parseHoraDelDia,
  parseDuracion,
  formatearMinutos,
  formatearHora,
  minutosEntre,
} from "../lib/fichaje/parseHora.js";
import {
  resumirPorPersona,
  totalesDelMes,
  avisosDelMes,
  rangoDelPeriodo,
} from "../lib/fichaje/totales.js";

// ── Piezas para fabricar entradas como las reales ───────────────────────────

/** La hora «HH:MM» tal como ExcelJS la entrega: un Date con época 1899-12-30, en UTC. */
const horaExcel = (h, m = 0) => new Date(Date.UTC(1899, 11, 30, h, m));

/** Una celda de ExcelJS con un valor pelado. */
const celda = (value) => ({ value });
/** Una celda de ExcelJS con fórmula: el valor es un objeto con `result`. */
const celdaFormula = (result) => ({ value: { formula: "=G5-D5", result } });

const ok = (valor) => ({ ok: true, valor, motivo: null });

/** Una fila de la tabla `fichajes` ya plana, con lo que mira `totales.js`. */
function tramo(sobre = {}) {
  return {
    id: "f-1",
    teamMemberId: "ana",
    fecha: "2026-03-02",
    entradaAt: "08:00:00",
    salidaAt: "16:00:00",
    minutos: 480,
    minutosPrevistos: 480,
    tipo: "trabajo",
    origen: "import",
    deletedAt: null,
    ...sobre,
  };
}

/** El equipo activo, como lo devuelve el endpoint: id, displayName, email. */
const EQUIPO = [
  { id: "bea", displayName: "Beatriz", email: "bea@example.com" },
  { id: "ana", displayName: "Ana", email: "ana@example.com" },
];

const porId = (resumen, id) => resumen.find((r) => r.teamMemberId === id);
const tipos = (avisos) => avisos.map((a) => a.tipo);

// ═══════════════════════════════════════════════════════════════════════════
// parseHora.js
// ═══════════════════════════════════════════════════════════════════════════

describe("valorDeCelda: desenvuelve la celda de ExcelJS sin reventar", () => {
  it("una celda con valor pelado devuelve ese valor; un valor suelto, él mismo", () => {
    assert.equal(valorDeCelda(celda("08:30")), "08:30");
    assert.equal(valorDeCelda(celda(0.5)), 0.5);
    assert.equal(valorDeCelda("08:30"), "08:30");
    assert.equal(valorDeCelda(0), 0);
  });
  it("una fórmula devuelve su resultado, sea texto, número o Date", () => {
    assert.equal(valorDeCelda(celdaFormula("13:50")), "13:50");
    assert.equal(valorDeCelda(celdaFormula(0.5)), 0.5);
    const d = horaExcel(9, 15);
    assert.equal(valorDeCelda(celdaFormula(d)), d);
  });
  it("un Date se devuelve tal cual, no convertido a texto", () => {
    const d = horaExcel(14, 0);
    assert.equal(valorDeCelda(celda(d)), d);
    assert.equal(valorDeCelda(d), d);
  });
  it("texto enriquecido se junta en un solo texto", () => {
    const rica = celda({ richText: [{ text: "08" }, { text: ":30" }] });
    assert.equal(valorDeCelda(rica), "08:30");
  });
  it("texto enriquecido con trozos sin `text` no mete «undefined»", () => {
    const rica = celda({ richText: [{ text: "8" }, {}, { text: ":30" }] });
    assert.equal(valorDeCelda(rica), "8:30");
  });
  it("un objeto con `.text` (hipervínculo) devuelve ese texto", () => {
    assert.equal(valorDeCelda(celda({ text: "09:00", hyperlink: "x" })), "09:00");
  });
  it("vacío es null: celda sin valor, null, undefined, objeto sin nada", () => {
    assert.equal(valorDeCelda(celda(null)), null);
    assert.equal(valorDeCelda(celda(undefined)), null);
    assert.equal(valorDeCelda(null), null);
    assert.equal(valorDeCelda(undefined), null);
    assert.equal(valorDeCelda(celda({})), null);
  });
  it("una celda COMBINADA cuyo getter `.text` revienta devuelve null en vez de tumbar la importación", () => {
    const combinada = {
      value: {
        get text() {
          throw new TypeError("Cannot read properties of null");
        },
      },
    };
    assert.equal(valorDeCelda(combinada), null);
  });
  it("si lo que revienta es el propio `.value`, también null", () => {
    const rota = {
      get value() {
        throw new TypeError("boom");
      },
    };
    assert.equal(valorDeCelda(rota), null);
  });
  it("no recorta espacios: eso lo hace quien interpreta la celda", () => {
    assert.equal(valorDeCelda(celda(" 08:30 ")), " 08:30 ");
  });
});

describe("parseHoraDelDia: hora del día → minutos desde medianoche, o «no lo entiendo»", () => {
  it("siempre devuelve {ok, valor, motivo}: con ok, valor entero y motivo null", () => {
    assert.deepEqual(parseHoraDelDia("08:30"), ok(510));
  });
  it("sin ok, valor es null y motivo dice por qué: nunca un número a medias", () => {
    const r = parseHoraDelDia("abc");
    assert.equal(r.ok, false);
    assert.equal(r.valor, null);
    assert.equal(typeof r.motivo, "string");
  });

  // Forma 1: Date con época 1899-12-30 (lo que ExcelJS da en una celda de hora)
  it("un Date de ExcelJS se lee por sus horas y minutos en UTC: 14:00Z son las 14:00", () => {
    assert.deepEqual(parseHoraDelDia(horaExcel(14, 0)), ok(840));
    assert.deepEqual(parseHoraDelDia(horaExcel(8, 30)), ok(510));
  });
  it("la hora del Date no depende del día que lleve delante: solo importan horas y minutos", () => {
    assert.deepEqual(parseHoraDelDia(new Date(Date.UTC(2026, 2, 2, 8, 30))), ok(510));
  });
  it("medianoche en un Date es 0, no vacío", () => {
    assert.deepEqual(parseHoraDelDia(horaExcel(0, 0)), ok(0));
  });
  it("un Date inválido no es una hora", () => {
    const r = parseHoraDelDia(new Date("no es fecha"));
    assert.equal(r.ok, false);
    assert.equal(r.motivo, "fecha inválida");
  });

  // Forma 2: texto escrito a mano
  it("«13:50», «8:30», «08:30:00» son texto de reloj; los segundos se ignoran", () => {
    assert.deepEqual(parseHoraDelDia("13:50"), ok(830));
    assert.deepEqual(parseHoraDelDia("8:30"), ok(510));
    assert.deepEqual(parseHoraDelDia("08:30:00"), ok(510));
  });
  it("«8.30» y «8h30» son también las 8:30 (punto y hache como separador de reloj)", () => {
    assert.deepEqual(parseHoraDelDia("8.30"), ok(510));
    assert.deepEqual(parseHoraDelDia("8h30"), ok(510));
    assert.deepEqual(parseHoraDelDia("8H30"), ok(510));
  });
  it("la regla del punto (19/08/2026): con DOS dígitos detrás es reloj, con uno es decimal", () => {
    // Antes «8.5» caía en el regex de reloj y se leía como las 8:05.
    assert.deepEqual(parseHoraDelDia("8.5"), ok(510));
    assert.deepEqual(parseHoraDelDia("8.05"), ok(485));
    assert.deepEqual(parseHoraDelDia("8.50"), ok(530));
    assert.deepEqual(parseHoraDelDia("8.333"), ok(500));
    assert.deepEqual(parseHoraDelDia("23.59"), ok(1439));
    assert.equal(parseHoraDelDia("24.00").ok, false);
  });
  it("la coma es siempre decimal, también con dos dígitos: «8,30» son 8,3 horas", () => {
    assert.deepEqual(parseHoraDelDia("8,30"), ok(498));
  });
  it("«8,5» con coma es hora decimal: las 8:30", () => {
    assert.deepEqual(parseHoraDelDia("8,5"), ok(510));
    assert.deepEqual(parseHoraDelDia("8,25"), ok(495));
    assert.deepEqual(parseHoraDelDia("0,5"), ok(30));
  });
  it("«14» a secas son las 14:00; «0», medianoche", () => {
    assert.deepEqual(parseHoraDelDia("14"), ok(840));
    assert.deepEqual(parseHoraDelDia("0"), ok(0));
  });
  it("los espacios alrededor no molestan", () => {
    assert.deepEqual(parseHoraDelDia("  08:30  "), ok(510));
    assert.deepEqual(parseHoraDelDia(celda(" 9:00")), ok(540));
  });
  it("«24:00», «23:60», «24» y «24,0» están fuera de rango y se rechazan", () => {
    assert.equal(parseHoraDelDia("24:00").ok, false);
    assert.equal(parseHoraDelDia("23:60").ok, false);
    assert.equal(parseHoraDelDia("24").ok, false);
    assert.equal(parseHoraDelDia("24,0").ok, false);
    assert.match(parseHoraDelDia("24:00").motivo, /fuera de rango/);
  });
  it("«23:59» es la última hora válida", () => {
    assert.deepEqual(parseHoraDelDia("23:59"), ok(1439));
  });
  it("texto que no es una hora se rechaza y el motivo enseña qué había en la celda", () => {
    const r = parseHoraDelDia("BAJA");
    assert.equal(r.ok, false);
    assert.match(r.motivo, /BAJA/);
  });
  it("un texto larguísimo se recorta en el motivo para no inundar el preview", () => {
    const r = parseHoraDelDia("x".repeat(200));
    assert.equal(r.ok, false);
    assert.ok(r.motivo.length < 80, r.motivo);
  });

  // Forma 3: número = fracción de día
  it("un número es fracción de día: 0,5 es mediodía, 0,25 las 6:00, 0 medianoche", () => {
    assert.deepEqual(parseHoraDelDia(0.5), ok(720));
    assert.deepEqual(parseHoraDelDia(0.25), ok(360));
    assert.deepEqual(parseHoraDelDia(0), ok(0));
  });
  it("la fracción se redondea al minuto: el ruido de coma flotante del Excel no deja 509,99", () => {
    assert.deepEqual(parseHoraDelDia(0.35416666666666669), ok(510));
    assert.deepEqual(parseHoraDelDia(0.3541666666), ok(510));
  });
  it("un entero ≥ 1 es un serial de fecha, no una hora del día: se rechaza", () => {
    assert.equal(parseHoraDelDia(1).ok, false);
    assert.equal(parseHoraDelDia(45000).ok, false);
    assert.match(parseHoraDelDia(45000).motivo, /fecha/);
  });
  it("un serial de fecha CON parte decimal sí tiene hora: se saca de la fracción", () => {
    assert.deepEqual(parseHoraDelDia(45000.5), ok(720));
  });
  it("una fracción que redondea a 1440 vuelve a 0 (23:59:59 es medianoche)", () => {
    assert.deepEqual(parseHoraDelDia(0.9999999), ok(0));
  });
  it("negativos, NaN e Infinity no son horas", () => {
    assert.equal(parseHoraDelDia(-0.5).ok, false);
    assert.equal(parseHoraDelDia(NaN).ok, false);
    assert.equal(parseHoraDelDia(Infinity).ok, false);
  });

  // Forma 4: fórmula
  it("una celda con fórmula se lee por su resultado, sea cual sea su forma", () => {
    assert.deepEqual(parseHoraDelDia(celdaFormula("13:50")), ok(830));
    assert.deepEqual(parseHoraDelDia(celdaFormula(0.5)), ok(720));
    assert.deepEqual(parseHoraDelDia(celdaFormula(horaExcel(9, 15))), ok(555));
  });

  // Vacío y basura
  it("el vacío se dice como tal: null, undefined, «», solo espacios, celda sin valor", () => {
    for (const v of [null, undefined, "", "   ", celda(null), celda(""), celda({}), {}]) {
      const r = parseHoraDelDia(v);
      assert.equal(r.ok, false, `debería fallar con ${JSON.stringify(v)}`);
      assert.equal(r.motivo, "vacío", `motivo con ${JSON.stringify(v)}`);
    }
  });
  it("un tipo que no es hora (booleano) se rechaza sin lanzar", () => {
    assert.equal(parseHoraDelDia(true).ok, false);
    assert.equal(parseHoraDelDia(celda(false)).ok, false);
  });
});

describe("parseDuracion: duración → minutos; admite más de 24 h y el entero son horas", () => {
  it("«7:30», «7.30», «7h30» y «7,5» son siete horas y media", () => {
    assert.deepEqual(parseDuracion("7:30"), ok(450));
    assert.deepEqual(parseDuracion("7.30"), ok(450));
    assert.deepEqual(parseDuracion("7h30"), ok(450));
    assert.deepEqual(parseDuracion("7,5"), ok(450));
  });
  it("y «7.5» TAMBIÉN (19/08/2026): la plantilla genérica promete «7:30, 7,5 o 7.5» y pagaba 7 h 05", () => {
    assert.deepEqual(parseDuracion("7.5"), ok(450));
    assert.deepEqual(parseDuracion("7.25"), ok(445)); // punto + dos dígitos = reloj, 7 h 25
    assert.deepEqual(parseDuracion("100.5"), ok(6030)); // un total de mes con decimales
    assert.equal(parseDuracion("7.60").ok, false); // reloj con minutos fuera de rango: se dice, no se adivina
  });
  it("un entero en texto o en número son HORAS, no la hora del día: «8» son ocho horas", () => {
    assert.deepEqual(parseDuracion("8"), ok(480));
    assert.deepEqual(parseDuracion(8), ok(480));
    assert.deepEqual(parseDuracion(1), ok(60));
  });
  it("un número por debajo de 1 es fracción de día (viene de una celda de hora)", () => {
    assert.deepEqual(parseDuracion(0.5), ok(720));
    assert.deepEqual(parseDuracion(0.35416666666666669), ok(510));
  });
  it("un número ≥ 1 con decimales son horas: 8,5 son 510 minutos", () => {
    assert.deepEqual(parseDuracion(8.5), ok(510));
    assert.deepEqual(parseDuracion(7.25), ok(435));
  });
  it("admite más de 24 horas: «25:00» y «100:00»", () => {
    assert.deepEqual(parseDuracion("25:00"), ok(1500));
    assert.deepEqual(parseDuracion("100:00"), ok(6000));
  });
  it("un Date de ExcelJS en el día de la época es su hora: 08:30Z son 510 minutos", () => {
    assert.deepEqual(parseDuracion(horaExcel(8, 30)), ok(510));
  });
  it("un Date un día por encima de la época suma 24 h: 1899-12-31T01:00Z son 25 h", () => {
    assert.deepEqual(parseDuracion(new Date(Date.UTC(1899, 11, 31, 1, 0))), ok(1500));
  });
  it("una duración NEGATIVA se rechaza: 1899-12-29T08:04Z (los −956 min del Excel de Aumenta sin salida)", () => {
    const r = parseDuracion(new Date(Date.UTC(1899, 11, 29, 8, 4)));
    assert.equal(r.ok, false);
    assert.equal(r.valor, null);
    assert.match(r.motivo, /negativa/);
  });
  it("un número negativo también se rechaza", () => {
    assert.equal(parseDuracion(-1).ok, false);
    assert.equal(parseDuracion(-0.5).ok, false);
    assert.match(parseDuracion(-1).motivo, /negativa/);
  });
  it("cero es una duración válida de cero minutos (quien llama decide si cuenta)", () => {
    assert.deepEqual(parseDuracion(0), ok(0));
    assert.deepEqual(parseDuracion("0"), ok(0));
  });
  it("minutos por encima de 59 en texto de reloj se rechazan", () => {
    assert.equal(parseDuracion("8:60").ok, false);
    assert.match(parseDuracion("8:60").motivo, /minutos fuera de rango/);
  });
  it("texto que no es una duración se rechaza con el texto en el motivo", () => {
    for (const s of ["abc", "-8", "1000:00", "ocho horas"]) {
      const r = parseDuracion(s);
      assert.equal(r.ok, false, s);
      assert.match(r.motivo, /no parece una duración/);
    }
  });
  it("el vacío se dice como tal", () => {
    for (const v of [null, undefined, "", "  ", celda(null)]) {
      assert.equal(parseDuracion(v).motivo, "vacío", JSON.stringify(v));
    }
  });
  it("NaN, Infinity, Date inválido y booleanos no lanzan: devuelven ok:false", () => {
    assert.equal(parseDuracion(NaN).ok, false);
    assert.equal(parseDuracion(Infinity).ok, false);
    assert.equal(parseDuracion(new Date("x")).ok, false);
    assert.equal(parseDuracion(true).ok, false);
  });
  it("una fórmula se lee por su resultado", () => {
    assert.deepEqual(parseDuracion(celdaFormula(horaExcel(7, 45))), ok(465));
    assert.deepEqual(parseDuracion(celdaFormula("7,5")), ok(450));
  });
});

describe("formatearMinutos: minutos → «8h 30min» para pantalla y Excel de salida", () => {
  it("horas y minutos, con los minutos a dos cifras", () => {
    assert.equal(formatearMinutos(510), "8h 30min");
    assert.equal(formatearMinutos(485), "8h 05min");
    assert.equal(formatearMinutos(61), "1h 01min");
  });
  it("solo horas cuando los minutos son cero; solo minutos cuando no llega a una hora", () => {
    assert.equal(formatearMinutos(480), "8h");
    assert.equal(formatearMinutos(60), "1h");
    assert.equal(formatearMinutos(30), "30min");
    assert.equal(formatearMinutos(0), "0min");
  });
  it("negativos llevan el signo delante (la diferencia con lo previsto puede serlo)", () => {
    assert.equal(formatearMinutos(-30), "-30min");
    assert.equal(formatearMinutos(-90), "-1h 30min");
    assert.equal(formatearMinutos(-480), "-8h");
  });
  it("más de un día se enseña en horas, no se envuelve", () => {
    assert.equal(formatearMinutos(1440), "24h");
    assert.equal(formatearMinutos(1500), "25h");
  });
  it("redondea al minuto: 89,6 son 1h 30min", () => {
    assert.equal(formatearMinutos(89.6), "1h 30min");
    assert.equal(formatearMinutos(89.4), "1h 29min");
  });
  it("acepta el número como texto («510»)", () => {
    assert.equal(formatearMinutos("510"), "8h 30min");
  });
  it("sin dato, una raya: null, undefined, NaN, texto que no es número", () => {
    assert.equal(formatearMinutos(null), "—");
    assert.equal(formatearMinutos(undefined), "—");
    assert.equal(formatearMinutos(NaN), "—");
    assert.equal(formatearMinutos("abc"), "—");
  });
});

describe("formatearHora: minutos desde medianoche → «08:30», para pantalla y la columna TIME", () => {
  it("dos cifras siempre: «08:30», «00:00», «23:59»", () => {
    assert.equal(formatearHora(510), "08:30");
    assert.equal(formatearHora(0), "00:00");
    assert.equal(formatearHora(1439), "23:59");
    assert.equal(formatearHora(840), "14:00");
  });
  it("1440 da la vuelta a medianoche, y 1500 es la 01:00", () => {
    assert.equal(formatearHora(1440), "00:00");
    assert.equal(formatearHora(1500), "01:00");
  });
  it("un negativo da la vuelta hacia atrás: −60 son las 23:00", () => {
    assert.equal(formatearHora(-60), "23:00");
  });
  it("redondea al minuto y acepta texto numérico", () => {
    assert.equal(formatearHora(89.6), "01:30");
    assert.equal(formatearHora("510"), "08:30");
  });
  it("sin dato, null (no una raya: aquí lo consume una columna TIME)", () => {
    assert.equal(formatearHora(null), null);
    assert.equal(formatearHora(undefined), null);
    assert.equal(formatearHora(NaN), null);
    assert.equal(formatearHora("abc"), null);
  });
});

describe("minutosEntre: minutos trabajados entre dos horas del día", () => {
  it("salida después de la entrada: la resta, sin cruzar medianoche", () => {
    assert.deepEqual(minutosEntre(510, 1020), { minutos: 510, cruzaMedianoche: false });
    assert.deepEqual(minutosEntre(0, 480), { minutos: 480, cruzaMedianoche: false });
  });
  it("salida ANTERIOR a la entrada: se asume turno de noche, se suman 24 h y se avisa", () => {
    assert.deepEqual(minutosEntre(1320, 360), { minutos: 480, cruzaMedianoche: true });
    assert.deepEqual(minutosEntre(1439, 0), { minutos: 1, cruzaMedianoche: true });
  });
  it("el aviso de medianoche lo recibe quien llama; aquí no se decide si es error de tecleo", () => {
    const r = minutosEntre(1020, 510);
    assert.equal(r.cruzaMedianoche, true);
    assert.equal(r.minutos, 930);
  });
  it("misma hora de entrada y salida: cero minutos, sin cruzar", () => {
    assert.deepEqual(minutosEntre(510, 510), { minutos: 0, cruzaMedianoche: false });
  });
  it("si falta la entrada o la salida (null), minutos es null y no se inventa nada", () => {
    assert.deepEqual(minutosEntre(null, 600), { minutos: null, cruzaMedianoche: false });
    assert.deepEqual(minutosEntre(600, null), { minutos: null, cruzaMedianoche: false });
    assert.deepEqual(minutosEntre(null, null), { minutos: null, cruzaMedianoche: false });
  });
});

describe("coherencia entre las funciones de parseHora (lo que lee uno lo pinta el otro)", () => {
  it("formatearHora(parseHoraDelDia(x)) devuelve x para texto de reloj a dos cifras", () => {
    for (const s of ["08:30", "00:00", "23:59", "14:00", "09:05"]) {
      assert.equal(formatearHora(parseHoraDelDia(s).valor), s);
    }
  });
  it("un Date de ExcelJS, una fracción de día y un texto de la misma hora dan el mismo minuto", () => {
    const a = parseHoraDelDia(horaExcel(8, 30)).valor;
    const b = parseHoraDelDia(0.35416666666666669).valor;
    const c = parseHoraDelDia("8:30").valor;
    assert.equal(a, 510);
    assert.equal(a, b);
    assert.equal(b, c);
    assert.equal(formatearHora(a), "08:30");
  });
  it("«8:30» vale lo mismo como hora del día que como duración", () => {
    assert.equal(parseHoraDelDia("8:30").valor, parseDuracion("8:30").valor);
    assert.equal(parseHoraDelDia(horaExcel(8, 30)).valor, parseDuracion(horaExcel(8, 30)).valor);
  });
  it("la jornada de Aumenta: de «08:30» a «17:00» son 8h 30min", () => {
    const entrada = parseHoraDelDia(horaExcel(8, 30));
    const salida = parseHoraDelDia("17:00");
    const { minutos, cruzaMedianoche } = minutosEntre(entrada.valor, salida.valor);
    assert.equal(minutos, 510);
    assert.equal(cruzaMedianoche, false);
    assert.equal(formatearMinutos(minutos), "8h 30min");
  });
  it("formatearMinutos(parseDuracion(«7,5»)) es «7h 30min»", () => {
    assert.equal(formatearMinutos(parseDuracion("7,5").valor), "7h 30min");
  });
  it("un minuto sumado de horas no arrastra decimales: dos tramos suman entero", () => {
    const manana = minutosEntre(
      parseHoraDelDia(0.35416666666666669).valor,
      parseHoraDelDia(0.5).valor
    );
    const tarde = minutosEntre(parseHoraDelDia("15:00").valor, parseHoraDelDia("19:30").valor);
    assert.equal(manana.minutos + tarde.minutos, 210 + 270);
    assert.equal(Number.isInteger(manana.minutos + tarde.minutos), true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// totales.js
// ═══════════════════════════════════════════════════════════════════════════

describe("resumirPorPersona: el resumen del mes por persona", () => {
  it("quien no tiene ni un fichaje SALE en el listado, con todo a cero: es justo el caso que hay que ver", () => {
    const resumen = resumirPorPersona([], EQUIPO);
    assert.equal(resumen.length, 2);
    for (const r of resumen) {
      assert.deepEqual(r, {
        teamMemberId: r.teamMemberId,
        nombre: r.nombre,
        dias: 0,
        minutos: 0,
        minutosPrevistos: 0,
        extras: 0,
        correcciones: 0,
        filas: 0,
      });
    }
  });
  it("la lista de personas manda, no los fichajes: un fichaje de alguien que no está se ignora", () => {
    const resumen = resumirPorPersona([tramo({ teamMemberId: "nadie" })], EQUIPO);
    assert.equal(resumen.length, 2);
    assert.equal(
      resumen.every((r) => r.minutos === 0),
      true
    );
  });
  it("una persona con varios fichajes: minutos y previstos se suman, filas se cuentan", () => {
    const filas = [
      tramo({ id: "1", fecha: "2026-03-02", minutos: 480, minutosPrevistos: 480 }),
      tramo({ id: "2", fecha: "2026-03-03", minutos: 450, minutosPrevistos: 480 }),
      tramo({ id: "3", fecha: "2026-03-04", minutos: 510, minutosPrevistos: 480 }),
    ];
    const ana = porId(resumirPorPersona(filas, EQUIPO), "ana");
    assert.equal(ana.filas, 3);
    assert.equal(ana.minutos, 1440);
    assert.equal(ana.minutosPrevistos, 1440);
    assert.equal(ana.dias, 3);
  });
  it("dos tramos el mismo día (mañana y tarde) son UN día y DOS filas", () => {
    const filas = [
      tramo({ id: "m", fecha: "2026-03-03", entradaAt: "08:00", salidaAt: "12:00", minutos: 240 }),
      tramo({ id: "t", fecha: "2026-03-03", entradaAt: "15:00", salidaAt: "20:00", minutos: 300 }),
    ];
    const ana = porId(resumirPorPersona(filas, EQUIPO), "ana");
    assert.equal(ana.dias, 1);
    assert.equal(ana.filas, 2);
    assert.equal(ana.minutos, 540);
  });
  it("solo cuentan los tramos de tipo «trabajo»: pausas, ausencias y festivos no suman ni cuentan días", () => {
    const filas = [
      tramo({ id: "1", fecha: "2026-03-02", minutos: 480 }),
      tramo({ id: "2", fecha: "2026-03-03", tipo: "pausa", minutos: 30 }),
      tramo({ id: "3", fecha: "2026-03-04", tipo: "ausencia", minutos: 480 }),
      tramo({ id: "4", fecha: "2026-03-05", tipo: "festivo", minutos: 480 }),
    ];
    const ana = porId(resumirPorPersona(filas, EQUIPO), "ana");
    assert.equal(ana.filas, 1);
    assert.equal(ana.minutos, 480);
    assert.equal(ana.dias, 1);
  });
  it("las extras son la diferencia con lo previsto, y pueden ser negativas (hizo de menos)", () => {
    const deMas = porId(
      resumirPorPersona([tramo({ minutos: 540, minutosPrevistos: 480 })], EQUIPO),
      "ana"
    );
    assert.equal(deMas.extras, 60);
    const deMenos = porId(
      resumirPorPersona([tramo({ minutos: 420, minutosPrevistos: 480 })], EQUIPO),
      "ana"
    );
    assert.equal(deMenos.extras, -60);
  });
  it("sin horario previsto no hay extras: nadie hace «de más» respecto a nada", () => {
    const ana = porId(
      resumirPorPersona([tramo({ minutos: 600, minutosPrevistos: null })], EQUIPO),
      "ana"
    );
    assert.equal(ana.minutosPrevistos, 0);
    assert.equal(ana.extras, 0);
  });
  it("las extras se calculan sobre el TOTAL del mes, no fila a fila", () => {
    const filas = [
      tramo({ id: "1", fecha: "2026-03-02", minutos: 540, minutosPrevistos: 480 }),
      tramo({ id: "2", fecha: "2026-03-03", minutos: 420, minutosPrevistos: 480 }),
    ];
    assert.equal(porId(resumirPorPersona(filas, EQUIPO), "ana").extras, 0);
  });
  it("las correcciones son los tramos que NO vinieron del Excel: manual y corregido", () => {
    const filas = [
      tramo({ id: "1", fecha: "2026-03-02", origen: "import" }),
      tramo({ id: "2", fecha: "2026-03-03", origen: "manual" }),
      tramo({ id: "3", fecha: "2026-03-04", origen: "corregido" }),
    ];
    assert.equal(porId(resumirPorPersona(filas, EQUIPO), "ana").correcciones, 2);
  });
  it("el nombre sale de displayName; si no hay, del email; si tampoco, «(sin nombre)»", () => {
    const equipo = [
      { id: "a", displayName: "Ana", email: "ana@example.com" },
      { id: "b", displayName: null, email: "bea@example.com" },
      { id: "c", displayName: "", email: "" },
    ];
    const resumen = resumirPorPersona([], equipo);
    assert.equal(porId(resumen, "a").nombre, "Ana");
    assert.equal(porId(resumen, "b").nombre, "bea@example.com");
    assert.equal(porId(resumen, "c").nombre, "(sin nombre)");
  });
  it("se ordena por nombre en español, no por el orden del equipo ni de los fichajes", () => {
    const equipo = [
      { id: "z", displayName: "Zoe" },
      { id: "a", displayName: "Álvaro" },
      { id: "b", displayName: "Beatriz" },
    ];
    assert.deepEqual(
      resumirPorPersona([], equipo).map((r) => r.nombre),
      ["Álvaro", "Beatriz", "Zoe"]
    );
  });
  it("minutos que llegan como texto o nulos no rompen la suma", () => {
    const filas = [
      tramo({ id: "1", fecha: "2026-03-02", minutos: "480", minutosPrevistos: "480" }),
      tramo({ id: "2", fecha: "2026-03-03", minutos: null, minutosPrevistos: undefined }),
    ];
    const ana = porId(resumirPorPersona(filas, EQUIPO), "ana");
    assert.equal(ana.minutos, 480);
    assert.equal(ana.minutosPrevistos, 480);
    assert.equal(ana.filas, 2);
  });
  it("un tramo dado de baja NO suma: ni minutos, ni día, ni fila (lo que se borró no se paga)", () => {
    const filas = [
      tramo({ id: "1", fecha: "2026-03-02", minutos: 480, deletedAt: "2026-03-05T10:00:00.000Z" }),
      tramo({ id: "2", fecha: "2026-03-03", minutos: 420 }),
    ];
    const ana = porId(resumirPorPersona(filas, EQUIPO), "ana");
    assert.equal(ana.minutos, 420);
    assert.equal(ana.minutosPrevistos, 480);
    assert.equal(ana.dias, 1);
    assert.equal(ana.filas, 1);
  });
  it("una fila dada de baja tampoco cuenta como corrección ni deja a la persona con horas fantasma", () => {
    const filas = [
      tramo({ id: "1", origen: "manual", deletedAt: "2026-03-05T10:00:00.000Z" }),
    ];
    const ana = porId(resumirPorPersona(filas, EQUIPO), "ana");
    assert.equal(ana.correcciones, 0);
    assert.equal(ana.minutos, 0);
    assert.equal(ana.extras, 0);
    assert.equal(totalesDelMes(resumirPorPersona(filas, EQUIPO)).personasConFichajes, 0);
  });
  it("sin equipo, lista vacía (aunque haya fichajes)", () => {
    assert.deepEqual(resumirPorPersona([tramo()], []), []);
  });
});

describe("totalesDelMes: los números de cabecera, sumados del resumen", () => {
  it("con el resumen vacío, todo a cero", () => {
    assert.deepEqual(totalesDelMes([]), {
      personas: 0,
      personasConFichajes: 0,
      minutos: 0,
      minutosPrevistos: 0,
      extras: 0,
      correcciones: 0,
    });
  });
  it("cuenta las personas del equipo y las que tienen al menos una fila", () => {
    const filas = [tramo({ teamMemberId: "ana" })];
    const t = totalesDelMes(resumirPorPersona(filas, EQUIPO));
    assert.equal(t.personas, 2);
    assert.equal(t.personasConFichajes, 1);
  });
  it("minutos, previstos, extras y correcciones son la suma de cada persona", () => {
    const filas = [
      tramo({
        id: "1",
        teamMemberId: "ana",
        minutos: 540,
        minutosPrevistos: 480,
        origen: "corregido",
      }),
      tramo({ id: "2", teamMemberId: "bea", minutos: 420, minutosPrevistos: 480 }),
    ];
    const resumen = resumirPorPersona(filas, EQUIPO);
    const t = totalesDelMes(resumen);
    assert.equal(t.minutos, 960);
    assert.equal(t.minutosPrevistos, 960);
    assert.equal(t.extras, 0); // +60 de Ana y −60 de Bea
    assert.equal(t.correcciones, 1);
    assert.equal(
      t.minutos,
      resumen.reduce((s, r) => s + r.minutos, 0)
    );
  });
  it("una persona sin horario previsto no aporta extras al total aunque tenga minutos", () => {
    const filas = [
      tramo({ id: "1", teamMemberId: "ana", minutos: 600, minutosPrevistos: null }),
      tramo({ id: "2", teamMemberId: "bea", minutos: 500, minutosPrevistos: 480 }),
    ];
    assert.equal(totalesDelMes(resumirPorPersona(filas, EQUIPO)).extras, 20);
  });
});

describe("avisosDelMes: dónde mirar, separado en error y revisar", () => {
  const soloAna = [{ id: "ana", displayName: "Ana" }];

  it("una jornada normal no genera ningún aviso", () => {
    assert.deepEqual(avisosDelMes([tramo()], soloAna), []);
  });
  it("cada aviso lleva quién, qué día, qué fila, gravedad, tipo y texto", () => {
    const [a] = avisosDelMes([tramo({ id: "f-9", salidaAt: null })], soloAna);
    assert.deepEqual(a, {
      teamMemberId: "ana",
      nombre: "Ana",
      fecha: "2026-03-02",
      fichajeId: "f-9",
      gravedad: "error",
      tipo: "sin_salida",
      texto: "Entrada sin salida",
    });
  });
  it("entrada sin salida es ERROR: el total de ese día es una suposición", () => {
    const avisos = avisosDelMes([tramo({ salidaAt: null })], soloAna);
    assert.deepEqual(tipos(avisos), ["sin_salida"]);
    assert.equal(avisos[0].gravedad, "error");
  });
  it("salida sin entrada es ERROR", () => {
    const avisos = avisosDelMes([tramo({ entradaAt: null })], soloAna);
    assert.deepEqual(tipos(avisos), ["sin_entrada"]);
    assert.equal(avisos[0].gravedad, "error");
  });
  it("un tramo sin horas pero con total (reloj que solo da el total) no es error", () => {
    assert.deepEqual(avisosDelMes([tramo({ entradaAt: null, salidaAt: null })], soloAna), []);
  });
  it("más de 12 h es REVISAR (un turno largo puede ser real) y dice cuántas horas", () => {
    const avisos = avisosDelMes(
      [tramo({ minutos: 780, entradaAt: "08:00", salidaAt: "21:00" })],
      soloAna
    );
    assert.deepEqual(tipos(avisos), ["jornada_larga"]);
    assert.equal(avisos[0].gravedad, "revisar");
    assert.match(avisos[0].texto, /13 h/);
  });
  it("12 h justas no es jornada larga; 12 h y un minuto, sí", () => {
    assert.deepEqual(avisosDelMes([tramo({ minutos: 720 })], soloAna), []);
    assert.deepEqual(tipos(avisosDelMes([tramo({ minutos: 721 })], soloAna)), ["jornada_larga"]);
  });
  it("menos de 15 min es REVISAR; 0 min no (no hay jornada que revisar) y 15 justos tampoco", () => {
    assert.deepEqual(tipos(avisosDelMes([tramo({ minutos: 14 })], soloAna)), ["jornada_corta"]);
    assert.deepEqual(tipos(avisosDelMes([tramo({ minutos: 1 })], soloAna)), ["jornada_corta"]);
    assert.deepEqual(avisosDelMes([tramo({ minutos: 0 })], soloAna), []);
    assert.deepEqual(avisosDelMes([tramo({ minutos: 15 })], soloAna), []);
  });
  it("fichar en festivo es REVISAR, y solo si el día está en el conjunto de festivos", () => {
    const festivos = new Set(["2026-03-19"]);
    const enFestivo = avisosDelMes([tramo({ fecha: "2026-03-19" })], soloAna, { festivos });
    assert.deepEqual(tipos(enFestivo), ["festivo"]);
    assert.equal(enFestivo[0].gravedad, "revisar");
    assert.deepEqual(avisosDelMes([tramo({ fecha: "2026-03-18" })], soloAna, { festivos }), []);
  });
  it("fichar en día de ausencia es REVISAR, y la ausencia es de ESA persona: la de al lado no se entera", () => {
    const ausencias = new Map([["ana", new Set(["2026-03-02"])]]);
    const filas = [
      tramo({ id: "a", teamMemberId: "ana", fecha: "2026-03-02" }),
      tramo({ id: "b", teamMemberId: "bea", fecha: "2026-03-02" }),
    ];
    const avisos = avisosDelMes(filas, EQUIPO, { ausencias });
    assert.deepEqual(
      avisos.map((a) => [a.teamMemberId, a.tipo]),
      [["ana", "ausencia"]]
    );
  });
  it("sin festivos ni ausencias (sin tercer argumento) no hay avisos de ese tipo", () => {
    assert.deepEqual(avisosDelMes([tramo()], soloAna), []);
  });
  it("una misma fila puede llevar varios avisos: sin salida Y en festivo", () => {
    const avisos = avisosDelMes([tramo({ salidaAt: null })], soloAna, {
      festivos: new Set(["2026-03-02"]),
    });
    assert.deepEqual(tipos(avisos).sort(), ["festivo", "sin_salida"]);
  });
  it("los avisos de jornada solo miran tramos de «trabajo»: una pausa sin salida o en festivo no avisa", () => {
    const filas = [
      tramo({ id: "1", tipo: "pausa", salidaAt: null, minutos: 0 }),
      tramo({ id: "2", tipo: "ausencia", minutos: 800 }),
      tramo({ id: "3", tipo: "festivo", fecha: "2026-03-19" }),
    ];
    const avisos = avisosDelMes(filas, soloAna, { festivos: new Set(["2026-03-19"]) });
    assert.deepEqual(avisos, []);
  });
  it("un tramo dado de baja (deletedAt) no genera avisos", () => {
    const avisos = avisosDelMes(
      [tramo({ salidaAt: null, deletedAt: "2026-03-05T10:00:00.000Z" }), tramo({ id: "f-2" })],
      soloAna
    );
    assert.deepEqual(avisos, []);
  });
  it("quien no tiene NADA en el mes sale como ERROR «sin_fichajes», sin fecha ni fila", () => {
    const avisos = avisosDelMes([tramo({ teamMemberId: "ana" })], EQUIPO);
    assert.deepEqual(avisos, [
      {
        teamMemberId: "bea",
        nombre: "Beatriz",
        fecha: null,
        fichajeId: null,
        gravedad: "error",
        tipo: "sin_fichajes",
        texto: "Sin ningún fichaje este mes",
      },
    ]);
  });
  it("si todos sus tramos están dados de baja, cuenta como sin fichajes", () => {
    const avisos = avisosDelMes([tramo({ deletedAt: "2026-03-05T10:00:00.000Z" })], soloAna);
    assert.deepEqual(tipos(avisos), ["sin_fichajes"]);
  });
  it("sin fichajes y sin equipo, ningún aviso", () => {
    assert.deepEqual(avisosDelMes([], []), []);
  });
  it("un fichaje de alguien que ya no está en el equipo se avisa igual, como «(fuera del equipo)»", () => {
    const avisos = avisosDelMes([tramo({ teamMemberId: "baja", salidaAt: null })], soloAna);
    const fuera = avisos.find((a) => a.teamMemberId === "baja");
    assert.equal(fuera.nombre, "(fuera del equipo)");
    assert.equal(fuera.tipo, "sin_salida");
  });
  it("los errores van antes que los «revisar», aunque el revisar sea de un día anterior", () => {
    const filas = [
      tramo({ id: "1", fecha: "2026-03-02", minutos: 800 }),
      tramo({ id: "2", fecha: "2026-03-10", salidaAt: null }),
    ];
    assert.deepEqual(
      avisosDelMes(filas, soloAna).map((a) => a.gravedad),
      ["error", "revisar"]
    );
  });
  it("dentro de la misma gravedad, por fecha y luego por nombre", () => {
    const filas = [
      tramo({ id: "1", teamMemberId: "bea", fecha: "2026-03-10", salidaAt: null }),
      tramo({ id: "2", teamMemberId: "ana", fecha: "2026-03-10", salidaAt: null }),
      tramo({ id: "3", teamMemberId: "bea", fecha: "2026-03-03", salidaAt: null }),
    ];
    assert.deepEqual(
      avisosDelMes(filas, EQUIPO).map((a) => `${a.fecha} ${a.nombre}`),
      ["2026-03-03 Beatriz", "2026-03-10 Ana", "2026-03-10 Beatriz"]
    );
  });
  it("«sin_fichajes» va DETRÁS de los errores con fecha: primero los días que se pueden arreglar hoy", () => {
    const filas = [
      tramo({ id: "1", teamMemberId: "ana", fecha: "2026-03-02", salidaAt: null }),
      tramo({ id: "2", teamMemberId: "ana", fecha: "2026-03-10", entradaAt: null }),
    ];
    assert.deepEqual(tipos(avisosDelMes(filas, EQUIPO)), [
      "sin_salida",
      "sin_entrada",
      "sin_fichajes",
    ]);
  });
  it("y sigue yendo delante de los «revisar», que son de otra gravedad", () => {
    const filas = [tramo({ id: "1", teamMemberId: "ana", minutos: 800 })];
    assert.deepEqual(tipos(avisosDelMes(filas, EQUIPO)), ["sin_fichajes", "jornada_larga"]);
  });
  it("varios «sin_fichajes» a la vez se ordenan entre ellos por nombre", () => {
    const equipo = [
      { id: "z", displayName: "Zoe" },
      { id: "a", displayName: "Álvaro" },
      { id: "ana", displayName: "Ana" },
    ];
    const avisos = avisosDelMes([tramo({ teamMemberId: "ana", salidaAt: null })], equipo);
    assert.deepEqual(
      avisos.map((a) => `${a.tipo} ${a.nombre}`),
      ["sin_salida Ana", "sin_fichajes Álvaro", "sin_fichajes Zoe"]
    );
  });
  it("la fecha del aviso es la de la fila, como texto «AAAA-MM-DD»", () => {
    const [a] = avisosDelMes([tramo({ salidaAt: null, fecha: "2026-03-02" })], soloAna);
    assert.equal(typeof a.fecha, "string");
    assert.equal(a.fecha, "2026-03-02");
  });
});

describe("rangoDelPeriodo: primer y último día de un «AAAA-MM»", () => {
  it("marzo de 2026: del 01 al 31, 31 días", () => {
    assert.deepEqual(rangoDelPeriodo("2026-03"), {
      desde: "2026-03-01",
      hasta: "2026-03-31",
      year: 2026,
      month: 3,
      dias: 31,
    });
  });
  it("febrero tiene 28 días, y 29 en bisiesto", () => {
    assert.equal(rangoDelPeriodo("2026-02").hasta, "2026-02-28");
    assert.equal(rangoDelPeriodo("2026-02").dias, 28);
    assert.equal(rangoDelPeriodo("2024-02").hasta, "2024-02-29");
    assert.equal(rangoDelPeriodo("2024-02").dias, 29);
  });
  it("los meses de 30 días acaban el 30", () => {
    assert.equal(rangoDelPeriodo("2026-04").hasta, "2026-04-30");
    assert.equal(rangoDelPeriodo("2026-11").dias, 30);
  });
  it("`hasta` y `dias` cuentan lo mismo", () => {
    for (const mes of ["2026-01", "2026-02", "2026-06", "2026-12"]) {
      const r = rangoDelPeriodo(mes);
      assert.equal(r.hasta, `${mes}-${String(r.dias).padStart(2, "0")}`);
    }
  });
  it("mes 00 o 13: null", () => {
    assert.equal(rangoDelPeriodo("2026-00"), null);
    assert.equal(rangoDelPeriodo("2026-13"), null);
  });
  it("lo que no es «AAAA-MM» es null: «2026-3», «2026-03-01», «03/2026», vacío, null, undefined, número", () => {
    for (const v of ["2026-3", "2026-03-01", "03/2026", "", null, undefined, 202603, "marzo"]) {
      assert.equal(rangoDelPeriodo(v), null, `con ${JSON.stringify(v)}`);
    }
  });
  it("el mes sale como número y el texto conserva el cero: month 3, desde «2026-03-01»", () => {
    const r = rangoDelPeriodo("2026-03");
    assert.equal(r.month, 3);
    assert.equal(r.year, 2026);
    assert.ok(r.desde.startsWith("2026-03-"));
  });
});
