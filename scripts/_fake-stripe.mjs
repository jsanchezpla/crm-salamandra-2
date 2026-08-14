/**
 * _fake-stripe.mjs — un Stripe de mentira, SOLO para pruebas.
 *
 * Sustituye al paquete `stripe` (lo enchufa `_fake-stripe-loader.mjs`) para
 * poder ensayar lo que pasa cuando la retención de una tarjeta está VIVA y
 * cuando está MUERTA, que es lo único del flujo de «pedirle otra tarjeta» que no
 * se podía comprobar sin claves de una cuenta de Stripe de prueba.
 *
 * ── POR QUÉ SE FALSEA EL SDK Y NO NUESTRO CÓDIGO ────────────────────────────
 * Porque lo que hay que comprobar es NUESTRO código, entero: `getStripe` monta
 * el cliente con la clave del cliente, `leerEstadoAutorizacion` interpreta el
 * estado, `estorbaParaPedirOtraTarjeta` decide, y el endpoint contesta. Si se
 * falseara cualquiera de esos cuatro, la prueba dejaría de mirar justo el trozo
 * que se quiere mirar. Falseando la librería de fuera, todo lo de dentro es el
 * de verdad y lo único inventado es la respuesta de Stripe.
 *
 * ── EL GUION SE ELIGE POR EL ID DEL PAYMENT INTENT ──────────────────────────
 * Nada de estado global ni de variables de entorno: cada caso se pide con el id
 * que se le pone al PaymentIntent, así una prueba no puede contaminar a otra.
 *
 *   pi_fake_viva          → requires_capture  (hay dinero apartado: ESTORBA)
 *   pi_fake_muerta        → canceled          (murió: NO estorba)
 *   pi_fake_cobrada       → succeeded         (ya se cobró: NO estorba)
 *   pi_fake_desaparecida  → error resource_missing (no existe: NO estorba)
 *   pi_fake_caida         → error de red      (NO SE SABE: estorba)
 *
 * Cualquier otro id se comporta como una retención viva recién creada.
 *
 * El guion se busca por PREFIJO, así que `pi_fake_viva_2` vale igual que
 * `pi_fake_viva`: la fila de cobro lleva el PaymentIntent con índice único, y
 * dos citas del mismo caso en la misma prueba necesitan ids distintos.
 */

class StripeError extends Error {
  constructor(message, { code, statusCode } = {}) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.type = "StripeInvalidRequestError";
  }
}

const GUIONES = {
  pi_fake_viva: { status: "requires_capture" },
  pi_fake_muerta: { status: "canceled" },
  pi_fake_cobrada: { status: "succeeded" },
  pi_fake_desaparecida: () => {
    throw new StripeError("No such payment_intent", { code: "resource_missing", statusCode: 404 });
  },
  pi_fake_caida: () => {
    const e = new Error("connect ETIMEDOUT (Stripe de mentira: caída simulada)");
    e.code = "ETIMEDOUT";
    throw e;
  },
};

let contador = 0;

export default class Stripe {
  constructor(secretKey, opciones = {}) {
    if (!secretKey) throw new Error("Stripe de mentira: falta la clave");
    // Se planta si le pasan una clave que parece de verdad: este fichero no
    // debe entrar nunca en un camino que toque dinero real, y mejor que reviente
    // aquí que descubrirlo por lo que NO pasó.
    if (String(secretKey).startsWith("sk_live_")) {
      throw new Error("Stripe de mentira con una clave sk_live_: esto no puede pasar jamás");
    }
    this.secretKey = secretKey;
    this.opciones = opciones;

    this.paymentIntents = {
      retrieve: async (id) => {
        const clave = Object.keys(GUIONES).find((k) => String(id) === k || String(id).startsWith(`${k}_`));
        const guion = clave ? GUIONES[clave] : null;
        if (typeof guion === "function") return guion();
        if (guion) return { id, ...guion };
        return { id, status: "requires_capture" };
      },
      create: async (params) => {
        contador += 1;
        return {
          id: `pi_fake_nueva_${contador}`,
          client_secret: `pi_fake_nueva_${contador}_secret_prueba`,
          status: "requires_payment_method",
          amount: params?.amount ?? 0,
          currency: params?.currency ?? "eur",
          metadata: params?.metadata ?? {},
        };
      },
      cancel: async (id) => ({ id, status: "canceled" }),
      capture: async (id) => ({ id, status: "succeeded", amount_received: 0 }),
    };

    this.webhooks = {
      constructEvent: () => {
        throw new Error("Stripe de mentira: los webhooks no se simulan aquí");
      },
    };
  }

  getApiField(campo) {
    return campo === "version" ? this.opciones?.apiVersion ?? "fake" : null;
  }
}

export { Stripe };
