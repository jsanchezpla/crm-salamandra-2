import { headers } from "next/headers";

import NutriLauraAsignadosModule from "../../../../modules/overrides/nutri-laura/NutricionAsignadosModule.jsx";

const UI_OVERRIDES = {
  nutri_laura: NutriLauraAsignadosModule,
};

export const metadata = { title: "Planes asignados" };

export default async function NutricionAsignadosPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  const Component = (tenantSlug && UI_OVERRIDES[tenantSlug]) || NutriLauraAsignadosModule;
  return <Component />;
}
