import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, errorConDatos, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../../lib/demo/isDemo.js";
import { validarPaquete, loQueFalta, serializarPaquete } from "../../../../../lib/provisioning/paquetes.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * /api/admin/paquetes/[id] — editar y borrar un paquete.
 *
 * ⚠️ NI EDITAR NI BORRAR TOCAN A NINGÚN CLIENTE, y es lo primero que hay que
 * saber: un paquete es un atajo para marcar casillas en el alta, y no queda
 * guardado en ningún tenant. Quien se dio de alta con el Paquete Clínica tiene
 * los ocho módulos que se marcaron ese día, no «el Paquete Clínica»; si mañana
 * el paquete cambia, a él no le pasa nada.
 *
 * Eso es lo que hace que borrar aquí sea barato — y por eso no lleva las
 * trampas de suspender un cliente (teclear el slug, contar lo que hay dentro).
 * Lo que se pierde es una plantilla.
 *
 * Mismos tres candados que el resto del back-office.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

async function buscar(id) {
  const { PaqueteModulos } = getMasterModels();
  return PaqueteModulos.findByPk(id);
}

export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const { id } = await params;
    if (!UUID_RE.test(String(id ?? ""))) return error("id inválido", 422);

    const { PaqueteModulos } = getMasterModels();
    const fila = await buscar(id);
    if (!fila) return notFound("Ese paquete ya no existe");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    /*
     * Interruptor suelto: activar o retirar un paquete del alta no pasa por la
     * validación entera. Un paquete que se quedó con un módulo que ya no se
     * vende tiene que poder RETIRARSE aunque no pueda guardarse — si no, la
     * única salida sería borrarlo, y se perdería lo que llevaba.
     */
    if (Object.keys(body).length === 1 && typeof body.activo === "boolean") {
      const antes = fila.activo;
      await fila.update({
        activo: body.activo,
        tocadoPor: ctx.user?.email ?? request.headers.get("x-user-email") ?? null,
      });
      const { userId, ip } = datosPeticion(request);
      await auditar({
        tenantId: ctx.tenant.id,
        userId,
        action: "provisioning.paquete_editado",
        entity: "PaqueteModulos",
        entityId: fila.id,
        before: { clave: fila.clave, activo: antes },
        after: { clave: fila.clave, activo: fila.activo },
        ip,
      });
      return ok(serializarPaquete(fila));
    }

    // Los nombres y claves de los OTROS, para no chocar consigo mismo.
    const otros = await PaqueteModulos.findAll({
      where: { id: { [Op.ne]: fila.id } },
      attributes: ["clave", "nombre"],
    });

    /*
     * La CLAVE no se recalcula al renombrar, y es deliberado: es el identificador
     * estable del paquete y no se enseña en ninguna parte. Regenerarla haría que
     * corregir una tilde en el nombre cambiara la clave, que es justo la clase
     * de efecto secundario que nadie espera de un renombrado.
     */
    const v = validarPaquete(
      { ...body, modulos: body.modulos ?? fila.modulos },
      {
        nombresOcupados: otros.map((p) => p.nombre),
        clavesOcupadas: otros.map((p) => p.clave),
      }
    );
    if (!v.ok) return errorConDatos(v.error, v.status, { faltan: loQueFalta(body?.modulos ?? fila.modulos) });

    const antes = { clave: fila.clave, nombre: fila.nombre, modulos: fila.modulos, activo: fila.activo };
    await fila.update({
      nombre: v.limpio.nombre,
      descripcion: v.limpio.descripcion,
      modulos: v.limpio.modulos,
      orden: v.limpio.orden,
      activo: v.limpio.activo,
      tocadoPor: ctx.user?.email ?? request.headers.get("x-user-email") ?? null,
    });

    const { userId, ip } = datosPeticion(request);
    await auditar({
      tenantId: ctx.tenant.id,
      userId,
      action: "provisioning.paquete_editado",
      entity: "PaqueteModulos",
      entityId: fila.id,
      before: antes,
      after: { clave: fila.clave, nombre: fila.nombre, modulos: fila.modulos, activo: fila.activo },
      ip,
    });

    return ok(serializarPaquete(fila));
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const { id } = await params;
    if (!UUID_RE.test(String(id ?? ""))) return error("id inválido", 422);

    const fila = await buscar(id);
    if (!fila) return ok({ borrado: false }); // idempotente

    const antes = { clave: fila.clave, nombre: fila.nombre, modulos: fila.modulos };
    await fila.destroy();

    const { userId, ip } = datosPeticion(request);
    await auditar({
      tenantId: ctx.tenant.id,
      userId,
      action: "provisioning.paquete_borrado",
      entity: "PaqueteModulos",
      entityId: id,
      before: antes,
      after: null,
      ip,
    });

    return ok({ borrado: true });
  } catch (err) {
    return serverError(err);
  }
});
