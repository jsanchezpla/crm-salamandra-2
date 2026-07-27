/**
 * lib/utils/wpOrigin.js — lista blanca de dominios para los endpoints que
 * llama el WordPress de un tenant SIN clave de API.
 *
 * (Fichero nuevo en /lib, regla #2: el patrón ya existía copiado dentro de
 * app/api/webhooks/retorika/check-empresa-user/route.js; al extraerlo aquí lo
 * comparten los tres endpoints sin auth en vez de reimplementarlo cada uno.)
 *
 * POR QUÉ NO HAY FIRMA HMAC: estos endpoints los invoca el navegador del
 * alumno desde el WordPress del cliente (snippets públicos en `code-snippets`),
 * así que un secreto compartido acabaría dentro del HTML — sería peor. Con la
 * lista blanca de Origin/Referer, un script en otra web no puede llamarlos
 * desde el navegador de nadie (el navegador manda esas cabeceras y no se
 * pueden falsificar desde JavaScript).
 *
 * ⚠️ LO QUE ESTO NO ES: no protege de un `curl` a pelo (ahí las cabeceras se
 * ponen a mano). Es una barrera contra el abuso desde navegador y contra el
 * enumerado casual, no un sistema de autenticación. Para cerrar del todo estos
 * dos endpoints haría falta que Retorika llame desde su servidor (PHP) con la
 * API key que ya tienen los `/api/external/retorika/*` — pendiente de acordar
 * con ellos porque implica tocar su WordPress.
 *
 * El dominio se lee de la config del tenant y, si no está, del literal de
 * Retorika (único cliente que usa hoy estos endpoints).
 */

const POR_DEFECTO = ["asesoriaretorika.com", "www.asesoriaretorika.com"];

/** Hosts permitidos para un tenant: settings.wordpressHosts o el literal. */
export function hostsPermitidos(tenant) {
  const configurados = tenant?.settings?.wordpressHosts;
  if (Array.isArray(configurados) && configurados.length) {
    return new Set(configurados.map((h) => String(h).trim().toLowerCase()).filter(Boolean));
  }
  return new Set(POR_DEFECTO);
}

/**
 * ¿La petición viene de un dominio permitido?
 * Sin Origin ni Referer → false (una llamada desde navegador SIEMPRE los trae).
 */
export function origenPermitido(request, tenant) {
  const permitidos = hostsPermitidos(tenant);
  const candidatos = [request.headers.get("origin"), request.headers.get("referer")]
    .filter(Boolean)
    .map((u) => {
      try {
        return new URL(u).hostname.toLowerCase();
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (candidatos.length === 0) return false;
  return candidatos.some((h) => permitidos.has(h));
}

/** Cabeceras CORS acotadas al origen de la petición (nunca `*`). */
export function corsParaOrigen(request, tenant) {
  const origen = request.headers.get("origin");
  const cabeceras = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-tenant",
    Vary: "Origin",
  };
  if (origen && origenPermitido(request, tenant)) {
    cabeceras["Access-Control-Allow-Origin"] = origen;
  }
  return cabeceras;
}
