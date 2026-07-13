/**
 * Claves canónicas de módulo (master.tenant_modules.module_key).
 *
 * `moduleKey` es un STRING libre sin enum/FK, así que un typo ("document" vs
 * "documents") crea una fila huérfana que ni el sidebar ni la API casan nunca.
 * El módulo Documents introduce esta constante para usar la MISMA key en el
 * gate de endpoints, el enable script y la migración.
 *
 * Backlog (no en Sprint 1): extraer las demás keys del Sidebar y centralizarlas
 * aquí, y referenciarlas desde el Sidebar y los enable/migrate existentes.
 */
export const MODULE_KEYS = Object.freeze({
  DOCUMENTS: "documents",
});
