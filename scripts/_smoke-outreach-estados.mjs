// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-outreach-estados.mjs — el estado de un lead de Captación (04/09/2026).
 *
 *   node scripts/_smoke-outreach-estados.mjs
 *   node --test-name-pattern="descarte" scripts/_smoke-outreach-estados.mjs
 *
 * ── QUÉ FIJA ───────────────────────────────────────────────────────────────
 *
 * `OutreachLead.status` es STRING en BD, no ENUM (igual que `source`), así que
 * la única red que impide que entre un valor cualquiera desde el front es la
 * lista blanca de `lib/outreach/estados.js`, que usan el PATCH de la ficha y el
 * filtro del listado. Esta prueba fija esa lista y la regla que más fácil se
 * rompe al tocar la UI: **ser cliente manda sobre el estado**.
 *
 * Un lead convertido conserva su `status` en BD (queda el rastro de que se le
 * contactó antes de cerrarlo), pero en pantalla tiene que poner «Cliente». Si
 * alguien lee `LEAD_STATUS_LABELS[lead.status]` a pelo en un sitio nuevo, esa
 * ficha dirá «Contactado» de alguien que ya es cliente.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  DEFAULT_LEAD_STATUS,
  isAllowedLeadStatus,
  leadStatusLabel,
} from "../lib/outreach/estados.js";

describe("lista blanca de estados", () => {
  test("son exactamente los tres que entiende la UI", () => {
    assert.deepEqual(LEAD_STATUSES, ["new", "contacted", "discarded"]);
  });

  test("el estado por defecto está en la lista y es el de la columna en BD", () => {
    assert.equal(DEFAULT_LEAD_STATUS, "new");
    assert.ok(LEAD_STATUSES.includes(DEFAULT_LEAD_STATUS));
  });

  test("todos tienen etiqueta humana", () => {
    for (const s of LEAD_STATUSES) {
      assert.equal(typeof LEAD_STATUS_LABELS[s], "string");
      assert.ok(LEAD_STATUS_LABELS[s].length > 0, `${s} sin etiqueta`);
    }
  });
});

describe("isAllowedLeadStatus", () => {
  test("acepta los de la lista", () => {
    for (const s of LEAD_STATUSES) assert.equal(isAllowedLeadStatus(s), true);
  });

  test("rechaza cualquier otra cosa que pueda llegar del front", () => {
    for (const v of ["", "Contactado", "CONTACTED", "borrado", null, undefined, 3, {}, ["new"]]) {
      assert.equal(isAllowedLeadStatus(v), false, `no debería aceptar ${JSON.stringify(v)}`);
    }
  });
});

describe("leadStatusLabel", () => {
  test("ser cliente manda sobre el estado guardado", () => {
    assert.equal(leadStatusLabel({ status: "contacted", converted: true }), "Cliente");
    assert.equal(leadStatusLabel({ status: "discarded", converted: true }), "Cliente");
  });

  test("un lead normal muestra su estado", () => {
    assert.equal(leadStatusLabel({ status: "contacted", converted: false }), "Contactado");
    assert.equal(leadStatusLabel({ status: "discarded", converted: false }), "Descartado");
  });

  test("sin estado (fila vieja, antes de la migración) cae en el por defecto", () => {
    assert.equal(leadStatusLabel({}), LEAD_STATUS_LABELS.new);
    assert.equal(leadStatusLabel({ status: null }), LEAD_STATUS_LABELS.new);
    assert.equal(leadStatusLabel(undefined), LEAD_STATUS_LABELS.new);
  });

  test("un estado corrupto en BD no rompe la ficha", () => {
    assert.equal(leadStatusLabel({ status: "loquesea" }), LEAD_STATUS_LABELS.new);
  });
});
