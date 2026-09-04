import { headers } from "next/headers";
import { notFound } from "next/navigation";

import FichajeModule from "../../../../modules/fichaje/FichajeModule.jsx";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { puedeUsarFichaje } from "../../../../lib/fichaje/acceso.js";

export const metadata = { title: "Fichaje" };

/**
 * /equipo/fichaje — control horario.
 *
 * Gatea las TRES puertas, como «Fichas a completar» (CLAUDE.md): el menú, ESTA
 * página y el endpoint. Solo con el menú no basta — con la URL guardada se
 * seguiría llegando, y aquí hay datos laborales de personas concretas.
 *
 * Desde el 04/09/2026 la llave es TENER EL MÓDULO CONCEDIDO y no ser admin
 * (`lib/fichaje/acceso.js`, con el porqué). Esta página necesita entonces dos
 * datos de master: si el tenant lo tiene encendido y qué tiene concedido quien
 * mira — el `x-user-id` que inyecta el middleware, no lo que diga el navegador.
 */
export default async function FichajePage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  const rol = headersList.get("x-user-role");
  const userId = headersList.get("x-user-id");

  let tenantLoTiene = false;
  let moduleAccess = null;
  try {
    const { Tenant, TenantModule, User } = getMasterModels();
    const tenant = tenantSlug ? await Tenant.findOne({ where: { slug: tenantSlug } }) : null;
    if (tenant) {
      const fila = await TenantModule.findOne({ where: { tenantId: tenant.id, moduleKey: "fichaje" } });
      tenantLoTiene = Boolean(fila?.enabled);
    }
    const usuario = userId ? await User.findByPk(userId, { attributes: ["moduleAccess"] }) : null;
    moduleAccess = usuario?.moduleAccess ?? null;
  } catch {
    // Ante la duda, cerrado: la API gatea igual, así que enseñar la pantalla
    // solo serviría para que diera 403 al cargar.
    tenantLoTiene = false;
    moduleAccess = null;
  }

  if (!puedeUsarFichaje({ role: rol, moduleAccess, tenantLoTiene })) notFound();

  return <FichajeModule />;
}
