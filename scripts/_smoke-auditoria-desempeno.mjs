// @prueba ligera
/**
 * La auditoría mensual de desempeño (`lib/team/auditoriaDesempeno.js`,
 * 09/09/2026, AV-0100).
 *
 * Se prueba lo que se pidió con palabras, que es justo lo que un refactor puede
 * romper sin que nadie lo note: que un «no apto» NO decida el resultado, que lo
 * que se repite mes a mes se vea, y que un borrador no lo lea la persona
 * auditada.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  AREAS,
  areasEnBlanco,
  avisosDelCierre,
  criteriosDe,
  criteriosQueSeRepiten,
  loQuePendiaDeLaAnterior,
  mesAnterior,
  nombreDelMes,
  normalizarAreas,
  puedeEditarAuditoria,
  puedeVerAuditoria,
  recuentoDeAuditoria,
  valorValido,
} from "../lib/team/auditoriaDesempeno.js";

/** Una auditoría de un mes con los criterios que se le digan en «no apto». */
function auditoriaCon(mes, noAptos = []) {
  const areas = areasEnBlanco();
  for (const a of areas) {
    for (const c of a.criterios) c.valor = noAptos.includes(c.key) ? "noApto" : "apto";
  }
  return { mes, areas };
}

test("las cuatro áreas son las que pidió el centro", () => {
  assert.deepEqual(AREAS.map((a) => a.label), [
    "Gestión documental",
    "Preparación y seguimiento de casos",
    "Calidad de la intervención",
    "Familias y coordinación",
  ]);
});

test("una auditoría nueva nace SIN valorar", () => {
  // Arrancar todo en «Apto» la convertiría en un trámite de pulsar Guardar.
  const areas = areasEnBlanco();
  assert.equal(recuentoDeAuditoria(areas).sinValorar, criteriosDe(areas).length);
  assert.equal(recuentoDeAuditoria(areas).apto, 0);
});

test("el recuento NO devuelve nota ni porcentaje", () => {
  // Se pidió expresamente que no hubiera puntuaciones: un «3 de 16» invita a
  // comparar personas, y esto no es una clasificación.
  const r = recuentoDeAuditoria(auditoriaCon("2026-09", ["puntualidad"]).areas);
  assert.deepEqual(Object.keys(r).sort(), ["apto", "noAplica", "noApto", "sinValorar"]);
});

test("un «no apto» NO hace desfavorable la auditoría", () => {
  // Es literal de la petición. Aquí se comprueba lo que NO existe: no hay
  // ninguna función que calcule el resultado desde los valores.
  const a = { ...auditoriaCon("2026-09", ["puntualidad"]), resultado: "favorable", aspectosAMejorar: "Llegar a la hora." };
  assert.deepEqual(avisosDelCierre(a), []);
});

test("un «requiere seguimiento» sin aspectos ni acción sí avisa", () => {
  const a = { ...auditoriaCon("2026-09", []), resultado: "requiereSeguimiento" };
  const avisos = avisosDelCierre(a);
  assert.ok(avisos.some((x) => x.includes("aspecto a mejorar")));
  assert.ok(avisos.some((x) => x.includes("acción acordada")));
});

test("los avisos cuentan lo que queda sin valorar, en singular y en plural", () => {
  const areas = areasEnBlanco();
  areas[0].criterios[0].valor = "apto";
  const total = criteriosDe(areas).length - 1;
  assert.ok(avisosDelCierre({ areas }).some((x) => x.includes(`${total} criterios sin valorar`)));

  const casiTodas = areasEnBlanco();
  for (const a of casiTodas) for (const c of a.criterios) c.valor = "apto";
  casiTodas[0].criterios[0].valor = null;
  assert.ok(avisosDelCierre({ areas: casiTodas }).some((x) => x.includes("Queda 1 criterio sin valorar")));
});

test("lo que se repite en meses CONSECUTIVOS sale; lo salteado no", () => {
  // «Si el mismo incumplimiento se repite mes a mes, tiene que verse». Un no
  // apto en julio y otro en septiembre son dos hechos, no una pauta.
  const historia = [
    auditoriaCon("2026-07", ["puntualidad"]),
    auditoriaCon("2026-08", ["registrosAlDia"]),
    auditoriaCon("2026-09", ["registrosAlDia"]),
  ];
  const repes = criteriosQueSeRepiten(historia);
  assert.equal(repes.length, 1);
  assert.deepEqual(repes[0].meses, ["2026-08", "2026-09"]);
  assert.equal(repes[0].label, "Registra las sesiones en plazo");
});

