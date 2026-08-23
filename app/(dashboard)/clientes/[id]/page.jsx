import { headers } from "next/headers";

import DefaultClientDetailModule from "../../../../modules/default/ClientDetailModule.jsx";
import NutriLauraClientDetailModule from "../../../../modules/overrides/nutri-laura/ClientDetailModule.jsx";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { perfilDeAlta, PERFIL_COMERCIAL } from "../../../../lib/clients/formularioAlta.js";
import { fichaSegunModulos, PIEZAS_NINGUNA, textosPiezas } from "../../../../lib/clients/piezasFicha.js";

const UI_OVERRIDES = {
  nutri_laura: NutriLauraClientDetailModule,
};

const TENANT_TITLE_OVERRIDES = {
  nutri_laura: "Paciente",
};

export async function generateMetadata() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");
  return { title: TENANT_TITLE_OVERRIDES[slug] ?? "Cliente" };
}

export default async function ClienteDetailPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  const Component = (tenantSlug && UI_OVERRIDES[tenantSlug]) || DefaultClientDetailModule;

  // El mismo perfil que el alta: la ficha tiene que poder editar lo que
  // recepción acaba de teclear, ni más ni menos. Y con él, si el cliente lleva
  // pacientes: de eso depende que se pregunte el parentesco del titular.
  let perfil = PERFIL_COMERCIAL;
  let conPacientes = false;
  let conFacturacion = false;
  let conNutricion = false;
  // Qué paneles de consulta monta la ficha (Notas, Documentos, la lista de
  // citas) y con qué palabras: `lib/clients/piezasFicha.js`, por módulos. Ante
  // la duda, ninguno: una pestaña de menos se echa de menos; una de más en el
  // cliente equivocado —Aumenta— es un cambio que nadie pidió.
  let piezas = PIEZAS_NINGUNA;
  let textos = textosPiezas();
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = tenantSlug ? await Tenant.findOne({ where: { slug: tenantSlug } }) : null;
    if (tenant) {
      const filas = await TenantModule.findAll({ where: { tenantId: tenant.id } });
      const activos = new Set(filas.filter((f) => f.enabled).map((f) => f.moduleKey));
      const tieneModulo = (k) => activos.has(k);
      perfil = perfilDeAlta(tieneModulo);
      conPacientes = activos.has("pacientes");
      conFacturacion = activos.has("billing");
      // Decide si la ficha lleva pestaña "Pautas". Se resuelve AQUÍ, en el
      // servidor, y no dentro del panel: `ClientPlansPanel` siempre pinta algo
      // —cargando, vacío o el error del 403— así que un cliente sin Nutrición
      // vería la pestaña con «Módulo nutricion no activo» dentro. Es el mismo
      // patrón que `conFacturacion`.
      conNutricion = activos.has("nutricion");
      ({ piezas, textos } = fichaSegunModulos(tieneModulo));
    }
  } catch {
    perfil = PERFIL_COMERCIAL;
    piezas = PIEZAS_NINGUNA;
  }

  // Falso positivo de react-hooks/static-components: es el override de UI por
  // tenant (CLAUDE.md). El componente sale de un mapa de MÓDULO, así que su
  // identidad es estable, y además esto es un componente de SERVIDOR: se
  // renderiza una vez por petición, no hay remontaje posible.
  return (
    // eslint-disable-next-line react-hooks/static-components
    <Component
      perfil={perfil}
      conPacientes={conPacientes}
      conFacturacion={conFacturacion}
      conNutricion={conNutricion}
      piezas={piezas}
      textos={textos}
    />
  );
}
