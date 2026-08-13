/**
 * Nombres que NO pueden ser el slug de un cliente.
 *
 * ── POR QUÉ ESTO EXISTE ─────────────────────────────────────────────────────
 * `slugFromSubdomain()` (tenantResolver.js) interpreta la PRIMERA ETIQUETA DEL
 * HOST como identidad de tenant. Eso significa que los subdominios de
 * infraestructura y los slugs de cliente comparten el mismo espacio de nombres:
 *
 *     admin.salamandrasolutions.com  →  intentaría resolver el tenant "admin"
 *
 * De ahí que un cliente llamado "admin" se quedaría con el subdominio del
 * back-office interno. Y al revés: el subdominio del back-office intentaría
 * resolverse como si fuera un cliente.
 *
 * Por eso la lista vive AQUÍ y no en el módulo de alta: la usan los dos lados
 * (el alta para rechazar el nombre, el resolutor para no interpretarlo como
 * tenant), y dos copias de una lista de seguridad se desincronizan sin que nadie
 * se entere.
 *
 * Nada de esto tiene que ver con el ROL "admin" de un usuario: son cosas
 * distintas que se llaman igual.
 */

export const SLUGS_RESERVADOS = new Set([
  // Schemas de PostgreSQL y convenciones del CRM
  "master",
  "public",
  "information_schema",
  "pg_catalog",
  "demo_golden",
  "crm",
  /*
   * ── CARPETAS DE `uploads/` (13/08/2026) ────────────────────────────────────
   * Tres de los seis almacenes de ficheros ponen el slug del cliente delante
   * (`uploads/{slug}/clients/…`) y los otros tres el TIPO (`uploads/documents/
   * {slug}/…`, `support/`, `nutricion-recipes/`, y `buzon/` aparte). O sea que
   * los dos esquemas comparten el primer nivel de `uploads/`.
   *
   * Un cliente llamado `documents` o `support` tendría como carpeta propia la
   * carpeta COMPARTIDA de ese almacén. Y entonces su baja —que mueve
   * `uploads/{slug}/` entero -- se llevaría los adjuntos de TODOS los clientes
   * a `uploads/_bajas/`. Lo mismo `_bajas`, que es donde se apartan.
   *
   * Es improbable y es catastrófico, que es la combinación que hay que cerrar
   * en la puerta y no confiar a que nadie elija ese nombre.
   */
  "documents",
  "support",
  "buzon",
  "nutricion-recipes",
  "_bajas",
  // Subdominios de infraestructura, presentes y previstos
  "admin",
  "www",
  "api",
  "app",
  "mail",
  "smtp",
  "ftp",
  "n8n",
  "portal",
  "static",
  "assets",
  "cdn",
  "webhooks",
  "salamandra",
  "soporte",
  "status",
]);

/**
 * Además de la lista, TODO lo que acabe en `_golden` está reservado
 * (13/08/2026). `crm_{slug}_golden` es el schema con la copia impecable de cada
 * demo (lib/demo/demos.js); un cliente llamado `demo_clinica_golden` se llevaría
 * por delante la foto de la demo de clínica en el primer `db:demo:snapshot`, que
 * empieza por `DROP SCHEMA ... CASCADE`.
 *
 * Va como regla y no como cuatro entradas más en la lista porque la lista se
 * quedaría corta el día que se añada la quinta demo — que es exactamente lo que
 * acaba de pasar con `demo_golden`, que estaba escrito a mano ahí arriba.
 */
export function esSlugReservado(slug) {
  const s = String(slug || "").trim().toLowerCase();
  if (s.endsWith("_golden")) return true;
  return SLUGS_RESERVADOS.has(s);
}
