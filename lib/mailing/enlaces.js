import {
  tokenDeBaja,
  tokenDeClic,
  tokenDeConfirmacion,
  tokenDeEnvio,
} from "./bajaToken.js";

/**
 * lib/mailing/enlaces.js — las URL públicas que van dentro de un correo de
 * mailing, construidas en un solo sitio.
 *
 * (Fichero nuevo en /lib, regla #2: las usan el envío por lotes —que corre
 * desde un temporizador, sin request—, el envío de prueba y la vista previa
 * —que sí tienen request—, y el correo de confirmación de un contacto. Si cada
 * uno montara la ruta a mano, un cambio de ruta dejaría enlaces rotos en
 * alguno de los tres.)
 *
 * Todas cuelgan de `/api/public/c/<slug>/mailing/…`, que es la forma pública
 * del CRM: está en la lista blanca del middleware y `withPublicTenant` resuelve
 * el cliente por el slug de la ruta, no por nada que venga en la petición.
 *
 * La base es `APP_PUBLIC_URL` (la misma que usan los recordatorios de cita)
 * o, si hay request, su origen. Sin ninguna de las dos se cae al dominio del
 * CRM de producción: un enlace de baja con host vacío sería ilegal.
 */

const BASE_POR_DEFECTO = "https://crm.salamandrasolutions.com";

/** Base pública: la del entorno, o la de la request si se pasa. */
export function urlBase(request = null) {
  const env = (process.env.APP_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (env) return env;
  if (request) {
    try {
      const proto = request.headers.get("x-forwarded-proto");
      const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
      if (host) return `${proto || "https"}://${host}`;
      return new URL(request.url).origin;
    } catch {
      /* sin request usable */
    }
  }
  return BASE_POR_DEFECTO;
}

function raiz(base, slug) {
  return `${String(base).replace(/\/+$/, "")}/api/public/c/${encodeURIComponent(slug)}/mailing`;
}

export function urlDeBaja(base, slug, email) {
  return `${raiz(base, slug)}/baja/${tokenDeBaja(slug, email)}`;
}

export function urlDeConfirmacion(base, slug, email) {
  return `${raiz(base, slug)}/confirmar/${tokenDeConfirmacion(slug, email)}`;
}

export function urlDeImagen(base, slug, nombreFichero) {
  return `${raiz(base, slug)}/imagen/${encodeURIComponent(nombreFichero)}`;
}

/**
 * Los enlaces de UN envío real: baja, «ver en el navegador», píxel y el
 * rastreador de clics. Es lo que espera `renderCorreo` en `enlaces`.
 */
export function enlacesDeEnvio({ base, slug, sendId, email }) {
  const r = raiz(base, slug);
  const t = tokenDeEnvio(slug, sendId);
  return {
    baja: urlDeBaja(base, slug, email),
    ver: `${r}/ver/${t}`,
    pixel: `${r}/abierto/${t}.gif`,
    rastrear: (url, indice) => `${r}/clic/${tokenDeClic(slug, sendId, indice)}`,
  };
}

/**
 * Los enlaces de un envío de PRUEBA o de la vista previa: baja de verdad (la
 * dirección de quien prueba puede darse de baja igual), sin medir nada.
 */
export function enlacesDePrueba({ base, slug, email }) {
  return {
    baja: urlDeBaja(base, slug, email || "prueba@ejemplo.invalid"),
    ver: null,
    pixel: null,
    rastrear: (url) => url,
  };
}
