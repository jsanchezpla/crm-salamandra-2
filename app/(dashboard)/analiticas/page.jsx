import { headers } from "next/headers";

import AnaliticasModule from "../../../modules/analytics/AnaliticasModule.jsx";

export const metadata = { title: "Analíticas" };

/**
 * Analíticas — visitas de la web del cliente.
 *
 * El rol se lee aquí (servidor) y baja como un simple booleano: la pantalla solo
 * lo usa para decidir si enseña las instrucciones de conexión o remite al
 * administrador. El candado de verdad está en /api/analiticas y en
 * /api/tenant/settings, no en esta bandera.
 *
 * `x-user-role` la pone el middleware y `withTenant` la refresca contra la base
 * de datos en las rutas de API (ver lib/tenant/withTenant.js).
 */
export default async function AnaliticasPage() {
  const headersList = await headers();
  const rol = headersList.get("x-user-role");
  const esAdmin = rol === "admin" || rol === "superadmin";

  return <AnaliticasModule esAdmin={esAdmin} />;
}
