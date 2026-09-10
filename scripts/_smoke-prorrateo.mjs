// @prueba ligera
// Fija lib/billing/prorrateo.js: la parte proporcional de una cuota cuando la
// familia empieza a mitad de mes.
import test from "node:test";
import assert from "node:assert/strict";
import { prorrateoDeCuota, rotuloDeProrrateo, partesConProrrateo } from "../lib/billing/prorrateo.js";

test("empezar el 15 de septiembre cobra 16 de 30 días", () => {
  const r = prorrateoDeCuota(190, "2026-09-15");
  assert.equal(r.diasCobrados, 16);
  assert.equal(r.diasDelMes, 30);
  assert.equal(r.importe, 101.33);
});

test("el día 1 es la cuota entera; el último día, un solo día", () => {
  assert.equal(prorrateoDeCuota(190, "2026-09-01").importe, 190);
  const ultimo = prorrateoDeCuota(310, "2026-10-31");
  assert.equal(ultimo.diasCobrados, 1);
  assert.equal(ultimo.diasDelMes, 31);
  assert.equal(ultimo.importe, 10);
});

test("febrero bisiesto cuenta 29 días", () => {
  const r = prorrateoDeCuota(290, "2028-02-15");
  assert.equal(r.diasDelMes, 29);
  assert.equal(r.diasCobrados, 15);
  assert.equal(r.importe, 150);
});

test("un descuento (negativo) también se prorratea", () => {
  assert.equal(prorrateoDeCuota(-30, "2026-09-16").importe, -15);
});

test("una fecha ilegible o imposible devuelve null, no un importe inventado", () => {
  assert.equal(prorrateoDeCuota(190, "no sé"), null);
  assert.equal(prorrateoDeCuota(190, "2026-02-31"), null);
  assert.equal(prorrateoDeCuota(190, ""), null);
});

test("el rótulo dice desde cuándo y cuántos días, listo para escribirse", () => {
  assert.equal(rotuloDeProrrateo("2026-09-13"), "desde el 13/09/2026 (18/30 días)");
  assert.equal(rotuloDeProrrateo("garabato"), null);
});

// El ejemplo de Rodrigo (31/08/2026): empezó el 13 con logopedia, el 17 con
// psicología y el 24 con neuropsicología — cada servicio con SU fecha.
test("varios servicios, cada uno prorrateado por su propia fecha de inicio", () => {
  const r = partesConProrrateo([
    { importe: 300, inicio: "2026-09-13" }, // 18/30 días
    { importe: 300, inicio: "2026-09-17" }, // 14/30 días
    { importe: 300, inicio: "2026-09-24" }, //  7/30 días
  ]);
  assert.equal(r.partes[0].importe, 180);
  assert.equal(r.partes[1].importe, 140);
  assert.equal(r.partes[2].importe, 70);
  assert.equal(r.total, 390);
  assert.equal(r.totalCompleto, 900);
  assert.equal(r.hayProrrateo, true);
  assert.equal(r.partes[2].rotulo, "desde el 24/09/2026 (7/30 días)");
});

test("sin fecha (o con fecha rota) la parte va entera y no rompe el total", () => {
  const r = partesConProrrateo([
    { importe: 190, inicio: "" },
    { importe: -30, inicio: "2026-09-16" }, // descuento prorrateado: −15
    { importe: 100, inicio: "chapuza" },
  ]);
  assert.equal(r.partes[0].importe, 190);
  assert.equal(r.partes[1].importe, -15);
  assert.equal(r.partes[2].importe, 100);
  assert.equal(r.partes[2].prorrateo, null);
  assert.equal(r.total, 275);
});

/*
 * ── «ACABÓ EL…» (10/09/2026, Rodrigo) ────────────────────────────────────────
 * «Aparte de Empezó el… también tiene que haber Acabó el…, para los pacientes
 * que fallan a final de mes pero han empezado bien.»
 */
test("acabar el 15 de septiembre cobra 15 de 30 días", () => {
  const r = partesConProrrateo([{ importe: 190, inicio: "", fin: "2026-09-15" }], { mes: "2026-09" });
  assert.equal(r.partes[0].prorrateo.diasCobrados, 15);
  assert.equal(r.partes[0].importe, 95);
  assert.equal(r.partes[0].rotulo, "hasta el 15/09/2026 (15/30 días)");
});

test("empezó Y acabó dentro del mes: solo el trozo de en medio", () => {
  const r = partesConProrrateo([{ importe: 300, inicio: "2026-09-11", fin: "2026-09-20" }], { mes: "2026-09" });
  assert.equal(r.partes[0].prorrateo.diasCobrados, 10);
  assert.equal(r.partes[0].importe, 100);
  assert.equal(r.partes[0].rotulo, "del 11/09/2026 al 20/09/2026 (10/30 días)");
});

test("acabar el último día del mes no es prorratear nada", () => {
  const r = partesConProrrateo([{ importe: 190, inicio: "", fin: "2026-09-30" }], { mes: "2026-09" });
  assert.equal(r.partes[0].importe, 190);
  assert.equal(r.partes[0].prorrateo, null);
  assert.equal(r.partes[0].rotulo, null);
});

test("sin decir el mes, «Acabó el» se lo saca de su propia fecha", () => {
  const r = partesConProrrateo([{ importe: 190, fin: "2026-09-15" }]);
  assert.equal(r.partes[0].importe, 95);
});

test("una fecha de fin ilegible no cambia nada: el mes va entero", () => {
  const r = partesConProrrateo([{ importe: 190, inicio: "", fin: "chapuza" }], { mes: "2026-09" });
  assert.equal(r.partes[0].importe, 190);
  assert.equal(r.partes[0].prorrateo, null);
});
