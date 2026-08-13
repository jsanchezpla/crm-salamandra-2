/**
 * lib/buzon/candadoBackoffice.js — quién puede abrir el buzón por dentro.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten los cuatro endpoints de
 * `/api/admin/buzon`. El `candado(ctx)` de las otras seis pantallas del panel
 * está copiado literal en cada fichero; aquí no se repite porque el de este
 * lleva UN CANDADO MÁS que los demás, y cuatro copias de algo que acaba de
 * añadirse es como se pierden.)
 *
 * ── EL CANDADO DE MÁS, Y POR QUÉ ────────────────────────────────────────────
 * El middleware ya devuelve 404 para `/api/admin` desde el host de los clientes.
 * Pero su matcher (`middleware.js`, al final) excluye las rutas que ACABAN en
 * `.png`, `.jpg`, `.svg`… — y una ruta así no pasa por él: ni reparto por host,
 * ni sello `bo`, ni cabecera `x-user-id`. Y sin `x-user-id`, `hasModule()`
 * concede todos los módulos activos del tenant, porque interpreta la petición
 * como «modo infraestructura» (`tenantResolver.js`).
 *
 * O sea: el candado de módulo, solo, no aguanta una URL con la extensión
 * equivocada. Por eso los adjuntos van por UUID y nunca por nombre de fichero, y
 * por eso aquí se comprueba el host a mano. La cabecera del propio middleware ya
 * lo dice: reduce superficie, NO autoriza.
 */

import { forbidden, notFound } from "../utils/apiResponse.js";
import { isDemoTenant } from "../demo/isDemo.js";
import { esPeticionDeBackoffice } from "../auth/backoffice.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

export function candadoBuzon(request, ctx) {
  // Primero el host: si la petición no viene del back-office, esto no existe.
  // 404 y no 403, para no confirmar que la ruta está ahí.
  if (!esPeticionDeBackoffice(request)) return notFound();
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

/** Quién de nosotros está contestando, para firmar el mensaje. */
export function quienContesta(request, ctx) {
  const email = ctx.user?.email ?? request.headers.get("x-user-email") ?? null;
  // El nombre que se le enseña al cliente. Si no hay correo, «Salamandra» a
  // secas: es preferible a que le llegue una respuesta firmada por «null».
  const nombre = email ? email.split("@")[0] : "Salamandra";
  return { email, nombre };
}
