// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-portal-user-alta.mjs — el alta en WordPress cuando la web TARDA
 * (03/09/2026, AV-0031 de tunutrilaura).
 *
 *   node scripts/_smoke-portal-user-alta.mjs
 *
 * Fija lo que costó un aviso de Laura: si WordPress no contesta a tiempo pero
 * la cuenta aparece al volver a preguntar, el alta es un alta (ok:true), no
 * «Acceso a la web NO creado». Y si al volver a preguntar tampoco está, se
 * sigue avisando y diciendo dónde reintentar. `fetch` se falsea: la primera
 * llamada (el alta) se corta como si el reloj hubiera saltado; la segunda (la
 * consulta `existe`) contesta lo que diga cada caso.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.WIDGET_SSO_SECRETS = JSON.stringify({ prueba: "a".repeat(64) });
const { crearUsuarioPortal } = await import("../lib/formularios/portalUser.js");

function fetchFalso({ existe }) {
  const llamadas = [];
  return {
    llamadas,
    fetch: async (url) => {
      llamadas.push(String(url));
      if (String(url).endsWith("/portal-user")) {
        const e = new Error("The operation was aborted");
        e.name = "AbortError";
        throw e;
      }
      return { ok: true, status: 200, json: async () => ({ existe }) };
    },
  };
}

const base = { tenantSlug: "prueba", wordpressUrl: "https://web.prueba/", email: "ana@prueba.es", nombre: "Ana" };

describe("alta en WordPress cuando la web tarda", () => {
  it("si al volver a preguntar la cuenta está, es un alta normal (ok:true)", async () => {
    const f = fetchFalso({ existe: true });
    globalThis.fetch = f.fetch;
    const r = await crearUsuarioPortal(base);
    assert.equal(r.ok, true);
    assert.equal(r.creado, true);
    assert.equal(r.tardo, true);
    assert.match(r.mensaje, /cuenta está creada/);
    assert.deepEqual(f.llamadas, [
      "https://web.prueba/wp-json/crm/v1/portal-user",
      "https://web.prueba/wp-json/crm/v1/portal-user/existe",
    ]);
  });

  it("si tampoco está, se avisa y se dice dónde reintentar", async () => {
    const f = fetchFalso({ existe: false });
    globalThis.fetch = f.fetch;
    const r = await crearUsuarioPortal(base);
    assert.equal(r.ok, false);
    assert.equal(r.motivo, "timeout");
    assert.match(r.mensaje, /Acceso a la web/);
    assert.equal(f.llamadas.length, 2);
  });

  it("un error de red no vuelve a preguntar: se cuenta tal cual", async () => {
    let n = 0;
    globalThis.fetch = async () => { n++; throw new Error("ECONNREFUSED"); };
    const r = await crearUsuarioPortal(base);
    assert.equal(r.ok, false);
    assert.equal(r.motivo, "red");
    assert.equal(n, 1);
  });
});
