// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-adoptar-en-diagnostico.mjs — «Empezar desde lo que ya hay»: qué
 * citas, qué entrevista y qué cobro de un paciente entran en un expediente de
 * diagnóstico que se abre después de haber empezado (12/09/2026, ampliación
 * tras las respuestas de Aumenta).
 *
 *   node --test scripts/_smoke-adoptar-en-diagnostico.mjs
 *
 * Fija `lib/clinica/adoptarEnDiagnostico.js`:
 *   · los tipos se reconocen por COLUMNAS (`informeTipo`, `isInitialAssessment`),
 *     nunca por nombre ni por id;
 *   · el tramo: la entrevista por su tipo o por la nota de la cita; las horas
 *     por el tipo de diagnóstico;
 *   · las adoptables: fuera las que ya son de un expediente y las canceladas;
 *     la entrevista es la señalada (si es adoptable) o la última; el resumen
 *     cuenta hechas y futuras con la regla de los bonos (una pasada en
 *     `confirmed` es RESERVADA, como la pinta la barra);
 *   · el descuento: el importe del cobro cobrado o pendiente y no devuelto;
 *   · la frase de la casilla y el terapeuta más repetido.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  esTipoDeHorasDeDiagnostico,
  esTipoDeEntrevista,
  tramoDeAdopcion,
  citasAdoptables,
  descuentoDeLaEntrevista,
  resumenDeAdopcion,
  terapeutaSugerido,
} from "../lib/clinica/adoptarEnDiagnostico.js";

const AHORA = new Date("2026-09-12T10:00:00Z");
const enHoras = (h) => new Date(AHORA.getTime() + h * 3_600_000).toISOString();

const DIAG = { id: "t-diag", name: "DIAGNÓSTICO", informeTipo: "diagnostico" };
const INFORME = { id: "t-inf", name: "INFORME PARA DIAGNOSTICO", informe_tipo: "diagnostico" };
const ENTREVISTA = { id: "t-ent", name: "ENTREVISTA INICIAL", isInitialAssessment: true };
const LOGO = { id: "t-logo", name: "LOGOPEDIA 45", informeTipo: null, isInitialAssessment: false };
const TIPOS = new Map([DIAG, INFORME, ENTREVISTA, LOGO].map((t) => [t.id, t]));

const cita = (extra = {}) => ({ id: "c", eventTypeId: "t-diag", status: "completed", scheduledAt: enHoras(-48), duration: 60, teamMemberId: "tm-1", ...extra });

describe("los tipos, por columnas", () => {
  it("horas de diagnóstico = informe_tipo diagnostico, se llame como se llame", () => {
    assert.equal(esTipoDeHorasDeDiagnostico(DIAG), true);
    assert.equal(esTipoDeHorasDeDiagnostico(INFORME), true, "snake_case también");
    assert.equal(esTipoDeHorasDeDiagnostico({ name: "DIAGNÓSTICO", informeTipo: "evolution" }), false);
    assert.equal(esTipoDeHorasDeDiagnostico(ENTREVISTA), false);
    assert.equal(esTipoDeHorasDeDiagnostico(null), false);
  });

  it("entrevista = is_initial_assessment", () => {
    assert.equal(esTipoDeEntrevista(ENTREVISTA), true);
    assert.equal(esTipoDeEntrevista({ is_initial_assessment: true }), true);
    assert.equal(esTipoDeEntrevista({ isInitialAssessment: "true" }), false, "solo true de verdad");
    assert.equal(esTipoDeEntrevista(DIAG), false);
    assert.equal(esTipoDeEntrevista(undefined), false);
  });

  it("tramoDeAdopcion: entrevista por tipo o por la nota; horas por el tipo; null si no es de nadie", () => {
    assert.equal(tramoDeAdopcion(cita(), ENTREVISTA), "entrevista");
    assert.equal(tramoDeAdopcion(cita({ notes: "Entrevista inicial de diagnóstico" }), DIAG), "entrevista");
    assert.equal(tramoDeAdopcion(cita({ notes: "ENTREVISTA INICIAL" }), INFORME), "entrevista");
    assert.equal(tramoDeAdopcion(cita(), DIAG), "horas");
    assert.equal(tramoDeAdopcion(cita({ notes: "WISC-V" }), INFORME), "horas");
    assert.equal(tramoDeAdopcion(cita({ notes: "entrevista inicial" }), LOGO), null, "la nota no basta sin el tipo");
    assert.equal(tramoDeAdopcion(cita(), null), null);
  });
});

