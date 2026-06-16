import { headers } from "next/headers";

import DefaultCitasModule from "../../../modules/default/CitasModule.jsx";
import NutriLauraCitasModule from "../../../modules/overrides/nutri-laura/CitasModule.jsx";

const UI_OVERRIDES = {
  nutri_laura: NutriLauraCitasModule,
};

const TENANT_TITLE_OVERRIDES = {
  nutri_laura: "Agenda",
};

export async function generateMetadata() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");
  return { title: TENANT_TITLE_OVERRIDES[slug] ?? "Citas" };
}

export default async function CitasPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  const Component = (tenantSlug && UI_OVERRIDES[tenantSlug]) || DefaultCitasModule;
  return <Component />;
}
