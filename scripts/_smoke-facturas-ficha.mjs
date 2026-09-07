// @prueba ligera — node:test sobre lib/ y regex sobre la pantalla y el endpoint.
/**
 * _smoke-facturas-ficha.mjs — la pestaña Facturación de la ficha enseña TODAS
 * las facturas de la familia y deja descargarlas (07/09/2026, AV-0066 de
 * Aumenta).
 *
 *   node scripts/_smoke-facturas-ficha.mjs
 *
 * Rosa: «en el apartado de CLIENTES (facturación) no se ven todas las facturas
 * emitidas de ese paciente en ejercicios anteriores y no se pueden descargar».
 * Eran DOS cortes encadenados: el servidor traía 50 y la pantalla pintaba
 * `slice(0, 10)` de esas 50, ordenadas de la más nueva a la más vieja. En
 * Aumenta escondía 8.420 de las 14.246 facturas vivas, y hay 12.135 anteriores
 * a 2026, así que a una familia con historia se le veía el año en curso y nada
 * más. Y la sección no tenía ni un enlace al PDF.
 *
 * Lo que se fija:
 *
 *   · el reparto por ejercicio, incluida la trampa de la fecha: el año se saca
 *     del TEXTO y no con `new Date`, o una factura del 1 de enero se iría al
 *     año anterior al pasar por UTC;
 *   · que un BORRADOR no ofrezca descarga (no tiene número todavía), la misma
 *     regla que la lista de Facturas;
 *   · que el tope del servidor tenga techo: `limite` no puede vaciar la tabla
 *     entera desde la barra de direcciones;
 *   · y que la pantalla ya no recorte, que pida más de 50 y que diga cuándo
 *     hay más detrás, porque una lista corta con cara de completa es peor que
 *     una lista corta que lo avisa.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ejercicioDe, ejerciciosDe, facturasDelEjercicio, sePuedeDescargar } from "../lib/billing/ejerciciosFactura.js";
import { limiteDeFacturas, FACTURAS_POR_DEFECTO, TOPE_FACTURAS } from "../lib/billing/billingSummary.js";

const lee = (r) => readFileSync(new URL(r, import.meta.url), "utf8");

const FACTURAS = [
  { id: "a", number: "F-2026-0002", issueDate: "2026-09-07", status: "issued" },
  { id: "b", number: "F-2026-0001", issueDate: "2026-01-01", status: "paid" },
  { id: "c", number: "F-2024-0088", issueDate: "2024-03-11", status: "paid" },
  { id: "d", number: null, issueDate: "2026-09-07", status: "draft" },
];

describe("las facturas de la familia, por ejercicio", () => {
  it("los ejercicios salen del más nuevo al más viejo y sin repetir", () => {
    assert.deepEqual(ejerciciosDe(FACTURAS), ["2026", "2024"]);
  });

  it("una factura del 1 de enero se queda en SU año", () => {
    // Con `new Date("2026-01-01")` esto se iría a 2025 en Madrid.
    assert.equal(ejercicioDe({ issueDate: "2026-01-01" }), "2026");
  });

  it("filtrar por un año deja solo las de ese año", () => {
    assert.equal(facturasDelEjercicio(FACTURAS, "2024").length, 1);
    assert.equal(facturasDelEjercicio(FACTURAS, "2026").length, 3);
  });

  it("sin año elegido salen todas, y no es la misma lista de antes", () => {
    const todas = facturasDelEjercicio(FACTURAS, "");
    assert.equal(todas.length, FACTURAS.length);
    assert.notEqual(todas, FACTURAS, "devuelve una copia: la pantalla no puede mutar el estado");
  });

  it("una fecha ausente o ilegible no inventa un ejercicio", () => {
    assert.equal(ejercicioDe({ issueDate: null }), null);
    assert.equal(ejercicioDe({ issueDate: "sin fecha" }), null);
    assert.deepEqual(ejerciciosDe([{ issueDate: null }]), []);
  });

  it("un borrador no se puede descargar; una emitida sí", () => {
    assert.equal(sePuedeDescargar(FACTURAS[3]), false, "el borrador no tiene número");
    assert.equal(sePuedeDescargar(FACTURAS[0]), true);
    assert.equal(sePuedeDescargar({ status: "issued" }), false, "sin id no hay a dónde ir");
  });
});

describe("cuántas facturas trae el servidor", () => {
  it("sin pedir nada, las de siempre", () => {
    assert.equal(limiteDeFacturas(undefined), FACTURAS_POR_DEFECTO);
    assert.equal(limiteDeFacturas(""), FACTURAS_POR_DEFECTO);
    assert.equal(limiteDeFacturas("hola"), FACTURAS_POR_DEFECTO);
    assert.equal(limiteDeFacturas(0), FACTURAS_POR_DEFECTO);
    assert.equal(limiteDeFacturas(-5), FACTURAS_POR_DEFECTO);
  });

  it("se puede pedir más, pero hay techo", () => {
    assert.equal(limiteDeFacturas(200), 200);
    assert.equal(limiteDeFacturas(TOPE_FACTURAS + 1000), TOPE_FACTURAS);
  });

  it("el techo deja sitio a la familia con más historia de Aumenta (134)", () => {
    assert.ok(TOPE_FACTURAS >= 134, `el tope es ${TOPE_FACTURAS}`);
  });
});

describe("la pantalla de la ficha", () => {
  const seccion = lee("../components/billing/ClientBillingSection.jsx");
  const resumen = lee("../lib/billing/billingSummary.js");
  const endpoint = lee("../app/api/clients/[id]/billing-summary/route.js");

  it("ya no recorta la lista a diez", () => {
    assert.ok(!/invoices\.slice\(0, 10\)/.test(seccion), "el slice(0, 10) sigue ahí");
    assert.match(seccion, /\{visibles\.map\(\(inv\) => \(/);
  });

  it("pide más de las 50 de fábrica", () => {
    assert.match(seccion, /billing-summary\?limite=500/);
  });

  it("ofrece el ejercicio solo cuando hay más de uno", () => {
    assert.match(seccion, /ejercicios\.length > 1 &&/);
    assert.match(seccion, /Todos los años/);
  });

  it("cada factura descargable lleva su enlace al PDF", () => {
    assert.match(seccion, /sePuedeDescargar\(inv\) &&/);
    assert.match(seccion, /\/api\/billing\/invoices\/\$\{inv\.id\}\/pdf/);
  });

  it("dice cuántas hay y avisa si quedan más detrás", () => {
    assert.match(seccion, /de \$\{facturas\.length\} facturas/);
    assert.match(seccion, /data\.invoicesTruncadas/);
    assert.match(resumen, /invoicesTruncadas: invoices\.length >= tope/);
  });

  it("el endpoint acepta el límite y se lo pasa al resumen", () => {
    assert.match(endpoint, /searchParams\.get\("limite"\)/);
    assert.match(endpoint, /getClientBillingSummary\(\{ tenantModels, clientId: id, from, to, limite \}\)/);
  });

  it("el servidor ya no lleva el 50 escrito a pelo", () => {
    assert.ok(!/limit: 50,/.test(resumen), "el limit: 50 fijo sigue ahí");
    assert.match(resumen, /limit: tope,/);
  });

  it("el orden lleva desempate: con miles de facturas del mismo día hacía falta", () => {
    assert.match(resumen, /order: \[\["issueDate", "DESC"\], \["number", "DESC"\]\]/);
  });
});

describe("y la ficha del PACIENTE, que es lo que el aviso dice literalmente", () => {
  // «no se ven todas las facturas emitidas de ESE PACIENTE en ejercicios
  // anteriores»: la sección del paciente es otro componente y tenía el mismo
  // corte, así que arreglar solo la del cliente dejaba el aviso a medias.
  const paciente = lee("../components/billing/PatientBillingSection.jsx");

  it("pide más de 50 facturas", () => {
    assert.match(paciente, /patientId=\$\{patientId\}&limit=500/);
  });

  it("reutiliza el mismo reparto por ejercicio que la ficha del cliente", () => {
    assert.match(paciente, /from "@\/lib\/billing\/ejerciciosFactura\.js"/);
    assert.match(paciente, /const visibles = useMemo\(\(\) => facturasDelEjercicio\(invoices, ejercicio\)/);
    assert.match(paciente, /\{visibles\.map\(\(inv\) => \(/);
  });

  it("y cada factura descargable lleva su PDF", () => {
    assert.match(paciente, /sePuedeDescargar\(inv\) &&/);
    assert.match(paciente, /\/api\/billing\/invoices\/\$\{inv\.id\}\/pdf/);
  });
});