test("una racha rota y vuelta a empezar cuenta la más larga, no la suma", () => {
  const historia = [
    auditoriaCon("2026-04", ["puntualidad"]),
    auditoriaCon("2026-05", ["puntualidad"]),
    auditoriaCon("2026-06", ["puntualidad"]),
    auditoriaCon("2026-07", []),
    auditoriaCon("2026-08", ["puntualidad"]),
  ];
  const repes = criteriosQueSeRepiten(historia);
  assert.equal(repes.length, 1);
  assert.equal(repes[0].meses.length, 3);
});

test("los meses se ordenan solos: da igual en qué orden lleguen", () => {
  const desordenada = [auditoriaCon("2026-09", ["puntualidad"]), auditoriaCon("2026-08", ["puntualidad"])];
  assert.deepEqual(criteriosQueSeRepiten(desordenada)[0].meses, ["2026-08", "2026-09"]);
});

test("un solo mes con un no apto no es una racha", () => {
  assert.deepEqual(criteriosQueSeRepiten([auditoriaCon("2026-09", ["puntualidad"])]), []);
});

test("lo pendiente de la anterior trae acción, plazo y los no aptos", () => {
  const anterior = {
    ...auditoriaCon("2026-08", ["informesEnPlazo"]),
    resultado: "requiereSeguimiento",
    aspectosAMejorar: "Los informes llegan tarde.",
    accionAcordada: "Entregarlos antes del día 10.",
    plazoRevision: "2026-09-30",
  };
  const p = loQuePendiaDeLaAnterior(anterior);
  assert.equal(p.mes, "2026-08");
  assert.equal(p.accionAcordada, "Entregarlos antes del día 10.");
  assert.equal(p.plazoRevision, "2026-09-30");
  assert.equal(p.noAptos.length, 1);
  assert.equal(p.noAptos[0].label, "Entrega los informes comprometidos en su fecha");
});

test("sin auditoría anterior no se inventa nada", () => {
  assert.equal(loQuePendiaDeLaAnterior(null), null);
});

test("normalizar tira lo que no reconoce y conserva los rótulos guardados", () => {
  // Los rótulos NO se releen de la plantilla: una auditoría firmada tiene que
  // seguir diciendo lo que decía.
  const areas = normalizarAreas([
    { key: "documental", label: "Como se llamaba en marzo", criterios: [{ key: "x", label: "Un criterio suyo", valor: "loQueSea", observaciones: "  ojo  " }] },
    { label: "sin key" },
  ]);
  assert.equal(areas.length, 1);
  assert.equal(areas[0].label, "Como se llamaba en marzo");
  assert.equal(areas[0].criterios[0].valor, null);
  assert.equal(areas[0].criterios[0].observaciones, "ojo");
});

test("normalizar algo que no es una lista devuelve la plantilla en blanco", () => {
  assert.equal(normalizarAreas(null).length, AREAS.length);
});

test("solo los tres valores, y sin valorar también vale", () => {
  assert.ok(valorValido("apto") && valorValido("noApto") && valorValido("noAplica") && valorValido(null));
  assert.ok(!valorValido("regular"));
});

test("dirección lo ve todo; la auditada, lo suyo y solo cerrado", () => {
  // Es material laboral: la misma conversación que las incidencias en agosto.
  const suya = { teamMemberId: "tm1", estado: "cerrada" };
  const suyaBorrador = { teamMemberId: "tm1", estado: "borrador" };
  const ajena = { teamMemberId: "tm2", estado: "cerrada" };

  assert.ok(puedeVerAuditoria({ esAdmin: true }, suyaBorrador));
  assert.ok(puedeVerAuditoria({ teamMemberId: "tm1" }, suya));
  assert.ok(!puedeVerAuditoria({ teamMemberId: "tm1" }, suyaBorrador));
  assert.ok(!puedeVerAuditoria({ teamMemberId: "tm1" }, ajena));
  assert.ok(!puedeVerAuditoria({}, suya));
});

test("solo dirección escribe", () => {
  assert.ok(puedeEditarAuditoria({ esAdmin: true }));
  assert.ok(!puedeEditarAuditoria({ teamMemberId: "tm1" }));
});

test("los meses se escriben en español y el anterior salta de año", () => {
  assert.equal(nombreDelMes("2026-09"), "septiembre de 2026");
  assert.equal(nombreDelMes("nada"), "");
  assert.equal(mesAnterior("2026-01"), "2025-12");
  assert.equal(mesAnterior("2026-09"), "2026-08");
  assert.equal(mesAnterior("2026-13"), null);
});
