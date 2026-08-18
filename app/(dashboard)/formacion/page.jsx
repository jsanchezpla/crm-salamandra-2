import { headers } from "next/headers";

import FormacionOverview from "../../../modules/training/FormacionOverview.jsx";
import { getMasterModels } from "../../../lib/db/masterDb.js";
import { esFormacionAbierta } from "../../../lib/training/formacionAbierta.js";

/*
 * Aquí había un mapa `UI_OVERRIDES` con la portada propia de Aumenta
 * (`modules/overrides/aumenta/FormacionOverview.jsx`): la base recortada —sin
 * Empresas ni Cuestionarios ni sincronizar con WordPress— y con sus frases. Se
 * fue el 18/08/2026 (Jorge: «que no sea override y sea el base»): la portada
 * base sabe pintarse «abierta» y lo decide un interruptor por cliente,
 * `featureFlags.formacionAbierta` del módulo `training`
 * (`lib/training/formacionAbierta.js`, donde está explicado por qué es un
 * interruptor y no las banderas viejas de `logicOverrides`).
 *
 * nutri_laura ve la portada completa a propósito (lo pidió); su override
 * anterior se eliminó por eso.
 */

/**
 * Las frases que solo son de un cliente (peldaño 1 de la regla #16, CLAUDE.md).
 * Aumenta habla de su centro; nadie más diría esto. Lo demás —qué se enseña y
 * qué no— no va por slug: va por el interruptor.
 */
const TEXTOS_POR_TENANT = {
  aumenta: {
    tituloSufijo: "— cursos para familias y profesionales",
    intro:
      "Cursos abiertos del centro: del espectro autista al TDAH, de la regulación emocional al autocuidado de quien cuida. Inscripciones individuales, sin empresas intermediarias.",
    descCursos: "Catálogo de cursos abiertos a familias y profesionales.",
    descAlumnos: "Familias y profesionales matriculados en cursos abiertos.",
    descMatriculas: "Quién está apuntado a qué curso.",
  },
};

export const metadata = { title: "Formación" };

export default async function FormacionPage() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");

  // ¿Formación abierta? Se lee AQUÍ, en el servidor, del módulo `training` del
  // tenant. Ante la duda —sin tenant, sin fila, error— NO: la portada completa
  // es la de siempre y nadie la pierde por un fallo de lectura.
  let abierta = false;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = tenantSlug ? await Tenant.findOne({ where: { slug: tenantSlug } }) : null;
    if (tenant) {
      const training = await TenantModule.findOne({ where: { tenantId: tenant.id, moduleKey: "training" } });
      abierta = esFormacionAbierta(training?.featureFlags);
    }
  } catch {
    abierta = false;
  }

  return <FormacionOverview abierta={abierta} textos={TEXTOS_POR_TENANT[tenantSlug]} />;
}
