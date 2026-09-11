// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-diagnostico.mjs — el expediente de diagnóstico: productos, estados y
 * la barra de horas que se cuenta desde las citas (12/09/2026).
 *
 *   node --test scripts/_smoke-diagnostico.mjs
 *
 * Fija `lib/clinica/diagnostico.js`:
 *   · los productos de fábrica (simple 10 h, completo 20 h) y los guardados en
 *     `settings.clinica.diagnosticos`, con caída a fábrica cuando no hay nada
 *     que valga;
 *   · qué cuenta como hora, que es la regla de los bonos: una entrevista futura
 *     RESERVA, una cancelada a tiempo no cuenta, una falta injustificada sí,
 *     dos sesiones de 60 min suman 2 h, y la entrevista vale 1 sea cual sea su
 *     duración;
 *   · el tope: agotado con las horas del producto, `cabeHora` lo dice con la
 *     frase del 422, y desbloquear horas lo reabre;
 *   · los estados y sus transiciones;
 *   · el bono sin tope (`totalSessions` a null) y el tipo de cita DIAGNÓSTICO.
 *
 * Forma: `node:test` + `node:assert/strict`, como `_smoke-citas-dinero.mjs`.
 * Aserciones sobre lo que devuelven las funciones, no sobre cómo están escritas.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTOS_DE_FABRICA,
  productosDe,
  productoDe,
  conceptoDeProducto,
  ESTADOS,
  ESTADOS_ABIERTOS,
  ROTULO_ESTADO,
  puedePasarA,
  estaAbierto,
  ENTREVISTA,
  cobroDeLaEntrevista,
  cobroDelProducto,
  esTipoDiagnostico,
  tipoDiagnosticoDe,
  horasDe,
  cabeHora,
  mensajeTope,
  puedeDesbloquear,
  rotuloDeBarra,
  tramosDeBarra,
  formatoHoras,
  esBonoSinTope,
  duracionLimpia,
  TRAMO_ENTREVISTA,
  TRAMO_HORAS,
} from "../lib/clinica/diagnostico.js";

const AHORA = new Date("2026-09-12T10:00:00Z");
const enHoras = (h) => new Date(AHORA.getTime() + h * 3_600_000).toISOString();

/** Una cita del expediente, con lo justo para contarla. */
const cita = (extra = {}) => ({
  status: "completed",
  scheduledAt: enHoras(-48),
  duration: 60,
  diagnosticoTramo: TRAMO_HORAS,
  ...extra,
});
const entrevista = (extra = {}) => cita({ diagnosticoTramo: TRAMO_ENTREVISTA, ...extra });

const SIMPLE = { horasMax: 10 };

// ── Productos ───────────────────────────────────────────────────────────────

