import { headers } from "next/headers";
import { getMasterModels } from "../../lib/db/masterDb.js";
import DashboardShell from "../../components/layout/DashboardShell.jsx";

const DEFAULT_BRAND = {
  primaryColor: "#152B22",
  secondaryColor: "#EDE8DE",
  logoUrl: null,
};

export default async function DashboardLayout({ children }) {
  const headersList = await headers();
  const userId = headersList.get("x-user-id");
  const tenantSlug = headersList.get("x-tenant");

  const { User, Tenant, TenantModule } = getMasterModels();

  const [user, tenant] = await Promise.all([
    userId ? User.findByPk(userId) : null,
    tenantSlug ? Tenant.findOne({ where: { slug: tenantSlug } }) : null,
  ]);

  const modules = tenant ? await TenantModule.findAll({ where: { tenantId: tenant.id } }) : [];

  const tenantJson = tenant?.toJSON() ?? null;
  const brand = { ...DEFAULT_BRAND, ...(tenantJson?.settings?.brand || {}) };

  return (
    <DashboardShell
      tenant={tenantJson}
      user={user?.toJSON() ?? null}
      modules={modules.map((m) => m.toJSON())}
      primaryColor={brand.primaryColor}
      secondaryColor={brand.secondaryColor}
    >
      {children}
    </DashboardShell>
  );
}
