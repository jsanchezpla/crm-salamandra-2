import { cache } from "react";
import { headers } from "next/headers";

import ClientesClient from "./ClientesClient.jsx";
import { getMasterModels } from "../../../lib/db/masterDb.js";
import { perfilDeAlta } from "../../../lib/clients/formularioAlta.js";
import { vocabularioCliente } from "../../../lib/clients/vocabulario.js";
import { altaEmpiezaPorElPaciente, MODULO_ALTA_POR_PACIENTE } from "../../../lib/clients/altaPorPaciente.js";

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
const modulosDelTenant = cache(async (slug) => {
  const vacio = { activos: new Set(), banderas: {} };
  if (!slug) return vacio;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = await Tenant.findOne({ where: { slug } });
    if (!tenant) return vacio;
    const filas = await TenantModule.findAll({ where: { tenantId: tenant.id } });
    const vivas = filas.filter((f) => f.enabled);
    return {
      activos: new Set(vivas.map((f) => f.moduleKey)),
      // Los interruptores de cada módulo (peldaño 3 de la regla 16): hoy solo
      // lee uno esta pantalla, `pacientes.altaPorPaciente`.
      banderas: Object.fromEntries(vivas.map((f) => [f.moduleKey, f.featureFlags ?? {}])),
    };
  } catch {
    // Ante la duda, el formulario de siempre: preguntar de más en el mostrador
    // se arregla ignorando un campo; preguntar de menos, volviendo a llamar a
    // la familia.
    return vacio;
  }
});
const modulosActivos = async (slug) => (await modulosDelTenant(slug)).activos;

export async function generateMetadata() {
  const headersList = await headers();
  const activos = await modulosActivos(headersList.get("x-tenant"));
  return { title: vocabularioCliente((k) => activos.has(k)).plural };
}

export default async function ClientesPage({ searchParams }) {
  const headersList = await headers();
  const { activos, banderas } = await modulosDelTenant(headersList.get("x-tenant"));
  const tieneModulo = (k) => activos.has(k);
  // `/clientes?alta=1` abre el alta nada más entrar (desde «Dar de alta desde
  // Clientes» de Pacientes, 07/09/2026).
  const sp = (await searchParams) ?? {};
  const abrirAlta = sp.alta === "1";

  return (
    <ClientesClient
      perfil={perfilDeAlta(tieneModulo)}
      conPacientes={activos.has("pacientes")}
      // El alta que empieza por el paciente (AV-0051 de Aumenta, 07/09/2026):
      // interruptor del módulo `pacientes`, ver lib/clients/altaPorPaciente.js.
      altaPorPaciente={activos.has("pacientes") && altaEmpiezaPorElPaciente(banderas[MODULO_ALTA_POR_PACIENTE])}
      abrirAlta={abrirAlta}
      conListaEspera={activos.has("clients_avanzado")}
      // A nombre de quién se factura: solo tiene sentido donde se factura.
      conFacturacion={activos.has("billing")}
      // La categoría del contratante (festival / sala / ayuntamiento / medio…)
      // solo existe con `booking`: en una clínica no significa nada y una
      // columna de más en una lista de 1.800 familias es ruido puro.
      conCategoria={activos.has("booking")}
      vocab={vocabularioCliente(tieneModulo)}
    />
  );
}
