import { headers } from "next/headers";
import { getMasterModels } from "../../lib/db/masterDb.js";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import SessionKeeper from "../../components/auth/SessionKeeper.jsx";

const DEFAULT_BRAND = {
  primaryColor: "#152B22",
  secondaryColor: "#3E5C57",
  accentColor: "#EDE8DE",
  inkColor: null,
  cardColor: null,
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
  // Los secretos (API keys de IA en settings.integrations) NUNCA deben llegar
  // al cliente. Este layout es el único punto que serializa el tenant completo
  // al navegador (lo recibe el Sidebar), así que se limpian aquí.
  if (tenantJson?.settings?.integrations) delete tenantJson.settings.integrations;
  const brand = { ...DEFAULT_BRAND, ...(tenantJson?.settings?.brand || {}) };

  return (
    <DashboardShell
      tenant={tenantJson}
      user={user?.toJSON() ?? null}
      modules={modules.map((m) => m.toJSON())}
      primaryColor={brand.primaryColor}
      secondaryColor={brand.secondaryColor}
      accentColor={brand.accentColor}
      inkColor={brand.inkColor}
      cardColor={brand.cardColor}
    >
      {/* Refresca el access token (15 min) antes de que caduque para no echar
          al usuario a /login cada 15 min. Persiste entre navegaciones SPA. */}
      <SessionKeeper />
      {children}
    </DashboardShell>
  );
}
