import { headers } from "next/headers";

import DefaultClientDetailModule from "../../../../modules/default/ClientDetailModule.jsx";
import NutriLauraClientsModule from "../../../../modules/overrides/nutri-laura/ClientsModule.jsx";

const UI_OVERRIDES = {
  nutri_laura: NutriLauraClientsModule,
};

const TENANT_TITLE_OVERRIDES = {
  nutri_laura: "Paciente",
};

export async function generateMetadata() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");
  return { title: TENANT_TITLE_OVERRIDES[slug] ?? "Cliente" };
}

export default async function ClienteDetailPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  const Component = (tenantSlug && UI_OVERRIDES[tenantSlug]) || DefaultClientDetailModule;
  return <Component />;
}
