import { headers } from "next/headers";
import { etapasDe } from "../../../lib/leads/embudos.js";
import { STAGE_LABELS } from "../../../lib/leads/stages.js";
import { getMasterModels } from "../../../lib/db/masterDb.js";

import DefaultLeadsModule from "../../../modules/leads/LeadsModule.jsx";
import RetorikaLeadsModule from "../../../modules/overrides/retorika/LeadsModule.jsx";
import AumentaLeadsModule from "../../../modules/overrides/aumenta/LeadsModule.jsx";
import SpainEnzymesLeadsModule from "../../../modules/overrides/spain-enzymes/LeadsModule.jsx";
import NutriLauraLeadsModule from "../../../modules/overrides/nutri-laura/LeadsModule.jsx";

// Los overrides de `quality_energy` y `abarcaia` se fueron con sus clientes el
// 12/08/2026: los dos se dieron de baja y su schema se destruyó. Quien no está
// en este mapa usa el módulo por defecto.
//
// Los de `demo` y `sandbox` se fueron el 18/08/2026, la tarde en que el módulo
// base pasó a ser el de aumenta parametrizado: los dos eran copias del de
// aumenta (la demo, una versión anterior; sandbox, la misma recoloreada), sin
// una etapa, un endpoint ni un texto propios, y `sandbox` ni siquiera existe
// como tenant en ningún entorno. La demo enseña ahora el embudo por defecto,
// que es lo que verá quien la mire para comprar. Aumenta conserva el suyo a
// propósito (decisión de Jorge, 18/08): lo único que la separa del base es el
// rosa #FF1F96 escrito a fuego, y no se le cambia la pantalla sin que lo pida.
const UI_OVERRIDES = {
  retorika: RetorikaLeadsModule,
  aumenta: AumentaLeadsModule,
  spain_enzymes: SpainEnzymesLeadsModule,
  nutri_laura: NutriLauraLeadsModule,
};

const TENANT_TITLE_OVERRIDES = {
  aumenta: "Interesados",
};

/**
 * `hasModule` para un componente de servidor, que no tiene `request` y por
 * tanto no puede usar `getTenantContext`. Devuelve una función que responde
 * `false` a todo si el tenant no se resuelve o la consulta falla: el embudo por
 * defecto es la caída correcta, y una excepción aquí dejaría a todo el mundo
 * sin la pantalla de Leads por un módulo que casi nadie tiene.
 */
async function cargarTieneModulo(slug) {
  if (!slug) return () => false;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = await Tenant.findOne({ where: { slug }, attributes: ["id"] });
    if (!tenant) return () => false;
    const filas = await TenantModule.findAll({
      where: { tenantId: tenant.id, enabled: true },
      attributes: ["moduleKey"],
    });
    const activos = new Set(filas.map((m) => m.moduleKey));
    return (clave) => activos.has(clave);
  } catch {
    return () => false;
  }
}

/**
 * Cómo se llama el embudo en esta casa.
 *
 * El mapa de arriba es por CLIENTE y se queda como está. Lo de `booking` va por
 * MÓDULO, igual que su embudo: quien contrata bolos no tiene «leads», tiene
 * propuestas mandadas a un festival para una fecha concreta. El slug manda
 * sobre el módulo, por si algún día un cliente con nombre propio lo compra.
 */
function tituloDe(slug, tieneModulo) {
  if (TENANT_TITLE_OVERRIDES[slug]) return TENANT_TITLE_OVERRIDES[slug];
  if (typeof tieneModulo === "function" && tieneModulo("booking")) return "Propuestas";
  return "Leads Profesionales";
}

export async function generateMetadata() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");
  return { title: tituloDe(slug, await cargarTieneModulo(slug)) };
}

export default async function LeadsPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");

  const LeadsModule = (tenantSlug && UI_OVERRIDES[tenantSlug]) || DefaultLeadsModule;

  // El módulo por defecto recibe su embudo desde `lib/leads/embudos.js` —la
  // única fuente que también conoce el servidor, y la que vigila
  // `_smoke-leads-etapas.mjs`— y los rótulos canónicos de `stages.js`. Es un
  // componente "use client": no puede importar nada de /lib que toque la
  // base, así que se le da ya resuelto. Los overrides ignoran estas props:
  // llevan su embudo escrito dentro, y así se quedan (CLAUDE.md, «En Leads la
  // pirámide está al revés»).
  // Qué módulos tiene, para que `etapasDe` pueda decidir por módulo y no solo
  // por slug (lo pide el embudo de `booking`, 24/08/2026). Se pregunta aquí y
  // no en el layout porque es la única pantalla que lo necesita, y si el tenant
  // no se resuelve se sigue adelante sin módulos: el embudo por defecto es una
  // respuesta válida, quedarse sin pantalla no.
  const tieneModulo = await cargarTieneModulo(tenantSlug);

  const stages = etapasDe(tenantSlug, tieneModulo).map((key) => ({ key, label: STAGE_LABELS[key] ?? key }));
  const titulo = tituloDe(tenantSlug, tieneModulo);
  const sujeto = titulo === "Leads Profesionales" ? "leads" : titulo.toLowerCase();

  // En booking los leads NO llegan por la web: los manda la representante, uno
  // a uno, a un festival concreto para una fecha concreta. Dejar el texto de
  // siempre sería decirle que espere solicitudes que no van a llegar.
  const descripcion = tieneModulo("booking")
    ? "Propuestas mandadas a festivales, salas y ayuntamientos."
    : undefined;

  // Falso positivo de react-hooks/static-components: es el override de UI por
  // tenant (CLAUDE.md). El componente sale de un mapa de MÓDULO, así que su
  // identidad es estable, y además esto es un componente de SERVIDOR: se
  // renderiza una vez por petición, no hay remontaje posible.
  // eslint-disable-next-line react-hooks/static-components
  return <LeadsModule stages={stages} titulo={titulo} sujeto={sujeto} descripcion={descripcion} />;
}
