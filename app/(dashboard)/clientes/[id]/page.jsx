import { headers } from "next/headers";

import DefaultClientDetailModule from "../../../../modules/default/ClientDetailModule.jsx";
import NutriLauraClientDetailModule from "../../../../modules/overrides/nutri-laura/ClientDetailModule.jsx";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { perfilDeAlta, PERFIL_COMERCIAL } from "../../../../lib/clients/formularioAlta.js";

const UI_OVERRIDES = {
  nutri_laura: NutriLauraClientDetailModule,
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

  // El mismo perfil que el alta: la ficha tiene que poder editar lo que
  // recepción acaba de teclear, ni más ni menos. Y con él, si el cliente lleva
  // pacientes: de eso depende que se pregunte el parentesco del titular.
  let perfil = PERFIL_COMERCIAL;
  let conPacientes = false;
  let conFacturacion = false;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = tenantSlug ? await Tenant.findOne({ where: { slug: tenantSlug } }) : null;
    if (tenant) {
      const filas = await TenantModule.findAll({ where: { tenantId: tenant.id } });
      const activos = new Set(filas.filter((f) => f.enabled).map((f) => f.moduleKey));
      perfil = perfilDeAlta((k) => activos.has(k));
      conPacientes = activos.has("pacientes");
      conFacturacion = activos.has("billing");
    }
  } catch {
    perfil = PERFIL_COMERCIAL;
  }

  // Falso positivo de react-hooks/static-components: es el override de UI por
  // tenant (CLAUDE.md). El componente sale de un mapa de MÓDULO, así que su
  // identidad es estable, y además esto es un componente de SERVIDOR: se
  // renderiza una vez por petición, no hay remontaje posible.
  // eslint-disable-next-line react-hooks/static-components
  return <Component perfil={perfil} conPacientes={conPacientes} conFacturacion={conFacturacion} />;
}
