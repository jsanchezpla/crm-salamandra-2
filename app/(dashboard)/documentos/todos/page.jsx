import { headers } from "next/headers";
import { redirect } from "next/navigation";

import TodosLosDocumentosModule from "../../../../modules/documents/TodosLosDocumentosModule.jsx";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { MODULE_KEYS } from "../../../../lib/tenant/moduleKeys.js";

export const metadata = { title: "Todos los documentos" };

/**
 * El archivo completo, agolpado y con buscador (Rodrigo, 30/08/2026): la
 * portada de /documentos enseña las carpetas y solo los primeros archivos;
 * aquí se ve TODO —también lo que está dentro de carpetas— y se busca por
 * nombre. Mismo gateo que la portada: sin `documents_avanzado` no hay archivo
 * que enseñar (los endpoints responderían 403), así que de vuelta a /documentos.
 */
export default async function TodosLosDocumentosPage({ searchParams }) {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");

  let avanzado = false;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = slug ? await Tenant.findOne({ where: { slug } }) : null;
    if (tenant) {
      const fila = await TenantModule.findOne({
        where: { tenantId: tenant.id, moduleKey: MODULE_KEYS.DOCUMENTS_AVANZADO },
      });
      avanzado = !!fila?.enabled;
    }
  } catch {
    avanzado = false;
  }
  if (!avanzado) redirect("/documentos");

  const sp = await searchParams;
  const visibilidadInicial = sp?.visibilidad === "shared" ? "shared" : "private";
  return <TodosLosDocumentosModule visibilidadInicial={visibilidadInicial} />;
}
