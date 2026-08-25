"use client";

/**
 * A donde vuelve la persona después de pagar.
 *
 * NO confirma nada por su cuenta: quien confirma el pedido y descuenta el stock
 * es el webhook de Stripe (`lib/payments/entityHooks.js`). Esta página solo
 * cuenta lo que ha pasado y vacía el carrito.
 *
 * Es importante que sea así: a esta URL se llega escribiéndola a mano, y dar un
 * pedido por bueno porque alguien aterrizó aquí sería regalar mercancía.
 */

import { useEffect } from "react";

const CLAVE_CARRITO = "crm-tienda-carrito";

export default function GraciasPage() {
  useEffect(() => {
    // El carrito se vacía AQUÍ y no al mandar a Stripe: si el pago se cancela,
    // la persona vuelve a la tienda y se lo encuentra como lo dejó.
    try {
      window.localStorage.removeItem(CLAVE_CARRITO);
    } catch {
      /* modo privado */
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="max-w-sm text-center">
        <h1 className="text-2xl tracking-tight text-[var(--widget-text)]">¡Gracias por tu compra!</h1>
        <p className="mt-3 text-sm text-[var(--widget-text-muted)]">
          Te hemos mandado un correo con el resumen del pedido. En cuanto lo preparemos te escribimos
          con el envío.
        </p>
        <p className="mt-4 text-xs text-[var(--widget-text-muted)]">
          Si algo no cuadra, responde a ese correo y lo miramos.
        </p>
      </div>
    </div>
  );
}
