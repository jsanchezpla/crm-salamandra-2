import { cache } from "react";
import { headers } from "next/headers";

import DefaultClientDetailModule from "../../../../modules/default/ClientDetailModule.jsx";
import NutriLauraClientDetailModule from "../../../../modules/overrides/nutri-laura/ClientDetailModule.jsx";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { perfilDeAlta, PERFIL_COMERCIAL } from "../../../../lib/clients/formularioAlta.js";
import { fichaSegunModulos, PIEZAS_NINGUNA, textosPiezas } from "../../../../lib/clients/piezasFicha.js";
import { vocabularioCliente } from "../../../../lib/clients/vocabulario.js";

/**
 * Los módulos activos del tenant, UNA vez por petición.
 *
 * Estaba escrito dentro de la página; sale aquí porque desde el 24/08/2026 lo
 * necesita también el `<title>` de la pestaña, y `cache` de React evita que se
 * pregunten dos veces. Mismo patrón que en la lista de clientes.
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
    return new Set();
  }
});

const UI_OVERRIDES = {
  nutri_laura: NutriLauraClientDetailModule,
};

const TENANT_TITLE_OVERRIDES = {
  nutri_laura: "Paciente",
};

/**
 * El título de la pestaña del navegador tenía «Cliente» a fuego, con una única
 * excepción por slug. La lista sí usa el vocabulario del tenant, así que en
 * Laura Úbeda se leía «Contratantes» en la lista y «Cliente» al abrir una
 * ficha (24/08/2026). Se resuelve con el MISMO vocabulario que todo lo demás,
 * que además ya se decide por módulo; el mapa por slug se conserva porque
 * `nutri_laura` dice «Paciente» en singular por su propio motivo.
 */
export async function generateMetadata() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");
  if (TENANT_TITLE_OVERRIDES[slug]) return { title: TENANT_TITLE_OVERRIDES[slug] };
  const activos = await modulosActivos(slug);
  const vocab = vocabularioCliente((k) => activos.has(k));
  return { title: vocab.singular.charAt(0).toUpperCase() + vocab.singular.slice(1) };
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
  // El «Tipo» del contratante (festival / sala / ayuntamiento / medio…): la
  // MISMA pregunta que hace la lista, para que la ficha y el listado no puedan
  // discrepar en si ese campo existe.
  let conCategoria = false;
  // Qué paneles de consulta monta la ficha (Notas, Documentos, la lista de
  // citas) y con qué palabras: `lib/clients/piezasFicha.js`, por módulos. Ante
  // la duda, ninguno: una pestaña de menos se echa de menos; una de más en el
  // cliente equivocado —Aumenta— es un cambio que nadie pidió.
  let piezas = PIEZAS_NINGUNA;
  let textos = textosPiezas();
  try {
    const activos = await modulosActivos(tenantSlug);
    if (activos.size) {
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
      conCategoria = activos.has("booking");
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
      conCategoria={conCategoria}
      piezas={piezas}
      textos={textos}
    />
  );
}
