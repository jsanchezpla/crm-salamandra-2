// @prueba ligera
/**
 * _smoke-cobro-motivos.mjs — de dónde sale el importe de un cobro de cuota
 * (08/09/2026, AV-0085 y AV-0086 de Aumenta).
 *
 * Rosa escribió TRES veces el mismo día porque un número no se explicaba solo.
 * Las notas de aquí abajo son LITERALES de producción, copiadas de los cobros
 * de septiembre de 2026 (con los importes y los identificadores tal como están
 * guardados, punto decimal incluido). Probar el parser contra una cadena
 * inventada valida contra datos que nunca va a ver.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { explicaCobro, acortaMotivo, importesEnEspanol } from "../lib/billing/motivoDelCobro.js";
import { generadoDelMes, restoDelMes } from "../lib/billing/restoDelMes.js";

/* ── Las dos notas de la familia de la captura de Rosa (AV-0085) ─────────── */
const NOTA_LOGO =
  "Cuota septiembre 2026 — Cuota Logopedia 45x1 — Pendiente según Organízate: 260.00 € " +
  "(Organízate #20182, Organízate #20392); el CRM tenía 145.00 €";
const NOTA_TO = "Cuota septiembre 2026 — Cuota T.O. 45x1 — Reserva de plaza ya abonada: −30 €";

test("la familia de los 375 €: cada cobro dice su concepto y su porqué", () => {
  const logo = explicaCobro({ notes: NOTA_LOGO, concepto: "Cuota Logopedia 45x1" });
  assert.equal(logo.concepto, "Cuota Logopedia 45x1");
  assert.deepEqual(logo.motivos, ["Pendiente según Organízate: 260,00 €"]);

  const to = explicaCobro({ notes: NOTA_TO, concepto: "Cuota T.O. 45x1" });
  assert.equal(to.concepto, "Cuota T.O. 45x1");
  assert.deepEqual(to.motivos, ["Reserva de plaza ya abonada: −30,00 €"]);
});

test("sin conceptId, el concepto sale de la nota", () => {
  // 37 de los 159 pendientes de septiembre son cuotas compuestas y nacen sin
  // `concept_id` a propósito: ahí la nota es el único sitio donde está el nombre.
  const r = explicaCobro({
    notes:
      "Cuota septiembre 2026 — Cuota Logopedia 45x1 + Cuota T.O. 45x1 — Reserva de plaza ya abonada: −30 € — " +
      "Pendiente según Organízate: 375.00 € (Organízate #1, Organízate #2); el CRM tenía 290.00 €",
  });
  assert.equal(r.concepto, "Cuota Logopedia 45x1 + Cuota T.O. 45x1");
  assert.deepEqual(r.motivos, ["Reserva de plaza ya abonada: −30,00 €", "Pendiente según Organízate: 375,00 €"]);
});

test("el nombre del catálogo manda sobre el de la nota", () => {
  // La nota se escribió con el nombre que tenía el concepto ese día; si el
  // centro lo ha renombrado desde entonces, lo que hay que leer es el de ahora.
  const r = explicaCobro({
    notes: "Cuota septiembre 2026 — Cuota Psicología 60x1 — Reserva de plaza ya abonada: −30 €",
    concepto: "Cuota Psicología 60 min",
  });
  assert.equal(r.concepto, "Cuota Psicología 60 min");
});

test("un concepto con dos puntos y un + no se confunde con un motivo", () => {
  // El catálogo de Aumenta tiene «Terapia 1 h semanal + Grupal: 2 sesiones
  // semanales de 1 h». Con una heurística de «lleva : y una cifra» se leería
  // como motivo y la cita se quedaría sin nombre.
  const r = explicaCobro({
    notes:
      "Cuota septiembre 2026 — Terapia 1 h semanal + Grupal: 2 sesiones semanales de 1 h — " +
      "desde el 8/9/2026 (3 de 4 sesiones)",
  });
  assert.equal(r.concepto, "Terapia 1 h semanal + Grupal: 2 sesiones semanales de 1 h");
  assert.deepEqual(r.motivos, ["desde el 8/9/2026 (3 de 4 sesiones)"]);
});

test("una nota escrita a mano se enseña entera y no se parte", () => {
  // «no se descuenta la reserva», dos cobros de septiembre. Es el único sitio
  // donde vive esa explicación: tirarla sería peor que no leer la nota.
  const r = explicaCobro({ notes: "no se descuenta la reserva", concepto: "Cuota Logopedia 45x1" });
  assert.equal(r.concepto, "Cuota Logopedia 45x1");
  assert.deepEqual(r.motivos, ["no se descuenta la reserva"]);
});

test("sin nota no se inventa nada", () => {
  assert.deepEqual(explicaCobro({ notes: null }), { concepto: null, motivos: [] });
  assert.deepEqual(explicaCobro({ notes: "   ", concepto: "Cuota HHSS" }), { concepto: "Cuota HHSS", motivos: [] });
  assert.deepEqual(explicaCobro({}), { concepto: null, motivos: [] });
  assert.deepEqual(explicaCobro(), { concepto: null, motivos: [] });
});

