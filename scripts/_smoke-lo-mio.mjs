// @prueba ligera
/**
 * _smoke-lo-mio.mjs — «lo mío de esta semana» (09/09/2026, AV-0078 de Aumenta).
 *
 * Araceli: «no nos salen lo que deberíamos ir haciendo a la semana: registros,
 * informes, planes de intervención».
 *
 * Lo que de verdad fija esta prueba es el SEGUNDO CAMINO. Con la regla ingenua
 * —«¿hay una sesión con el bookingId de esta cita?»— la lista de Aumenta daría
 * 82 registros «sin escribir» en 7 días cuando los de verdad son 36, porque
 * solo 231 de sus 23.342 sesiones guardan de qué cita son. Una lista de tareas
 * que reclama cosas ya hechas se deja de mirar a la segunda semana.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  diaDeMadrid,
  ventanaDeLaSemana,
  citaPideRegistro,
  registroDeLaCita,
  citasSinRegistro,
} from "../lib/clinica/loMio.js";

const YO = "t-yo";
const OTRA = "t-otra";
const NIÑO = "p-1";

const cita = (extra = {}) => ({
  id: "b1",
  patientId: NIÑO,
  teamMemberId: YO,
  status: "completed",
  scheduledAt: "2026-09-08T15:00:00.000Z",
  ...extra,
});
const sesion = (extra = {}) => ({
  id: "s1",
  patientId: NIÑO,
  bookingId: null,
  tallerSesionId: null,
  therapistId: YO,
  sessionDate: "2026-09-08T15:00:00.000Z",
  status: "final",
  ...extra,
});

const AHORA = new Date("2026-09-09T09:00:00.000Z");

test("el día de Madrid, no el de UTC", () => {
  // A las 23:30 de Madrid del día 8 (21:30 UTC) el día sigue siendo el 8; a las
  // 00:30 del 9 (22:30 UTC del 8) ya es el 9. Sin esto, una sesión escrita de
  // noche parecería de otro día y la cita saldría como no escrita.
  assert.equal(diaDeMadrid("2026-09-08T21:30:00.000Z"), "2026-09-08");
  assert.equal(diaDeMadrid("2026-09-08T22:30:00.000Z"), "2026-09-09");
  assert.equal(diaDeMadrid("no es una fecha"), null);
  assert.equal(diaDeMadrid(null), null);
});

test("la ventana mira hacia atrás, que es donde está lo que falta", () => {
  const v = ventanaDeLaSemana(AHORA);
  assert.equal(v.hastaDia, "2026-09-09");
  assert.equal(v.desdeDia, "2026-09-02");
  assert.ok(v.desde < v.hasta);
  assert.equal(ventanaDeLaSemana("mañana"), null);
});

test("una cita futura no se reclama todavía", () => {
  assert.equal(citaPideRegistro(cita({ scheduledAt: "2026-09-11T15:00:00.000Z" }), AHORA), false);
  assert.equal(citaPideRegistro(cita(), AHORA), true);
});

test("una falta o una cita anulada NO piden registro", () => {
  // Reclamarlas sería trabajo inventado, y con 12.000 citas al trimestre eso
  // ahoga la lista hasta que nadie la mira.
  for (const status of ["no_show", "cancelled", "pending"]) {
    assert.equal(citaPideRegistro(cita({ status }), AHORA), false, status);
  }
});

test("una cita sin paciente tampoco: no hay registro clínico que escribir", () => {
  assert.equal(citaPideRegistro(cita({ patientId: null }), AHORA), false);
});

test("EL SEGUNDO CAMINO: la sesión suelta del mismo día cuenta como escrita", () => {
  /*
   * Es el caso de 23.111 de las 23.342 sesiones de Aumenta: se escribieron
   * antes de que existiera `bookingId`, o desde la ficha del paciente. Sin esta
   * regla la lista diría 82 en vez de 36.
   */
  const r = citasSinRegistro([cita()], [sesion()], { ahora: AHORA });
  assert.equal(r.sinEmpezar.length, 0);
  assert.equal(r.aMedias.length, 0);
});

test("por bookingId manda, aunque la fecha no coincida", () => {
  const hallado = registroDeLaCita(cita(), [sesion({ bookingId: "b1", sessionDate: "2026-09-01T10:00:00.000Z" })]);
  assert.equal(hallado.via, "cita");
});

test("la sesión de OTRA terapeuta no tapa mi registro pendiente", () => {
  // En un paciente compartido, que la logopeda haya escrito lo suyo no
  // significa que la psicóloga tenga hecho el suyo.
  const r = citasSinRegistro([cita()], [sesion({ therapistId: OTRA })], { ahora: AHORA });
  assert.equal(r.sinEmpezar.length, 1);
});

test("una sesión SIN firmar sí cuenta: son 4.297 registros viejos importados", () => {
  const r = citasSinRegistro([cita()], [sesion({ therapistId: null })], { ahora: AHORA });
  assert.equal(r.sinEmpezar.length, 0);
});

