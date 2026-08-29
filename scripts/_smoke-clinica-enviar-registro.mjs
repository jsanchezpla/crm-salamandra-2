// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-clinica-enviar-registro.mjs — enviar UN registro de sesión al área
 * privada de la familia (29/08/2026, Rodrigo, para Aumenta).
 *
 *   node scripts/_smoke-clinica-enviar-registro.mjs
 *
 * ── QUÉ SE FIJA Y POR QUÉ ──────────────────────────────────────────────────
 *
 * El encargo tenía dos frases: «que se puedan subir los registros por separado»
 * y «siempre que se suba algo se tiene que subir simplemente el PDF». La
 * segunda tiene dos mitades, y esta prueba cubre la de aquí:
 *
 *   · **Qué fila se crea en `documents`.** Un `application/pdf` con
 *     `client_visible`, colgado del paciente Y de su pagador. Sin
 *     `client_visible` el documento se crea, la pantalla dice «enviado» y la
 *     familia no ve nada: el fallo más caro posible, porque parece que funciona.
 *   · **Sin pagador no se envía.** El portal filtra por cliente, así que un
 *     documento colgado de un paciente huérfano no lo vería nadie.
 *
 * La otra mitad —que el PDF no lleve la preparación, las notas internas ni la
 * transcripción— **ya está cubierta** en `_smoke-plantillas-clinica.mjs`
 * («NUNCA lleva la preparación, las notas internas ni la transcripción»), que
 * genera el PDF de verdad y lo lee por dentro con su lector. Se envía EL MISMO
 * buffer que sale de ahí (`buildSessionPdfBuffer`, el de «Ver PDF»), así que
 * repetirlo aquí sería una copia del lector de PDF y una cobertura falsa el día
 * que la copia se quedara atrás.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { documentoDeRegistro, motivoParaNoEnviar, SOURCE_REGISTRO } from "../lib/clinica/envioRegistro.js";
import { sessionPdfFilename } from "../lib/clinica/sessionPdf.js";

const PACIENTE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PAGADOR = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const doc = (extra = {}) =>
  documentoDeRegistro({
    documentId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    fileName: "Registro de sesión - Juan Giménez - 2026-03-03.pdf",
    storagePath: "shared/cccccccc.pdf",
    fileSize: 1234,
    patientId: PACIENTE,
    clientId: PAGADOR,
    ownerUserId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    ...extra,
  });

/* ═══ 1 · Qué se sube ══════════════════════════════════════════════════════ */

describe("lo que se sube es el PDF y nada más", () => {
  it("es un application/pdf, nunca otra cosa", () => {
    assert.equal(doc().mimeType, "application/pdf");
  });

  it("nace VISIBLE para la familia — sin esto se envía a un cajón que nadie abre", () => {
    assert.equal(doc().clientVisible, true);
  });

  it("cuelga del paciente Y de su pagador: el portal filtra por cliente", () => {
    assert.equal(doc().patientId, PACIENTE);
    assert.equal(doc().clientId, PAGADOR);
  });

  it("se marca como registro (`sesion`) para distinguirlo del resto del archivo", () => {
    assert.equal(doc().source, SOURCE_REGISTRO);
    assert.equal(SOURCE_REGISTRO, "sesion");
  });

  it("va al archivo compartido y sin carpeta: no se esconde en la de nadie", () => {
    assert.equal(doc().visibility, "shared");
    assert.equal(doc().folderId, null);
  });

  it("sin usuario que lo suba (una automatización) sigue siendo válido", () => {
    assert.equal(documentoDeRegistro({ documentId: "x", clientId: PAGADOR }).ownerUserId, null);
  });

  /* La lista es la promesa: si mañana alguien añade una clave aquí —el texto de
     la sesión, una nota, lo que sea— esta prueba lo cuenta antes de que salga
     del CRM. «Simplemente el PDF» son doce campos y ninguno más. */
  it("no se cuela ningún campo de más en la fila de documents", () => {
    assert.deepEqual(
      Object.keys(doc()).sort(),
      [
        "clientId", "clientVisible", "fileName", "fileSize", "folderId", "id",
        "mimeType", "ownerUserId", "patientId", "source", "storagePath", "visibility",
      ]
    );
  });

  it("el nombre del fichero dice qué es, de quién y de cuándo", () => {
    assert.equal(
      sessionPdfFilename({ sessionDate: "2026-03-03T10:00:00.000Z" }, "Juan Giménez"),
      "Registro de sesión - Juan Giménez - 2026-03-03.pdf"
    );
  });
});

/* ═══ 2 · Sin pagador no se envía ══════════════════════════════════════════ */

describe("sin cliente pagador no se envía, y se dice por qué", () => {
  it("sin clientId devuelve el motivo, no null", () => {
    const motivo = motivoParaNoEnviar({ clientId: null });
    assert.ok(motivo, "tendría que haber motivo");
    assert.match(motivo, /pagador/i);
    assert.match(motivo, /ficha/i, "el mensaje tiene que decir dónde se arregla");
  });

  it("con clientId no hay motivo: adelante", () => {
    assert.equal(motivoParaNoEnviar({ clientId: PAGADOR }), null);
  });

  it("sin argumentos tampoco pasa (un fallo del que llama no puede abrir la puerta)", () => {
    assert.ok(motivoParaNoEnviar());
    assert.ok(motivoParaNoEnviar({}));
  });
});
