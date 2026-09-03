import { cache } from "react";
import { headers } from "next/headers";

import CitasModule from "../../../modules/default/CitasModule.jsx";
import { getMasterModels } from "../../../lib/db/masterDb.js";
import { vocabularioCliente } from "../../../lib/clients/vocabulario.js";
import { VOCABULARIO_MIEMBRO, vocabularioEquipo } from "../../../lib/team/vocabulario.js";

/**
 * Página de Citas.
 *
 * Desde 2026-07-22 hay UN solo módulo para todos: el default trae calendario,
 * lista de espera (con globito de pendientes), alta manual con buscador de
 * clientes, enlace cita↔ficha, y asignación de terapeuta y paciente. Antes
 * `nutri_laura` tenía un override con la lista de espera y el resto de tenants
 * un módulo simple sin ella; se fundieron en el default para que la lista de
 * espera y el enlace a la ficha sean lo general.
 *
 * El mapa se conserva vacío para cuando algún tenant necesite un override real
 * (p. ej. Aumenta pidió a futuro lista de espera POR SECTORES).
 */
const UI_OVERRIDES = {};

// Título por tenant (cosmético): en nutri_laura la sección se llama "Agenda".
const TENANT_TITLE_OVERRIDES = {
  nutri_laura: "Agenda",
};

/**
 * Cuentas GENERALES: la demo de todo y el sandbox tienen todos los módulos
 * encendidos, Clínica incluida, y por módulo saldrían hablando de
 * «terapeutas» (`lib/team/vocabulario.js`). No son una clínica: son el
 * escaparate, y Rodrigo (03/09/2026) quiere ahí el nombre neutro, «miembro».
 * Las demos de UN sector (demo_clinica, demo_nutricion…) no van aquí: en la
 * de clínica, «terapeuta» es justo lo que el prospecto espera oír.
 */
const CUENTAS_GENERALES = new Set(["demo", "sandbox"]);

/**
 * Qué módulos tiene el centro, resuelto AQUÍ (27/08/2026).
 *
 * `CitasModule` es un "use client" y no puede preguntarlo. Lo necesita para dos
 * cosas del botón que lleva de una cita a la ficha (`lib/citas/fichaDeLaCita.js`):
 * si el centro tiene Clientes —o el botón llevaría a una pantalla que no
 * existe— y CÓMO se llama esa ficha, que en una consulta de nutrición es la de
 * la paciente y no la de un cliente.
 *
 * Mismo patrón que Configuración y la pantalla de Clientes; `cache` de React lo
 * resuelve una sola vez por petición aunque lo pidan el <title> y la página.
 * Si la consulta falla, `null`: entonces no se enseña el botón. Uno que no lleva
 * a ningún sitio es peor que no tenerlo.
 */
const modulosActivos = cache(async (slug) => {
  if (!slug) return null;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = await Tenant.findOne({ where: { slug } });
    if (!tenant) return null;
    const filas = await TenantModule.findAll({ where: { tenantId: tenant.id } });
    return new Set(filas.filter((f) => f.enabled).map((f) => f.moduleKey));
  } catch {
    return null;
  }
});

export async function generateMetadata() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");
  return { title: TENANT_TITLE_OVERRIDES[slug] ?? "Citas" };
}

export default async function CitasPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  const Component = (tenantSlug && UI_OVERRIDES[tenantSlug]) || CitasModule;

  const activos = await modulosActivos(tenantSlug);
  // `null` = no se pudo averiguar. Se trata como «no lo tiene»: ver arriba.
  const conClientes = activos?.has("clients") === true;
  const vocabulario = vocabularioCliente((k) => activos?.has(k) === true);
  const vocabularioEquipoDelCentro = CUENTAS_GENERALES.has(tenantSlug)
    ? VOCABULARIO_MIEMBRO
    : vocabularioEquipo((k) => activos?.has(k) === true);

  // Falso positivo de react-hooks/static-components: es el override de UI por
  // tenant (CLAUDE.md). El componente sale de un mapa de MÓDULO, así que su
  // identidad es estable, y además esto es un componente de SERVIDOR: se
  // renderiza una vez por petición, no hay remontaje posible.
  // eslint-disable-next-line react-hooks/static-components
  return <Component conClientes={conClientes} vocabulario={vocabulario} vocabularioEquipo={vocabularioEquipoDelCentro} />;
}