describe("citasAdoptables", () => {
  const citas = [
    cita({ id: "c1", eventTypeId: "t-ent", scheduledAt: enHoras(-240), duration: 60 }), // la entrevista de terapia
    cita({ id: "c2", scheduledAt: enHoras(-168), duration: 60 }), // hecha
    cita({ id: "c3", eventTypeId: "t-inf", scheduledAt: enHoras(-96), duration: 45 }), // INFORME PARA DIAGNOSTICO: hecha
    cita({ id: "c4", scheduledAt: enHoras(-72), status: "cancelled", cancelledAt: enHoras(-100) }), // cancelada
    cita({ id: "c5", scheduledAt: enHoras(-24), status: "confirmed", duration: 60 }), // pasada sin cerrar: RESERVADA
    cita({ id: "c6", scheduledAt: enHoras(48), status: "confirmed", duration: 90 }), // futura
    cita({ id: "c7", eventTypeId: "t-logo", scheduledAt: enHoras(-48) }), // logopedia: no es del diagnóstico
    cita({ id: "c8", scheduledAt: enHoras(-30), diagnosticoId: "otro" }), // ya es de un expediente
  ];

  it("la entrevista es la última de tramo entrevista; las horas son las de tipo diagnóstico; fuera canceladas, ajenas y las de otro expediente", () => {
    const a = citasAdoptables({ citas, tiposPorId: TIPOS, ahora: AHORA });
    assert.equal(a.entrevista?.id, "c1");
    assert.deepEqual(a.horas.map((c) => c.id), ["c2", "c3", "c5", "c6"]);
    assert.deepEqual(a.resumen, { citas: 4, hechas: 2, horasHechas: 1.75, futuras: 2, horasReservadas: 2.5 });
  });

  it("una pasada en confirmed cuenta como reservada (nadie la marcó hecha): la regla de los bonos, sin cambiar", () => {
    const a = citasAdoptables({ citas: [cita({ id: "x", status: "confirmed", scheduledAt: enHoras(-24) })], tiposPorId: TIPOS, ahora: AHORA });
    assert.equal(a.resumen.hechas, 0);
    assert.equal(a.resumen.futuras, 1);
  });

  it("la entrevista señalada manda si es adoptable; una de tipo diagnóstico también puede serlo, y deja de contar como hora", () => {
    const a = citasAdoptables({ citas, tiposPorId: TIPOS, entrevistaBookingId: "c2", ahora: AHORA });
    assert.equal(a.entrevista?.id, "c2");
    assert.deepEqual(a.horas.map((c) => c.id), ["c3", "c5", "c6"]);
    assert.equal(a.resumen.citas, 3);
    // Una señalada que no es adoptable (cancelada, de otro expediente, de logopedia) se ignora y se cae a la última.
    for (const mala of ["c4", "c8", "c7", "no-existe"]) {
      assert.equal(citasAdoptables({ citas, tiposPorId: TIPOS, entrevistaBookingId: mala, ahora: AHORA }).entrevista?.id, "c1", mala);
    }
  });

  it("una cita de tipo diagnóstico con nota «entrevista inicial» es la entrevista; si hay dos, la última, y la otra va a horas", () => {
    const dos = [
      cita({ id: "e1", notes: "Entrevista inicial", scheduledAt: enHoras(-200) }),
      cita({ id: "e2", notes: "Entrevista inicial (repetida)", scheduledAt: enHoras(-100) }),
    ];
    const a = citasAdoptables({ citas: dos, tiposPorId: TIPOS, ahora: AHORA });
    assert.equal(a.entrevista?.id, "e2");
    assert.deepEqual(a.horas.map((c) => c.id), ["e1"]);
    // Una segunda ENTREVISTA INICIAL de terapia no entra en horas: no es hora de diagnóstico.
    const terapia = [cita({ id: "t1", eventTypeId: "t-ent", scheduledAt: enHoras(-200) }), cita({ id: "t2", eventTypeId: "t-ent", scheduledAt: enHoras(-100) })];
    const b = citasAdoptables({ citas: terapia, tiposPorId: TIPOS, ahora: AHORA });
    assert.equal(b.entrevista?.id, "t2");
    assert.deepEqual(b.horas, []);
  });

  it("sin nada adoptable: entrevista null, horas vacías, resumen a cero; los tipos valen como objeto plano", () => {
    assert.deepEqual(citasAdoptables({ citas: [], tiposPorId: TIPOS }), { entrevista: null, horas: [], resumen: { citas: 0, hechas: 0, horasHechas: 0, futuras: 0, horasReservadas: 0 } });
    assert.equal(citasAdoptables({ citas, tiposPorId: null, ahora: AHORA }).horas.length, 0, "sin tipos no se sabe de qué es nada");
    assert.equal(citasAdoptables({ citas, tiposPorId: { "t-diag": DIAG }, ahora: AHORA }).horas.length, 3);
    assert.equal(citasAdoptables().horas.length, 0);
  });
});

