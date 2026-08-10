import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getMasterModels } from "../../../../lib/db/masterDb.js";

/**
 * «Citas sin profesional» es una pantalla de CITAS que sin EQUIPO no hace nada.
 *
 * Lo único que se hace en ella es asignar la cita a una compañera, y esa lista
 * sale de /api/team, que corta con `hasModule("team")`. A Healim, que tiene la
 * agenda y no el equipo, la pantalla le cargaba entera con el desplegable de
 * profesionales vacío. Y peor: sin `team` tampoco puede dar de alta a nadie, así
 * que ninguna de sus citas tiene profesional y el listado sería su agenda
 * completa pidiendo a gritos que se asigne a alguien que no existe.
 *
 * Se comprueba en el SERVIDOR por lo mismo que en la lista de espera de admisión
 * (app/(dashboard)/clientes/lista-espera/page.jsx): la pantalla es un componente
 * de cliente y no puede preguntar por los módulos del tenant sin exponérselos al
 * navegador. Y `notFound()` en vez de un cartel de «tu plan no lo incluye»: para
 * quien no lo tiene, la pantalla no existe.
 *
 * Va en un `layout` y no dentro de la página —que es la forma de la vecina— para
 * no tener que partir en servidor + cliente una pantalla de 238 líneas que ya
 * está en uso en Aumenta. El layout envuelve al page.jsx de al lado y corta
 * antes de que se monte nada, que es lo que se buscaba.
 *
 * Mira el módulo del TENANT y no el `moduleAccess` del usuario, igual que la
 * vecina: cerrarle la pantalla a un centro que sí la tiene contratada sería peor
 * que enseñarla de más, y la API sigue siendo la puerta de verdad.
 *
 * La clave va como literal porque MODULE_KEYS todavía no tiene `team` (su propio
 * comentario deja centralizar las demás en el backlog), y el Sidebar también la
 * escribe a mano.
 */
export default async function SinProfesionalLayout({ children }) {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");

  let activo = false;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = slug ? await Tenant.findOne({ where: { slug } }) : null;
    if (tenant) {
      const fila = await TenantModule.findOne({
        where: { tenantId: tenant.id, moduleKey: "team" },
      });
      activo = !!fila?.enabled;
    }
  } catch {
    // Ante la duda, cerrado: mismo criterio que la lista de espera. Si master no
    // contesta no contesta para nadie (el layout del dashboard lee de ahí antes
    // que esto), y esta pantalla sin /api/team solo sabría enseñar un
    // desplegable vacío.
    activo = false;
  }

  if (!activo) notFound();
  return children;
}
