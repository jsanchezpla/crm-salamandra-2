import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";

const ADMIN = new Set(["admin", "superadmin"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH  /api/fichaje/[id] — corregir un tramo.
 * DELETE /api/fichaje/[id] — darlo de baja.
 *
 * Las dos exigen NOTA, y no es burocracia: es la diferencia entre una
 * corrección y un número cambiado. Cuando alguien discuta su nómina, la
 * pantalla tiene que poder enseñar «el Excel decía 480, Fulana lo dejó en 420
 * el día 3 porque el reloj no registró la salida».
 *
 * Por eso tampoco se pisa `minutosOriginal`: guarda lo que dijo el fichero la
 * primera vez y no lo toca nadie nunca.
 *
 * Y por eso DELETE es un borrado BLANDO. Un registro de jornada no se borra: se
 * da de baja, con motivo y con autor.
 */

async function cargar(tenantModels, id) {
  const { Fichaje } = tenantModels;
  if (!UUID_RE.test(String(id || ""))) return { errorMsg: "id inválido" };
  const fila = await Fichaje.findByPk(id);
  if (!fila || fila.deletedAt) return { errorMsg: null, fila: null };
  return { fila };
}

export const PATCH = withTenant(async (request, ctx, { tenant, tenantModels, hasModule, user }) => {
  try {
    if (!hasModule("fichaje")) return forbidden("Módulo fichaje no activo");
    if (!ADMIN.has(request.headers.get("x-user-role"))) return forbidden("Solo administradores");

    const { id } = await ctx.params;
    const { errorMsg, fila } = await cargar(tenantModels, id);
    if (errorMsg) return error(errorMsg);
    if (!fila) return notFound("Fichaje no encontrado");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const nota = String(body?.nota ?? "").trim();
    if (!nota) return error("La nota es obligatoria al corregir: di por qué cambia");

    const cambios = { nota, origen: "corregido", corregidoAt: new Date() };

    if (body.minutos !== undefined) {
      const m = Math.round(Number(body.minutos));
      if (!Number.isFinite(m) || m < 0 || m > 24 * 60) return error("Los minutos tienen que estar entre 0 y 1440");
      cambios.minutos = m;
    }
    if (body.entradaAt !== undefined) cambios.entradaAt = body.entradaAt || null;
    if (body.salidaAt !== undefined) cambios.salidaAt = body.salidaAt || null;
    if (body.tipo !== undefined) {
      if (!["trabajo", "pausa", "ausencia", "festivo"].includes(body.tipo)) return error("Tipo no válido");
      cambios.tipo = body.tipo;
    }

    // Si el tramo vino de un Excel, se guarda lo que decía ANTES de tocarlo —
    // pero solo la primera vez: corregir dos veces no puede borrar el original.
    if (fila.minutosOriginal === null && fila.origen === "import") {
      cambios.minutosOriginal = fila.minutos;
    }

    const antes = { minutos: fila.minutos, entradaAt: fila.entradaAt, salidaAt: fila.salidaAt, tipo: fila.tipo };
    await fila.update(cambios);

    await auditar({
      tenantId: tenant.id,
      userId: user?.id ?? null,
      action: "fichaje.corregido",
      entity: "Fichaje",
      entityId: fila.id,
      before: { minutos: antes.minutos },
      after: { minutos: fila.minutos, fecha: String(fila.fecha), motivo: nota.slice(0, 120) },
      ...datosPeticion(request),
    });

    return ok(fila.toJSON());
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, ctx, { tenant, tenantModels, hasModule, user }) => {
  try {
    if (!hasModule("fichaje")) return forbidden("Módulo fichaje no activo");
    if (!ADMIN.has(request.headers.get("x-user-role"))) return forbidden("Solo administradores");

    const { id } = await ctx.params;
    const { errorMsg, fila } = await cargar(tenantModels, id);
    if (errorMsg) return error(errorMsg);
    if (!fila) return notFound("Fichaje no encontrado");

    // El motivo viaja por query porque un DELETE con cuerpo no lo mandan todos
    // los clientes de forma fiable.
    const nota = String(new URL(request.url).searchParams.get("nota") ?? "").trim();
    if (!nota) return error("Hace falta un motivo para dar de baja un fichaje");

    await fila.update({ deletedAt: new Date(), nota, corregidoAt: new Date() });

    await auditar({
      tenantId: tenant.id,
      userId: user?.id ?? null,
      action: "fichaje.dado_de_baja",
      entity: "Fichaje",
      entityId: fila.id,
      before: { minutos: fila.minutos, fecha: String(fila.fecha) },
      after: { motivo: nota.slice(0, 120) },
      ...datosPeticion(request),
    });

    return ok({ id: fila.id, baja: true });
  } catch (err) {
    return serverError(err);
  }
});
