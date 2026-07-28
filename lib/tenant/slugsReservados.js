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

export function esSlugReservado(slug) {
  return SLUGS_RESERVADOS.has(String(slug || "").trim().toLowerCase());
}
