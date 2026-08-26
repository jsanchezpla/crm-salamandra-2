import { cache } from "react";
import { headers } from "next/headers";

import CorreoModule from "../../../modules/correo/CorreoModule.jsx";
import { getMasterModels } from "../../../lib/db/masterDb.js";
import { vocabularioCliente } from "../../../lib/clients/vocabulario.js";

/**
 * La pantalla de Correo habla el idioma de cada centro (26/08/2026, Rodrigo:
 * «tiene que ser neutro en los ejemplos y textos»): la fuente de fichas se
 * rotula «Contratantes» solo donde hay `booking`, «Pacientes» en la consulta
 * de nutrición y «Clientes» en el resto — la misma regla por módulos que la
 * pantalla de Clientes (`lib/clients/vocabulario.js`).
 *
 * Se resuelve aquí, en el servidor, por lo mismo que en Clientes: la pantalla
 * es un componente de cliente y no puede preguntar por los módulos del tenant
 * sin exponérselos al navegador.
 */
const modulosActivos = cache(async (slug) => {
  if (!slug) return new Set();
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = await Tenant.findOne({ where: { slug } });
    if (!tenant) return new Set();
    const filas = await TenantModule.findAll({ where: { tenantId: tenant.id } });
    return new Set(filas.filter((f) => f.enabled).map((f) => f.moduleKey));
  } catch {
    // Ante la duda, la pantalla genérica: «Clientes» es correcto en casi todos
    // los centros, y los extras (filtros, tutores) simplemente no se pintan.
    return new Set();
  }
});

export const metadata = { title: "Correo" };

export default async function CorreoPage() {
  const headersList = await headers();
  const activos = await modulosActivos(headersList.get("x-tenant"));
  const tieneModulo = (k) => activos.has(k);

  return (
    <CorreoModule
      vocab={vocabularioCliente(tieneModulo)}
      // Con `pacientes`, la ficha es una familia: salen sus tutores y el nombre
      // de sus pacientes, y aparecen los filtros por profesional y terapia.
      conPacientes={activos.has("pacientes")}
      conBooking={activos.has("booking")}
      conLeads={activos.has("leads")}
    />
  );
}
