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
 * Este correo salía por DOS sitios: `lib/citas/notificarCancelacion.js` (enlace
 * del email, portal de la familia, baja de un cliente) y una copia entera
 * dentro del panel de la cita (`app/api/citas/bookings/[id]/route.js`), que es
 * la vía más usada del CRM. Los dos decidían callarse por las mismas tres
 * razones, y las tres estaban enterradas en un `try` que no devuelve nada: una
 * cita pasada, una reserva sin correo o una plantilla que deja de ser
 * transaccional se quedan mudas sin que ninguna prueba lo note. (Las dos copias
 * se fundieron en una el 21/08/2026; la decisión, en la cabecera de la lib.)
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
import { bookingCancelledTemplate } from "../lib/email/templates/citas/bookingCancelled.js";

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
 * Desde el 21/08/2026 el correo se escribe UNA vez, en la lib. El panel sigue
 * en la lista a propósito: es donde estuvo la copia, y es donde volvería a
 * aparecer la próxima. Quien monte la plantilla en cualquiera de estos
 * ficheros tiene que preguntar antes por la lista de transaccionales; el que no
 * la monta —hoy, el panel— sale solo del bucle y la prueba sigue verde.
 *
 * Se comprueba sobre el texto porque eso es lo que se puede torcer: alguien
 * quita la comprobación de un fichero y media casuística cambia en silencio.
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
 * Lo que se decidió el 20/08/2026: el panel no manda su propio correo, llama al
 * de la lib. Es lo que hace que una cancelación desde el panel lleve el párrafo
 * del bono («tu programa sigue activo») y deje la etiqueta `citas:cancelada` en
 * el log, como los demás caminos.
 *
 * No comprueba el estilo del código, sino que el panel siga DELEGANDO: quien
 * vuelva a escribir el envío ahí dentro rompe las dos cosas a la vez y no se
 * notaría hasta que una familia con bono se quedara sin ese párrafo.
 */
describe("El panel de la cita no tiene correo propio de cancelación", () => {
  const PANEL = readFileSync(join(RAIZ, "app/api/citas/bookings/[id]/route.js"), "utf8");

  it("no monta la plantilla: la manda la lib", () => {
    assert.ok(!PANEL.includes("bookingCancelledTemplate("));
  });

  it("la importa de la lib y la llama por las dos vías que cancelan", () => {
    assert.ok(
      /import \{[^}]*emailCancelacionAlCliente[^}]*\} from ".*notificarCancelacion\.js"/.test(PANEL),
      "el panel ya no importa el envío de la lib"
    );
    // Las dos: PATCH con status → cancelled, y DELETE sin ?hard=true.
    const llamadas = PANEL.split("await emailCancelacionAlCliente({").length - 1;
    assert.equal(llamadas, 2, `el panel la llama ${llamadas} veces y cancela por dos sitios`);
  });

  it("queda una sola etiqueta de log, la de la lib", () => {
    // Con dos, buscar «citas:cancelada» en los logs del VPS dejaba fuera la
    // mitad de las cancelaciones: las del panel escribían «citas:cancelled».
    assert.ok(!PANEL.includes("citas:cancelled"));
  });
});

/**
 * Lo que se aprobó el 20/08/2026 no era «que el panel llame a la lib», sino que
 * la familia con bono lea «tu programa sigue activo» también cuando cancela el
 * centro desde el panel. Esa frase cuelga de UNA línea —el `esBono` que el
 * envío saca de `booking.packId`—, y borrarla no rompía ninguna prueba: el
 * correo seguía saliendo, callado sobre el programa, por los CINCO caminos a la
 * vez. Es justo el silencio que la unificación venía a cerrar.
 *
 * La frase se comprueba por lo que DEVUELVE la plantilla. Que el envío le pase
 * el dato se mira sobre el texto porque llamarlo de verdad pide falsear Resend,
 * y eso ya no es una prueba ligera.
 */
describe("La sesión de un bono se cancela diciendo que el programa sigue", () => {
  const cancelada = (extra) =>
    bookingCancelledTemplate({
      tenantName: "Centro",
      clientName: "Marta Ruiz",
      eventTypeName: "Terapia individual",
      scheduledAt: EN_UNA_HORA(),
      reason: null,
      ...extra,
    });

  it("con bono, lo dice en el HTML y en el texto plano", () => {
    const tpl = cancelada({ esBono: true });
    assert.match(tpl.html, /programa sigue activo/);
    assert.match(tpl.text, /programa sigue activo/);
  });

  it("sin bono, no promete ningún programa", () => {
    const tpl = cancelada({ esBono: false });
    assert.doesNotMatch(tpl.html, /programa sigue activo/);
    assert.doesNotMatch(tpl.text, /programa sigue activo/);
  });

  it("el envío le dice a la plantilla si la cita salía de un bono", () => {
    const texto = readFileSync(join(RAIZ, "lib/citas/notificarCancelacion.js"), "utf8");
    assert.ok(
      texto.includes("esBono: !!booking.packId"),
      "el envío ya no le cuenta a la plantilla que la cita era de un bono"
    );
  });
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
