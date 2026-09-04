// @prueba ligera
/**
 * _smoke-fichaje-acceso.mjs — quién entra en el control horario (04/09/2026).
 *
 * Fija `lib/fichaje/acceso.js`, que es la MISMA regla que aplican las tres
 * puertas del módulo (menú, página y endpoints). Lo que se prueba es la
 * decisión, no cómo está escrita: si mañana se reescribe con otra forma pero
 * sigue diciendo lo mismo, esta prueba pasa.
 *
 * Importa: aquí se cambió una regla de seguridad. Antes hacía falta ser
 * administrador; ahora basta con tener el módulo concedido. La prueba deja
 * clavado lo que NO puede pasar por ese cambio — que se cuele quien no lo
 * tiene, y que un `module_access` roto conceda en vez de negar.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { puedeUsarFichaje } from "../lib/fichaje/acceso.js";

test("el tenant que no ha contratado Fichaje no abre para nadie", () => {
  assert.equal(
    puedeUsarFichaje({ role: "admin", moduleAccess: ["all"], tenantLoTiene: false }),
    false,
  );
  // Ni el comodín de soporte: no se inventa un módulo que el cliente no tiene.
  assert.equal(
    puedeUsarFichaje({ role: "superadmin", moduleAccess: ["all"], tenantLoTiene: false }),
    false,
  );
});

test("con el módulo concedido entra aunque no sea administradora", () => {
  // El caso de Olga: rol `user`, recepción, lleva el control horario.
  assert.equal(
    puedeUsarFichaje({
      role: "user",
      moduleAccess: ["billing", "citas", "clients", "fichaje", "pacientes"],
      tenantLoTiene: true,
    }),
    true,
  );
});

test("sin el módulo concedido NO entra, aunque el tenant lo tenga", () => {
  // Las doce terapeutas de Aumenta: mismo tenant, mismo rol, sin `fichaje`.
  assert.equal(
    puedeUsarFichaje({
      role: "user",
      moduleAccess: ["calendar", "citas", "clinica", "pacientes", "team_avanzado"],
      tenantLoTiene: true,
    }),
    false,
  );
});

test("los administradores siguen entrando por su comodín", () => {
  assert.equal(
    puedeUsarFichaje({ role: "admin", moduleAccess: ["all", "citas"], tenantLoTiene: true }),
    true,
  );
  assert.equal(
    puedeUsarFichaje({ role: "superadmin", moduleAccess: [], tenantLoTiene: true }),
    true,
  );
});

test("un module_access que no es lista NIEGA, nunca concede", () => {
  // La regla de `loadUserAccess`: un error no puede dar MÁS acceso. Un usuario
  // a medio migrar, con el campo nulo o corrupto, se queda fuera.
  for (const roto of [null, undefined, "fichaje", { fichaje: true }, 0]) {
    assert.equal(
      puedeUsarFichaje({ role: "user", moduleAccess: roto, tenantLoTiene: true }),
      false,
      `moduleAccess = ${JSON.stringify(roto)} no debería conceder nada`,
    );
  }
  // Y sin argumentos tampoco revienta: dice que no.
  assert.equal(puedeUsarFichaje(), false);
});

test("«fichaje» tiene que ser la clave exacta, no un parecido", () => {
  assert.equal(
    puedeUsarFichaje({ role: "user", moduleAccess: ["fichajes"], tenantLoTiene: true }),
    false,
  );
});
