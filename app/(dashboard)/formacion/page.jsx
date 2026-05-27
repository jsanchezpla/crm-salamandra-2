import { headers } from "next/headers";

import DefaultFormacionOverview from "../../../modules/training/FormacionOverview.jsx";
import NutriLauraFormacionOverview from "../../../modules/overrides/nutri-laura/FormacionOverview.jsx";

const UI_OVERRIDES = {
  nutri_laura: NutriLauraFormacionOverview,
};

export const metadata = { title: "Formación" };

export default async function FormacionPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");

  const FormacionOverview =
    (tenantSlug && UI_OVERRIDES[tenantSlug]) || DefaultFormacionOverview;

  return <FormacionOverview />;
}
