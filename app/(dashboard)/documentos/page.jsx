import { headers } from "next/headers";

import DocumentsModule from "../../../modules/documents/DocumentsModule.jsx";
import { getMasterModels } from "../../../lib/db/masterDb.js";
import { MODULE_KEYS } from "../../../lib/tenant/moduleKeys.js";

export const metadata = { title: "Documentos" };

/**
 * Documentos tiene DOS niveles, como Equipo (01/08/2026):
 *   - `documents`           → básico: solo el Contrato de Prestación de Servicios.
 *   - `documents_avanzado`  → el archivo completo (carpetas, buscador, subida).
 *
 * Quién tiene cuál se resuelve aquí, en el servidor: el módulo es un componente
 * de cliente y no puede preguntarlo por su cuenta sin exponer la lista de
 * módulos del tenant al navegador.
 */
export default async function DocumentosPage() {
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
    // Ante la duda, el básico: enseñar de más el archivo de un cliente sería
    // peor que enseñar de menos.
    avanzado = false;
  }

  return <DocumentsModule avanzado={avanzado} />;
}
