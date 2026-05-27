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

const UI_OVERRIDES = {
  quality_energy: QECLeadsModule,
  retorika: RetorikaLeadsModule,
  aumenta: AumentaLeadsModule,
  abarcaia: AbarcaIALeadsModule,
  demo: DemoLeadsModule,
  spain_enzymes: SpainEnzymesLeadsModule,
  nutri_laura: NutriLauraLeadsModule,
};

export const metadata = { title: "Leads" };

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

  return <LeadsModule />;
}
