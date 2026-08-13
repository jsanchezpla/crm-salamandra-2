import { createElement } from "react";
import { headers } from "next/headers";

import NutriLauraPlantillasModule from "../../../../modules/nutricion/NutricionPlantillasModule.jsx";

const UI_OVERRIDES = {
  nutri_laura: NutriLauraPlantillasModule,
};

export const metadata = { title: "Menús" };

export default async function NutricionPlantillasPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  const resolved = (tenantSlug && UI_OVERRIDES[tenantSlug]) || NutriLauraPlantillasModule;
  return createElement(resolved);
}