test("la sesión de un taller no tapa el registro de una cita individual", () => {
  // El cuerpo del taller lo escribe quien lo da y se copia a los asistentes:
  // eso no es «el registro que le falta a esta terapeuta».
  const r = citasSinRegistro([cita()], [sesion({ tallerSesionId: "taller-1" })], { ahora: AHORA });
  assert.equal(r.sinEmpezar.length, 1);
});

test("una sesión que ya es de OTRA cita no cuenta como el registro de esta", () => {
  // Dos citas seguidas del mismo niño el mismo día: la segunda sigue pendiente.
  const r = citasSinRegistro([cita({ id: "b2" })], [sesion({ bookingId: "b1" })], { ahora: AHORA });
  assert.equal(r.sinEmpezar.length, 1);
});

test("otro día del mismo paciente no vale", () => {
  const r = citasSinRegistro([cita()], [sesion({ sessionDate: "2026-09-05T15:00:00.000Z" })], { ahora: AHORA });
  assert.equal(r.sinEmpezar.length, 1);
});

test("un registro en borrador sale «a medias», no como «sin empezar»", () => {
  // Son dos trabajos distintos: uno es sentarse a escribir, el otro es rematar.
  for (const status of ["draft", "ai_pending"]) {
    const r = citasSinRegistro([cita()], [sesion({ status })], { ahora: AHORA });
    assert.equal(r.sinEmpezar.length, 0, status);
    assert.equal(r.aMedias.length, 1, status);
    assert.equal(r.aMedias[0].sesion.id, "s1");
  }
});

test("con varias sesiones sueltas del mismo día gana la última escrita", () => {
  const r = registroDeLaCita(cita(), [
    sesion({ id: "vieja", updatedAt: "2026-09-08T16:00:00.000Z" }),
    sesion({ id: "nueva", updatedAt: "2026-09-08T18:00:00.000Z" }),
  ]);
  assert.equal(r.sesion.id, "nueva");
});

test("lo que llega roto no rompe la bandeja de nadie", () => {
  assert.deepEqual(citasSinRegistro(null, null), { sinEmpezar: [], aMedias: [] });
  assert.deepEqual(citasSinRegistro([], []), { sinEmpezar: [], aMedias: [] });
  assert.equal(registroDeLaCita({}, []), null);
  assert.equal(registroDeLaCita(cita({ scheduledAt: "ayer" }), [sesion()]), null);
  const r = citasSinRegistro([null, 7, cita()], [null, sesion({ patientId: "otro" })], { ahora: AHORA });
  assert.equal(r.sinEmpezar.length, 1);
});

test("LA RATIO, que es el criterio que no caduca cada lunes", () => {
  /*
   * En producción la regla ingenua da del orden del DOBLE que la buena (82 vs
   * 36 en 7 días). Aquí se reproduce en pequeño: de cuatro citas del mismo día,
   * solo una tiene `bookingId`; las otras tres tienen su sesión suelta escrita.
   * La regla ingenua diría 3 pendientes; la buena dice 0.
   */
  const citas = [1, 2, 3, 4].map((n) => cita({ id: `b${n}`, patientId: `p${n}` }));
  const sesiones = [
    sesion({ id: "s1", patientId: "p1", bookingId: "b1" }),
    sesion({ id: "s2", patientId: "p2" }),
    sesion({ id: "s3", patientId: "p3" }),
    sesion({ id: "s4", patientId: "p4" }),
  ];
  const ingenua = citas.filter((c) => !sesiones.some((s) => s.bookingId === c.id)).length;
  const buena = citasSinRegistro(citas, sesiones, { ahora: AHORA }).sinEmpezar.length;
  assert.equal(ingenua, 3);
  assert.equal(buena, 0);
});

test("una sesión atada a OTRA cita no cuenta como el registro de esta (AV-0094)", () => {
  /*
   * El caso de Blanca: escribió el registro con la fecha mal, lo corrigió al
   * día bueno, y la bandeja se lo seguía pidiendo. La sesión seguía atada a la
   * cita del día equivocado, y por eso el camino del día no la miraba.
   *
   * La regla se queda como está —una sesión que ya es de otra cita no es el
   * registro de esta—, porque lo contrario haría que un registro sirviera para
   * dos citas. Lo que cambia es que mover la fecha SUELTA la atadura, y esta
   * prueba fija las dos mitades de esa decisión.
   */
  const cita = { id: "cita-3", patientId: "p1", teamMemberId: "t1", scheduledAt: "2026-09-03T10:00:00+02:00", status: "confirmed" };
  const atadaAOtra = { id: "s1", patientId: "p1", therapistId: "t1", sessionDate: "2026-09-03", bookingId: "cita-10", status: "registered" };
  assert.equal(registroDeLaCita(cita, [atadaAOtra]), null, "una sesión de otra cita no puede tapar esta");

  // Y en cuanto se suelta (que es lo que hace ahora el PATCH), se encuentra.
  const suelta = { ...atadaAOtra, bookingId: null };
  const hallado = registroDeLaCita(cita, [suelta]);
  assert.ok(hallado, "soltarla tiene que hacer que la bandeja la encuentre");
  assert.equal(hallado.via, "dia");
  assert.equal(hallado.sesion.id, "s1");
});
