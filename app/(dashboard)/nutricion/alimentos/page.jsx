import { headers } from "next/headers";

import NutriLauraFoodsModule from "../../../../modules/overrides/nutri-laura/NutricionFoodsModule.jsx";

const UI_OVERRIDES = {
  nutri_laura: NutriLauraFoodsModule,
};

export const metadata = { title: "Catálogo de alimentos" };

export default async function NutricionAlimentosPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  const Component = (tenantSlug && UI_OVERRIDES[tenantSlug]) || NutriLauraFoodsModule;
  return <Component />;
}
