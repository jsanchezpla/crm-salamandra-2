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
import { tramoDelMes, rotuloDeTramo } from "../lib/billing/cuotas.js";

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

  it("y solo bajan fechas: ni paciente, ni terapeuta, ni motivo", () => {
    const bloque = endpoint.slice(endpoint.indexOf("const citasPorClave"), endpoint.indexOf("return ok({"));
    assert.match(bloque, /\.map\(\(c\) => \(\{ scheduledAt: c\.scheduledAt \}\)\)/);
    assert.ok(!/patientName|clientName|notes/.test(bloque));
  });

  it("se limpian al cambiar de familia, o se cobraría con las del anterior", () => {
    assert.match(pagina, /setCitasDelMes\(\[\]\);/);
  });
});