describe("productos de diagnóstico", () => {
  it("de fábrica: simple 10 h y completo 20 h, sin concepto fijado y con su precio de caída", () => {
    assert.deepEqual(
      PRODUCTOS_DE_FABRICA.map((p) => [p.key, p.horas, p.conceptId, p.precioEuros]),
      [
        ["simple", 10, null, 350],
        ["completo", 20, null, 650],
      ]
    );
  });

  it("sin nada guardado —o con cualquier cosa que no sea una lista— salen los de fábrica", () => {
    assert.equal(productosDe(undefined), PRODUCTOS_DE_FABRICA);
    assert.equal(productosDe({}), PRODUCTOS_DE_FABRICA);
    assert.equal(productosDe({ settings: { clinica: {} } }), PRODUCTOS_DE_FABRICA);
    assert.equal(productosDe({ settings: { clinica: { diagnosticos: "simple" } } }), PRODUCTOS_DE_FABRICA);
  });

  it("los guardados en settings.clinica.diagnosticos mandan, con su concepto y sus horas", () => {
    const tenant = {
      settings: {
        clinica: {
          diagnosticos: [
            { key: "simple", nombre: "Diagnóstico Simple", horas: 12, conceptId: "5eef78c6-e17d-4cd0-b3c7-8066edec4638" },
            { key: "tdah", nombre: "Valoración TDAH", horas: 6.5, conceptId: null, precioEuros: 280 },
          ],
        },
      },
    };
    const lista = productosDe(tenant);
    assert.equal(lista.length, 2);
    assert.deepEqual(lista[0], {
      key: "simple",
      nombre: "Diagnóstico Simple",
      horas: 12,
      conceptId: "5eef78c6-e17d-4cd0-b3c7-8066edec4638",
      precioEuros: 350, // el precio de fábrica se hereda cuando el centro no pone otro
    });
    assert.deepEqual(lista[1], { key: "tdah", nombre: "Valoración TDAH", horas: 6.5, conceptId: null, precioEuros: 280 });
    assert.equal(productoDe(tenant, "TDAH").horas, 6.5);
    assert.equal(productoDe(tenant, "completo"), null, "el completo de fábrica ya no está: el centro no lo guardó");
  });

  it("una entrada mal escrita se descarta sola; una clave repetida se queda con la primera; sin ninguna válida, fábrica", () => {
    const tenant = {
      settings: {
        clinica: {
          diagnosticos: [
            { key: "", horas: 10 },
            { key: "simple", horas: 0 },
            { key: "simple", horas: 8 },
            { key: "simple", horas: 9 },
            { key: "raro", horas: 1000 },
            { key: "sin-concepto-valido", horas: 4, conceptId: "esto-no-es-un-uuid" },
          ],
        },
      },
    };
    const lista = productosDe(tenant);
    assert.deepEqual(
      lista.map((p) => [p.key, p.horas, p.conceptId]),
      [
        ["simple", 8, null],
        ["sin-concepto-valido", 4, null],
      ]
    );
    assert.equal(productosDe({ settings: { clinica: { diagnosticos: [{ key: "", horas: 10 }] } } }), PRODUCTOS_DE_FABRICA);
    assert.equal(productosDe({ settings: { clinica: { diagnosticos: [] } } }), PRODUCTOS_DE_FABRICA);
  });

  it("el concepto: por id si está fijado; si no, por nombre entre los ACTIVOS (/diagn.*simple/, /diagn.*completo/)", () => {
    const conceptos = [
      { id: "a", name: "Diagnóstico Simple", unitPrice: "350.00", active: false },
      { id: "b", name: "Diagnóstico Simple", unitPrice: "350.00", active: true },
      { id: "c", name: "Diagnóstico Completo", unitPrice: "650.00", active: true },
      { id: "d", name: "Entrevista Inicial", unitPrice: "50.00", active: true },
    ];
    const [simple, completo] = PRODUCTOS_DE_FABRICA;
    assert.equal(conceptoDeProducto(simple, conceptos)?.id, "b", "el inactivo con el mismo nombre no cuenta");
    assert.equal(conceptoDeProducto(completo, conceptos)?.id, "c");
    assert.equal(conceptoDeProducto({ ...simple, conceptId: "d" }, conceptos)?.id, "d", "fijado manda");
    assert.equal(conceptoDeProducto({ key: "tdah", nombre: "valoracion tdah", conceptId: null }, [
      { id: "e", name: "Valoración TDAH", active: true },
    ])?.id, "e", "un producto propio se casa por nombre sin acentos ni mayúsculas");
    assert.equal(conceptoDeProducto(simple, []), null);
    assert.equal(conceptoDeProducto(null, conceptos), null);
  });

  it("el cobro del producto sale del concepto con precio; sin él, del precio de caída del producto", () => {
    const [simple, completo] = PRODUCTOS_DE_FABRICA;
    assert.deepEqual(cobroDelProducto(simple, { id: "b", name: "Diagnóstico Simple", unitPrice: "350.00" }), {
      conceptId: "b",
      texto: "Diagnóstico Simple",
      importeEuros: 350,
    });
    assert.deepEqual(cobroDelProducto(completo, null), { conceptId: null, texto: "Diagnóstico completo", importeEuros: 650 });
    assert.deepEqual(cobroDelProducto({ key: "x", nombre: "Sin precio", conceptId: null, precioEuros: null }, null), {
      conceptId: null,
      texto: "Sin precio",
      importeEuros: null,
    });
  });

  it("el cobro de la entrevista al parar: el concepto «Entrevista Inicial» si lo hay; si no, 50 € con su texto", () => {
    assert.deepEqual(cobroDeLaEntrevista({ id: "d", name: "Entrevista Inicial", unitPrice: "50.00" }), {
      conceptId: "d",
      texto: "Entrevista Inicial",
      importeEuros: 50,
    });
    assert.deepEqual(cobroDeLaEntrevista(null), {
      conceptId: null,
      texto: "Entrevista inicial de diagnóstico",
      importeEuros: 50,
    });
    assert.equal(cobroDeLaEntrevista({ id: "z", name: "Gratis", unitPrice: "0" }).importeEuros, 50, "sin precio, la caída");
    assert.equal(ENTREVISTA.duracionMin, 60);
    assert.equal(ENTREVISTA.cobroTexto, "Diagnóstico: el cobro nace al decidir si sigue");
  });
});

