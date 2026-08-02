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

  // Falso positivo de react-hooks/static-components: es el override de UI por
  // tenant (CLAUDE.md). El componente sale de un mapa de MÓDULO, así que su
  // identidad es estable, y además esto es un componente de SERVIDOR: se
  // renderiza una vez por petición, no hay remontaje posible.
  // eslint-disable-next-line react-hooks/static-components
  return <FormacionOverview />;
}
