import { headers } from "next/headers";
import { notFound } from "next/navigation";

import ListaEsperaClient from "./ListaEsperaClient.jsx";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { MODULE_KEYS } from "../../../../lib/tenant/moduleKeys.js";

export const metadata = { title: "Lista de espera" };

/**
 * La lista de espera de ADMISIÓN es de `clients_avanzado`, no de `clients`
 * (01/08/2026): un centro de nutrición no reparte plazas por cola.
 *
 * Se comprueba aquí, en el servidor, por lo mismo que en Documentos: la
 * pantalla es un componente de cliente y no puede preguntar por los módulos del
 * tenant sin exponérselos al navegador. Y `notFound()` en vez de un cartel de
 * «tu plan no lo incluye»: para quien no lo tiene, la pantalla no existe.
 */
export default async function ListaEsperaPage() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");

  let activo = false;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = slug ? await Tenant.findOne({ where: { slug } }) : null;
    if (tenant) {
      const fila = await TenantModule.findOne({
        where: { tenantId: tenant.id, moduleKey: MODULE_KEYS.CLIENTS_AVANZADO },
      });
      activo = !!fila?.enabled;
    }
  } catch {
    // Ante la duda, cerrado: la API gatea igual, así que enseñar la pantalla
    // solo serviría para que diera 403 al cargar.
    activo = false;
  }

  if (!activo) notFound();
  return <ListaEsperaClient />;
}
