import { cache } from "react";
import { headers } from "next/headers";

import ClientesClient from "./ClientesClient.jsx";
import { getMasterModels } from "../../../lib/db/masterDb.js";
import { perfilDeAlta } from "../../../lib/clients/formularioAlta.js";
import { vocabularioCliente } from "../../../lib/clients/vocabulario.js";

/**
 * El formulario de alta se adapta a lo que el cliente tiene contratado
 * (01/08/2026): un centro de salud no pregunta «producto de interés», y en
 * cambio da de alta pacientes en el mismo mostrador. Desde el 04/08/2026 de lo
 * mismo sale CÓMO SE LLAMA la pantalla: en una consulta de nutrición son
 * pacientes, no clientes (`lib/clients/vocabulario.js`).
 *
 * Se resuelve aquí, en el servidor, por lo mismo que en Documentos: la pantalla
 * es un componente de cliente y no puede preguntar por los módulos del tenant
 * sin exponérselos al navegador.
 *
 * `cache` de React resuelve los módulos UNA sola vez por petición, aunque los
 * pidan tanto el <title> de la pestaña como la propia página.
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
    // Ante la duda, el formulario de siempre: preguntar de más en el mostrador
    // se arregla ignorando un campo; preguntar de menos, volviendo a llamar a
    // la familia.
    return new Set();
  }
});

export async function generateMetadata() {
  const headersList = await headers();
  const activos = await modulosActivos(headersList.get("x-tenant"));
  return { title: vocabularioCliente((k) => activos.has(k)).plural };
}

export default async function ClientesPage() {
  const headersList = await headers();
  const activos = await modulosActivos(headersList.get("x-tenant"));
  const tieneModulo = (k) => activos.has(k);

  return (
    <ClientesClient
      perfil={perfilDeAlta(tieneModulo)}
      conPacientes={activos.has("pacientes")}
      conListaEspera={activos.has("clients_avanzado")}
      vocab={vocabularioCliente(tieneModulo)}
    />
  );
}
