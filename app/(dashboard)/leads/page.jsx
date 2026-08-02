import { headers } from "next/headers";
import { getMasterModels } from "../../../lib/db/masterDb.js";

import DefaultLeadsModule from "../../../modules/leads/LeadsModule.jsx";
import QECLeadsModule from "../../../modules/overrides/quality-energy/LeadsModule.jsx";
import RetorikaLeadsModule from "../../../modules/overrides/retorika/LeadsModule.jsx";
import AumentaLeadsModule from "../../../modules/overrides/aumenta/LeadsModule.jsx";
import AbarcaIALeadsModule from "../../../modules/overrides/abarcaia/LeadsModule.jsx";
import DemoLeadsModule from "../../../modules/overrides/demo/LeadsModule.jsx";
import SpainEnzymesLeadsModule from "../../../modules/overrides/spain-enzymes/LeadsModule.jsx";
import NutriLauraLeadsModule from "../../../modules/overrides/nutri-laura/LeadsModule.jsx";
import SandboxLeadsModule from "../../../modules/overrides/sandbox/LeadsModule.jsx";

const UI_OVERRIDES = {
  quality_energy: QECLeadsModule,
  retorika: RetorikaLeadsModule,
  aumenta: AumentaLeadsModule,
  sandbox: SandboxLeadsModule, // copia del override de aumenta recoloreada a #1B3A2D
  abarcaia: AbarcaIALeadsModule,
  demo: DemoLeadsModule,
  spain_enzymes: SpainEnzymesLeadsModule,
  nutri_laura: NutriLauraLeadsModule,
};

const TENANT_TITLE_OVERRIDES = {
  aumenta: "Interesados",
};

export async function generateMetadata() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");
  return { title: TENANT_TITLE_OVERRIDES[slug] ?? "Leads Profesionales" };
}

export default async function LeadsPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");

  if (tenantSlug) {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = await Tenant.findOne({ where: { slug: tenantSlug } });
    if (tenant) {
      await TenantModule.findOne({
        where: { tenantId: tenant.id, moduleKey: "leads" },
      });
    }
  }

  const LeadsModule = (tenantSlug && UI_OVERRIDES[tenantSlug]) || DefaultLeadsModule;

  // Falso positivo de react-hooks/static-components: es el override de UI por
  // tenant (CLAUDE.md). El componente sale de un mapa de MÓDULO, así que su
  // identidad es estable, y además esto es un componente de SERVIDOR: se
  // renderiza una vez por petición, no hay remontaje posible.
  // eslint-disable-next-line react-hooks/static-components
  return <LeadsModule />;
}
