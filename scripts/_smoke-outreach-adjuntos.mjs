// @prueba ligera — funciones puras de /lib con dobles; sin base, sin servidor.
/**
 * _smoke-outreach-adjuntos.mjs — adjuntar Documentos al correo de Captación
 * (04/09/2026).
 *
 *   node scripts/_smoke-outreach-adjuntos.mjs
 *   node --test-name-pattern="privado" scripts/_smoke-outreach-adjuntos.mjs
 *
 * ── QUÉ FIJA Y POR QUÉ ─────────────────────────────────────────────────────
 *
 * El endpoint de enviar-correo acepta una lista de `documentIds` que llega del
 * navegador. Sin comprobar permisos, ese body sería una puerta trasera para
 * leerse el archivo entero del tenant: pides un id, y el documento te llega a
 * tu propio buzón como adjunto. La comprobación vive en
 * `lib/outreach/adjuntosDeDocumentos.js` y esta prueba fija que está y que no
 * se puede rodear.
 *
 * Los modelos y el disco se doblan a mano (sin dependencias): lo que se prueba
 * es la REGLA —a quién deja, qué topes aplica, qué mensaje da—, no Sequelize.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MAX_ADJUNTOS } from "../lib/correo/composicion.js";
import { adjuntosDesdeDocumentos } from "../lib/outreach/adjuntosDeDocumentos.js";

// El disco y las carpetas compartidas se inyectan (la función los admite como
// parámetro justo para esto): la prueba mide la REGLA, no Sequelize ni el fs.
const leerFichero = async (_slug, storagePath) => {
  if (storagePath === "NO_EXISTE") {
    const e = new Error("ENOENT");
    e.code = "ENOENT";
    throw e;
  }
  return {
    stream: (async function* () {
      yield Buffer.from("contenido de " + storagePath);
    })(),
  };
};
const carpetasCompartidas = async () => ({ todas: [] });

const YO = "11111111-1111-1111-1111-111111111111";
const OTRO = "22222222-2222-2222-2222-222222222222";
const ID_DOSSIER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ID_PRIVADO_AJENO = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ID_ENORME = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ID_SIN_FICHERO = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const CATALOGO = {
  [ID_DOSSIER]: {
    id: ID_DOSSIER, fileName: "Dossier Sanitario.pdf", mimeType: "application/pdf",
    fileSize: 700 * 1024, storagePath: "documents/x/shared/dossier.pdf",
    visibility: "shared", ownerUserId: OTRO, folderId: null,
  },
  [ID_PRIVADO_AJENO]: {
    id: ID_PRIVADO_AJENO, fileName: "Nóminas.pdf", mimeType: "application/pdf",
    fileSize: 1024, storagePath: "documents/x/otro/nominas.pdf",
    visibility: "private", ownerUserId: OTRO, folderId: null,
  },
  [ID_ENORME]: {
    id: ID_ENORME, fileName: "Vídeo.pdf", mimeType: "application/pdf",
    fileSize: 20 * 1024 * 1024, storagePath: "documents/x/shared/video.pdf",
    visibility: "shared", ownerUserId: YO, folderId: null,
  },
  [ID_SIN_FICHERO]: {
    id: ID_SIN_FICHERO, fileName: "Fantasma.pdf", mimeType: "application/pdf",
    fileSize: 2048, storagePath: "NO_EXISTE",
    visibility: "shared", ownerUserId: YO, folderId: null,
  },
};

const tenantModels = { Document: { findByPk: async (id) => CATALOGO[id] ?? null } };
const pedir = (documentIds, userId = YO) =>
  adjuntosDesdeDocumentos({
    tenantModels, tenantSlug: "demo", userId, documentIds, leerFichero, carpetasCompartidas,
  });

describe("lo que sí se adjunta", () => {
  test("un documento compartido sale con el formato del SDK de Resend", async () => {
    const r = await pedir([ID_DOSSIER]);
    assert.equal(r.error, undefined);
    assert.equal(r.adjuntos.length, 1);
    const a = r.adjuntos[0];
    assert.deepEqual(Object.keys(a).sort(), ["content", "contentType", "filename"]);
    assert.equal(a.filename, "Dossier Sanitario.pdf");
    assert.equal(a.contentType, "application/pdf");
    // `content` es base64, que es lo que espera Resend.
    assert.equal(Buffer.from(a.content, "base64").toString(), "contenido de documents/x/shared/dossier.pdf");
  });

  test("sin adjuntos no se inventa nada", async () => {
    for (const v of [null, undefined, []]) {
      const r = await pedir(v);
      assert.deepEqual(r.adjuntos, []);
    }
  });
});

describe("lo que NO se adjunta", () => {
  test("el privado de otro no se puede adjuntar aunque llegue su id", async () => {
    const r = await pedir([ID_PRIVADO_AJENO]);
    assert.match(r.error ?? "", /No tienes acceso/);
    assert.equal(r.adjuntos, undefined);
  });

  test("pero su dueño sí puede", async () => {
    const r = await pedir([ID_PRIVADO_AJENO], OTRO);
    assert.equal(r.error, undefined);
    assert.equal(r.adjuntos.length, 1);
  });

  test("un id que no existe no revienta, avisa", async () => {
    const r = await pedir(["99999999-9999-9999-9999-999999999999"]);
    assert.match(r.error ?? "", /ya no existe/);
  });

  test("un id que no es un uuid se rechaza antes de tocar la base", async () => {
    for (const malo of ["../../etc/passwd", "1 OR 1=1", "", null]) {
      const r = await pedir([malo]);
      assert.match(r.error ?? "", /identificador inválido/i, `no rechazó ${JSON.stringify(malo)}`);
    }
  });

  test("un fichero que pesa más del tope no sale", async () => {
    const r = await pedir([ID_ENORME]);
    assert.match(r.error ?? "", /pesa demasiado/);
  });

  test("una fila sin su fichero en disco lo dice claro, no da un 500", async () => {
    const r = await pedir([ID_SIN_FICHERO]);
    assert.match(r.error ?? "", /no aparece en el disco/);
  });

  test("más de MAX_ADJUNTOS se corta antes de leer nada", async () => {
    const r = await pedir(Array(MAX_ADJUNTOS + 1).fill(ID_DOSSIER));
    assert.match(r.error ?? "", /Como mucho/);
  });

  test("lo que no es una lista se rechaza", async () => {
    const r = await pedir("un-id-suelto");
    assert.match(r.error ?? "", /tiene que ser una lista/);
  });

  test("uno malo tumba el envío entero, no manda los buenos a medias", async () => {
    const r = await pedir([ID_DOSSIER, ID_PRIVADO_AJENO]);
    assert.match(r.error ?? "", /No tienes acceso/);
    assert.equal(r.adjuntos, undefined);
  });
});
