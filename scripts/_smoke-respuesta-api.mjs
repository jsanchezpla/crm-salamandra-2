/**
 * _smoke-respuesta-api.mjs — qué se lee cuando el que contesta no es el CRM.
 *
 * @prueba ligera
 *
 * Vigila la forma de equivocarse que motivó `lib/utils/respuestaApi.js`: que el
 * HTML de un error de nginx acabe delante del usuario tal cual, con el texto
 * del parser de JavaScript por delante. Es lo que vio Aumenta el 04/09/2026 al
 * subir un PDF durante un despliegue.
 *
 * La regla que no se puede romper: pase lo que pase, lo devuelto es un objeto
 * con `error` legible, porque las pantallas hacen `throw new Error(j.error)` sin
 * comprobar nada más.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { leerRespuestaApi, mensajeDeRespuestaNoJson } from "../lib/utils/respuestaApi.js";

/** Una respuesta de mentira, que es lo único que hace falta aquí. */
const respuesta = (status, cuerpo) =>
  new Response(cuerpo, { status, headers: { "Content-Type": "text/html" } });

// La página que devuelve nginx cuando la app no está escuchando: es
// literalmente lo que llegó al navegador de Isa.
const HTML_502 = "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n</body>\r\n</html>\r\n";
const HTML_413 = "<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n</html>\r\n";

describe("el caso de Aumenta: la app reiniciándose a mitad de la subida", () => {
  it("no deja escapar el «Unexpected token» del parser", async () => {
    const j = await leerRespuestaApi(respuesta(502, HTML_502));
    assert.equal(j.ok, false);
    assert.ok(!/Unexpected token|JSON/i.test(j.error), `el error sigue siendo técnico: ${j.error}`);
  });

  it("dice que se vuelva a intentar, que es lo que había que hacer", async () => {
    const j = await leerRespuestaApi(respuesta(502, HTML_502));
    assert.match(j.error, /vuelve a intentarlo/i);
  });

  it("y el 503 se cuenta igual: para el usuario es el mismo momento", async () => {
    const j = await leerRespuestaApi(respuesta(503, HTML_502));
    assert.match(j.error, /vuelve a intentarlo/i);
  });
});

describe("el archivo que nginx corta antes de que llegue al CRM", () => {
  it("habla del peso, no de un error de red", async () => {
    const j = await leerRespuestaApi(respuesta(413, HTML_413));
    assert.equal(j.ok, false);
    assert.match(j.error, /pesa demasiado/i);
  });

  it("cada pantalla puede explicar su propio límite", async () => {
    const j = await leerRespuestaApi(respuesta(413, HTML_413), {
      siGrande: "El tope son 10 MB por captura.",
    });
    assert.equal(j.error, "El tope son 10 MB por captura.");
  });
});

describe("lo que responde el CRM de verdad pasa intacto", () => {
  it("un error suyo se respeta: sabe más que nosotros de lo que ha fallado", async () => {
    const r = new Response(JSON.stringify({ ok: false, error: "Cuota de almacenamiento superada" }), { status: 507 });
    assert.equal((await leerRespuestaApi(r)).error, "Cuota de almacenamiento superada");
  });

  it("un 201 con datos llega con sus datos", async () => {
    const r = new Response(JSON.stringify({ ok: true, data: { id: "abc" } }), { status: 201 });
    const j = await leerRespuestaApi(r);
    assert.equal(j.ok, true);
    assert.equal(j.data.id, "abc");
  });
});

describe("los cuerpos raros no rompen a quien lee `.error`", () => {
  it("un 204 sin cuerpo no es un fallo", async () => {
    const j = await leerRespuestaApi(new Response(null, { status: 204 }));
    assert.equal(j.ok, true);
  });

  it("un 500 sin cuerpo sí lo es, y se explica", async () => {
    const j = await leerRespuestaApi(new Response("", { status: 500 }));
    assert.equal(j.ok, false);
    assert.match(j.error, /error 500/);
  });

  it("un `null` por JSON no se convierte en «no se puede leer .error de null»", async () => {
    const j = await leerRespuestaApi(new Response("null", { status: 200 }));
    assert.equal(typeof j, "object");
    assert.equal(j.error, undefined);
  });

  it("una lista tampoco: viaja dentro de `data`", async () => {
    const j = await leerRespuestaApi(new Response("[1,2]", { status: 200 }));
    assert.deepEqual(j.data, [1, 2]);
  });
});

describe("mensajeDeRespuestaNoJson por sí solo", () => {
  it("el 504 habla de tiempo, no de una caída", () => {
    assert.match(mensajeDeRespuestaNoJson(504), /tardado demasiado/i);
  });

  it("la sesión caducada manda a entrar otra vez", () => {
    assert.match(mensajeDeRespuestaNoJson(401), /vuelve a entrar/i);
  });

  it("cualquier otro código dice cuál es, para poder buscarlo en el log", () => {
    assert.match(mensajeDeRespuestaNoJson(418), /418/);
  });
});
