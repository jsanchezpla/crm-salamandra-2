import { headers } from "next/headers";
import { notFound } from "next/navigation";

import FichajeModule from "../../../../modules/fichaje/FichajeModule.jsx";
import { getMasterModels } from "../../../../lib/db/masterDb.js";

export const metadata = { title: "Fichaje" };

/**
 * /equipo/fichaje — control horario.
 *
 * Gatea las TRES puertas, como «Fichas a completar» (CLAUDE.md): el menú, ESTA
 * página y el endpoint. Solo con el menú no basta — con la URL guardada se
 * seguiría llegando, y aquí hay datos laborales de personas concretas.
 */
export default async function FichajePage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  const rol = headersList.get("x-user-role");

  if (rol !== "admin" && rol !== "superadmin") notFound();

  let tiene = false;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = tenantSlug ? await Tenant.findOne({ where: { slug: tenantSlug } }) : null;
    if (tenant) {
      const fila = await TenantModule.findOne({ where: { tenantId: tenant.id, moduleKey: "fichaje" } });
      tiene = Boolean(fila?.enabled);
    }
  } catch {
    tiene = false;
  }
  if (!tiene) notFound();

  return <FichajeModule />;
}
