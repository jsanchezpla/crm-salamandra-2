// @prueba ligera — función pura de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-poda-demos.mjs — qué tenants poda a 7 días `podar-audit-logs.js` (14/09/2026).
 *
 *   node scripts/_smoke-poda-demos.mjs
 *
 * La poda tenía `('demo', 'demo_golden')` escrito a mano y las demos por oficio
 * se guardaban 3 años como un cliente real. Ahora lee `slugsDemoParaPoda()` de
 * `lib/demo/demos.js`: esta prueba fija que salen todas las demos y que NO sale
 * ningún cliente real (un cliente real en esta lista perdería su auditoría).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEMO_SLUGS, slugsDemoParaPoda } from "../lib/demo/demos.js";

describe("slugsDemoParaPoda", () => {
  const slugs = slugsDemoParaPoda();

  it("incluye la demo general y las tres por oficio", () => {
    for (const s of ["demo", "demo_clinica", "demo_nutricion", "demo_agencia"]) {
      assert.ok(slugs.includes(s), `falta ${s}`);
    }
  });

  it("incluye la copia dorada de cada demo", () => {
    for (const s of DEMO_SLUGS) assert.ok(slugs.includes(`${s}_golden`), `falta ${s}_golden`);
  });

  it("no incluye clientes reales ni a nosotros", () => {
    for (const s of ["aumenta", "nutri_laura", "retorika", "spain_enzymes", "somos", "laura_ubeda", "salamandra_solutions"]) {
      assert.ok(!slugs.includes(s), `${s} no es demo`);
    }
  });

  it("todo lo que devuelve es una demo o su _golden", () => {
    for (const s of slugs) {
      assert.ok(DEMO_SLUGS.includes(s.replace(/_golden$/, "")), `${s} no viene de DEMOS`);
    }
  });
});
