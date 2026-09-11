/**
 * lib/ai/cacheDeRespuestas.js — la misma pregunta no se paga dos veces
 * (11/09/2026).
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * En septiembre Aumenta hizo 506 llamadas clínicas de pago en ocho días y
 * guardó 335 sesiones con transcripción: entre un 15 y un 30 % de las
 * llamadas no acababan en nada nuevo. Una parte son «Procesar con IA» pulsado
 * dos veces sobre el mismo audio, o rehecho tras un error de pantalla, y cada
 * vez se paga entera. Con el mismo texto de entrada la respuesta vale igual
 * que la anterior; se devuelve la anterior.
 *
 * ── QUÉ ES «LA MISMA PREGUNTA» ─────────────────────────────────────────────
 * El resumen (SHA-256) de TODO lo que viaja al modelo —modelo, system,
 * mensajes, tope— más el tenant, para que dos centros con el mismo texto de
 * demo no compartan respuesta. Una letra distinta en las notas es otra
 * pregunta y se paga: aquí no hay «parecido».
 *
 * Solo se guardan respuestas COMPLETAS (`stop_reason: end_turn`) y con texto:
 * una cortada o vacía tiene que poder reintentarse. Viven un día y hay un tope
 * de entradas; es memoria del proceso, se vacía en cada despliegue y no se
 * comparte entre instancias — está bien así, lo que se ahorra es el doble
 * clic y el «vuelve a intentarlo» de la misma tarde.
 *
 * Puro salvo el reloj, que se inyecta para las pruebas.
 */

import { createHash } from "node:crypto";

export const TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_ENTRADAS = 300;

export function crearCache({ ttlMs = TTL_MS, max = MAX_ENTRADAS, ahora = () => Date.now() } = {}) {
  const mapa = new Map();

  function purgar() {
    const t = ahora();
    for (const [k, v] of mapa) if (v.caduca <= t) mapa.delete(k);
  }

  return {
    /** Clave estable de una petición: el hash de su JSON. */
    clave(objeto) {
      return createHash("sha256").update(JSON.stringify(objeto)).digest("hex");
    },
    recuperar(clave) {
      const v = mapa.get(clave);
      if (!v) return null;
      if (v.caduca <= ahora()) {
        mapa.delete(clave);
        return null;
      }
      return v.valor;
    },
    recordar(clave, valor) {
      purgar();
      if (mapa.size >= max) {
        // La más vieja fuera: un Map conserva el orden de inserción.
        const primera = mapa.keys().next().value;
        if (primera !== undefined) mapa.delete(primera);
      }
      mapa.set(clave, { valor, caduca: ahora() + ttlMs });
    },
    tamano() {
      purgar();
      return mapa.size;
    },
  };
}

/** La caché compartida por el cliente de Anthropic del CRM. */
export const cacheDeRespuestas = crearCache();
