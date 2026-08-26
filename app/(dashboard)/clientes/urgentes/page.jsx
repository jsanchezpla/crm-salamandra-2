import { headers } from "next/headers";
import { notFound } from "next/navigation";

import FichasACompletarClient from "./FichasACompletarClient.jsx";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { MODULE_KEYS } from "../../../../lib/tenant/moduleKeys.js";
import { usaEstadoDeFicha } from "../../../../lib/clients/estados.js";

export const metadata = { title: "Fichas a completar" };

/**
 * «Fichas a completar» es de `clients_avanzado`, no de `clients` (Rodrigo,
 * 04/08/2026).
 *
 * Nació con `clients` a secas —cualquiera puede tener la ficha a medias— y por
 * eso le apareció a TODOS los clientes con fichas, incluido nutri_laura. Pero
 * la pantalla no resuelve «me falta un teléfono»: resuelve el problema de un
 * centro que importó 1.083 familias y arrastra miles de huecos. A una consulta
 * de una persona, que conoce a sus pacientes por el nombre, le sobra.
 *
 * Se comprueba aquí, en el servidor, por lo mismo que en Lista de espera y en
 * Documentos: la pantalla es un componente de cliente y no puede preguntar por
 * los módulos del tenant sin exponérselos al navegador. Y `notFound()` en vez
 * de un cartel de «tu plan no lo incluye»: para quien no lo tiene, la pantalla
 * no existe.
 */
export default async function FichasACompletarPage() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");

  let activo = false;
  // Y si esta ficha tiene estado propio («Activo / No vino / Baja») o el embudo
  // comercial. Se resuelve aquí, en el servidor, por lo mismo que el módulo: la
  // pantalla es de cliente y no puede preguntar por los módulos del tenant.
  let conEstado = false;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = slug ? await Tenant.findOne({ where: { slug } }) : null;
    if (tenant) {
      const filas = await TenantModule.findAll({
        where: { tenantId: tenant.id },
        attributes: ["moduleKey", "enabled"],
      });
      const encendidos = new Set(filas.filter((f) => f.enabled).map((f) => f.moduleKey));
      activo = encendidos.has(MODULE_KEYS.CLIENTS_AVANZADO);
      conEstado = usaEstadoDeFicha((k) => encendidos.has(k));
    }
  } catch {
    // Ante la duda, cerrado: la API gatea igual, así que enseñar la pantalla
    // solo serviría para que diera 403 al cargar.
    activo = false;
    conEstado = false;
  }

  if (!activo) notFound();
  return <FichasACompletarClient conEstado={conEstado} />;
}
