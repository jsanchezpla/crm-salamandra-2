import { headers } from "next/headers";
import { getMasterModels } from "../../lib/db/masterDb.js";
import { maybeResetDemo } from "../../lib/demo/resetDemo.js";
import { DEMO_SLUGS, esSlugDemo } from "../../lib/demo/demos.js";
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

  // Demos públicas auto-restaurables: en cada recarga dura de una demo se
  // restaura SU foto dorada (si existe) ANTES de que el cliente pida datos. Ver
  // lib/demo/resetDemo.js — para los demás tenants es un no-op inmediato, y por
  // eso se llama sin preguntar: el `=== "demo"` que había aquí era una segunda
  // lista de demos que se habría quedado atrás al haber cuatro.
  await maybeResetDemo(tenantSlug);

  const { User, Tenant, TenantModule } = getMasterModels();

  const [user, tenant] = await Promise.all([
    userId ? User.findByPk(userId) : null,
    tenantSlug ? Tenant.findOne({ where: { slug: tenantSlug } }) : null,
  ]);

  const modules = tenant ? await TenantModule.findAll({ where: { tenantId: tenant.id } }) : [];

  /*
   * Qué demos EXISTEN de verdad, para las pestañas de arriba.
   *
   * La lista de `lib/demo/demos.js` es la lista blanca de lo que se puede pedir,
   * no la de lo que hay montado: el código viaja en el despliegue y las cuentas
   * se siembran después, con `scripts/crear-demos-por-oficio.js`. Entre las dos
   * cosas —y en cualquier entorno donde solo esté la general— las pestañas
   * habrían ofrecido demos que responden 404. Una pestaña que no lleva a ningún
   * sitio en el escaparate público es peor que no tenerla.
   *
   * Una consulta más, y SOLO estando dentro de una demo: en el CRM de un cliente
   * real esto no se ejecuta.
   */
  const demosDisponibles = esSlugDemo(tenantSlug)
    ? (
        await Tenant.findAll({
          where: { slug: DEMO_SLUGS, status: "active" },
          attributes: ["slug"],
        })
      ).map((t) => t.slug)
    : [];

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
      demosDisponibles={demosDisponibles}
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