test("una cuota sin conceptos: el segundo trozo YA es un motivo", () => {
  const r = explicaCobro({ notes: "Cuota septiembre 2026 — Reserva de plaza ya abonada: −30 €" });
  assert.equal(r.concepto, null);
  assert.deepEqual(r.motivos, ["Reserva de plaza ya abonada: −30,00 €"]);
});

/* ── acortaMotivo ────────────────────────────────────────────────────────── */

test("el paréntesis se quita en su sitio y no se corta por él", () => {
  // Aquí lo que explica algo está DETRÁS del paréntesis: cortar por él dejaba
  // «Cobrado también en Organízate», que no dice nada.
  assert.equal(
    acortaMotivo("Cobrado también en Organízate (Organízate #20182): el CRM ya lo tenía cobrado a mano"),
    "Cobrado también en Organízate: el CRM ya lo tenía cobrado a mano",
  );
  assert.equal(
    acortaMotivo("Cobrado en Organízate el 3/9/2026 (Organízate #123, pago #456, tarjeta)"),
    "Cobrado en Organízate el 3/9/2026",
  );
});

test("un rótulo de tramo se queda entero: ahí el paréntesis ES la explicación", () => {
  assert.equal(acortaMotivo("desde el 13/09/2026 (3 de 4 sesiones)"), "desde el 13/09/2026 (3 de 4 sesiones)");
  assert.equal(acortaMotivo("desde el 8/9/2026 (23/30 días)"), "desde el 8/9/2026 (23/30 días)");
});

test("el rastro técnico de después del punto y coma se va", () => {
  assert.equal(
    acortaMotivo("Pendiente según Organízate: 260.00 € (Organízate #1); el CRM tenía 145.00 €"),
    "Pendiente según Organízate: 260,00 €",
  );
});

test("un motivo larguísimo se recorta y lo dice", () => {
  const largo = `Reserva de plaza ya abonada: ${"muy ".repeat(40)}larga`;
  const corto = acortaMotivo(largo);
  assert.ok(corto.length <= 90, corto.length);
  assert.ok(corto.endsWith("…"));
});

/* ── importesEnEspanol ───────────────────────────────────────────────────── */

test("los importes de la nota se dicen como los de la pantalla", () => {
  // En la misma caja no pueden convivir «260.00 €» (de la nota) y «375,00 €»
  // (de fmtMoney): el cuadro se hizo justo para que no haya dudas.
  assert.equal(importesEnEspanol("Pendiente: 260.00 €"), "Pendiente: 260,00 €");
  assert.equal(importesEnEspanol("Reserva: −30 €"), "Reserva: −30,00 €");
  assert.equal(importesEnEspanol("Reserva: -30 €"), "Reserva: -30,00 €");
  assert.equal(importesEnEspanol("de 1234.5 €"), "de 1234,50 €");
});

test("lo que no es dinero no se toca", () => {
  // Una fecha y un rótulo de sesiones tienen cifras y no llevan €.
  assert.equal(importesEnEspanol("Cobrado el 3/9/2026 (pago #456)"), "Cobrado el 3/9/2026 (pago #456)");
  assert.equal(importesEnEspanol("Cuota Logopedia 45x1"), "Cuota Logopedia 45x1");
  assert.equal(importesEnEspanol("3 de 4 sesiones"), "3 de 4 sesiones");
});

/* ── generadoDelMes: el fallo de dinero de AV-0086 ───────────────────────── */

test("el cobro generado manda sobre la tarifa del catálogo", () => {
  /*
   * EL CASO DE LAS 112 FAMILIAS. Tarifa 190, el CRM generó 160 (llevaba la
   * reserva de plaza descontada) y la familia pagó esos 160. Antes de hoy el
   * cajón medía contra los 190 y ofrecía cobrar 30 € que nadie debe.
   */
  const cobros = [{ patientId: null, amount: 160, deCuota: true, cuotaId: "c1" }];
  const generado = generadoDelMes(cobros);
  assert.deepEqual(generado, { importe: 160, cuotas: 1 });

  const antes = restoDelMes({ esperado: 190, cobros });
  assert.equal(antes.hayParcial, true);
  assert.equal(antes.resto, 30); // esto es lo que se ofrecía

  const ahora = restoDelMes({ esperado: generado.importe, cobros });
  assert.equal(ahora.completo, true);
  assert.equal(ahora.resto, 0);
});

test("un cobro tecleado a mano NO cuenta como mes generado", () => {
  // El encargo del 04/09 sigue intacto: la familia deja 50 € a mano y el resto
  // contra la cuota tiene que seguir saliendo solo.
  const cobros = [{ patientId: null, amount: 50, deCuota: false, cuotaId: null }];
  assert.equal(generadoDelMes(cobros), null);
  const r = restoDelMes({ esperado: 190, cobros });
  assert.equal(r.hayParcial, true);
  assert.equal(r.resto, 140);
});

