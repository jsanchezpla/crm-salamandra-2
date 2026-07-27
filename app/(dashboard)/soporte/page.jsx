import { createElement } from "react";
import { headers } from "next/headers";

import SupportModule from "../../../modules/support/SupportModule.jsx";

/**
 * /soporte — módulo Soporte (helpdesk del tenant hacia SUS clientes).
 *
 * Se llega desde la llave inglesa del pie del sidebar (visible en todos los
 * tenants), así que NO puede dar 404: si el tenant no tiene el módulo
 * `support`, el propio módulo degrada al canal de contacto directo con
 * Salamandra (la API responde 403 y la UI enseña la tarjeta de email).
 */
const UI_OVERRIDES = {};

export const metadata = { title: "Soporte" };

export default async function SoportePage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  const resolved = (tenantSlug && UI_OVERRIDES[tenantSlug]) || SupportModule;
  // Los deep-links (?ticket=, ?client=) los lee el módulo de window.location:
  // useSearchParams metía esto en una Suspense boundary que no se resolvía.
  return createElement(resolved);
}
