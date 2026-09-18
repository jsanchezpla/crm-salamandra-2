// @prueba ligera — funciones puras de /lib y una regex sobre el endpoint.
/**
 * _smoke-borrar-diagnostico.mjs — qué expediente de diagnóstico se puede borrar
 * y quién puede hacerlo (18/09/2026, AV-0202 de Aumenta; decidido por Rodrigo).
 *
 *   node scripts/_smoke-borrar-diagnostico.mjs
 *
 * Isabel: «¿y cómo borro o elimino si lo hago mal?». No había forma: la API
 * tenía cerrar, parar, seguir y unir, y «parar» significa otra cosa —que la
 * familia decidió no continuar—.
 *
 * Lo que se fija aquí es la frontera, que es lo único delicado: se borra lo que
 * todavía no ha salido de sí mismo. En cuanto hay un bono, un cobro o un
 * informe, el expediente ya es el rastro de algo que ocurrió y no se borra por
 * la puerta de atrás.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { puedeBorrarDiagnostico, motivoParaNoBorrarDiagnostico } from "../lib/clinica/alcanceDiagnostico.js";

const YO = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";
const RECIEN = { therapistId: YO };

describe("qué expediente se puede borrar", () => {
  it("uno recién abierto, sí", () => {
    assert.equal(puedeBorrarDiagnostico({ puedeDecidir: true, fila: RECIEN, teamMemberId: null }), true);
  });

  it("con BONO no, y se dice que lo cierre", () => {
    const m = motivoParaNoBorrarDiagnostico({ puedeDecidir: true, fila: { ...RECIEN, packId: "b1" }, teamMemberId: YO });
    assert.match(m, /bono/i);
    assert.match(m, /ci[eé]rralo/i, "hay que decirle qué hacer en su lugar");
  });

  it("con COBRO no, y se le manda a Facturación", () => {
    const m = motivoParaNoBorrarDiagnostico({ puedeDecidir: true, fila: { ...RECIEN, entrevistaPaymentId: "c1" }, teamMemberId: YO });
    assert.match(m, /cobro/i);
    assert.match(m, /factura/i);
  });

  it("con INFORME no", () => {
    const m = motivoParaNoBorrarDiagnostico({ puedeDecidir: true, fila: { ...RECIEN, informeId: "i1" }, teamMemberId: YO });
    assert.match(m, /informe/i);
  });

  it("y el que no existe se dice tal cual", () => {
    assert.match(motivoParaNoBorrarDiagnostico({ puedeDecidir: true, fila: null, teamMemberId: YO }), /no existe/i);
  });
});

describe("quién puede borrarlo", () => {
  it("dirección, y su terapeuta", () => {
    assert.equal(puedeBorrarDiagnostico({ puedeDecidir: true, fila: RECIEN, teamMemberId: OTRA }), true);
    assert.equal(puedeBorrarDiagnostico({ puedeDecidir: false, fila: RECIEN, teamMemberId: YO }), true);
  });

  it("otra terapeuta no, y sin ficha de equipo tampoco", () => {
    assert.equal(puedeBorrarDiagnostico({ puedeDecidir: false, fila: RECIEN, teamMemberId: OTRA }), false);
    assert.equal(puedeBorrarDiagnostico({ puedeDecidir: false, fila: RECIEN, teamMemberId: null }), false);
  });

  it("a la terapeuta que intenta borrar uno con bono se le dice lo del BONO, no «no puedes»", () => {
    // Si se contestara «no tienes permiso», iría a buscar a dirección para que
    // tampoco pudiera. El orden de los motivos importa.
    const m = motivoParaNoBorrarDiagnostico({ puedeDecidir: false, fila: { therapistId: OTRA, packId: "b1" }, teamMemberId: YO });
    assert.match(m, /bono/i);
  });
});

describe("el endpoint", () => {
  const src = readFileSync(new URL("../app/api/clinica/diagnosticos/[id]/route.js", import.meta.url), "utf8");

  it("existe el DELETE y pasa por la regla", () => {
    assert.match(src, /export const DELETE = withTenant/);
    assert.match(src, /motivoParaNoBorrarDiagnostico\(/);
  });

  it("los registros de sesión se SUELTAN, no se borran", () => {
    // Lo clínico no se borra nunca: es la mitad del valor de esta tarea.
    assert.match(src, /ClinicSession\.update\(\s*\{ diagnosticoId: null \}/);
    assert.doesNotMatch(src, /ClinicSession\.destroy/);
  });

  it("y queda auditado", () => {
    assert.match(src, /action: "diagnostico\.borrado"/);
  });
});
