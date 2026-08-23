import { headers } from "next/headers";
import { notFound } from "next/navigation";

import WhatsappSinAsignarClient from "./WhatsappSinAsignarClient.jsx";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { MODULE_KEYS } from "../../../../lib/tenant/moduleKeys.js";

export const metadata = { title: "WhatsApp sin asignar" };

/**
 * Los WhatsApp que no son de ninguna ficha, para poder asignarlos.
 *
 * Gatea por `clients` a secas, NO por `clients_avanzado` como «Fichas a
 * completar»: aquello resuelve el problema de un centro con miles de huecos
 * importados, y esto resuelve uno que tiene cualquiera que use WhatsApp — que
 * te escriba un número que no está en ninguna ficha. Tampoco se gatea por
 * ningún módulo de WhatsApp porque no existe: es una integración universal
 * (regla #14), y quien no la use no verá nunca la entrada, porque el menú la
 * esconde cuando no hay mensajes sueltos.
 *
 * Se comprueba aquí, en el servidor, por lo mismo que Lista de espera y Fichas
 * a completar: la pantalla es un componente de cliente y no puede preguntar por
 * los módulos del tenant sin exponérselos al navegador. Y `notFound()` en vez
 * de un cartel de «no incluido»: para quien no lo tiene, la pantalla no existe.
 */
export default async function WhatsappSinAsignarPage() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");

  let activo = false;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = slug ? await Tenant.findOne({ where: { slug } }) : null;
    if (tenant) {
      const fila = await TenantModule.findOne({
        where: { tenantId: tenant.id, moduleKey: MODULE_KEYS.CLIENTS },
      });
      activo = !!fila?.enabled;
    }
  } catch {
    // Ante la duda, cerrado: la API gatea igual, así que enseñar la pantalla
    // solo serviría para que diera 403 al cargar.
    activo = false;
  }

  if (!activo) notFound();
  return <WhatsappSinAsignarClient />;
}
