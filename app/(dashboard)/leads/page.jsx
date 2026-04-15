import { headers } from "next/headers";
import { getMasterModels } from "../../../lib/db/masterDb.js";

import DefaultLeadsModule from "../../../modules/leads/LeadsModule.jsx";
import QECLeadsModule from "../../../modules/overrides/quality-energy/LeadsModule.jsx";
import AumentaLeadsModule from "../../../modules/overrides/aumenta/LeadsModule.jsx";
import AbarcaIALeadsModule from "../../../modules/overrides/abarcaia/LeadsModule.jsx";

const UI_OVERRIDES = {
  quality_energy: QECLeadsModule,
  aumenta: AumentaLeadsModule,
  abarcaia: AbarcaIALeadsModule,
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
