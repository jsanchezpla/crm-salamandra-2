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
  // Falso positivo de react-hooks/static-components: es el override de UI por
  // tenant (CLAUDE.md). El componente sale de un mapa de MÓDULO, así que su
  // identidad es estable, y además esto es un componente de SERVIDOR: se
  // renderiza una vez por petición, no hay remontaje posible.
  // eslint-disable-next-line react-hooks/static-components
  return <Component />;
}
