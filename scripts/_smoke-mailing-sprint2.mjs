// @prueba ligera
/**
 * _smoke-mailing-sprint2.mjs — la parte PURA del sprint 2 del mailing
 * (06/09/2026): el reparto A/B (`repartoAB`, `debeDecidirAB`, `asuntoDe` de
 * `lib/mailing/envio.js`), los eventos de las secuencias (`cumpleEvento`,
 * `periodoDe`, `mesDiaDe` de `lib/mailing/secuencias.js`) y el parseo de lo
 * que devuelve la IA (`parsearPropuesta`, `promptRedaccion` de `lib/mailing/ia.js`).
 *
 * Fija lo que DEVUELVEN: la muestra del A/B se reparte a intervalos y mitad y
 * mitad, con pocos destinatarios no hay prueba, una secuencia recién encendida
 * no barre el histórico, el cumpleaños casa por mes y día, y la IA no puede
 * colar HTML ni un bloque fuera del catálogo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

process.env.MAILING_TOKEN_SECRET = "secreto-de-pruebas";
const envio = await import(pathToFileURL(resolve("lib/mailing/envio.js")).href);
const sec = await import(pathToFileURL(resolve("lib/mailing/secuencias.js")).href);
const ia = await import(pathToFileURL(resolve("lib/mailing/ia.js")).href);

test("repartoAB: muestra a intervalos, mitad a y mitad b, el resto esperando", () => {
  const r = envio.repartoAB(100, 20);
  const prueba = r.filter((x) => x.estado === "pendiente");
  assert.equal(prueba.length, 20);
  assert.equal(prueba.filter((x) => x.variante === "a").length, 10);
  assert.equal(prueba.filter((x) => x.variante === "b").length, 10);
  assert.equal(r.filter((x) => x.estado === "esperando").length, 80);
  // A intervalos: el primero y uno del final entran en la muestra.
  assert.equal(r[0].estado, "pendiente");
  assert.equal(r[95].estado, "pendiente");
  assert.equal(r[1].estado, "esperando");
});

test("repartoAB: sin porcentaje o con menos de 20 personas, todo pendiente sin variante", () => {
  assert.ok(envio.repartoAB(50, null).every((x) => x.estado === "pendiente" && x.variante === null));
  assert.ok(envio.repartoAB(19, 50).every((x) => x.estado === "pendiente" && x.variante === null));
  assert.equal(envio.repartoAB(0, 20).length, 0);
  // Con 21 y 10 %: la muestra se redondea a un número PAR y como mínimo 2.
  const r = envio.repartoAB(21, 10);
  const prueba = r.filter((x) => x.estado === "pendiente");
  assert.equal(prueba.length % 2, 0);
  assert.ok(prueba.length >= 2);
  // El porcentaje se acota a [10, 50].
  assert.equal(envio.repartoAB(100, 90).filter((x) => x.estado === "pendiente").length, 50);
});

test("debeDecidirAB y asuntoDe", () => {
  const empezada = new Date("2026-09-06T10:00:00Z");
  const c = { asuntoB: "B", abGanador: null, empezadaAt: empezada, abEsperaHoras: 4 };
  assert.equal(envio.debeDecidirAB(c, new Date("2026-09-06T13:59:00Z")), false);
  assert.equal(envio.debeDecidirAB(c, new Date("2026-09-06T14:00:00Z")), true);
  assert.equal(envio.debeDecidirAB({ ...c, abGanador: "a" }, new Date("2026-09-07T00:00:00Z")), false);
  assert.equal(envio.debeDecidirAB({ ...c, asuntoB: null }, new Date("2026-09-07T00:00:00Z")), false);
  assert.equal(envio.debeDecidirAB({ ...c, empezadaAt: null }, new Date("2026-09-07T00:00:00Z")), false);
  assert.equal(envio.asuntoDe({ asunto: "A", asuntoB: "B" }, "b"), "B");
  assert.equal(envio.asuntoDe({ asunto: "A", asuntoB: "B" }, "a"), "A");
  assert.equal(envio.asuntoDe({ asunto: "A", asuntoB: "B" }, null), "A");
  assert.equal(envio.asuntoDe({ asunto: "A", asuntoB: null }, "b"), "A");
});

test("periodoDe y mesDiaDe", () => {
  const ahora = new Date("2026-09-06T12:00:00Z");
  assert.equal(sec.periodoDe("alta", ahora), "unica");
  assert.equal(sec.periodoDe("cumpleanos", ahora), "2026");
  assert.equal(sec.periodoDe("sin_cita", ahora), "2026");
  assert.equal(sec.mesDiaDe("1988-09-06"), "09-06");
  assert.equal(sec.mesDiaDe(new Date(Date.UTC(1992, 1, 29))), "02-29");
  assert.equal(sec.mesDiaDe(null), null);
  assert.equal(sec.mesDiaDe("basura"), null);
});

const DIA = 86400000;
test("cumpleEvento alta: cuenta desde que se enciende, tras los días, y caduca al mes", () => {
  const ahora = new Date("2026-09-06T12:00:00Z");
  const seq = { evento: "alta", dias: 1, activadaDesde: new Date("2026-09-01T00:00:00Z") };
  assert.equal(sec.cumpleEvento(seq, { createdAt: new Date(ahora.getTime() - 2 * DIA) }, ahora), true);
  assert.equal(sec.cumpleEvento(seq, { createdAt: new Date(ahora.getTime() - 0.5 * DIA) }, ahora), false); // aún no cumple el día
  assert.equal(sec.cumpleEvento(seq, { createdAt: new Date("2026-08-20T00:00:00Z") }, ahora), false); // anterior al encendido
  assert.equal(sec.cumpleEvento({ ...seq, activadaDesde: new Date("2026-01-01") }, { createdAt: new Date("2026-06-01") }, ahora), false); // hace más de un mes
  assert.equal(sec.cumpleEvento({ ...seq, dias: 0 }, { createdAt: new Date(ahora.getTime() - 60000) }, ahora), true);
  assert.equal(sec.cumpleEvento(seq, { createdAt: null }, ahora), false);
});

test("cumpleEvento cumpleaños: por mes y día de Madrid, y el 29 de febrero se felicita el 28", () => {
  const ahora = new Date("2026-09-06T12:00:00Z");
  const seq = { evento: "cumpleanos", activadaDesde: new Date("2026-01-01") };
  assert.equal(sec.cumpleEvento(seq, { birthDate: "1990-09-06" }, ahora), true);
  assert.equal(sec.cumpleEvento(seq, { birthDate: "1990-09-07" }, ahora), false);
  assert.equal(sec.cumpleEvento(seq, { birthDate: null }, ahora), false);
  // 2026 no es bisiesto: el 28 de febrero se felicita a quien nació el 29.
  assert.equal(sec.cumpleEvento(seq, { birthDate: "1992-02-29" }, new Date("2026-02-28T12:00:00Z")), true);
  assert.equal(sec.cumpleEvento(seq, { birthDate: "1992-02-29" }, new Date("2028-02-28T12:00:00Z")), false); // 2028 sí tiene 29
});

test("cumpleEvento sin_cita: cruza el umbral después de encender y dentro de los 30 días", () => {
  const ahora = new Date("2026-09-06T12:00:00Z");
  const seq = { evento: "sin_cita", dias: 180, activadaDesde: new Date("2026-09-01T00:00:00Z") };
  const hace = (d) => new Date(ahora.getTime() - d * DIA);
  assert.equal(sec.cumpleEvento(seq, { ultimaCita: hace(182) }, ahora), true); // cruzó hace 2 días, tras encender
  assert.equal(sec.cumpleEvento(seq, { ultimaCita: hace(170) }, ahora), false); // todavía no
  assert.equal(sec.cumpleEvento(seq, { ultimaCita: hace(400) }, ahora), false); // cruzó mucho antes de encender: no se barre
  assert.equal(sec.cumpleEvento({ ...seq, activadaDesde: new Date("2020-01-01") }, { ultimaCita: hace(200) }, ahora), true); // cruzó hace 20 días
  assert.equal(sec.cumpleEvento({ ...seq, activadaDesde: new Date("2020-01-01") }, { ultimaCita: hace(220) }, ahora), false); // hace 40 días: fuera de ventana
  assert.equal(sec.cumpleEvento(seq, { ultimaCita: null }, ahora), false);
});

test("parsearPropuesta: JSON con vallas, bloques por lista blanca, imagen destacada colocada", () => {
  const raw = '```json\n{"asunto":"  Abrimos  plazas ","preheader":"Cuatro martes","bloques":[{"tipo":"titulo","texto":"Hola {{nombre}}","nivel":9},{"tipo":"imagen","alt":"Cartel"},{"tipo":"texto","html":"<p>Hola <script>x</script><b>ya</b></p>"},{"tipo":"video","url":"https://x"},{"tipo":"firma","nombre":"Colado"},{"tipo":"boton","texto":"Reservar","url":"https://centro.com/r"}]}\n```';
  const p = ia.parsearPropuesta(raw, { imagenUrl: "https://crm/img.png" });
  assert.equal(p.asunto, "Abrimos plazas");
  assert.equal(p.preheader, "Cuatro martes");
  assert.deepEqual(p.bloques.map((b) => b.tipo), ["titulo", "imagen", "texto", "boton"]);
  assert.equal(p.bloques[0].nivel, 1);
  assert.equal(p.bloques[1].url, "https://crm/img.png");
  assert.equal(p.bloques[2].html, "<p>Hola &lt;script&gt;x&lt;/script&gt;<strong>ya</strong></p>");
  assert.equal(p.bloques[3].url, "https://centro.com/r");
  assert.ok(p.bloques.every((b) => typeof b.id === "string" && b.id.length > 10));
});

test("parsearPropuesta: sin imagen destacada el bloque de imagen desaparece; con basura devuelve null; rescata un JSON con texto delante", () => {
  const p = ia.parsearPropuesta('{"asunto":"A","bloques":[{"tipo":"imagen","alt":"x"},{"tipo":"separador"}]}');
  assert.deepEqual(p.bloques.map((b) => b.tipo), ["separador"]);
  assert.equal(ia.parsearPropuesta("no es json"), null);
  assert.equal(ia.parsearPropuesta('{"asunto":"","bloques":[]}'), null);
  const q = ia.parsearPropuesta('Aquí tienes: {"asunto":"B","bloques":[{"tipo":"titulo","texto":"T"}]}');
  assert.equal(q.asunto, "B");
});

test("promptRedaccion: prohíbe inventar, limita los tipos y solo pide imagen si la hay", () => {
  const sin = ia.promptRedaccion({ centro: { nombre: "Centro X" }, vocab: { plural: "Pacientes" }, tono: "profesional" });
  assert.match(sin, /PROHIBIDO inventar/);
  assert.match(sin, /pacientes/);
  assert.match(sin, /profesional y claro/);
  assert.match(sin, /No pongas bloques de imagen/);
  assert.doesNotMatch(sin, /firma/); // la firma no la escribe la IA
  const con = ia.promptRedaccion({ centro: { nombre: "Centro X" }, vocab: {}, conImagen: true });
  assert.match(con, /imagen destacada/);
  assert.match(ia.promptRedaccion({ centro: {}, vocab: {}, tono: "raro" }), /cercano y natural/);
});

test("fakeRedaccion: sin tokens, con bloques válidos y sin HTML colado", () => {
  const p = ia.fakeRedaccion({ instruccion: "Taller <script>alert(1)</script>", imagenUrl: "https://crm/i.png" });
  assert.deepEqual(p.bloques.map((b) => b.tipo), ["titulo", "imagen", "texto", "texto"]);
  assert.doesNotMatch(JSON.stringify(p.bloques), /<script/);
  assert.equal(ia.fakeAsuntos({ asunto: "Novedades" }).length, 3);
});
