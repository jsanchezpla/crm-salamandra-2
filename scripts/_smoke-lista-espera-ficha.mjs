// @prueba ligera
// Una ficha que ya existe entra y sale de la lista de espera (15/09/2026, AV-0133 de Aumenta).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ruta = leer("app/api/clients/waitlist/route.js");
const ficha = leer("modules/default/ClientDetailModule.jsx");

test("el POST acepta una ficha existente y la enlaza con la misma función que el alta", () => {
  assert.match(ruta, /body\?\.clientId !== undefined/);
  assert.match(ruta, /entrarEnListaEspera\(\{ WaitlistEntry, client: cliente/);
});

test("no la mete dos veces: si ya está esperando, 409", () => {
  assert.match(ruta, /entradaDeCliente\(WaitlistEntry, clientId\)\) return error\([^)]*409\)/);
});

test("la ficha ofrece pasarla y sacarla, solo con clients_avanzado", () => {
  assert.match(ficha, /modulos\.includes\("clients_avanzado"\)/);
  assert.match(ficha, /Pasar a lista de espera/);
  assert.match(ficha, /Sacar de la lista de espera/);
  // Sacar es «removed», nunca borrar la entrada: la historia de la cola se conserva.
  assert.match(ficha, /JSON\.stringify\(\{ status: "removed" \}\)/);
});
