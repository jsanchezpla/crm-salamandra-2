import { headers } from "next/headers";

import CitasModule from "../../../modules/default/CitasModule.jsx";

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

export async function generateMetadata() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");
  return { title: TENANT_TITLE_OVERRIDES[slug] ?? "Citas" };
}

export default async function CitasPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  const Component = (tenantSlug && UI_OVERRIDES[tenantSlug]) || CitasModule;
  return <Component />;
}
