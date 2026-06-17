import { headers } from "next/headers";

import DefaultFormacionOverview from "../../../modules/training/FormacionOverview.jsx";
import AumentaFormacionOverview from "../../../modules/overrides/aumenta/FormacionOverview.jsx";

// nutri_laura usa el overview default (5 secciones) — mismo flujo que retorika.
// Su override anterior (B2C reducido, sin Empresas ni Cuestionarios) se
// eliminó porque Laura quiere ver la UI completa de formación.
const UI_OVERRIDES = {
  aumenta: AumentaFormacionOverview,
};

export const metadata = { title: "Formación" };

export default async function FormacionPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");

  const FormacionOverview =
    (tenantSlug && UI_OVERRIDES[tenantSlug]) || DefaultFormacionOverview;

  return <FormacionOverview />;
}
