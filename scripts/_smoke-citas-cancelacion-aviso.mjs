// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-citas-cancelacion-aviso.mjs — cuándo se calla el «tu cita ha sido
 * cancelada» (20/08/2026).
 *
 *   node scripts/_smoke-citas-cancelacion-aviso.mjs
 *   node --test-name-pattern="pasada" scripts/_smoke-citas-cancelacion-aviso.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * Este correo sale por DOS sitios: `lib/citas/notificarCancelacion.js` (enlace
 * del email, portal de la familia, baja de un cliente) y una copia entera
 * dentro del panel de la cita (`app/api/citas/bookings/[id]/route.js`), que es
 * la vía más usada del CRM. Los dos deciden callarse por las mismas tres
 * razones, y las tres estaban enterradas en un `try` que no devuelve nada: una
 * cita pasada, una reserva sin correo o una plantilla que deja de ser
 * transaccional se quedan mudas sin que ninguna prueba lo note.
 *
 * Lo que aquí se sujeta es la DECISIÓN, no el envío: `porQueNoSeAvisa` dice qué
 * puerta paró el correo. Que Resend conteste o no es otra historia y necesita
 * red.
 */

import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { porQueNoSeAvisa } from "../lib/citas/notificarCancelacion.js";
import { esCorreoTransaccional } from "../lib/clients/comunicaciones.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

const EN_UNA_HORA = () => new Date(Date.now() + 60 * 60 * 1000);
const HACE_UNA_HORA = () => new Date(Date.now() - 60 * 60 * 1000);

/** Cita falsa: solo los dos campos que la decisión mira. */
const cita = (extra = {}) => ({
  clientEmail: "familia@ejemplo.es",
  scheduledAt: EN_UNA_HORA(),
  ...extra,
});

describe("A quién se le avisa de que su cita queda cancelada", () => {
  it("a quien tiene una cita futura y dejó un correo, sí", () => {
    assert.equal(porQueNoSeAvisa(cita()), null);
  });

  it("a una reserva sin correo, no: no hay a quién escribir", () => {
    assert.equal(porQueNoSeAvisa(cita({ clientEmail: null })), "sin_correo");
    assert.equal(porQueNoSeAvisa(cita({ clientEmail: "" })), "sin_correo");
  });

  it("de una cita que ya se dio, no: limpiar historial no manda correos", () => {
    assert.equal(porQueNoSeAvisa(cita({ scheduledAt: HACE_UNA_HORA() })), "cita_pasada");
  });

  it("con una fecha que no se entiende, tampoco: en la duda, callarse", () => {
    assert.equal(porQueNoSeAvisa(cita({ scheduledAt: null })), "cita_pasada");
    assert.equal(porQueNoSeAvisa(cita({ scheduledAt: "el jueves" })), "cita_pasada");
    assert.equal(porQueNoSeAvisa({}), "sin_correo");
  });

  it("la falta de correo se mira ANTES que la fecha", () => {
    // Si el orden se invirtiera, el motivo del silencio mentiría en los logs de
    // una baja de cliente, donde llegan las dos cosas a la vez.
    assert.equal(
      porQueNoSeAvisa({ clientEmail: null, scheduledAt: HACE_UNA_HORA() }),
      "sin_correo"
    );
  });

  it("una fecha en formato ISO vale igual que un Date", () => {
    assert.equal(porQueNoSeAvisa(cita({ scheduledAt: EN_UNA_HORA().toISOString() })), null);
  });
});

describe("La tercera puerta: la lista de correos que no preguntan", () => {
  it("bookingCancelled sigue saliendo sin consultar las casillas de la familia", () => {
    // El día que salga de `CORREOS_TRANSACCIONALES`, este correo pasa a depender
    // del consentimiento y `porQueNoSeAvisa` devolverá "no_transaccional". Es
    // una decisión, no un descuido: tiene que costar un rojo aquí.
    assert.equal(esCorreoTransaccional("bookingCancelled"), true);
    assert.equal(porQueNoSeAvisa(cita()), null);
  });
});

/**
 * El correo está escrito dos veces (deuda conocida, ver la cabecera de
 * `lib/citas/notificarCancelacion.js`). Mientras siga así, lo que no puede
 * pasar es que UNO se calle y el OTRO no.
 *
 * Se comprueba sobre el texto porque eso es lo que se puede torcer: alguien
 * quita la comprobación de un fichero y la otra mitad de la casuística cambia
 * en silencio. Si algún día se unifican, el fichero del panel dejará de montar
 * la plantilla, saldrá de esta lista sola y la prueba seguirá verde.
 */
test("todo sitio que monte el correo de cancelación consulta antes la lista", () => {
  const sitios = [
    "lib/citas/notificarCancelacion.js",
    "app/api/citas/bookings/[id]/route.js",
  ];

  for (const relativo of sitios) {
    const texto = readFileSync(join(RAIZ, relativo), "utf8");
    if (!texto.includes("bookingCancelledTemplate(")) continue;
    assert.ok(
      texto.includes('esCorreoTransaccional("bookingCancelled")'),
      `${relativo} monta el correo de cancelación sin preguntar por CORREOS_TRANSACCIONALES`
    );
  }
});

/**
 * `porQueNoSeAvisa` es una función aparte, y una función aparte se puede dejar
 * de llamar. Sin esa línea, borrar el rastro de un cliente le escribiría a su
 * familia por citas de hace dos años.
 */
test("el envío pregunta por la decisión antes de montar el correo", () => {
  const texto = readFileSync(join(RAIZ, "lib/citas/notificarCancelacion.js"), "utf8");
  const desde = texto.indexOf("export async function emailCancelacionAlCliente");
  const hasta = texto.indexOf("bookingCancelledTemplate(", desde);
  assert.ok(desde !== -1 && hasta !== -1, "el envío ha cambiado de nombre o ya no monta la plantilla");
  assert.ok(
    texto.slice(desde, hasta).includes("porQueNoSeAvisa(booking)"),
    "emailCancelacionAlCliente monta el correo sin preguntar antes por porQueNoSeAvisa"
  );
});
