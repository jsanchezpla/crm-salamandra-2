// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-stripe-eventos.mjs — la lista de eventos de Stripe no puede divergir
 * de lo que el webhook trata (20/08/2026).
 *
 *   node scripts/_smoke-stripe-eventos.mjs
 *   node --test-name-pattern="retención" scripts/_smoke-stripe-eventos.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * La tarjeta de Stripe en /configuracion existe para que un cliente dé de alta
 * su webhook él solo. Hasta hoy le pedía marcar CINCO eventos —los cuatro de
 * `checkout.session.*` y `charge.refunded`— de los ONCE que el webhook trata.
 * Quien la siguiera se quedaba sin los de `payment_intent.*` (la retención se
 * hace, nadie avisa, la cita nunca entra en la lista de espera de la
 * profesional y el paciente tiene el dinero bloqueado) y sin los de
 * `invoice.*` (las cuotas 2ª y 3ª del pago a plazos se cobran sin que el CRM se
 * entere). No mordió porque el único cliente con Stripe tenía el suyo dado de
 * alta a mano con la lista buena.
 *
 * La lista ya no se copia: vive en `lib/payments/eventosWebhook.js` y la leen
 * la pantalla y `scripts/comprobar-stripe.js`. Lo que esta prueba impide es lo
 * siguiente: que alguien añada un `case` al webhook —o quite uno— y la lista se
 * quede vieja en silencio, que es exactamente como empezó la anterior.
 *
 * ── POR QUÉ AQUÍ SÍ VALE UNA REGEX SOBRE EL CÓDIGO ─────────────────────────
 *
 * Lo normal es probar lo que una función DEVUELVE, no cómo está escrita. Pero
 * el otro lado de esta comparación no es una función: es un `switch` sobre el
 * tipo de evento, y sus etiquetas son literales de texto. Leerlas es leer el
 * dato, no el estilo. Si el `switch` se convirtiera algún día en una tabla, la
 * lectura de abajo dejaría de encontrar nada — y por eso la primera prueba
 * comprueba justo eso, que sigue encontrando casos.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EVENTOS_WEBHOOK_STRIPE } from "../lib/payments/eventosWebhook.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RUTA_WEBHOOK = join(AQUI, "..", "app", "api", "webhooks", "stripe", "[tenantSlug]", "route.js");

/**
 * Las etiquetas del `switch (event.type)`: `case "checkout.session.expired":`.
 * Los dígitos entran en el nombre porque los eventos nuevos de Stripe empiezan
 * por versión (`v1.…`): sin ellos, un `case` así no se leería y esta prueba se
 * quedaría verde justo cuando tendría que morder.
 */
function eventosQueTrataElWebhook() {
  const fuente = readFileSync(RUTA_WEBHOOK, "utf8");
  const casos = fuente.matchAll(/case\s+"([a-z0-9_]+(?:\.[a-z0-9_]+)+)"/g);
  return [...new Set([...casos].map((m) => m[1]))];
}

const tratados = eventosQueTrataElWebhook();
const declarados = EVENTOS_WEBHOOK_STRIPE.map((e) => e.evento);

describe("Leer los eventos que trata el webhook", () => {
  it("encuentra sus casos; si no, la prueba estaría comparando contra nada", () => {
    assert.ok(
      tratados.length >= 5,
      `Solo se han leído ${tratados.length} eventos en ${RUTA_WEBHOOK}. ` +
        "O el fichero se movió, o el `switch` dejó de ser un `switch`: arregla la lectura antes de fiarte del resto de la prueba."
    );
  });
});

describe("La lista de lib/payments/eventosWebhook.js dice exactamente lo que el webhook trata", () => {
  it("no falta ninguno: lo que el webhook trata está declarado", () => {
    const faltan = tratados.filter((e) => !declarados.includes(e));
    assert.deepEqual(
      faltan,
      [],
      "El webhook trata estos eventos y nadie se los pide al cliente al dar de alta su punto de conexión. " +
        "Decláralos en lib/payments/eventosWebhook.js con el porqué de cada uno."
    );
  });

  it("no sobra ninguno: no se le pide al cliente nada que el webhook ignore", () => {
    const sobran = declarados.filter((e) => !tratados.includes(e));
    assert.deepEqual(
      sobran,
      [],
      "Estos eventos se le piden al cliente y el webhook los ignora. Quítalos de la lista: " +
        "cada casilla de más es ruido que Stripe nos entrega para nada."
    );
  });

  it("el de la retención está: sin él la cita no entra en la lista de espera", () => {
    assert.ok(declarados.includes("payment_intent.amount_capturable_updated"));
  });
});

describe("Cada evento se explica para quien está delante del panel de Stripe", () => {
  it("ninguno se repite", () => {
    assert.equal(new Set(declarados).size, declarados.length);
  });

  it("todos traen un porqué escrito, no el nombre otra vez", () => {
    for (const { evento, porque } of EVENTOS_WEBHOOK_STRIPE) {
      assert.equal(typeof porque, "string", `${evento} no tiene porqué`);
      assert.ok(porque.trim().length >= 20, `El porqué de ${evento} no explica nada: "${porque}"`);
      assert.ok(!porque.includes(evento), `El porqué de ${evento} solo repite su nombre`);
    }
  });
});