describe("descuentoDeLaEntrevista", () => {
  it("cobrado o pendiente y no devuelto descuenta su importe; lo demás, 0", () => {
    assert.equal(descuentoDeLaEntrevista({ amount: "50.00", status: "completed" }), 50);
    assert.equal(descuentoDeLaEntrevista({ amount: 47.5, status: "pending" }), 47.5);
    assert.equal(descuentoDeLaEntrevista({ amount: 50, status: "completed", refundedAt: "2026-09-10" }), 0);
    assert.equal(descuentoDeLaEntrevista({ amount: 50, status: "refunded" }), 0);
    assert.equal(descuentoDeLaEntrevista({ amount: 50, status: "failed" }), 0);
    assert.equal(descuentoDeLaEntrevista({ amount: 0, status: "completed" }), 0);
    assert.equal(descuentoDeLaEntrevista({ amount: "abc", status: "completed" }), 0);
    assert.equal(descuentoDeLaEntrevista(null), 0);
    assert.equal(descuentoDeLaEntrevista({ toJSON: () => ({ amount: 50, status: "completed" }) }), 50);
  });
});

describe("resumenDeAdopcion: la frase de la casilla", () => {
  const resumen = { citas: 5, hechas: 3, horasHechas: 2.5, futuras: 2, horasReservadas: 1.5 };
  const entrevista = { id: "c1", scheduledAt: "2026-09-03T12:00:00Z" };

  it("citas dadas, futuras y la entrevista con su cobro", () => {
    assert.equal(
      resumenDeAdopcion({ resumen, entrevista, cobroEntrevista: { id: "p", importe: 50, status: "completed" } }),
      "3 citas ya dadas (2,5 h), 2 futuras (1,5 h) y la entrevista del 03/09/2026 (cobrada, 50 €)"
    );
    assert.equal(
      resumenDeAdopcion({ resumen, entrevista, cobroEntrevista: { id: "p", amount: "47.50", status: "pending" } }),
      "3 citas ya dadas (2,5 h), 2 futuras (1,5 h) y la entrevista del 03/09/2026 (pendiente de cobro, 47,50 €)"
    );
    assert.equal(resumenDeAdopcion({ resumen, entrevista, cobroEntrevista: null }).split(" y ").at(-1), "la entrevista del 03/09/2026 (sin cobro)");
  });

  it("singulares, solo futuras, solo entrevista, y «nada que meter»", () => {
    assert.equal(resumenDeAdopcion({ resumen: { hechas: 1, horasHechas: 1, futuras: 1, horasReservadas: 0.75 } }), "1 cita ya dada (1 h) y 1 futura (0,75 h)");
    assert.equal(resumenDeAdopcion({ resumen: { hechas: 0, futuras: 2, horasReservadas: 2 } }), "2 citas futuras (2 h)");
    assert.equal(resumenDeAdopcion({ resumen: { hechas: 0, futuras: 1, horasReservadas: 1 } }), "1 cita futura (1 h)");
    assert.equal(resumenDeAdopcion({ entrevista, cobroEntrevista: { importe: 50, status: "completed" } }), "la entrevista del 03/09/2026 (cobrada, 50 €)");
    assert.equal(resumenDeAdopcion({ resumen: { citas: 0 } }), "nada que meter");
    assert.equal(resumenDeAdopcion(), "nada que meter");
  });
});

describe("terapeutaSugerido", () => {
  it("el más repetido; un empate lo gana el de la cita más reciente; sin citas, null", () => {
    assert.equal(terapeutaSugerido([cita({ teamMemberId: "a" }), cita({ teamMemberId: "b" }), cita({ teamMemberId: "b" })]), "b");
    assert.equal(
      terapeutaSugerido([cita({ teamMemberId: "a", scheduledAt: enHoras(-10) }), cita({ teamMemberId: "b", scheduledAt: enHoras(-100) })]),
      "a"
    );
    assert.equal(terapeutaSugerido([cita({ teamMemberId: null }), cita({ teamMemberId: undefined })]), null);
    assert.equal(terapeutaSugerido([]), null);
    assert.equal(terapeutaSugerido(null), null);
  });
});
