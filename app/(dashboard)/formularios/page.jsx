import { createElement } from "react";
import { headers } from "next/headers";

import FormulariosModule from "../../../modules/formularios/FormulariosModule.jsx";

/**
 * Bandeja de solicitudes recibidas desde los formularios públicos.
 *
 * El módulo es genérico (pinta las preguntas que traiga cada formulario), así
 * que de momento ningún tenant necesita override. El mapa queda preparado por
 * si mañana alguno quiere otra disposición.
 */
const UI_OVERRIDES = {};

export const metadata = { title: "Formularios" };

export default async function FormulariosPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  const resolved = (tenantSlug && UI_OVERRIDES[tenantSlug]) || FormulariosModule;
  return createElement(resolved);
}
