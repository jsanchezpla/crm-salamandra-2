/**
 * lib/ai/proveedores.js — los dos proveedores con los que el CRM puede
 * REDACTAR, en un fichero sin nada de servidor (12/09/2026).
 *
 * Está aparte de `proveedorIa.js` a propósito: aquel descifra claves
 * (`node:crypto`) y no se puede importar desde un componente de cliente, y la
 * pantalla de Configuración necesita la lista para pintar el desplegable. La
 * fuente es esta; `proveedorIa.js` la reexporta para el servidor.
 */
export const PROVEEDORES_IA = Object.freeze([
  { id: "anthropic", label: "Claude (Anthropic)", cuenta: "Anthropic", consola: "console.anthropic.com" },
  { id: "openai", label: "ChatGPT (OpenAI)", cuenta: "OpenAI", consola: "platform.openai.com" },
]);

export const DEFAULT_PROVEEDOR_IA = "anthropic";

export function esProveedorIa(id) {
  return typeof id === "string" && PROVEEDORES_IA.some((p) => p.id === id);
}

/** El proveedor elegido en un bloque `integrations`: «anthropic» si no hay nada válido. */
export function proveedorIaDe(integrations) {
  const p = integrations?.aiProvider;
  return esProveedorIa(p) ? p : DEFAULT_PROVEEDOR_IA;
}

/** «Anthropic» u «OpenAI», para las frases que nombran la cuenta. */
export function nombreDelProveedor(proveedor) {
  return PROVEEDORES_IA.find((p) => p.id === proveedor)?.cuenta ?? "Anthropic";
}
