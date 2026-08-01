import { headers } from "next/headers";

import ClientesClient from "./ClientesClient.jsx";
import { getMasterModels } from "../../../lib/db/masterDb.js";
import { perfilDeAlta, PERFIL_COMERCIAL } from "../../../lib/clients/formularioAlta.js";

export const metadata = { title: "Clientes" };

/**
 * El formulario de alta se adapta a lo que el cliente tiene contratado
 * (01/08/2026): un centro de salud no pregunta «producto de interés», y en
 * cambio da de alta pacientes en el mismo mostrador.
 *
 * Se resuelve aquí, en el servidor, por lo mismo que en Documentos: la pantalla
 * es un componente de cliente y no puede preguntar por los módulos del tenant
 * sin exponérselos al navegador.
 */
export default async function ClientesPage() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");

  let perfil = PERFIL_COMERCIAL;
  let conPacientes = false;
  let conListaEspera = false;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = slug ? await Tenant.findOne({ where: { slug } }) : null;
    if (tenant) {
      const filas = await TenantModule.findAll({ where: { tenantId: tenant.id } });
      const activos = new Set(filas.filter((f) => f.enabled).map((f) => f.moduleKey));
      perfil = perfilDeAlta((k) => activos.has(k));
      conPacientes = activos.has("pacientes");
      conListaEspera = activos.has("clients_avanzado");
    }
  } catch {
    // Ante la duda, el formulario de siempre: preguntar de más en el mostrador
    // se arregla ignorando un campo; preguntar de menos, volviendo a llamar a
    // la familia.
    perfil = PERFIL_COMERCIAL;
    conPacientes = false;
    conListaEspera = false;
  }

  return <ClientesClient perfil={perfil} conPacientes={conPacientes} conListaEspera={conListaEspera} />;
}
