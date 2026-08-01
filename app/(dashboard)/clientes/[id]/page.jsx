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
  // recepción acaba de teclear, ni más ni menos.
  let perfil = PERFIL_COMERCIAL;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = tenantSlug ? await Tenant.findOne({ where: { slug: tenantSlug } }) : null;
    if (tenant) {
      const filas = await TenantModule.findAll({ where: { tenantId: tenant.id } });
      const activos = new Set(filas.filter((f) => f.enabled).map((f) => f.moduleKey));
      perfil = perfilDeAlta((k) => activos.has(k));
    }
  } catch {
    perfil = PERFIL_COMERCIAL;
  }

  return <Component perfil={perfil} />;
}