// ── Estados ─────────────────────────────────────────────────────────────────

describe("estados del expediente", () => {
  it("son cuatro, dos abiertos, y cada uno tiene rótulo", () => {
    assert.deepEqual(ESTADOS, ["entrevista", "no_continua", "en_curso", "cerrado"]);
    assert.deepEqual(ESTADOS_ABIERTOS, ["entrevista", "en_curso"]);
    for (const e of ESTADOS) assert.equal(typeof ROTULO_ESTADO[e], "string", e);
    assert.equal(estaAbierto({ status: "en_curso" }), true);
    assert.equal(estaAbierto({ status: "no_continua" }), false);
    assert.equal(estaAbierto(null), false);
  });

  it("desde la entrevista se para, se sigue o se cierra; lo demás solo se cierra; cerrado no va a ningún sitio", () => {
    assert.equal(puedePasarA("entrevista", "no_continua"), true);
    assert.equal(puedePasarA("entrevista", "en_curso"), true);
    assert.equal(puedePasarA("entrevista", "cerrado"), true);
    assert.equal(puedePasarA("en_curso", "cerrado"), true);
    assert.equal(puedePasarA("no_continua", "cerrado"), true);
    assert.equal(puedePasarA("no_continua", "en_curso"), false, "parado no vuelve a seguir en esta entrega");
    assert.equal(puedePasarA("en_curso", "entrevista"), false);
    assert.equal(puedePasarA("cerrado", "en_curso"), false);
    assert.equal(puedePasarA("marciano", "cerrado"), false);
    assert.equal(puedePasarA("entrevista", "entrevista"), false);
  });
});

// ── El tipo de cita ─────────────────────────────────────────────────────────

describe("el tipo de cita DIAGNÓSTICO", () => {
  it("es el que tiene informe_tipo = diagnostico Y se llama DIAGN…; no el de ENTREVISTA INICIAL ni un informe suelto", () => {
    assert.equal(esTipoDiagnostico({ name: "DIAGNÓSTICO", informeTipo: "diagnostico" }), true);
    assert.equal(esTipoDiagnostico({ name: "diagnostico completo", informe_tipo: "diagnostico" }), true);
    assert.equal(esTipoDiagnostico({ name: "ENTREVISTA INICIAL", informeTipo: null, isInitialAssessment: true }), false);
    assert.equal(esTipoDiagnostico({ name: "Informe", informeTipo: "diagnostico" }), false);
    assert.equal(esTipoDiagnostico({ name: "DIAGNÓSTICO", informeTipo: "evolution" }), false);
    assert.equal(esTipoDiagnostico(null), false);
    const tipos = [{ name: "LOGOPEDIA 45" }, { name: "DIAGNÓSTICO", informeTipo: "diagnostico", id: "0283b877" }];
    assert.equal(tipoDiagnosticoDe(tipos)?.id, "0283b877");
    assert.equal(tipoDiagnosticoDe([]), null);
  });
});

// ── Horas ───────────────────────────────────────────────────────────────────

