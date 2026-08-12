import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, errorConDatos, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { catalogoConExigencias } from "../../../../lib/provisioning/dependencias.js";
import { leerTodosLosPaquetes } from "../../../../lib/provisioning/paquetesStore.js";
import { validarPaquete, loQueFalta, serializarPaquete } from "../../../../lib/provisioning/paquetes.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * /api/admin/paquetes — los paquetes de módulos que se ofrecen en el alta.
 *
 *   GET  → los paquetes (todos, activos o no) + el catálogo de módulos
 *   POST → crea uno
 *
 * ── QUÉ ES UN PAQUETE, PARA NO CONFUNDIRSE ──────────────────────────────────
 * Un atajo para marcar casillas al dar de alta un cliente, y NADA MÁS. Ningún
 * cliente «tiene» un paquete: todos tienen una lista de módulos puesta a su
 * gusto (Jorge, 12/08/2026, y así se queda). Por eso editar un paquete aquí no
 * le cambia los módulos a nadie, ni siquiera a quien se dio de alta con él.
 *
 * Hasta hoy estaban escritos en `lib/provisioning/catalogo.js`, así que
 * inventar un tercero era tocar código y desplegar.
 *
 * Mismos tres candados que el resto del back-office. Que el middleware devuelva
 * 404 desde el host de los clientes reduce superficie, no autoriza.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const { paquetes, soloLectura } = await leerTodosLosPaquetes();
    return ok({
      paquetes,
      // `soloLectura` = la tabla todavía no existe y lo que se está viendo es la
      // semilla escrita en el código. La pantalla lo dice y esconde los botones,
      // porque guardar reventaría.
      soloLectura,
      catalogo: catalogoConExigencias(),
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const { PaqueteModulos } = getMasterModels();

    let existentes;
    try {
      existentes = await PaqueteModulos.findAll({ attributes: ["clave", "nombre"] });
    } catch {
      return error(
        "Falta crear la tabla. Corre en el VPS: docker exec crm-salamandra-app-1 node scripts/migrate-paquetes-modulos.js",
        503
      );
    }

    const v = validarPaquete(body, {
      nombresOcupados: existentes.map((p) => p.nombre),
      clavesOcupadas: existentes.map((p) => p.clave),
    });
    if (!v.ok) {
      // Se devuelve QUÉ FALTA junto al error para que la pantalla pueda ofrecer
      // «añadir también …», igual que el alta. Nunca se completa por su cuenta:
      // lo que lleva un paquete acaba en la factura de alguien.
      //
      // `errorConDatos` y no `error`: este último SOLO adjunta los detalles
      // fuera de producción (apiResponse.js:17), o sea que en el VPS —el único
      // sitio donde esta pantalla existe— el `faltan` se habría perdido.
      return errorConDatos(v.error, v.status, { faltan: loQueFalta(body?.modulos) });
    }

    const fila = await PaqueteModulos.create({
      ...v.limpio,
      tocadoPor: ctx.user?.email ?? request.headers.get("x-user-email") ?? null,
    });

    const { userId, ip } = datosPeticion(request);
    await auditar({
      tenantId: ctx.tenant.id,
      userId,
      action: "provisioning.paquete_creado",
      entity: "PaqueteModulos",
      entityId: fila.id,
      before: null,
      after: { clave: fila.clave, nombre: fila.nombre, modulos: fila.modulos },
      ip,
    });

    return created(serializarPaquete(fila));
  } catch (err) {
    return serverError(err);
  }
});
