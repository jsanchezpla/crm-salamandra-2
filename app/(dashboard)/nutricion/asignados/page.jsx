import { createElement } from "react";
import { headers } from "next/headers";

import NutriLauraAsignadosModule from "../../../../modules/nutricion/NutricionAsignadosModule.jsx";

const UI_OVERRIDES = {
  nutri_laura: NutriLauraAsignadosModule,
};

export const metadata = { title: "Pautas" };

export default async function NutricionAsignadosPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  const resolved = (tenantSlug && UI_OVERRIDES[tenantSlug]) || NutriLauraAsignadosModule;
  return createElement(resolved);
}
