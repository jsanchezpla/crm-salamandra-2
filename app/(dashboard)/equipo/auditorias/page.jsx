import { headers } from "next/headers";
import { notFound } from "next/navigation";

import AuditoriasClient from "./AuditoriasClient.jsx";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { MODULE_KEYS } from "../../../../lib/tenant/moduleKeys.js";

export const metadata = { title: "Auditorías de desempeño" };

/**
 * Auditorías de desempeño (09/09/2026, AV-0100 de Aumenta).
 *
 * Se comprueba el módulo AQUÍ, en el servidor, por lo mismo que en «Fichas a
 * completar» y en Documentos: la pantalla es un componente de cliente y no puede
 * preguntar por los módulos del tenant sin exponérselos al navegador. Y
 * `notFound()` en vez de un cartel de «tu plan no lo incluye»: para quien no lo
 * tiene, la pantalla no existe.
 *
 * Exige `auditorias` Y `team`, igual que el endpoint: toda auditoría es de
 * alguien de la plantilla.
 */
export default async function AuditoriasPage() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");

  let activo = false;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = slug ? await Tenant.findOne({ where: { slug } }) : null;
    if (tenant) {
      const filas = await TenantModule.findAll({
        where: { tenantId: tenant.id },
        attributes: ["moduleKey", "enabled"],
      });
      const encendidos = new Set(filas.filter((f) => f.enabled).map((f) => f.moduleKey));
      activo = encendidos.has(MODULE_KEYS.AUDITORIAS) && encendidos.has("team");
    }
  } catch {
    // Ante la duda, cerrado: la API gatea igual, así que enseñar la pantalla
    // solo serviría para que diera 403 al cargar.
    activo = false;
  }

  if (!activo) notFound();
  return <AuditoriasClient />;
}
