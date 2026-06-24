import { headers } from "next/headers";

import NutriLauraPlantillasModule from "../../../../modules/overrides/nutri-laura/NutricionPlantillasModule.jsx";

const UI_OVERRIDES = {
  nutri_laura: NutriLauraPlantillasModule,
};

export const metadata = { title: "Plantillas de planes" };

export default async function NutricionPlantillasPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  const Component = (tenantSlug && UI_OVERRIDES[tenantSlug]) || NutriLauraPlantillasModule;
  return <Component />;
}
