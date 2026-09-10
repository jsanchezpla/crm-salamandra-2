// @prueba ligera — node:test sobre lib/billing/caja.js y regex sobre dos ficheros.
/**
 * _smoke-fondo-caja.mjs — el fondo de un cierre sale de lo que se contó en el
 * anterior (07/09/2026, AV-0067 de Aumenta).
 *
 *   node scripts/_smoke-fondo-caja.mjs
 *
 * Rosa: «no puedo cuadrar saldo porque no sé de qué saldo habéis partido». La
 * casilla «Fondo inicial» se abría vacía cada vez y nadie llevaba el saldo de
 * un día al siguiente. En Aumenta, además, los 828 cierres que vinieron de
 * Organízate entraron con fondo 0 y sin nada contado, así que no había ni un
 * número del que tirar.
 *
 * Lo que se fija aquí:
 *
 *   · que `fondoSugerido` devuelva lo CONTADO (no lo esperado ni el fondo del
 *     cierre anterior: lo que se contó es lo que se queda en el cajón);
 *   · que un cierre contado a CERO sea un dato y no un «no hay» — el cajón
 *     puede quedarse vacío, y devolver null ahí volvería a dejar la casilla
 *     sin explicación;
 *   · que sin cierre anterior devuelva null, para que la pantalla lo diga en
 *     vez de proponer un cero que parecería un dato;
 *   · que los DECIMAL en texto («120.50», que es como los devuelve Postgres)
 *     se cuenten como números;
 *   · y que el servidor mande el último cierre AL MARGEN del filtro de fechas,
 *     porque si dependiera del rango la propuesta desaparecería justo cuando
 *     alguien mira una semana concreta.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fondoSugerido } from "../lib/billing/caja.js";

const lee = (r) => readFileSync(new URL(r, import.meta.url), "utf8");

describe("el fondo que se propone para el cierre", () => {
  it("es lo que se contó en el cierre anterior", () => {
    const r = fondoSugerido({ closeDate: "2026-07-31", countedAmount: 245.5, openingAmount: 100 });
    assert.deepEqual(r, { importe: 245.5, fecha: "2026-07-31" });
  });

  it("un cajón contado a cero POR UNA PERSONA es un dato, no un «no hay»", () => {
    const r = fondoSugerido({ closeDate: "2026-07-31", countedAmount: 0, hechoPorUnaPersona: true });
    assert.deepEqual(r, { importe: 0, fecha: "2026-07-31" });
  });

  it("un cierre IMPORTADO no propone nada: sin autor y sin nada contado", () => {
    // Los 828 de Aumenta: fondo, contado y esperado a 0, y sin autor.
    assert.equal(fondoSugerido({ closeDate: "2026-07-31", countedAmount: 0, hechoPorUnaPersona: false }), null);
  });

  it("pero un conteo de verdad vale aunque no conste quién cerró", () => {
    // `closedById` sale de la ficha de equipo: un administrador que no está en
    // la plantilla cierra sin autor, y su conteo es igual de bueno.
    const r = fondoSugerido({ closeDate: "2026-09-06", countedAmount: 245.5, hechoPorUnaPersona: false });
    assert.deepEqual(r, { importe: 245.5, fecha: "2026-09-06" });
  });

  it("sin cierre anterior no propone nada", () => {
    assert.equal(fondoSugerido(null), null);
    assert.equal(fondoSugerido(undefined), null);
  });

  it("los DECIMAL que llegan como texto se cuentan como números", () => {
    assert.equal(fondoSugerido({ closeDate: "2026-07-31", countedAmount: "120.50" }).importe, 120.5);
  });

  it("acepta también las columnas en crudo de una consulta SQL", () => {
    const r = fondoSugerido({ close_date: "2026-06-30", counted_amount: "80.00" });
    assert.deepEqual(r, { importe: 80, fecha: "2026-06-30" });
  });

  it("un contado ilegible o negativo no se propone", () => {
    assert.equal(fondoSugerido({ countedAmount: "no es un número" }), null);
    assert.equal(fondoSugerido({ countedAmount: -30 }), null);
    assert.equal(fondoSugerido({ countedAmount: null }), null);
  });

  it("redondea a céntimos", () => {
    assert.equal(fondoSugerido({ countedAmount: 10.005 }).importe, 10.01);
  });

  it("no suma los apuntes de entrada y salida (ya cuentan en el esperado)", () => {
    const r = fondoSugerido({ closeDate: "2026-07-31", countedAmount: 100, entradas: 50, salidas: 20 });
    assert.equal(r.importe, 100, "sumarlos aquí los contaría dos veces");
  });
});

describe("de dónde saca la pantalla ese número", () => {
  const endpoint = lee("../app/api/arqueo/cierres/route.js");
  const pagina = lee("../app/(dashboard)/facturacion/arqueo/page.jsx");

  it("el servidor manda el último cierre de esa caja", () => {
    assert.match(endpoint, /let ultimoCierre = null;/);
    assert.match(endpoint, /ultimoCierre,/, "no viaja en la respuesta");
  });

  it("y lo busca sin el filtro de fechas, solo por caja", () => {
    const bloque = endpoint.slice(endpoint.indexOf("let ultimoCierre"), endpoint.indexOf("return ok({"));
    assert.match(bloque, /where: \{ cashPointId: cajaId \}/, "el where no puede llevar el rango de fechas");
    assert.match(bloque, /order: \[\["closeDate", "DESC"\]/);
    assert.match(bloque, /attributes: \["closeDate", "countedAmount", "closedById"\]/);
    assert.match(bloque, /hechoPorUnaPersona: Boolean\(ultimo\.closedById\)/, "hay que saber si lo cerró alguien");
    assert.ok(!/closedById: ultimo\.closedById/.test(bloque), "el id de la persona no baja al navegador");
  });

  it("la pantalla lo usa para rellenar el fondo, no para decidir sola", () => {
    assert.match(pagina, /import \{ fondoSugerido \} from "@\/lib\/billing\/caja\.js";/);
    assert.match(pagina, /const fondoDeAyer = fondoSugerido\(ultimoCierre\);/);
    const abrir = pagina.slice(pagina.indexOf("function abrirCierre"), pagina.indexOf("useEffect(() => {", pagina.indexOf("function abrirCierre")));
    assert.match(abrir, /openingAmount: fondoDeAyer \? String\(fondoDeAyer\.importe\) : ""/);
  });

  /*
   * Desde el 10/09/2026 el fondo bueno lo dice el servidor para el DÍA que se
   * está cerrando: cerrando un día atrasado, el último cierre de todos puede
   * ser posterior y su conteo no vale. El de ayer se queda como lo que se
   * enseña mientras llega la respuesta.
   */
  it("y el del día que se cierra lo manda el servidor, que sabe cuál es", () => {
    assert.match(endpoint, /closeDate: \{ \[Op\.lt\]: fecha \}/, "el fondo sale del último cierre ANTERIOR a ese día");
    assert.match(pagina, /const fondoDelDia = previo\?\.fondo \?\? fondoDeAyer;/);
  });

  it("y dice de dónde sale, con las dos caras", () => {
    assert.match(pagina, /Es lo que se contó al cerrar el/);
    assert.match(pagina, /Es el primer cierre de esta caja/);
  });

  it("el fondo se sigue pudiendo cambiar a mano", () => {
    const campo = pagina.slice(pagina.indexOf('<span className="text-[12px] text-neutral-500">Fondo inicial'), pagina.indexOf("Dinero contado"));
    assert.match(campo, /openingAmount: e\.target\.value/);
    // Y en cuanto se toca, manda la persona: el sistema deja de reescribirlo
    // al recargar la cuenta del día (10/09/2026).
    assert.match(campo, /tocado\.current\.fondo = true/);
  });
});

