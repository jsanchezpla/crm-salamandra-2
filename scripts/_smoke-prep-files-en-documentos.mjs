// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-prep-files-en-documentos.mjs — los adjuntos de preparación de una
 * sesión entran en el archivo central (02/09/2026, AV-0027 de Aumenta: «que
 * los documentos que vayamos subiendo respecto a las sesiones salgan también
 * en Documentos, para una búsqueda más rápida»).
 *
 *   node scripts/_smoke-prep-files-en-documentos.mjs
 *
 * Fija la fila que se crea (`documentoDePrepFile`): compartida con el equipo,
 * NUNCA visible para la familia, con su paciente, su familia y su sesión; y que
 * se reconoce por su `source` para que no se borre desde el archivo.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SOURCE_PREPARACION,
  documentoDePrepFile,
  esAdjuntoDePreparacion,
  nuevoPrepFile,
} from "../lib/clinica/prepFiles.js";

const SESION = { id: "s1", clientId: "c1", patientId: "p1", sessionDate: "2026-09-02" };
const ADJUNTO = {
  id: "f1",
  name: "ficha-ejercicio.pdf",
  storagePath: "documents/aumenta/shared/f1.pdf",
  mimeType: "application/pdf",
  size: 1234,
};

describe("documentoDePrepFile", () => {
  it("la fila: compartida con el equipo, nunca para la familia, con paciente, familia y sesión", () => {
    assert.deepEqual(documentoDePrepFile({ sesion: SESION, adjunto: ADJUNTO, ownerUserId: "u1" }), {
      folderId: null,
      visibility: "shared",
      ownerUserId: "u1",
      documentDate: "2026-09-02",
      fileName: "ficha-ejercicio.pdf",
      storagePath: "documents/aumenta/shared/f1.pdf",
      fileSize: 1234,
      mimeType: "application/pdf",
      clientId: "c1",
      patientId: "p1",
      clinicSessionId: "s1",
      source: SOURCE_PREPARACION,
      clientVisible: false,
      uploadedByClient: false,
    });
  });

  it("sin dueño, sin tipo y con la fecha como Date no revienta: el día sale en hora de Madrid", () => {
    const fila = documentoDePrepFile({
      sesion: { id: "s2", sessionDate: new Date("2026-09-02T22:30:00.000Z") },
      adjunto: { storagePath: "x", size: "9" },
    });
    assert.equal(fila.documentDate, "2026-09-03");
    assert.equal(fila.ownerUserId, null);
    assert.equal(fila.mimeType, "application/octet-stream");
    assert.equal(fila.fileSize, 9);
    assert.equal(fila.fileName, "adjunto");
    assert.equal(fila.clientId, null);
    assert.equal(fila.patientId, null);
    assert.equal(documentoDePrepFile({ sesion: { id: "s3" }, adjunto: { storagePath: "y" } }).documentDate, null);
    assert.equal(documentoDePrepFile({ sesion: { id: "s3", sessionDate: "no es fecha" }, adjunto: { storagePath: "y" } }).documentDate, null);
  });

  it("lo que guarda la sesión (nuevoPrepFile) lleva todo lo que la fila necesita", () => {
    const f = nuevoPrepFile({ name: "a.png", storagePath: "p", mimeType: "image/png", size: 10, uploadedBy: "x@y.es" });
    const fila = documentoDePrepFile({ sesion: SESION, adjunto: f });
    assert.equal(fila.fileName, "a.png");
    assert.equal(fila.storagePath, "p");
    assert.equal(fila.mimeType, "image/png");
    assert.equal(fila.fileSize, 10);
  });
});

describe("esAdjuntoDePreparacion", () => {
  it("se reconoce por su source, y nada más cuenta: ni el registro enviado a la familia ni un documento normal", () => {
    assert.equal(esAdjuntoDePreparacion({ source: SOURCE_PREPARACION }), true);
    assert.equal(esAdjuntoDePreparacion({ source: "sesion" }), false);
    assert.equal(esAdjuntoDePreparacion({ source: "manual" }), false);
    assert.equal(esAdjuntoDePreparacion(null), false);
    // `documents.source` es VARCHAR(40).
    assert.ok(SOURCE_PREPARACION.length <= 40);
  });
});
