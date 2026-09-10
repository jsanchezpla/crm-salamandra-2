import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import CorreoModule from "../../../modules/correo/CorreoModule.jsx";
import { getMasterModels } from "../../../lib/db/masterDb.js";
import { vocabularioCliente } from "../../../lib/clients/vocabulario.js";
import { puedeUsarCorreo } from "../../../lib/correo/quienEscribe.js";

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
 *
 * ── Y ADEMÁS, QUIÉN MIRA (10/09/2026) ──────────────────────────────────────
 * Desde que Correo puede ser «solo de oficina» en un centro
 * (`lib/correo/quienEscribe.js`), esta pantalla tiene que decidir LO MISMO que
 * el menú y que los siete endpoints de `/api/correo/*`. Sin esto sería la
 * única puerta que no sabe quién está llamando: a quien no le toca se le
 * pintaría la pantalla entera y se enteraría solo al recibir siete 403.
 *
 * Por eso se lee también el usuario: sus módulos son los del centro ∩ su
 * `moduleAccess`, la misma intersección que hace `hasModule` en el servidor.
 */
const quienMira = cache(async (slug, userId) => {
  // Ante la duda, la pantalla genérica y sin cerrar la puerta: «Clientes» es
  // correcto en casi todos los centros, los extras (filtros, tutores)
  // simplemente no se pintan, y un tropiezo de la base de datos no puede dejar
  // a nadie fuera de una pantalla que sí es suya.
  const aCiegas = { activos: new Set(), role: null, hasModule: () => false, hasFeatureFlag: () => false };
  if (!slug) return aCiegas;
  try {
    const { Tenant, TenantModule, User } = getMasterModels();
    const tenant = await Tenant.findOne({ where: { slug } });
    if (!tenant) return aCiegas;
    const filas = await TenantModule.findAll({ where: { tenantId: tenant.id } });
    const activos = new Set(filas.filter((f) => f.enabled).map((f) => f.moduleKey));

    const user = userId ? await User.findByPk(userId) : null;
    const acceso = Array.isArray(user?.moduleAccess) ? user.moduleAccess : null;
    // Comodín: superadmin o `moduleAccess` con "all". Sin usuario no se
    // restringe (el gate de verdad son los endpoints).
    const comodin = !user || user.role === "superadmin" || (acceso?.includes("all") ?? false);

    return {
      activos,
      role: user?.role ?? null,
      hasModule: (k) => activos.has(k) && (comodin || (acceso !== null && acceso.includes(k))),
      hasFeatureFlag: (moduleKey, flagKey) =>
        !!filas.find((f) => f.moduleKey === moduleKey)?.featureFlags?.[flagKey],
    };
  } catch {
    return aCiegas;
  }
});

export const metadata = { title: "Correo" };

export default async function CorreoPage() {
  const headersList = await headers();
  const quien = await quienMira(headersList.get("x-tenant"), headersList.get("x-user-id"));
  const activos = quien.activos;
  const tieneModulo = (k) => activos.has(k);

  // `activos.size` es el escape del párrafo de arriba: si no se ha podido leer
  // el centro, no se cierra nada. Es el mismo criterio que el menú.
  if (activos.size && !puedeUsarCorreo(quien)) notFound();

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