test("el mes generado A MEDIAS se cuenta, para que quien llama no lo dé por saldado", () => {
  // Dos cuotas y un solo cobro generado: si se midiera contra esa mitad, el
  // cajón le diría «ya está cobrado entero» a quien debe la otra terapia.
  const cobros = [
    { patientId: null, amount: 160, deCuota: true, cuotaId: "c1" },
    { patientId: null, amount: 40, deCuota: false, cuotaId: null },
  ];
  const g = generadoDelMes(cobros);
  assert.equal(g.importe, 160);
  assert.equal(g.cuotas, 1); // la pantalla compara esto con las 2 cuotas vigentes
});

test("pendientes y cobrados suman juntos: los dos los generó el CRM", () => {
  const g = generadoDelMes([
    { patientId: null, amount: 260, deCuota: true, cuotaId: "c1" },
    { patientId: null, amount: 115, deCuota: true, cuotaId: "c2" },
  ]);
  assert.deepEqual(g, { importe: 375, cuotas: 2 });
});

test("con paciente elegido no se cuentan los cobros del hermano", () => {
  const g = generadoDelMes(
    [
      { patientId: "p1", amount: 100, deCuota: true, cuotaId: "c1" },
      { patientId: "p2", amount: 999, deCuota: true, cuotaId: "c2" },
      { patientId: null, amount: 50, deCuota: true, cuotaId: "c3" }, // de la familia entera
    ],
    "p1",
  );
  assert.deepEqual(g, { importe: 150, cuotas: 2 });
});

test("sin cuotaId en la respuesta, la cobertura sale 0 y quien llama se queda con la tarifa", () => {
  // Es lo prudente: sin ese dato no se puede afirmar que el mes esté cubierto.
  const g = generadoDelMes([{ patientId: null, amount: 160, deCuota: true, cuotaId: null }]);
  assert.equal(g.importe, 160);
  assert.equal(g.cuotas, 0);
});

/*
 * ── LO QUE EL CENTRO ESCRIBE A MANO DENTRO DE LA NOTA (09/09/2026) ─────────
 * La nota es un campo editable y el centro escribe dentro. Estas dos son
 * LITERALES de producción: los dos únicos cobros de cuota de septiembre con un
 * apunte a mano metido en el trozo del concepto.
 */
test("un párrafo a mano no se pinta como nombre del concepto", () => {
  const r = explicaCobro({
    notes:
      "Cuota septiembre 2026 — Cuota Psicología 45x1 - Reserva de plaza ya abonada: −30 € \n\n" +
      "IMPORTANTE: SON 145€ DESCONTADO 30€ DE RESERVA. SALIAN POR DUPLICADO COMO SI VINIERA TB A 1 " +
      "SESION DE PSICOLOGIA DE 1H. OLGA LO HA ELIMINADO EN CUOTAS. — " +
      "Cobrado en Organízate el 04/09/2026 (Organízate #20502, pago 16584, tarjeta)",
  });
  // Antes de hoy, el concepto salía con los 300 caracteres en mayúsculas dentro.
  assert.ok(r.concepto.length < 70, r.concepto);
  assert.match(r.concepto, /^Cuota Psicología 45x1/);
  // Y el aviso del centro NO se pierde: baja a motivo, que es donde se lee.
  assert.ok(r.motivos.some((m) => m.startsWith("IMPORTANTE")), JSON.stringify(r.motivos));
  assert.ok(r.motivos.some((m) => m.startsWith("Cobrado en Organízate")), JSON.stringify(r.motivos));
});

test("con el nombre del catálogo puesto, el apunte a mano tampoco se tira", () => {
  // Aquí el catálogo gana el nombre y el trozo de la nota se descartaba entero,
  // llevándose por delante «04/09/2026 descontar 15 euros de reserva» — que es
  // justo la frase que la persona que cobra necesita ver.
  const r = explicaCobro({
    notes:
      "Cuota septiembre 2026 — Cuota Psicología 60x1, \n04/09/2026 descontar 15 euros de reserva — " +
      "Cobrado también en Organízate (Organízate #20515): el CRM ya lo tenía cobrado a mano",
    concepto: "Cuota Psicología 60x1",
  });
  assert.equal(r.concepto, "Cuota Psicología 60x1");
  assert.ok(r.motivos.some((m) => m.includes("descontar 15 euros de reserva")), JSON.stringify(r.motivos));
});

test("cuando la nota dice lo mismo que el catálogo no se repite", () => {
  const r = explicaCobro({
    notes: "Cuota septiembre 2026 — Cuota Logopedia 45x1 — Reserva de plaza ya abonada: −30 €",
    concepto: "Cuota Logopedia 45x1",
  });
  assert.equal(r.concepto, "Cuota Logopedia 45x1");
  assert.deepEqual(r.motivos, ["Reserva de plaza ya abonada: −30,00 €"]);
});

test("la coma que arrastra el nombre del concepto se quita", () => {
  const r = explicaCobro({ notes: "Cuota septiembre 2026 — Cuota Psicología 60x1," });
  assert.equal(r.concepto, "Cuota Psicología 60x1");
});