describe("horasDe: la barra se cuenta desde las citas con la regla de los bonos", () => {
  it("sin citas: todo libre, nada agotado", () => {
    assert.deepEqual(horasDe({ expediente: SIMPLE, citas: [] }), {
      max: 10,
      entrevista: 0,
      hechas: 0,
      reservadas: 0,
      libres: 10,
      ocupadas: 0,
      agotado: false,
      citas: 0,
    });
  });

  it("una entrevista FUTURA reserva 1 h: no llena el tramo de entrevista, pero ya no está libre", () => {
    const h = horasDe({ expediente: SIMPLE, citas: [entrevista({ status: "confirmed", scheduledAt: enHoras(48) })], ahora: AHORA });
    assert.equal(h.entrevista, 0);
    assert.equal(h.reservadas, 1);
    assert.equal(h.libres, 9);
    assert.equal(h.citas, 1);
  });

  it("la entrevista dada vale 1 aunque durase 90 min: es UNA entrevista, no un tramo de horas", () => {
    const h = horasDe({ expediente: SIMPLE, citas: [entrevista({ duration: 90 })], ahora: AHORA });
    assert.equal(h.entrevista, 1);
    assert.equal(h.hechas, 0);
    assert.equal(h.libres, 9);
  });

  it("cancelada a tiempo (24 h o más) NO cuenta; cancelada tarde SÍ", () => {
    const aTiempo = cita({ status: "cancelled", scheduledAt: enHoras(-24), cancelledAt: enHoras(-72) });
    const tarde = cita({ status: "cancelled", scheduledAt: enHoras(-24), cancelledAt: enHoras(-30) });
    assert.equal(horasDe({ expediente: SIMPLE, citas: [aTiempo], ahora: AHORA }).hechas, 0);
    assert.equal(horasDe({ expediente: SIMPLE, citas: [aTiempo], ahora: AHORA }).citas, 0);
    assert.equal(horasDe({ expediente: SIMPLE, citas: [tarde], ahora: AHORA }).hechas, 1);
  });

  it("falta injustificada cuenta (también sin clasificar); justificada no", () => {
    const injustificada = cita({ status: "no_show", noShowJustified: false });
    const sinClasificar = cita({ status: "no_show", noShowJustified: null });
    const justificada = cita({ status: "no_show", noShowJustified: true });
    assert.equal(horasDe({ expediente: SIMPLE, citas: [injustificada], ahora: AHORA }).hechas, 1);
    assert.equal(horasDe({ expediente: SIMPLE, citas: [sinClasificar], ahora: AHORA }).hechas, 1);
    assert.equal(horasDe({ expediente: SIMPLE, citas: [justificada], ahora: AHORA }).hechas, 0);
  });

  it("dos sesiones de 60 min suman 2 h; una de 90 suma 1,5; la duración manda, no el número de citas", () => {
    const h = horasDe({ expediente: SIMPLE, citas: [entrevista(), cita(), cita(), cita({ duration: 90 })], ahora: AHORA });
    assert.equal(h.entrevista, 1);
    assert.equal(h.hechas, 3.5);
    assert.equal(h.ocupadas, 4.5);
    assert.equal(h.libres, 5.5);
    assert.equal(h.citas, 4);
    assert.equal(rotuloDeBarra(h), "4,5 de 10 h");
  });

  it("una segunda entrevista (la primera se canceló tarde y se repitió) cuesta 1 h de las hechas", () => {
    const primera = entrevista({ status: "cancelled", scheduledAt: enHoras(-96), cancelledAt: enHoras(-100) });
    const segunda = entrevista();
    const h = horasDe({ expediente: SIMPLE, citas: [primera, segunda], ahora: AHORA });
    assert.equal(h.entrevista, 1);
    assert.equal(h.hechas, 1);
  });

  it("el tope: con la entrevista y 9 h de sesiones el simple está agotado y no cabe ni media hora más", () => {
    const citas = [entrevista(), ...Array.from({ length: 9 }, () => cita())];
    const h = horasDe({ expediente: SIMPLE, citas, ahora: AHORA });
    assert.equal(h.ocupadas, 10);
    assert.equal(h.libres, 0);
    assert.equal(h.agotado, true);
    const c = cabeHora(h, 30);
    assert.equal(c.cabe, false);
    assert.equal(c.despues, 10.5);
    assert.equal(c.mensaje, "El diagnóstico ya tiene sus 10 h: desbloquéalas desde Diagnósticos");
    assert.equal(c.mensaje, mensajeTope(10));
  });

  it("las RESERVADAS también ocupan: con 9 h dadas y 1 reservada, la siguiente ya no cabe", () => {
    const citas = [entrevista(), ...Array.from({ length: 8 }, () => cita()), cita({ status: "confirmed", scheduledAt: enHoras(48) })];
    const h = horasDe({ expediente: SIMPLE, citas, ahora: AHORA });
    assert.equal(h.reservadas, 1);
    assert.equal(h.agotado, true);
    assert.equal(cabeHora(h, 60).cabe, false);
    assert.equal(rotuloDeBarra(h), "9 de 10 h · 1 reservada");
  });

  it("cabe cuando entra justa: 8 h ocupadas de 10 y una cita de 120 min", () => {
    const citas = [entrevista(), ...Array.from({ length: 7 }, () => cita())];
    const h = horasDe({ expediente: SIMPLE, citas, ahora: AHORA });
    assert.deepEqual(cabeHora(h, 120), { cabe: true, despues: 10, max: 10, mensaje: null });
    assert.equal(cabeHora(h, 150).cabe, false);
  });

  it("desbloquear: subir el tope de 10 a 12 reabre el expediente agotado con las mismas citas", () => {
    const citas = [entrevista(), ...Array.from({ length: 9 }, () => cita())];
    assert.equal(horasDe({ expediente: { horasMax: 10 }, citas, ahora: AHORA }).agotado, true);
    const h = horasDe({ expediente: { horasMax: "12.0" }, citas, ahora: AHORA }); // la columna es DECIMAL: llega como texto
    assert.equal(h.max, 12);
    assert.equal(h.agotado, false);
    assert.equal(h.libres, 2);
    assert.equal(cabeHora(h, 60).cabe, true);
    assert.equal(rotuloDeBarra(h), "10 de 12 h");
  });

  it("puedeDesbloquear: solo hacia arriba, de media en media y hasta 200", () => {
    assert.deepEqual(puedeDesbloquear(20, 25), { ok: true, motivo: null });
    assert.deepEqual(puedeDesbloquear(20, 20.5), { ok: true, motivo: null });
    assert.equal(puedeDesbloquear(20, 20).ok, false);
    assert.equal(puedeDesbloquear(20, 15).ok, false);
    assert.equal(puedeDesbloquear(20, 20.25).ok, false);
    assert.equal(puedeDesbloquear(20, 201).ok, false);
    assert.equal(puedeDesbloquear(20, "veinte").ok, false);
    assert.match(puedeDesbloquear(20, 15).motivo, /20 h/);
  });

  it("un expediente sin tope legible cuenta como 0 h: todo agotado, nada cabe (mejor cerrar la puerta que regalar horas)", () => {
    const h = horasDe({ expediente: { horasMax: null }, citas: [], ahora: AHORA });
    assert.equal(h.max, 0);
    assert.equal(h.agotado, true);
    assert.equal(cabeHora(h, 30).cabe, false);
  });

  it("los cuatro tramos de la barra suman el 100 % y van en su orden", () => {
    const citas = [entrevista(), cita(), cita(), cita({ status: "confirmed", scheduledAt: enHoras(48) })];
    const tramos = tramosDeBarra(horasDe({ expediente: SIMPLE, citas, ahora: AHORA }));
    assert.deepEqual(
      tramos.map((t) => [t.clave, t.horas, t.pct]),
      [
        ["entrevista", 1, 10],
        ["hechas", 2, 20],
        ["reservadas", 1, 10],
        ["libres", 6, 60],
      ]
    );
    assert.deepEqual(tramosDeBarra({ max: 0 }).map((t) => t.pct), [0, 0, 0, 0]);
  });

  it("formatoHoras: entero sin decimales, medias con coma", () => {
    assert.equal(formatoHoras(3), "3");
    assert.equal(formatoHoras(2.5), "2,5");
    assert.equal(formatoHoras("10.0"), "10");
    assert.equal(formatoHoras(undefined), "0");
  });

  it("duracionLimpia: múltiplos de 30 entre 30 y 480; lo demás, null", () => {
    assert.equal(duracionLimpia(60), 60);
    assert.equal(duracionLimpia("90"), 90);
    assert.equal(duracionLimpia(480), 480);
    assert.equal(duracionLimpia(45), null);
    assert.equal(duracionLimpia(0), null);
    assert.equal(duracionLimpia(510), null);
    assert.equal(duracionLimpia(null), null);
  });
});

// ── El bono sin tope ────────────────────────────────────────────────────────

describe("esBonoSinTope", () => {
  it("es el bono con totalSessions a NULL explícito; un objeto sin la clave no lo es", () => {
    assert.equal(esBonoSinTope({ totalSessions: null }), true);
    assert.equal(esBonoSinTope({ totalSessions: 10 }), false);
    assert.equal(esBonoSinTope({ total: null }), true, "la fila serializada por estadoPack lleva `total`");
    assert.equal(esBonoSinTope({ total: 10 }), false);
    assert.equal(esBonoSinTope({}), false);
    assert.equal(esBonoSinTope(null), false);
    assert.equal(esBonoSinTope({ totalSessions: 5, total: null }), false, "totalSessions manda sobre total");
  });
});
