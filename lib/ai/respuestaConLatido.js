/**
 * lib/ai/respuestaConLatido.js — una respuesta que no se queda muda.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten los dos endpoints de la IA de
 * Proyectos, que son los únicos del CRM que tardan minutos.)
 *
 * ── QUÉ RESUELVE (01/09/2026, Rodrigo: «la IA de Proyectos no funciona») ────
 * Planificar un proyecto entero son ~12.000 tokens de JSON: minutos de reloj,
 * no segundos. Durante todo ese rato la petición no manda ni un byte, y por
 * el camino hay al menos un guardia que corta las conexiones calladas:
 * **nginx**, cuyo `proxy_read_timeout` vale 60 s por defecto. Pasado ese
 * minuto, el CRM podía estar generando el mejor plan del mundo: la respuesta
 * ya no tenía a quién llegar y el navegador recibía un 504.
 *
 * Aquí la respuesta empieza A LA VEZ que el trabajo y va soltando un espacio
 * cada pocos segundos. Eso reinicia el contador de nginx (y el de cualquier
 * proxy o balanceador que haya delante) sin cambiar el contrato: JSON admite
 * espacios delante, así que el `res.json()` del navegador parsea igual lo que
 * llega. Cuando el trabajo termina se escribe el JSON de verdad y se cierra.
 *
 * ⚠️ EL CÓDIGO HTTP SE MANDA ANTES QUE EL CUERPO. Como el cuerpo empieza a
 * viajar de inmediato, ya no se puede contestar 503 al final: la respuesta es
 * SIEMPRE 200 y el fallo viaja dentro (`{ ok: false, error }`). Quien llame a
 * un endpoint de estos tiene que mirar `j.ok`, no solo `res.ok`.
 */

const LATIDO_MS = 15_000;

/**
 * @param {() => Promise<{ ok: boolean, data?: any, error?: string }>} trabajo
 *   Lo que hay que hacer. Devuelve YA el cuerpo tal cual se quiere enviar.
 * @param {{ intervaloMs?: number }} [opciones]
 */
export function respuestaConLatido(trabajo, { intervaloMs = LATIDO_MS } = {}) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const latido = setInterval(() => {
        // Si el cliente ya se fue, `enqueue` lanza: no es un fallo del trabajo.
        try {
          controller.enqueue(encoder.encode(" "));
        } catch {
          clearInterval(latido);
        }
      }, intervaloMs);

      let cuerpo;
      try {
        cuerpo = await trabajo();
      } catch (err) {
        // El trabajo ya traduce lo suyo; esto es la red de seguridad. Se
        // registra entero en el servidor y se cuenta corto fuera.
        console.error("[respuestaConLatido]", err?.name, err?.message);
        cuerpo = { ok: false, error: "No se ha podido completar la operación. Vuelve a intentarlo." };
      } finally {
        clearInterval(latido);
      }

      try {
        controller.enqueue(encoder.encode(JSON.stringify(cuerpo)));
      } catch {
        /* cliente desconectado: no hay a quién contestar */
      }
      try {
        controller.close();
      } catch {
        /* ya cerrado */
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Que nginx no acumule la respuesta antes de mandarla: sin esto el
      // latido llegaría al final, junto con el JSON, y no habría servido de nada.
      "X-Accel-Buffering": "no",
    },
  });
}
