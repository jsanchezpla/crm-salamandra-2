import { createElement } from "react";
import { headers } from "next/headers";

import NutriLauraRecetasModule from "../../../../modules/overrides/nutri-laura/NutricionRecetasModule.jsx";

const UI_OVERRIDES = {
  nutri_laura: NutriLauraRecetasModule,
};

export const metadata = { title: "Recetario" };

export default async function NutricionRecetasPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  // createElement (no <Component/> JSX) para no crear un componente en render
  // (regla react-hooks/static-components) manteniendo el override por tenant.
  const resolved = (tenantSlug && UI_OVERRIDES[tenantSlug]) || NutriLauraRecetasModule;
  return createElement(resolved);
}
