// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-coordinaciones-alcance.mjs — quién puede corregir un acta de
 * coordinación (18/09/2026, AV-0102 de Aumenta).
 *
 *   node scripts/_smoke-coordinaciones-alcance.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * «Cuando registras una coordinación no tienes opción a modificarla» (Silvia,
 * 18/09/2026). Al abrir el PATCH había que decidir quién puede tocar un acta, y
 * esa decisión no puede vivir suelta dentro del endpoint: la necesitan también
 * las dos pantallas, que enseñan el botón «Editar» solo a quien puede.
 *
 * Lo que fija esta prueba es lo que DEVUELVEN las funciones, no cómo están
 * escritas: dirección siempre, quien firma el acta también, y un acta sin ficha
 * de equipo detrás —las 171 de Aumenta traídas de Organízate— solo dirección.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  esDireccion,
  puedeEditarCoordinacion,
  motivoParaNoEditar,
} from "../lib/clinica/alcanceCoordinaciones.js";

const YO = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";

describe("esDireccion", () => {
  it("admin y superadmin mandan", () => {
    assert.equal(esDireccion("admin"), true);
    assert.equal(esDireccion("superadmin"), true);
  });

  it("todo lo demás, no — incluido lo vacío", () => {
    for (const r of ["user", "viewer", "", null, undefined, "ADMIN"]) {
      assert.equal(esDireccion(r), false, `${r} no debería mandar`);
    }
  });
});

describe("puedeEditarCoordinacion", () => {
  it("dirección corrige cualquier acta, también las que no firma nadie", () => {
    assert.equal(puedeEditarCoordinacion({ esAdmin: true, row: { createdById: OTRA }, teamMemberId: null }), true);
    assert.equal(puedeEditarCoordinacion({ esAdmin: true, row: { createdById: null }, teamMemberId: null }), true);
  });

  it("quien la registró corrige la suya", () => {
    assert.equal(puedeEditarCoordinacion({ esAdmin: false, row: { createdById: YO }, teamMemberId: YO }), true);
  });

  it("nadie del equipo corrige el acta de otra persona", () => {
    assert.equal(puedeEditarCoordinacion({ esAdmin: false, row: { createdById: OTRA }, teamMemberId: YO }), false);
  });

  it("un acta sin ficha de equipo detrás no la toca el equipo", () => {
    // Las 171 importadas de Organízate que firma gente que ya no está: no hay
    // autoría que reconocer, y quien mira no estuvo en esa reunión.
    assert.equal(puedeEditarCoordinacion({ esAdmin: false, row: { createdById: null }, teamMemberId: YO }), false);
  });

  it("sin ficha de equipo propia no se corrige nada", () => {
    assert.equal(puedeEditarCoordinacion({ esAdmin: false, row: { createdById: YO }, teamMemberId: null }), false);
  });

  it("un acta que no existe no se corrige, ni siendo dirección", () => {
    assert.equal(puedeEditarCoordinacion({ esAdmin: true, row: null, teamMemberId: YO }), false);
  });

  it("compara por texto: un id no es menos suyo por venir como objeto de Sequelize", () => {
    assert.equal(
      puedeEditarCoordinacion({ esAdmin: false, row: { createdById: { toString: () => YO } }, teamMemberId: YO }),
      true
    );
  });
});

describe("motivoParaNoEditar", () => {
  it("quien puede no recibe motivo", () => {
    assert.equal(motivoParaNoEditar({ esAdmin: true, row: { createdById: OTRA }, teamMemberId: null }), null);
    assert.equal(motivoParaNoEditar({ esAdmin: false, row: { createdById: YO }, teamMemberId: YO }), null);
  });

  it("el acta de otra persona lo dice con sus palabras", () => {
    assert.match(
      motivoParaNoEditar({ esAdmin: false, row: { createdById: OTRA }, teamMemberId: YO }),
      /dirección|registró/i
    );
  });

  it("el acta sin firma dice justo eso, y no «no eres tú»", () => {
    assert.match(
      motivoParaNoEditar({ esAdmin: false, row: { createdById: null }, teamMemberId: YO }),
      /no está firmada/i
    );
  });
});