/*
 * ── EL FONDO EN BLANCO NO ES UN CERO (07/09/2026) ──────────────────────────
 * `Number(body.openingAmount || 0)` convertía un fondo vacío en 0 sin decir
 * nada. Mientras el fondo se tecleaba siempre y casi siempre era 0 daba igual;
 * desde que se arrastra el saldo de un día al siguiente, un fondo en blanco
 * vale cientos de euros: lo esperado salía corto justo por el fondo, el arqueo
 * cantaba un descuadre falso de ese importe y encima pedía un motivo para algo
 * que no había pasado. Y se llega desde la pantalla, no solo por API: el fondo
 * nace vacío cuando el cierre anterior es importado o no lo hay.
 */
describe("el fondo en blanco no puede colarse como cero", () => {
  const ruta = lee("../app/api/arqueo/cierres/route.js");
  const pagina = lee("../app/(dashboard)/facturacion/arqueo/page.jsx");

  it("el servidor lo exige, como exige el dinero contado", () => {
    assert.match(ruta, /body\.openingAmount === undefined \|\| body\.openingAmount === null \|\| body\.openingAmount === ""/);
    assert.match(ruta, /Falta el fondo inicial/);
    assert.ok(
      !/Number\(body\.openingAmount \|\| 0\)/.test(ruta),
      "el `|| 0` es justo lo que convertía el vacío en cero",
    );
  });

  it("y un fondo ilegible tampoco pasa", () => {
    assert.match(ruta, /Number\.isNaN\(openingAmount\)/);
  });

  it("y la pantalla no deja cerrar con la casilla vacía", () => {
    const campo = pagina.slice(pagina.indexOf('<span className="text-[12px] text-neutral-500">Fondo inicial'), pagina.indexOf("Dinero contado"));
    assert.match(campo, /<input\s+required/, "el campo del fondo tiene que ser obligatorio");
  });
});
